import { useEffect, useRef, useState } from 'react';
import './App.css';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000';
type IPO = { name: string; ticker: string; date: string; amount: string; status: string };
type ReportedFact = { label: string; value: number; unit: string; period_start: string | null; period_end: string; tag: string; source_url: string };
type Analysis = { reported_facts?: { items: ReportedFact[]; note: string }; score: number | null; about: string; summary: string; red_flag: string; limitations: string; evidence: string[]; sec?: { url?: string; cik?: string; form?: string; filed?: string; note?: string; status?: string } };
const key = (ipo: IPO) => `${ipo.name}|${ipo.ticker}|${ipo.date}`;
const monthKey = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
const monthLabel = (date: Date) => date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
function dateParts(value: string) {
  const match = value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  return match ? { month: `${match[3]}-${match[1].padStart(2, '0')}`, day: Number(match[2]) } : null;
}
function readSaved(): IPO[] {
  try {
    const data: unknown = JSON.parse(localStorage.getItem('ipo-watchlist') || '[]');
    return Array.isArray(data) ? data.filter((item): item is IPO => item && ['name', 'ticker', 'date', 'amount', 'status'].every(field => typeof item[field] === 'string')) : [];
  } catch { return []; }
}

function App() {
  const [months] = useState(() => Array.from({ length: 12 }, (_, i) => { const now = new Date(); return new Date(now.getFullYear(), now.getMonth() - i, 1); }));
  const [month, setMonth] = useState(0);
  const [view, setView] = useState<'discover' | 'research' | 'watchlist'>('discover');
  const [mode, setMode] = useState<'calendar' | 'list'>('calendar');
  const [ipos, setIpos] = useState<IPO[]>([]);
  const [saved, setSaved] = useState<IPO[]>(readSaved);
  const [selected, setSelected] = useState<IPO | null>(null);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [loading, setLoading] = useState(false);
  const [calendarLoading, setCalendarLoading] = useState(true);
  const [calendarError, setCalendarError] = useState('');
  const [freshness, setFreshness] = useState<{updated_at: string; stale: boolean; refresh_failed: boolean} | null>(null);
  const [analysisError, setAnalysisError] = useState('');
  const [storageError, setStorageError] = useState('');
  const [accountOpen, setAccountOpen] = useState(false);
  const [retry, setRetry] = useState(0);
  const requestId = useRef(0);
  const activeMonth = monthKey(months[month]);

  useEffect(() => {
    const controller = new AbortController();
    fetch(`${API_URL}/calendar?month=${activeMonth}`, { signal: controller.signal })
      .then(async res => { if (!res.ok) throw new Error(); const data = await res.json(); if (!Array.isArray(data.ipos)) throw new Error(); return data; })
      .then(data => { if (!controller.signal.aborted) { setIpos(data.ipos); setFreshness(data); } })
      .catch(() => { if (!controller.signal.aborted) setCalendarError('The IPO calendar is unavailable. Please try again.'); })
      .finally(() => { if (!controller.signal.aborted) setCalendarLoading(false); });
    return () => controller.abort();
  }, [activeMonth, retry]);

  function toggleSave(ipo: IPO) {
    const next = saved.some(item => key(item) === key(ipo)) ? saved.filter(item => key(item) !== key(ipo)) : [...saved, ipo];
    setSaved(next);
    try { localStorage.setItem('ipo-watchlist', JSON.stringify(next)); setStorageError(''); }
    catch { setStorageError('Your browser could not save this watchlist. Changes will last only for this session.'); }
  }
  function changeMonth(index: number) {
    if (index !== month) { setMonth(index); setFreshness(null); setIpos([]); setCalendarLoading(true); setCalendarError(''); requestId.current++; setSelected(null); setAnalysis(null); setLoading(false); setAnalysisError(''); }
    setView('discover');
  }
  async function selectIPO(ipo: IPO) {
    const id = ++requestId.current;
    setSelected(ipo); setAnalysis(null); setLoading(true); setAnalysisError('');
    try {
      const params = new URLSearchParams({ ticker: ipo.ticker, amount: ipo.amount, status: ipo.status });
      const response = await fetch(`${API_URL}/analyze/${encodeURIComponent(ipo.name)}?${params}`);
      if (!response.ok) throw new Error();
      const data: Analysis = await response.json();
      if (id === requestId.current) setAnalysis(data);
    } catch { if (id === requestId.current) setAnalysisError('Analysis unavailable. Please try again.'); }
    finally { if (id === requestId.current) setLoading(false); }
  }
  const visible = ipos.filter(ipo => dateParts(ipo.date)?.month === activeMonth);
  const rows = view === 'watchlist' ? saved : visible;
  const days = new Date(months[month].getFullYear(), months[month].getMonth() + 1, 0).getDate();
  const offset = (months[month].getDay() + 6) % 7;
  const isSaved = selected && saved.some(ipo => key(ipo) === key(selected));
  const safeSource = analysis?.sec?.url && /^https:\/\/(www\.)?sec\.gov\//.test(analysis.sec.url) ? analysis.sec.url : null;

  return <div className="app">
    <header className="topbar"><a className="brand" href="/" aria-label="IPO Analyzer home"><span className="brand-mark">↗</span>IPO <span className="brand-divider">/</span> analyzer</a>
      <nav aria-label="Main navigation">{(['discover', 'research', 'watchlist'] as const).map(tab => <button key={tab} aria-current={view === tab ? 'page' : undefined} onClick={() => setView(tab)}>{tab === 'watchlist' ? 'My watchlist' : tab === 'research' ? 'Research' : 'Discover'}{tab === 'watchlist' && saved.length > 0 && <span className="count">{saved.length}</span>}</button>)}</nav>
      <button className="account-button" onClick={() => setAccountOpen(!accountOpen)} aria-expanded={accountOpen} aria-controls="account-panel"><span className="avatar">You</span><span>My workspace</span><span aria-hidden="true">⌄</span></button>
    </header>
    {accountOpen && <section className="account-panel" id="account-panel"><div><h2>Your personal workspace</h2><p>Your watchlist is saved in this browser. Sign-in and syncing across devices are coming later.</p></div><button onClick={() => { setView('watchlist'); setAccountOpen(false); }}>View saved IPOs →</button></section>}
    <div className="shell"><aside className="sidebar"><p className="eyebrow">IPO calendar</p><div className="months">{months.map((date, index) => <button key={monthKey(date)} aria-pressed={month === index} onClick={() => changeMonth(index)}><span>{date.toLocaleDateString('en-US', { month: 'short' })}</span><span>{date.getFullYear()}</span></button>)}</div><div className="sidebar-footer"><span className="eyebrow">Personal workspace</span><p>{saved.length} saved {saved.length === 1 ? 'IPO' : 'IPOs'}<br />Stored on this browser</p></div></aside>
    <main><div className="welcome"><h2>Your next idea starts here.</h2><p>Your watchlist, your research, your next question.</p></div><p className="breadcrumb">Markets / IPOs / {monthLabel(months[month])}</p><div className="page-heading"><h1>{view === 'watchlist' ? 'Your watchlist' : view === 'research' ? 'The research room' : monthLabel(months[month])}</h1><span className="source-label">Nasdaq calendar</span></div><p className="subtitle">{view === 'watchlist' ? 'The companies you’re keeping an eye on.' : view === 'research' ? 'A closer look at the evidence behind each offering.' : 'Explore upcoming and recently priced offerings.'}</p>
    {view === 'discover' && freshness && <p className="freshness" role="status">Nasdaq · Last updated {new Date(freshness.updated_at).toLocaleString()}{freshness.stale && ' · Showing saved data'}{freshness.refresh_failed && ' · Refresh temporarily unavailable'}</p>}
    {storageError && <p className="error" role="alert">{storageError}</p>}
    {view !== 'research' && <><div className="toolbar"><span>{view === 'watchlist' ? `${saved.length} saved companies` : calendarLoading ? 'Loading offerings…' : `${visible.length} offerings`}</span>{view === 'discover' && <div className="segmented">{(['calendar', 'list'] as const).map(item => <button key={item} aria-pressed={mode === item} onClick={() => setMode(item)}>{item === 'calendar' ? 'Calendar' : 'List'}</button>)}</div>}</div>
      {view === 'discover' && calendarError ? <div className="empty" role="alert"><p>{calendarError}</p><button className="primary" onClick={() => { setCalendarLoading(true); setCalendarError(''); setRetry(retry + 1); }}>Try again</button></div> : view === 'discover' && calendarLoading ? <div className="empty" role="status">Loading IPO calendar…</div> : <>
      {view === 'discover' && mode === 'calendar' ? <><section className="calendar" aria-label={monthLabel(months[month])}>{['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(day => <div className="weekday" key={day}>{day}</div>)}{Array.from({ length: offset }, (_, i) => <div className="day blank" key={`blank-${i}`} />)}{Array.from({ length: days }, (_, i) => <div className="day" key={i}><span className="day-number">{i + 1}</span>{visible.filter(ipo => dateParts(ipo.date)?.day === i + 1).map(ipo => <button key={key(ipo)} className="ipo-event" aria-pressed={!!selected && key(selected) === key(ipo)} aria-label={`${ipo.name}, ${ipo.date}`} onClick={() => void selectIPO(ipo)}>{ipo.ticker || ipo.name}</button>)}</div>)}</section>{!visible.length && <p className="empty-note">No offerings were reported for this month.</p>}</> : <section className="ipo-list" aria-label={view === 'watchlist' ? 'Saved IPOs' : 'IPO offerings'}>{rows.length ? rows.map(ipo => <div className="ipo-row" key={key(ipo)}><button className="company-button" onClick={() => void selectIPO(ipo)} aria-pressed={!!selected && key(selected) === key(ipo)}><span className="company-mark">{ipo.name.charAt(0)}</span><span><strong>{ipo.name}</strong><small>{ipo.ticker || 'Ticker pending'} · {ipo.status}</small></span><span className="row-date">{ipo.date}</span></button>{view === 'watchlist' && <button className="remove" aria-label={`Remove ${ipo.name} from watchlist`} onClick={() => toggleSave(ipo)}>×</button>}</div>) : <div className="empty"><h2>{view === 'watchlist' ? 'Keep your next idea close.' : 'No offerings this month.'}</h2><p>{view === 'watchlist' ? 'Select an IPO in Discover and save it to your watchlist.' : 'Choose another month to explore more IPOs.'}</p></div>}</section>}</>}
    </>}
    {selected ? <section className="research-card" aria-label="Selected IPO research"><div className="company-heading"><span className="company-mark">{selected.name.charAt(0)}</span><div><h2>{selected.name}</h2><p>{selected.ticker || 'Ticker pending'} · {selected.status}</p></div><button className="save-button" aria-pressed={!!isSaved} onClick={() => toggleSave(selected)}>{isSaved ? '★ Saved' : '☆ Save'}</button></div><dl className="facts"><div><dt>{selected.status === 'priced' ? 'Priced date' : 'Expected date'}</dt><dd>{selected.date}</dd></div><div><dt>Offering · Nasdaq</dt><dd>{selected.amount || 'Not disclosed'}</dd></div><div><dt>Source</dt><dd>{analysis?.sec?.form || 'SEC filings'}</dd></div></dl>
      {loading && <p className="loading" role="status">Reviewing SEC filing evidence…</p>}{analysisError && <div className="error" role="alert">{analysisError} <button onClick={() => void selectIPO(selected)}>Retry</button></div>}
      {analysis && <div className="analysis"><section className="reported-facts"><h3>Reported facts · SEC</h3>{analysis.sec?.cik && <p className="limitations">Verified issuer CIK: {analysis.sec.cik}</p>}{analysis.reported_facts?.items.map((fact, i) => <div className="reported-fact" key={i}><div><strong>{fact.label}</strong><p>{fact.period_start ? `${fact.period_start} – ${fact.period_end}` : `As of ${fact.period_end}`}</p></div><div><strong>{fact.value.toLocaleString()} {fact.unit}</strong><p>{safeSource && <a href={safeSource} target="_blank" rel="noopener noreferrer">SEC source ↗</a>}</p></div></div>)}<p className="limitations">{analysis.reported_facts?.note || 'Structured financial facts are unavailable for this filing. Missing values are not zero.'}</p></section><div className="assessment"><span className="eyebrow">AI judgment · Filing-based assessment</span><strong>{analysis.score == null ? 'Insufficient evidence to score' : `${analysis.score} / 10`}</strong></div>{analysis.about && <p>{analysis.about}</p>}<h3>AI interpretation</h3><p>{analysis.summary}</p><div className="risk"><h3>What needs a closer look</h3><p>{analysis.red_flag}</p></div>{safeSource && <a className="filing-link" href={safeSource} target="_blank" rel="noopener noreferrer">Read SEC {analysis.sec?.form} · Filed {analysis.sec?.filed} ↗</a>}{analysis.evidence?.length > 0 && <details><summary>Supporting SEC excerpts ({analysis.evidence.length})</summary>{analysis.evidence.map((quote, i) => <blockquote key={i}>{quote}</blockquote>)}</details>}<p className="limitations">{analysis.limitations}</p>{analysis.sec?.status === 'available' && <p className="limitations">{analysis.sec.note}</p>}</div>}
    </section> : <section className="research-placeholder"><span className="company-mark">↗</span><h2>{view === 'research' ? 'Every offering has a story.' : 'Start with a company.'}</h2><p>Select an IPO to explore its offering, SEC evidence, and risks.</p>{view === 'research' && <button className="primary" onClick={() => setView('discover')}>Explore IPOs →</button>}</section>}
    </main><aside className="assistant"><div className="assistant-heading"><h2>✧ IPO assistant</h2><span className="source-label">Coming soon</span></div>{selected && <div className="chat-context"><span className="company-mark">{selected.name.charAt(0)}</span><div><strong>{selected.name}</strong><p>Selected IPO</p></div></div>}<div className="chat-intro"><h3>Ask a better question.</h3><p>A space to explore the business, understand the risks, and follow answers to their sources.</p></div><div className="suggestions" aria-label="Planned example questions"><p>What are the biggest risks? <span>↗</span></p><p>How will they use the proceeds? <span>↗</span></p><p>Explain the business simply. <span>↗</span></p></div><div className="chat-bottom"><label htmlFor="future-chat">Ask about this IPO</label><input id="future-chat" disabled placeholder="Chat is coming soon" /><p>For now, explore the filing-based analysis.</p></div></aside>
    </div></div>;
}
export default App;
