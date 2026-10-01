"""Durable calendar snapshots; failed refreshes never replace successful data."""
from datetime import datetime, timezone
import json
import threading
from sqlalchemy.exc import IntegrityError
from app.database import SessionLocal
from app.models import CalendarSnapshot

_lock = threading.Lock()
TTL = 3600


def now():
    return datetime.now(timezone.utc).isoformat()


def age(timestamp):
    return (datetime.now(timezone.utc) - datetime.fromisoformat(timestamp)).total_seconds()


def calendar(month, fetch, force=False):
    with _lock:
        with SessionLocal() as db:
            cached = db.get(CalendarSnapshot, month)
            stale = cached is None or age(cached.updated_at) >= TTL
            if stale or force:
                try:
                    rows = fetch(month)
                except Exception:
                    if cached is None:
                        raise
                    return {"ipos": json.loads(cached.response), "updated_at": cached.updated_at,
                            "stale": True, "source": "Nasdaq", "refresh_failed": True}
                timestamp = now()
                if cached is None:
                    cached = CalendarSnapshot(month=month)
                    db.add(cached)
                cached.response, cached.updated_at = json.dumps(rows), timestamp
                try:
                    db.commit()
                except IntegrityError:
                    db.rollback()
                    cached = db.get(CalendarSnapshot, month)
            return {"ipos": json.loads(cached.response), "updated_at": cached.updated_at,
                    "stale": age(cached.updated_at) >= TTL, "source": "Nasdaq", "refresh_failed": False}
