// Saved looks (named snapshots of the visual settings), "Surprise me", and stepping through backgrounds and lyric
// styles from the keyboard. The style lists live here so Settings and the shortcuts show the same names.
import { settings, type Settings } from "./settings.svelte";
import { FX, type Fx } from "./effects";

export const SCENES: [Settings["bgMode"], string][] = [
  ["auto", "Auto"], ["mesh", "Gradient"], ["aurora", "Aurora"], ["lava", "Lava"], ["silk", "Silk"], ["prism", "Prism"], ["ripples", "Ripples"],
  ["sunset", "Sunset"], ["bokeh", "Bokeh"], ["retro", "Retro"], ["vortex", "Vortex"], ["mosaic", "Mosaic"], ["jellyfish", "Jellyfish"],
  ["ocean", "Ocean"], ["dunes", "Dunes"], ["orbits", "Orbits"], ["topo", "Topo"], ["koi", "Koi"], ["skyline", "Skyline"], ["galaxy", "Galaxy"],
  ["ridges", "Ridges"], ["warp", "Warp"], ["flock", "Flock"], ["kaleido", "Kaleidoscope"], ["rainglass", "Rainy window"], ["papercut", "Papercut"],
  ["plexus", "Constellation"], ["media", "Your own"], ["blur", "Album"], ["solid", "Solid"],
];
export const LYRIC_MODES: [Settings["lyricsMode"], string][] = [
  ["scroll", "Scroll"], ["spotlight", "Spotlight"], ["kinetic", "Kinetic"], ["reveal", "Reveal"], ["bounce", "Bounce"], ["wave", "Wave"],
  ["neon", "Neon"], ["typewriter", "Typewriter"], ["chroma", "Chroma"], ["drop", "Drop"], ["glitch", "Glitch"], ["dream", "Dream"],
  ["stamp", "Stamp"], ["flip", "Flip"], ["marker", "Marker"], ["jelly", "Jelly"], ["glance", "Glance"],
];
export const FX_NAMES: Record<Fx, string> = {
  orbs: "Orbs", stars: "Stars", rain: "Rain", snow: "Snow", petals: "Petals", leaves: "Leaves", confetti: "Confetti", bubbles: "Bubbles",
  fireflies: "Fireflies", embers: "Embers", lanterns: "Lanterns", butterflies: "Butterflies", notes: "Notes", sparkles: "Sparkles",
  meteors: "Meteors", balloons: "Balloons", planes: "Paper planes", seeds: "Dandelion seeds", fireworks: "Fireworks",
};

/** Next (dir 1) or previous (-1) value of a setting from its list; returns the new value's name. */
export function cycle<K extends "bgMode" | "lyricsMode">(key: K, list: [Settings[K], string][], dir: 1 | -1) {
  const i = list.findIndex(([v]) => v === settings[key]);
  const [v, name] = list[(i + dir + list.length) % list.length];
  settings[key] = v;
  return name;
}

// ---- saved looks: everything about how Helios looks, nothing about how it behaves ----
const LOOK_KEYS = [
  "bgMode", "bgMotion", "bgIntensity", "bgDim", "bgBlur", "bgSaturation", "bgSolid", "bgSolidFrom", "bgTint", "bgTintAmount", "bgTintFrom", "bgHue", "bgVignette",
  "grain", "bgMediaFit", "bgMediaBlur", "bgMediaDrift", "bgVideo", "fxList", "fxAmount", "fxSpeed", "fxSize", "fxAuto", "fxColor", "fxTint",
  "layout", "lyricsSize", "lyricsAlign", "lyricsMode", "lyricsFx", "lyricsGlow", "lyricsColor", "lyricsInk", "lyricsGlowFrom", "lyricsGlowColor", "lyricsEdge", "lyricsMotion", "wordHl",
  "vizOn", "vizStyle", "vizColor", "vizTint", "vizHeight", "vizOpacity", "vizPulse", "vizPulseAmount", "vizOnBar", "accent", "font", "artRadius", "artShadow", "artGlow", "playShape", "iconTheme",
] as const satisfies readonly (keyof Settings)[];
type Look = Partial<Settings>;
const KEY = "helios.looks";

export const loadLooks = (): Record<string, Look> => {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "{}");
  } catch {
    return {};
  }
};
export function saveLook(name: string) {
  const all = loadLooks();
  all[name] = Object.fromEntries(LOOK_KEYS.map((k) => [k, $state.snapshot(settings[k])]));
  localStorage.setItem(KEY, JSON.stringify(all));
  return all;
}
export function applyLook(look: Look) {
  // only known keys, and only values of the right type: a look saved by an older version can't break anything
  for (const k of LOOK_KEYS) if (k in look && typeof look[k] === typeof settings[k]) (settings[k] as unknown) = structuredClone(look[k]);
}
export function deleteLook(name: string) {
  const all = loadLooks();
  delete all[name];
  localStorage.setItem(KEY, JSON.stringify(all));
  return all;
}

// ---- surprise me: a random scene, lyric style and one or two effects that go together ----
const pick = <T>(xs: readonly T[]) => xs[Math.floor(Math.random() * xs.length)];
export function surprise() {
  settings.bgMode = pick(SCENES.filter(([v]) => !["auto", "media", "blur", "solid", settings.bgMode].includes(v)))[0];
  settings.lyricsMode = pick(LYRIC_MODES.filter(([v]) => v !== "glance" && v !== settings.lyricsMode))[0];
  const fx = pick(FX.filter((f) => f !== "fireworks" && f !== "rain")); // the loud ones are better picked on purpose
  settings.fxAuto = false;
  settings.fxList = Math.random() < 0.5 ? [fx] : [fx, pick(FX.filter((f) => f !== fx && f !== "fireworks"))];
  return `${SCENES.find(([v]) => v === settings.bgMode)![1]} · ${LYRIC_MODES.find(([v]) => v === settings.lyricsMode)![1]} · ${settings.fxList.map((f) => FX_NAMES[f]).join(" + ")}`;
}
