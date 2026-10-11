# Skyline Flight

A fast, keyboard-first endless-flying arcade game built for the Vibecode Arena duel.
Dodge a deepening dusk skyline, chain coin bonuses, and gamble on glowing pickups
that either bless you with shields and slow-motion — or curse you with a wounded,
heavier plane and a shrinking horizon. The vantage point is a fixed-wing flyby,
so staying low is an illusion: the real risk is every pickup you *choose* to take.

Live best scores are recorded on a read-only FastAPI backend, but the game is
fully playable offline with a local best mirrored to `localStorage`.

## Features

- **Risk / reward pickups** — orbs are color-coded up front:
  - Green **Gold** (`+100`) and **Shield** (absorbs one hit), cyan **Slow-Mo**
    (the world crawls at 0.55×).
  - Red **Wing damage** — acceleration, top speed and handling drop to 0.62× and
    the plane sags downward. **Storm** — the skyline scrolls 1.32× harder.
    **Narrow skies** — the flyable lane shrinks and the pillars crowd in.
  - Purple **Mystery** — a fair coin flip between a blessing and a curse.
- **Real human-made CC0 art** — Kenney "Tappy Plane" sprites, game-icon set and
  the KenVector Future font are bundled in the repo, with a procedural canvas
  fallback if an asset ever fails to load. See [`CREDITS.md`](./CREDITS.md).
- **Canvas engine, React shell** — the 60fps loop lives entirely on a `<canvas>`
  (fixed-timestep accumulator), and React only drives HUD, overlay screens and
  touch controls, so no game state ever causes a re-render.
- **Semantic scoring** — `final_score = int(elapsed_survival_seconds) + bonus`,
  mirrored 1:1 between the client HUD and the server (coins `+50`, gold `+100`).
- **Graceful degradation** — no backend, no problem: sessions and best scores
  degrade to local persistence and the API wrapper swallows failures.
- **Accessibility** — `prefers-reduced-motion` shortens shake/flash effects;
  HUD is a live-region `status`; all buttons are keyboard/screen-reader friendly.
- **Bonus polish** — synthesized WebAudio sound effects, hitstop freeze frames,
  camera shake, coin chains with pitch-stepping, deep shields, dawn-to-dusk sky.

## Tech stack

| Layer   | Tech |
| ------- | ---- |
| Frontend | React 18 + Vite, plain CSS, `<canvas>` game loop, WebAudio |
| Backend  | FastAPI + SQLAlchemy (read-only scoring + retained best score) |
| Conventions | fixed-timestep game loop, devicePixelRatio canvas, `useImperativeHandle` ref shell |

## Project structure

```
.
├── Makefile                       # install / run / db-setup targets
├── CREDITS.md                     # asset sources, licenses, code-pattern attributions
├── backend/
│   ├── main.py                    # FastAPI app + scoring logic (read-only)
│   ├── models.py                  # SQLAlchemy models (GameSession, RetainedBestScore)
│   └── requirements.txt
└── frontend/
    ├── index.html
    ├── vite.config.js
    ├── public/art/                # Kenney CC0 sprites (planes, coin, cloud, icons)
    └── src/
        ├── main.jsx               # StrictMode root
        ├── App.jsx                # phase routing + backend orchestration
        ├── components/GameCanvas.jsx   # the whole game engine
        ├── screens/               # PreGame + Running (HUD) + GameOver overlays
        ├── utils/sound.js         # synthesized WebAudio SFX
        ├── sprites.js             # image preloader with procedural fallback
        └── styles/                # per-screen CSS
```

## Getting started

```bash
# 1. Install dependencies
make install-backend
make install-frontend

# 2. Seed the challenge database (once)
make db-setup

# 3. Run the backend (port 8000)
make run-backend

# 4. Run the frontend pointing at the backend (port 5000)
BASE_BE_ENDPOINT=http://localhost:8000 make run-frontend
```

Then open `http://localhost:5000`.

### Manual / raw commands

```bash
# backend
cd backend && .venv/bin/uvicorn main:app --host 0.0.0.0 --port 8000

# frontend (BASE_BE_ENDPOINT is injected at build/dev time)
cd frontend && VITE_BASE_BE_ENDPOINT=http://localhost:8000 npm run dev
# build for production
cd frontend && npm run build   # outputs dist/
```

## Configuration

- `VITE_BASE_BE_ENDPOINT` — base URL of the challenge backend. Defaults to
  `http://localhost:8000` when unset so the game runs standalone.
- Ports default to backend `8000`, frontend `5000`; override with
  `BACKEND_PORT` / `FRONTEND_PORT`.

## Gameplay

- **Controls:** `↑` / `↓` (or `W` / `S`) to fly; on touch, the on-screen
  up/down buttons appear on coarse pointers.
- **Scoring:** each full second survived = 1 point. Bonus points: coin `+50`,
  gold pickup `+100`. `Score = seconds survived + bonus`.
- **Pickups** spawn every 6–9 seconds. Green is good, red is a curse, purple
  is a coin flip — grab deliberately.
- **Shield** soaks exactly one obstacle hit and grants a brief invulnerability
  window afterward; hitstop + screen shake emphasize every impact.

## Backend API

| Method | Path                               | Purpose                                  |
| ------ | ---------------------------------- | ---------------------------------------- |
| GET    | `/api/retained-best-scores/1`      | Fetch the retained best score (§ seeding) |
| POST   | `/api/game-sessions`               | Start a session, returns `id`            |
| PATCH  | `/api/game-sessions/{id}`          | Live progress (crash-safe)               |
| PUT    | `/api/game-sessions/{id}`          | Complete: `final_score`, updates best    |

The client sends `elapsed_survival_seconds` as the raw float (`G.time`) and the
server floors it with `int(...)` exactly like the client's `Math.floor`, keeping
the two scoreboards bit-identical.

## Assets & licensing

All bundled art is **CC0** from [Kenney](https://kenney.nl) (Tappy Plane pack,
Game Icons, KenVector Future font). Earlier experiments with web-downloaded
packs were replaced by these deterministic, license-clean files. Full
attributions and the code-pattern references are in [`CREDITS.md`](./CREDITS.md).

## Quality notes

- Three full debug passes were run over the engine (syntax/build, game logic,
  and the API lifecycle including offline fallbacks); the build is clean.
- The canvas is resized through a `ResizeObserver` with a
  `devicePixelRatio`-aware backing store; game speed is time-based and therefore
  resolution-independent.# Flying_bird_game
