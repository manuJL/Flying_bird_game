import React from 'react';
import { unlockAudio } from '../utils/sound';
import './../styles/PreGameScreen.css';

export default function PreGameScreen({ bestScore, onStartGame }) {
  const handleStart = () => {
    unlockAudio(); // browsers demand audio unlock inside a user gesture
    onStartGame();
  };

  return (
    <div className="pregame overlay">
      <div className="pregame-panel">
        <p className="pregame-kicker">VibeCode Arena · Duel</p>
        <h1 className="pregame-title">Skyline Flight</h1>
        <p className="pregame-tag">
          Thread the gaps, chase the gold. A sunny run can end in a heartbeat…
        </p>

        <div className="pregame-stats">
          <div className="pregame-stat">
            <span className="pregame-stat-label">Best score</span>
            <span className="pregame-stat-value">{bestScore}</span>
          </div>
        </div>

        <div className="pregame-legend">
          <span className="legend-heading">The sky is generous — and greedy:</span>
          <div className="legend-row">
            <span className="orb orb-good" />
            <span>
              <b>Good orbs</b> shield (soak a hit), slow-mo, or +100 points.
            </span>
          </div>
          <div className="legend-row">
            <span className="orb orb-bad" />
            <span>
              <b>Cursed orbs</b> — wing damage slows you, the storm speeds the
              world, narrow skies crush your airspace. Grab them only if you can
              take the heat.
            </span>
          </div>
          <div className="legend-row">
            <span className="orb orb-mystery">?</span>
            <span>
              <b>Mystery orbs</b> flip a coin: a gift or a trap.
            </span>
          </div>
        </div>

        <div className="pregame-controls">
          <span>
            <kbd>↑</kbd>
            <kbd>↓</kbd> or <kbd>W</kbd>
            <kbd>S</kbd> climb &amp; dive
          </span>
          <span className="dot-sep">·</span>
          <span>drag / tap to steer</span>
        </div>

        <button className="btn btn-start" onClick={handleStart}>
          Start flight
        </button>
      </div>
    </div>
  );
}