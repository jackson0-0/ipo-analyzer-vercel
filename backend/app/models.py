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
