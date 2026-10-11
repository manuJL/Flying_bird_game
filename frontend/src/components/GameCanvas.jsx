import React, { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { sfx, unlockAudio } from '../utils/sound';
import { sprite } from '../sprites';

// ---------------------------------------------------------------------------
// Skyline Flight game engine.
//
// Everything the player sees is drawn on a single <canvas>. React only owns
// the shell; the game loop lives below in a mutable object held by refs so the
// 60fps path never has to go through React reconciliation.
//
// Two "modes":
//   * attract  - the menu/idle backdrop. The plane bobs gently, no obstacles.
//   * running  - the actual round, started by the parent via ref.start().
//   * dying/over - the crash pop then the frozen wreckage behind the overlay.
// ---------------------------------------------------------------------------

const PLANE_W = 52;
const PLANE_H = 34;

const MAX_PARTICLES = 160;

// Time of day shifts as you survive: dawn -> day -> dusk. It is a cheap,
// always-on signal that the difficulty is climbing without the player having
// to read anything.
const SKY = {
  dawn: { top: '#e89b9b', mid: '#ffc9a3', low: '#ffe6c0' },
  day: { top: '#3aa8e8', mid: '#7cc6ee', low: '#cfeef9' },
  dusk: { top: '#6c3f96', mid: '#b26a9c', low: '#f2a16b' },
};

const REDUCED_MOTION =
  typeof window !== 'undefined' &&
  !!window.matchMedia &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;

function AABB(a, b) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

// Small colour helpers for the sky gradient blending.
function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}
function mixHex(a, b, t) {
  const A = hexToRgb(a);
  const B = hexToRgb(b);
  const r = Math.round(lerp(A.r, B.r, t));
  const g = Math.round(lerp(A.g, B.g, t));
  const bl = Math.round(lerp(A.b, B.b, t));
  return `rgb(${r},${g},${bl})`;
}
function skyColors(time) {
  let top;
  let mid;
  let low;
  if (time < 6) {
    const t = time / 6;
    top = mixHex(SKY.dawn.top, SKY.day.top, t);
    mid = mixHex(SKY.dawn.mid, SKY.day.mid, t);
    low = mixHex(SKY.dawn.low, SKY.day.low, t);
  } else if (time < 80) {
    top = SKY.day.top;
    mid = SKY.day.mid;
    low = SKY.day.low;
  } else {
    const t = clamp((time - 80) / 50, 0, 1);
    top = mixHex(SKY.day.top, SKY.dusk.top, t);
    mid = mixHex(SKY.day.mid, SKY.dusk.mid, t);
    low = mixHex(SKY.day.low, SKY.dusk.low, t);
  }
  return { top, mid, low };
}

const GameCanvas = forwardRef(function GameCanvas({ onGameOver }, ref) {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const parent = canvas.parentElement;
    const ctx = canvas.getContext('2d');

    let W = 0;
    let H = 0;
    let raf = 0;
    let lastTs = 0;
    let running = true;
    let died = false; // guards the single onGameOver call per round

    const G = {
      phase: 'attract',
      time: 0,
      bonus: 0,
      coinChain: 0,
      lastCoinAt: -10,
      scale: 1,
      player: { x: 0, y: 0, vy: 0 },
      input: { up: false, down: false, touch: null, dragY: null },
      obstacles: [],
      coins: [],
      pickups: [],
      particles: [],
      floaters: [],
      bgClouds: [],
      groundOffset: 0,
      shake: 0,
      flash: 0,
      freeze: 0,
      gone: false,
      spawnGapTimer: 0,
      spawnDodgeTimer: 0,
      spawnPickupTimer: 2.5,
      // Active status effects. Shield is a charge counter, the rest are
      // countdown timers in seconds. `invuln` is the brief mercy window
      // right after a shield soak.
      effects: { shield: 0, invuln: 0, slow: 0, turbo: 0, heavy: 0, squash: 0 },
    };

    const groundH = () => 70 * G.scale;
    const playerW = () => PLANE_W * G.scale;
    const playerH = () => PLANE_H * G.scale;
    const maxV = () => 560 * G.scale;
    // World scroll speed. Power-ups can bend it briefly: slow-mo eases
    // everything, the storm (a curse) makes it surge.
    const speed = () => {
      const base = Math.min(300 * G.scale + G.time * 7 * G.scale, 760 * G.scale);
      const mult = (G.effects.slow > 0 ? 0.55 : 1) * (G.effects.turbo > 0 ? 1.32 : 1);
      return base * mult;
    };
    const spawnInterval = () => Math.max(0.8, 1.7 - G.time * 0.012);

    function initSky() {
      G.bgClouds = [];
      for (let i = 0; i < 9; i++) {
        G.bgClouds.push({
          x: Math.random(),
          y: 0.08 + Math.random() * 0.55,
          s: 0.5 + Math.random() * 1.1,
          sp: 0.12 + Math.random() * 0.2,
        });
      }
    }

    // ---------- round lifecycle ----------

    function placePlayer() {
      G.player = {
        x: Math.max(70 * G.scale, W * 0.18),
        y: H * 0.42,
        vy: 0,
      };
    }

    function startRound() {
      G.phase = 'running';
      G.time = 0;
      G.bonus = 0;
      G.coinChain = 0;
      G.lastCoinAt = -10;
      G.shake = 0;
      G.flash = 0;
      G.freeze = 0;
      G.gone = false;
      G.obstacles = [];
      G.coins = [];
      G.pickups = [];
      G.particles = [];
      G.floaters = [];
      G.spawnGapTimer = 1.2;
      G.spawnDodgeTimer = 2.8;
      G.spawnPickupTimer = 2.5;
      G.effects.shield = 0;
      G.effects.invuln = 0;
      G.effects.slow = 0;
      G.effects.turbo = 0;
      G.effects.heavy = 0;
      G.effects.squash = 0;
      G.input.up = false;
      G.input.down = false;
      G.input.touch = null;
      G.input.dragY = null;
      died = false;
      placePlayer();
      popText(G.player.x + 46 * G.scale, G.player.y - 34 * G.scale, 'GO!', '#ffffff', 26 * G.scale);
      sfx.takeoff();
    }

    function roundStats() {
      return {
        elapsed: Math.round(G.time * 100) / 100,
        bonus: G.bonus,
        score: Math.floor(G.time) + G.bonus,
        effects: effectsList(),
      };
    }

    // Fine-grained status for the HUD pills (RunningScreen). `left` is used
    // for both the countdown seconds and the shield charge count.
    function effectsList() {
      const out = [];
      if (G.effects.shield > 0) out.push({ id: 'shield', label: 'SHIELD', left: G.effects.shield, max: 2 });
      for (const [id, label] of [
        ['slow', 'SLOW-MO'],
        ['turbo', 'STORM'],
        ['heavy', 'WING DMG'],
        ['squash', 'NARROW'],
      ]) {
        if (G.effects[id] > 0) out.push({ id, label, left: G.effects[id], max: 5 });
      }
      return out;
    }

    // ---------- particles & floating text ----------

    function pushParticle(p) {
      if (REDUCED_MOTION && p.reduced !== false) return;
      if (G.particles.length >= MAX_PARTICLES) G.particles.splice(0, G.particles.length - MAX_PARTICLES);
      G.particles.push(p);
    }

    function popText(x, y, text, color, size) {
      G.floaters.push({ x, y, text, color, size, life: 1, max: 1 });
    }

    function burst(x, y, count, colors, spread) {
      const n = REDUCED_MOTION ? Math.floor(count / 2) : count;
      for (let i = 0; i < n; i++) {
        const a = (Math.PI * 2 * i) / n + Math.random() * 0.7;
        const mag = (spread * (0.5 + Math.random() * 0.6)) * G.scale;
        pushParticle({
          x,
          y,
          vx: Math.cos(a) * mag,
          vy: Math.sin(a) * mag - 60 * G.scale,
          life: 0.5 + Math.random() * 0.5,
          max: 1,
          size: (2 + Math.random() * 4.5) * G.scale,
          color: colors[i % colors.length],
        });
      }
    }

    function explode(x, y) {
      burst(x, y, 42, ['#ffd166', '#f4845f', '#ef476f', '#ffd166', '#ffffff'], 420);
      burst(x, y, 10, ['#ff9f1c', '#e63946', '#6c3f96'], 260);
    }

    // ---------- spawning ----------

    function spawnGapObstacle() {
      // Gaps are anchored inside the current flight lane. If "narrow skies" is
      // active the lane shrinks, so both the gap and the player follow the
      // same rules - challenging but always fair.
      const lane = laneBounds();
      const margin = 90 * G.scale;
      const usable = lane.bottom - lane.top - margin * 2;
      if (usable < playerH() * 3.2) return;

      const gapFactor = Math.max(0.3, 1 - G.time * 0.007 - 0.08);
      const nominal = Math.max(playerH() * 3.1, (H - groundH()) * 0.3 * gapFactor);
      const gapPx = clamp(nominal, playerH() * 3.0, usable * 0.72);

      const cmin = lane.top + margin + gapPx / 2;
      const cmax = lane.bottom - margin - gapPx / 2;
      if (cmin >= cmax) return;
      const center = cmin + Math.random() * (cmax - cmin);
      const w = (64 + Math.random() * 32) * G.scale;
      const roll = Math.random();
      const kind = roll < 0.42 ? 'mountain' : roll < 0.76 ? 'building' : 'stormwall';

      G.obstacles.push({
        kind,
        x: W + 40,
        w,
        topH: center - gapPx / 2,
        bottomH: center + gapPx / 2,
        passed: false,
        closeCall: false,
        hue: kind === 'building' ? 22 : kind === 'mountain' ? 178 : 265,
      });

      // A little bonus trail of coins lives inside the opening sometimes.
      if (Math.random() < 0.55) {
        const count = Math.random() < 0.3 ? 2 : 1;
        for (let i = 0; i < count; i++) {
          G.coins.push({
            x: W + 40 + (i % 2 === 0 ? 0 : 48 * G.scale),
            y: center + (i === 0 ? -gapPx / 4 : gapPx / 4),
            r: 13 * G.scale,
            t: Math.random() * Math.PI * 2,
          });
        }
      }
    }

    function spawnFlyingObstacle() {
      const lane = laneBounds();
      const range = Math.max(0, lane.bottom - lane.top - 140 * G.scale);
      const y0 = lane.top + 60 * G.scale + Math.random() * range;
      const isPlane = Math.random() < 0.55;
      G.obstacles.push({
        kind: isPlane ? 'enemy' : 'cloud',
        x: W + 60,
        y: y0,
        baseY: y0,
        w: (isPlane ? 58 : 84) * G.scale,
        h: (isPlane ? 36 : 46) * G.scale,
        vy: (Math.random() * 70 - 35) * G.scale,
        amp: (14 + Math.random() * 30) * G.scale,
        freq: 1.2 + Math.random() * 1.4,
        ph: Math.random() * Math.PI * 2,
        passed: false,
        closeCall: false,
      });
    }

    // ---------- pickups (power-ups AND curses) ----------
    //
    // Every pickup is telegraphed before you commit: green/cyan means it
    // helps you, orange/red means touching it hurts, and the purple "?" is a
    // coin flip. The whole tension of the game comes from choosing which orbs
    // to dive for while threading the gaps.
    //
    //   SHIELD        hops onto a shield charge that soaks one hit.
    //   SLOW-MO       the world crawls for a few seconds - free breathing room.
    //   +100          instant bonus, nudges the score with no risk.
    //   WING DAMAGE   your engine feels heavy: lower top speed + a constant
    //                 downward sag while it lasts. (the "lower speed")
    //   NARROW SKIES  the playable lane collapses toward the middle, so you
    //                 have far less height to work with. (the "lower height")
    //   STORM         the storm whips up: everything scrolls ~30% faster.
    const PICKUP_META = {
      shield: { label: 'SHIELD', color: '#38c6ff', icon: 'shield' },
      slow: { label: 'SLOW-MO', color: '#4ade80', icon: 'slow' },
      gold: { label: '+100', color: '#ffd166', icon: 'gold' },
      heavy: { label: 'WING DMG', color: '#f43f5e', icon: 'heavy' },
      turbo: { label: 'STORM', color: '#fb923c', icon: 'turbo' },
      squash: { label: 'NARROW', color: '#ff7a59', icon: 'squash' },
      mystery: { label: '?', color: '#a855f7', icon: 'mystery' },
    };
    const GOOD_KINDS = ['shield', 'slow', 'gold'];
    const BAD_KINDS = ['heavy', 'turbo', 'squash'];

    // The vertical band the player can actually fly in. Curses that "lower the
    // ceiling" simply narrow this band; everything (player, spawns) clamps to
    // it, so the danger reads as genuinely less room instead of broken hitboxes.
    function laneBounds() {
      const gh = groundH();
      let top = playerH() / 2 + 8;
      let bottom = H - gh - playerH() / 2 - 8;
      if (G.effects.squash > 0) {
        const cy = (top + bottom) / 2;
        const half = (bottom - top) * 0.34;
        top = Math.max(playerH() / 2 + 4, cy - half);
        bottom = Math.min(H - gh - playerH() / 2 - 4, cy + half);
      }
      return { top, bottom };
    }

    function spawnPickup() {
      const lane = laneBounds();
      const usable = lane.bottom - lane.top;
      if (usable < 120 * G.scale) return;
      const roll = Math.random();
      let kind;
      let good;
      if (roll < 0.2) {
        kind = 'mystery';
        good = null; // not revealed yet
      } else if (roll < 0.6) {
        kind = GOOD_KINDS[Math.floor(Math.random() * GOOD_KINDS.length)];
        good = true;
      } else {
        kind = BAD_KINDS[Math.floor(Math.random() * BAD_KINDS.length)];
        good = false;
      }
      G.pickups.push({
        kind,
        good,
        x: W + 40,
        y: lane.top + 44 * G.scale + Math.random() * Math.max(0, usable - 88 * G.scale),
        r: 17 * G.scale,
        t: Math.random() * Math.PI * 2,
      });
    }

    function rollMystery() {
      return Math.random() < 0.5
        ? GOOD_KINDS[Math.floor(Math.random() * GOOD_KINDS.length)]
        : BAD_KINDS[Math.floor(Math.random() * BAD_KINDS.length)];
    }

    function applyPickup(pk) {
      const finalKind = pk.kind === 'mystery' ? rollMystery() : pk.kind;
      const meta = PICKUP_META[finalKind];
      const px = pk.x;
      const py = pk.y;
      const good = finalKind !== 'heavy' && finalKind !== 'turbo' && finalKind !== 'squash';

      switch (finalKind) {
        case 'shield':
          G.effects.shield = Math.min(2, G.effects.shield + 1);
          sfx.power();
          break;
        case 'slow':
          G.effects.slow = 3.2;
          sfx.power();
          break;
        case 'gold':
          G.bonus += 100;
          sfx.power();
          break;
        case 'heavy':
          G.effects.heavy = 4;
          sfx.curse();
          break;
        case 'turbo':
          G.effects.turbo = 4;
          sfx.curse();
          break;
        case 'squash':
          G.effects.squash = 4.2;
          sfx.curse();
          break;
        default:
          return;
      }

      popText(px, py - 26 * G.scale, meta.label, meta.color, 22 * G.scale);
      burst(px, py, 16, good ? ['#4ade80', '#38c6ff', '#ffffff'] : ['#f43f5e', '#fb923c', '#ffffff'], 190);
    }

    // ---------- player movement ----------

    function movePlayer(dt) {
      const p = G.player;
      // Wing damage: the engine just won't haul like it used to, and the
      // plane sags downward the whole time.
      const sluggish = G.effects.heavy > 0;
      const acc = 2400 * G.scale * (sluggish ? 0.62 : 1);
      const vMax = maxV() * (sluggish ? 0.62 : 1);
      const lane = laneBounds();

      if (G.input.touch !== null) {
        const target = clamp(G.input.touch, lane.top, lane.bottom);
        const wanted = clamp((target - p.y) * 9, -vMax, vMax);
        p.vy = lerp(p.vy, wanted, Math.min(1, 12 * dt));
      } else {
        if (G.input.up) p.vy -= acc * dt;
        if (G.input.down) p.vy += acc * dt;
        if (!G.input.up && !G.input.down) p.vy *= Math.max(0, 1 - 6 * dt);
        p.vy = clamp(p.vy, -vMax, vMax);
      }

      if (sluggish) p.vy += 120 * G.scale * dt;

      p.y += p.vy * dt;
      if (p.y < lane.top) {
        p.y = lane.top;
        p.vy = Math.max(0, p.vy);
      }
      if (p.y > lane.bottom) {
        p.y = lane.bottom;
        p.vy = Math.min(0, p.vy);
      }
    }

    // ---------- collisions ----------

    function playerBox() {
      const p = G.player;
      const w = playerW();
      const h = playerH();
      // Generous inset both ways - the plane sprite has a lot of white nose;
      // only the fuselage really counts.
      return {
        x: p.x - w / 2 + w * 0.22,
        y: p.y - h / 2 + h * 0.24,
        w: w * 0.56 + 2,
        h: h * 0.52,
      };
    }

    function checkCollisions() {
      const pb = playerBox();
      const p = G.player;

      // During the brief mercy window after a shield soak the plane is
      // unhittable, but it can still collect coins and pickups.
      if (G.effects.invuln <= 0) {
        for (let i = 0; i < G.obstacles.length; i++) {
          const o = G.obstacles[i];
          const rects =
            o.kind === 'enemy' || o.kind === 'cloud'
              ? [{ x: o.x, y: o.y, w: o.w, h: o.h }]
              : [
                  { x: o.x, y: -60, w: o.w, h: o.topH + 60 },
                  { x: o.x, y: o.bottomH, w: o.w, h: H - o.bottomH + 60 },
                ];

          if (rects.some((r) => AABB(pb, r))) {
            if (G.effects.shield > 0 && !G.gone) {
              // The shield absorbs the hit: shatter the obstacle and grant a
              // brief blink-of-mercy so the wreckage can't re-tag you.
              G.effects.shield--;
              G.effects.invuln = 0.9;
              const hx = o.x + o.w / 2;
              const hy = o.kind === 'enemy' || o.kind === 'cloud' ? o.y + o.h / 2 : p.y;
              explode(hx, hy);
              popText(p.x, p.y - 40 * G.scale, 'SHIELD!', '#38c6ff', 24 * G.scale);
              G.shake = Math.max(G.shake, 0.3);
              G.flash = Math.max(G.flash, 0.35);
              G.obstacles.splice(i, 1);
              i--;
            } else {
              crash();
            }
            return;
          }

          if (!o.passed && o.x + o.w < p.x) {
            o.passed = true;
            if (o.kind === 'enemy' || o.kind === 'cloud') continue;
            // Reward a clean, narrow squeeze through a gap with a whoosh.
            const clearance = Math.min(p.y - o.topH, o.bottomH - p.y);
            if (clearance < 44 * G.scale) {
              o.closeCall = true;
              sfx.whoosh();
            }
          }
        }
      }

      for (let i = 0; i < G.coins.length; i++) {
        const c = G.coins[i];
        if (Math.abs(p.x - c.x) < playerW() / 2 + c.r && Math.abs(p.y - c.y) < playerH() / 2 + c.r) {
          G.bonus += 50;
          const now = G.time;
          G.coinChain = now - G.lastCoinAt < 2 ? G.coinChain + 1 : 1;
          G.lastCoinAt = now;
          sfx.coin(G.coinChain);
          popText(c.x, c.y - 22 * G.scale, '+50', '#ffe066', 24 * G.scale);
          burst(c.x, c.y, 12, ['#ffd166', '#f4d03f', '#ffffff', '#f9ca24'], 150);
          G.coins.splice(i, 1);
          i--;
        }
      }

      for (let i = 0; i < G.pickups.length; i++) {
        const pk = G.pickups[i];
        if (Math.abs(p.x - pk.x) < playerW() / 2 + pk.r && Math.abs(p.y - pk.y) < playerH() / 2 + pk.r) {
          applyPickup(pk);
          G.pickups.splice(i, 1);
          i--;
        }
      }
    }

    function crash() {
      if (G.gone) return;
      G.gone = true;
      G.phase = 'dying';
      G.freeze = REDUCED_MOTION ? 0.02 : 0.09; // a beat of hitstop sells the hit
      G.shake = REDUCED_MOTION ? 0.15 : 0.6;
      G.flash = 1;
      explode(G.player.x, G.player.y);
      sfx.crash();

      const stats = roundStats();
      setTimeout(() => {
        G.phase = 'over';
        G.flash = 0;
        if (!died && onGameOver) {
          died = true;
          sfx.gameOver();
          onGameOver(stats);
        }
      }, 300);
    }

    // ---------- simulation ----------

    function update(dt, rawDt) {
      // Hitstop: during the freeze the world holds still but shake/particles
      // keep ticking so the frame of impact lingers.
      if (G.freeze > 0) {
        G.freeze -= rawDt;
        updateParticles(rawDt);
        G.shake = Math.max(0, G.shake - rawDt);
        return;
      }

      if (G.phase === 'running') {
        G.time += dt;
        movePlayer(dt);

        // Count down the active effects; invuln is a short window, the rest
        // are the timed powers/curses.
        for (const key of ['slow', 'turbo', 'heavy', 'squash', 'invuln']) {
          if (G.effects[key] > 0) G.effects[key] = Math.max(0, G.effects[key] - dt);
        }

        G.spawnGapTimer -= dt;
        if (G.spawnGapTimer <= 0) {
          spawnGapObstacle();
          G.spawnGapTimer = spawnInterval();
        }
        G.spawnDodgeTimer -= dt;
        if (G.spawnDodgeTimer <= 0) {
          spawnFlyingObstacle();
          G.spawnDodgeTimer = Math.max(0.7, 1 + Math.random() * 1.6 - G.time * 0.008);
        }
        G.spawnPickupTimer -= dt;
        if (G.spawnPickupTimer <= 0) {
          spawnPickup();
          G.spawnPickupTimer = 6 + Math.random() * 3;
        }

        const spd = speed();
        for (const o of G.obstacles) {
          o.x -= spd * dt;
          if (o.kind === 'enemy' || o.kind === 'cloud') {
            o.baseY += o.vy * dt;
            if (o.baseY < 60 * G.scale) o.vy = Math.abs(o.vy);
            if (o.baseY > H - groundH() - o.h) o.vy = -Math.abs(o.vy);
            o.y = o.baseY + Math.sin(G.time * o.freq + o.ph) * o.amp;
          }
        }
        for (const c of G.coins) c.x -= spd * dt;
        for (const pk of G.pickups) pk.x -= spd * dt;
        G.groundOffset = (G.groundOffset + spd * dt) % 40;

        // A lazy white contrail streams off the tail.
        if (Math.random() < 0.5) {
          pushParticle({
            x: G.player.x - playerW() * 0.55,
            y: G.player.y + (Math.random() - 0.5) * 4 * G.scale,
            vx: -spd * 0.6,
            vy: (Math.random() - 0.5) * 20 * G.scale,
            life: 0.5,
            max: 0.5,
            size: (2 + Math.random() * 2.5) * G.scale,
            color: 'rgba(255,255,255,0.75)',
            reduced: false,
          });
        }

        checkCollisions();
        G.obstacles = G.obstacles.filter((o) => o.x + o.w > -80);
        G.coins = G.coins.filter((c) => c.x > -40);
        G.pickups = G.pickups.filter((pk) => pk.x > -60);
      } else if (G.phase === 'attract' || G.phase === 'over') {
        G.groundOffset = (G.groundOffset + 60 * G.scale * dt) % 40;
        G.player.y += Math.sin(G.time * 0.9) * 22 * G.scale * dt;
      }

      updateParticles(dt);
      updateFloaters(dt);
      G.shake = Math.max(0, G.shake - dt);
      G.flash = Math.max(0, G.flash - dt * 2.2);
    }

    function updateParticles(dt) {
      for (const pt of G.particles) {
        pt.life -= dt;
        pt.x += pt.vx * dt;
        pt.y += pt.vy * dt;
        pt.vy += 240 * G.scale * dt; // gravity gives the debris an arc
      }
      G.particles = G.particles.filter((p) => p.life > 0);
    }

    function updateFloaters(dt) {
      for (const f of G.floaters) {
        f.life -= dt;
        f.y -= 34 * G.scale * dt;
      }
      G.floaters = G.floaters.filter((f) => f.life > 0);
    }

    // ---------- drawing ----------

    function drawSky() {
      const s = skyColors(G.time);
      const grad = ctx.createLinearGradient(0, 0, 0, H);
      grad.addColorStop(0, s.top);
      grad.addColorStop(0.55, s.mid);
      grad.addColorStop(1, s.low);
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, W, H);

      // Sun with a soft halo. Its warmth follows the time of day.
      const sunX = W * 0.78;
      const sunY = H * 0.2;
      const sunColor = G.time > 80 ? '#ffb14a' : '#fff3b0';
      const halo = ctx.createRadialGradient(sunX, sunY, 0, sunX, sunY, 150 * G.scale);
      halo.addColorStop(0, 'rgba(255,230,130,0.9)');
      halo.addColorStop(0.3, 'rgba(255,214,90,0.45)');
      halo.addColorStop(1, 'rgba(255,214,90,0)');
      ctx.fillStyle = halo;
      ctx.fillRect(sunX - 150 * G.scale, sunY - 150 * G.scale, 300 * G.scale, 300 * G.scale);
      ctx.beginPath();
      ctx.arc(sunX, sunY, 34 * G.scale, 0, Math.PI * 2);
      ctx.fillStyle = sunColor;
      ctx.fill();
    }

    function drawBgClouds(parallax) {
      ctx.fillStyle = 'rgba(255,255,255,0.88)';
      for (const c of G.bgClouds) {
        const span = W + 300;
        const cx = (((c.x * W + G.time * 26 * G.scale * c.sp * parallax) % span) + span) % span - 150;
        const cy = c.y * H;
        const s = 46 * G.scale * c.s;
        for (let i = 0; i < 4; i++) {
          const ang = (i / 4) * Math.PI * 2;
          ctx.beginPath();
          ctx.arc(cx + Math.cos(ang) * s * 0.5, cy + Math.sin(ang) * s * 0.32 + s * 0.12, s * (0.55 + (i % 2) * 0.2), 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }

    function drawDistantMountains() {
      ctx.fillStyle = 'rgba(96,145,168,0.55)';
      ctx.beginPath();
      ctx.moveTo(0, H - groundH());
      const step = W / 12;
      for (let i = 0; i <= 12; i++) {
        const x = i * step;
        const y = H - groundH() - (Math.sin((i + G.groundOffset / 120) * 1.7) * 0.5 + 0.5) * 90 * G.scale - 20 * G.scale;
        ctx.lineTo(x, y);
      }
      ctx.lineTo(W, H - groundH());
      ctx.closePath();
      ctx.fill();
    }

    function drawGround() {
      const gh = groundH();
      const gy = H - gh;

      // Kenney's hand-drawn grass strip replaces the flat gradient ground.
      // It is 808px wide, so one full draw tiles the whole screen.
      const tile = sprite('ground');
      if (tile) {
        ctx.drawImage(tile, 0, gy, W, gh);
        const grad = ctx.createLinearGradient(0, gy, 0, H);
        grad.addColorStop(0, 'rgba(30,70,40,0.14)');
        grad.addColorStop(1, 'rgba(16,40,24,0.4)');
        ctx.fillStyle = grad;
        ctx.fillRect(0, gy, W, gh);
        return;
      }

      const grad = ctx.createLinearGradient(0, gy, 0, H);
      grad.addColorStop(0, '#59a85a');
      grad.addColorStop(0.35, '#3f8a4a');
      grad.addColorStop(1, '#2b6b3a');
      ctx.fillStyle = grad;
      ctx.fillRect(0, gy, W, gh);
      ctx.fillStyle = 'rgba(0,0,0,0.18)';
      ctx.fillRect(0, gy, W, 4);
      ctx.strokeStyle = 'rgba(255,255,255,0.75)';
      ctx.lineWidth = 3 * G.scale;
      const dash = 40 * G.scale;
      ctx.beginPath();
      for (let i = -1; i < W / dash + 1; i++) {
        const x = i * dash - G.groundOffset;
        ctx.moveTo(x, gy + gh * 0.45);
        ctx.lineTo(x + dash * 0.55, gy + gh * 0.45);
      }
      ctx.stroke();
    }

    // Thin white streaks near the player's speed, only at pace. They make the
    // ramp in difficulty physically felt instead of merely read as "faster".
    function drawSpeedLines(spd) {
      const pace = clamp((spd - 320 * G.scale) / (440 * G.scale), 0, 1);
      if (pace <= 0.02) return;
      ctx.strokeStyle = `rgba(255,255,255,${0.16 * pace})`;
      ctx.lineWidth = 2 * G.scale;
      for (let i = 0; i < 5; i++) {
        const seed = (i * 137.5 + G.time * (60 + 30 * pace)) % 500;
        const y = ((seed / 500) * (H - groundH())) + 20 * G.scale;
        const off = ((seed * 13) % (W + 160)) - 80;
        const len = (50 + ((seed * 7) % 90)) * G.scale * (0.6 + pace * 0.6);
        ctx.beginPath();
        ctx.moveTo(off, y);
        ctx.lineTo(off - len, y);
        ctx.stroke();
      }
    }

    function drawBuilding(x, y, w, h, hue) {
      ctx.fillStyle = `hsl(${hue}, 38%, 62%)`;
      ctx.fillRect(x, y, w, h);
      ctx.fillStyle = `hsl(${hue}, 40%, 50%)`;
      ctx.fillRect(x, y + h * 0.25, w, h * 0.75);
      ctx.fillStyle = 'rgba(255,255,255,0.7)';
      const rw = w * 0.16;
      const rh = h * 0.09;
      const rowGap = rh * 1.4;
      let col = 2;
      while (col * (rw + 3) < w - 6) {
        let yy = h * 0.2;
        let row = 0;
        while (yy + rh < h) {
          if ((row + col) % 4 !== 0) ctx.fillRect(x + col * (rw + 3), y + yy, rw, rh);
          yy += rowGap;
          row++;
        }
        col++;
      }
    }

    function drawMountain(x, y, w, h, hue) {
      const grad = ctx.createLinearGradient(0, y, 0, y + h);
      grad.addColorStop(0, `hsl(${hue}, 45%, 62%)`);
      grad.addColorStop(1, `hsl(${hue}, 45%, 38%)`);
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.moveTo(x, y + h);
      ctx.lineTo(x + w * 0.18, y + h * 0.72);
      ctx.lineTo(x + w * 0.34, y + h * 0.3);
      ctx.lineTo(x + w * 0.5, y + h * 0.38);
      ctx.lineTo(x + w * 0.64, y + h * 0.34);
      ctx.lineTo(x + w * 0.84, y + h * 0.7);
      ctx.lineTo(x + w, y + h * 0.55);
      ctx.lineTo(x + w, y + h);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.5)';
      ctx.beginPath();
      ctx.moveTo(x + w * 0.3, y + h * 0.46);
      ctx.lineTo(x + w * 0.34, y + h * 0.3);
      ctx.lineTo(x + w * 0.5, y + h * 0.38);
      ctx.lineTo(x + w * 0.45, y + h * 0.4);
      ctx.lineTo(x + w * 0.36, y + h * 0.55);
      ctx.closePath();
      ctx.fill();
    }

    function drawStormWall(x, y, w, h, hue) {
      ctx.fillStyle = `hsl(${hue}, 34%, 46%)`;
      ctx.fillRect(x, y, w, h);
      ctx.fillStyle = 'rgba(255,255,255,0.14)';
      for (let i = 0; i < h / (54 * G.scale); i++) {
        const yy = y + i * 54 * G.scale;
        ctx.beginPath();
        ctx.moveTo(x, yy + 8);
        ctx.lineTo(x + w, yy - 26 * G.scale + 8);
        ctx.lineTo(x + w - 6, yy - 26 * G.scale);
        ctx.lineTo(x + 6, yy);
        ctx.closePath();
        ctx.fill();
      }
    }

    function drawEnemyPlane(cx, cy, wob) {
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(Math.sin(wob) * 0.08);
      ctx.scale(-1, 1);
      const s = G.scale;

      // Kenney's red paper plane. The scale(-1,1) flip points its nose back
      // at the player.
      const red = sprite('planeRed1');
      if (red) {
        const flapSeq = [1, 2, 1, 3];
        const im = sprite(`planeRed${flapSeq[Math.floor(G.time * 8) % 4]}`);
        const dw = 58 * G.scale * 1.18;
        const dh = dw * (73 / 88);
        ctx.shadowColor = 'rgba(0,0,0,0.3)';
        ctx.shadowBlur = 8 * s;
        ctx.shadowOffsetY = 3 * s;
        if (im) ctx.drawImage(im, -dw / 2, -dh / 2, dw, dh);
        ctx.restore();
        return;
      }

      ctx.fillStyle = '#8d8f94';
      ctx.beginPath();
      ctx.ellipse(0, 0, 24 * s, 11 * s, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#3f4247';
      ctx.beginPath();
      ctx.ellipse(-8 * s, -4 * s, 6 * s, 9 * s, -0.15, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(-8 * s, 4 * s, 5 * s, 8 * s, 0.15, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#d62828';
      ctx.beginPath();
      ctx.arc(14 * s, 0, 4.5 * s, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    function drawStormCloud(cx, cy, r) {
      ctx.save();
      ctx.translate(cx, cy);
      const s = G.scale;

      // Kenney's cloud puff does the wispy bulk; the bolt is kept procedural
      // so the hazard reads instantly at speed.
      const puff = sprite('cloud');
      if (puff) {
        const size = r * 1.9;
        ctx.globalAlpha = 0.94;
        ctx.drawImage(puff, -size / 2, -size / 2, size, size);
        ctx.globalAlpha = 1;
        paintStormBolt(r);
        ctx.restore();
        return;
      }

      ctx.fillStyle = '#5f6a78';
      for (let i = 0; i < 6; i++) {
        ctx.beginPath();
        const a = (i / 6) * Math.PI * 2;
        ctx.arc(Math.cos(a) * r * 0.45, Math.sin(a) * r * 0.28 + r * 0.1, r * 0.72, 0, Math.PI * 2);
        ctx.fill();
      }
      paintStormBolt(r);
      ctx.restore();
    }

    // The little yellow bolt that gives storm clouds their sting.
    function paintStormBolt(r) {
      const s = G.scale;
      ctx.fillStyle = '#ffd166';
      ctx.beginPath();
      ctx.moveTo(r * 0.25, -r * 0.25);
      ctx.lineTo(r * 0.25 + 9 * s, -r * 0.25 - 12 * s);
      ctx.lineTo(r * 0.25 + 3 * s, -r * 0.25 - 12 * s);
      ctx.lineTo(r * 0.25 + 3 * s, -r * 0.25 - 24 * s);
      ctx.lineTo(r * 0.25 - 3 * s, -r * 0.25 - 15 * s);
      ctx.lineTo(r * 0.25 - 9 * s, -r * 0.25 - 15 * s);
      ctx.lineTo(r * 0.25 - 3 * s, -r * 0.25 - 3 * s);
      ctx.closePath();
      ctx.fill();
    }

    function drawObstacle(o) {
      ctx.save();
      ctx.shadowColor = 'rgba(0,0,0,0.25)';
      ctx.shadowBlur = 8 * G.scale;
      if (o.kind === 'enemy') {
        drawEnemyPlane(o.x + o.w / 2, o.y + o.h / 2, G.time * o.freq + o.ph);
      } else if (o.kind === 'cloud') {
        drawStormCloud(o.x + o.w / 2, o.y + o.h / 2, o.w * 0.6);
      } else if (o.kind === 'mountain') {
        drawMountain(o.x, -40, o.w, o.topH + 40, o.hue);
        drawMountain(o.x, o.bottomH, o.w, H - o.bottomH + 40, o.hue);
      } else if (o.kind === 'building') {
        drawBuilding(o.x, -20, o.w, o.topH + 20, o.hue);
        drawBuilding(o.x, o.bottomH, o.w, H - o.bottomH + 20, o.hue);
      } else {
        drawStormWall(o.x, -20, o.w, o.topH + 20, o.hue);
        drawStormWall(o.x, o.bottomH, o.w, H - o.bottomH + 20, o.hue + 30);
      }
      ctx.restore();
    }

    function drawCoin(c) {
      c.t += 0.1;
      const sx = Math.abs(Math.cos(c.t)) * 0.9 + 0.1;
      ctx.save();
      ctx.translate(c.x, c.y);
      ctx.shadowColor = '#ffd166';
      ctx.shadowBlur = 14 * G.scale;

      // Kenney's gold star. A slow pulse doubles as the "magnet" feel.
      const star = sprite('coin');
      if (star) {
        const size = c.r * 2.5 * (1 + Math.sin(c.t * 5) * 0.1);
        ctx.drawImage(star, -size / 2, -size / 2, size, size);
        ctx.restore();
        return;
      }

      ctx.beginPath();
      ctx.ellipse(0, 0, c.r, c.r, 0, 0, Math.PI * 2);
      ctx.fillStyle = '#f4a83a';
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(0, 0, c.r * 0.85, c.r * 0.85, 0, 0, Math.PI * 2);
      ctx.fillStyle = '#ffd166';
      ctx.fill();
      ctx.scale(sx, 1);
      ctx.beginPath();
      ctx.ellipse(0, 0, c.r * 0.6, c.r * 0.6, 0, 0, Math.PI * 2);
      ctx.fillStyle = '#fff3b0';
      ctx.fill();
      ctx.restore();
    }

    // A power-up / power-down orb. The pulsing glow colour is the telegraph:
    // green/cyan is a gift, red/orange is a curse, purple is a coin-flip.
    function drawPickup(pk) {
      const meta = PICKUP_META[pk.kind];
      pk.t += 0.08;
      const bob = Math.sin(pk.t * 2.2) * 4 * G.scale;
      const pulse = 1 + Math.sin(pk.t * 4) * 0.12;
      const r = pk.r * pulse;
      const cy = pk.y + bob;

      ctx.save();
      ctx.translate(pk.x, cy);

      ctx.shadowColor = meta.color;
      ctx.shadowBlur = 24 * G.scale;
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.fillStyle = meta.color;
      ctx.fill();
      ctx.shadowBlur = 0;

      // A dark translucent face keeps the white Kenney icons crisp.
      ctx.beginPath();
      ctx.arc(0, 0, r * 0.68, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(18,26,38,0.92)';
      ctx.fill();

      ctx.fillStyle = '#ffffff';
      drawPickupIcon(meta.icon, 0, 0, r * 0.62);

      // Name tag underneath so nobody snags a curse by accident.
      ctx.font = `bold ${11 * G.scale}px "Segoe UI", system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillStyle = 'rgba(255,255,255,0.92)';
      ctx.shadowColor = 'rgba(0,0,0,0.8)';
      ctx.shadowBlur = 4;
      ctx.fillText(meta.label, 0, r + 6 * G.scale);
      ctx.restore();
    }

    function drawPickupIcon(kind, cx, cy, s) {
      // Kenney Game Icons gives every pickup a human-drawn glyph. The shield
      // has no matching icon there, so it falls back to the vector shape.
      const ICON_SPRITE = {
        slow: 'iconBackward',
        gold: 'iconStar',
        heavy: 'iconWrench',
        turbo: 'iconFastForward',
        squash: 'iconSmaller',
        mystery: 'iconQuestion',
      };
      const icon = ICON_SPRITE[kind] ? sprite(ICON_SPRITE[kind]) : null;
      if (icon) {
        const size = s * 1.9;
        ctx.drawImage(icon, cx - size / 2, cy - size / 2, size, size);
        return;
      }

      ctx.beginPath();
      switch (kind) {
        case 'shield':
          ctx.moveTo(cx, cy - s);
          ctx.lineTo(cx - s * 0.9, cy - s * 0.6);
          ctx.lineTo(cx - s * 0.9, cy + s * 0.05);
          ctx.quadraticCurveTo(cx - s * 0.9, cy + s * 0.9, cx, cy + s * 0.95);
          ctx.quadraticCurveTo(cx + s * 0.9, cy + s * 0.9, cx + s * 0.9, cy + s * 0.05);
          ctx.lineTo(cx + s * 0.9, cy - s * 0.6);
          ctx.closePath();
          ctx.fill();
          break;
        case 'slow': {
          ctx.arc(cx, cy, s * 0.6, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = 'rgba(0,0,0,0.4)';
          ctx.lineWidth = Math.max(1, s * 0.14);
          ctx.beginPath();
          ctx.moveTo(cx, cy);
          ctx.lineTo(cx, cy - s * 0.34);
          ctx.moveTo(cx, cy);
          ctx.lineTo(cx + s * 0.3, cy + s * 0.12);
          ctx.stroke();
          break;
        }
        case 'gold':
          ctx.moveTo(cx, cy - s);
          ctx.lineTo(cx + s * 0.62, cy);
          ctx.lineTo(cx, cy + s);
          ctx.lineTo(cx - s * 0.62, cy);
          ctx.closePath();
          ctx.fill();
          break;
        case 'heavy':
          ctx.moveTo(cx, cy + s * 0.7);
          ctx.lineTo(cx - s * 0.62, cy - s * 0.05);
          ctx.lineTo(cx - s * 0.2, cy - s * 0.05);
          ctx.lineTo(cx - s * 0.2, cy - s * 0.85);
          ctx.lineTo(cx + s * 0.2, cy - s * 0.85);
          ctx.lineTo(cx + s * 0.2, cy - s * 0.05);
          ctx.lineTo(cx + s * 0.62, cy - s * 0.05);
          ctx.closePath();
          ctx.fill();
          break;
        case 'turbo': {
          ctx.moveTo(cx + s * 0.1, cy - s);
          ctx.lineTo(cx - s * 0.4, cy + s * 0.05);
          ctx.lineTo(cx - s * 0.02, cy + s * 0.05);
          ctx.lineTo(cx - s * 0.1, cy + s);
          ctx.lineTo(cx + s * 0.4, cy - s * 0.05);
          ctx.lineTo(cx + s * 0.02, cy - s * 0.05);
          ctx.closePath();
          ctx.fill();
          break;
        }
        case 'squash':
          ctx.moveTo(cx - s * 0.55, cy - s * 0.8);
          ctx.lineTo(cx + s * 0.55, cy - s * 0.8);
          ctx.lineTo(cx, cy - s * 0.05);
          ctx.closePath();
          ctx.fill();
          ctx.beginPath();
          ctx.moveTo(cx - s * 0.55, cy + s * 0.8);
          ctx.lineTo(cx + s * 0.55, cy + s * 0.8);
          ctx.lineTo(cx, cy + s * 0.05);
          ctx.closePath();
          ctx.fill();
          break;
        case 'mystery':
          ctx.font = `bold ${s * 1.6}px "Segoe UI", system-ui, sans-serif`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText('?', cx, cy + 1);
          break;
      }
    }

    // A faint bubble around the plane while a shield charge is ready.
    function drawShieldRing(cx, cy) {
      ctx.save();
      ctx.strokeStyle = `rgba(56,175,255,${0.55 + Math.sin(G.time * 6) * 0.2})`;
      ctx.lineWidth = 3 * G.scale;
      ctx.shadowColor = '#38c6ff';
      ctx.shadowBlur = 12 * G.scale;
      ctx.beginPath();
      ctx.arc(cx, cy, playerW() * 0.72, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    // While "narrow skies" is dissolving your room to manoeuvre, mark the
    // remaining lane with dashed red rails so the danger is crystal clear.
    function drawLaneRails() {
      const lane = laneBounds();
      ctx.save();
      ctx.setLineDash([8 * G.scale, 8 * G.scale]);
      ctx.strokeStyle = 'rgba(255,90,90,0.7)';
      ctx.lineWidth = 2.5 * G.scale;
      ctx.shadowColor = 'rgba(255,0,0,0.5)';
      ctx.shadowBlur = 6 * G.scale;
      ctx.beginPath();
      ctx.moveTo(0, lane.top);
      ctx.lineTo(W, lane.top);
      ctx.moveTo(0, lane.bottom);
      ctx.lineTo(W, lane.bottom);
      ctx.stroke();
      ctx.restore();
    }

    // The player's aircraft. Little touches: it banks into climbs, stretches
    // slightly when hauling vertically, and leaves a flickering jet flame.
    function drawPlane(cx, cy, vy) {
      const vN = clamp(vy / maxV(), -1, 1);
      const tilt = vN * 0.4;
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(tilt + (G.phase === 'attract' ? Math.cos(G.time * 0.9) * 0.06 : 0));
      ctx.scale(1 + Math.abs(vN) * 0.08, 1 - Math.abs(vN) * 0.08);

      const s = G.scale;

      // Kenney's paper plane, drawn a touch larger than its hitbox (the
      // fuselage inset keeps collisions generous). The banking squash above
      // applies to the sprite too, so it feels alive.
      const green = sprite('planeGreen1');
      if (green) {
        const flapSeq = [1, 2, 1, 3];
        const im = sprite(`planeGreen${flapSeq[Math.floor(G.time * 9) % 4]}`);
        const dw = PLANE_W * 1.28 * G.scale;
        const dh = dw * (73 / 88);
        ctx.shadowColor = 'rgba(0,0,0,0.3)';
        ctx.shadowBlur = 8 * s;
        ctx.shadowOffsetY = 3 * s;
        if (im) ctx.drawImage(im, -dw / 2, -dh / 2, dw, dh);
        ctx.shadowBlur = 0;
        ctx.shadowOffsetY = 0;
        // Small flickering exhaust flame between flaps.
        ctx.fillStyle = `rgba(255,190,70,${0.45 + Math.sin(G.time * 30) * 0.2})`;
        ctx.beginPath();
        ctx.moveTo(-dw * 0.2, -1 * s);
        ctx.lineTo(-(dw * 0.26 + 6 * Math.random() * s), 0);
        ctx.lineTo(-dw * 0.2, 1 * s);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
        return;
      }

      ctx.shadowColor = 'rgba(0,0,0,0.35)';
      ctx.shadowBlur = 10 * s;
      ctx.shadowOffsetY = 4 * s;

      ctx.fillStyle = '#efefef';
      ctx.beginPath();
      ctx.moveTo(26 * s, 0);
      ctx.quadraticCurveTo(4 * s, -12 * s, -20 * s, -2 * s);
      ctx.quadraticCurveTo(-27 * s, -7 * s, -29 * s, -2 * s);
      ctx.lineTo(-14 * s, 3 * s);
      ctx.quadraticCurveTo(0, 12 * s, 22 * s, 7 * s);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = '#cfcfcf';
      ctx.lineWidth = 1.5 * s;
      ctx.stroke();

      ctx.fillStyle = '#e63946';
      ctx.beginPath();
      ctx.moveTo(24 * s, 0);
      ctx.quadraticCurveTo(2 * s, -9 * s, -20 * s, -1.5 * s);
      ctx.lineTo(-16 * s, 2 * s);
      ctx.quadraticCurveTo(0, 9 * s, 20 * s, 5 * s);
      ctx.closePath();
      ctx.fill();

      ctx.shadowBlur = 0;
      ctx.shadowOffsetY = 0;

      ctx.fillStyle = '#2c3e6b';
      ctx.beginPath();
      ctx.ellipse(8 * s, -2.5 * s, 7 * s, 4.5 * s, -0.05, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#9fd8ff';
      ctx.beginPath();
      ctx.ellipse(9 * s, -3 * s, 4.4 * s, 2.4 * s, -0.05, 0, Math.PI * 2);
      ctx.fill();

      // Spinning prop blur.
      const tw = Math.sin(G.time * 22) * 2.4 * s;
      ctx.fillStyle = '#5b6068';
      ctx.beginPath();
      ctx.moveTo(-17 * s, -3 * s);
      ctx.lineTo(-26 * s - tw, -3 * s);
      ctx.lineTo(-20 * s, 0);
      ctx.lineTo(-17 * s, 2 * s);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#8f979f';
      ctx.beginPath();
      ctx.arc(-6 * s, -2 * s, 3.4 * s, 0, Math.PI * 2);
      ctx.fill();

      // Biplane lower/higher support wings.
      ctx.fillStyle = '#dcdde1';
      ctx.beginPath();
      ctx.moveTo(0, 2 * s);
      ctx.lineTo(20 * s, -4 * s);
      ctx.lineTo(22 * s, -2 * s);
      ctx.lineTo(2 * s, 3.5 * s);
      ctx.closePath();
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(0, 2 * s);
      ctx.lineTo(20 * s, 8 * s);
      ctx.lineTo(22 * s, 6 * s);
      ctx.lineTo(2 * s, 0.5 * s);
      ctx.closePath();
      ctx.fill();

      // Red rudder.
      ctx.fillStyle = '#e63946';
      ctx.beginPath();
      ctx.moveTo(-28 * s, -2 * s);
      ctx.lineTo(-42 * s, -9 * s);
      ctx.lineTo(-42 * s, 0);
      ctx.lineTo(-28 * s, 2 * s);
      ctx.closePath();
      ctx.fill();

      // Flickering exhaust flame.
      ctx.fillStyle = `rgba(255,190,70,${0.5 + Math.sin(G.time * 30) * 0.25})`;
      ctx.beginPath();
      ctx.moveTo(-29 * s, -2 * s);
      ctx.lineTo(-(34 + 6 * Math.random()) * s, 0);
      ctx.lineTo(-29 * s, 2 * s);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }

    function draw() {
      ctx.save();
      if (G.shake > 0) {
        const m = G.shake * 10 * G.scale;
        ctx.translate((Math.random() - 0.5) * m, (Math.random() - 0.5) * m);
      }

      drawSky();
      drawBgClouds(0.6);
      drawDistantMountains();
      for (const o of G.obstacles) drawObstacle(o);
      for (const c of G.coins) drawCoin(c);
      for (const pk of G.pickups) drawPickup(pk);
      if (G.effects.squash > 0) drawLaneRails();
      drawGround();
      drawSpeedLines(speed());

      const p = G.player;
      if (!G.gone) {
        // Blink rapidly during the post-shield mercy window so it's clear the
        // plane is untouchable for a split second.
        const blink = G.effects.invuln > 0 && Math.sin(G.time * 30) > 0;
        ctx.save();
        if (blink) ctx.globalAlpha = 0.35;
        drawPlane(p.x, p.y, G.phase === 'running' ? p.vy : 0);
        ctx.restore();
        if (G.effects.shield > 0) drawShieldRing(p.x, p.y);
      }

      // Debris and sparks.
      for (const pt of G.particles) {
        ctx.save();
        ctx.globalAlpha = clamp(pt.life / pt.max, 0, 1);
        ctx.fillStyle = pt.color;
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, Math.max(0.5, pt.size * pt.life), 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }

      // Floating reward text (+50, GO!, ...).
      for (const f of G.floaters) {
        ctx.save();
        ctx.globalAlpha = clamp(f.life / f.max, 0, 1);
        ctx.font = `bold ${f.size}px "KenVector Future", "Segoe UI", system-ui, sans-serif`;
        ctx.textAlign = 'center';
        ctx.fillStyle = f.color;
        ctx.shadowColor = 'rgba(0,0,0,0.5)';
        ctx.shadowBlur = 6;
        ctx.fillText(f.text, f.x, f.y);
        ctx.restore();
      }

      if (G.flash > 0) {
        ctx.fillStyle = `rgba(255,240,220,${G.flash * 0.55})`;
        ctx.fillRect(0, 0, W, H);
      }
      ctx.restore();
    }

    // ---------- main loop ----------

    function loop(ts) {
      if (!running) return;
      const rawDt = Math.min(0.05, (ts - lastTs) / 1000 || 0.016);
      lastTs = ts;
      update(rawDt, rawDt);
      draw();
      raf = requestAnimationFrame(loop);
    }

    function resize() {
      const rect = parent.getBoundingClientRect();
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      W = Math.max(320, rect.width);
      H = Math.max(200, rect.height);
      canvas.width = Math.round(W * dpr);
      canvas.height = Math.round(H * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      G.scale = clamp(H / 640, 0.55, 1.5);
      if (G.phase === 'running') {
        G.player.x = Math.max(70 * G.scale, W * 0.18);
        const lane = laneBounds();
        G.player.y = clamp(G.player.y, lane.top, lane.bottom);
      } else {
        placePlayer();
      }
    }

    // ---------- input ----------

    const toCanvasY = (clientY) => {
      const rect = canvas.getBoundingClientRect();
      return (clientY - rect.top) * (H / rect.height);
    };

    const onKeyDown = (e) => {
      if (e.key === 'ArrowUp' || e.key === 'w' || e.key === 'W') {
        G.input.up = true;
        e.preventDefault();
      }
      if (e.key === 'ArrowDown' || e.key === 's' || e.key === 'S') {
        G.input.down = true;
        e.preventDefault();
      }
    };
    const onKeyUp = (e) => {
      if (e.key === 'ArrowUp' || e.key === 'w' || e.key === 'W') G.input.up = false;
      if (e.key === 'ArrowDown' || e.key === 's' || e.key === 'S') G.input.down = false;
    };

    const onTouchStart = (e) => {
      if (G.phase !== 'running') return;
      if (e.touches && e.touches.length) {
        G.input.touch = toCanvasY(e.touches[0].clientY);
        G.input.up = false;
        G.input.down = false;
      }
    };
    const onTouchMove = (e) => {
      if (G.phase !== 'running') return;
      if (e.changedTouches && e.changedTouches.length) {
        G.input.touch = toCanvasY(e.changedTouches[0].clientY);
      }
      e.preventDefault();
    };
    const onTouchEnd = () => {
      G.input.touch = null;
    };

    const onPointerDown = (e) => {
      if (G.phase !== 'running') return;
      G.input.touch = toCanvasY(e.clientY);
    };
    const onPointerMove = (e) => {
      if (G.phase !== 'running') return;
      if (G.input.touch !== null) G.input.touch = toCanvasY(e.clientY);
    };
    const onPointerUp = () => {
      G.input.touch = null;
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    canvas.addEventListener('touchstart', onTouchStart, { passive: false });
    canvas.addEventListener('touchmove', onTouchMove, { passive: false });
    canvas.addEventListener('touchend', onTouchEnd);
    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('pointercancel', onPointerUp);

    const ro = new ResizeObserver(resize);
    ro.observe(parent);

    initSky();
    placePlayer();
    resize();
    raf = requestAnimationFrame(loop);

    useImperativeHandle(ref, () => ({
      start() {
        startRound();
      },
      getStats() {
        return roundStats();
      },
      setButton(dir, pressed) {
        if (dir === 'up') {
          G.input.up = pressed;
          if (pressed) G.input.touch = null;
        } else if (dir === 'down') {
          G.input.down = pressed;
          if (pressed) G.input.touch = null;
        }
      },
      isRunning() {
        return G.phase === 'running';
      },
      unlockAudio,
    }));

    return () => {
      running = false;
      cancelAnimationFrame(raf);
      ro.disconnect();
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      canvas.removeEventListener('touchstart', onTouchStart);
      canvas.removeEventListener('touchmove', onTouchMove);
      canvas.removeEventListener('touchend', onTouchEnd);
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('pointercancel', onPointerUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <canvas ref={canvasRef} className="game-canvas" />;
});

export default GameCanvas;