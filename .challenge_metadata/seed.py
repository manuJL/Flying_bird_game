# --- challenge-gen schema bootstrap ---
# Added by the challenge-gen orchestrator. This file is the only database file a build's
# sandbox receives, so it sets the database up on its own: first every table in the schema,
# then the seed data below. Re-running it skips tables that already exist.
import os as _bootstrap_os
import sqlite3 as _bootstrap_sqlite3

_BOOTSTRAP_SCHEMA_SQL = 'CREATE TABLE IF NOT EXISTS retained_best_scores (\n    id INTEGER PRIMARY KEY AUTOINCREMENT CHECK (id = 1),\n    best_score INTEGER NOT NULL DEFAULT 0 CHECK (best_score >= 0),\n    created_at TEXT NOT NULL,\n    updated_at TEXT NOT NULL\n);\n\nCREATE TABLE IF NOT EXISTS game_sessions (\n    id INTEGER PRIMARY KEY AUTOINCREMENT,\n    session_state TEXT NOT NULL,\n    elapsed_survival_seconds REAL NOT NULL DEFAULT 0.0 CHECK (elapsed_survival_seconds >= 0.0),\n    collected_bonus_points INTEGER NOT NULL DEFAULT 0 CHECK (collected_bonus_points >= 0),\n    final_score INTEGER CHECK (final_score >= 0),\n    created_at TEXT NOT NULL,\n    ended_at TEXT\n);\n\nCREATE INDEX IF NOT EXISTS game_sessions_session_state_index ON game_sessions(session_state);\nCREATE INDEX IF NOT EXISTS game_sessions_created_at_index ON game_sessions(created_at);'


def _bootstrap_schema():
    url = _bootstrap_os.environ.get("DATABASE_URL") or 'sqlite:////tmp/master.db'
    if not url.startswith("sqlite:"):
        raise SystemExit("schema bootstrap supports SQLite only; DATABASE_URL is " + url.split(":", 1)[0])
    path = url.split("sqlite:///", 1)[-1]
    directory = _bootstrap_os.path.dirname(path)
    if directory:
        _bootstrap_os.makedirs(directory, exist_ok=True)
    connection = _bootstrap_sqlite3.connect(path)
    try:
        connection.executescript(_BOOTSTRAP_SCHEMA_SQL)
        connection.commit()
    finally:
        connection.close()
    print("[seed] schema applied to " + path, flush=True)


_bootstrap_schema()
# --- end of schema bootstrap; the seeder follows ---

import os
import random
import sqlite3
from datetime import datetime, timedelta, timezone

from faker import Faker

fake = Faker('en_US')
Faker.seed(42)
fake.seed_instance(42)
random.seed(42)

DATABASE_URL = os.environ.get('DATABASE_URL') or 'sqlite:////tmp/master.db'


def seed_database():
    path = DATABASE_URL.split('sqlite:///', 1)[-1]
    conn = sqlite3.connect(path)
    cur = conn.cursor()

    try:
        try:
            existing_count = cur.execute(
                'SELECT COUNT(*) FROM retained_best_scores'
            ).fetchone()[0]
            if existing_count > 0:
                print('already seeded; skipping')
                return
        except sqlite3.Error:
            pass

        cur.execute('PRAGMA foreign_keys = OFF;')
        cur.execute('DELETE FROM game_sessions;')
        cur.execute('DELETE FROM retained_best_scores;')

        seq_exists = cur.execute(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name='sqlite_sequence'"
        ).fetchone()
        if seq_exists:
            cur.execute("DELETE FROM sqlite_sequence WHERE name = ?", ('game_sessions',))
            cur.execute("DELETE FROM sqlite_sequence WHERE name = ?", ('retained_best_scores',))

        cur.execute('PRAGMA foreign_keys = ON;')

        now = datetime.now(timezone.utc)
        session_rows = []

        for index in range(20):
            elapsed = round(48.5 + (index * 17.35), 2)
            bonus = (index * 13) % 91
            final_score = int(elapsed // 1) + bonus
            created_at = now - timedelta(days=25 - index, hours=4, minutes=index * 3)
            ended_at = created_at + timedelta(seconds=elapsed)
            session_rows.append({
                'session_state': random.choice(['game_over']),
                'elapsed_survival_seconds': elapsed,
                'collected_bonus_points': bonus,
                'final_score': final_score,
                'created_at': created_at,
                'ended_at': ended_at,
            })

        for index in range(5):
            created_at = now - timedelta(hours=5 - index, minutes=index * 11)
            session_rows.append({
                'session_state': random.choice(['running']),
                'elapsed_survival_seconds': 0.0,
                'collected_bonus_points': 0,
                'final_score': None,
                'created_at': created_at,
                'ended_at': None,
            })

        best_score = max(row['final_score'] for row in session_rows if row['final_score'] is not None)
        retained_created_at = now - timedelta(days=30)
        cur.execute(
            '''INSERT INTO retained_best_scores
               (best_score, created_at, updated_at)
               VALUES (?, ?, ?)''',
            (best_score, retained_created_at, now),
        )
        retained_id = cur.lastrowid
        if retained_id != 1:
            raise RuntimeError('retained_best_scores singleton was not assigned id 1')
        print('Seeded 1 rows into retained_best_scores.')

        for row in session_rows:
            cur.execute(
                '''INSERT INTO game_sessions
                   (session_state, elapsed_survival_seconds, collected_bonus_points,
                    final_score, created_at, ended_at)
                   VALUES (?, ?, ?, ?, ?, ?)''',
                (
                    row['session_state'],
                    row['elapsed_survival_seconds'],
                    row['collected_bonus_points'],
                    row['final_score'],
                    row['created_at'],
                    row['ended_at'],
                ),
            )
            _session_id = cur.lastrowid

        print(f"Seeded {len(session_rows)} rows into game_sessions.")
        conn.commit()
    except Exception:
        print('Error seeding database.')
        conn.rollback()
        raise
    finally:
        cur.close()
        conn.close()


if __name__ == '__main__':
    seed_database()