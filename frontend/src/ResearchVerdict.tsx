import type { Analysis } from './App';

function preview(text: string, limit = 190) {
  if (text.length <= limit) return text;
  const cut = text.slice(0, limit);
  return `${cut.slice(0, cut.lastIndexOf(' '))}…`;
}

export default function ResearchVerdict({ analysis, source }: { analysis: Analysis; source: string | null }) {
  const available = analysis.sec?.status === 'available';
  const reason = analysis.score_reason || analysis.limitations;
  const groups = [
    { title: 'Key takeaway', tag: 'Assessment', points: analysis.highlights?.length ? analysis.highlights : [analysis.summary] },
    { title: 'Risk to examine', tag: 'Risk', points: analysis.risks?.length ? analysis.risks : [analysis.red_flag] },
    { title: 'What to investigate next', tag: 'Evidence gap', points: analysis.gaps?.length ? analysis.gaps : [analysis.limitations] },
  ];
  return <div className="analysis verdict-layout">
    <section className="verdict-hero" aria-label="Research verdict">
      <div className="verdict-copy">
        <span className="eyebrow">Research verdict · AI interpretation</span>
        <h2>{analysis.score != null ? 'Fundamentals assessment' : available ? 'Further evidence needed' : 'Filing unavailable'}</h2>
        <p>{preview(reason)}</p>
        <span className="verdict-badge">{analysis.score != null ? 'Qualitative AI assessment' : available ? 'Unscored · See explanation below' : 'SEC source not verified'}</span>
      </div>
      {analysis.score != null && <div className="verdict-score" aria-label={`AI assessment ${analysis.score} out of 10`}><div><strong>{analysis.score}</strong><span> / 10</span></div><small>AI assessment</small></div>}
    </section>
    {available && <div className="verdict-points">{groups.map((group, index) => <section className="verdict-point" key={group.title}>
      <span className="verdict-number">0{index + 1}</span>
      <div><h3>{group.title}</h3><p>{preview(group.points[0] || 'Not covered in the available evidence.')}</p>
        {(group.points.length > 1 || (group.points[0]?.length || 0) > 190) && <details><summary>Read full details{group.points.length > 1 ? ` (${group.points.length})` : ''}</summary><ul className="analysis-bullets">{group.points.map((point, i) => <li key={i}>{point}</li>)}</ul></details>}
      </div><span className="verdict-tag">{group.tag}</span>
    </section>)}</div>}
    <details className="verdict-explanation"><summary>{analysis.score == null ? 'Why is there no score?' : 'Why this score?'}</summary><p>{reason}</p>{analysis.score != null && <p className="limitations">This is a qualitative AI judgment from selected filing evidence, not a standardized rating or a prediction of investment returns.</p>}</details>
    {analysis.about && <details><summary>About the company & offering</summary><p>{analysis.about}</p></details>}
    <details><summary>Reported financial facts · SEC ({analysis.reported_facts?.items.length || 0})</summary>
      {analysis.reported_facts?.items.map((fact, i) => <div className="reported-fact" key={i}><div><strong>{fact.label}</strong><p>{fact.period_start ? `${fact.period_start} – ${fact.period_end}` : `As of ${fact.period_end}`}</p></div><div><strong>{fact.value.toLocaleString()} {fact.unit}</strong>{source && <p><a href={source} target="_blank" rel="noopener noreferrer">SEC source ↗</a></p>}</div></div>)}
      <p className="limitations">{analysis.reported_facts?.note || 'Structured financial facts are unavailable for this filing. Missing values are not zero.'}</p>
    </details>
    {analysis.evidence?.length > 0 && <details><summary>Supporting SEC excerpts ({analysis.evidence.length})</summary>{analysis.evidence.map((quote, i) => <blockquote key={i}>{quote}</blockquote>)}</details>}
    <details><summary>Source coverage & limitations</summary><p>{analysis.limitations}</p>{analysis.sec?.cik && <p className="limitations">Verified issuer CIK: {analysis.sec.cik}</p>}{analysis.sec?.note && <p className="limitations">{analysis.sec.note}</p>}</details>
    {source && <a className="filing-link" href={source} target="_blank" rel="noopener noreferrer">Read SEC {analysis.sec?.form} · Filed {analysis.sec?.filed} ↗</a>}
  </div>;
}
