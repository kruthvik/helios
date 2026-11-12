/// <reference types="bun" />
import { expect, test } from "bun:test";
import { bezier, mixOklab, progress, sample, saturate, vivid, drawBackdrop, type Frame, type Scene } from "./backdrop";

const near = (a: number[], b: number[], eps = 0.6) => a.forEach((v, i) => expect(Math.abs(v - b[i])).toBeLessThan(eps));

test("cubic-bezier matches CSS ease-in-out", () => {
  const e = bezier(0.42, 0, 0.58, 1);
  expect(e(0)).toBe(0);
  expect(e(1)).toBe(1);
  expect(e(0.5)).toBeCloseTo(0.5, 5);
  expect(e(0.25)).toBeCloseTo(0.1291, 3); // value Chrome reports for ease-in-out at 25%
});

test("alternate and alternate-reverse directions", () => {
  expect(progress(2.5, 10, false)).toBeCloseTo(0.25);
  expect(progress(12.5, 10, false)).toBeCloseTo(0.75); // second cycle runs backwards
  expect(progress(2.5, 10, true)).toBeCloseTo(0.75);
});

test("keyframes hit their stops exactly", () => {
  const kf: [number, number[]][] = [
    [0, [0, 1]],
    [0.5, [10, 2]],
    [1, [0, 0]],
  ];
  expect(sample(kf, 0)).toEqual([0, 1]);
  expect(sample(kf, 0.5)).toEqual([10, 2]);
  expect(sample(kf, 0.25)).toEqual([5, 1.5]); // ease-in-out midpoint of the first segment
});

test("oklab mix and saturate behave like CSS", () => {
  near(mixOklab([200, 40, 90], [5, 5, 6], 1), [200, 40, 90]);
  near(mixOklab([200, 40, 90], [5, 5, 6], 0), [5, 5, 6]);
  near(mixOklab([255, 0, 0], [0, 0, 255], 0.5), [140, 83, 162], 2); // color-mix(in oklab, red, blue)
  near(saturate([120, 60, 30], 1), [120, 60, 30]);
  near(saturate([90, 90, 90], 1.6), [90, 90, 90]);
});

test("every scene draws without throwing or feeding NaN to the canvas", () => {
  const bad: string[] = [];
  const grad = { addColorStop: (o: number) => void (Number.isFinite(o) || bad.push("stop")) };
  const ctx = new Proxy({} as Record<string, unknown>, {
    get: (t, k: string) =>
      k in t ? t[k] : (...a: unknown[]) => (a.some((v) => typeof v === "number" && !Number.isFinite(v)) && bad.push(k), grad),
    set: (t, k: string, v) => ((t[k] = v), true),
  }) as unknown as CanvasRenderingContext2D;
  // Path2D (papercut) is a browser object: a stand-in that checks its numbers the same way
  (globalThis as Record<string, unknown>).Path2D ??= class {
    constructor() {
      return new Proxy({}, { get: () => (...a: unknown[]) => void (a.some((v) => typeof v === "number" && !Number.isFinite(v)) && bad.push("path")) });
    }
  };
  const canvas = { width: 160, height: 90 } as HTMLCanvasElement;
  const scene: Scene = { W: 640, H: 360, blurred: null, blurKey: "" };
  const colors: [number, number, number][] = [[200, 80, 60], [40, 90, 200], [240, 200, 90]];
  for (const mode of ["mesh", "aurora", "lava", "silk", "prism", "ripples", "sunset", "bokeh", "retro", "vortex", "mosaic", "jellyfish", "ocean", "dunes", "orbits", "topo", "koi", "skyline", "galaxy", "ridges", "warp", "flock", "kaleido", "rainglass", "papercut", "plexus", "solid", "fill"] as Frame["mode"][])
    for (const t of [0, 3.3, 47, 600])
      drawBackdrop(ctx, canvas, scene, { mode, t, colors, k: 1, saturation: 1.2, blur: 20, solid: "#000", art: null, scale: 4, dim: 0.3 });
  expect(bad).toEqual([]);
});
test("vivid lifts muddy colors, keeps greys grey and stays in range", () => {
  const brown = vivid([90, 42, 31]);
  expect(Math.max(...brown)).toBeGreaterThan(130); // lifted from 90
  expect(brown[0]).toBeGreaterThan(brown[2]); // same warm hue
  const grey = vivid([60, 60, 60]);
  expect(Math.max(...grey) - Math.min(...grey)).toBeLessThan(3);
  for (const c of [[0, 0, 0], [255, 255, 255], [255, 0, 0], [0, 0, 255], [12, 200, 40]] as [number, number, number][])
    for (const v of vivid(c)) expect(v >= 0 && v <= 255).toBe(true);
});
