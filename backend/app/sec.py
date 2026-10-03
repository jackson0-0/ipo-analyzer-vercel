"""Small, conservative EDGAR client. No fuzzy matches or third-party sources."""
from datetime import date, timedelta
from functools import lru_cache
from html.parser import HTMLParser
import os
import json
import re
import threading
import time

import httpx

_lock = threading.Lock()
_last_request = 0.0
FORMS = {"S-1", "S-1/A", "F-1", "F-1/A", "424B4"}


def _get(url):
    global _last_request
    agent = os.getenv("SEC_USER_AGENT", "").strip()
    if not agent or "@" not in agent:
        raise ValueError("SEC_USER_AGENT must contain a contact email")
    # Single Railway worker: serialize requests, at most four per second.
    with _lock:
        time.sleep(max(0, 0.25 - (time.monotonic() - _last_request)))
        _last_request = time.monotonic()
        with httpx.stream("GET", url, headers={"User-Agent": agent}, timeout=15) as response:
            response.raise_for_status()
            chunks, size = [], 0
            for chunk in response.iter_bytes():
                size += len(chunk)
                limit = 64_000_000 if url.endswith("cik-lookup-data.txt") else 16_000_000
                if size > limit:
                    raise ValueError("SEC document exceeds download limit")
                chunks.append(chunk)
            return b"".join(chunks).decode("utf-8", errors="replace")


def _name(value):
    value = re.sub(r"[^a-z0-9 ]", " ", value.lower())
    return " ".join(word for word in value.split()
                    if word not in {"inc", "incorporated", "corp", "corporation", "ltd", "limited"})


@lru_cache(maxsize=2)
def _tickers(day):
    return json.loads(_get("https://www.sec.gov/files/company_tickers.json"))


@lru_cache(maxsize=2)
def _directory(day):
    # Includes unlisted issuers, unlike a ticker-only directory. Refresh daily.
    names = {}
    for line in _get("https://www.sec.gov/Archives/edgar/cik-lookup-data.txt").splitlines():
        parts = line.rstrip(":").rsplit(":", 1)
        if len(parts) == 2 and parts[1].isdigit():
            names.setdefault(_name(parts[0]), set()).add(int(parts[1]))
    return names


class _Text(HTMLParser):
    def __init__(self):
        super().__init__()
        self.parts, self.hidden = [], 0

    def handle_starttag(self, tag, attrs):
        if tag in {"script", "style", "ix:hidden", "ix:header"}:
            self.hidden += 1
        if tag in {"p", "div", "tr", "br", "h1", "h2", "h3"}:
            self.parts.append("\n")

    def handle_endtag(self, tag):
        if tag in {"script", "style", "ix:hidden", "ix:header"}:
            self.hidden = max(0, self.hidden - 1)

    def handle_data(self, data):
        if not self.hidden:
            self.parts.append(data + " ")


def _excerpts(html):
    parser = _Text()
    parser.feed(html)
    text = re.sub(r"[ \t\r\f\v]+", " ", "".join(parser.parts))
    text = re.sub(r"\n\s*\n", "\n", text).strip()
    if len(text) < 1000:
        raise ValueError("No readable filing text")
    # Sample across the filing, not just its cover/table of contents.
    windows = [(0, 7000)]
    for heading in [r"risk factors", r"management.{0,12}s discussion", r"use of proceeds",
                    r"results of operations", r"consolidated statements of (?:operations|income|cash flows)"]:
        matches = list(re.finditer(heading, text, re.I))
        if matches:
            substantive = [m for m in matches if m.start() > 7000]
            start = (substantive or matches)[0].start()
            windows.append((max(0, start - 200), start + 6500))
    merged = []
    for start, end in sorted(windows):
        if merged and start <= merged[-1][1]:
            merged[-1][1] = max(end, merged[-1][1])
        else:
            merged.append([start, end])
    return "\n\n[Excerpt break]\n\n".join(text[a:b] for a, b in merged)[:40000]


@lru_cache(maxsize=64)
def _filing(company_name, ticker, bucket):
    target = _name(company_name)
    if not target:
        raise ValueError("A company name is required")
    from app.database import SessionLocal
    from app.models import IssuerIdentity
    from app.collection import now
    from sqlalchemy.exc import IntegrityError
    with SessionLocal() as db:
        identity = db.get(IssuerIdentity, target)
        saved_cik = int(identity.cik) if identity else None
    candidates = {saved_cik} if saved_cik else set()
    # Ticker matches still require a matching company name, preventing collisions.
    tickers = {} if saved_cik else _tickers(date.today().isoformat())
    for row in tickers.values():
        if _name(row["title"]) == target:
            candidates.add(int(row["cik_str"]))
    if not candidates:
        candidates = _directory(date.today().isoformat()).get(target, set())
    if len(candidates) != 1:
        raise ValueError("No unique SEC company match; no filing-based score is available")
    cik = next(iter(candidates))
    data = json.loads(_get(f"https://data.sec.gov/submissions/CIK{cik:010d}.json"))
    verified_names = {_name(data["name"])} | {_name(row.get("name", "")) for row in data.get("formerNames", [])}
    if target not in verified_names:
        raise ValueError("SEC issuer name differs from the requested company")
    with SessionLocal() as db:
        row = db.get(IssuerIdentity, target)
        if row is None:
            row = IssuerIdentity(name_key=target)
            db.add(row)
        row.cik, row.sec_name, row.verified_at = str(cik), data["name"], now()
        try:
            db.commit()
        except IntegrityError:
            db.rollback()
    cutoff = (date.today() - timedelta(days=730)).isoformat()
    recent = data["filings"]["recent"]
    filings = [dict(zip(recent, values)) for values in zip(*recent.values())]
    eligible = [f for f in filings if f["form"] in FORMS
                and cutoff <= f["filingDate"] <= date.today().isoformat()]
    if not eligible:
        raise ValueError("No recent S-1, F-1, or 424B4 found in the SEC recent-filings history")
    filing = max(eligible, key=lambda f: (f["filingDate"], f["accessionNumber"]))
    accession, document = filing["accessionNumber"], filing["primaryDocument"]
    if not re.fullmatch(r"\d{10}-\d{2}-\d{6}", accession) or not re.fullmatch(r"[\w.-]+", document):
        raise ValueError("Unexpected SEC document path")
    url = f"https://www.sec.gov/Archives/edgar/data/{cik}/{accession.replace('-', '')}/{document}"
    return {"status": "available", "company": data["name"], "industry": data.get("sicDescription") or None, "cik": str(cik),
            "form": filing["form"], "filed": filing["filingDate"], "url": url,
            "accession": accession, "excerpts": _excerpts(_get(url)),
            "note": "Based on selected filing excerpts, not a full filing review. Registration statements may be preliminary or relate to another offering."}


def get_filing(company_name, ticker=""):
    try:
        return dict(_filing(company_name, ticker, int(time.time() // 900)))
    except (httpx.HTTPError, ValueError, KeyError, TypeError) as exc:
        if isinstance(exc, httpx.HTTPError):
            reason = "SEC could not be reached or declined the request. Try again later."
        else:
            reason = str(exc) if isinstance(exc, ValueError) else "Unexpected SEC response format."
        return {"status": "unavailable", "note": reason}
