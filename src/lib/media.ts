// Custom backgrounds: one uploaded picture / GIF / video kept in IndexedDB (too big for localStorage), and YouTube
// links. Plus the timeline maths that keeps a music-video wallpaper in step with the song.

export type Src = { kind: "image" | "video"; url: string } | { kind: "yt"; ids: string[]; loop: boolean };

/** The video id from any usual YouTube link (watch, youtu.be, shorts, embed, live) or a bare id; "" if none. */
export function ytId(s: string): string {
  s = s.trim();
  if (/^[\w-]{11}$/.test(s)) return s;
  const m = s.match(/(?:youtu\.be\/|[?&]v=|\/(?:shorts|embed|live|v)\/)([\w-]{11})/);
  return m ? m[1] : "";
}

/** A muted, chrome-less embed for wallpaper use; `loop` repeats a single video. */
export const wallUrl = (id: string, loop: boolean) =>
  `https://www.youtube-nocookie.com/embed/${id}?` +
  new URLSearchParams({
    autoplay: "1", mute: "1", controls: "0", disablekb: "1", fs: "0", rel: "0", modestbranding: "1",
    playsinline: "1", iv_load_policy: "3", enablejsapi: "1", ...(loop && { loop: "1", playlist: id }),
  });

const open = () =>
  new Promise<IDBDatabase>((ok, no) => {
    const r = indexedDB.open("helios", 1);
    r.onupgradeneeded = () => r.result.createObjectStore("files");
    r.onsuccess = () => ok(r.result);
    r.onerror = () => no(r.error);
  });
async function tx<T>(mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  return new Promise((ok, no) => {
    const r = run(db.transaction("files", mode).objectStore("files"));
    r.onsuccess = () => (ok(r.result), db.close());
    r.onerror = () => (no(r.error), db.close());
  });
}
export const saveBgFile = (f: Blob) => tx("readwrite", (s) => s.put(f, "bg"));
export const loadBgFile = () => tx<Blob | undefined>("readonly", (s) => s.get("bg"));
export const clearBgFile = () => tx("readwrite", (s) => s.delete("bg"));

/**
 * Where a music video should be (ms) for a song position.
 * stretch: the whole video spread over the song (playback rate = video / song length, YouTube allows 0.25–2×).
 * clips: `clipMs` excerpts at normal speed, cut together out of order (a coprime stride visits every part of the
 * video once before repeating), skipping the first and last 5% (titles, credits).
 */
export function mvTarget(mode: "stretch" | "clips", songPos: number, songMs: number, videoMs: number, clipMs: number) {
  if (mode === "stretch") return songPos * mvRate(songMs, videoMs);
  const margin = videoMs * 0.05, span = videoMs - 2 * margin - clipMs;
  if (span <= 0) return songPos % videoMs;
  const n = Math.max(1, Math.floor(span / clipMs) + 1); // clips that fit
  let stride = Math.max(1, Math.round(n * 0.618));
  while (gcd(stride, n) !== 1) stride++;
  const k = Math.floor(songPos / clipMs);
  return margin + ((k * stride + 1) % n) * (span / Math.max(1, n - 1)) + (songPos - k * clipMs);
}
export const mvRate = (songMs: number, videoMs: number) => (songMs > 0 ? Math.min(2, Math.max(0.25, videoMs / songMs)) : 1);
const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);
