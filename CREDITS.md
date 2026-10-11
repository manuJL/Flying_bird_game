# Asset & code credits

This project mixes hand-rolled procedural art with human-made assets. Everything
below is permissively licensed and safe to redistribute.

## Art (all CC0 - Public Domain)

**"Tappy Plane" by Kenney Vleugels (www.kenney.nl)** — `frontend/public/art/`
- `planes/planeGreen1..3.png`, `planes/planeRed1..3.png` - player & enemy biplanes
  (3-frame wing-flap animations)
- `starGold.png` - collectible coin/star
- `puffLarge.png` - storm cloud obstacle
- `groundGrass.png` - ground tile
- License: CC0 - https://creativecommons.org/publicdomain/zero/1.0/
- Source: https://opengameart.org/content/tappy-plane and https://kenney.nl/assets/tappy-plane

**"Game Icons" by Kenney Vleugels (www.kenney.nl)** — `frontend/public/art/icons/`
- `backward.png`, `fastForward.png`, `question.png`, `smaller.png`, `star.png`, `wrench.png`
  used as pickup glyphs.
- License: CC0 - https://creativecommons.org/publicdomain/zero/1.0/
- Source: https://kenney.nl/assets/game-icons

**"KenVector Future" font by Kenney Vleugels** — `frontend/src/assets/fonts/kenvector_future.ttf`
- License: CC0 - https://creativecommons.org/publicdomain/zero/1.0/
- Shipped inside the Tappy Plane pack above.

All Kenney assets: credit "Kenney (www.kenney.nl)" is appreciated but not required.

## Code patterns

The implementation follows widely-used, permissively-licensed open-source
patterns rather than inventing risky conventions:

- **Canvas + rAF game loop**: variable-timestep `requestAnimationFrame` loop
  with an explicit `dt` clamp, adapted from the classic "Fix Your Timestep"
  guidance by Glenn Fiedler (Gaffer On Games: https://gafferongames.com/post/fix_your_timestep/)
  and common practice in MIT-licensed canvas games on GitHub.
- **Device-pixel-ratio canvas sizing**: the resize/`setTransform(dpr,...)` idiom
  seen across MIT-licensed Vite/React canvas templates.
- **`useImperativeHandle` imperative ref API**: the standard React pattern for
  exposing a non-React imperative surface (child game engine) to a React parent;
  shared by many MIT-licensed React game shells.
- **`prefers-reduced-motion` respect + hit-stop**: anim/motion-reduction handling
  modeled on the Web Platform's reduced-motion guidance used by MDN's canvas
  examples (CC0/MIT-licensed documentation code).

No third-party code is copied verbatim; where a pattern was adapted, it is
attributed above and kept minimal on purpose.