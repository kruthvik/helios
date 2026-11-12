import { invoke } from "@tauri-apps/api/core";
import { cleanTitle } from "./lyrics";

export type YtItem = { id: { videoId: string }; snippet: { title: string; channelTitle: string; officialArtist?: boolean; lengthS?: number } };

// Uploads that aren't the official video (unless the track itself is e.g. a live or remix version).
const NOT_OFFICIAL =
  /\b(lyrics?|lyric video|letras?|audio|visuali[sz]er|karaoke|cover|reaction|instrumental|8d|slowed|sped up|nightcore|remix|live|fan made|loop|teaser|trailer|dance practice|behind the scenes|making film|choreography|ai[ -]enhanced|upscaled?|60 ?fps|recap|livestream|studio session|interview|explained|documentary|podcast)\b/i;
// TV shows, award nights and concerts: the song performed live, not its video
const STAGE = /@|\b(got talent|awards?|concert|festival|tonight show|snl|tiny desk|performance video|on stage)\b/i;
// "Official Video" in its usual spellings, M/V included, and the big non-English ones
const OFFICIAL = /\b(official (4k |hd )?(music )?video|music video|official mv|m\/?v|video ?oficial|videoclip( oficial)?|clip officiel|offizielles musikvideo)\b/i;
// channels of labels that post their artists' videos (HYBE LABELS, DEL Records, JYP Entertainment, SMTOWN…)
const LABEL = /(labels?|records|entertainment|smtown|1thek)$/;
const OWN = /^(the)?\u0000(vevo|official|music|tv|explicit|band|channel)?$/;

const decode = (s: string) =>
  s.replace(/&amp;/g, "&").replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">");
const words = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
const squash = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
// the song's own name, without "(feat. …)", "(Explicit Ver.)", "(강남스타일)" or " - Remastered": videos rarely carry them
const core = (name: string) => words(name.replace(/\s*[([][^)\]]*[)\]]/g, "").replace(/\s+-\s+.*$/, "")) || words(cleanTitle(name));
// the whole title inside, or (long titles) at least 3 of every 4 of its words: "Bzrp Music Sessions, Vol. 53" ≈ "BZRP Music Sessions #53"
function titleIn(t: string, title: string) {
  if (` ${t} `.includes(` ${title} `)) return true;
  const want = title.split(" ");
  if (want.length < 4) return false;
  const have = new Set(t.split(" "));
  return want.filter((w) => have.has(w)).length / want.length >= 0.75;
}

/**
 * Ranks likely official music videos, best first (empty = none). Several are kept because some refuse embedding.
 * Accepted: uploads from the artist's own channel, their VEVO, or a YouTube "Official Artist Channel" that look like a
 * video ("Official Video" / "M/V", or simply "Artist - Song", which is how many artists title theirs), and a label's
 * channel when it says "Official MV" and runs about as long as the song. Re-uploads by anyone else don't count.
 */
export function rankVideos(items: YtItem[], track: { name: string; artists: string; durationMs?: number }, max = 3): string[] {
  const title = core(track.name);
  const artists = track.artists.split(",").map((a) => a.trim()).filter(Boolean);
  const songS = (track.durationMs ?? 0) / 1000;
  const scored: [number, string][] = [];
  for (const item of items) {
    const raw = decode(item.snippet.title);
    const t = words(raw);
    const channel = squash(item.snippet.channelTitle);
    if (!title || !titleIn(t, title)) continue;
    const bad = raw.match(NOT_OFFICIAL)?.[0];
    if (bad && !new RegExp(`\\b${bad}\\b`, "i").test(track.name)) continue;
    if (STAGE.test(raw)) continue;
    const named = artists.some((a) => ` ${t} `.includes(` ${words(a)} `));
    // the artist's own channel: their name, maybe with "the" / "official" / "music"… (not a fan page like "Drake Hub")
    const byArtist = artists.some((a) => OWN.test(channel.replace(squash(a), "\u0000")));
    const vevo = channel.endsWith("vevo");
    const marked = OFFICIAL.test(raw);
    const len = item.snippet.lengthS ?? 0;
    // an MV runs from a little shorter than the song (radio edit) to a few minutes longer (intro, skit, credits)
    const fits = (lo: number, hi: number) => !songS || !len || (len >= songS - lo && len <= songS + hi);
    let score: number;
    if (byArtist || vevo || (item.snippet.officialArtist && named)) {
      // the artist's channel also posts audio and art tracks (titled just "Song"): it must look like a video
      if (!(marked || vevo || named) || !fits(25, songS + 120)) continue;
      // an untagged "Artist - Song" as long as the song to the second is its audio upload; videos run longer
      if (!marked && !vevo && songS && len && Math.abs(len - songS) < 6) continue;
      score = (byArtist || vevo ? 3 : 1) + (marked ? 2 : 0) + (vevo ? 1 : 0); // their own channel beats a verified stranger's
    } else if (LABEL.test(channel) && marked && named && fits(15, 150)) score = 1;
    else continue;
    scored.push([score, item.id.videoId]);
  }
  return scored.sort((a, b) => b[0] - a[0]).slice(0, max).map(([, id]) => id);
}

// ---- lookup with caching (keyless YouTube search runs in Rust; see youtube_search) ----

const CACHE = "helios.videos.v4"; // v4: wider matching (M/V, labels, "Artist - Song"), so earlier misses get another look
type Cached = Record<string, { ids: string[]; at: number }>;
const MONTH = 30 * 24 * 3600 * 1000;
const MAX_ENTRIES = 2000;

const readCache = (): Cached => {
  try {
    return JSON.parse(localStorage.getItem(CACHE) ?? "{}");
  } catch {
    return {};
  }
};

/** [] = no official video; undefined = not looked up yet. Misses are cached too. */
export function cachedVideos(key: string): string[] | undefined {
  const hit = readCache()[key];
  return hit && Date.now() - hit.at < MONTH ? hit.ids : undefined;
}

export const searchQuery = (track: { name: string; artists: string }) => `${track.artists.split(",")[0]} ${cleanTitle(track.name)} official music video`;

export async function findVideos(key: string, track: { name: string; artists: string; durationMs?: number }): Promise<string[]> {
  const cached = cachedVideos(key);
  if (cached) return cached;
  const ids = rankVideos(await invoke<YtItem[]>("youtube_search", { query: searchQuery(track) }), track);
  const all = readCache();
  all[key] = { ids, at: Date.now() };
  const keys = Object.keys(all);
  if (keys.length > MAX_ENTRIES) for (const k of keys.slice(0, keys.length - MAX_ENTRIES)) delete all[k];
  localStorage.setItem(CACHE, JSON.stringify(all));
  return ids;
}

export const embedUrl = (id: string, hd = false) =>
  `https://www.youtube-nocookie.com/embed/${id}?` +
  new URLSearchParams({
    autoplay: "1", rel: "0", modestbranding: "1", playsinline: "1", iv_load_policy: "3", enablejsapi: "1", color: "white",
    ...(hd && { vq: "hd1080" }), // unofficial and often ignored; YouTube mostly picks quality from player size
  });
