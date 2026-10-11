import os
from enum import Enum
from datetime import datetime
from sqlalchemy import Column, Integer, Float, String, DateTime, Text, create_engine, Index
from sqlalchemy.orm import declarative_base, sessionmaker
from sqlalchemy.pool import StaticPool

DATABASE_URL = os.environ.get("DATABASE_URL") or "sqlite:////tmp/master.db"

engine = create_engine(
    DATABASE_URL,
    connect_args={"check_same_thread": False} if "sqlite" in DATABASE_URL else {},
    poolclass=StaticPool if "sqlite" in DATABASE_URL else None,
)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


class SessionState(str, Enum):
    PRE_GAME = "pre_game"
    RUNNING = "running"
    GAME_OVER = "game_over"


class RetainedBestScore(Base):
    __tablename__ = "retained_best_scores"
    __table_args__ = {"extend_existing": True}

    id = Column(Integer, primary_key=True, autoincrement=True)
    best_score = Column(Integer, nullable=False, default=0)
    created_at = Column(String, nullable=False)
    updated_at = Column(String, nullable=False)


class GameSession(Base):
    __tablename__ = "game_sessions"
    __table_args__ = (
        Index("game_sessions_session_state_index", "session_state"),
        Index("game_sessions_created_at_index", "created_at"),
        {"extend_existing": True},
    )

    id = Column(Integer, primary_key=True, autoincrement=True)
    session_state = Column(String, nullable=False)
    elapsed_survival_seconds = Column(Float, nullable=False, default=0.0)
    collected_bonus_points = Column(Integer, nullable=False, default=0)
    final_score = Column(Integer, nullable=True)
    created_at = Column(String, nullable=False)
    ended_at = Column(String, nullable=True)