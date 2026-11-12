// Canvas renderer for the animated background. It reproduces the former CSS version exactly:
// same blob/ribbon geometry, keyframes, ease-in-out per keyframe, alternate directions, oklab base mix and
// CSS saturate() matrix. It just draws at low resolution into one canvas instead of many GPU layers.

import { RAIN_LIGHTS, rainGL } from "./rainglass";

export type Rgb = [number, number, number];
/** How hard the bass is hitting right now (0..1 and a little over), written by the visualizer each frame. */
export const pulse = { beat: 0 };

export type Scene = { W: number; H: number; blurred: HTMLCanvasElement | null; blurKey: string; paint?: Paint; vignette?: CanvasGradient };
// Color strings for one set of colors: rebuilt only while colors crossfade or a setting changes, not every frame.
type Paint = { src: Rgb[]; mode: Frame["mode"]; saturation: number; base: string; solid: string[]; clear: string[] };
export type Frame = {
  mode: "mesh" | "aurora" | "lava" | "silk" | "prism" | "ripples" | "sunset" | "bokeh" | "retro" | "vortex" | "mosaic" | "jellyfish" | "ocean" | "dunes" | "orbits" | "topo" | "koi" | "skyline" | "galaxy" | "ridges" | "warp" | "flock" | "kaleido" | "rainglass" | "papercut" | "plexus" | "blur" | "solid" | "fill";
  t: number; // seconds of animation (already multiplied by the motion speed)
  colors: Rgb[]; // 4 album colors
  k: number; // intensity
  saturation: number;
  blur: number; // px in canvas space
  solid: string;
  art: HTMLImageElement | null;
  scale: number;
  dim: number; // 0..0.85 darkening
  vignette?: number; // 0..1 darkening toward the corners (default 0.35)
};

// ---- easing: CSS cubic-bezier ----
export function bezier(x1: number, y1: number, x2: number, y2: number) {
  const s = (a: number, b: number, t: number) => ((1 - 3 * b + 3 * a) * t + (3 * b - 6 * a)) * t * t + 3 * a * t;
  const d = (a: number, b: number, t: number) => 3 * (1 - 3 * b + 3 * a) * t * t + 2 * (3 * b - 6 * a) * t + 3 * a;
  return (x: number) => {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    let t = x;
    for (let i = 0; i < 8; i++) {
      const e = s(x1, x2, t) - x;
      if (Math.abs(e) < 1e-6) break;
      const slope = d(x1, x2, t);
      if (Math.abs(slope) < 1e-6) break;
      t = Math.min(1, Math.max(0, t - e / slope));
    }
    return s(y1, y2, t);
  };
}
export const ease = bezier(0.25, 0.1, 0.25, 1);
const easeInOut = bezier(0.42, 0, 0.58, 1);

// ---- color ----
export const hexRgb = (h: string): Rgb => {
  const n = parseInt(h.slice(1, 7), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
export const lerpRgb = (a: Rgb, b: Rgb, p: number): Rgb => [a[0] + (b[0] - a[0]) * p, a[1] + (b[1] - a[1]) * p, a[2] + (b[2] - a[2]) * p];
const css = (c: Rgb, a = 1) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;

/** CSS saturate() matrix. */
export function saturate([r, g, b]: Rgb, s: number): Rgb {
  const c = (v: number) => Math.max(0, Math.min(255, v));
  return [
    c((0.213 + 0.787 * s) * r + (0.715 - 0.715 * s) * g + (0.072 - 0.072 * s) * b),
    c((0.213 - 0.213 * s) * r + (0.715 + 0.285 * s) * g + (0.072 - 0.072 * s) * b),
    c((0.213 - 0.213 * s) * r + (0.715 - 0.715 * s) * g + (0.072 + 0.928 * s) * b),
  ];
}

const toLin = (v: number) => ((v /= 255) <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const fromLin = (v: number) => 255 * (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055);
function oklab([r, g, b]: Rgb): Rgb {
  const [R, G, B] = [toLin(r), toLin(g), toLin(b)];
  const l = Math.cbrt(0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B);
  const m = Math.cbrt(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B);
  const s = Math.cbrt(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720409 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}
function fromOklab([L, a, b]: Rgb): Rgb {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const c = (v: number) => Math.max(0, Math.min(255, fromLin(Math.max(0, v))));
  return [
    c(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    c(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    c(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  ];
}
/** CSS color-mix(in oklab, a p, b). */
export const mixOklab = (a: Rgb, b: Rgb, p: number) => fromOklab(lerpRgb(oklab(b), oklab(a), p));

/** Album colors made fit to glow: muddy browns and near-blacks lifted to a luminous version of the same hue,
 *  washed-out pastels given a little body. Greys stay grey. */
export function vivid(c: Rgb): Rgb {
  const [L, a, b] = oklab(c), C = Math.hypot(a, b);
  const L2 = Math.min(0.84, Math.max(0.5, L * 0.6 + 0.3));
  if (C < 0.025) return fromOklab([L2, a, b]);
  const C2 = Math.min(0.19, Math.max(0.085, C * 1.2)) * (L2 > 0.78 ? 0.8 : 1);
  return fromOklab([L2, (a / C) * C2, (b / C) * C2]);
}

/** Color grading for the background: turn a color around the wheel (keeping its lightness), then pull it toward a tint. */
export function grade(c: Rgb, hueDeg: number, tint: Rgb, amount: number): Rgb {
  let out = c;
  if (hueDeg) {
    const [L, a, b] = oklab(c), r = (hueDeg * Math.PI) / 180;
    out = fromOklab([L, a * Math.cos(r) - b * Math.sin(r), a * Math.sin(r) + b * Math.cos(r)]).map((v) => Math.max(0, Math.min(255, v))) as Rgb;
  }
  return amount ? mixOklab(tint, out, amount) : out;
}

// ---- CSS animation timing ----
type Kf = [number, number[]][];
/** Directed progress of an `infinite alternate` (or alternate-reverse) animation. */
export function progress(t: number, dur: number, reverse: boolean) {
  const cycles = t / dur;
  const n = Math.floor(cycles);
  const f = cycles - n;
  return n % 2 === 1 !== reverse ? 1 - f : f;
}
/** Value at progress p, with ease-in-out applied per keyframe segment (CSS default for these). */
export function sample(kf: Kf, p: number): number[] {
  let i = 0;
  while (i < kf.length - 2 && p > kf[i + 1][0]) i++;
  const [o0, a] = kf[i];
  const [o1, b] = kf[i + 1];
  const e = easeInOut((p - o0) / (o1 - o0));
  return a.map((v, j) => v + (b[j] - v) * e);
}

// [translateX %, translateY %, scale] keyframes from the former CSS, scaled by intensity k
const drift = (k: number): Kf => [
  [0, [0, 0, 1]],
  [0.33, [0.14 * k, 0.1 * k, 1 + 0.15 * k]],
  [0.66, [-0.06 * k, 0.2 * k, 1 - 0.08 * k]],
  [1, [0.1 * k, -0.08 * k, 1.05]],
];
const drift2 = (k: number): Kf => [
  [0, [0, 0, 1.05]],
  [0.5, [-0.18 * k, 0.14 * k, 1 - 0.1 * k]],
  [1, [-0.06 * k, 0.26 * k, 1 + 0.18 * k]],
];
const drift3 = (k: number): Kf => [
  [0, [0, 0, 1]],
  [0.5, [0.2 * k, -0.14 * k, 1 + 0.2 * k]],
  [1, [0.3 * k, -0.02 * k, 0.92]],
];
// [translateX %, rotate deg, scaleY]
const sweep = (k: number): Kf => [
  [0, [-0.12 * k, -8, 0.8]],
  [0.5, [0.06 * k, 4, 1.2]],
  [1, [0.14 * k, 10, 0.9]],
];

// Mesh blobs inside the rotating box (150% of the window). size = share of box width; position in box units.
const BLOBS = [
  { dur: 18, kf: drift, rev: false, c: 0, size: 0.7, stop: 0.62, alpha: 1, at: () => [0, 0] },
  { dur: 23, kf: drift2, rev: false, c: 1, size: 0.7, stop: 0.62, alpha: 1, at: (sw: number, sh: number, s: number) => [sw - s, 0.05 * sh] },
  { dur: 29, kf: drift3, rev: false, c: 2, size: 0.7, stop: 0.62, alpha: 1, at: (sw: number, sh: number, s: number) => [0.1 * sw, sh - s] },
  { dur: 34, kf: drift2, rev: true, c: 3, size: 0.7, stop: 0.62, alpha: 1, at: (sw: number, sh: number, s: number) => [0.95 * sw - s, 0.95 * sh - s] },
  { dur: 27, kf: drift3, rev: true, c: 1, size: 0.5, stop: 0.6, alpha: 0.8, at: (sw: number, sh: number) => [0.3 * sw, 0.3 * sh] },
];
const RIBBONS = [
  { top: 0.06, dur: 16, rev: false, c: 1 },
  { top: 0.34, dur: 21, rev: true, c: 3 },
  { top: 0.58, dur: 26, rev: false, c: 2 },
];

function blurredArt(scene: Scene, f: Frame) {
  const img = f.art!;
  const key = `${img.src}|${scene.W}|${scene.H}|${f.blur}|${f.saturation}`;
  if (scene.blurKey === key) return scene.blurred!;
  const w = Math.ceil((scene.W * 1.4) / f.scale);
  const h = Math.ceil((scene.H * 1.4) / f.scale);
  const out = scene.blurred ?? document.createElement("canvas");
  out.width = w;
  out.height = h;
  const c = out.getContext("2d")!;
  const cover = Math.max(w / img.naturalWidth, h / img.naturalHeight);
  const dw = img.naturalWidth * cover;
  const dh = img.naturalHeight * cover;
  if (!("filter" in CanvasRenderingContext2D.prototype)) {
    // shortcut: canvas filters missing (older macOS WebKit): blur by downscaling instead, no extra saturation.
    const tiny = document.createElement("canvas");
    tiny.width = Math.max(2, Math.round(w / Math.max(1, f.blur)));
    tiny.height = Math.max(2, Math.round(h / Math.max(1, f.blur)));
    tiny.getContext("2d")!.drawImage(img, 0, 0, tiny.width, tiny.height);
    c.drawImage(tiny, 0, 0, w, h);
  } else {
    c.filter = `blur(${f.blur}px) saturate(${f.saturation})`;
    c.drawImage(img, (w - dw) / 2, (h - dh) / 2, dw, dh);
  }
  scene.blurred = out;
  scene.blurKey = key;
  return out;
}

export function drawBackdrop(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement, scene: Scene, f: Frame) {
  const base = () => (ctx.setTransform(canvas.width / scene.W, 0, 0, canvas.height / scene.H, 0, 0), (ctx.globalAlpha = 1));
  base();
  drawScene(ctx, scene, f);
  base();
  // Dim + vignette, formerly a separate full-window layer:
  // rgba(0,0,0,dim) under radial-gradient(ellipse at 30% 40%, transparent, rgba(0,0,0,.35)) (farthest-corner = √2 × farthest-side)
  const { W, H } = scene;
  ctx.fillStyle = `rgba(0,0,0,${f.dim})`;
  ctx.fillRect(0, 0, W, H);
  ctx.translate(0.3 * W, 0.4 * H);
  ctx.scale(Math.SQRT2 * 0.7 * W, Math.SQRT2 * 0.6 * H);
  if (!scene.vignette) {
    // unit-sized, so the transform above fits it to any window: built once
    scene.vignette = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
    scene.vignette.addColorStop(0, "rgba(0,0,0,0)");
    scene.vignette.addColorStop(1, "rgba(0,0,0,1)"); // strength comes from globalAlpha below
  }
  ctx.globalAlpha = f.vignette ?? 0.35;
  ctx.fillStyle = scene.vignette;
  ctx.fillRect(-2, -2, 4, 4);
}

function paint(scene: Scene, f: Frame): Paint {
  const p = scene.paint;
  if (p && p.src === f.colors && p.mode === f.mode && p.saturation === f.saturation) return p;
  const sat = (c: Rgb) => (f.saturation === 1 ? c : saturate(c, f.saturation));
  const cols = f.colors.map(sat);
  // CSS saturated the mixed base color too
  const base = f.mode === "mesh" ? mixOklab(f.colors[0], [5, 5, 6], 0.45) : mixOklab(f.colors[0], [4, 4, 5], 0.3);
  return (scene.paint = {
    src: f.colors,
    mode: f.mode,
    saturation: f.saturation,
    base: css(sat(base)),
    solid: cols.map((c) => css(c)),
    clear: cols.map((c) => css(c, 0)),
  });
}

function drawScene(ctx: CanvasRenderingContext2D, scene: Scene, f: Frame) {
  const { W, H } = scene;
  if (f.mode !== "rainglass") rainBg = null; // its street canvas is only needed while it shows

  if (f.mode === "solid") return void ((ctx.fillStyle = f.solid), ctx.fillRect(0, 0, W, H));
  if (f.mode === "fill") return void ((ctx.fillStyle = css(f.colors[0])), ctx.fillRect(0, 0, W, H));
  if (f.mode === "blur") {
    ctx.fillStyle = "#0b0b0d";
    ctx.fillRect(0, 0, W, H);
    if (!f.art) return;
    const art = blurredArt(scene, f);
    const e = easeInOut(progress(f.t, 30, false));
    ctx.translate(W / 2, H / 2);
    ctx.rotate(((8 * f.k * e) * Math.PI) / 180);
    ctx.scale(1 + 0.15 * f.k * e, 1 + 0.15 * f.k * e);
    ctx.drawImage(art, -0.7 * W, -0.7 * H, 1.4 * W, 1.4 * H);
    return;
  }

  const pt = paint(scene, f);
  ctx.fillStyle = pt.base;
  ctx.fillRect(0, 0, W, H);
  if (f.mode === "mesh") {
    // the whole field turns once every 90 s around the window centre
    ctx.translate(W / 2, H / 2);
    ctx.rotate(2 * Math.PI * ((f.t / 90) % 1));
    ctx.translate(-W / 2, -H / 2);
    const sw = 1.5 * W;
    const sh = 1.5 * H;
    for (const b of BLOBS) {
      const s = b.size * sw;
      const [x, y] = b.at(sw, sh, s);
      const [tx, ty, sc] = sample(b.kf(f.k), progress(f.t, b.dur, b.rev));
      const cx = -0.25 * W + x + s / 2 + tx * s;
      const cy = -0.25 * H + y + s / 2 + ty * s;
      const r = sc * s * Math.SQRT1_2; // CSS "circle" radial gradients reach the farthest corner
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
      g.addColorStop(0, pt.solid[b.c]);
      g.addColorStop(b.stop, pt.clear[b.c]);
      ctx.globalAlpha = b.alpha;
      ctx.fillStyle = g;
      ctx.fillRect(cx - r, cy - r, 2 * r, 2 * r);
    }
    return;
  }

  if (f.mode === "lava") return drawLava(ctx, W, H, f, pt);
  if (f.mode === "silk") return drawSilk(ctx, W, H, f, pt);
  if (f.mode === "prism") return drawPrism(ctx, W, H, f, pt);
  if (f.mode === "ripples") return drawRipples(ctx, W, H, f, pt);
  if (f.mode === "sunset") return drawSunset(ctx, W, H, f, pt);
  if (f.mode === "bokeh") return drawBokeh(ctx, W, H, f, pt);
  if (f.mode === "retro") return drawRetro(ctx, W, H, f, pt);
  if (f.mode === "vortex") return drawVortex(ctx, W, H, f, pt);
  if (f.mode === "mosaic") return drawMosaic(ctx, W, H, f, pt);
  if (f.mode === "jellyfish") return drawJellyfish(ctx, W, H, f, pt);
  if (f.mode === "ocean") return drawOcean(ctx, W, H, f, pt);
  if (f.mode === "dunes") return drawDunes(ctx, W, H, f, pt);
  if (f.mode === "orbits") return drawOrbits(ctx, W, H, f, pt);
  if (f.mode === "topo") return drawTopo(ctx, W, H, f, pt);
  if (f.mode === "koi") return drawKoi(ctx, W, H, f, pt);
  if (f.mode === "skyline") return drawSkyline(ctx, W, H, f, pt);
  if (f.mode === "galaxy") return drawGalaxy(ctx, W, H, f, pt);
  if (f.mode === "ridges") return drawRidges(ctx, W, H, f, pt);
  if (f.mode === "warp") return drawWarp(ctx, W, H, f, pt);
  if (f.mode === "flock") return drawFlock(ctx, W, H, f);
  if (f.mode === "kaleido") return drawKaleido(ctx, W, H, f, pt);
  if (f.mode === "rainglass") return drawRainglass(ctx, W, H, f, pt);
  if (f.mode === "papercut") return drawPapercut(ctx, W, H, f);
  if (f.mode === "plexus") return drawPlexus(ctx, W, H, f, pt);

  // aurora: three elliptical ribbons in a box 140% of the window
  const aw = 1.4 * W;
  const ah = 1.4 * H;
  const rw = 1.2 * aw;
  const rh = 0.38 * ah;
  ctx.globalAlpha = 0.85;
  for (const r of RIBBONS) {
    const [tx, rot, sy] = sample(sweep(f.k), progress(f.t, r.dur, r.rev));
    const cx = -0.2 * W - 0.1 * aw + rw / 2 + tx * rw;
    const cy = -0.2 * H + r.top * ah + rh / 2;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate((rot * Math.PI) / 180);
    ctx.scale(rw / 2, (rh / 2) * sy);
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
    g.addColorStop(0, pt.solid[r.c]);
    g.addColorStop(0.72, pt.clear[r.c]);
    ctx.fillStyle = g;
    ctx.fillRect(-1, -1, 2, 2);
    ctx.restore();
  }
}

// lava: big glowing blobs on slow, never-repeating Lissajous paths; additive blending makes them melt together
function drawLava(ctx: CanvasRenderingContext2D, W: number, H: number, f: Frame, pt: Paint) {
  const m = Math.min(W, H);
  ctx.globalCompositeOperation = "lighter";
  for (let i = 0; i < 7; i++) {
    const a = 0.031 + i * 0.0067, b = 0.023 + ((i * 5) % 7) * 0.0053; // incommensurate rates
    const reach = 0.18 + 0.22 * Math.min(1.5, f.k);
    const cx = W * (0.5 + reach * Math.sin(f.t * a * 6 + i * 2.1));
    const cy = H * (0.5 + reach * Math.cos(f.t * b * 6 + i * 1.3));
    const r = m * (0.32 + 0.1 * Math.sin(f.t * 0.17 + i));
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
    const c = i % pt.solid.length;
    g.addColorStop(0, pt.solid[c]);
    g.addColorStop(1, pt.clear[c]);
    ctx.globalAlpha = 0.5;
    ctx.fillStyle = g;
    ctx.fillRect(cx - r, cy - r, 2 * r, 2 * r);
  }
  ctx.globalCompositeOperation = "source-over";
}

// silk: layered translucent waves rolling across the lower window, each at its own speed and swell
function drawSilk(ctx: CanvasRenderingContext2D, W: number, H: number, f: Frame, pt: Paint) {
  const n = 4, step = W / 32;
  for (let i = 0; i < n; i++) {
    const c = i % pt.solid.length;
    const top = H * (0.3 + i * 0.15);
    const amp = H * 0.09 * (0.4 + 0.6 * Math.min(2, f.k)) * (1 - i * 0.12);
    const ph = f.t * (0.25 + i * 0.09) * (i % 2 ? -1 : 1);
    ctx.beginPath();
    ctx.moveTo(-step, H);
    for (let x = -step; x <= W + step; x += step) {
      const u = x / W;
      ctx.lineTo(x, top + amp * (Math.sin(u * 5.2 + ph + i) * 0.65 + Math.sin(u * 11.7 - ph * 1.6 + i * 2) * 0.35));
    }
    ctx.lineTo(W + step, H);
    ctx.closePath();
    const g = ctx.createLinearGradient(0, top - amp, 0, H);
    g.addColorStop(0, pt.solid[c]);
    g.addColorStop(1, pt.clear[c]);
    ctx.globalAlpha = 0.55 - i * 0.06;
    ctx.fillStyle = g;
    ctx.fill();
  }
}
// prism: light through glass. Soft beams in the album's colors fan out from a source just off the top corner,
// swaying slowly and crossing; where they overlap they add up, like a light leak on film.
function drawPrism(ctx: CanvasRenderingContext2D, W: number, H: number, f: Frame, pt: Paint) {
  const n = pt.solid.length, D = Math.hypot(W, H), t = f.t * (0.5 + 0.5 * f.k);
  const sx = W * (0.08 + 0.06 * Math.sin(t * 0.03)), sy = -H * 0.12;
  const wash = ctx.createRadialGradient(sx, sy, 0, sx, sy, D * 0.9);
  wash.addColorStop(0, pt.solid[0]);
  wash.addColorStop(1, pt.clear[0]);
  ctx.globalAlpha = 0.32;
  ctx.fillStyle = wash;
  ctx.fillRect(0, 0, W, H);
  ctx.globalCompositeOperation = "lighter";
  for (let i = 0; i < 9; i++) {
    const a = 0.35 + (i / 8) * 0.95 + 0.07 * Math.sin(t * (0.05 + 0.02 * hash(i, 1)) + i * 2.1);
    const len = D * (0.9 + 0.5 * hash(i, 2)), wid = D * (0.03 + 0.07 * hash(i, 3));
    ctx.save();
    ctx.translate(sx, sy);
    ctx.rotate(a);
    ctx.scale(len, wid);
    const g = ctx.createRadialGradient(0.15, 0, 0, 0.15, 0, 0.85);
    g.addColorStop(0, pt.solid[i % n]);
    g.addColorStop(1, pt.clear[i % n]);
    ctx.globalAlpha = (0.16 + 0.16 * hash(i, 4)) * (0.75 + 0.25 * Math.sin(t * 0.17 + i * 1.3));
    ctx.fillStyle = g;
    ctx.fillRect(-0.7, -1, 1.7, 2);
    ctx.restore();
  }
  // the source itself: a hot, soft glow
  const r = D * 0.3, s = ctx.createRadialGradient(sx, sy, 0, sx, sy, r);
  s.addColorStop(0, "rgba(255,250,240,.5)");
  s.addColorStop(0.3, pt.solid[1 % n]);
  s.addColorStop(1, pt.clear[1 % n]);
  ctx.globalAlpha = 0.4;
  ctx.fillStyle = s;
  ctx.fillRect(sx - r, sy - r, 2 * r, 2 * r);
  ctx.globalCompositeOperation = "source-over";
}

// ripples: glowing rings swelling out from a point and fading, like sound spreading through water
function drawRipples(ctx: CanvasRenderingContext2D, W: number, H: number, f: Frame, pt: Paint) {
  const cx = W * (0.38 + 0.06 * Math.sin(f.t * 0.07)), cy = H * (0.62 + 0.05 * Math.cos(f.t * 0.05));
  const maxR = Math.hypot(Math.max(cx, W - cx), Math.max(cy, H - cy));
  ctx.globalCompositeOperation = "lighter";
  const core = ctx.createRadialGradient(cx, cy, 0, cx, cy, maxR * 0.35);
  core.addColorStop(0, pt.solid[0]);
  core.addColorStop(1, pt.clear[0]);
  ctx.globalAlpha = 0.35;
  ctx.fillStyle = core;
  ctx.fillRect(0, 0, W, H);
  const rings = 6;
  for (let i = 0; i < rings; i++) {
    const p = (f.t * 0.05 * (0.6 + 0.4 * f.k) + i / rings) % 1; // 0 = just born at the centre, 1 = gone at the edge
    const r = 8 + p * maxR, w = r * (0.12 + 0.1 * p);
    const c = i % pt.solid.length;
    const g = ctx.createRadialGradient(cx, cy, Math.max(0, r - w), cx, cy, r + w);
    g.addColorStop(0, pt.clear[c]);
    g.addColorStop(0.5, pt.solid[c]);
    g.addColorStop(1, pt.clear[c]);
    ctx.globalAlpha = 0.55 * Math.sin(Math.PI * p);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }
  ctx.globalCompositeOperation = "source-over";
}

// sunset: a glowing sun bobbing on the horizon, with shimmering reflection bands on the water below
function drawSunset(ctx: CanvasRenderingContext2D, W: number, H: number, f: Frame, pt: Paint) {
  const horizon = H * 0.64, n = pt.solid.length, m = Math.min(W, H);
  // sky: deep overhead, the album's second color in the middle, burning toward the horizon
  const sky = ctx.createLinearGradient(0, 0, 0, horizon);
  sky.addColorStop(0, pt.clear[3 % n]);
  sky.addColorStop(0.45, pt.solid[1 % n]);
  sky.addColorStop(1, pt.solid[0]);
  ctx.globalAlpha = 0.55;
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, W, horizon);
  const sx = W * (0.5 + 0.05 * Math.sin(f.t * 0.03)), sy = horizon - m * (0.07 + 0.04 * Math.sin(f.t * 0.05) * f.k);
  const sr = m * 0.13;
  ctx.globalCompositeOperation = "lighter";
  const glow = ctx.createRadialGradient(sx, sy, 0, sx, sy, sr * 6);
  glow.addColorStop(0, pt.solid[0]);
  glow.addColorStop(0.25, pt.solid[0].replace(",1)", ",.45)"));
  glow.addColorStop(1, pt.clear[0]);
  ctx.globalAlpha = 0.7;
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);
  // the sun: a clean bright disc with a soft edge, sinking behind the horizon line
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, W, horizon);
  ctx.clip();
  const sun = ctx.createRadialGradient(sx, sy, 0, sx, sy, sr);
  sun.addColorStop(0, "rgba(255,250,236,1)");
  sun.addColorStop(0.82, "rgba(255,226,180,.95)");
  sun.addColorStop(1, "rgba(255,210,160,0)");
  ctx.globalAlpha = 0.9;
  ctx.fillStyle = sun;
  ctx.fillRect(sx - sr, sy - sr, sr * 2, sr * 2);
  ctx.restore();
  ctx.globalCompositeOperation = "source-over";
  // water: a darker, cooler mirror of the sky, with a haze line where they meet
  const sea = ctx.createLinearGradient(0, horizon, 0, H);
  sea.addColorStop(0, pt.solid[0]);
  sea.addColorStop(0.08, pt.solid[2 % n]);
  sea.addColorStop(1, pt.clear[2 % n]);
  ctx.globalAlpha = 0.3;
  ctx.fillStyle = sea;
  ctx.fillRect(0, horizon, W, H - horizon);
  ctx.globalAlpha = 1;
  ctx.fillStyle = "rgba(0,0,0,.25)";
  ctx.fillRect(0, horizon, W, H - horizon);
  // glitter: the sun breaks into a column of short glints that widens toward you and dances, over a soft path of light
  ctx.globalCompositeOperation = "lighter";
  ctx.save();
  ctx.translate(sx, horizon);
  ctx.scale(sr * 2.2, H - horizon);
  const path = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
  path.addColorStop(0, pt.solid[0]);
  path.addColorStop(1, pt.clear[0]);
  ctx.globalAlpha = 0.35;
  ctx.fillStyle = path;
  ctx.fillRect(-1, 0, 2, 1);
  ctx.restore();
  ctx.fillStyle = "rgba(255,236,200,1)";
  const t = f.t * (0.6 + 0.4 * f.k);
  for (let i = 0; i < 140; i++) {
    const d = hash(i, 31) ** 1.6; // 0 at the horizon … 1 at the bottom
    const y = horizon + 2 + (H - horizon) * d;
    const spread = sr * (0.6 + 3.2 * d);
    const x = sx + spread * (hash(i, 32) * 2 - 1) * (hash(i, 33) * 0.6 + 0.4);
    const tw = Math.sin(t * (1.5 + 2 * hash(i, 34)) + i * 7.1); // each glint flickers on and off
    if (tw < 0.2) continue;
    const w = m * (0.008 + 0.03 * d) * (0.5 + hash(i, 35)), h = Math.max(1, m * (0.002 + 0.004 * d));
    ctx.globalAlpha = (tw - 0.2) * 0.7 * (1 - Math.abs(x - sx) / (spread * 1.1)) * (1 - 0.5 * d);
    ctx.fillRect(x - w / 2, y, w, h);
  }
  ctx.globalCompositeOperation = "source-over";
}

// bokeh: big soft out-of-focus lights drifting and overlapping, like a night city through a blurry lens
function drawBokeh(ctx: CanvasRenderingContext2D, W: number, H: number, f: Frame, pt: Paint) {
  const m = Math.min(W, H), n = pt.solid.length;
  // a low ambient glow, so the lights float in a lit space rather than on black
  const amb = ctx.createRadialGradient(W * 0.5, H * 0.75, 0, W * 0.5, H * 0.75, Math.max(W, H) * 0.8);
  amb.addColorStop(0, pt.solid[1 % n]);
  amb.addColorStop(1, pt.clear[1 % n]);
  ctx.globalAlpha = 0.22;
  ctx.fillStyle = amb;
  ctx.fillRect(0, 0, W, H);
  ctx.globalCompositeOperation = "lighter";
  // three depths: many small faint lights far off, a few big ones close to the lens
  for (let i = 0; i < 34; i++) {
    const h = (k: number) => hash(i, k); // stable per light
    const near = i < 8 ? 1 : i < 18 ? 0.55 : 0.25;
    const reach = (0.05 + 0.08 * Math.min(2, f.k)) * (0.5 + near);
    const x = W * (h(1) + reach * Math.sin(f.t * (0.015 + 0.03 * h(2)) * (0.5 + near) + h(3) * 6.3));
    const y = H * (h(4) + reach * Math.cos(f.t * (0.015 + 0.03 * h(5)) * (0.5 + near) + h(6) * 6.3));
    const r = m * (0.025 + 0.13 * near * (0.6 + 0.4 * h(7)));
    const c = pt.solid[i % n], clear = pt.clear[i % n];
    // an out-of-focus light: an even disc, a little brighter at its rim, with a crisp but soft edge
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, c.replace(",1)", ",.55)"));
    g.addColorStop(0.78, c.replace(",1)", ",.7)"));
    g.addColorStop(0.92, c);
    g.addColorStop(1, clear);
    ctx.globalAlpha = (0.1 + 0.22 * h(8)) * (1.15 - near * 0.45) * (0.7 + 0.3 * Math.sin(f.t * (0.2 + 0.3 * h(9)) + i));
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, 2 * r, 2 * r);
  }
  ctx.globalCompositeOperation = "source-over";
}
// retro: a synthwave horizon. A banded sun sits on the skyline and a glowing grid floor rolls toward you.
function drawRetro(ctx: CanvasRenderingContext2D, W: number, H: number, f: Frame, pt: Paint) {
  const horizon = H * 0.58, n = pt.solid.length, m = Math.min(W, H);
  const sky = ctx.createLinearGradient(0, 0, 0, horizon);
  sky.addColorStop(0, pt.clear[1 % n]);
  sky.addColorStop(1, pt.solid[1 % n]);
  ctx.globalAlpha = 0.55;
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, W, horizon);
  // the sun, cut by bands that thicken toward the horizon
  const sr = m * 0.24, sx = W / 2, sy = horizon - sr * 0.35;
  const halo = ctx.createRadialGradient(sx, sy, sr * 0.8, sx, sy, sr * 2.4);
  halo.addColorStop(0, pt.solid[0]);
  halo.addColorStop(1, pt.clear[0]);
  ctx.globalAlpha = 0.4;
  ctx.fillStyle = halo;
  ctx.fillRect(0, 0, W, horizon);
  ctx.save();
  ctx.beginPath();
  const top = sy - sr, slide = (f.t * 0.04 * (0.5 + 0.5 * f.k)) % 1; // the bands drift slowly down through the sun
  ctx.rect(0, top, W, sr * 0.9);
  for (let i = 0; i < 7; i++) {
    const y = top + sr * (0.9 + ((i + slide) / 7) * 1.1), gap = sr * 0.02 * (1 + i + slide);
    ctx.rect(0, y + gap, W, (sr * 1.1) / 7 - gap);
  }
  ctx.clip();
  ctx.beginPath();
  ctx.rect(0, 0, W, horizon);
  ctx.clip();
  const sun = ctx.createLinearGradient(0, top, 0, sy + sr);
  sun.addColorStop(0, "rgba(255,240,200,.95)");
  sun.addColorStop(0.55, pt.solid[0]);
  sun.addColorStop(1, pt.solid[2 % n]);
  ctx.globalAlpha = 0.95;
  ctx.fillStyle = sun;
  ctx.beginPath();
  ctx.arc(sx, sy, sr, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  // the floor: dark, with grid lines rushing in (horizontal) and fanning out from the vanishing point
  const floor = ctx.createLinearGradient(0, horizon, 0, H);
  floor.addColorStop(0, "rgba(0,0,0,.55)");
  floor.addColorStop(1, "rgba(0,0,0,.25)");
  ctx.globalAlpha = 1;
  ctx.fillStyle = floor;
  ctx.fillRect(0, horizon, W, H - horizon);
  ctx.globalCompositeOperation = "lighter";
  ctx.strokeStyle = pt.solid[2 % n];
  ctx.lineWidth = Math.max(2, H * 0.004);
  const rows = 10, roll = (f.t * 0.25 * (0.5 + 0.5 * f.k)) % 1;
  for (let i = 0; i < rows; i++) {
    const d = (i + roll) / rows; // 0 at the horizon … 1 at the bottom edge
    const y = horizon + (H - horizon) * d * d;
    ctx.globalAlpha = 0.15 + 0.55 * d;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(W, y);
    ctx.stroke();
  }
  ctx.globalAlpha = 0.4;
  ctx.beginPath();
  for (let j = -9; j <= 9; j++) {
    ctx.moveTo(W / 2 + j * W * 0.012, horizon);
    ctx.lineTo(W / 2 + j * W * 0.16, H);
  }
  ctx.stroke();
  // the skyline glow where floor meets sky
  const line = ctx.createLinearGradient(0, horizon - H * 0.03, 0, horizon + H * 0.03);
  line.addColorStop(0, pt.clear[0]);
  line.addColorStop(0.5, pt.solid[0]);
  line.addColorStop(1, pt.clear[0]);
  ctx.globalAlpha = 0.6;
  ctx.fillStyle = line;
  ctx.fillRect(0, horizon - H * 0.03, W, H * 0.06);
  ctx.globalCompositeOperation = "source-over";
}

// vortex: soft glowing spiral arms slowly turning around a bright core, like a galaxy seen from above
function drawVortex(ctx: CanvasRenderingContext2D, W: number, H: number, f: Frame, pt: Paint) {
  const cx = W * (0.5 + 0.06 * Math.sin(f.t * 0.03)), cy = H * (0.48 + 0.05 * Math.cos(f.t * 0.025));
  const R = Math.hypot(W, H) * 0.62, spin = f.t * 0.05 * (0.5 + 0.5 * f.k), arms = 3, n = pt.solid.length;
  ctx.globalCompositeOperation = "lighter";
  ctx.lineCap = "round";
  for (let a = 0; a < arms; a++) {
    ctx.strokeStyle = pt.solid[a % n];
    // each arm: three passes, wide and faint to thin and brighter, for a soft glow without blur
    // the arm's 37 points, shared by all three passes
    const pts: number[] = [];
    for (let s = 0; s <= 36; s++) {
      const u = s / 36, ang = spin + (a / arms) * Math.PI * 2 + u * Math.PI * 2.6, rad = R * u ** 1.25;
      pts.push(cx + Math.cos(ang) * rad, cy + Math.sin(ang) * rad);
    }
    for (const [wk, alpha] of [[0.16, 0.07], [0.08, 0.1], [0.03, 0.16]]) {
      ctx.globalAlpha = alpha;
      // arms widen as they sweep out: 9 strokes of 4 segments each, in steps of width (one stroke per segment
      // cost ~3 ms a frame, and its overlapping round caps left faint beads along the arm)
      for (let b = 0; b < 36; b += 4) {
        ctx.lineWidth = R * wk * (0.25 + (b + 2) / 36);
        ctx.beginPath();
        ctx.moveTo(pts[b * 2], pts[b * 2 + 1]);
        for (let s = b + 1; s <= b + 4; s++) ctx.lineTo(pts[s * 2], pts[s * 2 + 1]);
        ctx.stroke();
      }
    }
  }
  const core = ctx.createRadialGradient(cx, cy, 0, cx, cy, R * 0.3);
  core.addColorStop(0, "rgba(255,250,240,.55)");
  core.addColorStop(0.25, pt.solid[0]);
  core.addColorStop(1, pt.clear[0]);
  ctx.globalAlpha = 0.6 + 0.1 * Math.sin(f.t * 0.4);
  ctx.fillStyle = core;
  ctx.fillRect(cx - R * 0.3, cy - R * 0.3, R * 0.6, R * 0.6);
  ctx.globalCompositeOperation = "source-over";
}

// mosaic: rounded tiles in album colors with a slow shimmer rolling diagonally across, like stained glass
function drawMosaic(ctx: CanvasRenderingContext2D, W: number, H: number, f: Frame, pt: Paint) {
  const cell = Math.max(W, H) / 13, gap = cell * 0.12, n = pt.solid.length;
  const cols = Math.ceil(W / cell) + 1, rows = Math.ceil(H / cell) + 1;
  const ox = (W - (cols - 1) * cell) / 2 - cell / 2, oy = (H - (rows - 1) * cell) / 2 - cell / 2;
  const speed = 0.35 * (0.5 + 0.5 * f.k);
  for (let j = 0; j < rows; j++)
    for (let i = 0; i < cols; i++) {
      const s = Math.sin(i * 12.9898 + j * 78.233) * 43758.5453, h = s - Math.floor(s); // stable per tile
      const wave = 0.5 + 0.5 * Math.sin((i + j) * 0.45 - f.t * speed + h * 1.5);
      ctx.globalAlpha = 0.08 + 0.42 * wave ** 2;
      ctx.fillStyle = pt.solid[Math.floor(h * n) % n];
      ctx.beginPath();
      ctx.roundRect(ox + i * cell + gap / 2, oy + j * cell + gap / 2, cell - gap, cell - gap, cell * 0.18);
      ctx.fill();
    }
}

// stable 0..1 random per (index, channel), so scenes don't jump between frames
const hash = (i: number, k: number) => { const s = Math.sin(i * 12.9898 + k * 78.233) * 43758.5453; return s - Math.floor(s); };

// jellyfish: glowing jellyfish drifting up through dark water, bells pulsing, tentacles trailing behind
function drawJellyfish(ctx: CanvasRenderingContext2D, W: number, H: number, f: Frame, pt: Paint) {
  const n = pt.solid.length, m = Math.min(W, H);
  // light filtering down from the surface
  const sky = ctx.createLinearGradient(0, 0, 0, H);
  sky.addColorStop(0, pt.solid[1 % n]);
  sky.addColorStop(0.6, pt.clear[1 % n]);
  ctx.globalAlpha = 0.25;
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, W, H);
  ctx.globalCompositeOperation = "lighter";
  ctx.lineCap = "round";
  for (let i = 0; i < 6; i++) {
    const z = 0.45 + 0.55 * hash(i, 1); // depth: near ones bigger, brighter, faster
    const r = m * (0.05 + 0.07 * z);
    const span = H + r * 8;
    const speed = (0.012 + 0.012 * z) * (0.5 + 0.5 * f.k);
    const beat = f.t * (0.9 + 0.3 * hash(i, 2)) + hash(i, 3) * 6.3; // each one pulses on its own rhythm
    const pulse = Math.sin(beat);
    // rises in little surges with each contraction of its bell
    const rise = (f.t * speed + hash(i, 4) + 0.012 * Math.cos(beat)) % 1;
    const x = W * (0.08 + 0.84 * hash(i, 5)) + Math.sin(f.t * 0.11 + i * 2) * W * 0.04;
    const y = H + r * 3 - rise * span;
    const c = i % n;
    const bw = r * (1 + 0.1 * pulse), bh = r * (0.8 - 0.1 * pulse);
    // halo
    const halo = ctx.createRadialGradient(x, y, 0, x, y, r * 3);
    halo.addColorStop(0, pt.solid[c]);
    halo.addColorStop(1, pt.clear[c]);
    ctx.globalAlpha = 0.18 * z;
    ctx.fillStyle = halo;
    ctx.fillRect(x - r * 3, y - r * 3, r * 6, r * 6);
    // tentacles: wavy strands hanging below the bell, the wave running down them
    ctx.strokeStyle = pt.solid[c];
    ctx.lineWidth = Math.max(1.5, r * 0.06);
    ctx.globalAlpha = 0.35 * z;
    ctx.beginPath();
    for (let k = 0; k < 5; k++) {
      const sx = x + bw * (k / 4 - 0.5) * 1.5;
      ctx.moveTo(sx, y);
      for (let s = 1; s <= 8; s++) {
        const d = s / 8;
        ctx.lineTo(sx + Math.sin(beat * 0.8 - d * 4 + k) * r * 0.25 * d, y + d * r * (2.4 + 0.4 * Math.cos(beat)));
      }
    }
    ctx.stroke();
    // bell: a dome with a soft rim
    const bell = ctx.createRadialGradient(x, y - bh * 0.6, 0, x, y - bh * 0.3, bw * 1.1);
    bell.addColorStop(0, "rgba(255,255,255,.75)");
    bell.addColorStop(0.35, pt.solid[c]);
    bell.addColorStop(1, pt.clear[c]);
    ctx.globalAlpha = 0.7 * z;
    ctx.fillStyle = bell;
    ctx.beginPath();
    ctx.ellipse(x, y, bw, bh, 0, Math.PI, 0);
    ctx.quadraticCurveTo(x, y + bh * 0.35, x - bw, y);
    ctx.fill();
  }
  ctx.globalCompositeOperation = "source-over";
}

// ocean: open sea seen from just above the water, in perspective. Rows of the same wave field run from the horizon
// to your feet, so swells keep their shape as they roll in and shrink with distance; crests catch the light, faces
// fall into shadow, the biggest ones whiten, and the sun lays a glittering path on the water. All in album colors.
const OCEAN_ROWS = 40, OCEAN_STEPS = 72; // drawn at half resolution (see Backdrop), so finer than the soft scenes
const oceanY = new Float32Array(OCEAN_STEPS + 3);
const glints: number[] = []; // x, y, alpha, width, height per sparkle; reused every frame
function drawOcean(ctx: CanvasRenderingContext2D, W: number, H: number, f: Frame, pt: Paint) {
  void pt;
  const c = f.colors, n = c.length, t = f.t * (0.35 + 0.65 * f.k);
  const hor = H * 0.36;
  const skyTop = mixOklab(c[1 % n], [6, 7, 14], 0.5);
  const glow = mixOklab(c[0], [255, 236, 214], 0.62); // the sky low down, warmed by the sun
  const sun = mixOklab(c[3 % n], [255, 250, 238], 0.35);
  const deep = mixOklab(c[1 % n], [2, 5, 12], 0.6);
  const lit = mixOklab(c[2 % n], [255, 255, 255], 0.55);
  // sky and sun
  const sky = ctx.createLinearGradient(0, 0, 0, hor);
  sky.addColorStop(0, css(skyTop));
  sky.addColorStop(1, css(glow));
  ctx.globalAlpha = 1;
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, W, hor + 1);
  // stars high up, only where the sky is dark enough to show them
  const dark = Math.max(0, 1 - ((skyTop[0] + skyTop[1] + skyTop[2]) / 765) * 3);
  if (dark > 0.05) {
    ctx.fillStyle = "#fff";
    for (let i = 0; i < 80; i++) {
      const y = hash(i, 8) ** 1.5 * hor * 0.75, s = (0.7 + 1.6 * hash(i, 10) ** 4) * (H / 720);
      ctx.globalAlpha = dark * (1 - y / (hor * 0.75)) * 0.55 * (0.55 + 0.45 * Math.sin(f.t * (0.6 + hash(i, 9)) + i));
      ctx.fillRect(hash(i, 7) * W, y, s, s);
    }
  }
  // long thin clouds drifting across, lit from below: brighter toward the horizon and the sun
  for (let i = 0; i < 6; i++) {
    const w = W * (0.3 + 0.45 * hash(i, 12)), h = hor * (0.03 + 0.05 * hash(i, 13)), y = hor * (0.18 + 0.68 * hash(i, 11));
    const x = ((hash(i, 14) * (W + w) + f.t * W * 0.003 * (0.5 + hash(i, 15))) % (W + w)) - w / 2;
    const cl = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
    cl.addColorStop(0, css(mixOklab(glow, skyTop, 0.25 + 0.6 * (y / hor)), 0.5 + 0.3 * (y / hor)));
    cl.addColorStop(1, css(glow, 0));
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(w / 2, h / 2);
    ctx.globalAlpha = 1;
    ctx.fillStyle = cl;
    ctx.fillRect(-1, -1, 2, 2);
    ctx.restore();
  }
  ctx.globalAlpha = 1;
  const sx = W * (0.62 + 0.04 * Math.sin(f.t * 0.01)), sy = hor - H * 0.09, sr = H * 0.045;
  const halo = ctx.createRadialGradient(sx, sy, sr * 0.5, sx, sy, sr * 9);
  halo.addColorStop(0, css(sun, 0.55));
  halo.addColorStop(1, css(sun, 0));
  ctx.fillStyle = halo;
  ctx.fillRect(sx - sr * 9, 0, sr * 18, hor);
  ctx.fillStyle = css(sun);
  ctx.beginPath();
  ctx.arc(sx, sy, sr, 0, Math.PI * 2);
  ctx.fill();
  // a hot core and a tight bloom, added on top so the sun glows instead of sitting flat
  const bloom = ctx.createRadialGradient(sx, sy, 0, sx, sy, sr * 2.6);
  bloom.addColorStop(0, "rgba(255,248,232,.85)");
  bloom.addColorStop(0.38, css(sun, 0.45));
  bloom.addColorStop(1, css(sun, 0));
  ctx.globalCompositeOperation = "lighter";
  ctx.fillStyle = bloom;
  ctx.fillRect(sx - sr * 2.6, sy - sr * 2.6, sr * 5.2, sr * 5.2);
  ctx.globalCompositeOperation = "source-over";
  // the sea under it, reflecting the glow near the horizon
  const sea = ctx.createLinearGradient(0, hor, 0, H);
  sea.addColorStop(0, css(mixOklab(glow, deep, 0.55)));
  sea.addColorStop(0.35, css(deep));
  sea.addColorStop(1, css(mixOklab(deep, [0, 0, 0], 0.7)));
  ctx.fillStyle = sea;
  ctx.fillRect(0, hor, W, H - hor);
  // wave height at a point: sharp crests, broad troughs, three swells from slightly different directions
  const crest = (a: number) => { const s = 0.5 + 0.5 * Math.sin(a); return 2 * s * s - 0.6; };
  const height = (x: number, z: number) =>
    0.55 * crest(0.85 * z + 0.22 * x - 1.05 * t) + 0.3 * crest(1.6 * z - 0.5 * x - 1.6 * t + 1.3) + 0.15 * Math.sin(3.2 * z + 1.1 * x - 2.4 * t + 2.1);
  const step = W / OCEAN_STEPS, spanY = H - hor;
  ctx.lineJoin = "round";
  // far rows first; each row fills from its crest line down past the next one, which then overlaps it
  for (let k = OCEAN_ROWS - 1; k >= 0; k--) {
    const s = k / OCEAN_ROWS; // 0 at your feet, 1 at the horizon
    const near = 1 - s, z = 14 / (0.04 + 0.96 * near); // world distance: a few swells between you and mid-sea
    const yb = hor + spanY * (1 - s) ** 1.25 * 1.04;
    const amp = spanY * 0.13 * near ** 1.5;
    const gap = spanY * 0.05 * near + 2;
    let top = Infinity;
    for (let i = 0; i <= OCEAN_STEPS + 2; i++) {
      const x = (i - 1) * step, y = yb - height(((x - W / 2) / W) * z * 0.9, z) * amp;
      oceanY[i] = y;
      if (y < top) top = y;
    }
    // lit back of the swell at the crest, the face toward you falling into shadow
    const shade = mixOklab(mixOklab(glow, deep, 0.5), deep, s ** 0.6);
    const g = ctx.createLinearGradient(0, top, 0, yb + gap + amp);
    g.addColorStop(0, css(mixOklab(lit, shade, 0.3 + 0.35 * near)));
    g.addColorStop(0.3, css(shade));
    g.addColorStop(1, css(mixOklab(shade, [0, 0, 0], 0.45)));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(-step, oceanY[0]);
    for (let i = 1; i <= OCEAN_STEPS + 2; i++) ctx.lineTo((i - 1) * step, oceanY[i]);
    const bottom = k === 0 ? H + 2 : yb + gap + amp * 0.8; // just past the next row's troughs, no deeper
    ctx.lineTo(W + step, bottom);
    ctx.lineTo(-step, bottom);
    ctx.closePath();
    ctx.fill();
    // a fine bright rim along the crest, and white water where a near swell peaks
    if (near > 0.25) {
      // (far rims would be under 2% bright: skipped)
      ctx.strokeStyle = css(lit);
      ctx.globalAlpha = 0.35 * near * near;
      ctx.lineWidth = Math.max(1, H * 0.002 * (0.5 + near));
      ctx.beginPath();
      for (let i = 0; i <= OCEAN_STEPS + 2; i++) {
        if (i) ctx.lineTo((i - 1) * step, oceanY[i]);
        else ctx.moveTo(-step, oceanY[0]);
      }
      ctx.stroke();
    }
    if (near > 0.3) {
      ctx.strokeStyle = "#fff";
      ctx.globalAlpha = 0.4 * near * near;
      ctx.lineWidth = Math.max(1, H * 0.004 * near);
      ctx.beginPath();
      for (let i = 1; i <= OCEAN_STEPS + 1; i++) {
        if (yb - oceanY[i] < amp * 0.72) continue; // only the highest crests break
        ctx.moveTo((i - 1.4) * step, oceanY[i] + 0.4 * (oceanY[i - 1] - oceanY[i]));
        ctx.lineTo((i - 1) * step, oceanY[i]);
        ctx.lineTo((i - 0.6) * step, oceanY[i] + 0.4 * (oceanY[i + 1] - oceanY[i]));
      }
      ctx.stroke();
    }
    // the sun's path: sparkles on the raised water under the sun, widening as they come closer (drawn last, on top)
    const spread = W * (0.025 + 0.16 * near);
    for (let i = 1; i <= OCEAN_STEPS + 1; i++) {
      const x = (i - 1) * step, dx = Math.abs(x - sx) / spread, up = (yb - oceanY[i]) / amp;
      if (dx > 1 || up < 0.1) continue;
      const tw = hash(k * 97 + i, Math.floor(f.t * 2.5 + hash(k, i) * 7));
      glints.push(x, oceanY[i], (1 - dx * dx) * Math.min(1, up * 1.5) * (0.3 + 0.7 * tw), step * (0.5 + 0.9 * near) * (0.6 + 0.6 * tw), Math.max(1, H * 0.0035 * (0.4 + near)));
    }
    ctx.globalAlpha = 1;
  }
  // a soft path of light from the sun to your feet, its edges feathered, with the sparkles on top
  ctx.globalCompositeOperation = "lighter";
  for (let j = 0; j < 12; j++) {
    const q = (j + 0.5) / 12, wv = W * (0.03 + 0.2 * q), y0 = hor + (spanY * j) / 12;
    const g = ctx.createLinearGradient(sx - wv, 0, sx + wv, 0);
    g.addColorStop(0, css(sun, 0));
    g.addColorStop(0.5, css(sun, 0.13 * (1 - 0.6 * q)));
    g.addColorStop(1, css(sun, 0));
    ctx.fillStyle = g;
    ctx.fillRect(sx - wv, y0, wv * 2, spanY / 12 + 1);
  }
  ctx.fillStyle = css(sun);
  for (let k = 0; k < glints.length; k += 5) {
    ctx.globalAlpha = glints[k + 2];
    ctx.fillRect(glints[k] - glints[k + 3] / 2, glints[k + 1], glints[k + 3], glints[k + 4]);
  }
  glints.length = 0;
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = "source-over";
  // a band of haze where sea meets sky

  // (deep enough to melt the far rows together, which would otherwise read as flat stripes)
  const haze = ctx.createLinearGradient(0, hor - H * 0.05, 0, hor + H * 0.16);
  haze.addColorStop(0, css(glow, 0));
  haze.addColorStop(0.25, css(glow, 0.6));
  haze.addColorStop(0.55, css(glow, 0.22));
  haze.addColorStop(1, css(glow, 0));
  ctx.fillStyle = haze;
  ctx.fillRect(0, hor - H * 0.05, W, H * 0.21);
}

// dunes: a night desert. Layered ridges drift past at different speeds under a glowing moon
function drawDunes(ctx: CanvasRenderingContext2D, W: number, H: number, f: Frame, pt: Paint) {
  const n = pt.solid.length, m = Math.min(W, H);
  const sky = ctx.createLinearGradient(0, 0, 0, H * 0.7);
  sky.addColorStop(0, pt.clear[1 % n]);
  sky.addColorStop(1, pt.solid[1 % n]);
  ctx.globalAlpha = 0.5;
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, W, H);
  // the moon, rising and setting very slowly
  const mx = W * 0.72, my = H * (0.24 + 0.04 * Math.sin(f.t * 0.02)), mr = m * 0.07;
  const glow = ctx.createRadialGradient(mx, my, mr * 0.8, mx, my, mr * 5);
  glow.addColorStop(0, pt.solid[0]);
  glow.addColorStop(1, pt.clear[0]);
  ctx.globalAlpha = 0.45;
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);
  // faint stars, twinkling, thinning toward the glowing horizon
  ctx.fillStyle = "rgba(255,255,255,1)";
  for (let i = 0; i < 70; i++) {
    const x = hash(i, 41) * W, y = hash(i, 42) ** 1.5 * H * 0.55, s = (0.6 + hash(i, 43)) * m * 0.0018;
    ctx.globalAlpha = 0.5 * (1 - y / (H * 0.55)) * (0.6 + 0.4 * Math.sin(f.t * (0.5 + hash(i, 44)) + i));
    ctx.fillRect(x, y, s, s);
  }
  ctx.globalAlpha = 0.95;
  const disc = ctx.createRadialGradient(mx - mr * 0.25, my - mr * 0.25, 0, mx, my, mr);
  disc.addColorStop(0, "rgba(255,250,238,1)");
  disc.addColorStop(0.9, "rgba(244,236,220,.95)");
  disc.addColorStop(1, "rgba(244,236,220,0)");
  ctx.fillStyle = disc;
  ctx.fillRect(mx - mr, my - mr, mr * 2, mr * 2);
  // ridges, far to near: lower, darker, faster. Each crest catches the moonlight on its rim.
  const step = W / 48, ys: number[] = [];
  for (let i = 0; i < 4; i++) {
    const top = H * (0.55 + i * 0.1), amp = H * (0.07 - i * 0.008);
    const drift = f.t * (0.01 + i * 0.012) * (0.5 + 0.5 * f.k);
    ys.length = 0;
    for (let x = -step; x <= W + step; x += step) {
      const u = x / W + drift;
      // abs(sin) gives the sharp crest and soft hollow of a wind-blown dune
      ys.push(top - amp * (Math.abs(Math.sin(u * (2.2 + i * 0.7) + i * 1.9)) * 0.75 + Math.sin(u * 7.3 + i) * 0.25));
    }
    ctx.beginPath();
    ctx.moveTo(-step, H);
    ys.forEach((y, k) => ctx.lineTo(-step + k * step, y));
    ctx.lineTo(W + step, H);
    ctx.closePath();
    const g = ctx.createLinearGradient(0, top - amp, 0, H);
    g.addColorStop(0, pt.solid[1 % n]);
    g.addColorStop(1, pt.base);
    ctx.globalAlpha = 0.5;
    ctx.fillStyle = g;
    ctx.fill();
    ctx.globalAlpha = 0.3 + i * 0.17; // nearer ridges sink into shadow
    ctx.fillStyle = "#000";
    ctx.fill();
    // the rim: brightest on the side facing the moon
    const rim = ctx.createLinearGradient(0, 0, W, 0);
    rim.addColorStop(0, "rgba(255,240,220,.05)");
    rim.addColorStop(mx / W, "rgba(255,240,220,.6)");
    rim.addColorStop(1, "rgba(255,240,220,.15)");
    ctx.globalAlpha = 0.55 - i * 0.1;
    ctx.strokeStyle = rim;
    ctx.lineWidth = m * 0.003;
    ctx.beginPath();
    ys.forEach((y, k) => (k ? ctx.lineTo(-step + k * step, y) : ctx.moveTo(-step, y)));
    ctx.stroke();
  }
}

// orbits: planets circling a glowing star along tilted rings, like an orrery seen at an angle
function drawOrbits(ctx: CanvasRenderingContext2D, W: number, H: number, f: Frame, pt: Paint) {
  const n = pt.solid.length, m = Math.min(W, H);
  const cx = W * 0.5, cy = H * 0.5, tilt = -0.32, flat = 0.36, ct = Math.cos(tilt), st = Math.sin(tilt);
  const star = ctx.createRadialGradient(cx, cy, 0, cx, cy, m * 0.35);
  star.addColorStop(0, "rgba(255,248,235,.8)");
  star.addColorStop(0.18, pt.solid[0]);
  star.addColorStop(1, pt.clear[0]);
  ctx.globalCompositeOperation = "lighter";
  ctx.globalAlpha = 0.6 + 0.08 * Math.sin(f.t * 0.5);
  ctx.fillStyle = star;
  ctx.fillRect(cx - m * 0.35, cy - m * 0.35, m * 0.7, m * 0.7);
  for (let i = 0; i < 5; i++) {
    const R = m * (0.2 + i * 0.13), c = (i + 1) % n;
    ctx.strokeStyle = pt.solid[c];
    ctx.lineWidth = Math.max(1.5, m * 0.003);
    ctx.globalAlpha = 0.22;
    ctx.beginPath();
    ctx.ellipse(cx, cy, R, R * flat, tilt, 0, Math.PI * 2);
    ctx.stroke();
    // inner planets go round faster
    const a = f.t * (0.16 / (1 + i * 0.7)) * (0.5 + 0.5 * f.k) + hash(i, 1) * 6.3;
    const ex = Math.cos(a) * R, ey = Math.sin(a) * R * flat;
    const px = cx + ex * ct - ey * st, py = cy + ex * st + ey * ct;
    const pr = m * (0.012 + 0.016 * hash(i, 2)) * (0.85 + 0.15 * Math.sin(a)); // a touch bigger on the near side
    const g = ctx.createRadialGradient(px, py, 0, px, py, pr * 4);
    g.addColorStop(0, "rgba(255,255,255,.9)");
    g.addColorStop(0.25, pt.solid[c]);
    g.addColorStop(1, pt.clear[c]);
    ctx.globalAlpha = 0.85;
    ctx.fillStyle = g;
    ctx.fillRect(px - pr * 4, py - pr * 4, pr * 8, pr * 8);
  }
  ctx.globalCompositeOperation = "source-over";
}

// topo: a living topographic map. Contour lines of a slowly shifting landscape (real contours of one height field,
// so they never cross), glowing from valley to peak, with every fifth line drawn heavier like a survey map.
const TOPO_X = 48, TOPO_Y = 27;
const topoField = new Float32Array((TOPO_X + 1) * (TOPO_Y + 1));
// marching squares: which cell edges (0 top, 1 right, 2 bottom, 3 left) each corner pattern joins
const MARCH: number[][] = [[], [3, 2], [2, 1], [3, 1], [0, 1], [3, 0, 2, 1], [0, 2], [3, 0], [3, 0], [0, 2], [0, 1, 3, 2], [0, 1], [3, 1], [2, 1], [3, 2], []];
function drawTopo(ctx: CanvasRenderingContext2D, W: number, H: number, f: Frame, pt: Paint) {
  const n = pt.solid.length, t = f.t * 0.05 * (0.5 + 0.5 * f.k);
  const hills = [0, 1, 2, 3].map((i) => [0.5 + 0.38 * Math.sin(t * (0.7 + i * 0.23) + i * 2.1), 0.5 + 0.36 * Math.cos(t * (0.5 + i * 0.31) + i * 1.3), 0.6 + 0.4 * hash(i, 7)]);
  let lo = Infinity, hi = -Infinity;
  for (let j = 0; j <= TOPO_Y; j++)
    for (let i = 0; i <= TOPO_X; i++) {
      const u = i / TOPO_X, v = j / TOPO_Y;
      let h = 0.18 * Math.sin(u * 5.1 + t * 0.9) * Math.cos(v * 4.3 - t * 0.7);
      for (const [hx, hy, hk] of hills) h += hk * Math.exp(-((u - hx) ** 2 * 7 + (v - hy) ** 2 * 12));
      topoField[j * (TOPO_X + 1) + i] = h;
      if (h < lo) lo = h;
      if (h > hi) hi = h;
    }
  // the high ground glows softly under the lines
  ctx.globalCompositeOperation = "lighter";
  hills.forEach(([hx, hy, hk], i) => {
    const x = hx * W, y = hy * H, r = Math.max(W, H) * 0.32 * hk;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, pt.solid[i % n]);
    g.addColorStop(1, pt.clear[i % n]);
    ctx.globalAlpha = 0.3;
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  });
  const cw = W / TOPO_X, ch = H / TOPO_Y, LEVELS = 15, F = topoField, RW = TOPO_X + 1;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  for (let k = 0; k < LEVELS; k++) {
    const l = lo + ((k + 0.6) / (LEVELS + 0.4)) * (hi - lo);
    const major = k % 5 === 4;
    ctx.strokeStyle = pt.solid[Math.floor((k / LEVELS) * n) % n]; // valleys in one album color, peaks in another
    ctx.globalAlpha = major ? 0.85 : 0.45 + 0.25 * (k / LEVELS);
    ctx.lineWidth = H * (major ? 0.0042 : 0.0024);
    ctx.beginPath();
    for (let j = 0; j < TOPO_Y; j++)
      for (let i = 0; i < TOPO_X; i++) {
        const o = j * RW + i, a = F[o], b = F[o + 1], c = F[o + RW + 1], d = F[o + RW];
        const segs = MARCH[(a > l ? 8 : 0) | (b > l ? 4 : 0) | (c > l ? 2 : 0) | (d > l ? 1 : 0)];
        for (let s = 0; s < segs.length; s++) {
          // where the level crosses this edge
          const e = segs[s], x0 = i * cw, y0 = j * ch;
          const x = e === 0 ? x0 + ((l - a) / (b - a)) * cw : e === 1 ? x0 + cw : e === 2 ? x0 + ((l - d) / (c - d)) * cw : x0;
          const y = e === 0 ? y0 : e === 1 ? y0 + ((l - b) / (c - b)) * ch : e === 2 ? y0 + ch : y0 + ((l - a) / (d - a)) * ch;
          if (s % 2) ctx.lineTo(x, y);
          else ctx.moveTo(x, y);
        }
      }
    ctx.stroke();
  }
  ctx.globalCompositeOperation = "source-over";
}

// koi: koi gliding through a dark pond. Each body bends along the path its head has just taken, fins and tail
// sway as it swims; lily pads (one in flower) drift on the surface and the odd ripple spreads out.
function drawKoi(ctx: CanvasRenderingContext2D, W: number, H: number, f: Frame, pt: Paint) {
  void pt;
  const c = f.colors, n = c.length, m = Math.min(W, H), s = 0.5 + 0.5 * f.k;
  const deep = ctx.createRadialGradient(W * 0.45, H * 0.4, 0, W * 0.5, H * 0.5, Math.max(W, H) * 0.8);
  deep.addColorStop(0, css(mixOklab(c[1 % n], [10, 14, 18], 0.55)));
  deep.addColorStop(1, css(mixOklab(c[1 % n], [2, 3, 6], 0.25)));
  ctx.globalAlpha = 1;
  ctx.fillStyle = deep;
  ctx.fillRect(0, 0, W, H);
  // ripples, each from its own spot, a few seconds apart
  ctx.strokeStyle = "#fff";
  ctx.lineWidth = Math.max(1.5, m * 0.0025);
  for (let k = 0; k < 3; k++) {
    const T = f.t * 0.12 + k / 3, id = Math.floor(T), p = T - id, x = W * (0.1 + 0.8 * hash(id, k + 11)), y = H * (0.1 + 0.8 * hash(id, k + 21));
    for (const lag of [0, 0.12]) {
      const pp = p - lag;
      if (pp <= 0) continue;
      ctx.globalAlpha = 0.2 * (1 - pp);
      ctx.beginPath();
      ctx.arc(x, y, m * (0.02 + 0.22 * pp), 0, Math.PI * 2);
      ctx.stroke();
    }
  }
  // the fish: the head follows a slow loop; the body lies where the head was a moment ago
  const path = (i: number, tt: number): [number, number] => {
    const w = (0.1 + 0.05 * hash(i, 1)) * s, ph = hash(i, 2) * 6.3;
    return [W * (0.5 + 0.42 * Math.sin(tt * w + ph)), H * (0.5 + 0.4 * Math.sin(tt * w * 1.6 + ph * 1.7))];
  };
  const SEG = 14;
  const KINDS: [Rgb, Rgb][] = [[[246, 242, 234], [232, 70, 30]], [[248, 150, 40], [255, 214, 120]], [[246, 242, 234], [30, 26, 30]], [[236, 90, 40], [246, 242, 234]]];
  for (let i = 0; i < 4; i++) {
    const R = m * (0.05 + 0.015 * hash(i, 3));
    const pts = Array.from({ length: SEG }, (_, k) => path(i, f.t - (k * 0.24) / s));
    const width = (k: number) => R * (k < 3 ? 0.55 + 0.15 * k : 1 - ((k - 3) / (SEG - 3)) ** 1.4 * 0.85); // round head, slim tail
    const [baseRaw, patchRaw] = KINDS[i % KINDS.length];
    const base = mixOklab(baseRaw, c[i % n], 0.5), patch = mixOklab(c[(i + 1) % n], patchRaw, 0.6); // koi markings, in the album's colors
    // the outline of the body: left side down to the tail, right side back up
    const left: number[] = [], right: number[] = [];
    for (let k = 0; k < SEG; k++) {
      const [x, y] = pts[k], [px, py] = pts[Math.max(0, k - 1)], [nx, ny] = pts[Math.min(SEG - 1, k + 1)];
      const a = Math.atan2(ny - py, nx - px) + Math.PI / 2, w = width(k);
      left.push(x + Math.cos(a) * w, y + Math.sin(a) * w);
      right.push(x - Math.cos(a) * w, y - Math.sin(a) * w);
    }
    const body = () => {
      ctx.beginPath();
      ctx.moveTo(left[0], left[1]);
      for (let k = 1; k < SEG; k++) ctx.lineTo(left[k * 2], left[k * 2 + 1]);
      for (let k = SEG - 1; k >= 0; k--) ctx.lineTo(right[k * 2], right[k * 2 + 1]);
      ctx.closePath();
    };
    const [hx, hy] = pts[0], [h2x, h2y] = pts[3], ang = Math.atan2(hy - h2y, hx - h2x), sway = Math.sin(f.t * 4.5 * s + i * 2);
    // fins and tail: translucent, under the body
    ctx.fillStyle = css(mixOklab(base, [255, 255, 255], 0.5));
    ctx.globalAlpha = 0.5;
    const [fx, fy] = pts[3];
    for (const side of [-1, 1]) {
      ctx.beginPath();
      ctx.ellipse(fx + Math.cos(ang + side * 1.9) * R * 1.05, fy + Math.sin(ang + side * 1.9) * R * 1.05, R * 0.6, R * 0.24, ang + side * (1.15 + 0.3 * sway), 0, Math.PI * 2);
      ctx.fill();
    }
    const [tx, ty] = pts[SEG - 1], [px, py] = pts[SEG - 3], ta = Math.atan2(ty - py, tx - px);
    for (const side of [-1, 1]) {
      ctx.beginPath();
      ctx.ellipse(tx + Math.cos(ta + side * 0.45) * R * 0.75, ty + Math.sin(ta + side * 0.45) * R * 0.75, R * 0.7, R * 0.26, ta + side * 0.5 + 0.35 * sway, 0, Math.PI * 2);
      ctx.fill();
    }
    // the body with a soft shadow on the pond floor, then its patches
    ctx.save();
    ctx.shadowColor = "rgba(0,0,0,.5)";
    ctx.shadowBlur = 6;
    ctx.shadowOffsetX = 3;
    ctx.shadowOffsetY = 5;
    ctx.globalAlpha = 1;
    ctx.fillStyle = css(base);
    body();
    ctx.fill();
    ctx.restore();
    ctx.save();
    body();
    ctx.clip();
    ctx.fillStyle = css(patch);
    for (let k = 0; k < 4; k++) {
      const at = 1 + Math.floor(hash(i, k + 50) * (SEG - 5)), [x, y] = pts[at];
      ctx.beginPath();
      ctx.arc(x + (hash(i, k + 60) - 0.5) * R, y + (hash(i, k + 70) - 0.5) * R, R * (0.5 + 0.6 * hash(i, k + 80)), 0, Math.PI * 2);
      ctx.fill();
    }
    // a sheen along the back
    ctx.strokeStyle = "rgba(255,255,255,.35)";
    ctx.lineWidth = R * 0.25;
    ctx.beginPath();
    for (let k = 1; k < SEG - 3; k++) {
      if (k === 1) ctx.moveTo(pts[k][0], pts[k][1]);
      else ctx.lineTo(pts[k][0], pts[k][1]);
    }
    ctx.stroke();
    ctx.restore();
  }
  // lily pads floating over everything, turning very slowly; the first one is in flower
  for (let i = 0; i < 5; i++) {
    const x = W * (0.08 + 0.84 * hash(i, 41)) + Math.sin(f.t * 0.03 + i) * W * 0.01, y = H * (0.08 + 0.84 * hash(i, 42)), r = m * (0.05 + 0.035 * hash(i, 43));
    const rot = f.t * 0.02 * (hash(i, 44) - 0.5) + i * 1.3;
    const leaf = mixOklab(c[(i + 2) % n], [40, 90, 50], 0.55);
    ctx.save();
    ctx.shadowColor = "rgba(0,0,0,.45)";
    ctx.shadowBlur = 5;
    ctx.shadowOffsetX = 2;
    ctx.shadowOffsetY = 4;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, css(mixOklab([255, 255, 220], leaf, 0.25)));
    g.addColorStop(1, css(leaf));
    ctx.fillStyle = g;
    ctx.globalAlpha = 0.95;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.arc(x, y, r, rot + 0.3, rot + Math.PI * 2 - 0.05); // the notch
    ctx.closePath();
    ctx.fill();
    ctx.restore();
    // veins
    ctx.strokeStyle = css(mixOklab([20, 60, 25], leaf, 0.5));
    ctx.globalAlpha = 0.5;
    ctx.lineWidth = Math.max(1, r * 0.03);
    ctx.beginPath();
    for (let v = 1; v < 9; v++) {
      const a = rot + 0.3 + (v / 9) * (Math.PI * 2 - 0.35);
      ctx.moveTo(x, y);
      ctx.lineTo(x + Math.cos(a) * r * 0.9, y + Math.sin(a) * r * 0.9);
    }
    ctx.stroke();
    if (i === 0) {
      // a lotus: two rings of pink petals around a golden heart
      const petal = mixOklab(mixOklab(c[0], [255, 255, 255], 0.55), [250, 170, 200], 0.7);
      for (const [ring, pr, count] of [[0, 0.8, 8], [1, 0.52, 6]]) {
        ctx.fillStyle = css(mixOklab([255, 255, 255], petal, ring * 0.45));
        ctx.globalAlpha = 0.95;
        for (let k = 0; k < count; k++) {
          const a = rot * 2 + (k / count) * Math.PI * 2 + ring * 0.4;
          ctx.beginPath();
          ctx.ellipse(x + Math.cos(a) * r * pr * 0.6, y + Math.sin(a) * r * pr * 0.6, r * pr * 0.55, r * pr * 0.22, a, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      ctx.fillStyle = "rgba(255,210,90,.95)";
      ctx.beginPath();
      ctx.arc(x, y, r * 0.14, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

// skyline: a city at night in parallax layers. Hazier towers far off, darker ones close, with setbacks, pitched
// roofs, rooftop plant, spires and blinking beacons. What makes it read as a city rather than boxes: the glow of
// the street climbing the towers and the haze, and windows in three kinds of light, some floors of an office lit
// end to end, flats lit here and there, a few switching on and off; stars, drifting clouds and a moon.
function drawSkyline(ctx: CanvasRenderingContext2D, W: number, H: number, f: Frame, pt: Paint) {
  void pt;
  const c = f.colors, n = c.length, m = Math.min(W, H);
  const glow = mixOklab(c[0], [255, 210, 170], 0.72); // the light of the city itself, low in the sky
  const sky = ctx.createLinearGradient(0, 0, 0, H);
  sky.addColorStop(0, css(mixOklab(c[1 % n], [4, 4, 10], 0.4)));
  sky.addColorStop(0.7, css(mixOklab(c[0], [30, 20, 40], 0.65)));
  sky.addColorStop(1, css(glow));
  ctx.globalAlpha = 1;
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, W, H);
  // the dome of light a city throws up into the haze
  const dome = ctx.createRadialGradient(W * 0.5, H * 1.08, 0, W * 0.5, H * 1.08, W * 0.62);
  dome.addColorStop(0, css(glow, 0.5));
  dome.addColorStop(1, css(glow, 0));
  ctx.fillStyle = dome;
  ctx.fillRect(0, 0, W, H);
  // stars: round, twinkling, thinning toward the glow of the city
  ctx.fillStyle = "#fff";
  for (let i = 0; i < 90; i++) {
    const y = H * 0.55 * hash(i, 2) ** 1.4, a = (0.25 + 0.6 * hash(i, 3)) * (0.6 + 0.4 * Math.sin(f.t * (0.6 + hash(i, 4)) + i)) * (1 - y / (H * 0.55));
    ctx.globalAlpha = a;
    ctx.beginPath();
    ctx.arc(W * hash(i, 1), y, m * (0.0008 + 0.0014 * hash(i, 5) ** 2), 0, Math.PI * 2);
    ctx.fill();
  }
  // moon, its halo, and the faint seas on its face
  const mx = W * 0.78, my = H * 0.2, mr = m * 0.05;
  const halo = ctx.createRadialGradient(mx, my, mr, mx, my, mr * 7);
  halo.addColorStop(0, "rgba(255,245,225,.28)");
  halo.addColorStop(1, "rgba(255,245,225,0)");
  ctx.globalAlpha = 1;
  ctx.fillStyle = halo;
  ctx.fillRect(mx - mr * 7, my - mr * 7, mr * 14, mr * 14);
  const disc = ctx.createRadialGradient(mx - mr * 0.3, my - mr * 0.3, 0, mx, my, mr);
  disc.addColorStop(0, "rgba(255,252,240,1)");
  disc.addColorStop(1, "rgba(240,228,205,1)");
  ctx.fillStyle = disc;
  ctx.beginPath();
  ctx.arc(mx, my, mr, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "rgba(120,108,96,.07)";
  ctx.beginPath();
  for (const [dx, dy, r] of [[-0.26, -0.14, 0.42], [-0.12, -0.02, 0.3], [0.32, 0.28, 0.3], [0.1, -0.5, 0.2]]) {
    ctx.moveTo(mx + (dx + r) * mr, my + dy * mr);
    ctx.arc(mx + dx * mr, my + dy * mr, r * mr, 0, Math.PI * 2);
  }
  ctx.fill();
  // clouds: clusters of soft puffs drifting across, lit from below by the city
  const cloud = mixOklab(c[2 % n], [200, 200, 210], 0.55);
  for (let i = 0; i < 4; i++) {
    const span = W * 1.8, cx0 = ((f.t * W * (0.004 + 0.003 * hash(i, 1)) + hash(i, 2) * span) % span) - W * 0.4, cy0 = H * (0.1 + 0.28 * hash(i, 3));
    for (let k = 0; k < 6; k++) {
      const x = cx0 + (k - 2.5) * W * 0.045 + hash(i * 7 + k, 9) * W * 0.03, y = cy0 + (hash(i * 7 + k, 10) - 0.5) * H * 0.03, r = m * (0.05 + 0.05 * hash(i * 7 + k, 11));
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, css(cloud, 0.16));
      g.addColorStop(1, css(cloud, 0));
      ctx.fillStyle = g;
      ctx.fillRect(x - r, y - r, r * 2, r * 2);
    }
  }
  // three layers of towers; each repeats every two window widths and slides past at its own slow pace
  const lights = [css(mixOklab(c[3 % n], [255, 236, 190], 0.45)), "rgb(255,198,124)", "rgb(208,228,255)"]; // the album's light color, lamp amber, cool office white
  for (let layer = 0; layer < 3; layer++) {
    const span = W * 2, slide = (f.t * W * 0.002 * (layer + 1)) % span;
    const base = H * 1.01, tall = H * (0.3 + layer * 0.13);
    const shade = mixOklab([5, 5, 11], mixOklab(c[0], c[1 % n], 0.5), 0.5 + layer * 0.16);
    const lit: number[][] = [[], [], []], beacons: number[] = [];
    ctx.fillStyle = css(shade);
    ctx.globalAlpha = 1;
    ctx.beginPath();
    let x = -slide;
    for (let b = 0; x < W && b < 400; b++) {
      const id = (b % 40) + layer * 100, w = W * (0.035 + 0.05 * hash(id, 1)), h = tall * (0.35 + 0.65 * hash(id, 2) ** 1.3);
      if (x + w > 0) {
        const top = base - h;
        ctx.rect(x, top, w + 1, h);
        const roof = hash(id, 6);
        if (roof < 0.3) {
          // setbacks: the tower steps in twice toward its top
          ctx.rect(x + w * 0.14, top - h * 0.05, w * 0.72, h * 0.05 + 1);
          ctx.rect(x + w * 0.3, top - h * 0.09, w * 0.4, h * 0.04 + 1);
        } else if (roof < 0.44) {
          // a pitched roof
          ctx.moveTo(x, top + 1);
          ctx.lineTo(x + w * (0.25 + 0.5 * hash(id, 12)), top - h * 0.07);
          ctx.lineTo(x + w + 1, top + 1);
          ctx.closePath();
        } else if (roof < 0.6) {
          // rooftop plant: a lift housing and a tank
          ctx.rect(x + w * 0.12, top - m * 0.012, w * 0.3, m * 0.012 + 1);
          ctx.rect(x + w * 0.62, top - m * 0.007, w * 0.2, m * 0.007 + 1);
        } else if (roof > 0.8) {
          // a spire with a beacon
          ctx.rect(x + w * 0.47, top - h * 0.16, w * 0.06, h * 0.16);
          ctx.rect(x + w * 0.4, top - h * 0.03, w * 0.2, h * 0.03 + 1);
          beacons.push(x + w * 0.5, top - h * 0.16, id);
        }
        // windows on a grid of the building's own: an office lights whole floors, flats here and there
        const cw = H * (0.0085 + 0.004 * hash(id, 8)) * (0.7 + 0.15 * layer), ch = cw * (1.35 + 0.5 * hash(id, 9));
        const cols = Math.floor((w - cw * 0.5) / cw), rows = Math.floor(h / ch) - 1, office = hash(id, 10) < 0.35;
        const x0 = x + (w - cols * cw) / 2 + cw * 0.22, kind = Math.floor(hash(id, 11) * 3);
        for (let r = 1; r < rows; r++) {
          const floor = office && hash(id * 17 + r, 3) < 0.3;
          for (let q = 0; q < cols; q++) {
            const hk = hash(id * 31 + r, q + 7);
            if (floor ? hk > 0.12 : hk < 0.2 || (hk < 0.3 && hash(id + r * 13 + q, Math.floor(f.t * 0.15 + hk * 9)) < 0.5))
              lit[office ? (floor ? 2 : kind) : (hk * 50) % 1 < 0.7 ? kind % 2 : 2].push(x0 + cw * q, top + ch * r, cw * 0.52, ch * 0.46);
          }
        }
      }
      x += w + W * 0.004;
    }
    ctx.fill();
    // the glow of the street climbing the towers from their feet (inside their outline only)
    ctx.save();
    ctx.clip();
    const lift = ctx.createLinearGradient(0, base - tall, 0, base);
    lift.addColorStop(0, css(glow, 0));
    lift.addColorStop(0.5, css(glow, 0.07));
    lift.addColorStop(1, css(glow, 0.5 - layer * 0.08));
    ctx.fillStyle = lift;
    ctx.fillRect(0, base - tall * 1.2, W, tall * 1.2);
    ctx.restore();
    for (let k = 0; k < 3; k++) {
      const ws = lit[k];
      if (!ws.length) continue;
      ctx.fillStyle = lights[k];
      ctx.globalAlpha = 0.3 + layer * 0.27;
      ctx.beginPath();
      for (let j = 0; j < ws.length; j += 4) ctx.rect(ws[j], ws[j + 1], ws[j + 2], ws[j + 3]);
      ctx.fill();
    }
    for (let k = 0; k < beacons.length; k += 3) {
      const on = Math.sin(f.t * 2.2 + beacons[k + 2]) > 0.6;
      if (!on) continue;
      const g = ctx.createRadialGradient(beacons[k], beacons[k + 1], 0, beacons[k], beacons[k + 1], m * 0.018);
      g.addColorStop(0, "rgba(255,70,60,.95)");
      g.addColorStop(1, "rgba(255,70,60,0)");
      ctx.globalAlpha = 1;
      ctx.fillStyle = g;
      ctx.fillRect(beacons[k] - m * 0.018, beacons[k + 1] - m * 0.018, m * 0.036, m * 0.036);
    }
    // haze between layers, thicker far away; after the nearest, the glow of the street itself
    const haze = ctx.createLinearGradient(0, base - tall, 0, base);
    haze.addColorStop(0, "rgba(0,0,0,0)");
    haze.addColorStop(layer < 2 ? 1 : 0.7, css(glow, layer < 2 ? 0.2 : 0));
    if (layer === 2) haze.addColorStop(1, css(glow, 0.22));
    ctx.globalAlpha = 1;
    ctx.fillStyle = haze;
    ctx.fillRect(0, base - tall, W, tall);
  }
}


// galaxy: a spiral galaxy seen at a tilt, turning slowly; a warm core, arms of album-colored stars, dust glow
const GALAXY_STARS = 1800;
function drawGalaxy(ctx: CanvasRenderingContext2D, W: number, H: number, f: Frame, pt: Paint) {
  const n = pt.solid.length, m = Math.max(W, H), R = m * 0.46, tilt = 0.48, spin = f.t * 0.025 * (0.4 + 0.6 * f.k);
  // faint far stars
  ctx.fillStyle = "#fff";
  for (let i = 0; i < 140; i++) {
    ctx.globalAlpha = 0.15 + 0.35 * hash(i, 21) ** 3;
    ctx.fillRect(hash(i, 22) * W, hash(i, 23) * H, 1.2 * (H / 720), 1.2 * (H / 720));
  }
  ctx.save();
  ctx.translate(W / 2, H / 2);
  ctx.rotate(-0.35);
  ctx.scale(1, tilt);
  ctx.globalCompositeOperation = "lighter";
  // the disc's dust glow, then the core
  for (const [r, c, a] of [[R, 1 % n, 0.32], [R * 0.55, 2 % n, 0.3], [R * 0.2, 0, 0.9]] as const) {
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, r);
    g.addColorStop(0, r < R * 0.3 ? "rgba(255,244,226,1)" : pt.solid[c]);
    g.addColorStop(r < R * 0.3 ? 0.25 : 0, pt.solid[c]);
    g.addColorStop(1, pt.clear[c]);
    ctx.globalAlpha = a;
    ctx.fillStyle = g;
    ctx.fillRect(-r, -r, 2 * r, 2 * r);
  }
  // stars: two arms on a log spiral with scatter that grows outward, plus a round halo; one pass per color
  const sz = m / 1100, { d, starts } = galaxyStars(n);
  for (let c = -1; c < n; c++) {
    ctx.fillStyle = c < 0 ? "#fff6e8" : pt.solid[c];
    for (let j = starts[c + 1]; j < starts[c + 2]; j += 5) {
      const r = d[j], a = d[j + 1] + spin + 0.06 * Math.sin(f.t * 0.3 + d[j + 4]), s = d[j + 2] * sz;
      ctx.globalAlpha = d[j + 3];
      ctx.fillRect(Math.cos(a) * r * R - s / 2, Math.sin(a) * r * R - s / 2, s, s / tilt);
    }
  }
  ctx.restore();
  ctx.globalCompositeOperation = "source-over";
}
// Everything about a star that never changes (radius, arm angle, size, brightness, color), worked out once per
// palette size instead of every frame, sorted by color so each color is one run: [r, angle, size, alpha, phase] × n
const GAL = { n: -1, d: new Float32Array(0), starts: [] as number[] };
function galaxyStars(n: number) {
  if (GAL.n === n) return GAL;
  const rows: [number, number[]][] = [];
  for (let i = 0; i < GALAXY_STARS; i++) {
    const r = 0.03 + 0.97 * hash(i, 1) ** 1.1;
    const c = r < 0.14 || hash(i, 6) < 0.18 ? -1 : Math.floor(hash(i, 5) * n);
    const halo = hash(i, 2) < 0.2;
    const ang = halo ? hash(i, 3) * 6.283 : (i % 2) * Math.PI + Math.log(r) * 2.3 + (hash(i, 3) - 0.5) ** 3 * 4 * (0.4 + 0.8 * r); // cubed: most hug the arm
    rows.push([c, [r, ang, 1.8 + 3.6 * hash(i, 4) ** 5, (halo ? 0.45 : 0.75 + 0.25 * hash(i, 4)) * (1 - 0.35 * r), i]]);
  }
  rows.sort((a, b) => a[0] - b[0]);
  GAL.starts = Array.from({ length: n + 2 }, (_, k) => 5 * rows.findIndex(([c]) => c >= k - 1)).map((v) => (v < 0 ? rows.length * 5 : v));
  GAL.d = new Float32Array(rows.flatMap(([, v]) => v));
  GAL.n = n;
  return GAL;
}

// ridges: rows of a mountain range drawn as glowing lines (the "pulsar plot" look); peaks swell in the middle
// and roll slowly through the rows. Each row hides the ones behind it.
const RIDGE_ROWS = 34, RIDGE_STEPS = 96;
// the hump every row rises in, across the width: fixed, so worked out once
const RIDGE_Y = new Float32Array(RIDGE_STEPS + 1);
const RIDGE_ENV = Float32Array.from({ length: RIDGE_STEPS + 1 }, (_, s) => Math.exp(-(((s / RIDGE_STEPS - 0.5) / 0.16) ** 2)));
function drawRidges(ctx: CanvasRenderingContext2D, W: number, H: number, f: Frame, pt: Paint) {
  const n = pt.solid.length, top = H * 0.24, gap = (H * 0.96 - top) / RIDGE_ROWS, t = f.t * 0.5, amp = gap * (2.5 + 2.5 * Math.min(2, f.k));
  const glow = ctx.createRadialGradient(W / 2, H * 0.55, 0, W / 2, H * 0.55, Math.max(W, H) * 0.55);
  glow.addColorStop(0, pt.solid[0]);
  glow.addColorStop(1, pt.clear[0]);
  ctx.globalAlpha = 0.3;
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);
  ctx.lineJoin = "round";
  ctx.lineWidth = Math.max(1, H * 0.0018);
  for (let r = 0; r < RIDGE_ROWS; r++) {
    const y0 = top + r * gap;
    for (let s = 0; s <= RIDGE_STEPS; s++) {
      const x = s / RIDGE_STEPS, e = RIDGE_ENV[s];
      const h = e < 0.002 ? 0 : e * (0.5 + 0.5 * Math.sin(x * 17 + r * 0.9 - t * 1.1)) * (0.5 + 0.5 * Math.sin(x * 6.1 + r * 2.3 + t * 0.7)) + 0.05 * e * Math.sin(x * 47 + r * 3 + t * 2);
      RIDGE_Y[s] = y0 - h * amp - 0.04 * gap * Math.sin(x * 9 + r);
    }
    const line = () => {
      ctx.beginPath();
      ctx.moveTo(-2, RIDGE_Y[0]);
      for (let s = 1; s <= RIDGE_STEPS; s++) ctx.lineTo((s / RIDGE_STEPS) * W, RIDGE_Y[s]);
    };
    // Hides the rows behind. They never dip below their own base line, which is above this one's, so the cover
    // only reaches a little under this row (the first one alone goes to the bottom, over the glow): all filled
    // to the bottom of the window, 34 rows were 34 window-sized fills a frame (22 fps on a 4K display).
    const floor = r ? y0 + gap * 0.2 : H + 2;
    line();
    ctx.lineTo(W + 2, floor);
    ctx.lineTo(-2, floor);
    ctx.closePath();
    ctx.globalAlpha = 1;
    ctx.fillStyle = pt.base;
    ctx.fill();
    line();
    ctx.globalAlpha = 0.75 + 0.25 * (r / RIDGE_ROWS);
    ctx.strokeStyle = pt.solid[Math.floor((r / RIDGE_ROWS) * n) % n];
    ctx.stroke();
  }
}

// warp: flying through a starfield; streaks rush out from a glowing vanishing point, nearer ones longer and brighter
const WARP_STARS = 360;
function drawWarp(ctx: CanvasRenderingContext2D, W: number, H: number, f: Frame, pt: Paint) {
  const n = pt.solid.length, cx = W / 2, cy = H / 2, m = Math.max(W, H), sp = 0.12 * (0.35 + 0.65 * f.k);
  const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, m * 0.5);
  g.addColorStop(0, pt.solid[0]);
  g.addColorStop(1, pt.clear[0]);
  ctx.globalAlpha = 0.4;
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  ctx.globalCompositeOperation = "lighter";
  ctx.lineCap = "round";
  // grouped by color and by near / far, so each group is one path
  for (let c = 0; c < n; c++)
    for (const near of [false, true]) {
      ctx.strokeStyle = pt.solid[c];
      ctx.lineWidth = Math.max(1, (near ? 2.6 : 1.1) * (m / 1400));
      ctx.globalAlpha = near ? 0.95 : 0.55;
      ctx.beginPath();
      for (let i = c; i < WARP_STARS; i += n) {
        const z = 1 - ((f.t * sp * (0.7 + 0.6 * hash(i, 3)) + hash(i, 4)) % 1); // 1 far away → 0 passing you
        if (z < 0.35 !== near) continue;
        const a = hash(i, 1) * 6.283, d = (0.06 + 0.5 * hash(i, 2)) * m * 0.22;
        const p1 = d / (z + 0.04), p2 = d / (z + 0.04 + 0.05 + 0.1 * (1 - z));
        if (p2 > m) continue;
        const ca = Math.cos(a), sa = Math.sin(a);
        ctx.moveTo(cx + ca * p2, cy + sa * p2);
        ctx.lineTo(cx + ca * Math.min(p1, m), cy + sa * Math.min(p1, m));
      }
      ctx.stroke();
    }
  ctx.globalCompositeOperation = "source-over";
}

// flock: a murmuration of starlings at dusk. Hundreds of birds move as one shape that stretches, folds and drifts;
// waves of turning ripple through it (the darker bands real flocks show), a smaller flock splits off and rejoins,
// and a few lone birds flap past close by. Hills below, the sky in album colors.
const FLOCK = 1600;
// each bird's fixed spot in the flock's disc, denser toward the middle (worked out once, not every frame)
const FLOCK_UV = Float32Array.from({ length: FLOCK * 2 }, (_, k) => {
  const i = k >> 1, a = hash(i, 1) * 6.283, rr = hash(i, 2) ** 0.7;
  return k & 1 ? Math.sin(a) * rr : Math.cos(a) * rr;
});
function drawFlock(ctx: CanvasRenderingContext2D, W: number, H: number, f: Frame) {
  const c = f.colors, n = c.length, t = f.t * (0.35 + 0.65 * f.k), u0 = H / 720;
  const top = mixOklab(c[1 % n], [10, 12, 28], 0.45), low = mixOklab(c[0], [255, 214, 170], 0.55);
  const sky = ctx.createLinearGradient(0, 0, 0, H * 0.82);
  sky.addColorStop(0, css(top));
  sky.addColorStop(0.55, css(mixOklab(top, low, 0.5)));
  sky.addColorStop(1, css(low));
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, W, H);
  const sun = ctx.createRadialGradient(W * 0.28, H * 0.8, 0, W * 0.28, H * 0.8, H * 0.7);
  sun.addColorStop(0, css(mixOklab(low, [255, 245, 225], 0.5), 0.7));
  sun.addColorStop(1, css(low, 0));
  ctx.fillStyle = sun;
  ctx.fillRect(0, 0, W, H);
  // two ridges of hills, the far one hazier
  for (let k = 0; k < 2; k++) {
    ctx.fillStyle = css(k ? mixOklab(mixOklab(top, low, 0.45), [0, 0, 0], 0.55) : mixOklab(top, [0, 0, 0], 0.4));
    ctx.beginPath();
    ctx.moveTo(0, H);
    for (let x = 0; x <= W + 24; x += 24) {
      const v = x / W;
      ctx.lineTo(x, H * (k ? 0.78 : 0.86) - H * (k ? 0.07 : 0.05) * (Math.sin(v * (k ? 5.3 : 3.1) + k * 2) * 0.6 + Math.sin(v * (k ? 13 : 9.7) + 1) * 0.25 + 0.6));
    }
    ctx.lineTo(W, H);
    ctx.fill();
  }
  // the flock: each bird keeps a spot in a disc that the whole shape bends, stretches and turns
  const bird = css(mixOklab(top, [0, 0, 0], 0.4));
  ctx.fillStyle = bird;
  const cx = W * (0.55 + 0.16 * Math.sin(t * 0.05) + 0.05 * Math.sin(t * 0.13)), cy = H * (0.47 + 0.07 * Math.sin(t * 0.07 + 1)); // low, against the glow, where it shows best
  const split = Math.max(0, Math.sin(t * 0.045)); // how far the small flock has wandered off (0 = merged)
  for (let i = 0; i < FLOCK; i++) {
    const small = i < FLOCK * 0.22;
    const u = FLOCK_UV[i * 2], v = FLOCK_UV[i * 2 + 1];
    const fold = small ? 1.6 : 1;
    let x = u * (1 + 0.28 * Math.sin(t * 0.3 + v * 2)) + 0.07 * Math.sin(u * 7 - t * 1.4); // the wave of turning
    // bend into a banana, then an S, as the flock wheels
    let y = v + 0.9 * u * u * Math.sin(t * 0.17 * fold) + 0.4 * Math.sin(u * 2.2 + t * 0.23) + 0.2 * Math.sin(u * 4 + t * 0.5);
    x += 0.025 * Math.sin(t * 2.6 + i);
    y += 0.03 * Math.cos(t * 2.2 + i * 1.3);
    const rot = 0.5 * Math.sin(t * 0.04 + (small ? 1.5 : 0));
    const sx = W * (small ? 0.12 : 0.27 + 0.08 * Math.sin(t * 0.11)), sy = H * (small ? 0.08 : 0.13 + 0.05 * Math.sin(t * 0.09 + 2));
    const ox = small ? split * W * (0.22 * Math.cos(t * 0.06) - 0.1) : 0, oy = small ? split * H * 0.12 * Math.sin(t * 0.08) : 0;
    const px = cx + ox + (x * Math.cos(rot) - y * Math.sin(rot) * 0.6) * sx, py = cy + oy + (x * Math.sin(rot) + y * Math.cos(rot)) * sy;
    // birds turning edge-on in the wave look smaller: that's what draws the dark bands
    const s = (1.8 + 2 * (0.5 + 0.5 * Math.cos(u * 7 - t * 1.4))) * u0;
    ctx.fillRect(px, py, s, s * 0.7);
  }
  // a few lone birds close by, flapping across
  ctx.strokeStyle = bird;
  ctx.lineWidth = Math.max(1, 1.6 * u0);
  ctx.lineJoin = "round";
  ctx.beginPath();
  for (let i = 0; i < 4; i++) {
    const sp = 0.012 + 0.01 * hash(i, 31), p = (t * sp + hash(i, 32)) % 1;
    const x = -W * 0.1 + p * W * 1.2, y = H * (0.15 + 0.4 * hash(i, 33)) + Math.sin(p * 9 + i) * H * 0.02;
    const w = (7 + 5 * hash(i, 34)) * u0, flap = Math.sin(t * (7 + i) + i) * w * 0.55;
    ctx.moveTo(x - w, y - flap);
    ctx.quadraticCurveTo(x - w * 0.4, y - flap * 0.3 - w * 0.15, x, y);
    ctx.quadraticCurveTo(x + w * 0.4, y - flap * 0.3 - w * 0.15, x + w, y - flap);
  }
  ctx.stroke();
}

// kaleidoscope: glows and crystal shards drift through one slice, mirrored into twelve; the whole turns slowly
const KAL_SLICES = 12, KAL_SHAPES = 9;
function drawKaleido(ctx: CanvasRenderingContext2D, W: number, H: number, f: Frame, pt: Paint) {
  const n = pt.solid.length, m = Math.hypot(W, H) / 2, t = f.t * (0.3 + 0.7 * f.k), A = (Math.PI * 2) / KAL_SLICES;
  ctx.save();
  ctx.translate(W / 2, H / 2);
  ctx.rotate(t * 0.025);
  // the slice's contents, in the slice's own frame: built once, stamped twelve times
  const shapes = [];
  for (let j = 0; j < KAL_SHAPES; j++) {
    const p = (hash(j, 1) + t * 0.018 * (0.5 + hash(j, 2))) % 1; // drifts outward, then starts again in the middle
    const r = m * (0.04 + 0.95 * p), a = A * (0.5 + 0.42 * Math.sin(t * 0.2 + j * 1.7));
    const x = Math.cos(a) * r, y = Math.sin(a) * r, s = m * (0.05 + 0.11 * hash(j, 3)) * (0.5 + p);
    const fade = Math.min(1, p * 6, (1 - p) * 4);
    const glow = j % 3 !== 2;
    let g: CanvasGradient | null = null;
    if (glow) {
      g = ctx.createRadialGradient(x, y, 0, x, y, s);
      g.addColorStop(0, pt.solid[j % n]);
      g.addColorStop(1, pt.clear[j % n]);
    }
    shapes.push({ x, y, s, fade, g, c: pt.solid[j % n], spin: t * (0.4 + hash(j, 4)) + j });
  }
  ctx.globalCompositeOperation = "lighter";
  for (let k = 0; k < KAL_SLICES; k++) {
    ctx.save();
    ctx.rotate(k * A);
    if (k % 2) {
      ctx.rotate(A);
      ctx.scale(1, -1); // every other slice is the mirror image, so edges meet seamlessly
    }
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.arc(0, 0, m, 0, A + 0.002);
    ctx.closePath();
    ctx.clip();
    for (const sh of shapes) {
      ctx.globalAlpha = sh.fade * (sh.g ? 0.62 : 0.55);
      if (sh.g) {
        ctx.fillStyle = sh.g;
        ctx.fillRect(sh.x - sh.s, sh.y - sh.s, sh.s * 2, sh.s * 2);
      } else {
        // a crystal shard: a long thin diamond, turning
        const c = Math.cos(sh.spin), s = Math.sin(sh.spin), L = sh.s * 1.3, w = sh.s * 0.28;
        ctx.fillStyle = sh.c;
        ctx.beginPath();
        ctx.moveTo(sh.x + c * L, sh.y + s * L);
        ctx.lineTo(sh.x - s * w, sh.y + c * w);
        ctx.lineTo(sh.x - c * L, sh.y - s * L);
        ctx.lineTo(sh.x + s * w, sh.y - c * w);
        ctx.fill();
      }
    }
    ctx.restore();
  }
  ctx.restore();
  // a soft bloom in the middle where every slice meets
  const b = ctx.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, m * 0.25);
  b.addColorStop(0, "rgba(255,255,255,.35)");
  b.addColorStop(1, "rgba(255,255,255,0)");
  ctx.globalAlpha = 1;
  ctx.fillStyle = b;
  ctx.fillRect(W / 2 - m * 0.25, H / 2 - m * 0.25, m * 0.5, m * 0.5);
  ctx.globalCompositeOperation = "source-over";
}

// rainy window: a street at night far out of focus behind wet glass. What makes it read as real: the street is only
// soft light, while every drop on the pane is a little lens showing a sharper, upside-down view of the lights behind
// it. Drops form, sit, and now and then one gives way and runs down in fits and starts, leaving droplets behind.
const RAIN_DROPS = 110, RAIN_MIST = 320, RAIN_RUNS = 7, RAIN_S = 6;
let rainBg: OffscreenCanvas | null = null;
const rainLights = new Float32Array(RAIN_LIGHTS * 4), rainCols = new Float32Array(RAIN_LIGHTS * 3);
/** The rainy window drawn by the GPU on a canvas of its own (dimming and vignette included); false where WebGL2
 *  is missing, and the 2D version below is drawn instead. Same lights and colours in both. */
export function drawRainGL(canvas: HTMLCanvasElement, scene: Scene, f: Frame): boolean {
  const { W, H } = scene, pt = paint(scene, f);
  const n = pt.solid.length, m = Math.min(W, H), t = f.t * (0.4 + 0.6 * f.k);
  const rgb = (s: string) => s.slice(5, -3).split(",").map((v) => Number(v) / 255);
  for (let i = 0; i < RAIN_LIGHTS; i++) {
    const kind = hash(i, 7), car = i % 4 === 0;
    rainLights.set([car ? ((((hash(i, 1) + t * 0.008 * (hash(i, 6) - 0.5)) % 1) + 1) % 1) * W : hash(i, 1) * W, H * (0.08 + 0.88 * hash(i, 2) ** 0.75), m * (0.05 + 0.1 * hash(i, 3)), (0.55 + 0.45 * hash(i, 4)) * (0.85 + 0.15 * Math.sin(t * (0.2 + hash(i, 5)) + i))], i * 4);
    rainCols.set(kind < 0.3 ? [1, 0.73, 0.43] : kind < 0.42 ? [1, 0.24, 0.19] : kind < 0.5 ? [0.92, 0.94, 1] : rgb(pt.solid[i % n]), i * 3);
  }
  return rainGL(canvas, W, H, t, rgb(pt.base), rgb(pt.solid[0]), rgb(pt.solid[1 % n]), rainLights, rainCols, f.dim, f.vignette ?? 0.35);
}
function drawRainglass(ctx: CanvasRenderingContext2D, W: number, H: number, f: Frame, pt: Paint) {
  const n = pt.solid.length, m = Math.min(W, H), t = f.t * (0.4 + 0.6 * f.k), u0 = m / 700;
  const base = ctx.getTransform();
  // the street, drawn at 1/6 size and stretched: the stretch is the blur, for free. Lights sit low where the
  // street is; a few (cars) drift sideways. Warm lamps, red tail lights and the album's colors.
  const bw = Math.ceil(W / RAIN_S), bh = Math.ceil(H / RAIN_S);
  let g = ctx;
  if (typeof OffscreenCanvas !== "undefined") {
    if (!rainBg || rainBg.width !== bw || rainBg.height !== bh) rainBg = new OffscreenCanvas(bw, bh);
    // SAFETY: rainBg is a fresh 2D canvas; g uses only APIs shared by DOM and offscreen 2D contexts.
    g = rainBg.getContext("2d") as unknown as CanvasRenderingContext2D;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, bw, bh);
    g.setTransform(1 / RAIN_S, 0, 0, 1 / RAIN_S, 0, 0);
  }
  g.globalCompositeOperation = "lighter";
  g.globalAlpha = 1;
  const street = g.createLinearGradient(0, H * 0.2, 0, H);
  street.addColorStop(0, pt.clear[0]);
  street.addColorStop(0.6, pt.solid[1 % n]);
  street.addColorStop(1, pt.solid[0]);
  g.globalAlpha = 0.3;
  g.fillStyle = street;
  g.fillRect(0, H * 0.2, W, H * 0.8);
  for (let i = 0; i < RAIN_LIGHTS; i++) {
    const kind = hash(i, 7), car = i % 4 === 0;
    const rgb = kind < 0.3 ? "255,186,110" : kind < 0.42 ? "255,60,48" : kind < 0.5 ? "235,240,255" : pt.solid[i % n].slice(5, -3);
    const x = car ? ((((hash(i, 1) + t * 0.008 * (hash(i, 6) - 0.5)) % 1) + 1) % 1) * W : hash(i, 1) * W;
    const y = H * (0.08 + 0.88 * hash(i, 2) ** 0.75), r = m * (0.05 + 0.1 * hash(i, 3));
    const gr = g.createRadialGradient(x, y, 0, x, y, r);
    const a = (0.55 + 0.45 * hash(i, 4)) * (0.85 + 0.15 * Math.sin(t * (0.2 + hash(i, 5)) + i));
    gr.addColorStop(0, `rgba(${rgb},${a})`);
    gr.addColorStop(0.4, `rgba(${rgb},${a * 0.4})`);
    gr.addColorStop(1, `rgba(${rgb},0)`);
    g.globalAlpha = 1;
    g.fillStyle = gr;
    g.fillRect(x - r, y - r, r * 2, r * 2);
  }
  g.globalCompositeOperation = "source-over";
  const bg = g === ctx ? null : rainBg;
  ctx.globalAlpha = 1;
  if (bg) {
    ctx.globalCompositeOperation = "lighter";
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(bg, 0, 0, bw, bh, 0, 0, bw * RAIN_S, bh * RAIN_S);
    ctx.globalCompositeOperation = "source-over";
  }
  // the glass: night-cool and a touch darker, so the drops' bright little views stand out
  ctx.fillStyle = "rgba(8,12,22,.22)";
  ctx.fillRect(0, 0, W, H);

  // a lens: inside the drop, a wider patch of the street, upside down and brighter (the drop gathers light);
  // then a dark edge and a glint
  const lens = (x: number, y: number, r: number, ry: number, a: number) => {
    if (r < 1) return;
    ctx.globalAlpha = a;
    ctx.save();
    ctx.beginPath();
    ctx.ellipse(x, y, r, ry, 0, 0, Math.PI * 2);
    ctx.clip();
    ctx.fillStyle = "rgba(10,14,24,.35)";
    ctx.fillRect(x - r, y - ry, r * 2, ry * 2);
    if (bg) {
      const view = r * 7; // how much of the street the drop gathers
      ctx.globalCompositeOperation = "lighter";
      ctx.setTransform(base.a, 0, 0, -base.d, base.e, base.f + 2 * y * base.d); // flip about the drop's middle
      for (let k = 0; k < 2; k++) ctx.drawImage(bg, (x - view) / RAIN_S, (y - view) / RAIN_S, (view * 2) / RAIN_S, (view * 2) / RAIN_S, x - r, y - ry, r * 2, ry * 2);
      ctx.globalCompositeOperation = "source-over";
    }
    ctx.restore();
    ctx.globalAlpha = a;
    // the rim: water bends light away at its edge, so it rings dark, heaviest on top
    ctx.lineWidth = Math.max(0.6, r * 0.14);
    ctx.strokeStyle = "rgba(0,0,0,.3)";
    ctx.beginPath();
    ctx.ellipse(x, y, r * 0.95, ry * 0.95, 0, Math.PI * 1.05, Math.PI * 1.95);
    ctx.stroke();
    ctx.strokeStyle = "rgba(255,255,255,.2)";
    ctx.beginPath();
    ctx.ellipse(x, y, r * 0.92, ry * 0.92, 0, Math.PI * 0.15, Math.PI * 0.85);
    ctx.stroke();
    // a glint low inside (light from behind, flipped), and a tiny one up top from the room
    ctx.fillStyle = "rgba(255,255,255,.55)";
    ctx.beginPath();
    ctx.ellipse(x + r * 0.15, y + ry * 0.45, r * 0.28, ry * 0.12, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,.35)";
    ctx.beginPath();
    ctx.arc(x - r * 0.35, y - ry * 0.4, Math.max(0.5, r * 0.09), 0, Math.PI * 2);
    ctx.fill();
  };

  // mist: a fine spray of tiny droplets, too small to show anything but a speck of light
  ctx.globalAlpha = 1;
  ctx.fillStyle = "rgba(255,255,255,.10)";
  ctx.beginPath();
  for (let k = 0; k < RAIN_MIST; k++) {
    const x = hash(k, 51) * W, y = hash(k, 52) * H, r = (0.6 + 1.6 * hash(k, 53)) * u0;
    ctx.moveTo(x + r, y);
    ctx.arc(x, y, r, 0, Math.PI * 2);
  }
  ctx.fill();
  // drops: each lives a while in one spot, growing in, then gives its place to a new one somewhere else
  for (let k = 0; k < RAIN_DROPS; k++) {
    const life = (t * 0.02 * (0.5 + hash(k, 14)) + hash(k, 15)) % 1, gen = Math.floor(t * 0.02 * (0.5 + hash(k, 14)) + hash(k, 15));
    const s = k * 131 + gen * 977;
    const r = (2.5 + 11 * hash(s, 13) ** 2.4) * u0 * Math.min(1, life * 12);
    const fade = Math.min(1, (1 - life) * 10);
    lens(hash(s, 11) * W, hash(s, 12) * H, r, r * (1 + 0.15 * hash(s, 16)), fade);
  }
  // runners: they catch and slip (speed that comes and goes), wobble, and leave a line of droplets behind
  for (let i = 0; i < RAIN_RUNS; i++) {
    const p = t * 0.035 * (0.6 + hash(i, 21)) + hash(i, 22), s = p % 1, lane = Math.floor(p);
    const slip = s + 0.03 * Math.sin(s * 40 + i); // stop-and-go
    const y = -0.05 * H + 1.1 * H * slip, x0 = hash(i * 31 + lane, 23) * W;
    const wob = (v: number) => x0 + Math.sin(v * 22 + i) * 4 * u0;
    const r = (6 + 4 * hash(i * 31 + lane, 24)) * u0;
    const len = H * (0.1 + 0.25 * hash(i, 25));
    ctx.globalAlpha = 1;
    ctx.fillStyle = "rgba(255,255,255,.16)";
    ctx.beginPath();
    // fixed spots on the glass (a grid in y), so what's left behind stays put while the drop moves on
    const step = 7 * u0;
    for (let j = Math.ceil((y - len) / step); j * step < y - r * 1.8; j++) {
      const yy = j * step, q = 1 - (y - yy) / len, rr = (0.8 + 2.2 * hash(i * 977 + lane * 31 + j, 26)) * u0 * q;
      if (rr < 0.4) continue;
      const xx = wob((yy + 0.05 * H) / (1.1 * H));
      ctx.moveTo(xx + rr, yy);
      ctx.arc(xx, yy, rr, 0, Math.PI * 2);
    }
    ctx.fill();
    lens(wob(slip), y, r, r * 1.3, 1);
  }
  ctx.globalAlpha = 1;
  ctx.setTransform(base);
}

// papercut: a landscape cut from layers of paper. Hills slide past at their own depth (far slow, near fast), each
// layer lifting off the one behind on a soft shadow; a paper sun and two clouds hang in the sky.
function drawPapercut(ctx: CanvasRenderingContext2D, W: number, H: number, f: Frame) {
  const c = f.colors, n = c.length, t = f.t * (0.35 + 0.65 * f.k), u0 = H / 720;
  const sky = mixOklab(c[0], [250, 244, 232], 0.35);
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, css(mixOklab(sky, c[1 % n], 0.75)));
  g.addColorStop(1, css(sky));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  // a soft shadow: the same shape stamped a few times just above, faintly (no blur filter: cheap and crisp enough)
  const shadowed = (path: Path2D, fill: string) => {
    ctx.fillStyle = "rgba(0,0,0,.07)";
    for (const dy of [7, 4, 2]) {
      ctx.save();
      ctx.translate(0, -dy * u0);
      ctx.fill(path);
      ctx.restore();
    }
    ctx.fillStyle = fill;
    ctx.fill(path);
  };
  // sun and clouds
  const sun = new Path2D();
  sun.arc(W * 0.72, H * 0.26, H * 0.09, 0, Math.PI * 2);
  shadowed(sun, css(mixOklab(c[2 % n], [255, 240, 205], 0.45)));
  for (let k = 0; k < 2; k++) {
    const x = ((W * (0.15 + 0.5 * k) + t * W * 0.006 * (1 + k)) % (W * 1.4)) - W * 0.2, y = H * (0.18 + 0.12 * k), r = H * (0.045 - 0.008 * k);
    const cl = new Path2D();
    for (const [dx, dy, rr] of [[0, 0, 1], [1.1, -0.35, 1.25], [2.2, 0, 0.95], [1.1, 0.25, 1]]) {
      cl.moveTo(x + dx * r + rr * r, y + dy * r);
      cl.arc(x + dx * r, y + dy * r, rr * r, 0, Math.PI * 2);
    }
    shadowed(cl, "rgba(255,255,255,.92)");
  }
  // hills: five layers, far to near, from pale and hazy to deep
  const L = 5, step = W / 48;
  for (let k = 0; k < L; k++) {
    const q = k / (L - 1), base = H * (0.42 + 0.13 * k), amp = H * (0.07 + 0.02 * k), drift = t * (0.004 + 0.016 * q) * W;
    const p = new Path2D();
    p.moveTo(-step, H + 2);
    for (let x = -step; x <= W + step; x += step) {
      const v = (x + drift) / W;
      p.lineTo(x, base - amp * (Math.sin(v * (2.1 + k * 0.6) + k * 1.7) * 0.7 + Math.sin(v * (5.3 + k) + k) * 0.3));
    }
    p.lineTo(W + step, H + 2);
    p.closePath();
    const hill = mixOklab(c[(k + 1) % n], [10, 10, 16], 0.85 - 0.45 * q);
    shadowed(p, css(mixOklab(hill, sky, 0.35 + 0.65 * q)));
  }
}

// constellation: stars drift on slow paths and link up with fine lines when they come near each other, the lines
// brightening as they close in (a living star chart)
const PLEX = 72;
function drawPlexus(ctx: CanvasRenderingContext2D, W: number, H: number, f: Frame, pt: Paint) {
  const n = pt.solid.length, t = f.t * (0.3 + 0.7 * f.k) * 0.06, m = Math.max(W, H), D = m * 0.16, u0 = H / 720;
  const glow = ctx.createRadialGradient(W * 0.5, H * 0.45, 0, W * 0.5, H * 0.45, m * 0.6);
  glow.addColorStop(0, pt.solid[1 % n]);
  glow.addColorStop(1, pt.clear[1 % n]);
  ctx.globalAlpha = 0.3;
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);
  const xs = PLEX_XY;
  for (let i = 0; i < PLEX; i++) {
    // each star on its own slow Lissajous loop around a home spot, so the chart keeps rearranging
    xs[i * 2] = W * (hash(i, 41) + 0.12 * Math.sin(t * (0.7 + hash(i, 43)) + i));
    xs[i * 2 + 1] = H * (hash(i, 42) + 0.12 * Math.cos(t * (0.6 + hash(i, 44)) + i * 1.7));
  }
  ctx.lineWidth = Math.max(1, 1.1 * u0);
  ctx.globalCompositeOperation = "lighter";
  for (let i = 0; i < PLEX; i++) {
    ctx.strokeStyle = pt.solid[i % n];
    for (let j = i + 1; j < PLEX; j++) {
      const dx = xs[j * 2] - xs[i * 2], dy = xs[j * 2 + 1] - xs[i * 2 + 1], d2 = dx * dx + dy * dy;
      if (d2 > D * D) continue;
      ctx.globalAlpha = 0.55 * (1 - Math.sqrt(d2) / D);
      ctx.beginPath();
      ctx.moveTo(xs[i * 2], xs[i * 2 + 1]);
      ctx.lineTo(xs[j * 2], xs[j * 2 + 1]);
      ctx.stroke();
    }
  }
  for (let i = 0; i < PLEX; i++) {
    const r = (1.6 + 2.4 * hash(i, 45) ** 3) * u0 * (0.8 + 0.2 * Math.sin(f.t * 1.3 + i));
    ctx.globalAlpha = 0.9;
    ctx.fillStyle = "#fff";
    ctx.beginPath();
    ctx.arc(xs[i * 2], xs[i * 2 + 1], r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalCompositeOperation = "source-over";
}
const PLEX_XY = new Float32Array(PLEX * 2);
