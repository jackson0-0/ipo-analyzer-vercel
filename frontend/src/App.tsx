import { useEffect, useRef, useState } from 'react';
import './App.css';
import ResearchVerdict from './ResearchVerdict';
import { QuoteLabel, PriceHistory } from './Prices';
import { periods, changeFor, percentText, heatClass, offerText, mergeQuotes } from './price-format';
import type { Period, Quote } from './price-format';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000';
type IPO = { name: string; ticker: string; date: string; amount: string; status: string; offer_price?: string | null };
type CalendarData = { quotes?: Record<string, Quote>; ipos: IPO[]; updated_at: string; stale: boolean; refresh_failed: boolean };
type ReportedFact = { label: string; value: number; unit: string; period_start: string | null; period_end: string; tag: string; source_url: string };
export type Analysis = { sections?: Record<'valuation' | 'dilution' | 'use_of_proceeds', {text: string; evidence: string[]}[]>; analysis_updated_at?: string; analysis_checked_at?: string; highlights?: string[]; risks?: string[]; gaps?: string[]; score_reason?: string; reported_facts?: { items: ReportedFact[]; note: string }; score: number | null; about: string; summary: string; red_flag: string; limitations: string; evidence: string[]; sec?: { industry?: string | null; url?: string; cik?: string; form?: string; filed?: string; note?: string; status?: string } };
const key = (ipo: IPO) => `${ipo.name}|${ipo.ticker}|${ipo.date}`;
const monthKey = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
const monthLabel = (date: Date) => date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
function dateParts(value: string) {
  const match = value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  return match ? { month: `${match[3]}-${match[1].padStart(2, '0')}`, day: Number(match[2]) } : null;
}
function App() {
  const [months] = useState(() => Array.from({ length: 12 }, (_, i) => { const now = new Date(); return new Date(now.getFullYear(), now.getMonth() - i, 1); }));
  const [month, setMonth] = useState(0);
  const [mode, setMode] = useState<'calendar' | 'list'>('calendar');
  const [ipos, setIpos] = useState<IPO[]>([]);
  const [selected, setSelected] = useState<IPO | null>(null);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [loading, setLoading] = useState(false);
  const [calendarLoading, setCalendarLoading] = useState(true);
  const [calendarError, setCalendarError] = useState('');
  const [freshness, setFreshness] = useState<{updated_at: string; stale: boolean; refresh_failed: boolean} | null>(null);
  const [analysisError, setAnalysisError] = useState('');
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [retry, setRetry] = useState(0);
  const [quotes, setQuotes] = useState<Record<string, Quote>>({});
  const [pricePeriod, setPricePeriod] = useState<Period>('since_ipo');
  const calendarCache = useRef<Record<string, CalendarData>>({});
  const analysisCache = useRef<Record<string, Analysis>>({});
  const requestId = useRef(0);
  const activeMonth = monthKey(months[month]);

  useEffect(() => {
    const controller = new AbortController();
    fetch(`${API_URL}/calendar?month=${activeMonth}`, { signal: controller.signal })
      .then(async res => { if (!res.ok) throw new Error(); const data = await res.json(); if (!Array.isArray(data.ipos)) throw new Error(); return data; })
      .then(data => { if (!controller.signal.aborted) { calendarCache.current[activeMonth] = data; setQuotes(prev => mergeQuotes(prev, data.quotes)); setIpos(data.ipos); setFreshness(data); } })
      .catch(() => { if (!controller.signal.aborted) setCalendarError('The IPO calendar is unavailable. Please try again.'); })
      .finally(() => { if (!controller.signal.aborted) setCalendarLoading(false); });
    return () => controller.abort();
  }, [activeMonth, retry]);

  useEffect(() => {
    const controller = new AbortController();
    const queue = months.slice(1).map(monthKey);
    // Warm calendar data only; research keeps its separate daily AI budget.
    async function preload() {
      while (queue.length && !controller.signal.aborted) {
        const target = queue.shift()!;
        try {
          const response = await fetch(`${API_URL}/calendar?month=${target}`, {signal: controller.signal});
          if (!response.ok) continue;
          const data: CalendarData = await response.json();
          if (!controller.signal.aborted && Array.isArray(data.ipos)) calendarCache.current[target] = data;
        } catch { /* A failed preload can retry when the month is opened. */ }
      }
    }
    void Promise.all([preload(), preload()]);
    return () => controller.abort();
  }, [months]);

  useEffect(() => {
    const controller = new AbortController();
    const companies = [...new Map([...ipos, ...(selected ? [selected] : [])].map(ipo => [key(ipo), ipo])).values()];
    let running = false;
    async function refreshPrices() {
      if (running || controller.signal.aborted) return;
      running = true;
      const queue = [...companies];
      await Promise.all(Array.from({ length: 3 }, async () => {
        while (queue.length && !controller.signal.aborted) {
          const ipo = queue.shift()!;
          if (!ipo.ticker) { setQuotes(prev => ({...prev, [key(ipo)]: {status:'unavailable',price:null}})); continue; }
          try {
            const params = new URLSearchParams({company:ipo.name,status:ipo.status,offer_price:ipo.offer_price || '',date:ipo.date});
            const response = await fetch(`${API_URL}/quote/${encodeURIComponent(ipo.ticker)}?${params}`, {signal:controller.signal});
            if (!response.ok) throw new Error();
            const data: Quote = await response.json();
            if (!controller.signal.aborted) setQuotes(prev => mergeQuotes(prev, {[key(ipo)]:data}));
          } catch { if (!controller.signal.aborted) setQuotes(prev => ({...prev, [key(ipo)]:{status:'unavailable',price:null}})); }
        }
      }));
      running = false;
    }
    void refreshPrices();
    const timer = setInterval(() => { if (!document.hidden) void refreshPrices(); }, 300000);
    return () => {controller.abort(); clearInterval(timer);};
  }, [ipos, selected]);

  function priceDescription(ipo: IPO) {
    const q = quotes[key(ipo)], change = changeFor(q, pricePeriod);
    const label = periods.find(p => p.id === pricePeriod)!.label;
    if (!q) return 'Loading price change…';
    return change?.percent == null ? `${label}: ${ipo.status === 'upcoming' ? 'not trading yet' : 'not enough price history'}` : `${label}: ${percentText(change.percent)} through ${q.changes?.as_of} close, from ${change.from}${q.stale ? "; saved price, refreshing" : ""}. Unadjusted for splits and dividends.`;
  }
  function changeMonth(index: number) {
    if (index !== month) { const cached = calendarCache.current[monthKey(months[index])]; setMonth(index); if (cached?.quotes) setQuotes(prev => mergeQuotes(prev, cached.quotes)); setFreshness(cached || null); setIpos(cached?.ipos || []); setCalendarLoading(!cached); setCalendarError(''); requestId.current++; setSelected(null); setAnalysis(null); setLoading(false); setAnalysisError(''); }
  }
  async function selectIPO(ipo: IPO) {
    const id = ++requestId.current;
    const researchKey = JSON.stringify([ipo.name, ipo.ticker, ipo.amount, ipo.status]);
    const cached = analysisCache.current[researchKey];
    setSelected(ipo); setAnalysis(cached || null); setLoading(!cached); setAnalysisError('');
    if (cached) return;
    try {
      const params = new URLSearchParams({ ticker: ipo.ticker, amount: ipo.amount, status: ipo.status });
      const response = await fetch(`${API_URL}/analyze/${encodeURIComponent(ipo.name)}?${params}`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.detail || 'Analysis unavailable. Please try again.');
      analysisCache.current[researchKey] = data;
      if (id === requestId.current) setAnalysis(data);
    } catch (error) { if (id === requestId.current) setAnalysisError(error instanceof Error ? error.message : 'Analysis unavailable. Please try again.'); }
    finally { if (id === requestId.current) setLoading(false); }
  }
  const visible = ipos.filter(ipo => dateParts(ipo.date)?.month === activeMonth);
  const rows = visible;
  const days = new Date(months[month].getFullYear(), months[month].getMonth() + 1, 0).getDate();
  const offset = (months[month].getDay() + 6) % 7;
  const safeSource = analysis?.sec?.url && /^https:\/\/(www\.)?sec\.gov\//.test(analysis.sec.url) ? analysis.sec.url : null;

  return <div className="app">
    <header className="topbar"><a className="brand" href="/" aria-label="IPO Analyzer home"><span className="brand-mark">↗</span>IPO <span className="brand-divider">/</span> analyzer</a>
    </header>
    <div className="shell"><aside className="sidebar"><p className="eyebrow">IPO calendar</p><div className="months">{months.map((date, index) => <button key={monthKey(date)} aria-pressed={month === index} onClick={() => changeMonth(index)}><span>{date.toLocaleDateString('en-US', { month: 'short' })}</span><span>{date.getFullYear()}</span></button>)}</div></aside>
    <main><div className="welcome"><h2>Research upcoming IPOs.</h2><p>Browse IPOs, compare prices, and review SEC filings.</p></div><p className="breadcrumb">Markets / IPOs / {monthLabel(months[month])}</p><div className="page-heading"><h1>{monthLabel(months[month])}</h1><span className="source-label">Nasdaq calendar</span></div><p className="subtitle">Explore upcoming and recently priced offerings.</p>
    {freshness && <p className="freshness" role="status">Nasdaq · Last updated {new Date(freshness.updated_at).toLocaleString()}{freshness.stale && ' · Showing saved data'}{freshness.refresh_failed && ' · Refresh temporarily unavailable'}</p>}
    <><div className="toolbar"><span>{calendarLoading ? 'Loading offerings…' : `${visible.length} offerings`}</span>{<div className="segmented">{(['calendar', 'list'] as const).map(item => <button key={item} aria-pressed={mode === item} onClick={() => setMode(item)}>{item === 'calendar' ? 'Calendar' : 'List'}</button>)}</div>}</div>
      {<div className="heatmap-controls"><div className="segmented" role="group" aria-label="Price change period">{periods.map(p => <button key={p.id} aria-pressed={pricePeriod === p.id} onClick={() => setPricePeriod(p.id)}>{p.label}</button>)}</div><div className="heatmap-scale" aria-label="Price change color scale"><span>−20% or less</span><span className="heatmap-gradient" aria-hidden="true" /><span>+20% or more</span></div><p>{visible.some(ipo => ipo.ticker && !quotes[key(ipo)]) ? 'Loading price colors… · ' : ''}Saved price colors appear first and refresh automatically · Daily closing prices · 24 hour uses the previous trading close · Gray = unchanged or unavailable · Unadjusted for splits and dividends</p></div>}
      {calendarError ? <div className="empty" role="alert"><p>{calendarError}</p><button className="primary" onClick={() => { setCalendarLoading(true); setCalendarError(''); setRetry(retry + 1); }}>Try again</button></div> : calendarLoading ? <div className="empty" role="status">Loading IPO calendar…</div> : <>
      {mode === 'calendar' ? <><section className="calendar" aria-label={monthLabel(months[month])}>{['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(day => <div className="weekday" key={day}>{day}</div>)}{Array.from({ length: offset }, (_, i) => <div className="day blank" key={`blank-${i}`} />)}{Array.from({ length: days }, (_, i) => <div className="day" key={i}><span className="day-number">{i + 1}</span>{visible.filter(ipo => dateParts(ipo.date)?.day === i + 1).map(ipo => <button key={key(ipo)} className={`ipo-event ${heatClass(quotes[key(ipo)], pricePeriod)}`} title={`IPO offer: ${offerText(ipo.offer_price)}. Latest quote: ${quotes[key(ipo)]?.price || (ipo.status === 'upcoming' ? 'Not trading yet' : 'Unavailable')}. ${priceDescription(ipo)}`} aria-pressed={!!selected && key(selected) === key(ipo)} aria-label={`${ipo.name}, ${ipo.date}. ${priceDescription(ipo)}`} onClick={() => void selectIPO(ipo)}>{ipo.ticker || ipo.name}</button>)}</div>)}</section>{!visible.length && <p className="empty-note">No offerings were reported for this month.</p>}</> : <section className="ipo-list" aria-label="IPO offerings">{rows.length ? rows.map(ipo => <div className="ipo-row" key={key(ipo)}><button className="company-button" onClick={() => void selectIPO(ipo)} aria-pressed={!!selected && key(selected) === key(ipo)}><span className="company-mark">{ipo.name.charAt(0)}</span><span><strong>{ipo.name}</strong><small>{ipo.ticker || 'Ticker pending'} · {ipo.status}</small><span className="list-prices">IPO {offerText(ipo.offer_price)} · Latest <QuoteLabel quote={quotes[key(ipo)]} upcoming={ipo.status === 'upcoming'} /><span className="list-change">{priceDescription(ipo)}</span></span></span><span className="row-date">{ipo.date}</span></button></div>) : <div className="empty"><h2>No offerings this month.</h2><p>Choose another month to explore more IPOs.</p></div>}</section>}</>}
    </>
    {selected ? <section className="research-card" aria-label="Selected IPO research"><div className="company-heading"><span className="company-mark">{selected.name.charAt(0)}</span><div><h2>{selected.name}</h2><p>{selected.ticker || 'Ticker pending'} · {selected.status}</p></div></div><dl className="facts"><div><dt>{selected.status === 'priced' ? 'Priced date' : 'Expected date'}</dt><dd>{selected.date}</dd></div><div><dt>Offering · Nasdaq</dt><dd>{selected.amount || 'Not disclosed'}</dd></div><div><dt>IPO offer price</dt><dd>{offerText(selected.offer_price)}</dd></div><div><dt>Latest trading price</dt><dd><QuoteLabel quote={quotes[key(selected)]} upcoming={selected.status === 'upcoming'} /></dd></div></dl>
      {quotes[key(selected)]?.as_of && <p className="freshness">Nasdaq quote · {quotes[key(selected)].as_of} · {quotes[key(selected)].is_real_time ? 'Cached up to 5 minutes' : 'Delayed or closing quote'} · <a href={quotes[key(selected)].source_url} target="_blank" rel="noopener noreferrer">Source ↗</a></p>}
      <PriceHistory quote={quotes[key(selected)]} />
      {analysis?.analysis_checked_at && <p className="freshness">Saved SEC research · Last checked {new Date(analysis.analysis_checked_at).toLocaleString()}</p>}
      {loading && <p className="loading" role="status">Loading research… Saved reports load first; a first-time report takes longer.</p>}{analysisError && <div className="error" role="alert">{analysisError} <button onClick={() => void selectIPO(selected)}>Retry</button></div>}
      {analysis && <ResearchVerdict analysis={analysis} source={safeSource} />}
    </section> : <section className="research-placeholder"><span className="company-mark">↗</span><h2>Start with a company.</h2><p>Select an IPO to explore its offering, SEC evidence, and risks.</p></section>}
    </main><aside id="ipo-assistant" aria-label="IPO assistant" className={`assistant${assistantOpen ? ' assistant-open' : ''}`} onKeyDown={event => { if (event.key === 'Escape') { setAssistantOpen(false); document.getElementById('assistant-toggle')?.focus(); } }}><div className="assistant-heading"><h2>✧ IPO assistant</h2><span className="source-label">Coming soon</span></div>{selected && <div className="chat-context"><span className="company-mark">{selected.name.charAt(0)}</span><div><strong>{selected.name}</strong><p>Selected IPO</p></div></div>}<div className="chat-intro"><h3>Questions about an IPO?</h3><p>Chat will let you ask about a company and find answers in its SEC filings.</p></div><div className="suggestions" aria-label="Planned example questions"><p>What are the biggest risks? <span>↗</span></p><p>How will they use the proceeds? <span>↗</span></p><p>Explain the business simply. <span>↗</span></p></div><div className="chat-bottom"><label htmlFor="future-chat">Ask about this IPO</label><input id="future-chat" disabled placeholder="Chat is coming soon" /><p>You can read the company’s research below the calendar.</p></div></aside>
    </div><button id="assistant-toggle" className="assistant-toggle" aria-expanded={assistantOpen} aria-controls="ipo-assistant" onClick={() => setAssistantOpen(!assistantOpen)}>{assistantOpen ? 'Close assistant ×' : '✧ IPO assistant'}</button></div>;
}
export default App;
