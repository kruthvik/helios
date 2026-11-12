/// <reference types="bun" />
import { expect, test } from "bun:test";
import { ytId, mvTarget, mvRate } from "./media";

test("YouTube links of every shape give the id", () => {
  for (const s of [
    "https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42",
    "https://youtu.be/dQw4w9WgXcQ?si=abc",
    "https://youtube.com/shorts/dQw4w9WgXcQ",
    "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ",
    "https://m.youtube.com/watch?list=PL1&v=dQw4w9WgXcQ",
    " dQw4w9WgXcQ ",
  ])
    expect(ytId(s)).toBe("dQw4w9WgXcQ");
  expect(ytId("https://example.com/video")).toBe("");
});

test("stretch spreads the video over the song, within YouTube's speeds", () => {
  expect(mvRate(200_000, 260_000)).toBeCloseTo(1.3);
  expect(mvRate(100_000, 900_000)).toBe(2);
  expect(mvTarget("stretch", 100_000, 200_000, 260_000, 4000)).toBeCloseTo(130_000);
});

test("clips play at normal speed, jump between parts and stay inside the video", () => {
  const video = 240_000, clip = 4000, starts = new Set<number>();
  for (let k = 0; k < 50; k++) {
    const a = mvTarget("clips", k * clip, 200_000, video, clip);
    expect(mvTarget("clips", k * clip + 1500, 200_000, video, clip) - a).toBeCloseTo(1500); // 1× inside a clip
    expect(a).toBeGreaterThanOrEqual(video * 0.05);
    expect(a + clip).toBeLessThanOrEqual(video * 0.95 + 1);
    starts.add(Math.round(a));
  }
  expect(starts.size).toBe(50); // no part repeats before the video is used up
  expect(Number.isFinite(mvTarget("clips", 5000, 200_000, 3000, 4000))).toBe(true); // video shorter than a clip
});
