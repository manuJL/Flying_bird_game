// ---------------------------------------------------------------------------
// Human-made sprite art, bundled and shipped with the app (no runtime
// downloads). Everything here is CC0:
//   * "Tappy Plane" by Kenney        -> planes, coin star, cloud puff, ground
//   * "Game Icons" by Kenney         -> pickup icons
// See CREDITS.md at the repo root for full sources and licenses.
//
// The loader only kicks off the Image fetches; every draw site checks
// `sprite(name)` and gracefully falls back to the procedural art if an image
// is missing or still decoding, so the canvas can never render empty.
// ---------------------------------------------------------------------------

const BASE = (import.meta.env.BASE_URL || '/').replace(/\/+$/, '');

const FILES = {
  planeGreen1: 'planes/planeGreen1.png',
  planeGreen2: 'planes/planeGreen2.png',
  planeGreen3: 'planes/planeGreen3.png',
  planeRed1: 'planes/planeRed1.png',
  planeRed2: 'planes/planeRed2.png',
  planeRed3: 'planes/planeRed3.png',
  coin: 'starGold.png',
  cloud: 'puffLarge.png',
  ground: 'groundGrass.png',
  iconStar: 'icons/star.png',
  iconQuestion: 'icons/question.png',
  iconWrench: 'icons/wrench.png',
  iconFastForward: 'icons/fastForward.png',
  iconBackward: 'icons/backward.png',
  iconSmaller: 'icons/smaller.png',
};

export const sprites = {};

for (const [name, file] of Object.entries(FILES)) {
  const img = new Image();
  img.src = `${BASE}/art/${file}`;
  sprites[name] = img;
}

// Returns the loaded Image for a sprite key, or null if it is not ready.
// Callers use this as the signal for "draw the real art".
export function sprite(name) {
  const img = sprites[name];
  return img && img.complete && img.naturalWidth > 0 ? img : null;
}