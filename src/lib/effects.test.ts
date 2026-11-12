/// <reference types="bun" />
import { expect, test } from "bun:test";
import { FX, step, spawnCount, type Fx, type P } from "./effects";

const env = { W: 1000, H: 800, amount: 1, size: 1, colors: 3 };
let seed = 1;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const sane = (ps: P[]) => ps.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y) && p.a >= 0 && p.a <= 1.5);

test("ambient effects fill up to their count, stay bounded and sane", () => {
  for (const fx of ["bubbles", "fireflies", "snow", "stars", "petals", "rain", "embers", "confetti", "notes", "butterflies", "lanterns", "sparkles", "meteors", "orbs", "balloons", "planes", "leaves", "seeds"] as Fx[]) {
    let ps: P[] = [];
    for (let i = 0; i < 900; i++) ps = step(fx, ps, 1 / 30, i / 30, env, rnd);
    const main = ps.filter((p) => (fx === "rain" || fx === "meteors" || p.kind !== "trail") && !(fx === "bubbles" && p.kind === "dot"));
    expect(main.length).toBeGreaterThan(spawnCount(fx, 1) * 0.6);
    expect(main.length).toBeLessThanOrEqual(spawnCount(fx, 1));
    expect(sane(ps)).toBe(true);
  }
});

test("bubbles pop into droplets that fade away", () => {
  let ps: P[] = [];
  let droplets = 0;
  for (let i = 0; i < 30 * 40; i++) (ps = step("bubbles", ps, 1 / 30, i / 30, env, rnd)), (droplets = Math.max(droplets, ps.filter((p) => p.kind === "dot").length));
  expect(droplets).toBeGreaterThan(0);
});

test("fireworks launch, burst into sparks, and burn out", () => {
  let ps: P[] = [];
  let peak = 0;
  for (let i = 0; i < 30 * 20; i++) (ps = step("fireworks", ps, 1 / 30, i / 30, { ...env, amount: 2 }, rnd)), (peak = Math.max(peak, ps.length));
  expect(peak).toBeGreaterThan(40); // at least one burst happened
  expect(peak).toBeLessThanOrEqual(1600 + 50);
  expect(sane(ps)).toBe(true);
  let after = ps;
  for (let i = 0; i < 30 * 10; i++) after = step("fireworks", after, 1 / 30, 0, { ...env, amount: 0 }, rnd);
  expect(after.length).toBe(0);
});

test("butterflies stay on screen and lanterns keep rising instead of piling up", () => {
  let flies: P[] = [], lanterns: P[] = [];
  for (let i = 0; i < 30 * 120; i++) {
    flies = step("butterflies", flies, 1 / 30, i / 30, env, rnd);
    lanterns = step("lanterns", lanterns, 1 / 30, i / 30, env, rnd);
  }
  const inside = flies.filter((p) => p.x > -env.W * 0.1 && p.x < env.W * 1.1 && p.y > -env.H * 0.1 && p.y < env.H * 1.1);
  expect(inside.length).toBe(flies.length);
  const visible = lanterns.filter((p) => p.y > 0 && p.y < env.H);
  expect(visible.length).toBeGreaterThan(lanterns.length * 0.4);
  expect(sane(lanterns)).toBe(true);
});

test("reused particle buffers preserve every effect's state and random sequence", () => {
  const random = () => {
    let s = 17;
    return () => ((s = (s * 16807) % 2147483647) / 2147483647);
  };
  for (const fx of FX) {
    const allocatingRandom = random(), bufferedRandom = random();
    let expected: P[] = [], actual: P[] = [], spare: P[] = [];
    const arrays = new Set([actual, spare]);
    for (let i = 0; i < 600; i++) {
      const e = { ...env, amount: i < 450 ? 1.5 : 0 };
      expected = step(fx, expected, 1 / 30, i / 30, e, allocatingRandom);
      const prior = actual;
      actual = step(fx, prior, 1 / 30, i / 30, { ...e, output: spare }, bufferedRandom);
      prior.length = 0;
      spare = prior;
      expect(arrays.has(actual)).toBe(true);
      if (i % 30 === 0 || i === 599) expect(actual).toEqual(expected);
    }
    expect(bufferedRandom()).toBe(allocatingRandom());
  }
});

test("particle output is cleared before reuse and cannot alias its input", () => {
  const stale = [{ life: 999 } as P];
  const result = step("fireworks", [], 0, 0, { ...env, output: stale }, () => 1);
  expect(result).toBe(stale);
  expect(result).toEqual([]);
  expect(() => step("snow", stale, 0, 0, { ...env, output: stale }, () => 1)).toThrow("alias");
});

test("snow falls evenly instead of in clumps or rows", () => {
  seed = 1; // its own sequence: adding effects to the tests above mustn't change this one
  let ps: P[] = [];
  for (let i = 0; i < 30 * 120; i++) ps = step("snow", ps, 1 / 30, i / 30, env, rnd); // two minutes: well past the first fall
  const bins = Array(8).fill(0);
  for (const p of ps) if (p.y >= 0 && p.y < env.H) bins[Math.floor((p.y / env.H) * 8)]++;
  const mean = bins.reduce((a, b) => a + b) / 8;
  expect(Math.max(...bins)).toBeLessThan(mean * 2);
  expect(Math.min(...bins)).toBeGreaterThan(mean * 0.35);
});