import { periods, changeFor, percentText } from './price-format';
import type { Quote } from './price-format';
export function QuoteLabel({quote,upcoming=false}:{quote?:Quote;upcoming?:boolean}){
  if(upcoming)return <>Not trading yet</>;
  if(!quote)return <>Loading…</>;
  return <>{quote.status==='available'?quote.price:'Unavailable'}</>;
}
export function PriceHistory({quote}:{quote?:Quote}){
  return <section className="research-section price-history"><h3>Price changes</h3><div className="price-periods">{periods.map(p=>{const change=changeFor(quote,p.id);return <div key={p.id}><span>{p.label}</span><strong className={change?.percent==null?'':change.percent>=0?'price-up':'price-down'}>{change?.percent==null?'—':percentText(change.percent)}</strong><small>{change?.from?`From ${change.from}`:'Not enough history'}</small></div>;})}</div><p className="limitations">{quote?.changes?.as_of?`Through ${quote.changes.as_of} close. `:''}Since IPO compares with the offer price. Other periods compare closing prices; 24 hour uses the previous trading close, not a rolling 24-hour window. Unadjusted for splits and dividends.</p></section>;
}
