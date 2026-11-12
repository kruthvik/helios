/// <reference types="bun" />
import { expect, test } from "bun:test";
import { rankVideos, type YtItem } from "./video";

const item = (videoId: string, title: string, channelTitle: string, officialArtist = false): YtItem => ({
  id: { videoId },
  snippet: { title, channelTitle, officialArtist },
});

test("accepts a verified artist channel only when the artist is in the title", () => {
  const items = [
    item("ok", "Get Lucky - Daft Punk (Official Video)", "Columbia Records", true),
    item("no", "Get Lucky (Official Video)", "Some Label", true),
  ];
  expect(rankVideos(items, { name: "Get Lucky", artists: "Daft Punk" })).toEqual(["ok"]);
});

test("keeps only the artist's own upload, never re-uploads or lyric/audio uploads", () => {
  // Shaped like a real keyless search for this song.
  const items = [
    item("re1", "Daft Punk - Get Lucky (Official Video) feat. Pharrell Williams and Nile Rodgers", "convar HUN"),
    item("re2", "DAFT PUNK - Get Lucky (feat. Pharrell Williams) (VIDEO)", "Monsieur Blaya"),
    item("re3", "Daft Punk - Get Lucky (Official 4K Video) ft. Pharrell Williams and Nile Rodgers", "The Retro Videos"),
    item("aud", "Daft Punk - Get Lucky (Official Audio) ft. Pharrell Williams, Nile Rodgers", "Daft Punk"),
    item("own", "Daft Punk - Get Lucky (Official Video)", "Daft Punk"),
  ];
  expect(rankVideos(items, { name: "Get Lucky (feat. Pharrell Williams & Nile Rodgers)", artists: "Daft Punk, Pharrell Williams" })).toEqual([
    "own",
  ]);
});

test("accepts VEVO channels and decodes HTML entities", () => {
  const items = [item("v", "Adele - Rolling in the Deep", "AdeleVEVO"), item("x", "Don&#39;t Stop Me Now", "x")];
  expect(rankVideos(items, { name: "Rolling in the Deep", artists: "Adele" })).toEqual(["v"]);
});

test("rejects other artists, covers, and unrelated titles", () => {
  const items = [
    item("1", "Get Lucky (Official Video) - Cover by Someone", "Someone"),
    item("2", "Some Other Song (Official Video)", "Daft Punk"),
  ];
  expect(rankVideos(items, { name: "Get Lucky", artists: "Daft Punk" })).toEqual([]);
});

test("allows 'live' when the track itself is a live version", () => {
  const items = [item("L", "Coldplay - Yellow (Live Official Video)", "Coldplay")];
  expect(rankVideos(items, { name: "Yellow - Live", artists: "Coldplay" })).toEqual(["L"]);
  expect(rankVideos(items, { name: "Yellow", artists: "Coldplay" })).toEqual([]);
});

const timed = (videoId: string, title: string, channelTitle: string, lengthS: number, officialArtist = false): YtItem => ({
  id: { videoId },
  snippet: { title, channelTitle, officialArtist, lengthS },
});

test("finds M/V spellings, label channels and plain 'Artist - Song' videos (real search shapes)", () => {
  expect(rankVideos([timed("p", "PSY - GANGNAM STYLE(강남스타일) M/V", "officialpsy", 253, true)], { name: "Gangnam Style (강남스타일)", artists: "PSY", durationMs: 219_000 })).toEqual(["p"]);
  const bts = [
    timed("agt", "BTS (방탄소년단) 'Dynamite' @ America's Got Talent 2020", "BANGTANTV", 202, true),
    timed("mv", "BTS (방탄소년단) 'Dynamite' Official MV", "HYBE LABELS", 224),
  ];
  expect(rankVideos(bts, { name: "Dynamite", artists: "BTS", durationMs: 199_000 })).toEqual(["mv"]);
  const kdot = [timed("mv", "Kendrick Lamar - HUMBLE.", "Kendrick Lamar", 184, true), timed("art", "HUMBLE.", "Kendrick Lamar", 177, true)];
  expect(rankVideos(kdot, { name: "HUMBLE.", artists: "Kendrick Lamar", durationMs: 177_000 })).toEqual(["mv"]);
});

test("skips audio uploads, fan channels and re-uploads", () => {
  const items = [
    timed("aud", "Frank Ocean - Ivy", "Blonded", 250, true), // as long as the song: the audio
    timed("fan", 'Drake "Rich Flex" Official Video', "Drake Hub", 240),
    timed("re", "Ella Baila Sola (Video Oficial) | peso pluma", "fresa letras 2", 1019),
  ];
  expect(rankVideos(items.slice(0, 1), { name: "Ivy", artists: "Frank Ocean", durationMs: 249_000 })).toEqual([]);
  expect(rankVideos(items.slice(1, 2), { name: "Rich Flex", artists: "Drake, 21 Savage", durationMs: 239_000 })).toEqual([]);
  expect(rankVideos(items.slice(2), { name: "Ella Baila Sola", artists: "Eslabon Armado, Peso Pluma", durationMs: 165_000 })).toEqual([]);
});
