import React from 'react';
import { unlockAudio, sfx } from '../utils/sound';
import './../styles/GameOverScreen.css';

export default function GameOverScreen({ finalScore, bestScore, isNewBest, stats, onPlayAgain }) {
  const handleAgain = () => {
    sfx.uiClick();
    unlockAudio();
    onPlayAgain();
  };

  return (
    <div className="gameover overlay">
      <div className="gameover-panel">
        <p className="gameover-kicker">End of flight</p>

        {isNewBest && (
          <div className="gameover-best-badge">New best!</div>
        )}

        <div className="gameover-score">
          <span className="gameover-score-label">Final score</span>
          <span className="gameover-score-value">{finalScore}</span>
        </div>

        <div className="gameover-breakdown">
          <span>
            <b>{stats.elapsed.toFixed(1)}s</b> in the air
          </span>
          <span className="dot-sep">·</span>
          <span>
            <b>+{stats.bonus}</b> bonus
          </span>
        </div>

        <div className="gameover-best">
          Best score <b>{bestScore}</b>
        </div>

        <button className="btn btn-start" onClick={handleAgain}>
          Fly again
        </button>
      </div>
    </div>
  );
}