export type Period = 'since_ipo' | '1m' | '1w' | '1d';
export const periods: {id: Period; label: string}[] = [{id:'since_ipo',label:'Since IPO'},{id:'1m',label:'1 month'},{id:'1w',label:'1 week'},{id:'1d',label:'24 hour'}];
export type Quote = {status:string;price:string|null;as_of?:string;fetched_at?:string;is_real_time?:boolean;source_url?:string;changes?:{as_of:string|null;close?:number;note?:string;items:{period:Period;percent:number|null;from:string|null;base_price:number|null}[]}};
export function changeFor(quote:Quote|undefined,period:Period){return quote?.changes?.items.find(p=>p.period===period);}
export function percentText(value:number){return `${value>0?'+':''}${value.toFixed(2)}%`;}
export function heatClass(quote:Quote|undefined,period:Period){
  const n=changeFor(quote,period)?.percent;
  if(n==null)return 'heat-neutral';
  if(Math.abs(n)<0.005)return 'heat-flat';
  return `heat-${n>0?'up':'down'} heat-level-${Math.abs(n)>=20?3:Math.abs(n)>=5?2:1}`;
}
export function offerText(price?:string|null){return price&&price!=='N/A'?(/^\d+(?:\.\d+)?$/.test(price)?`$${price}`:price):'Not disclosed';}
