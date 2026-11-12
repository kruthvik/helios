export type Palette = { colors: [string, string, string, string]; accent: string };

export const FALLBACK: Palette = { colors: ["#1f2a44", "#3b1f4a", "#123a3a", "#2a2a2a"], accent: "#1db954" };

type Rgb = [number, number, number];
const SIZE = 28;
const cache = new Map<string, Promise<Palette>>();

const sat = ([r, g, b]: Rgb) => (Math.max(r, g, b) - Math.min(r, g, b)) / 255;
const lum = ([r, g, b]: Rgb) => (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
const dist = (a: Rgb, b: Rgb) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const hex = (c: Rgb) => "#" + c.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, "0")).join("");
const mix = (c: Rgb, to: number, amt: number): Rgb => c.map((v) => v + (to - v) * amt) as Rgb;

async function extract(url: string): Promise<Palette> {
  const img = new Image();
  img.crossOrigin = "anonymous"; // i.scdn.co sends Access-Control-Allow-Origin: *
  img.src = url;
  await img.decode();
  const canvas = new OffscreenCanvas(SIZE, SIZE);
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(img, 0, 0, SIZE, SIZE);
  const px = ctx.getImageData(0, 0, SIZE, SIZE).data;

  // Bucket into a 8x8x8 color cube, then rank buckets by size, favouring saturated colors.
  const buckets = new Map<number, { sum: Rgb; n: number }>();
  for (let i = 0; i < px.length; i += 4) {
    const key = ((px[i] >> 5) << 6) | ((px[i + 1] >> 5) << 3) | (px[i + 2] >> 5);
    const b = buckets.get(key) ?? { sum: [0, 0, 0] as Rgb, n: 0 };
    b.sum[0] += px[i], b.sum[1] += px[i + 1], b.sum[2] += px[i + 2], b.n++;
    buckets.set(key, b);
  }
  const ranked = [...buckets.values()]
    .map(({ sum, n }) => ({ c: sum.map((v) => v / n) as Rgb, n }))
    .map((x) => ({ ...x, score: x.n * (0.35 + sat(x.c)) * (lum(x.c) < 0.06 ? 0.2 : 1) }))
    .sort((a, b) => b.score - a.score);

  const picks: Rgb[] = [];
  for (const { c } of ranked) {
    if (picks.every((p) => dist(p, c) > 55)) picks.push(c);
    if (picks.length === 4) break;
  }
  while (picks.length < 4) picks.push(mix(picks[picks.length - 1] ?? [30, 30, 40], 0, 0.35));

  // Accent: the most saturated pick, lifted until it reads on a dark background.
  let accent = [...picks].sort((a, b) => sat(b) - sat(a))[0];
  while (lum(accent) < 0.55) accent = mix(accent, 255, 0.15);

  return { colors: picks.map(hex) as Palette["colors"], accent: hex(accent) };
}

export function palette(url: string): Promise<Palette> {
  let hit = cache.get(url);
  if (!hit) {
    hit = extract(url).catch(() => FALLBACK);
    cache.set(url, hit);
    if (cache.size > 60) cache.delete(cache.keys().next().value!); // keep memory flat in long sessions
  }
  return hit;
}
