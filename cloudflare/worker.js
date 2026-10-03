import prompt from './prompt.json' with {type:'json'};
import {normalizeName, excerpts, selectFiling, extractFacts, passagesFor, validateJudgment, judgmentSchema} from './core.js';
const now=()=>new Date().toISOString();
const fresh=(row,seconds)=>row && Date.now()-Date.parse(row.updated_at)<seconds*1000;
const json=(data,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
const one=(env,sql,...args)=>env.DB.prepare(sql).bind(...args).first();
const run=(env,sql,...args)=>env.DB.prepare(sql).bind(...args).run();
async function cached(env,key) {
  const row=await one(env,'SELECT response FROM worker_cache WHERE key=? AND expires_at>?',key,Date.now());
  return row?JSON.parse(row.response):null;
}
async function save(env,key,value,ttl) {
  await run(env,'INSERT INTO worker_cache VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET response=excluded.response,expires_at=excluded.expires_at',key,JSON.stringify(value),Date.now()+ttl*1000);
  return value;
}
async function checkedFetch(url,options={},limit=16000000) {
  const response=await fetch(url,{...options,signal:AbortSignal.timeout(options.timeout||20000)});
  if(!response.ok) { await response.body?.cancel(); throw new Error(`Upstream HTTP ${response.status}`); }
  const reader=response.body.getReader(); const decoder=new TextDecoder(); let text='',size=0;
  for(;;) {
    const {value,done}=await reader.read(); if(done) break;
    size+=value.byteLength;
    if(size>limit) { await reader.cancel(); throw new Error('Document exceeds download limit'); }
    text+=decoder.decode(value,{stream:true});
  }
  return text+decoder.decode();
}
async function secGet(env,url) {
  if(!env.SEC_USER_AGENT?.includes('@')) throw new Error('SEC contact header is not configured');
  // Reserve a slot atomically across all Worker instances, at most four requests/second.
  const t=Date.now();
  const slot=await one(env,"UPDATE request_slots SET next_at=MAX(next_at,?)+300 WHERE name='sec' AND next_at<? RETURNING next_at",t,t+10000);
  if(!slot) throw new Error('SEC request queue is busy. Please retry shortly.');
  const wait=slot.next_at-300-Date.now(); if(wait>0) await new Promise(r=>setTimeout(r,wait));
  return checkedFetch(url,{headers:{'User-Agent':env.SEC_USER_AGENT},timeout:20000},url.endsWith('cik-lookup-data.txt')?64000000:16000000);
}
export async function calendar(env,month,force=false) {
  let row=await one(env,'SELECT * FROM calendar_snapshots WHERE month=?',month);
  if(!fresh(row,3600)||force) {
    try {
      const payload=JSON.parse(await checkedFetch(`https://api.nasdaq.com/api/ipo/calendar?date=${month}`,{headers:{'User-Agent':'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'}}));
      const data=payload.data;
      if(!data||typeof data!=='object'||Array.isArray(data)) throw new Error('Missing calendar data');
      const ipos=[];
      for(const [rows,status,date] of [[data.upcoming?.upcomingTable?.rows||[],'upcoming','expectedPriceDate'],[data.priced?.rows||[],'priced','pricedDate']]) {
        if(!Array.isArray(rows)) throw new Error('Invalid calendar rows');
        for(const r of rows) ipos.push({name:r.companyName||'Unnamed company',ticker:r.proposedTickerSymbol||'',date:r[date]||'',amount:r.dollarValueOfSharesOffered||'',status});
      }
      row={response:JSON.stringify(ipos),updated_at:now()};
      await run(env,'INSERT INTO calendar_snapshots VALUES (?,?,?) ON CONFLICT(month) DO UPDATE SET response=excluded.response,updated_at=excluded.updated_at',month,row.response,row.updated_at);
    } catch {
      if(!row) throw new Error('IPO calendar is temporarily unavailable.');
      return {ipos:JSON.parse(row.response),updated_at:row.updated_at,stale:true,source:'Nasdaq',refresh_failed:true};
    }
  }
  return {ipos:JSON.parse(row.response),updated_at:row.updated_at,stale:!fresh(row,3600),source:'Nasdaq',refresh_failed:false};
}
async function filingFor(env,name) {
  const target=normalizeName(name),key=`filing:${target}`;
  const hit=await cached(env,key); if(hit) return hit;
  try {
    if(!target) throw new Error('A company name is required');
    const saved=await one(env,'SELECT cik FROM issuer_identities WHERE name_key=?',target);
    const candidates=new Set();
    if(saved) candidates.add(Number(saved.cik));
    else {
      let tickers=await cached(env,'sec:tickers');
      if(!tickers) tickers=await save(env,'sec:tickers',JSON.parse(await secGet(env,'https://www.sec.gov/files/company_tickers.json')),86400);
      for(const row of Object.values(tickers)) if(normalizeName(row.title)===target) candidates.add(Number(row.cik_str));
      if(!candidates.size) {
        const directory=await secGet(env,'https://www.sec.gov/Archives/edgar/cik-lookup-data.txt');
        for(const line of directory.split('\n')) {
          const match=line.match(/^(.*?):(\d+):?\s*$/);
          if(match&&normalizeName(match[1])===target) candidates.add(Number(match[2]));
        }
      }
    }
    if(candidates.size!==1) throw new Error('No unique SEC company match; no filing-based score is available');
    const cik=[...candidates][0];
    const data=JSON.parse(await secGet(env,`https://data.sec.gov/submissions/CIK${String(cik).padStart(10,'0')}.json`));
    const filing=selectFiling(data,name);
    await run(env,'INSERT INTO issuer_identities VALUES (?,?,?,?) ON CONFLICT(name_key) DO UPDATE SET cik=excluded.cik,sec_name=excluded.sec_name,verified_at=excluded.verified_at',target,String(cik),data.name,now());
    const accession=filing.accessionNumber,url=`https://www.sec.gov/Archives/edgar/data/${cik}/${accession.replaceAll('-','')}/${filing.primaryDocument}`;
    return await save(env,key,{status:'available',company:data.name,cik:String(cik),form:filing.form,filed:filing.filingDate,url,accession,excerpts:excerpts(await secGet(env,url)),note:'Based on selected filing excerpts, not a full filing review. Registration statements may be preliminary or relate to another offering.'},900);
  } catch(error) {
    const safe=/^(No unique|SEC issuer name differs|No recent|No readable|A company name|Unexpected SEC document|SEC request queue)/.test(error.message);
    return {status:'unavailable',note:safe?error.message:'SEC could not be reached or declined the request. Try again later.'};
  }
}
async function factsFor(env,filing) {
  const row=await one(env,'SELECT * FROM reported_facts WHERE accession=?',filing.accession);
  if(fresh(row,86400)) return JSON.parse(row.response);
  try {
    const data=JSON.parse(await secGet(env,`https://data.sec.gov/api/xbrl/companyfacts/CIK${filing.cik.padStart(10,'0')}.json`));
    const items=extractFacts(data,filing),result={items,status:items.length?'available':'not_reported',note:'SEC XBRL values from this exact filing; periods and units may differ. Coverage is limited to standard US-GAAP tags. Missing values are not zero.'};
    await run(env,'INSERT INTO reported_facts VALUES (?,?,?,?) ON CONFLICT(accession) DO UPDATE SET response=excluded.response,updated_at=excluded.updated_at',filing.accession,filing.cik,JSON.stringify(result),now());
    return result;
  } catch { return {items:[],status:'unavailable',note:'Structured financial facts are unavailable for this filing. Missing values are not zero.'}; }
}
export async function analyze(env,company,ticker,amount,status) {
  const filing=await filingFor(env,company);
  if(filing.status!=='available') return {score:null,summary:'Insufficient SEC evidence to judge this IPO.',red_flag:'Company financials and risks have not been verified against SEC filings.',about:'',evidence:[],limitations:filing.note,sec:filing,highlights:[],risks:[],gaps:[filing.note],score_reason:filing.note};
  const reported_facts=await factsFor(env,filing),passages=passagesFor(filing.excerpts);
  const {excerpts:unused,...source}=filing;
  const payload=JSON.stringify({company,ticker,offer_amount:amount,status,filing:source,as_of:now().slice(0,10),reported_facts,passages:passages.map((text,i)=>({id:i+1,text}))});
  const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode('cf-sec-v7:'+payload));
  const key=[...new Uint8Array(digest)].map(n=>n.toString(16).padStart(2,'0')).join('');
  const hit=await one(env,'SELECT response FROM sec_analysis WHERE cache_key=?',key); if(hit) return JSON.parse(hit.response);
  // A database lease prevents simultaneous clicks from paying for duplicate analyses.
  const lock=`analysis-lock:${key}`;
  const lease=await one(env,'INSERT INTO worker_cache VALUES (?,\'null\',?) ON CONFLICT(key) DO UPDATE SET expires_at=excluded.expires_at WHERE worker_cache.expires_at<? RETURNING key',lock,Date.now()+150000,Date.now());
  if(!lease) {
    for(let i=0;i<30;i++) {
      await new Promise(r=>setTimeout(r,2000));
      const done=await one(env,'SELECT response FROM sec_analysis WHERE cache_key=?',key); if(done) return JSON.parse(done.response);
    }
    throw new Error('Analysis is still running. Please retry shortly.');
  }
  try {
    const response=JSON.parse(await checkedFetch('https://api.anthropic.com/v1/messages',{method:'POST',timeout:120000,headers:{'Content-Type':'application/json','x-api-key':env.ANTHROPIC_API_KEY,'anthropic-version':'2023-06-01'},body:JSON.stringify({model:'claude-haiku-4-5-20251001',max_tokens:4000,tools:[{name:'submit_judgment',description:'Submit the filing-based assessment.',input_schema:judgmentSchema}],tool_choice:{type:'tool',name:'submit_judgment'},system:prompt,messages:[{role:'user',content:payload}]})}));
    const input=response.content?.find(b=>b.type==='tool_use'&&b.name==='submit_judgment')?.input;
    const result={...validateJudgment(input,passages),reported_facts,sec:source};
    await run(env,'INSERT OR IGNORE INTO sec_analysis VALUES (?,?)',key,JSON.stringify(result));
    return result;
  } catch { throw new Error('Could not produce a verified filing analysis. Please retry.'); }
  finally { await run(env,'DELETE FROM worker_cache WHERE key=?',lock); }
}
export default {
  async fetch(request,env) {
    const url=new URL(request.url),path=url.pathname;
    if(!path.startsWith('/api/')) return env.ASSETS.fetch(request);
    if(request.method!=='GET') return json({detail:'Method not allowed'},405);
    try {
      if(path==='/api/health') { await one(env,'SELECT 1 AS ok'); return json({status:'ok',hosting:'Cloudflare Workers',database:'D1'}); }
      if(path==='/api/calendar'||path==='/api/ipos') {
        const month=url.searchParams.get('month')||now().slice(0,7);
        if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return json({detail:'Use a month in YYYY-MM format.'},422);
        const result=await calendar(env,month); return json(path.endsWith('/ipos')?result.ipos:result);
      }
      if(path.startsWith('/api/analyze/')) {
        const company=decodeURIComponent(path.slice('/api/analyze/'.length));
        if(!company||company.length>300) return json({detail:'Invalid company name'},422);
        return json(await analyze(env,company,...['ticker','amount','status'].map(k=>url.searchParams.get(k)||'')));
      }
      return json({detail:'Not found'},404);
    } catch(error) {
      console.error('API request failed',path.split('/')[2],error.name);
      const message=/^(IPO calendar|Could not produce|Analysis is still)/.test(error.message)?error.message:'This request is temporarily unavailable. Please retry.';
      return json({detail:message},502);
    }
  },
  async scheduled(event,env) {
    const today=new Date(event.scheduledTime);
    for(let offset=0;offset<12;offset++) {
      const month=new Date(Date.UTC(today.getUTCFullYear(),today.getUTCMonth()-offset,1)).toISOString().slice(0,7);
      try { const result=await calendar(env,month,true); if(result.refresh_failed) console.warn('Calendar refresh failed',month); } catch { console.warn('Calendar refresh failed',month); }
    }
    await run(env,'DELETE FROM worker_cache WHERE expires_at<?',Date.now());
  },
};
