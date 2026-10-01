import os
os.environ.setdefault('DATABASE_URL', 'sqlite://')
os.environ.setdefault('ANTHROPIC_API_KEY', 'test-key')
import unittest
from unittest.mock import Mock, patch
from app import main, sec
from app.collection import calendar
from app.database import SessionLocal
from app.models import CalendarSnapshot, IssuerIdentity, ReportedFacts
from app.facts import extract, get_reported_facts

class CollectionTests(unittest.TestCase):
    def setUp(self):
        with SessionLocal() as db:
            db.query(ReportedFacts).delete()
            db.query(CalendarSnapshot).delete()
            db.query(IssuerIdentity).delete()
            db.commit()
        sec._filing.cache_clear()

    def test_cache_and_failed_refresh_preserve_timestamp(self):
        fetch = Mock(return_value=[{'name': 'Example'}])
        first = calendar('2026-09', fetch)
        self.assertEqual(calendar('2026-09', fetch), first)
        self.assertEqual(fetch.call_count, 1)
        fetch.side_effect = RuntimeError('upstream down')
        fallback = calendar('2026-09', fetch, force=True)
        self.assertEqual(fallback['ipos'], first['ipos'])
        self.assertEqual(fallback['updated_at'], first['updated_at'])
        self.assertTrue(fallback['stale'])
        self.assertTrue(fallback['refresh_failed'])

    def test_successful_empty_replaces_old_snapshot(self):
        calendar('2026-09', lambda _: [{'name':'Example'}])
        self.assertEqual(calendar('2026-09', lambda _: [], force=True)['ipos'], [])

    def test_facts_exclude_other_filings_and_keep_periods(self):
        filing = {'cik':'42','accession':'new','url':'https://www.sec.gov/test'}
        data = {'cik':42,'facts':{'us-gaap':{'Revenues':{'units':{'USD':[
            {'accn':'old','val':999,'end':'2025-12-31'},
            {'accn':'new','val':120,'start':'2025-01-01','end':'2025-12-31'},
            {'accn':'new','val':30,'start':'2025-10-01','end':'2025-12-31'}]}}}}}
        facts = extract(data, filing)
        self.assertEqual([f['value'] for f in facts], [120,30])
        self.assertNotEqual(facts[0]['period_start'],facts[1]['period_start'])
        self.assertEqual(facts[0]['source_url'],filing['url'])
        with self.assertRaises(ValueError):
            extract({**data,'cik':43}, filing)

    def test_saved_cik_skips_directory_but_rechecks_identity(self):
        import json
        with SessionLocal() as db:
            db.add(IssuerIdentity(name_key='example',cik='42',sec_name='Example Inc',verified_at='2026-01-01'))
            db.commit()
        response = json.dumps({'name':'Unrelated Company','filings':{'recent':{}}})
        with patch.object(sec,'_get',return_value=response) as get:
            self.assertEqual(sec.get_filing('Example Inc')['status'],'unavailable')
            self.assertEqual(get.call_count,1)
            self.assertIn('CIK0000000042.json',get.call_args.args[0])

    def test_structured_facts_are_persisted_and_reused(self):
        import json
        filing = {'cik':'42','accession':'0000000042-26-000001','url':'https://www.sec.gov/test'}
        payload = {'cik':42,'facts':{'us-gaap':{'NetIncomeLoss':{'units':{'USD':[
            {'accn':filing['accession'],'val':-200,'start':'2025-01-01','end':'2025-12-31'}]}}}}}
        with patch('app.facts._get',return_value=json.dumps(payload)) as get:
            first = get_reported_facts(filing)
            self.assertEqual(first['items'][0]['value'], -200)
            self.assertEqual(get_reported_facts(filing), first)
            self.assertEqual(get.call_count, 1)
        with SessionLocal() as db:
            self.assertIsNotNone(db.get(ReportedFacts, filing['accession']))

    def test_missing_financials_are_not_zero(self):
        filing = {'cik':'42','accession':'missing','url':'https://www.sec.gov/test'}
        with patch('app.facts._get', return_value='{"cik":42,"facts":{}}'):
            result = get_reported_facts(filing)
            self.assertEqual(result['items'], [])
            self.assertEqual(result['status'], 'not_reported')
