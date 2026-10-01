from sqlalchemy import Column, Integer, String, Text
from sqlalchemy.ext.declarative import declarative_base

Base = declarative_base()

class IPOAnalysis(Base):
    __tablename__ = "ipo_analysis"

    id = Column(Integer, primary_key=True)
    company_name = Column(String)
    ticker = Column(String)
    score = Column(Integer)
    summary = Column(Text)
    red_flag = Column(Text)
    about = Column(Text)


class SECAnalysis(Base):
    __tablename__ = "sec_analysis"

    cache_key = Column(String(64), primary_key=True)
    response = Column(Text, nullable=False)


class CalendarSnapshot(Base):
    __tablename__ = "calendar_snapshots"
    month = Column(String(7), primary_key=True)
    response = Column(Text, nullable=False)
    updated_at = Column(String(32), nullable=False)


class IssuerIdentity(Base):
    __tablename__ = "issuer_identities"
    name_key = Column(String(300), primary_key=True)
    cik = Column(String(10), nullable=False)
    sec_name = Column(String(300), nullable=False)
    verified_at = Column(String(32), nullable=False)


class ReportedFacts(Base):
    __tablename__ = "reported_facts"
    accession = Column(String(32), primary_key=True)
    cik = Column(String(10), nullable=False)
    response = Column(Text, nullable=False)
    updated_at = Column(String(32), nullable=False)
