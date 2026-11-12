<script lang="ts">
  import { onMount } from "svelte";
  import { fade, scale } from "svelte/transition";
  import { cubicOut } from "svelte/easing";
  import { embedUrl } from "./video";
  import { activeLine, fmtOffset, type Lyrics } from "./lyrics";
  import { settings, calm } from "./settings.svelte";
  import Icon from "./Icon.svelte";

  let {
    ids,
    title,
    onClose,
    onEnded,
    onUnavailable,
    onPlaying,
    lyrics,
    startMs,
    songMs,
    sync,
  }: {
    ids: string[];
    title: string;
    onClose: () => void;
    onEnded: () => void;
    onUnavailable: () => void;
    onPlaying: () => void;
    lyrics: Lyrics | null;
    startMs: number; // where the song was when the video opened
    songMs: number; // the song's length
    sync: { songMs: number | null; playing: boolean }; // written here: the matching song position, and whether the video plays
  } = $props();

  let index = $state(0);
  let frame = $state<HTMLIFrameElement>();
  let loaded = $state(false);
  let videoPlaying = $state(true); // autoplay
  const send = (func: string, args: unknown[] = []) =>
    frame?.contentWindow?.postMessage(JSON.stringify({ event: "command", func, args }), "*");

  // ---- lyrics over the video, timed to the video's own clock (YouTube reports currentTime via infoDelivery) ----
  // A video's timeline rarely matches the song's (intros, skits), so each video keeps its own offset and on/off.
  const OFF_KEY = "helios.videoLyricsOff", SHIFT_KEY = "helios.videoLyricsShift";
  const load = <T,>(k: string, d: T): T => {
    try { return JSON.parse(localStorage.getItem(k) ?? "") ?? d; } catch { return d; }
  };
  let off = $state<Record<string, true>>(load(OFF_KEY, {}));
  let shifts = $state<Record<string, number>>(load(SHIFT_KEY, {}));
  let vid = $derived(ids[index]);
  // Where the song starts inside the video. MVs usually run longer, mostly from a cold-open intro, so with no saved
  // offset the extra length (up to 8 s) counts as intro. shortcut: a guess; any +/- correction is saved per video
  // and wins. Upgrade to audio alignment only if guesses keep missing.
  let videoMs = $state(0);
  let guess = $derived(videoMs && songMs ? (videoMs - songMs > 1500 ? Math.min(videoMs - songMs, 8000) : 0) : 0);
  let shift = $derived(shifts[vid] ?? guess);
  const seeded = new Set<string>(); // videos already moved to the song's position
  let showHere = $derived(settings.videoLyrics && !off[vid]);
  function toggleHere() {
    if (off[vid]) delete off[vid];
    else off[vid] = true;
    localStorage.setItem(OFF_KEY, JSON.stringify(off));
  }
  function nudge(ms: number | null) {
    if (ms === null || Math.abs(shift + ms) < 1) delete shifts[vid];
    else shifts[vid] = shift + ms;
    localStorage.setItem(SHIFT_KEY, JSON.stringify(shifts));
  }

  let lines = $derived(lyrics?.kind === "synced" ? lyrics.lines : []);
  let vAnchor = $state(0), vAt = $state(0), now = $state(performance.now());
  // the video's position minus its offset = the song's position (shift > 0: the song starts later in the video)
  let pos = $derived(vAnchor + (videoPlaying ? Math.max(0, now - vAt) : 0) - shift);
  let cur = $derived(lines[activeLine(lines, pos)]);
  let line = $derived(cur && pos < cur.end + 400 ? cur.text : ""); // clear the caption during long breaks
  // wake exactly when the next line starts or this one ends; nothing runs in between
  $effect(() => {
    if (!showHere || !videoPlaying || !lines.length) return;
    now;
    const live = vAnchor + performance.now() - vAt - shift;
    const next = Math.min(...[lines[activeLine(lines, live) + 1]?.t, cur && cur.end + 400].filter((t): t is number => t != null && t > live));
    if (!isFinite(next)) return;
    const id = setTimeout(() => (now = performance.now()), next - live + 4);
    return () => clearTimeout(id);
  });

  // If YouTube refuses to embed this upload (errors 100/101/150/153), try the next match.
  function tryNext() {
    if (index + 1 < ids.length) {
      index += 1;
      loaded = false;
    } else onUnavailable();
  }

  onMount(() => {
    // YouTube's iframe API over postMessage: subscribe, then react to end (state 0) and errors.
    const onMessage = (e: MessageEvent) => {
      if (!/^https:\/\/www\.youtube(-nocookie)?\.com$/.test(e.origin)) return;
      try {
        const data = typeof e.data === "string" ? JSON.parse(e.data) : e.data;
        const state = data?.event === "onStateChange" ? data.info : data?.event === "infoDelivery" ? data.info?.playerState : undefined;
        if (data?.event === "infoDelivery" && data.info?.duration > 0) videoMs = data.info.duration * 1000;
        if (data?.event === "infoDelivery" && typeof data.info?.currentTime === "number") {
          vAnchor = data.info.currentTime * 1000;
          vAt = performance.now();
          // opened mid-song: jump the video to the same moment (from the very start, let the intro play)
          if (videoMs && !seeded.has(vid)) {
            seeded.add(vid);
            if (startMs > 3000) {
              vAnchor = startMs + shift;
              send("seekTo", [vAnchor / 1000, true]);
            }
          }
          sync.songMs = seeded.has(vid) ? Math.max(0, vAnchor - shift) : null;
        }
        if (data?.event === "onError") return tryNext();
        if (state === 0) onEnded();
        else if (state === 1 || state === 2) {
          if (state === 1 && !videoPlaying) onPlaying(); // the video (re)started: make sure the song isn't playing too
          videoPlaying = sync.playing = state === 1;
        }
      } catch {}
    };
    // Space pauses/plays the video even when the video itself doesn't have focus
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) return;
      if (e.key.toLowerCase() === "l" && settings.videoLyrics && lines.length) return toggleHere();
      if (e.key !== " ") return;
      e.preventDefault();
      send(videoPlaying ? "pauseVideo" : "playVideo");
    };
    window.addEventListener("message", onMessage);
    window.addEventListener("keydown", onKey);
    return () => (window.removeEventListener("message", onMessage), window.removeEventListener("keydown", onKey));
  });

  function subscribe() {
    loaded = true;
    frame?.contentWindow?.postMessage(JSON.stringify({ event: "listening", id: 1, channel: "widget" }), "*");
    if (settings.videoHd) send("setPlaybackQuality", ["hd1080"]); // deprecated by YouTube, harmless where ignored
  }
</script>

<div class="overlay" transition:fade={{ duration: 280 }} style:--size={settings.videoSize}>
  <div class="box" in:scale={{ start: 0.96, duration: 380, easing: cubicOut }}>
  <div class="frame">
    {#if !loaded}<div class="loading" aria-hidden="true"></div>{/if}
    {#key ids[index]}
      <!-- Embeds need a referrer, or YouTube refuses with "error 153" inside desktop webviews. -->
      <iframe
        bind:this={frame}
        src={embedUrl(ids[index], settings.videoHd)}
        {title}
        allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
        referrerpolicy="strict-origin-when-cross-origin"
        allowfullscreen
        onload={subscribe}
      ></iframe>
    {/key}
    {#if showHere && line}
      <!-- above YouTube's control bar; never takes clicks, so the video stays fully usable -->
      <div class="caption" aria-live="off" style:--cs={settings.videoLyricsSize}>
        <!-- the box stays put; only the words fade, so it doesn't blink at every line -->
        <span>{#key line}<span class="t" in:fade={{ duration: calm() ? 0 : 260 }}>{line}</span>{/key}</span>
      </div>
    {/if}
  </div>
  <!-- outside the video, so it never covers YouTube's own buttons -->
  <div class="side">
    <button aria-label="Close video (Esc)" title="Close (Esc)" onclick={onClose}><Icon name="close" size={16} /></button>
    {#if settings.videoLyrics && lines.length}
      <button
        class:on={showHere}
        aria-label={showHere ? "Hide lyrics on this video" : "Show lyrics on this video"}
        title="{showHere ? 'Hide' : 'Show'} lyrics on this video (L)"
        onclick={toggleHere}><Icon name="music" size={15} /></button
      >
      {#if showHere}
        <button class="step" title="Captions come in too late? Show them 0.5s sooner" onclick={() => nudge(-500)}>Earlier</button>
        <button class="val" title="This video's caption timing. Click to reset" onclick={() => nudge(null)}>{fmtOffset(-shift)}</button>
        <button class="step" title="Captions run ahead (an intro in the video)? Show them 0.5s later" onclick={() => nudge(500)}>Later</button>
      {/if}
    {/if}
  </div>
  </div>
</div>

<style>
  .overlay {
    position: fixed;
    inset: 0;
    z-index: 20;
    display: grid;
    place-items: center;
    background: rgba(0, 0, 0, 0.35);
  }
  .box {
    position: relative;
  }
  .frame {
    position: relative;
    /* largest 16:9 box that fits in --size of the window */
    width: min(calc(100vw * var(--size)), calc(100vh * var(--size) * 16 / 9));
    aspect-ratio: 16 / 9;
    border-radius: 14px;
    overflow: hidden;
    background: #000;
    box-shadow:
      0 40px 120px -20px rgba(0, 0, 0, 0.8),
      0 0 0 1px rgba(255, 255, 255, 0.06);
  }
  iframe {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    border: 0;
  }
  .loading {
    position: absolute;
    inset: 0;
    background: linear-gradient(90deg, #0a0a0a, #1a1a1a, #0a0a0a);
    background-size: 200% 100%;
    animation: shimmer 1.4s linear infinite;
  }
  @keyframes shimmer {
    to {
      background-position: -200% 0;
    }
  }
  .caption {
    position: absolute;
    left: 6%;
    right: 6%;
    bottom: 13%; /* clear of YouTube's control bar */
    display: flex;
    justify-content: center;
    pointer-events: none;
    text-align: center;
  }
  .caption > span {
    padding: 0.18em 0.6em;
    border-radius: 0.4em;
    font-size: calc(clamp(16px, 2.4vw, 34px) * var(--cs, 1));
    font-weight: 700;
    line-height: 1.25;
    letter-spacing: -0.01em;
    color: #fff;
    text-wrap: balance;
    background: rgba(0, 0, 0, 0.38);
    backdrop-filter: blur(6px);
    text-shadow: 0 1px 12px rgba(0, 0, 0, 0.7);
  }
  .side {
    /* just outside the video's top-right corner */
    position: absolute;
    top: 0;
    left: calc(100% + 10px);
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 6px;
  }
  .side button {
    display: grid;
    place-items: center;
    width: 30px;
    height: 30px;
    border-radius: 50%;
    background: rgba(255, 255, 255, 0.08);
    color: #fff;
    opacity: 0.55;
    transition:
      opacity 0.2s ease,
      background 0.2s ease;
  }
  .side button:hover,
  .side button:focus-visible,
  .side button.on {
    opacity: 1;
    background: rgba(255, 255, 255, 0.16);
  }
  .side .step {
    width: auto;
    height: 24px;
    padding: 0 9px;
    border-radius: 999px;
    font-size: 11px;
    font-weight: 600;
  }
  .side .val {
    width: auto;
    min-width: 30px;
    height: 22px;
    padding: 0 6px;
    border-radius: 11px;
    font-size: 11px;
    font-variant-numeric: tabular-nums;
  }
  /* if the window is too narrow for a side gutter, sit just above the video */
  @media (max-aspect-ratio: 16/9) {
    .side {
      top: auto;
      bottom: calc(100% + 10px);
      left: auto;
      right: 0;
      flex-direction: row-reverse;
    }
  }
</style>
