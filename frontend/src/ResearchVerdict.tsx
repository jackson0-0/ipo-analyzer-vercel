import type { Analysis } from './App';

export default function ResearchVerdict({ analysis, source }: { analysis: Analysis; source: string | null }) {
  const available = analysis.sec?.status === 'available';
  const positives = analysis.highlights || [];
  const risks = analysis.risks ?? [analysis.red_flag];
  const gaps = analysis.gaps || [];
  const facts = analysis.reported_facts?.items || [];
  return <div className="analysis verdict-layout">
    <section className="verdict-hero" aria-label="Company overview">
      <div className="verdict-copy">
        <span className="eyebrow">Company overview</span>
        <h2>{available ? 'What the company does' : 'Filing unavailable'}</h2>
        <p>{analysis.about || analysis.summary}</p>
        <p className="industry-label"><strong>Sector / industry</strong> {analysis.sec?.industry || 'Not available from SEC'}{analysis.sec?.industry && <small>SEC classification</small>}</p>
      </div>
      {analysis.score != null && <div className="verdict-score" aria-label={`AI assessment ${analysis.score} out of 10`}><div><strong>{analysis.score}</strong><span> / 10</span></div><small>AI score</small></div>}
    </section>
    <section className="research-section" aria-label="Assessment"><h3>{analysis.score != null ? 'Why this score' : 'Why there is no score'}</h3><p>{analysis.score_reason || analysis.limitations}</p>
      {analysis.score != null && <p className="limitations">Higher scores reflect stronger fundamentals in the sections reviewed. This is an AI assessment, not a share-price forecast.</p>}
    </section>
    {available && <div className="research-balance">
      <section className="research-section"><h3>Positives</h3>{positives.length ? <ul className="analysis-bullets">{positives.map((point, i) => <li key={i}>{point}</li>)}</ul> : <p>No clear positives were supported by the sections reviewed.</p>}</section>
      <section className="research-section"><h3>Risks &amp; concerns</h3>{risks.length ? <ul className="analysis-bullets">{risks.filter(Boolean).map((point, i) => <li key={i}>{point}</li>)}</ul> : <p>No specific business risks could be verified from these excerpts. This does not establish that the IPO is low risk.</p>}</section>
    </div>}
    <section className="research-section"><h3>Reported financials</h3>
      {facts.length ? facts.map((fact, i) => <div className="reported-fact" key={i}><div><strong>{fact.label}</strong><p>{fact.period_start ? `${fact.period_start} to ${fact.period_end}` : `As of ${fact.period_end}`}</p></div><div><strong>{fact.value.toLocaleString()} {fact.unit}</strong>{source && <p><a href={source} target="_blank" rel="noopener noreferrer">SEC source ↗</a></p>}</div></div>) : <p>No verified financial figures are available in the structured data for this filing. This does not mean the company has no revenue or cash.</p>}
      {facts.length > 0 && <p className="limitations">Figures come from this filing’s standard SEC financial fields. Check the dates and units before comparing them.</p>}
    </section>
    <section className="research-section"><h3>Information gaps</h3>
      {gaps.length > 0 && <ul className="analysis-bullets">{gaps.map((point, i) => <li key={i}>{point}</li>)}</ul>}
      {analysis.limitations && <p className="limitations">{analysis.limitations}</p>}
      <p className="limitations">This review uses selected SEC excerpts, not the full filing. The assessment does not use the separately displayed market prices, news, analyst forecasts, or peer comparisons. Sector labels reflect the SEC industry classification; a SPAC may not yet have a target industry.</p>
    </section>
    {analysis.evidence?.length > 0 && <details><summary>Supporting SEC excerpts ({analysis.evidence.length})</summary>{analysis.evidence.map((quote, i) => <blockquote key={i}>{quote}</blockquote>)}</details>}
    {source && <a className="filing-link" href={source} target="_blank" rel="noopener noreferrer">Read SEC {analysis.sec?.form} · Filed {analysis.sec?.filed} ↗</a>}
  </div>;
}
