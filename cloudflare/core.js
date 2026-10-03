import { Parser } from 'htmlparser2';
export const normalizeName = value => value.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(w => w && !['inc','incorporated','corp','corporation','ltd','limited'].includes(w)).join(' ');
export function excerpts(html) {
  let hidden = 0; const parts = [];
  const invisible = new Set(['script','style','ix:hidden','ix:header']);
  const parser = new Parser({
    onopentag(name) { if (invisible.has(name)) hidden++; if (['p','div','tr','br','h1','h2','h3'].includes(name)) parts.push('\n'); },
    onclosetag(name) { if (invisible.has(name)) hidden = Math.max(0, hidden-1); },
    ontext(text) { if (!hidden) parts.push(text + ' '); },
  }, {decodeEntities:true});
  parser.end(html);
  const text = parts.join('').replace(/[ \t\r\f\v]+/g,' ').replace(/\n\s*\n/g,'\n').trim();
  if (text.length < 1000) throw new Error('No readable filing text');
  const windows = [[0,7000]];
  for (const heading of ['risk factors','management.{0,12}s discussion','use of proceeds','results of operations','consolidated statements of (?:operations|income|cash flows)']) {
    const matches = [...text.matchAll(new RegExp(heading,'gi'))];
    if (matches.length) { const start=(matches.find(m=>m.index>7000)||matches[0]).index; windows.push([Math.max(0,start-200),start+6500]); }
  }
  const merged=[];
  for(const [start,end] of windows.sort((a,b)=>a[0]-b[0])) {
    if(merged.length && start<=merged.at(-1)[1]) merged.at(-1)[1]=Math.max(end,merged.at(-1)[1]); else merged.push([start,end]);
  }
  return merged.map(([a,b])=>text.slice(a,b)).join('\n\n[Excerpt break]\n\n').slice(0,40000);
}
export function selectFiling(data, name, today=new Date().toISOString().slice(0,10)) {
  const names=[data.name,...(data.formerNames||[]).map(r=>r.name||'')].map(normalizeName);
  if(!names.includes(normalizeName(name))) throw new Error('SEC issuer name differs from the requested company');
  const recent=data.filings.recent, cutoff=new Date(Date.parse(today)-730*86400000).toISOString().slice(0,10);
  const eligible=recent.form.map((_,i)=>Object.fromEntries(Object.entries(recent).map(([k,v])=>[k,v[i]])))
    .filter(f=>['S-1','S-1/A','F-1','F-1/A','424B4'].includes(f.form)&&f.filingDate>=cutoff&&f.filingDate<=today)
    .sort((a,b)=>(b.filingDate+b.accessionNumber).localeCompare(a.filingDate+a.accessionNumber));
  if(!eligible.length) throw new Error('No recent S-1, F-1, or 424B4 found in the SEC recent-filings history');
  const f=eligible[0];
  if(!/^\d{10}-\d{2}-\d{6}$/.test(f.accessionNumber)||! /^[\w.-]+$/.test(f.primaryDocument)) throw new Error('Unexpected SEC document path');
  return f;
}
const tags={
  'Revenue':['RevenueFromContractWithCustomerExcludingAssessedTax','Revenues','SalesRevenueNet'],
  'Net income (loss)':['NetIncomeLoss','ProfitLoss'],
  'Operating cash flow':['NetCashProvidedByUsedInOperatingActivities'],
  'Cash and equivalents':['CashAndCashEquivalentsAtCarryingValue'],
  'Long-term debt (noncurrent)':['LongTermDebtNoncurrent'],
  'Long-term debt (current portion)':['LongTermDebtCurrent'],
};
export function extractFacts(data,filing) {
  if(Number(data.cik)!==Number(filing.cik)) throw new Error('XBRL issuer mismatch');
  const facts=[];
  for(const [label,concepts] of Object.entries(tags)) {
    const found=[];
    for(const tag of concepts) {
      for(const [unit,rows] of Object.entries(data.facts?.['us-gaap']?.[tag]?.units||{})) {
        for(const row of rows) if(row.accn===filing.accession && row.end && typeof row.val==='number' && Number.isFinite(row.val)) {
          found.push({label,value:row.val,unit,period_start:row.start??null,period_end:row.end,filed:row.filed??null,form:row.form??null,tag:`us-gaap:${tag}`,accession:row.accn,source_url:filing.url});
        }
      }
      if(found.length) break;
    }
    const seen=new Set();
    for(const f of found) { const key=JSON.stringify([f.unit,f.period_start,f.period_end,f.value]); if(!seen.has(key)) facts.push(f); seen.add(key); }
  }
  return facts;
}
export function passagesFor(text) {
  const result=[]; let line='';
  for(const word of text.split(/\s+/).filter(Boolean)) {
    if(line && line.length+1+word.length>400) { result.push(line); line=''; }
    line+=(line?' ':'')+word;
  }
  if(line) result.push(line); return result;
}
export function validateJudgment(input,passages) {
  if(!input || (input.score!==null && (!Number.isInteger(input.score)||input.score<1||input.score>10))) throw new Error('Invalid score');
  const result={score:input.score};
  for(const key of ['summary','red_flag','about','limitations','score_reason']) {
    if(typeof input[key]!=='string'||(key==='score_reason'&&!input[key].trim())) throw new Error(`Invalid ${key}`);
    result[key]=input[key];
  }
  for(const key of ['highlights','risks','gaps']) {
    let points=input[key];
    if(typeof points==='string') {
      try { const parsed=JSON.parse(points); if(Array.isArray(parsed)) points=parsed; } catch { /* Normalize older serialized bullets. */ }
      if(typeof points==='string') {
        points=points.split('\n').map(s=>s.trim().replace(/^[•\- ]+/, '')).filter(Boolean);
        if(points.length===1) points=points[0].split(/(?<=[.!?])\s+(?=[A-Z])/);
        if(points.length>5) points=[...points.slice(0,4),points.slice(4).join(' ')];
      }
    }
    if(!Array.isArray(points)||points.length<(key==='gaps'?1:0)||points.length>5||points.some(p=>typeof p!=='string')) throw new Error(`Invalid ${key}`);
    result[key]=points;
  }
  const ids=input.evidence_ids;
  if(!Array.isArray(ids)||ids.length<1||ids.length>4||ids.some(i=>!Number.isInteger(i)||i<1||i>passages.length)) throw new Error('Unknown SEC passage');
  result.evidence=[...new Set(ids)].map(i=>passages[i-1]); return result;
}
export const judgmentSchema={type:'object',properties:{score:{anyOf:[{type:'integer',minimum:1,maximum:10},{type:'null'}]},...Object.fromEntries(['summary','red_flag','about','limitations','score_reason'].map(k=>[k,{type:'string'}])),...Object.fromEntries(['highlights','risks','gaps'].map(k=>[k,{type:'array',items:{type:'string'},minItems:k==='gaps'?1:0,maxItems:5}])),evidence_ids:{type:'array',items:{type:'integer'},minItems:1,maxItems:4}},required:['score','summary','red_flag','about','limitations','score_reason','highlights','risks','gaps','evidence_ids']};
