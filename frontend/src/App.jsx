import React, { useCallback, useEffect, useRef, useState } from 'react';
import PreGameScreen from './screens/PreGameScreen';
import RunningScreen from './screens/RunningScreen';
import GameOverScreen from './screens/GameOverScreen';
import './App.css';

// The challenge backend is injected by the sandbox via VITE_BASE_BE_ENDPOINT.
// Fall back to localhost so the game also works in plain `npm run dev`.
const BASE_ENDPOINT = import.meta.env.VITE_BASE_BE_ENDPOINT || 'http://localhost:8000';

const LS_BEST_KEY = 'skyline-flight-best';

function readLocalBest() {
  try {
    return Math.max(0, Number(localStorage.getItem(LS_BEST_KEY)) || 0);
  } catch {
    return 0;
  }
}

function writeLocalBest(value) {
  try {
    localStorage.setItem(LS_BEST_KEY, String(value));
  } catch {
    /* private mode: nothing we can do */
  }
}

// Thin wrapper around the three session endpoints. Every call is forgiving:
// if the backend is unreachable the rest of the game still works, it just
// persists best-score locally instead.
const api = {
  async fetchBest() {
    try {
      const res = await fetch(`${BASE_ENDPOINT}/api/retained-best-scores/1`);
      if (!res.ok) return null;
      const data = await res.json();
      return Number(data.best_score) || 0;
    } catch {
      return null;
    }
  },

  async createSession() {
    try {
      const res = await fetch(`${BASE_ENDPOINT}/api/game-sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      if (!res.ok) return null;
      const data = await res.json();
      return data.id ?? null;
    } catch {
      return null;
    }
  },

  async syncSession(sessionId, elapsed, bonus) {
    try {
      await fetch(`${BASE_ENDPOINT}/api/game-sessions/${sessionId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          elapsed_survival_seconds: elapsed,
          collected_bonus_points: bonus,
        }),
      });
    } catch {
      /* fire-and-forget; the PUT at the end is authoritative */
    }
  },

  async finishSession(sessionId, elapsed, bonus) {
    try {
      const res = await fetch(`${BASE_ENDPOINT}/api/game-sessions/${sessionId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session_state: 'game_over',
          elapsed_survival_seconds: elapsed,
          collected_bonus_points: bonus,
        }),
      });
      if (!res.ok) return null;
      const data = await res.json();
      return Number(data.best_score) || 0;
    } catch {
      return null;
    }
  },
};

export default function App() {
  // Server keeps the real "return to the game later" memory, but we also keep
  // a local mirror so the game is fully playable with no network at all.
  const [bestScore, setBestScore] = useState(readLocalBest);
  const [phase, setPhase] = useState('pre_game');
  const [finalScore, setFinalScore] = useState(0);
  const [isNewBest, setIsNewBest] = useState(false);
  const [lastStats, setLastStats] = useState({ elapsed: 0, bonus: 0 });

  // Values used inside callbacks keep living in refs so the callbacks
  // themselves stay stable and the game loop closure never sees stale state.
  const bestRef = useRef(readLocalBest());
  const sessionIdRef = useRef(null);
  const roundBestAtStartRef = useRef(bestRef.current);

  // Load the retained best score once on first mount, merging with anything
  // we already knew locally (the safer of the two wins).
  useEffect(() => {
    let alive = true;
    api.fetchBest().then((serverBest) => {
      if (!alive) return;
      if (serverBest !== null && serverBest > bestRef.current) {
        bestRef.current = serverBest;
        setBestScore(serverBest);
        writeLocalBest(serverBest);
      }
    });
    return () => {
      alive = false;
    };
  }, []);

  const startRound = useCallback(() => {
    setFinalScore(0);
    setIsNewBest(false);
    setPhase('running');
    roundBestAtStartRef.current = bestRef.current;

    api.createSession().then((id) => {
      sessionIdRef.current = id;
    });
  }, []);

  const handleGameOver = useCallback((stats) => {
    const score = stats.score;
    setLastStats(stats);
    setFinalScore(score);

    // The local best can be updated instantly so the Game Over screen feels
    // snappy, even if the backend round-trip is still in flight.
    const prev = bestRef.current;
    const record = score > prev;
    setIsNewBest(record);
    if (record) {
      bestRef.current = score;
      setBestScore(score);
      writeLocalBest(score);
    }

    // Tell the backend the round is over and let it reconcile the retained
    // best score from its side too.
    if (sessionIdRef.current !== null) {
      api.finishSession(sessionIdRef.current, stats.elapsed, stats.bonus).then((serverBest) => {
        if (serverBest !== null && serverBest > bestRef.current) {
          bestRef.current = serverBest;
          setBestScore(serverBest);
          writeLocalBest(serverBest);
        }
      });
    }

    setPhase('game_over');
  }, []);

  return (
    <div className="game-container">
      {phase === 'pre_game' && (
        <PreGameScreen bestScore={bestScore} onStartGame={startRound} />
      )}

      {phase === 'running' && (
        <RunningScreen
          sessionId={sessionIdRef.current}
          bestScore={bestRef.current}
          baseUrl={BASE_ENDPOINT}
          onGameOver={handleGameOver}
        />
      )}

      {phase === 'game_over' && (
        <GameOverScreen
          finalScore={finalScore}
          bestScore={bestScore}
          isNewBest={isNewBest}
          stats={lastStats}
          onPlayAgain={startRound}
        />
      )}
    </div>
  );
}