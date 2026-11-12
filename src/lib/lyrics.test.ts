/// <reference types="bun" />
import { expect, test } from "bun:test";
import { activeLine, cleanTitle, fmtOffset, dropCredits, parseLrc, parseLyricsFile, parseSrt, parseYrc, pick, tidy, tidyWords, wordGroups, type Lyrics } from "./lyrics";

test("tidy fixes spacing and punctuation without touching timings", () => {
  expect(tidy("Hello  ,  world ( yeah ) !")).toBe("Hello, world (yeah)!");
  expect(tidy("we keep going,")).toBe("we keep going");
  expect(tidy("why?")).toBe("why?");
  const w = tidyWords([
    { t: 0, d: 1, text: " Hello  " }, { t: 1, d: 1, text: " , " }, { t: 2, d: 1, text: "  world" }, { t: 3, d: 1, text: " ," },
  ]);
  expect(w.map((x) => x.text).join("")).toBe("Hello, world");
  expect(w.map((x) => x.t)).toEqual([0, 1, 2]);
  expect(parseLrc("[00:01.00]so  ,  good ,")[0].text).toBe("so, good");
});

test("brackets and apostrophes come out right (real NetEase / LRCLIB shapes)", () => {
  // full-width brackets in an English song, the opening one sent as its own timed word
  const [l] = parseYrc("[25680,8100](25680,330,0)I (26010,270,0)don't (26280,270,0)run (28860,1560,0)away (30420,3090,0)（(33510,120,0)Oh(33630,0,0), (33630,30,0)oh(33690,30,0)）");
  expect(l.text).toBe("I don’t run away (Oh, oh)");
  expect(wordGroups(l).map((w) => w.text)).toEqual(["I", "don’t", "run", "away", "(Oh,", "oh)"]);
  // a literal "(" right after a stamp used to swallow the word
  expect(parseYrc("[0,900](0,300,0)hot (300,300,0)(hot (600,300,0)damn)")[0].text).toBe("hot (hot damn)");
  expect(tidy("I'm too hot(hot damn)yeah")).toBe("I’m too hot (hot damn) yeah");
  expect(tidy("God´s plan, don ' t stop, I 'm goin' , 'cause rock`n roll &#39;til")).toBe("God’s plan, don’t stop, I’m goin’, ’cause rock’n roll ’til");
  expect(tidy("你好（世界）")).toBe("你好（世界）"); // CJK keeps its own brackets
  expect(tidy("They gon' tell, 'nessed, lil' yo' rock 'n' roll")).toBe("They gon’ tell, ’nessed, lil’ yo’ rock ’n’ roll");
  expect(tidy("she said 'stop' now")).toBe("she said ‘stop’ now");
  expect(tidy("Angels fight with devils,and here's…In one（moment）？")).toBe("Angels fight with devils, and here’s… In one (moment)?");
  expect(tidy(`She said, "Do you love me?" I'm like a rock... neo..hey`)).toBe("She said, “Do you love me?” I’m like a rock… neo… hey");
  const ne = parseLrc("[00:00.00]人声: Dua Lipa\n[00:00.50]编程: X\n[00:02.00]Real line\n[00:03.00]母带助理: Y");
  expect(dropCredits(ne).map((l) => l.text)).toEqual(["Real line"]);
  expect(dropCredits(parseLrc("[00:01.00]Uptown Funk you up\n[04:25.00]Talkbox: Jeff\n[04:26.00]Mixing: S\n[04:27.00]Recorded at Royal Studios (Memphis)\n[04:28.00]")).map((l) => l.text)).toEqual(["Uptown Funk you up", ""]);
  expect(dropCredits(parseLrc("[00:00.00]Real\n[00:01.00]他说：你好\n[00:02.00]End")).map((l) => l.text)).toEqual(["Real", "他说：你好", "End"]);
  expect(dropCredits(parseLrc("[00:00.00]Writers：A/B\n[00:00.50]Vocal:Drake\n[00:01.00]Mixing: X\n[00:02.00]Real line")).map((l) => l.text)).toEqual(["Real line"]);
  expect(tidy("Hello￼ wor​ld  now﻿")).toBe("Hello world now"); // "OBJ" and other invisibles
  expect(tidy("👨‍👩")).toBe("👨‍👩"); // emoji joiners survive
  const junk = tidyWords([{ t: 0, d: 1, text: "Hi " }, { t: 1, d: 1, text: "￼" }, { t: 2, d: 1, text: "there" }]);
  expect(junk.map((x) => x.text).join("")).toBe("Hi there");
  // Kanye West – Champion (NetEase): orphan brackets, a split parenthetical, a lone quote word, section headers
  const champ = parseYrc(
    "[0,900](0,300,0)their (300,300,0)eyes(600,300,0))\n" +
    "[1000,900](1000,300,0)(Did (1300,300,0)you (1600,300,0)realize\n" +
    "[2000,900](2000,300,0)That (2300,300,0)eyes(2600,100,0)?(2700,100,0))\n" +
    '[3000,900](3000,300,0)say (3300,100,0)"(3400,300,0)when (3700,100,0)eyelids(3800,100,0)"',
  );
  expect(champ.map((l) => l.text)).toEqual(["(their eyes)", "(Did you realize)", "(That eyes?)", "say “when eyelids”"]);
  for (const l of champ) expect(l.words!.map((w) => w.text).join("")).toBe(l.text);
  expect(dropCredits(parseLrc("[00:01.00]Real\n[00:24.75]Verse 1:]\n[00:57.08]Chorus 2: Kanye & （sample）]\n[00:58.00][Hook]\n[01:00.00]Bridge over troubled water\n[01:02.00]End")).map((l) => l.text))
    .toEqual(["Real", "Bridge over troubled water", "End"]);
  const w = tidyWords([{ t: 0, d: 1, text: "don " }, { t: 1, d: 1, text: "'t " }, { t: 2, d: 1, text: "stop" }]);
  expect(w.map((x) => x.text).join("")).toBe("don’t stop");
});

test("wordGroups merges syllables, splits CJK, and spreads line-synced words", () => {
  const syl = wordGroups({ t: 0, end: 900, text: "so beautiful", words: [
    { t: 0, d: 200, text: "so " }, { t: 200, d: 100, text: "beau" }, { t: 300, d: 100, text: "ti" }, { t: 400, d: 300, text: "ful" },
  ] });
  expect(syl).toEqual([{ t: 0, d: 200, text: "so" }, { t: 200, d: 500, text: "beautiful" }]);
  expect(wordGroups({ t: 0, end: 300, text: "你好", words: [{ t: 0, d: 100, text: "你" }, { t: 100, d: 100, text: "好" }] }).map((w) => w.text)).toEqual(["你", "好"]);
  const even = wordGroups({ t: 1000, end: 2000, text: "a bb" });
  expect(even.map((w) => w.text)).toEqual(["a", "bb"]);
  expect(even[0].t).toBe(1000);
  expect(even[1].t).toBeCloseTo(1000 + 900 / 2); // one syllable each
  // a long gap after the line (a held note, a break) no longer stretches the words across it
  const gap = wordGroups({ t: 0, end: 20000, text: "hold on to me" });
  expect(gap[3].t + gap[3].d).toBeLessThan(1500);
  expect(wordGroups({ t: 0, end: 400, text: "你好" }).map((w) => w.text)).toEqual(["你", "好"]);
});

test("parseLrc handles stamps, multi-stamps, metadata, blank lines and line ends", () => {
  const lines = parseLrc("[ar:Someone]\n[00:01.50]Hello\n[00:10.00][01:00.25]Chorus\n[00:05.123]\n");
  expect(lines.map(({ t, text, end }) => ({ t, text, end }))).toEqual([
    { t: 1500, text: "Hello", end: 5123 },
    { t: 5123, text: "", end: 10000 },
    { t: 10000, text: "Chorus", end: 60250 },
    { t: 60250, text: "Chorus", end: 66250 },
  ]);
});

test("parseLrc reads enhanced word stamps", () => {
  const [line] = parseLrc("[00:01.00]<00:01.00>Hello <00:01.50>big <00:02.00>world");
  expect(line.text).toBe("Hello big world");
  expect(line.words).toEqual([
    { t: 1000, d: 500, text: "Hello " },
    { t: 1500, d: 500, text: "big " },
    { t: 2000, d: 600, text: "world" },
  ]);
});

test("enhanced LRC preserves explicit word-end and rest timestamps", () => {
  const [line] = parseLrc("[00:01.00]<00:01.00>Hello<00:01.25> <00:02.00>world<00:02.35>");
  expect(line.words?.map(({ t, d }) => ({ t, d }))).toEqual([{ t: 1000, d: 250 }, { t: 2000, d: 350 }]);
});

test("canonical spaces prevent whole timed words from being merged, without breaking syllables", () => {
  const words = [{ t: 1000, d: 250, text: "Hello" }, { t: 1500, d: 400, text: "world" }];
  expect(wordGroups({ t: 1000, end: 2000, text: "Hello world", words }).map(w => w.text)).toEqual(["Hello", "world"]);
  const grouped = wordGroups({ t: 0, end: 2000, text: "beautiful day", words: [
    { t: 0, d: 800, text: "beau" }, { t: 800, d: 100, text: "ti" }, { t: 900, d: 300, text: "ful" }, { t: 1400, d: 400, text: "day" },
  ] });
  expect(grouped).toEqual([{ t: 0, d: 1200, text: "beautiful" }, { t: 1400, d: 400, text: "day" }]);
  expect(words[0].text).toBe("Hello");
});

test("parseYrc reads NetEase word timing and skips JSON lines", () => {
  const yrc = '{"t":0,"c":[{"tx":"作词: x"}]}\n[31420,2670](31420,390,0)Like (31810,150,0)the (31960,630,0)legend\n';
  const [line] = parseYrc(yrc);
  expect(line).toEqual({
    t: 31420,
    end: 34090,
    text: "Like the legend",
    words: [
      { t: 31420, d: 390, text: "Like " },
      { t: 31810, d: 150, text: "the " },
      { t: 31960, d: 630, text: "legend" },
    ],
  });
});

test("dropCredits removes credit lines", () => {
  const lines = parseLrc("[00:00.00]作词 : Someone\n[00:00.50]Composer: X\n[00:10.00]Real lyric");
  expect(dropCredits(lines).map((l) => l.text)).toEqual(["Real lyric"]);
});

test("activeLine finds the current line", () => {
  const lines = parseLrc("[00:01.00]a\n[00:02.00]b\n[00:03.00]c");
  expect(activeLine(lines, 500)).toBe(-1);
  expect(activeLine(lines, 1000)).toBe(0);
  expect(activeLine(lines, 2999)).toBe(1);
  expect(activeLine(lines, 99999)).toBe(2);
  expect(activeLine([], 1000)).toBe(-1);
});

test("cleanTitle strips features and remaster suffixes", () => {
  expect(cleanTitle("Greed (feat. Lil Yachty)")).toBe("Greed");
  expect(cleanTitle("Here Comes The Sun - Remastered 2009")).toBe("Here Comes The Sun");
  expect(cleanTitle("Talk Up [ft. Jay-Z]")).toBe("Talk Up");
});

test("pick prefers word sync, then synced, keeps source order on ties", () => {
  const line = { t: 0, end: 1, text: "x" };
  const lrc: Lyrics = { kind: "synced", lines: [line], source: "lrclib", id: "1", wordSynced: false };
  const word: Lyrics = { kind: "synced", lines: [line], source: "netease", id: "2", wordSynced: true };
  const plain: Lyrics = { kind: "plain", lines: ["x"], source: "lrclib", id: "3" };
  const sources = ["lrclib", "netease"] as const;
  expect(pick([lrc, word], { sources: [...sources], preferWordSync: true })).toBe(word);
  expect(pick([lrc, word], { sources: [...sources], preferWordSync: false })).toBe(lrc);
  expect(pick([plain, null], { sources: [...sources], preferWordSync: true })).toBe(plain);
  expect(pick([null, null], { sources: [...sources], preferWordSync: true })).toEqual({ kind: "none" });
});

test("a positive timing offset shows lyrics earlier, and the label says so", () => {
  const lines = [0, 2000, 4000].map((t) => ({ t, end: t + 2000, text: `line ${t}` }));
  const at = 3800; // song position: still on the line that starts at 2000
  expect(activeLine(lines, at)).toBe(1);
  expect(activeLine(lines, at + 300)).toBe(2); // Lyrics.svelte reads lines at position + offset: +300 reaches the next line sooner
  expect(activeLine(lines, at - 300)).toBe(1);
  expect(fmtOffset(300)).toBe("0.3s earlier");
  expect(fmtOffset(-1000)).toBe("1s later");
  expect(fmtOffset(-50)).toBe("0.05s later");
  expect(fmtOffset(0)).toBe("in sync");
});
test("own lyrics files: SRT/VTT cues, LRC, or plain text", () => {
  const srt = "1\n00:00:01,500 --> 00:00:03,000\n<i>Hello</i> there\n\n2\n00:01:02.25 --> 00:01:04.000\n{\\an8}Second line\n";
  expect(parseSrt(srt).map((l) => [l.t, l.text])).toEqual([[1500, "Hello there"], [62250, "Second line"]]);
  expect(parseSrt("WEBVTT\n\n" + srt)).toHaveLength(2);
  expect(parseLyricsFile("[00:05.00]Hi", "k")).toMatchObject({ kind: "synced", source: "file", lines: [{ t: 5000, text: "Hi" }] });
  expect(parseLyricsFile("one\n\ntwo", "k")).toMatchObject({ kind: "plain", lines: ["one", "two"] });
  expect(parseLyricsFile("  ", "k")).toEqual({ kind: "none" });
});