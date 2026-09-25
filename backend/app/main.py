from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from anthropic import Anthropic
from dotenv import load_dotenv
from app.database import engine, SessionLocal
from app import models
import httpx
import json
import os
from datetime import date

load_dotenv()

models.Base.metadata.create_all(bind=engine)

app = FastAPI()

allowed_origins = os.getenv("ALLOWED_ORIGINS", "http://localhost:5173").split(",")

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_methods=["*"],
    allow_headers=["*"],
)

client = Anthropic(api_key=os.getenv("ANTHROPIC_API_KEY"))

@app.get("/")
def home():
    return {"message": "IPO Analyzer is running"}

@app.get("/ipos")
def get_ipos():
    today = date.today().strftime("%Y-%m")
    url = f"https://api.nasdaq.com/api/ipo/calendar?date={today}"
    headers = {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36"
    }

    response = httpx.get(url, headers=headers)
    data = response.json()

    ipos = []

    upcoming = data["data"]["upcoming"]["upcomingTable"]["rows"]
    for ipo in upcoming:
        ipos.append({
            "name": ipo["companyName"],
            "ticker": ipo["proposedTickerSymbol"],
            "date": ipo["expectedPriceDate"],
            "amount": ipo["dollarValueOfSharesOffered"],
            "status": "upcoming"
        })

    priced = data["data"]["priced"]["rows"]
    for ipo in priced:
        ipos.append({
            "name": ipo["companyName"],
            "ticker": ipo["proposedTickerSymbol"],
            "date": ipo["pricedDate"],
            "amount": ipo["dollarValueOfSharesOffered"],
            "status": "priced"
        })

    return ipos

@app.get("/analyze/{company_name}")
def analyze(company_name: str, ticker: str = "", amount: str = "", status: str = ""):
    db = SessionLocal()

    existing = db.query(models.IPOAnalysis).filter(models.IPOAnalysis.company_name == company_name).first()

    if existing:
        db.close()
        return {
            "score": existing.score,
            "summary": existing.summary,
            "red_flag": existing.red_flag,
            "about": existing.about
        }

    response = client.messages.create(
        model="claude-haiku-4-5-20251001",
        max_tokens=1024,
        messages=[
            {
                "role": "user",
                "content": f"You are an IPO analyst. Analyze this IPO: Company: {company_name}, Ticker: {ticker}, Offer Amount: {amount}, Status: {status}. Reply in JSON only, no markdown, no code blocks, with these keys: score (1-10), summary (one sentence verdict), red_flag (biggest risk), about (a paragraph explaining what the company does and why they are going public)"
            }
        ]
    )

    raw = response.content[0].text
    clean = raw.replace("```json", "").replace("```", "").strip()
    result = json.loads(clean)

    new_analysis = models.IPOAnalysis(
        company_name=company_name,
        ticker=ticker,
        score=result["score"],
        summary=result["summary"],
        red_flag=result["red_flag"],
        about=result.get("about", "")
    )
    db.add(new_analysis)
    db.commit()
    db.close()

    return result
