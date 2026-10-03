export async function hash(value){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))].map(n=>n.toString(16).padStart(2,'0')).join('');}
export async function rateLimit(env,key,limit,seconds){
  const window=Math.floor(Date.now()/(seconds*1000));
  const row=await env.DB.prepare('INSERT INTO app_limits VALUES (?,1,?) ON CONFLICT(key) DO UPDATE SET used=used+1 WHERE used<? RETURNING used').bind(`${key}:${window}`,(window+1)*seconds*1000,limit).first();
  if(!row)throw Object.assign(new Error('Too many requests. Please try again later.'),{status:429});
}
export async function clientLimit(env,request,scope,limit,seconds){
  const ip=request.headers.get('CF-Connecting-IP')||'local';
  await rateLimit(env,`${scope}:${await hash(ip)}`,limit,seconds);
}
export function dailyBudget(env){
  const cents=Number(env.AI_DAILY_BUDGET_CENTS||0);
  return Number.isSafeInteger(cents)&&cents>=0?cents*10000:0;
}
export async function reserveAI(env,body){
  // Conservative reservation for this fixed text-only Haiku model: one input token
  // per UTF-8 byte plus tool-format overhead, and all possible output tokens.
  // Rates: $1/M input and $5/M output, verified 2026-10-03. No paid server tools.
  if(body.model!=='claude-haiku-4-5-20251001'||body.max_tokens!==4000)throw new Error('AI pricing configuration must be reviewed');
  const bytes=new TextEncoder().encode(JSON.stringify(body)).length;
  if(bytes>180000)throw Object.assign(new Error('Research input is too large.'),{status:422});
  const reserved=bytes+10000+4000*5,limit=dailyBudget(env),day=new Date().toISOString().slice(0,10);
  if(!limit||reserved>limit)throw Object.assign(new Error('New AI research is paused or the daily budget is too low. Saved reports remain available.'),{status:429});
  const row=await env.DB.prepare('INSERT INTO ai_daily_usage(day,reserved_micros,actual_micros,attempts) VALUES (?,?,0,1) ON CONFLICT(day) DO UPDATE SET reserved_micros=reserved_micros+excluded.reserved_micros,attempts=attempts+1 WHERE reserved_micros+excluded.reserved_micros<=? RETURNING day').bind(day,reserved,limit).first();
  if(!row)throw Object.assign(new Error('The daily AI budget has been reached. Saved reports remain available.'),{status:429});
  return {day,reserved};
}
export async function recordAI(env,reservation,usage){
  if(!usage||!Number.isSafeInteger(usage.input_tokens)||!Number.isSafeInteger(usage.output_tokens)||usage.input_tokens<0||usage.output_tokens<0)return;
  const actual=usage.input_tokens+usage.output_tokens*5;
  // Unknown/failed calls keep their full reservation. Never free money on timeout.
  await env.DB.prepare('UPDATE ai_daily_usage SET reserved_micros=reserved_micros+?,actual_micros=actual_micros+? WHERE day=?').bind(actual-reservation.reserved,actual,reservation.day).run();
}
