export function priceNumber(value){
  if(typeof value!=='string'||!/^\$?[0-9,]+(?:\.[0-9]+)?$/.test(value.trim()))return null;
  const n=Number(value.replace(/[$,]/g,''));return Number.isFinite(n)&&n>0?n:null;
}
export function marketDate(value){
  const m=String(value).match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if(!m)return null;
  const iso=`${m[3]}-${m[1].padStart(2,'0')}-${m[2].padStart(2,'0')}`;
  const date=new Date(iso);return Number.isFinite(date.getTime())&&date.toISOString().slice(0,10)===iso?iso:null;
}
export function historyRows(data,ticker){
  if(data?.symbol?.toUpperCase()!==ticker)throw new Error('History symbol mismatch');
  return (data.tradesTable?.rows||[]).map(r=>({date:marketDate(r.date),close:priceNumber(r.close)})).filter(r=>r.date&&r.close&&r.date<=new Date().toISOString().slice(0,10)).sort((a,b)=>a.date.localeCompare(b.date));
}
export function priceChanges(rows,offer,listing){
  const listingDate=marketDate(listing);
  const eligible=listingDate?rows.filter(r=>r.date>=listingDate):rows;
  const latest=eligible.at(-1);
  if(!latest)return {as_of:null,items:[]};
  const at=Date.parse(latest.date),week=new Date(at-7*86400000).toISOString().slice(0,10);
  const d=new Date(at),previousMonth=new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth(),0));
  previousMonth.setUTCDate(Math.min(d.getUTCDate(),previousMonth.getUTCDate()));
  const month=previousMonth.toISOString().slice(0,10);
  const prior=target=>{
    if(!listingDate||target<listingDate)return null;
    const row=eligible.filter(r=>r.date<=target).at(-1);
    return row&&Date.parse(target)-Date.parse(row.date)<=7*86400000?row:null;
  };
  const original=priceNumber(offer);
  const bases=[['since_ipo','Since IPO',original&&listingDate&&listingDate<=latest.date?{close:original,date:listingDate}:null],['1m','1 month',prior(month)],['1w','1 week',prior(week)],['1d','1 day',eligible.at(-2)||null]];
  return {as_of:latest.date,close:latest.close,items:bases.map(([period,label,base])=>({period,label,percent:base?(latest.close/base.close-1)*100:null,from:base?.date||null,base_price:base?.close||null})),note:'Unadjusted price changes through the latest available close. Excludes dividends; stock splits can distort comparisons. Since IPO uses the offer price, not the first trade.'};
}
