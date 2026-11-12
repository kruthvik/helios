import { invoke } from "@tauri-apps/api/core";

export type Word = { t: number; d: number; text: string };
export type Line = { t: number; end: number; text: string; words?: Word[] };
export type Source = "lrclib" | "netease";
export type Origin = Source | "file"; // "file": a subtitle file the user loaded for this song
export type Lyrics =
  | { kind: "synced"; lines: Line[]; source: Origin; id: string; wordSynced: boolean }
  | { kind: "plain"; lines: string[]; source: Origin; id: string }
  | { kind: "instrumental"; source: Origin; id: string }
  | { kind: "none" };

export type TrackQuery = { name: string; artists: string; album: string; durationMs: number };
export type Candidate = {
  source: Source;
  id: string;
  title: string;
  artist: string;
  durationMs: number;
  synced: boolean | null; // null = unknown until loaded
};
export type Prefs = { sources: Source[]; preferWordSync: boolean };

// ---------- parsing ----------

const LINE_STAMP = /\[(\d+):(\d{1,2}(?:[.:]\d{1,3})?)\]/g;
const WORD_STAMP = /<(\d+):(\d{1,2}(?:[.:]\d{1,3})?)>/g;
const toMs = (m: string, s: string) => Math.round((Number(m) * 60 + Number(s.replace(":", "."))) * 1000);

// ---------- tidying: sources are full of "word ,", double spaces and dangling commas ----------
const CLOSE = ",.!?;:…)\\]}、。，！？；：）」』";
const SPACE_BEFORE_CLOSE = new RegExp(`\\s+([${CLOSE}])`, "gu");
const ONLY_CLOSE = new RegExp(`^[${CLOSE}]+$`, "u");
const TRAILING_COMMA = /\s*[,，、]+\s*$/u; // a comma at the end of a line reads as a typo once it's on screen
const ONLY_OPEN = /^[(\[（「『]+$/u;
const APOS = "'’‘´`";
const CONTRACTION = new RegExp(`^[${APOS}](?:t|s|re|ve|ll|d|m)(?![\\p{L}])`, "iu"); // "'t" "'s" "'re"… end a word
const ENTITIES: Record<string, string> = { "&apos;": "'", "&#39;": "'", "&#x27;": "'", "&quot;": '"', "&amp;": "&", "&#8217;": "’" };

/** Character-level fixes: entities, one apostrophe form, and (outside CJK text) ASCII brackets. */
const FULLWIDTH: Record<string, string> = { "（": "(", "）": ")", "：": ":", "，": ",", "？": "?", "！": "!", "；": ";" };

// Invisible junk sources leave in: object-replacement (shows as "OBJ"), replacement char, zero-width space/no-break,
// soft hyphen, word joiner, bidi marks and C0/C1 controls. ZWJ/ZWNJ stay: emoji and some scripts need them.
const INVISIBLE = /[￼�​﻿­⁠‎‏‪-‮⁦-⁩\u0000-\u0008\u000B-\u001F\u007F-\u009F]/g;

function chars(s: string, latin: boolean) {
  s = s.replace(INVISIBLE, "").replace(/[  -   　\t]/g, " "); // odd spaces → plain space
  s = s.replace(/&(?:apos|quot|amp|#39|#x27|#8217);/g, (e) => ENTITIES[e]).replace(/\.{2,}/g, "…"); // ".." / "..." → "…"
  if (latin)
    s = s
      .replace(/[（）：，？！；]/g, (c) => FULLWIDTH[c]) // CJK punctuation inside an English line
      .replace(/([,;:!?…])(?=\p{L})/gu, "$1 "); // "devils,and" → "devils, and"
  return (
    s
      .replace(new RegExp(`(\\p{L})\\s*[${APOS}]\\s*(t|s|re|ve|ll|d|m)(?![\\p{L}])`, "giu"), "$1’$2") // "don ' t" → "don’t"
      .replace(new RegExp(`(\\p{L})[${APOS}](?=\\p{L})`, "gu"), "$1’") // in-word: rock´n, y'all
      .replace(/(^|\s)['’]n['’](?=\s|$)/g, "$1’n’") // rock 'n' roll
      .replace(new RegExp(`(^|[\\s(])[${APOS}](cause|cuz|bout|til|till|em|round|fore|nother|kay|nessed|sup)(?![\\p{L}])`, "giu"), "$1’$2")
      // a real 'quote' gets curly quotes; every other straight apostrophe is one (gon', lil', 'nessed)
      .replace(/(^|[\s(])'([^'’\n]+?)'(?=$|[\s,.!?;:)])/g, "$1‘$2’")
      .replace(/['´`]/g, "’")
      // same treatment for double quotes, decided by position so it works on single timed words too
      .replace(/(^|[\s(\[])"/g, "$1“")
      .replace(/"/g, "”")
  );
}

export function tidy(s: string) {
  const latin = !CJK.test(s);
  s = chars(s, latin).replace(/\s+/g, " ").replace(SPACE_BEFORE_CLOSE, "$1").replace(/([(\[（「『])\s+/gu, "$1");
  if (latin) s = s.replace(/([^\s(\[])\(/g, "$1 (").replace(/\)(?=[\p{L}\p{N}])/gu, ") "); // "away(oh)yeah" → "away (oh) yeah"
  return s.replace(TRAILING_COMMA, "").trim();
}

/** Same clean-up for timed words, keeping every timing: spaces move, punctuation sticks to its word. */
export function tidyWords(words: Word[]): Word[] {
  const latin = !CJK.test(words.map((w) => w.text).join(""));
  const out: Word[] = [];
  let open = ""; // a bracket sent as its own "word": it belongs to the start of the next one
  let quotes = 0; // straight quotes alternate open/close across the line (a lone " token can't tell which it is)
  for (const w of words) {
    let text = chars(w.text.replace(/"/g, () => (quotes++ % 2 ? "”" : "“")), latin).replace(/\s+/g, " ");
    const prev = out.at(-1);
    if (!prev || /\s$/.test(prev.text)) text = text.trimStart();
    if (ONLY_OPEN.test(text.trim())) {
      if (latin && prev && !/\s$/.test(prev.text)) prev.text += " ";
      open += text.trim();
      continue;
    }
    if (open) (text = open + text.trimStart()), (open = "");
    if (prev && (ONLY_CLOSE.test(text.trim()) || CONTRACTION.test(text.trim()))) {
      prev.text = prev.text.trimEnd();
      text = text.trimStart();
      if (CONTRACTION.test(text)) text = "’" + text.slice(1);
    }
    if (text) out.push({ ...w, text });
  }
  const last = out.at(-1);
  if (last) {
    last.text = last.text.replace(TRAILING_COMMA, "").trimEnd();
    if (!last.text) out.pop();
  }
  return out;
}

/**
 * Each line shows on its own, so its brackets must pair up within it: an echo like "their eyes)" becomes
 * "(their eyes)", and a parenthetical spread over two lines ("(Did you realize" / "…eyes?)") closes and reopens.
 * Words (if any) get the same bracket on their first/last word, so the text and the words still match.
 */
export function balance(text: string, words?: Word[]): [string, Word[] | undefined] {
  let depth = 0, missingOpen = 0;
  for (const ch of text) {
    if (ch === "(") depth++;
    else if (ch === ")") depth ? depth-- : missingOpen++;
  }
  if (!depth && !missingOpen) return [text, words];
  const pre = "(".repeat(missingOpen), post = ")".repeat(depth);
  if (words?.length) {
    words[0].text = pre + words[0].text;
    const last = words[words.length - 1];
    last.text = last.text.trimEnd() + post;
  }
  return [pre + text + post, words];
}

/** Closes each line at the next one's start (last line: +6s). */
function withEnds(lines: Omit<Line, "end">[]): Line[] {
  const sorted = lines.sort((a, b) => a.t - b.t);
  return sorted.map((l, i) => ({ ...l, end: sorted[i + 1]?.t ?? l.t + 6000 }));
}

/** LRC, including multiple stamps per line and enhanced (A2) word stamps like <00:12.34>word. */
export function parseLrc(lrc: string): Line[] {
  const out: Omit<Line, "end">[] = [];
  for (const raw of lrc.split(/\r?\n/)) {
    const times = [...raw.matchAll(LINE_STAMP)].map((m) => toMs(m[1], m[2]));
    if (!times.length) continue;
    const body = raw.replace(LINE_STAMP, "");
    const stamps = [...body.matchAll(WORD_STAMP)];
    let words: Word[] | undefined;
    if (stamps.length) {
      const parts = body.split(WORD_STAMP); // [pre, m, s, word, m, s, word, ...]
      words = [];
      for (let i = 1; i + 2 < parts.length; i += 3) {
        const text = parts[i + 2];
        const t = toMs(parts[i], parts[i + 1]);
        const end = i + 4 < parts.length ? toMs(parts[i + 3], parts[i + 4]) : t + 600;
        if (text.trim()) words.push({ t, d: Math.max(0, end - t), text });
      }
    }
    let text = tidy(body.replace(WORD_STAMP, ""));
    if (words) words = tidyWords(words);
    [text, words] = balance(text, words);
    for (const t of times) out.push({ t, text, ...(words?.length && times.length === 1 ? { words } : {}) });
  }
  return withEnds(out);
}

/** SRT / WebVTT cues: "00:01:02,500 --> 00:01:04,000" then the text (tags like <i> and {\an8} dropped). */
const CUE = /(?:(\d+):)?(\d{1,2}):(\d{2})[,.](\d{1,3})\s*-->/;
export function parseSrt(srt: string): Line[] {
  const out: Omit<Line, "end">[] = [];
  for (const block of srt.replace(/\r/g, "").split(/\n\s*\n/)) {
    const rows = block.split("\n");
    const i = rows.findIndex((r) => CUE.test(r));
    if (i < 0) continue;
    const [, h, m, s, f] = rows[i].match(CUE)!;
    const text = tidy(rows.slice(i + 1).join(" ").replace(/<[^>]*>|\{[^}]*\}/g, ""));
    if (text) out.push({ t: ((Number(h ?? 0) * 60 + Number(m)) * 60 + Number(s)) * 1000 + Number(f.padEnd(3, "0")), text });
  }
  return withEnds(out);
}

/** A file the user loaded: LRC (synced, maybe word-synced), SRT/VTT (synced), or anything else as plain lines. */
export function parseLyricsFile(text: string, id: string): Lyrics {
  const lrc = parseLrc(text);
  const lines = lrc.length ? lrc : parseSrt(text);
  if (lines.length) return { kind: "synced", lines, source: "file", id, wordSynced: lines.some((l) => l.words) };
  const plain = text.split(/\r?\n/).map(tidy).filter(Boolean);
  return plain.length ? { kind: "plain", lines: plain, source: "file", id } : { kind: "none" };
}

/** NetEase "yrc":[lineStart,lineDur](wordStart,wordDur,0)word(…)word */
export function parseYrc(yrc: string): Line[] {
  const out: Line[] = [];
  for (const raw of yrc.split(/\r?\n/)) {
    const head = raw.match(/^\[(\d+),(\d+)\]/);
    if (!head) continue;
    const words = tidyWords(
      // a word runs to the next stamp, so brackets inside lyrics ("(Hey") aren't mistaken for one
      [...raw.matchAll(/\((\d+),(\d+),\d+\)(.*?)(?=\(\d+,\d+,\d+\)|$)/g)].map((m) => ({ t: Number(m[1]), d: Number(m[2]), text: m[3] })),
    );
    const [text] = balance(tidy(words.map((w) => w.text).join("")), words);
    if (text) out.push({ t: Number(head[1]), end: Number(head[1]) + Number(head[2]), text, words });
  }
  return out.sort((a, b) => a.t - b.t);
}

// Credit lines NetEase puts at the top of lyrics ("作词 : X", "Composer: Y").
const CREDIT =
  /^\s*(作词|作曲|编曲|制作人|制作|混音师?|母带(工程师)?|和声|吉他|贝斯|鼓|录音(师|工程师)?|监制|出品|发行|lyrics?( by)?|lyricist|writers?|written by|composers?|composed by|producers?|produced by|arrangers?|arranged by|mix(ed|ing)( by)?|master(ed|ing)( by)?|vocals?|recording|engineers?|programming|samples?|publisher)\s*[:：]/i;
// NetEase also credits every role in Chinese ("人声: X", "母带助理: Y"); any short Han label counts, but only
// in the block at the very start or end, so a Chinese lyric like "他说：…" mid-song stays.
// The same goes for any short "Label: Name" ("Talkbox: X", "Linn Drum: Y").
const HAN_LABEL = /^\s*\p{Script=Han}{1,8}\s*[:：]/u;
const LABEL = /^\s*[\p{L}\p{N}][^:：?!"“”]{0,60}[:：]\s*\S/u; // "12-String Acoustic Guitar: X" too
// "Recorded at Royal Studios…", "Published by Sony/ATV…"
const STUDIO = /^\s*(recorded|mixed|mastered|produced|engineered|published|written|arranged|composed|administered|licensed)( and \w+)? (at|by|in|under)\b/i;
// Section headers some sources leave in ("[Verse 1:]", "Chorus 2: Kanye & (sample)]", "[Hook]"): never lyrics.
// Needs a bracket or a colon, so a sung line that merely starts with "Bridge" or "Hook" stays.
const SECTION = /^\s*[\[(]?\s*(?:verse|chorus|hook|(?:pre|post)-?chorus|bridge|intro|outro|refrain|interlude|break|instrumental|skit|part)\b[^\]]*?(?:[:\]]|\]\s*$)/i;
const isSection = (s: string) => SECTION.test(s) && (/[\[\]]/.test(s) || /^\s*\w+(?:[ -]\w+)?\s*\d*\s*:/.test(s));
export function dropCredits(lines: Line[]): Line[] {
  lines = lines.filter((l) => !isSection(l.text));
  const credit = (l: Line) => CREDIT.test(l.text) || HAN_LABEL.test(l.text) || LABEL.test(l.text) || STUDIO.test(l.text);
  let a = 0, b = lines.length;
  while (a < b && (credit(lines[a]) || !lines[a].text)) a++;
  while (b > a && (credit(lines[b - 1]) || !lines[b - 1].text)) b--;
  // blank lines at the edges stay (they're intros/outros), only credits go
  return [...lines.slice(0, a).filter((l) => !credit(l)), ...lines.slice(a, b).filter((l) => !CREDIT.test(l.text)), ...lines.slice(b).filter((l) => !credit(l))];
}

/** A lyrics timing offset in words: positive shows lyrics earlier. "0.3s earlier", "1.0s later", "in sync". */
export const fmtOffset = (ms: number) => (Math.abs(ms) < 50 ? "in sync" : `${+(Math.abs(ms) / 1000).toFixed(2)}s ${ms > 0 ? "earlier" : "later"}`);

/** Index of the line playing at `ms` (-1 before the first line). */
export function activeLine(lines: Line[], ms: number): number {
  let lo = 0, hi = lines.length - 1, ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (lines[mid].t <= ms) (ans = mid), (lo = mid + 1);
    else hi = mid - 1;
  }
  return ans;
}

export const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;

/**
 * Whole words with timings, for the word-at-a-time modes. Word-synced lines may be split into syllables
 * ("beau" "ti" "ful "), so those are merged; line-synced lines get times spread by word length.
 * CJK has no spaces, so each character counts as a word.
 */
const SYLLABLE_MS = 260; // a relaxed sung pace (speech runs ~200ms a syllable; singing holds a bit longer)
/** Vowel groups, so "strength" weighs 1 and "beautiful" 3; non-Latin text (CJK, etc.) counts each character. */
function syllables(word: string) {
  if (!/[a-z]/i.test(word)) return Math.max(1, Array.from(word).length);
  const n = word.toLowerCase().replace(/e\b/, "").match(/[aeiouy]+/g)?.length ?? 0;
  return Math.max(1, n);
}

export function wordGroups(line: Line): Word[] {
  if (line.words?.length) {
    const out: Word[] = [];
    let open = false; // last group still waiting for the rest of its word
    // Some sources omit spaces on timed fragments even though the canonical line has them.
    // Only use those boundaries when every non-space character agrees; never guess new transcription text.
    const compact = (text: string) => text.replace(/\s/g, "");
    const aligned = compact(line.text) === compact(line.words.map(w => w.text).join(""));
    const boundaries = new Set<number>();
    let chars = 0;
    if (aligned) for (const part of line.text.matchAll(/\S+\s*/g)) {
      chars += compact(part[0]).length;
      if (/\s$/.test(part[0])) boundaries.add(chars);
    }
    let consumed = 0;
    for (const w of line.words) {
      const last = out.at(-1);
      if (open && last && !boundaries.has(consumed) && !/^\s/.test(w.text) && !CJK.test(w.text)) {
        last.text += w.text;
        last.d = Math.max(last.d, w.t + w.d - last.t);
      } else out.push({ ...w });
      consumed += compact(w.text).length;
      open = !/\s$/.test(w.text) && !CJK.test(w.text);
    }
    return out.map((w) => ({ ...w, text: w.text.trim() })).filter((w) => w.text);
  }
  const parts = line.text.split(/\s+/).filter(Boolean);
  const tokens = parts.length === 1 && CJK.test(parts[0]) ? Array.from(parts[0]) : parts;
  // No word timing from the source: estimate it. Spreading the words over the whole gap to the next line made them
  // crawl wherever the singer pauses after a line (a held note, a break), so the line is timed from its syllables at
  // a sung pace, and only stretched to fill the gap when the gap is short.
  const weights = tokens.map(syllables);
  const total = weights.reduce((a, b) => a + b, 0);
  const gap = Math.max(line.end - line.t, 1) * 0.9; // leave a breath before the next line
  const span = Math.min(gap, Math.max(total * SYLLABLE_MS, 900));
  let t = line.t;
  return tokens.map((text, i) => {
    const d = (span * weights[i]) / total;
    const w = { t, d, text };
    t += d;
    return w;
  });
}

/** "Song (feat. X) - Remastered 2011" -> "Song" */
export const cleanTitle = (s: string) =>
  s.replace(/\s*[([](feat|ft|with)\.?\s[^)\]]*[)\]]/gi, "").replace(/\s+-\s+.*(remaster|version|edit|mix|live|mono|stereo).*$/i, "").trim();

const norm = (s: string) => cleanTitle(s).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
const firstArtist = (s: string) => s.split(",")[0].trim();

// ---------- LRCLIB ----------

type LrcLibRecord = {
  id: number;
  trackName: string;
  artistName: string;
  duration: number;
  instrumental: boolean;
  plainLyrics: string | null;
  syncedLyrics: string | null;
};
const LRCLIB = "https://lrclib.net/api";

function fromLrclib(r: LrcLibRecord): Lyrics | null {
  const id = String(r.id);
  if (r.instrumental) return { kind: "instrumental", source: "lrclib", id };
  if (r.syncedLyrics) {
    const lines = parseLrc(r.syncedLyrics);
    if (lines.length) return { kind: "synced", lines, source: "lrclib", id, wordSynced: lines.some((l) => l.words) };
  }
  if (r.plainLyrics?.trim()) return { kind: "plain", lines: r.plainLyrics.trim().split(/\r?\n/).map(tidy), source: "lrclib", id };
  return null;
}

async function lrclibJson<T>(path: string): Promise<T | null> {
  const res = await fetch(`${LRCLIB}${path}`).catch(() => null);
  return res?.ok ? res.json() : null;
}
const lrclibSearch = async (params: Record<string, string>) =>
  (await lrclibJson<LrcLibRecord[]>(`/search?${new URLSearchParams(params)}`)) ?? [];

async function lrclibFind(q: TrackQuery): Promise<Lyrics | null> {
  const duration = Math.round(q.durationMs / 1000);
  const artist = firstArtist(q.artists);
  const exact = await lrclibJson<LrcLibRecord>(
    `/get?${new URLSearchParams({ track_name: q.name, artist_name: artist, album_name: q.album, duration: String(duration) })}`,
  );
  let best = exact && fromLrclib(exact);
  if (best?.kind === "synced" || best?.kind === "instrumental") return best;
  for (const title of new Set([q.name, cleanTitle(q.name)])) {
    const ranked = (await lrclibSearch({ track_name: title, artist_name: artist }))
      .filter((r) => Math.abs(r.duration - duration) <= 4)
      .sort((a, b) => Number(!!b.syncedLyrics) - Number(!!a.syncedLyrics) || Math.abs(a.duration - duration) - Math.abs(b.duration - duration));
    for (const r of ranked) {
      const l = fromLrclib(r);
      if (l?.kind === "synced" || l?.kind === "instrumental") return l;
      best ??= l;
    }
  }
  return best;
}

// ---------- NetEase (word-level "yrc"; fetched via Rust because it has no CORS headers) ----------

type NeteaseSong = { id: number; name: string; artists: { name: string }[]; duration: number };
type NeteaseLyric = { lrc?: { lyric?: string }; yrc?: { lyric?: string }; pureMusic?: boolean; nolyric?: boolean };

async function netease<T>(path: string): Promise<T | null> {
  try {
    return JSON.parse(await invoke<string>("fetch_lyrics_source", { url: `https://music.163.com/api${path}` }));
  } catch {
    return null;
  }
}

async function neteaseSearch(query: string): Promise<NeteaseSong[]> {
  const r = await netease<{ result?: { songs?: NeteaseSong[] } }>(`/search/get?s=${encodeURIComponent(query)}&type=1&limit=12`);
  return r?.result?.songs ?? [];
}

async function neteaseLyrics(id: string): Promise<Lyrics | null> {
  const r = await netease<NeteaseLyric>(`/song/lyric?id=${id}&lv=-1&kv=-1&tv=-1&yv=-1`);
  if (!r) return null;
  if (r.pureMusic) return { kind: "instrumental", source: "netease", id };
  const yrc = r.yrc?.lyric ? dropCredits(parseYrc(r.yrc.lyric)) : [];
  if (yrc.length) return { kind: "synced", lines: yrc, source: "netease", id, wordSynced: true };
  const lrc = r.lrc?.lyric ? dropCredits(parseLrc(r.lrc.lyric)).filter((l) => l.text) : [];
  if (lrc.length) return { kind: "synced", lines: withEnds(lrc), source: "netease", id, wordSynced: false };
  return null;
}

async function neteaseFind(q: TrackQuery): Promise<Lyrics | null> {
  const title = norm(q.name);
  const artist = firstArtist(q.artists).toLowerCase();
  const songs = await neteaseSearch(`${cleanTitle(q.name)} ${firstArtist(q.artists)}`);
  const match = songs
    .filter((s) => Math.abs(s.duration - q.durationMs) <= 4000)
    .filter((s) => norm(s.name) === title || norm(s.name).startsWith(title) || title.startsWith(norm(s.name)))
    .filter((s) => s.artists.some((a) => a.name.toLowerCase().includes(artist) || artist.includes(a.name.toLowerCase())))
    .sort((a, b) => Math.abs(a.duration - q.durationMs) - Math.abs(b.duration - q.durationMs))[0];
  return match ? neteaseLyrics(String(match.id)) : null;
}

// ---------- picking, overrides, candidates ----------

const finders: Record<Source, (q: TrackQuery) => Promise<Lyrics | null>> = { lrclib: lrclibFind, netease: neteaseFind };

/** Ranks results from all sources: word-synced (if preferred) > synced > plain > instrumental, then source order. */
export function pick(results: (Lyrics | null)[], prefs: Prefs): Lyrics {
  const rank = (l: Lyrics | null) =>
    !l || l.kind === "none" ? 0
    : l.kind === "instrumental" ? 1
    : l.kind === "plain" ? 2
    : l.wordSynced && prefs.preferWordSync ? 4 : 3;
  let best: Lyrics | null = null;
  for (const l of results) if (rank(l) > rank(best)) best = l; // ties keep the earlier (preferred) source
  return best ?? { kind: "none" };
}

type Override = { source?: Origin; id?: string; offsetMs?: number };
// a loaded file's text, kept per song (the override's id is the song key)
const FILE = "helios.lyrics.file:";
export const saveLyricsFile = (key: string, text: string) => localStorage.setItem(FILE + key, text);
const OVERRIDES = "helios.lyrics.overrides.v1";
const readOverrides = (): Record<string, Override> => {
  try {
    return JSON.parse(localStorage.getItem(OVERRIDES) ?? "{}");
  } catch {
    return {};
  }
};
export const trackKey = (q: Pick<TrackQuery, "name" | "artists">) => `${q.name}|${q.artists}`;
export const getOverride = (key: string): Override => readOverrides()[key] ?? {};
export function setOverride(key: string, patch: Override | null) {
  const all = readOverrides();
  if (patch === null || ("source" in patch && patch.source !== "file")) localStorage.removeItem(FILE + key); // a file no longer used
  if (patch === null) delete all[key];
  else all[key] = { ...all[key], ...patch };
  localStorage.setItem(OVERRIDES, JSON.stringify(all));
}

export async function loadCandidate(source: Origin, id: string): Promise<Lyrics> {
  if (source === "file") return parseLyricsFile(localStorage.getItem(FILE + id) ?? "", id);
  if (source === "netease") return (await neteaseLyrics(id)) ?? { kind: "none" };
  const r = await lrclibJson<LrcLibRecord>(`/get/${id}`);
  return (r && fromLrclib(r)) ?? { kind: "none" };
}

/** Everything that might match, from every source, for the "wrong lyrics?" picker. */
export async function searchCandidates(title: string, artist: string, durationMs: number): Promise<Candidate[]> {
  const [lr, ne] = await Promise.all([
    lrclibSearch({ track_name: title, ...(artist ? { artist_name: artist } : {}) }),
    neteaseSearch(`${title} ${artist}`.trim()),
  ]);
  const all: Candidate[] = [
    ...lr.map((r) => ({
      source: "lrclib" as const,
      id: String(r.id),
      title: r.trackName,
      artist: r.artistName,
      durationMs: r.duration * 1000,
      synced: !!r.syncedLyrics,
    })),
    ...ne.map((s) => ({
      source: "netease" as const,
      id: String(s.id),
      title: s.name,
      artist: s.artists.map((a) => a.name).join(", "),
      durationMs: s.duration,
      synced: null,
    })),
  ];
  return all.sort((a, b) => Math.abs(a.durationMs - durationMs) - Math.abs(b.durationMs - durationMs)).slice(0, 30);
}

const cache = new Map<string, Promise<Lyrics>>();

export function fetchLyrics(q: TrackQuery, prefs: Prefs): Promise<Lyrics> {
  const key = trackKey(q);
  const o = getOverride(key);
  if (o.source === "file") return loadCandidate("file", key); // local and cheap; a newly loaded file must not hit a stale cache
  const cacheKey = `${key}|${o.source ?? ""}:${o.id ?? ""}|${prefs.sources.join(",")}|${prefs.preferWordSync}`;
  let hit = cache.get(cacheKey);
  if (!hit) {
    hit =
      o.source && o.id
        ? loadCandidate(o.source, o.id)
        : Promise.all(prefs.sources.map((s) => finders[s](q).catch(() => null))).then((r) => pick(r, prefs));
    hit.catch(() => cache.delete(cacheKey));
    cache.set(cacheKey, hit);
    if (cache.size > 60) cache.delete(cache.keys().next().value!); // keep memory flat in long sessions
  }
  return hit;
}
