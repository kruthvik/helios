/// <reference types="bun" />
import { expect, test } from "bun:test";
import { autoBg, autoFx, mood } from "./mood";

const lead = (p: string[]) => autoFx(p)[0].fx;

test("palettes map to mixes of effects and scenes that suit them", () => {
  expect(["embers", "fireworks"]).toContain(lead(["#c0392b", "#e74c3c", "#7b1e12", "#401010"])); // dark reds: fire
  expect(["bubbles", "rain", "snow"]).toContain(lead(["#1e3a8a", "#3b82f6", "#1d4ed8", "#0f172a"])); // blues
  expect(["fireflies", "butterflies"]).toContain(lead(["#166534", "#22c55e", "#14532d", "#4ade80"])); // greens
  expect(["stars", "fireflies", "snow"]).toContain(lead(["#222222", "#444444", "#111111", "#333333"])); // greys
  expect(["confetti", "notes", "fireworks", "bubbles"]).toContain(lead(["#ef4444", "#22c55e", "#3b82f6", "#eab308"])); // rainbow
  expect(["ocean", "jellyfish", "koi"]).toContain(autoBg(["#1e3a8a", "#3b82f6", "#1d4ed8", "#0f172a"]));
});

test("every album gets a mix of distinct effects: a lead and lighter accents", () => {
  for (const p of [["#c0392b", "#7b1e12"], ["#1e3a8a", "#3b82f6"], ["#166534", "#4ade80"], ["#8e44ad", "#d2b4de"], ["#ff69b4", "#ffc0cb"]]) {
    const mix = autoFx(p);
    expect(mix.length).toBeGreaterThanOrEqual(2);
    expect(new Set(mix.map((m) => m.fx)).size).toBe(mix.length);
    for (const accent of mix.slice(1)) expect(accent.amount).toBeLessThan(mix[0].amount);
  }
});

test("the same album always gets the same look, and settings stay in a tidy range", () => {
  const p = ["#8e44ad", "#5b2c6f", "#d2b4de", "#2e1a47"];
  expect(autoFx(p)).toEqual(autoFx([...p]));
  expect(autoBg(p)).toBe(autoBg([...p]));
  for (const pal of [p, [], ["#ffffff"], ["#000000", "#ff0000"]]) {
    for (const a of autoFx(pal)) {
      expect(a.amount).toBeGreaterThan(0.05);
      expect(a.amount).toBeLessThan(1);
      expect(a.speed).toBeGreaterThan(0.5);
      expect(a.speed).toBeLessThan(1.5);
    }
    expect(Number.isFinite(mood(pal).hue)).toBe(true);
  }
});
