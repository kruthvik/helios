// Reads an album palette's mood (main hue, how colorful, how bright, how varied) and picks particle effects and a
// background scene to match. Pure and deterministic: the same album always gets the same look.
import type { Fx } from "./effects";
import type { Frame } from "./backdrop";

export type Mood = { hue: number; sat: number; light: number; spread: number; seed: number };

function hsl(hex: string) {
  const n = parseInt(hex.replace("#", "").padEnd(6, "0").slice(0, 6), 16);
  const r = ((n >> 16) & 255) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2, d = max - min;
  if (!d) return { h: 0, s: 0, l };
  const s = d / (1 - Math.abs(2 * l - 1));
  const h = max === r ? ((g - b) / d + 6) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return { h: h * 60, s, l };
}

export function mood(colors: readonly string[]): Mood {
  const cs = colors.length ? colors.map(hsl) : [{ h: 0, s: 0, l: 0.2 }];
  // average hue on the color wheel, weighted by saturation: greys say little about a palette's mood
  let x = 0, y = 0, w = 0, sat = 0, light = 0;
  for (const c of cs) {
    const k = 0.1 + c.s;
    x += Math.cos((c.h * Math.PI) / 180) * k;
    y += Math.sin((c.h * Math.PI) / 180) * k;
    w += k;
    sat += c.s;
    light += c.l;
  }
  let seed = 0;
  for (const ch of colors.join("")) seed = (seed * 31 + ch.charCodeAt(0)) >>> 0;
  return {
    hue: ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360,
    sat: sat / cs.length,
    light: light / cs.length,
    spread: 1 - Math.hypot(x, y) / w, // 0 = one hue, 1 = all around the wheel
    seed: (seed % 1000) / 1000,
  };
}

export type AutoFx = { fx: Fx; amount: number; speed: number; size: number };

// Mixes that work together for each mood: a lead effect first, then accents that complement it.
const MIXES: Record<string, Fx[][]> = {
  night: [["stars", "fireflies"], ["stars", "meteors"], ["orbs", "sparkles"], ["stars", "snow"], ["stars", "lanterns"], ["fireflies", "stars", "notes"]],
  frost: [["snow", "stars"], ["snow", "bubbles"], ["snow", "fireflies"]],
  party: [["confetti", "notes"], ["balloons", "confetti"], ["balloons", "sparkles"], ["sparkles", "confetti"], ["orbs", "notes", "sparkles"], ["notes", "bubbles", "stars"], ["confetti", "fireworks"], ["fireworks", "notes"], ["bubbles", "confetti"]],
  fire: [["embers", "stars"], ["leaves", "embers"], ["embers", "lanterns"], ["fireworks", "embers"], ["embers", "fireflies"]],
  glow: [["lanterns", "fireflies"], ["leaves", "sparkles"], ["orbs", "embers"], ["lanterns", "sparkles"], ["lanterns", "embers"], ["lanterns", "stars", "petals"], ["fireflies", "lanterns"]],
  meadow: [["fireflies", "butterflies"], ["seeds", "butterflies"], ["seeds", "fireflies"], ["planes", "petals"], ["butterflies", "planes"], ["butterflies", "petals"], ["fireflies", "stars"], ["butterflies", "fireflies", "notes"]],
  water: [["bubbles", "fireflies"], ["orbs", "bubbles"], ["bubbles", "notes"], ["rain", "bubbles"], ["bubbles", "stars"]],
  cold: [["snow", "stars"], ["planes", "snow"], ["rain", "fireflies"], ["snow", "bubbles"]],
  space: [["stars", "fireflies"], ["meteors", "stars"], ["stars", "sparkles", "orbs"], ["stars", "notes"], ["stars", "fireworks"], ["stars", "bubbles", "fireflies"]],
  blossom: [["petals", "butterflies"], ["petals", "sparkles"], ["orbs", "petals"], ["petals", "bubbles"], ["petals", "fireflies"], ["butterflies", "petals", "notes"]],
};

/** A mix of effects that suits the palette: one lead and one or two lighter accents, each tuned on its own.
 *  Every album gets its own pick and its own settings, and always the same ones. */
export function autoFx(colors: readonly string[]): AutoFx[] {
  const { hue, sat, light, spread, seed } = mood(colors);
  const rnd = (k: number) => { const x = Math.sin((seed * 1000 + 1.7) * (k + 1) * 12.9898) * 43758.5453; return x - Math.floor(x); };
  const kind =
    sat < 0.18 ? (light < 0.35 ? "night" : "frost")
    : spread > 0.5 && sat > 0.4 ? "party"
    : hue < 45 || hue >= 340 ? (light < 0.4 ? "fire" : "glow")
    : hue < 70 ? "glow"
    : hue < 165 ? "meadow"
    : hue < 250 ? (light > 0.55 ? "cold" : sat > 0.45 ? "water" : "cold")
    : hue < 295 ? "space"
    : "blossom";
  const mixes = MIXES[kind], mix = mixes[Math.floor(rnd(0) * mixes.length) % mixes.length];
  // the lead carries the scene; accents are sparse so the mix stays clean. Darker, quieter palettes drift slower.
  const pace = 0.7 + 0.35 * light + 0.2 * sat;
  return mix.map((fx, i) => ({
    fx,
    amount: i === 0 ? 0.55 + 0.3 * rnd(1) : (0.22 + 0.2 * rnd(2 + i)) / i,
    speed: pace * (0.85 + 0.3 * rnd(5 + i)),
    size: (i === 0 ? 0.9 : 0.75) + 0.3 * rnd(8 + i),
  }));
}
/** A background scene that suits the palette. */
export function autoBg(colors: readonly string[]): Frame["mode"] {
  const { hue, sat, light, spread, seed } = mood(colors);
  const pick = <T,>(xs: T[]) => xs[Math.floor(seed * xs.length) % xs.length];
  if (sat < 0.18) return pick(["topo", "skyline", "mesh", "ridges"]);
  if (spread > 0.5 && sat > 0.4) return pick(["mosaic", "prism", "topo", "warp", "kaleido"]);
  if (hue < 70 || hue >= 340) return light < 0.35 ? pick(["lava", "dunes", "skyline"]) : pick(["sunset", "retro", "dunes", "flock", "papercut"]);
  if (hue < 165) return pick(["aurora", "koi", "silk", "papercut"]);
  if (hue < 250) return light < 0.3 ? pick(["galaxy", "ocean", "jellyfish", "rainglass"]) : pick(["ocean", "jellyfish", "koi", "ridges"]);
  return pick(["vortex", "orbits", "skyline", "galaxy", "warp", "plexus"]);
}
