import os
os.environ.setdefault('DATABASE_URL', 'sqlite:///:memory:')
os.environ.setdefault('ANTHROPIC_API_KEY', 'test-key')
import unittest
from unittest.mock import Mock, patch
import httpx
from fastapi import HTTPException
from app.main import get_ipos

class CalendarTests(unittest.TestCase):
    @patch('app.main.httpx.get')
    def test_historical_month(self, get):
        get.return_value = Mock(json=lambda: {'data': {'upcoming': None, 'priced': {'rows': [{'companyName': 'Example', 'proposedTickerSymbol': 'EX', 'pricedDate': '03/02/2026', 'dollarValueOfSharesOffered': None}]}}})
        result = get_ipos('2026-03')
        self.assertIn('date=2026-03', get.call_args.args[0])
        self.assertEqual(result[0]['date'], '03/02/2026')
        self.assertEqual(result[0]['amount'], '')
        self.assertEqual(result[0]['status'], 'priced')

    @patch('app.main.httpx.get')
    def test_empty_calendar(self, get):
        get.return_value = Mock(json=lambda: {'data': {'upcoming': None, 'priced': None}})
        self.assertEqual(get_ipos('2026-09'), [])

    @patch('app.main.httpx.get')
    def test_upstream_failure(self, get):
        get.side_effect = httpx.TimeoutException('timeout')
        with self.assertRaises(HTTPException) as error:
            get_ipos('2026-09')
        self.assertEqual(error.exception.status_code, 502)

    @patch('app.main.httpx.get')
    def test_missing_data_is_error(self, get):
        get.return_value = Mock(json=lambda: {'data': None})
        with self.assertRaises(HTTPException):
            get_ipos('2026-09')
