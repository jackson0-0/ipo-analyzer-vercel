SEC-backed analysis
===================

Set SEC_USER_AGENT to an app name and a working contact email in backend/.env
for local use, and in Railway Variables for production. The value is sent only
in backend requests to SEC. SEC does not require an API key for this data.

Both /analyze/{company_name} and the MCP analyze_ipo tool share this integration.
It resolves a company using SEC's ticker/name directory or the full CIK name
index (including unlisted issuers), requiring a unique normalized name match
and verifying the current issuer name. Ambiguous or renamed issuers may require
manual research; this basic version deliberately avoids fuzzy matching.

It selects the latest S-1, S-1/A, F-1, F-1/A or 424B4 within two years from the
issuer's recent submissions history. Older history files and confidential
filings are not searched. Form type alone does not prove an offering is the
requested IPO; the model is instructed to withhold a score when it cannot tell.

The model receives up to 40,000 characters of selected filing excerpts, not the
entire filing. Financial statements are read from filing text; the Company Facts
XBRL API is not used. The response contains the SEC source, filing date, supporting
passages selected by ID and copied directly from the retrieved excerpts, and limitations. Source passages do
not independently validate all of the model's interpretation.

If matching/download fails, no model call or score is produced. An invalid model
response returns a retryable error. SEC requests are limited to four/second per
process (current deployment is one worker), directory data cached daily, and
successful filing retrievals cached for up to 15 minutes. Revisit shared rate
limiting before scaling workers. A new sec_analysis table stores JSON judgments;
old ipo_analysis rows remain untouched and are not reused. Cache keys include
filing content, IPO inputs, and date so new evidence triggers a fresh analysis.

Test from the repository root:
  PYTHONPATH=backend backend/venv/bin/python -m unittest discover -s backend/tests -v

Official documentation:
https://www.sec.gov/search-filings/edgar-application-programming-interfaces
https://www.sec.gov/search-filings/edgar-search-assistance/accessing-edgar-data

## Durable collection and reported facts

The API lifespan refreshes the last 12 calendar months at startup and hourly while
this Railway worker is running. Each successful response is stored in
`calendar_snapshots`; `/calendar?month=YYYY-MM` returns rows, UTC `updated_at`,
`stale`, and `refresh_failed`. `/ipos` remains a list for MCP compatibility.
Requests reuse snapshots for one hour; failed refreshes retain the last successful
snapshot. No snapshot plus an upstream failure returns 502, not an empty calendar.
This uses the existing database and requires no new environment variables.

Verified name-to-CIK mappings are stored in `issuer_identities`. Each new filing
lookup uses that CIK and verifies the submissions current/former names. Ambiguous
or mismatched names are rejected; tickers alone never establish identity.

`reported_facts` stores original numeric SEC Company Facts values separately from
AI analyses, with tag, unit, reporting period, accession, and filing link. Only
values matching the selected filing accession are accepted; no values are inferred,
summed, or filled with zero. The initial implementation covers common US-GAAP
revenue, net income/loss, cash flow, cash, and current/noncurrent long-term debt
concepts. It does not cover every debt type, IFRS, custom tags, or unstructured
prospectus tables. Many new IPO filings have no Company Facts coverage. The UI
shows that limitation and still permits clearly labeled excerpt-based AI judgment.
Offering amounts remain separately labeled Nasdaq data; they are not valuations.
