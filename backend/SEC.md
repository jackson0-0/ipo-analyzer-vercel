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
XBRL API is not used. The response contains the SEC source, filing date, short
quotes checked against the retrieved excerpts, and limitations. Exact quotes do
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
