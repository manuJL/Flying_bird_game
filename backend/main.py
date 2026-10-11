import os
from datetime import datetime, timezone
from pydantic import BaseModel, Field
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import desc
from models import SessionLocal, GameSession, RetainedBestScore, SessionState

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
    allow_credentials=False,
)


class RetainedBestScoreResponse(BaseModel):
    id: int
    best_score: int
    created_at: str
    updated_at: str


class GameSessionResponse(BaseModel):
    id: int
    session_state: str
    elapsed_survival_seconds: float
    collected_bonus_points: int
    final_score: int | None
    created_at: str
    ended_at: str | None
    best_score: int | None = None

    class Config:
        from_attributes = True


class CreateGameSessionRequest(BaseModel):
    pass


class UpdateGameSessionRequest(BaseModel):
    elapsed_survival_seconds: float = Field(ge=0.0)
    collected_bonus_points: int = Field(ge=0)


class CompleteGameSessionRequest(BaseModel):
    session_state: str
    elapsed_survival_seconds: float = Field(ge=0.0)
    collected_bonus_points: int = Field(ge=0)


@app.get("/api/retained-best-scores/1", response_model=RetainedBestScoreResponse)
def get_retained_best_score():
    db = SessionLocal()
    try:
        record = db.query(RetainedBestScore).filter(RetainedBestScore.id == 1).first()
        if not record:
            now_iso = datetime.now(timezone.utc).isoformat()
            record = RetainedBestScore(id=1, best_score=0, created_at=now_iso, updated_at=now_iso)
            db.add(record)
            db.commit()
            db.refresh(record)

        return RetainedBestScoreResponse(
            id=record.id,
            best_score=record.best_score,
            created_at=record.created_at,
            updated_at=record.updated_at,
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        db.close()


@app.post("/api/game-sessions", response_model=GameSessionResponse, status_code=201)
def create_game_session(request: CreateGameSessionRequest):
    db = SessionLocal()
    try:
        now_iso = datetime.now(timezone.utc).isoformat()
        session = GameSession(
            session_state=SessionState.RUNNING.value,
            elapsed_survival_seconds=0.0,
            collected_bonus_points=0,
            final_score=None,
            created_at=now_iso,
            ended_at=None,
        )
        db.add(session)
        db.commit()
        db.refresh(session)

        return GameSessionResponse(
            id=session.id,
            session_state=session.session_state,
            elapsed_survival_seconds=session.elapsed_survival_seconds,
            collected_bonus_points=session.collected_bonus_points,
            final_score=session.final_score,
            created_at=session.created_at,
            ended_at=session.ended_at,
        )
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        db.close()


@app.patch("/api/game-sessions/{session_id}", response_model=GameSessionResponse)
def update_game_session(session_id: int, request: UpdateGameSessionRequest):
    db = SessionLocal()
    try:
        session = db.query(GameSession).filter(GameSession.id == session_id).first()
        if not session:
            raise HTTPException(status_code=404, detail="Session not found")

        if session.session_state != SessionState.RUNNING.value:
            raise HTTPException(status_code=400, detail="Cannot update non-running session")

        session.elapsed_survival_seconds = request.elapsed_survival_seconds
        session.collected_bonus_points = request.collected_bonus_points
        db.commit()
        db.refresh(session)

        return GameSessionResponse(
            id=session.id,
            session_state=session.session_state,
            elapsed_survival_seconds=session.elapsed_survival_seconds,
            collected_bonus_points=session.collected_bonus_points,
            final_score=session.final_score,
            created_at=session.created_at,
            ended_at=session.ended_at,
        )
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        db.close()


@app.put("/api/game-sessions/{session_id}", response_model=GameSessionResponse)
def complete_game_session(session_id: int, request: CompleteGameSessionRequest):
    db = SessionLocal()
    try:
        session = db.query(GameSession).filter(GameSession.id == session_id).first()
        if not session:
            raise HTTPException(status_code=404, detail="Session not found")

        if session.session_state == SessionState.GAME_OVER.value:
            best_score_record = db.query(RetainedBestScore).filter(RetainedBestScore.id == 1).first()
            if not best_score_record:
                best_score = 0
            else:
                best_score = best_score_record.best_score

            return GameSessionResponse(
                id=session.id,
                session_state=session.session_state,
                elapsed_survival_seconds=session.elapsed_survival_seconds,
                collected_bonus_points=session.collected_bonus_points,
                final_score=session.final_score,
                created_at=session.created_at,
                ended_at=session.ended_at,
                best_score=best_score,
            )

        if session.session_state != SessionState.RUNNING.value:
            raise HTTPException(status_code=400, detail="Can only complete running sessions")

        now_iso = datetime.now(timezone.utc).isoformat()
        final_score = int(request.elapsed_survival_seconds) + request.collected_bonus_points

        session.session_state = SessionState.GAME_OVER.value
        session.elapsed_survival_seconds = request.elapsed_survival_seconds
        session.collected_bonus_points = request.collected_bonus_points
        session.final_score = final_score
        session.ended_at = now_iso

        best_score_record = db.query(RetainedBestScore).filter(RetainedBestScore.id == 1).first()
        if not best_score_record:
            best_score_record = RetainedBestScore(
                id=1,
                best_score=final_score,
                created_at=now_iso,
                updated_at=now_iso,
            )
            db.add(best_score_record)
        else:
            if final_score > best_score_record.best_score:
                best_score_record.best_score = final_score
                best_score_record.updated_at = now_iso

        db.commit()
        db.refresh(session)
        db.refresh(best_score_record)

        return GameSessionResponse(
            id=session.id,
            session_state=session.session_state,
            elapsed_survival_seconds=session.elapsed_survival_seconds,
            collected_bonus_points=session.collected_bonus_points,
            final_score=session.final_score,
            created_at=session.created_at,
            ended_at=session.ended_at,
            best_score=best_score_record.best_score,
        )
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        db.close()