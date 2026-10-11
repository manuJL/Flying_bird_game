import React, { useEffect } from 'react';
import { unlockAudio, setMuted, isMuted, sfx } from '../utils/sound';
import './../styles/RunningScreen.css';

const HUD_TICK_MS = 250;
const SYNC_TICK_MS = 1000;

// Colours for the active-effect pills. The engine reports only stable ids,
// so mapping them here keeps the HUD decoupled from the engine internals.
const FX_STYLE = {
  shield: 'fx fx-shield',
  slow: 'fx fx-slow',
  turbo: 'fx fx-turbo',
  heavy: 'fx fx-heavy',
  squash: 'fx fx-squash',
};

// The engine lives on a canvas that stays mounted for the whole app (see
// App.jsx). This screen is a pure overlay : it starts the round, reads the
// engine's stats into the DOM HUD, pushes progress to the backend, and offers
// touch controls. The 60fps loop on the canvas never touches React state.
export default function RunningScreen({ engineRef, sessionId, bestScore, baseUrl }) {
  // Kick the round off the moment this overlay mounts. `start()` is
  // idempotent, so StrictMode's dev double-mount just resets to same state.
  useEffect(() => {
    unlockAudio();
    engineRef.current?.start();
  }, [engineRef]);

  // Poll the engine for HUD numbers and active effects. The engine ref is
  // stable, so this interval lives for the whole running screen; reading
  // `bestScore` again keeps the "beating best" glow honest.
  useEffect(() => {
    const hud = {
      score: document.querySelector('[data-hud="score"]'),
      time: document.querySelector('[data-hud="time"]'),
      bonus: document.querySelector('[data-hud="bonus"]'),
      best: document.querySelector('[data-hud="best"]'),
    };
    const fxBar = document.querySelector('[data-hud="fx"]');

    if (!hud.score) return undefined;
    const id = window.setInterval(() => {
      const stats = engineRef.current?.getStats();
      if (!stats) return;

      hud.score.textContent = String(stats.score);
      hud.time.textContent = stats.elapsed.toFixed(1);
      hud.bonus.textContent = `+${stats.bonus}`;
      hud.best.textContent = String(bestScore);

      const beatingBest = stats.score > bestScore;
      hud.best.classList.toggle('hud-best-heat', beatingBest && stats.elapsed > 0);

      // Rebuild the status pills every tick (they only change on pickup).
      if (fxBar) {
        fxBar.innerHTML = '';
        for (const fx of stats.effects) {
          const pill = document.createElement('span');
          pill.className = FX_STYLE[fx.id] || 'fx';
          const left = fx.id === 'shield' ? String(fx.left) : `${Math.ceil(fx.left)}s`;
          pill.textContent = `${fx.label} ${left}`;
          fxBar.appendChild(pill);
        }
      }
    }, HUD_TICK_MS);

    return () => window.clearInterval(id);
  }, [engineRef, bestScore]);

  // Push live progress to the backend every second while a session exists, so
  // a mid-round crash still leaves a sensible score behind.
  useEffect(() => {
    if (sessionId === null) return undefined;
    const id = window.setInterval(() => {
      const stats = engineRef.current?.getStats();
      if (!stats) return;
      try {
        void fetch(`${baseUrl}/api/game-sessions/${sessionId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            elapsed_survival_seconds: stats.elapsed,
            collected_bonus_points: stats.bonus,
          }),
        });
      } catch {
        /* backend unreachable - the final PUT is authoritative anyway */
      }
    }, SYNC_TICK_MS);
    return () => window.clearInterval(id);
  }, [sessionId, engineRef, baseUrl]);

  const muteToggle = () => {
    sfx.uiClick();
    setMuted(!isMuted());
  };

  return (
    <div className="running">
      <div className="hud" role="status" aria-live="off">
        <div className="hud-left">
          <div className="hud-item hud-score">
            <span className="hud-label">Score</span>
            <span className="hud-big" data-hud="score">
              0
            </span>
          </div>
          <div className="hud-item hud-best">
            <span className="hud-label">Best</span>
            <span className="hud-big" data-hud="best">
              {bestScore}
            </span>
          </div>
        </div>

        <div className="hud-center">
          <div className="hud-item hud-time">
            <span className="hud-label">Flight time</span>
            <span className="hud-big" data-hud="time">
              0.0
            </span>
          </div>
        </div>

        <div className="hud-right">
          <div className="hud-item hud-bonus">
            <span className="hud-label">Bonus</span>
            <span className="hud-big" data-hud="bonus">
              +0
            </span>
          </div>
          <button
            className="hud-mute"
            type="button"
            onClick={muteToggle}
            aria-label="Toggle sound"
          >
            {isMuted() ? 'Muted' : 'Sound'}
          </button>
        </div>
      </div>

      <div className="hud-fx" data-hud="fx" />

      <div className="touch-controls" aria-label="Flight controls">
        <button
          className="touch-btn touch-up"
          type="button"
          aria-label="Fly up"
          onPointerDown={(e) => engineRef.current?.setButton('up', true)}
          onPointerUp={() => engineRef.current?.setButton('up', false)}
          onPointerLeave={() => engineRef.current?.setButton('up', false)}
          onPointerCancel={() => engineRef.current?.setButton('up', false)}
          onContextMenu={(e) => e.preventDefault()}
        >
          &#8593;
        </button>
        <button
          className="touch-btn touch-down"
          type="button"
          aria-label="Fly down"
          onPointerDown={(e) => engineRef.current?.setButton('down', true)}
          onPointerUp={() => engineRef.current?.setButton('down', false)}
          onPointerLeave={() => engineRef.current?.setButton('down', false)}
          onPointerCancel={() => engineRef.current?.setButton('down', false)}
          onContextMenu={(e) => e.preventDefault()}
        >
          &#8595;
        </button>
      </div>
    </div>
  );
}