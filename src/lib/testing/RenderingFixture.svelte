<script lang="ts">
  import { onMount, tick } from "svelte";
  import Lyrics from "$lib/Lyrics.svelte";
  import Backdrop from "$lib/Backdrop.svelte";
  import { settings, FONTS, view } from "$lib/settings.svelte";
  import { drawBackdrop } from "$lib/backdrop";
  import { saveBgFile } from "$lib/media";
  import type { Lyrics as LyricsData } from "$lib/lyrics";

  const params = new URLSearchParams(location.search);
  const part = params.get("part") ?? "both";
  const count = Math.max(1, Math.min(2000, Number(params.get("lines") ?? 160)));
  const scale = Number(params.get("scale") ?? 1.5);
  const colors = ["#326e7b", "#583b76", "#849a61", "#9a545a"];
  Object.assign(settings, {
    bgMode: params.get("bg") ?? "mesh", bgMotion: params.has("still") ? 0 : 1,
    bgVideo: "off", bgFps: 60, grain: !params.has("noGrain"), uiScale: scale,
    lyricsMode: params.get("mode") ?? "kinetic", lyricsSize: Number(params.get("size") ?? 48),
    lyricsMotion: params.get("motion") ?? "spring", lyricsEdge: params.get("edge") ?? "none",
    lyricsWidth: 900, lyricsAlign: "left", lyricsGlow: true, layout: "lyrics-right",
  });
  view.focused = true;
  const text = ["The light moves slowly through the open window", "Another line of words to sing along tonight", "We keep the rhythm and the colors just the same", "静かな夜の空に 音楽が流れている", "A long-held note, with punctuation and a pause"];
  const initialLyrics: LyricsData = {
    kind: "synced", source: "file", id: "rendering-audit", wordSynced: true,
    lines: Array.from({ length: count }, (_, i) => {
      const t = i * 3000, words = text[i % text.length].split(" ");
      return { t, end: t + 2800, text: words.join(" "), words: words.map((word, k) => ({ t: t + k * 250, d: 250, text: word + (k < words.length - 1 ? " " : "") })) };
    }),
  };
  let lyrics = $state.raw<LyricsData | null>(initialLyrics);
  let anchorMs = $state(12500), anchorAt = $state(performance.now());
  let playing = $state(!params.has("paused"));
  let showLyrics = $state(part === "lyrics" || part === "both");
  let showBackground = $state(part === "bg" || part === "both");
  const art = "data:image/svg+xml," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="640" height="640"><rect width="640" height="640" fill="#326e7b"/><circle cx="420" cy="220" r="220" fill="#583b76"/></svg>');
  function seek(ms: number) { anchorMs = ms; anchorAt = performance.now(); }
  onMount(() => {
    const api = {
      ready: true, settings, tick, initialLyrics, drawBackdrop,
      get lyrics() { return lyrics; },
      async replace(next: LyricsData | null) { lyrics = next; await tick(); },
      async uploadBackground() {
        await saveBgFile(new Blob([decodeURIComponent(art.slice(art.indexOf(",") + 1))], { type: "image/svg+xml" }));
        settings.bgMediaSrc = "file"; settings.bgMode = "media"; view.bgFileRev++;
        await tick();
      },
      async set(patch: Partial<typeof settings>) { Object.assign(settings, patch); await tick(); },
      async seek(ms: number) { seek(ms); await tick(); },
      async pause(value = true) { anchorMs += playing ? performance.now() - anchorAt : 0; anchorAt = performance.now(); playing = !value; await tick(); },
      async show(lyr: boolean, bg: boolean) { showLyrics = lyr; showBackground = bg; await tick(); },
      stats() {
        return { nodes: document.querySelectorAll("*").length, words: document.querySelectorAll(".word,.w").length, letters: document.querySelectorAll(".ch").length, lines: document.querySelectorAll(".line").length,
          heap: (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize,
          canvases: [...document.querySelectorAll("canvas")].map(c => ({ w: c.width, h: c.height, bytes: c.width * c.height * 4 })),
          viewport: { w: innerWidth, h: innerHeight, dpr: devicePixelRatio } };
      },
    };
    Object.assign(window, { renderAudit: api });
    return () => { delete (window as Window & { renderAudit?: unknown }).renderAudit; };
  });
</script>

{#if showBackground}<Backdrop {colors} {art} {playing} />{/if}
<div class="fixture" style:--s={settings.uiScale} style:--accent={colors[0]} style:--song={colors[0]} style:font-family={FONTS[settings.font]}>
  {#if showLyrics}
    <div class="lyrics-area">
      <Lyrics {lyrics} {anchorMs} {anchorAt} {playing} offsetMs={0} trackOffsetMs={0} chromeHidden={true} onSeek={seek} onNudge={() => {}} onFix={() => {}} />
    </div>
  {/if}
</div>

<style>
  :global(html,body){margin:0;height:100%;overflow:hidden;background:#0b0b0d;color:#f5f5f7;-webkit-font-smoothing:antialiased;user-select:none}
  :global(button){background:none;border:none;color:inherit;font:inherit;cursor:pointer;padding:0}
  .fixture{position:relative;z-index:1;height:100vh;letter-spacing:-.005em}
  .lyrics-area{position:absolute;top:50px;bottom:40px;left:12%;right:12%;max-width:1100px;margin:auto}
</style>
