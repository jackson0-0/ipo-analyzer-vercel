import type { Analysis } from './App';

export default function ResearchVerdict({ analysis, source }: { analysis: Analysis; source: string | null }) {
  const available = analysis.sec?.status === 'available';
  const reason = analysis.score_reason || analysis.limitations;
  const groups = [
    { title: 'What stands out', points: analysis.highlights?.length ? analysis.highlights : [analysis.summary] },
    { title: 'Main risk', points: analysis.risks?.length ? analysis.risks : [analysis.red_flag] },
    { title: 'What’s still unknown', points: analysis.gaps?.length ? analysis.gaps : [analysis.limitations] },
  ];
  return <div className="analysis verdict-layout">
    <section className="verdict-hero" aria-label="Research verdict">
      <div className="verdict-copy">
        <span className="eyebrow">IPO overview</span>
        <h2>{analysis.score != null ? 'IPO at a glance' : available ? 'Not enough information to rate' : 'We couldn’t retrieve the filing'}</h2>
        <p>{reason}</p>
      </div>
      {analysis.score != null && <div className="verdict-score" aria-label={`AI assessment ${analysis.score} out of 10`}><div><strong>{analysis.score}</strong><span> / 10</span></div><small>AI score</small></div>}
    </section>
    {available && <div className="verdict-points">{groups.map((group, index) => <section className="verdict-point" key={group.title}>
      <span className="verdict-number">0{index + 1}</span>
      <div><h3>{group.title}</h3><p>{group.points[0] || 'The available filing sections don’t cover this.'}</p>
        {group.points.length > 1 && <details><summary>More points ({group.points.length - 1})</summary><ul className="analysis-bullets">{group.points.slice(1).map((point, i) => <li key={i}>{point}</li>)}</ul></details>}
      </div>
    </section>)}</div>}
    {analysis.score != null && <details className="verdict-explanation"><summary>What does the score mean?</summary><p className="limitations">Higher scores reflect a stronger business assessment based on the filing sections reviewed. The score is an AI judgment—not a forecast of the share price.</p></details>}
    {analysis.about && <details><summary>What the company does</summary><p>{analysis.about}</p></details>}
    <details><summary>Financial figures from the filing ({analysis.reported_facts?.items.length || 0})</summary>
      {analysis.reported_facts?.items.map((fact, i) => <div className="reported-fact" key={i}><div><strong>{fact.label}</strong><p>{fact.period_start ? `${fact.period_start} – ${fact.period_end}` : `As of ${fact.period_end}`}</p></div><div><strong>{fact.value.toLocaleString()} {fact.unit}</strong>{source && <p><a href={source} target="_blank" rel="noopener noreferrer">SEC source ↗</a></p>}</div></div>)}
      <p className="limitations">{analysis.reported_facts?.note || 'Structured financial facts are unavailable for this filing. Missing values are not zero.'}</p>
    </details>
    {analysis.evidence?.length > 0 && <details><summary>Passages used in the analysis ({analysis.evidence.length})</summary>{analysis.evidence.map((quote, i) => <blockquote key={i}>{quote}</blockquote>)}</details>}
    <details><summary>What this review doesn’t cover</summary><p>{analysis.limitations}</p>{analysis.sec?.cik && <p className="limitations">Verified issuer CIK: {analysis.sec.cik}</p>}{analysis.sec?.note && <p className="limitations">{analysis.sec.note}</p>}</details>
    {source && <a className="filing-link" href={source} target="_blank" rel="noopener noreferrer">Read SEC {analysis.sec?.form} · Filed {analysis.sec?.filed} ↗</a>}
  </div>;
}
