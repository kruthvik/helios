<script lang="ts">
  import { fade, fly } from "svelte/transition";
  import { cubicOut } from "svelte/easing";
  import { activeLine, type Line, type Lyrics } from "./lyrics";
  import { settings, calm } from "./settings.svelte";
  import Icon from "./Icon.svelte";
  import { decoded } from "./image";

  type Track = { name: string; artists: string; album: string; cover: string | null };
  let {
    track,
    ready,
    playing,
    anchorMs,
    anchorAt,
    duration,
    lyrics,
    offsetMs,
    onTogglePlay,
    onPrev,
    onNext,
    onSeek,
    onPlayHere,
    onExpand,
  }: {
    track: Track | null;
    ready: boolean;
    playing: boolean;
    anchorMs: number;
    anchorAt: number;
    duration: number;
    lyrics: Lyrics | null;
    offsetMs: number;
    onTogglePlay: () => void;
    onPrev: () => void;
    onNext: () => void;
    onSeek: (ms: number) => void;
    onPlayHere: () => void;
    onExpand: () => void;
  } = $props();

  let lines: Line[] = $derived(lyrics?.kind === "synced" ? lyrics.lines.filter((l) => l.text) : []);
  let active = $state(-1);
  let fadeMs = $derived(calm() || settings.lyricsMotion === "instant" ? 0 : 700);

  // No per-frame clock here: wake up exactly when the next line starts, so a game keeps the CPU and GPU.
  $effect(() => {
    const ls = lines;
    if (!settings.miniLyrics || !ls.length) return;
    let timer: ReturnType<typeof setTimeout>;
    const update = () => {
      const pos = anchorMs + (playing ? performance.now() - anchorAt : 0) + offsetMs;
      active = activeLine(ls, pos);
      const nextT = ls[active + 1]?.t;
      if (playing && nextT != null) timer = setTimeout(update, nextT - pos + 4);
    };
    update();
    return () => clearTimeout(timer);
  });

  // swap the cover only once the new image is decoded, and crossfade (no blank frame between covers)
  let shownCover = $state<string | undefined>();
  $effect(() => {
    const c = track?.cover;
    if (!c) return void (shownCover = undefined);
    decoded(c).then(() => track?.cover === c && (shownCover = c));
  });
  let cur = $derived(lines[active]);
  let next = $derived(lines[active + 1]);
  let fallback = $derived(
    !lyrics ? "" : lyrics.kind === "plain" ? "Lyrics aren't synced for this song" : lyrics.kind === "instrumental" ? "Instrumental" : lyrics.kind === "none" ? "No lyrics found" : "",
  );

  function seekAt(e: MouseEvent) {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    onSeek(((e.clientX - r.left) / r.width) * duration);
  }
</script>

<div class="mini" data-tauri-drag-region style:--wash={settings.miniWash} style:--ms={settings.miniTextSize}>
  {#if !ready || !track}
    <div class="row empty" data-tauri-drag-region>
      <span data-tauri-drag-region>{ready ? "Playing on another device" : "Connecting…"}</span>
      {#if ready}<button class="chip" onclick={onPlayHere}>Play here</button>{/if}
      <button class="small" aria-label="Back to full player (P)" title="Full player (P)" onclick={onExpand}><Icon name="expand" size={15} /></button>
    </div>
  {:else}
    <div class="row" data-tauri-drag-region>
      <div class="art">
        {#key shownCover}
          {#if shownCover}<img src={shownCover} alt="Cover art for {track.album || track.name}" in:fade={{ duration: 400 }} out:fade={{ duration: 400 }} />{/if}
        {/key}
      </div>
      <div class="meta" data-tauri-drag-region>
        <b data-tauri-drag-region title={track.name}>{track.name}</b>
        <span data-tauri-drag-region title={track.artists}>{track.artists}</span>
      </div>
      <div class="ctl">
        <button aria-label="Previous" onclick={onPrev}><Icon name="prev" size={17} /></button>
        <button class="play" aria-label={playing ? "Pause" : "Play"} onclick={onTogglePlay}><Icon name={playing ? "pause" : "play"} size={17} /></button>
        <button aria-label="Next" onclick={onNext}><Icon name="next" size={17} /></button>
      </div>
      <div class="extra">
        <button
          class="small"
          class:on={settings.miniLyrics}
          aria-label={settings.miniLyrics ? "Hide lyrics" : "Show lyrics"}
          title="Lyrics (L)"
          onclick={() => (settings.miniLyrics = !settings.miniLyrics)}><Icon name="music" size={14} /></button
        >
        <button class="small" aria-label="Back to full player (P)" title="Full player (P)" onclick={onExpand}><Icon name="expand" size={14} /></button>
      </div>

      <!-- Progress is a CSS animation restarted on each SDK event: zero JavaScript while it plays. -->
      <button class="bar" aria-label="Seek" onclick={seekAt}>
        {#key `${anchorAt}:${playing}:${duration}`}
          <i
            style:--from={duration ? Math.min(1, anchorMs / duration) : 0}
            style:animation-duration="{Math.max(0, duration - anchorMs)}ms"
            style:animation-play-state={playing ? "running" : "paused"}
          ></i>
        {/key}
      </button>
    </div>

    {#if settings.miniLyrics}
      <div class="lyr" class:center={settings.miniCenter} data-tauri-drag-region>
        {#if lines.length}
          {#key active}
            <!-- old line drifts up and fades while the new one rises in, in the same spot: no blank gap between -->
            <div
              class="now"
              in:fly={{ y: 10, duration: fadeMs, easing: cubicOut }}
              out:fly={{ y: -10, duration: fadeMs * 0.6, easing: cubicOut }}
              data-tauri-drag-region
            >
              <p class="cur" data-tauri-drag-region>{cur?.text ?? "♪"}</p>
              {#if next && settings.miniNext}<p class="nxt" data-tauri-drag-region>{next.text}</p>{/if}
            </div>
          {/key}
        {:else}
          <p class="nxt" data-tauri-drag-region>{fallback || "Finding lyrics…"}</p>
        {/if}
      </div>
    {/if}
  {/if}
</div>

<style>
  .mini {
    position: fixed;
    inset: 0;
    z-index: 1;
    display: flex;
    flex-direction: column;
    /* a soft dark wash keeps text readable over any album colors */
    background: linear-gradient(180deg, rgba(0, 0, 0, calc(var(--wash) * 0.43)), rgba(0, 0, 0, var(--wash)));
    color: #fff;
  }
  .row {
    position: relative;
    display: grid;
    grid-template-columns: 60px minmax(0, 1fr) auto auto;
    align-items: center;
    gap: 12px;
    height: 92px;
    padding: 0 12px 0 16px;
    box-sizing: border-box;
    flex-shrink: 0;
  }
  .empty {
    display: flex;
    gap: 10px;
    font-size: 0.85rem;
    color: rgba(255, 255, 255, 0.7);
  }
  .empty span {
    flex: 1;
  }
  .chip {
    padding: 0.4rem 0.85rem;
    border-radius: 999px;
    background: #fff;
    color: #000;
    font-size: 0.78rem;
    font-weight: 650;
  }
  .art {
    width: 60px;
    height: 60px;
    border-radius: 10px;
    overflow: hidden;
    background: rgba(255, 255, 255, 0.08);
    box-shadow: 0 6px 18px rgba(0, 0, 0, 0.45);
    display: grid;
  }
  .art img {
    grid-area: 1 / 1;
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
  .meta {
    display: flex;
    flex-direction: column;
    gap: 3px;
    min-width: 0;
  }
  .meta b,
  .meta span {
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
  .meta b {
    font-size: 0.92rem;
    font-weight: 700;
    letter-spacing: -0.01em;
  }
  .meta span {
    font-size: 0.78rem;
    color: rgba(255, 255, 255, 0.62);
  }
  .ctl {
    display: flex;
    align-items: center;
    gap: 2px;
  }
  .ctl button {
    display: grid;
    place-items: center;
    width: 32px;
    height: 32px;
    border-radius: 50%;
    color: rgba(255, 255, 255, 0.85);
    transition: color 0.15s, background 0.15s, transform 0.15s;
  }
  .ctl button:hover {
    color: #fff;
    background: rgba(255, 255, 255, 0.1);
  }
  .ctl .play {
    width: 38px;
    height: 38px;
    background: #fff;
    color: #000;
  }
  .ctl .play:hover {
    background: #fff;
    transform: scale(1.06);
  }
  .ctl button:active {
    transform: scale(0.94);
  }
  .extra {
    display: flex;
    flex-direction: column;
    gap: 2px;
    opacity: 0.4;
    transition: opacity 0.2s;
  }
  .mini:hover .extra {
    opacity: 1;
  }
  .small {
    display: grid;
    place-items: center;
    width: 26px;
    height: 26px;
    border-radius: 7px;
    color: rgba(255, 255, 255, 0.7);
    transition: color 0.15s, background 0.15s;
  }
  .small:hover {
    color: #fff;
    background: rgba(255, 255, 255, 0.1);
  }
  .small.on {
    color: var(--accent);
  }

  .bar {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    height: 10px; /* easy to hit; the visible line is thinner */
    cursor: pointer;
  }
  .bar::before,
  .bar i {
    content: "";
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    height: 3px;
    transition: height 0.15s;
  }
  .bar::before {
    background: rgba(255, 255, 255, 0.12);
  }
  .bar i {
    background: var(--accent);
    transform-origin: left;
    animation-name: fill;
    animation-timing-function: linear;
    animation-fill-mode: both;
  }
  .bar:hover::before,
  .bar:hover i {
    height: 5px;
  }
  @keyframes fill {
    from {
      transform: scaleX(var(--from));
    }
    to {
      transform: scaleX(1);
    }
  }

  .lyr {
    flex: 1;
    display: grid;
    padding: 10px 18px 14px;
    min-height: 0;
  }
  .now {
    grid-area: 1 / 1; /* old and new lines crossfade in place */
    display: flex;
    flex-direction: column;
    justify-content: center;
    gap: 4px;
    min-width: 0;
  }
  .cur,
  .nxt {
    margin: 0;
    overflow: hidden;
    text-wrap: balance;
  }
  .center {
    text-align: center;
  }
  .center .nxt {
    align-self: stretch;
  }
  .cur {
    font-size: calc(1.02rem * var(--ms));
    font-weight: 750;
    line-height: 1.25;
    letter-spacing: -0.01em;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
    text-shadow: 0 2px 14px rgba(0, 0, 0, 0.5);
  }
  .nxt {
    font-size: calc(0.8rem * var(--ms));
    font-weight: 600;
    color: rgba(255, 255, 255, 0.42);
    white-space: nowrap;
    text-overflow: ellipsis;
    align-self: center;
  }
</style>
