import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {normalizeName,excerpts,selectFiling,extractFacts,validateJudgment} from './core.js';
import worker,{calendar} from './worker.js';
function env() {
 const db=new DatabaseSync(':memory:'); db.exec(readFileSync(new URL('./migrations/0001_initial.sql',import.meta.url),'utf8'));
 db.exec(readFileSync(new URL('./migrations/0002_background_research.sql',import.meta.url),'utf8'));
 return {DB:{prepare(sql){return {all:async()=>({results:db.prepare(sql).all()}),bind(...args){return {first:async()=>db.prepare(sql).get(...args),run:async()=>db.prepare(sql).run(...args)}}}}},db};
}
test('Names normalize suffixes without fuzzy matching',()=>{
 assert.equal(normalizeName('Example, Inc.'),'example'); assert.notEqual(normalizeName('Example One'),normalizeName('Example Two'));
});
test('Hidden XBRL and scripts excluded; later risk sections sampled',()=>{
 const result=excerpts('<ix:header><ix:hidden>PRIVATE HIDDEN</ix:hidden></ix:header><script>BAD SCRIPT</script><p>'+('intro '.repeat(2000))+'</p><h2>Risk factors</h2><p>Actual material risk here.</p>');
 assert.ok(!result.includes('HIDDEN'));assert.ok(!result.includes('BAD SCRIPT'));assert.ok(result.includes('Actual material risk'));
});
const issuer={name:'Example Inc',filings:{recent:{form:['S-1','424B4','424B4'],filingDate:['2026-09-01','2026-09-20','2027-01-01'],accessionNumber:['0000000001-26-000001','0000000001-26-000002','0000000001-27-000001'],primaryDocument:['a.htm','b.htm','future.htm']}}};
test('Filing verifies company, date and path',()=>{
 assert.equal(selectFiling(issuer,'Example','2026-10-01').primaryDocument,'b.htm');
 assert.throws(()=>selectFiling(issuer,'Other','2026-10-01'),/differs/);
 const bad=structuredClone(issuer);bad.filings.recent.primaryDocument[1]='../../bad';assert.throws(()=>selectFiling(bad,'Example','2026-10-01'),/path/);
});
test('Facts require exact issuer and accession, preserving periods',()=>{
 const filing={cik:'1',accession:'abc',url:'https://www.sec.gov/a'};
 const data={cik:1,facts:{'us-gaap':{Revenues:{units:{USD:[{accn:'abc',end:'2025-12-31',val:100},{accn:'other',end:'2025-12-31',val:999},{accn:'abc',end:'2024-12-31',val:50},{accn:'abc',end:'2025-12-31',val:true}]}}}}};
 assert.deepEqual(extractFacts(data,filing).map(f=>f.value),[100,50]);assert.throws(()=>extractFacts(data,{...filing,cik:'2'}),/mismatch/);
});
test('Judgment rejects invented evidence and invalid scores',()=>{
 const input={score:4,summary:'S',red_flag:'R',about:'A',limitations:'L',score_reason:'Reason',highlights:'["A point"]',risks:['A risk'],gaps:['A gap'],evidence_ids:[1]};
 assert.deepEqual(validateJudgment(input,['Original quotation']).evidence,['Original quotation']);assert.throws(()=>validateJudgment({...input,evidence_ids:[2]},['Original']),/passage/);assert.throws(()=>validateJudgment({...input,score:12},['Original']),/score/);
});
test('Calendar persists successful refresh and reuses fresh data',async()=>{
 const e=env(),original=globalThis.fetch;let calls=0;
 globalThis.fetch=async()=>{calls++;return Response.json({data:{priced:{rows:[{companyName:'Demo',pricedDate:'9/20/2026'}]}}});};
 try { const a=await calendar(e,'2026-09');const b=await calendar(e,'2026-09');assert.equal(a.ipos[0].name,'Demo');assert.deepEqual(a,b);assert.equal(calls,1); }finally{globalThis.fetch=original;}
});
test('Failed refresh preserves snapshot; valid empty response replaces it',async()=>{
 const e=env(),original=globalThis.fetch;e.db.prepare('INSERT INTO calendar_snapshots VALUES (?,?,?)').run('2026-09','[{"name":"Saved"}]','2026-01-01T00:00:00Z');
 try {
  globalThis.fetch=async()=>Response.json({error:true},{status:503});const stale=await calendar(e,'2026-09');assert.equal(stale.ipos[0].name,'Saved');assert.equal(stale.refresh_failed,true);assert.equal(stale.updated_at,'2026-01-01T00:00:00Z');await assert.rejects(()=>calendar(e,'2026-08'),/unavailable/);
  globalThis.fetch=async()=>Response.json({data:{}});assert.deepEqual((await calendar(e,'2026-09')).ipos,[]);
 }finally{globalThis.fetch=original;}
});
test('API validates month and method',async()=>{
 assert.equal((await worker.fetch(new Request('https://app/api/calendar?month=2026-13'),env())).status,422);assert.equal((await worker.fetch(new Request('https://app/api/calendar',{method:'POST'}),env())).status,405);
});
test('Analysis persists in D1 and the next request does not call AI again',async()=>{
 const {analyze}=await import('./worker.js');const e=env(),original=globalThis.fetch;
 const filing={status:'available',company:'Example Inc',cik:'1',accession:'0000000001-26-000001',excerpts:'A verified source passage.',url:'https://www.sec.gov/Archives/example.htm'};
 e.db.prepare('INSERT INTO worker_cache VALUES (?,?,?)').run('filing-v2:example',JSON.stringify(filing),Date.now()+600000);
 e.db.prepare('INSERT INTO reported_facts VALUES (?,?,?,?)').run(filing.accession,'1',JSON.stringify({items:[],status:'not_reported'}),new Date().toISOString());
 let calls=0;
 globalThis.fetch=async()=>{calls++;return Response.json({content:[{type:'tool_use',name:'submit_judgment',input:{score:5,summary:'Summary',red_flag:'Risk',about:'About',limitations:'Limited',score_reason:'Reason',highlights:['Point'],risks:['Risk'],gaps:['Gap'],evidence_ids:[1]}}]});};
 try {
  const first=await analyze(e,'Example Inc','EX','100','priced');
  assert.deepEqual(await analyze(e,'Example Inc','EX','100','priced'),first);assert.equal(calls,1);assert.equal(e.db.prepare('SELECT COUNT(*) AS n FROM sec_analysis').get().n,1);
 }finally{globalThis.fetch=original;}
});
test('Hourly schedule refreshes exactly twelve months',async()=>{
 const e=env(),original=globalThis.fetch;const months=[];
 globalThis.fetch=async(url)=>{months.push(new URL(url).searchParams.get('date'));return Response.json({data:{}});};
 try {await worker.scheduled({scheduledTime:Date.parse('2026-10-03T09:00:00Z')},e);assert.equal(months.length,12);assert.equal(months[0],'2026-10');assert.equal(months[11],'2025-11');}finally{globalThis.fetch=original;}
});

test('Positives may be empty when the evidence supports none',()=>{
 const input={score:null,summary:'S',red_flag:'R',about:'A',limitations:'L',score_reason:'Reason',highlights:[],risks:['Risk'],gaps:['Gap'],evidence_ids:[1]};
 assert.deepEqual(validateJudgment(input,['Evidence']).highlights,[]);
});
test('Background AI budget is atomically capped at ten',async()=>{
 const {reserveResearchBudget}=await import('./worker.js');const e=env();
 const allowed=await Promise.all(Array.from({length:15},()=>reserveResearchBudget(e)));
 assert.equal(allowed.filter(Boolean).length,10);
});
test('Quotes require matching ticker and company, accepting known security suffixes',async()=>{
 const {parseQuote}=await import('./worker.js');
 const data={symbol:'CHWM',companyName:'Chilwa Minerals Limited American Depository Shares',primaryData:{lastSalePrice:'$5.43',lastTradeTimestamp:'Oct 2, 2026',isRealTime:false}};
 assert.equal(parseQuote(data,'CHWM','Chilwa Minerals Ltd').price,'$5.43');
 assert.throws(()=>parseQuote(data,'OTHER','Chilwa Minerals Ltd'),/symbol/);
 assert.throws(()=>parseQuote({...data,companyName:'Different Company'},'CHWM','Chilwa Minerals Ltd'),/company/);
 assert.throws(()=>parseQuote({...data,primaryData:{...data.primaryData,lastSalePrice:'N/A'}},'CHWM','Chilwa Minerals Ltd'),/price/);
});
test('Price windows preserve dates and reject insufficient pre-listing history',async()=>{
 const {priceChanges}=await import('./prices.js');
 const result=priceChanges([{date:'2026-09-01',close:5},{date:'2026-09-24',close:8},{date:'2026-09-30',close:9},{date:'2026-10-01',close:10}],'4','09/01/2026');
 assert.deepEqual(result.items.map(i=>[i.period,i.percent===null?null:Math.round(i.percent)]),[['since_ipo',150],['1m',100],['1w',25],['1d',11]]);
 const recent=priceChanges([{date:'2026-10-01',close:6.6},{date:'2026-10-02',close:5.43}],'6','10/01/2026');
 assert.equal(recent.items.find(i=>i.period==='1m').percent,null);assert.equal(recent.items.find(i=>i.period==='1w').percent,null);
 assert.equal(priceChanges([{date:'2026-10-01',close:10}],'8 - 10','10/01/2026').items[0].percent,null);
});
test('Background scheduler saves research without a user opening a company',async()=>{
 const {refreshBackground}=await import('./worker.js');const e=env(),original=globalThis.fetch;
 const ipo={name:'Example Inc',ticker:'EX',amount:'100',status:'upcoming',date:'10/07/2026',offer_price:'10'};
 const filing={status:'available',company:'Example Inc',industry:'Test industry',cik:'1',accession:'0000000001-26-000001',excerpts:'A verified source passage.',url:'https://www.sec.gov/Archives/example.htm'};
 e.db.prepare('INSERT INTO calendar_snapshots VALUES (?,?,?)').run('2026-10',JSON.stringify([ipo]),new Date().toISOString());
 e.db.prepare('INSERT INTO worker_cache VALUES (?,?,?)').run('filing-v2:example',JSON.stringify(filing),Date.now()+600000);
 e.db.prepare('INSERT INTO reported_facts VALUES (?,?,?,?)').run(filing.accession,'1',JSON.stringify({items:[],status:'not_reported'}),new Date().toISOString());
 let calls=0;globalThis.fetch=async()=>{calls++;return Response.json({content:[{type:'tool_use',name:'submit_judgment',input:{score:null,summary:'Summary',red_flag:'Risk',about:'About',limitations:'Limited',score_reason:'Reason',highlights:[],risks:['Risk'],gaps:['Gap'],evidence_ids:[1]}}]});};
 try{
  await refreshBackground(e);assert.equal(e.db.prepare('SELECT COUNT(*) AS n FROM analysis_index').get().n,1);assert.equal(e.db.prepare('SELECT status FROM research_jobs').get().status,'ready');assert.equal(e.db.prepare('SELECT used FROM research_budget').get().used,1);
  const response=await worker.fetch(new Request('https://app/api/analyze/Example%20Inc?ticker=EX&amount=100&status=upcoming'),e);
  assert.equal((await response.json()).sec.industry,'Test industry');assert.equal(calls,1);
  await refreshBackground(e);assert.equal(calls,1);
 }finally{globalThis.fetch=original;}
});
