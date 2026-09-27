import { useState, useEffect, useRef } from "react";
import "./App.css";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:8000";

function App() {
  const [ipos, setIpos] = useState([] as any[]);
  const [selected, setSelected] = useState(null as any);
  const [analysis, setAnalysis] = useState(null as any);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const analysisRequest = useRef(0);

  useEffect(() => {
    fetch(`${API_URL}/ipos`)
      .then((res) => res.json())
      .then((data) => setIpos(data));
  }, []);

  const today = new Date();
  const monthLabel = today.toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  });
  const daysInMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();
  const days = [];
  for (let i = 1; i <= daysInMonth; i++) {
    days.push(i);
  }

  function getIpo(day: number) {
    for (let i = 0; i < ipos.length; i++) {
      const parts = ipos[i].date.split("/");
      const ipoDay = parseInt(parts[1]);
      if (ipoDay === day) {
        return ipos[i];
      }
    }
    return null;
  }

  async function handleIpoClick(ipo: any) {
    const request = ++analysisRequest.current;
    setSelected(ipo);
    setAnalysis(null);
    setLoading(true);
    setError("");

    const params = new URLSearchParams({
      ticker: ipo.ticker,
      amount: ipo.amount,
      status: ipo.status,
    });

    try {
      const response = await fetch(
        `${API_URL}/analyze/${encodeURIComponent(ipo.name)}?${params}`,
      );
      if (!response.ok) throw new Error("Analysis unavailable. Please try again.");
      const data = await response.json();
      if (request === analysisRequest.current) setAnalysis(data);
    } catch {
      if (request === analysisRequest.current) setError("Analysis unavailable. Please try again.");
    } finally {
      if (request === analysisRequest.current) setLoading(false);
    }
  }

  function getScoreColor(score: number) {
    if (score >= 7) {
      return "green";
    } else if (score >= 4) {
      return "orange";
    } else {
      return "red";
    }
  }

  function closeCard() {
    analysisRequest.current++;
    setSelected(null);
    setAnalysis(null);
  }

  return (
    <div className="container">
      <h1>IPO Analyzer</h1>
      <p className="subtitle">{monthLabel}</p>

      <div className="calendar">
        {days.map((day) => {
          const ipo = getIpo(day);
          if (ipo) {
            return (
              <div
                key={day}
                className="day has-ipo"
                onClick={() => handleIpoClick(ipo)}
              >
                {day}
                <span className="ticker-label">{ipo.ticker}</span>
              </div>
            );
          } else {
            return (
              <div key={day} className="day">
                {day}
              </div>
            );
          }
        })}
      </div>

      {selected != null && (
        <div className="detail-card">
          <button onClick={closeCard}>Close</button>
          <h2>{selected.name}</h2>
          <p>
            {selected.ticker} · {selected.status}
          </p>
          <p>Offer Amount: {selected.amount || "Not disclosed"}</p>
          <p>Expected Date: {selected.date}</p>

          {loading && <p>Running analysis, please wait...</p>}
          {error && <p role="alert">{error}</p>}

          {analysis != null && (
            <div>
              <p
                style={{
                  color: analysis.score == null ? "inherit" : getScoreColor(analysis.score),
                  fontWeight: "bold",
                  fontSize: "18px",
                }}
              >
                {analysis.score == null ? "Not enough evidence to score" : `Score: ${analysis.score} out of 10`}
              </p>
              <p>{analysis.about}</p>
              <p>
                <strong>Summary:</strong> {analysis.summary}
              </p>
              <p style={{ color: "red" }}>Risk: {analysis.red_flag}</p>
              {analysis.sec?.url && (
                <p><a href={analysis.sec.url} target="_blank" rel="noopener noreferrer">
                  SEC {analysis.sec.form} · Filed {analysis.sec.filed}
                </a></p>
              )}
              {analysis.evidence?.map((quote: string, index: number) => (
                <blockquote key={index}>{quote}</blockquote>
              ))}
              <p>{analysis.limitations}</p>
              {analysis.sec?.status === "available" && <p>{analysis.sec.note}</p>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default App;
