import {reserveAI,recordAI,dailyBudget,clientLimit} from './controls.js';
import {historyRows,priceChanges} from './prices.js';
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
  if(!fresh(row,3600)||force||(row&&JSON.parse(row.response).some(ipo=>!Object.hasOwn(ipo,'offer_price')))) {
    try {
      const payload=JSON.parse(await checkedFetch(`https://api.nasdaq.com/api/ipo/calendar?date=${month}`,{headers:{'User-Agent':'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'}}));
      const data=payload.data;
      if(!data||typeof data!=='object'||Array.isArray(data)) throw new Error('Missing calendar data');
      const ipos=[];
      for(const [rows,status,date] of [[data.upcoming?.upcomingTable?.rows||[],'upcoming','expectedPriceDate'],[data.priced?.rows||[],'priced','pricedDate']]) {
        if(!Array.isArray(rows)) throw new Error('Invalid calendar rows');
        for(const r of rows) ipos.push({name:r.companyName||'Unnamed company',ticker:r.proposedTickerSymbol||'',date:r[date]||'',amount:r.dollarValueOfSharesOffered||'',status,offer_price:r.proposedSharePrice||null});
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
  const target=normalizeName(name),key=`filing-v2:${target}`;
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
    return await save(env,key,{status:'available',company:data.name,industry:data.sicDescription||null,cik:String(cik),form:filing.form,filed:filing.filingDate,url,accession,excerpts:excerpts(await secGet(env,url)),note:'Based on selected filing excerpts, not a full filing review. Registration statements may be preliminary or relate to another offering.'},900);
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
export const researchKey=(company,ticker,amount,status)=>JSON.stringify(['overview-v11',company,ticker,amount,status]);
async function indexAnalysis(env,requestKey,result){
  const timestamp=now();
  await run(env,'INSERT INTO analysis_index VALUES (?,?,?,?) ON CONFLICT(key) DO UPDATE SET updated_at=CASE WHEN analysis_index.response=excluded.response THEN analysis_index.updated_at ELSE excluded.updated_at END,response=excluded.response,checked_at=excluded.checked_at',requestKey,JSON.stringify(result),timestamp,timestamp);
}
export async function reserveResearchBudget(env){
  const limit=Number(env.BACKGROUND_DAILY_LIMIT||10);
  if(!Number.isInteger(limit)||limit<1)return false;
  return !!await one(env,'INSERT INTO research_budget VALUES (?,1) ON CONFLICT(day) DO UPDATE SET used=used+1 WHERE used<? RETURNING used',now().slice(0,10),limit);
}
export async function analyze(env,company,ticker,amount,status,background=false) {
  const requestKey=researchKey(company,ticker,amount,status);
  const filing=await filingFor(env,company);
  if(filing.status!=='available') { const result={score:null,summary:'Insufficient SEC evidence to judge this IPO.',red_flag:'Company financials and risks have not been verified against SEC filings.',about:'',evidence:[],limitations:filing.note,sec:filing,highlights:[],risks:[],gaps:[filing.note],score_reason:filing.note}; await indexAnalysis(env,requestKey,result); return result; }
  const reported_facts=await factsFor(env,filing),passages=passagesFor(filing.excerpts);
  const {excerpts:unused,...source}=filing;
  const inputs={company,ticker,offer_amount:amount,status,filing:source,reported_facts,passages:passages.map((text,i)=>({id:i+1,text}))};
  const payload=JSON.stringify({...inputs,as_of:now().slice(0,10)});
  const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode('cf-sec-v12-structured-evidence:'+JSON.stringify(inputs)));
  const key=[...new Uint8Array(digest)].map(n=>n.toString(16).padStart(2,'0')).join('');
  const hit=await one(env,'SELECT response FROM sec_analysis WHERE cache_key=?',key); if(hit) { const result=JSON.parse(hit.response); await indexAnalysis(env,requestKey,result); return result; }
  // A database lease prevents simultaneous clicks from paying for duplicate analyses.
  const lock=`analysis-lock:${key}`;
  const lease=await one(env,'INSERT INTO worker_cache VALUES (?,\'null\',?) ON CONFLICT(key) DO UPDATE SET expires_at=excluded.expires_at WHERE worker_cache.expires_at<? RETURNING key',lock,Date.now()+150000,Date.now());
  if(!lease) {
    for(let i=0;i<30;i++) {
      await new Promise(r=>setTimeout(r,2000));
      const done=await one(env,'SELECT response FROM sec_analysis WHERE cache_key=?',key); if(done) { const result=JSON.parse(done.response); await indexAnalysis(env,requestKey,result); return result; }
    }
    throw new Error('Analysis is still running. Please retry shortly.');
  }
  try {
    if(background&&!await reserveResearchBudget(env)) throw new Error('Background daily limit reached');
    const body={model:'claude-haiku-4-5-20251001',max_tokens:4000,tools:[{name:'submit_judgment',description:'Submit the filing-based assessment.',input_schema:judgmentSchema}],tool_choice:{type:'tool',name:'submit_judgment'},system:prompt,messages:[{role:'user',content:payload}]};
    const reservation=await reserveAI(env,body);
    const response=JSON.parse(await checkedFetch('https://api.anthropic.com/v1/messages',{method:'POST',timeout:120000,headers:{'Content-Type':'application/json','x-api-key':env.ANTHROPIC_API_KEY,'anthropic-version':'2023-06-01'},body:JSON.stringify(body)}));
    await recordAI(env,reservation,response.usage);
    const input=response.content?.find(b=>b.type==='tool_use'&&b.name==='submit_judgment')?.input;
    const result={...validateJudgment(input,passages),reported_facts,sec:source};
    await run(env,'INSERT OR IGNORE INTO sec_analysis VALUES (?,?)',key,JSON.stringify(result));
    await indexAnalysis(env,requestKey,result);
    return result;
  } catch(error) { if(error.status||error.message==='Background daily limit reached')throw error; throw new Error('Could not produce a verified filing analysis. Please retry.'); }
  finally { await run(env,'DELETE FROM worker_cache WHERE key=?',lock); }
}
export function parseQuote(data,ticker,company){
  if(!data||data.symbol?.toUpperCase()!==ticker)throw new Error('Quote symbol mismatch');
  const actual=normalizeName(data.companyName||''),target=normalizeName(company);
  const suffix=actual.startsWith(target)?actual.slice(target.length).trim():null;
  if(suffix===null||!/^$|^(?:class [a-z] )?(?:ordinary shares?|common (?:stock|shares?)|units?|american depos(?:itary|itory) shares?)(?: .*)?$/.test(suffix))throw new Error('Quote company mismatch');
  const p=data.primaryData;
  if(!p||typeof p.lastSalePrice!=='string'||!/^\$?[0-9,]+(?:\.[0-9]+)?$/.test(p.lastSalePrice))throw new Error('No trading price available');
  const value=Number(p.lastSalePrice.replace(/[$,]/g,''));
  if(!Number.isFinite(value)||value<=0||!p.lastTradeTimestamp)throw new Error('Invalid quote');
  return {status:'available',price:p.lastSalePrice,currency:p.currency||null,as_of:p.lastTradeTimestamp,is_real_time:p.isRealTime===true,market_status:data.marketStatus||null,source:'Nasdaq',source_url:`https://www.nasdaq.com/market-activity/stocks/${encodeURIComponent(ticker.toLowerCase())}`,fetched_at:now()};
}
export async function quoteFor(env,ticker,company,status,offerPrice='',listingDate=''){
  if(status==='upcoming')return {status:'not_trading',price:null};
  const key='quote-v2:'+JSON.stringify([ticker,normalizeName(company),offerPrice,listingDate]);
  const hit=await cached(env,key);if(hit)return hit;
  try {
    const payload=JSON.parse(await checkedFetch(`https://api.nasdaq.com/api/quote/${encodeURIComponent(ticker)}/info?assetclass=stocks`,{headers:{'User-Agent':'Mozilla/5.0'},timeout:6000}));
    const quote=parseQuote(payload.data,ticker,company);
    try{
      const historyKey='history:'+ticker;let rows=await cached(env,historyKey);
      if(!rows){
        const from=new Date(Date.now()-45*86400000).toISOString().slice(0,10),to=now().slice(0,10);
        const history=JSON.parse(await checkedFetch(`https://api.nasdaq.com/api/quote/${encodeURIComponent(ticker)}/historical?assetclass=stocks&fromdate=${from}&todate=${to}&limit=100`,{headers:{'User-Agent':'Mozilla/5.0'},timeout:6000}));
        rows=await save(env,historyKey,historyRows(history.data,ticker),3600);
      }
      quote.changes=priceChanges(rows,offerPrice,listingDate);
    }catch{quote.changes={as_of:null,items:[]};}
    return await save(env,key,quote,300);
  }catch{return await save(env,key,{status:'unavailable',price:null,fetched_at:now()},300);}
}
export async function refreshBackground(env){
  // Bound price work separately from the single AI research job.
  const snapshots=await env.DB.prepare('SELECT month,response FROM calendar_snapshots ORDER BY month DESC LIMIT 12').all();
  const jobs=await env.DB.prepare('SELECT key,next_at FROM research_jobs').all();
  const due=new Map(jobs.results.map(j=>[j.key,j.next_at]));
  const candidates=snapshots.results.flatMap(s=>JSON.parse(s.response)).filter(i=>i.name&&i.ticker);
  const unique=[...new Map(candidates.map(i=>[researchKey(i.name,i.ticker,i.amount||'',i.status),i])).entries()];
  // Rotate quotes separately so price refreshes do not depend on the AI budget.
  const cursor=await cached(env,'quote-cursor')||0;
  const tradable=unique.map(([,ipo])=>ipo).filter(ipo=>ipo.status!=='upcoming');
  if(tradable.length){
    const count=Math.min(10,tradable.length);
    const queue=Array.from({length:count},(_,i)=>tradable[(cursor+i)%tradable.length]);
    await Promise.all(Array.from({length:2},async()=>{while(queue.length){const ipo=queue.shift();await quoteFor(env,ipo.ticker,ipo.name,ipo.status,ipo.offer_price||'',ipo.date);}}));
    await save(env,'quote-cursor',(cursor+count)%tradable.length,86400);
  }
  const job=unique.find(([key])=>(due.get(key)||0)<=Date.now());if(!job)return;
  const [key,ipo]=job;
  const lease=await one(env,"INSERT INTO research_jobs VALUES (?,?,'running') ON CONFLICT(key) DO UPDATE SET next_at=excluded.next_at,status='running' WHERE research_jobs.next_at<=? RETURNING key",key,Date.now()+600000,Date.now());
  if(!lease)return;
  try{
    const result=await analyze(env,ipo.name,ipo.ticker,ipo.amount||'',ipo.status,true);
    const available=result.sec?.status==='available';
    await run(env,'UPDATE research_jobs SET next_at=?,status=? WHERE key=?',Date.now()+(available?86400000:21600000),available?'ready':'source_unavailable',key);
  }catch(error){
    const capped=error.status===429||error.message==='Background daily limit reached';
    const retry=capped?Date.parse(now().slice(0,10))+86400000:Date.now()+3600000;
    await run(env,'UPDATE research_jobs SET next_at=?,status=? WHERE key=?',retry,capped?'daily_limit':'retry',key);
    console.warn('Background research',capped?'daily_limit':'retry');
  }
}
export default {
  async fetch(request,env,ctx) {
    const url=new URL(request.url),path=url.pathname;
    if(!path.startsWith('/api/')) return env.ASSETS.fetch(request);
    if(request.method!=='GET') return json({detail:'Method not allowed'},405);
    try {
      if(path==='/api/usage') { const row=await one(env,'SELECT * FROM ai_daily_usage WHERE day=?',now().slice(0,10));return json({day:now().slice(0,10),budget_usd:dailyBudget(env)/1000000,recorded_cost_usd:(row?.actual_micros||0)/1000000,reserved_usd:(row?.reserved_micros||0)/1000000,attempts:row?.attempts||0}); }
      if(path==='/api/health') { await one(env,'SELECT 1 AS ok'); return json({status:'ok',hosting:'Cloudflare Workers',database:'D1'}); }
      if(path==='/api/calendar'||path==='/api/ipos') {
        const month=url.searchParams.get('month')||now().slice(0,7);
        if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return json({detail:'Use a month in YYYY-MM format.'},422);
        const result=await calendar(env,month);
        if(path.endsWith('/ipos')) return json(result.ipos);
        // Return saved prices with the calendar so colors do not wait on upstream requests.
        const quotes={};
        const saved=await env.DB.prepare("SELECT key,response,expires_at FROM worker_cache WHERE key LIKE 'quote-v2:%' AND expires_at>?").bind(Date.now()-86400000).all();
        const byKey=new Map(saved.results.map(row=>[row.key,row]));
        for(const ipo of result.ipos){
          if(ipo.status==='upcoming')continue;
          const key='quote-v2:'+JSON.stringify([ipo.ticker,normalizeName(ipo.name),ipo.offer_price||'',ipo.date]);
          const row=byKey.get(key);
          if(row && row.expires_at>Date.now()-86400000) quotes[`${ipo.name}|${ipo.ticker}|${ipo.date}`]={...JSON.parse(row.response),stale:row.expires_at<=Date.now()};
        }
        return json({...result,quotes});
      }
      if(path.startsWith('/api/quote/')) {
        const ticker=decodeURIComponent(path.slice('/api/quote/'.length)).toUpperCase(),company=url.searchParams.get('company')||'';
        if(!/^[A-Z0-9.^-]{1,15}$/.test(ticker)||!company||company.length>300)return json({detail:'Invalid quote request'},422);
        const status=url.searchParams.get('status')||'',offer=url.searchParams.get('offer_price')||'',date=url.searchParams.get('date')||'';
        const key='quote-v2:'+JSON.stringify([ticker,normalizeName(company),offer,date]);
        const saved=await one(env,'SELECT response,expires_at FROM worker_cache WHERE key=?',key);
        if(ctx && status!=='upcoming' && saved && saved.expires_at>Date.now()-86400000){
          const stale=saved.expires_at<=Date.now();
          if(stale)ctx.waitUntil(quoteFor(env,ticker,company,status,offer,date));
          return json({...JSON.parse(saved.response),stale});
        }
        return json(await quoteFor(env,ticker,company,status,offer,date));
      }
      if(path.startsWith('/api/analyze/')) {
        const company=decodeURIComponent(path.slice('/api/analyze/'.length));
        if(!company||company.length>300) return json({detail:'Invalid company name'},422);
        const args=['ticker','amount','status'].map(k=>url.searchParams.get(k)||'');
        const saved=await one(env,'SELECT * FROM analysis_index WHERE key=?',researchKey(company,...args));
        if(saved){const result=JSON.parse(saved.response); if(result.sec?.status==='available'||Date.now()-Date.parse(saved.checked_at)<21600000)return json({...result,analysis_updated_at:saved.updated_at,analysis_checked_at:saved.checked_at});}
        await clientLimit(env,request,'new-research',3,3600);
        const known=await env.DB.prepare('SELECT response FROM calendar_snapshots ORDER BY month DESC LIMIT 12').all();
        if(!known.results.some(row=>JSON.parse(row.response).some(ipo=>ipo.name===company&&ipo.ticker===args[0]&&(ipo.amount||'')===args[1]&&ipo.status===args[2])))return json({detail:'Select a company from the IPO calendar to request research.'},422);
        return json(await analyze(env,company,...args));
      }
      return json({detail:'Not found'},404);
    } catch(error) {
      console.error('API request failed',path.split('/')[2],error.name);
      if(error.status)return json({detail:error.message},error.status);
      const message=/^(IPO calendar|Could not produce|Analysis is still)/.test(error.message)?error.message:'This request is temporarily unavailable. Please retry.';
      return json({detail:message},502);
    }
  },
  async scheduled(event,env) {
    if(event.cron==='*/5 * * * *') {await refreshBackground(env);return;}
    const today=new Date(event.scheduledTime);
    for(let offset=0;offset<12;offset++) {
      const month=new Date(Date.UTC(today.getUTCFullYear(),today.getUTCMonth()-offset,1)).toISOString().slice(0,7);
      try { const result=await calendar(env,month,true); if(result.refresh_failed) console.warn('Calendar refresh failed',month); } catch { console.warn('Calendar refresh failed',month); }
    }
    for(const table of ['app_limits'])await run(env,`DELETE FROM ${table} WHERE expires_at<?`,Date.now());
    // Keep price snapshots for a day so stale-while-refresh survives hourly cleanup.
    await run(env,"DELETE FROM worker_cache WHERE expires_at<? AND (key NOT LIKE 'quote-v2:%' OR expires_at<?)",Date.now(),Date.now()-86400000);
  },
};
