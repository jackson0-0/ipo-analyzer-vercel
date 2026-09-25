import { useState, useEffect } from "react";
import "./App.css";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:8000";

function App() {
  const [ipos, setIpos] = useState([] as any[]);
  const [selected, setSelected] = useState(null as any);
  const [analysis, setAnalysis] = useState(null as any);
  const [loading, setLoading] = useState(false);

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
    setSelected(ipo);
    setAnalysis(null);
    setLoading(true);

    const params = new URLSearchParams({
      ticker: ipo.ticker,
      amount: ipo.amount,
      status: ipo.status,
    });

    const response = await fetch(
      `${API_URL}/analyze/${ipo.name}?${params}`,
    );
    const data = await response.json();

    setAnalysis(data);
    setLoading(false);
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

          {analysis != null && (
            <div>
              <p
                style={{
                  color: getScoreColor(analysis.score),
                  fontWeight: "bold",
                  fontSize: "18px",
                }}
              >
                Score: {analysis.score} out of 10
              </p>
              <p>{analysis.about}</p>
              <p>
                <strong>Summary:</strong> {analysis.summary}
              </p>
              <p style={{ color: "red" }}>Risk: {analysis.red_flag}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default App;
