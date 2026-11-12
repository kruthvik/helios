<script lang="ts">
  import { onMount } from "svelte";
  import { settings, view } from "./settings.svelte";
  import { wallUrl, mvTarget, mvRate, type Src } from "./media";

  // A picture, GIF, video or YouTube video as the background, graded with CSS (GPU) instead of per-pixel work:
  // saturation and color shift as a filter, the tint as a "color" blend layer, dim and vignette as one overlay.
  // With `sync`, a muted music video follows the song: stretched over it, or cut into clips.
  let {
    src,
    tint,
    paused,
    sync = null,
    onFail,
  }: {
    src: Src;
    tint: string;
    paused: boolean;
    sync?: { mode: "stretch" | "clips"; clipMs: number; songMs: number; pos: () => number } | null;
    onFail: () => void;
  } = $props();

  let shown = $state(false); // fades in once something is actually on screen (no YouTube spinner or black frame)
  // YouTube draws its own title bar, "More videos" and pause screen inside the player (out of our reach) at the
  // start, on pause and at the end: the video shows only once it has played clear of them, and hides before pausing
  let clear = $state(false);
  // When YouTube pauses or ends on its own (a stall, the end of the video), its pause button and "More videos"
  // are on screen at once: the video is cut then, not faded, or they showed through for the length of the fade.
  let snap = $state(false);
  let clearTimer: ReturnType<typeof setTimeout>;
  let lastState: number | null = null;
  function ytState(s: number) {
    if (s === lastState) return;
    lastState = s;
    clearTimeout(clearTimer);
    if (s === 1) clearTimer = setTimeout(() => ((snap = false), (clear = true)), 3000);
    else if (s !== 3) ((snap = clear), (clear = false)); // buffering at a clip cut shows nothing worth hiding
  }
  let hidden = $state(document.hidden);
  // YouTube picks its stream from the player's pixel size: a player covering a 4K window pulls 1440p–2160p, which
  // costs ~100 MB of decoder memory and re-buffers on every clip cut. Lay the player out at 1080p physical and
  // scale it up on the GPU instead: under dim, grain and drift a background can't tell the difference.
  let win = $state({ w: innerWidth, h: innerHeight, dpr: devicePixelRatio });
  // Close to the memory budget, 720p: the decoder's frame pool is the largest thing left to give back.
  let ytW = $derived(Math.round((view.lowMem ? 1280 : 1920) / win.dpr));
  let ytScale = $derived(
    settings.bgMediaFit === "contain" ? Math.min(win.w / ytW, win.h / (ytW * 0.5625)) : Math.max(win.w / ytW, win.h / (ytW * 0.5625)) * 1.12,
  );
  let stop = $derived(paused || hidden);

  // ---- local video ----
  let video = $state<HTMLVideoElement>();
  $effect(() => {
    if (!video) return;
    video.playbackRate = settings.bgMediaRate;
    stop ? video.pause() : video.play().catch(() => {});
  });

  // ---- YouTube, over the iframe's postMessage API (as VideoPlayer does) ----
  let frame = $state<HTMLIFrameElement>();
  let index = $state(0);
  let ids = $derived(src.kind === "yt" ? src.ids : []);
  let idsKey = $derived(ids.join());
  $effect(() => {
    void idsKey; // a different video: start over
    index = 0;
    shown = false;
    clear = false;
    lastState = null;
    videoMs = 0;
  });
  let videoMs = 0;
  const send = (func: string, args: unknown[] = []) => frame?.contentWindow?.postMessage(JSON.stringify({ event: "command", func, args }), "*");
  const want = () => (sync && videoMs ? mvTarget(sync.mode, sync.pos(), sync.songMs, videoMs, sync.clipMs) % videoMs : null);
  function resync() {
    const w = want();
    if (w !== null) send("seekTo", [w / 1000, true]);
  }
  function speed() {
    send("setPlaybackRate", [sync ? (sync.mode === "stretch" ? mvRate(sync.songMs, videoMs) : 1) : settings.bgMediaRate]);
  }
  function subscribe() {
    frame?.contentWindow?.postMessage(JSON.stringify({ event: "listening", id: 1, channel: "widget" }), "*");
    send("mute");
  }
  // play / pause with the song (or game mode, or a hidden window); jump back in step on resuming
  $effect(() => {
    if (src.kind !== "yt") return;
    if (stop) {
      snap = false;
      clear = false; // fade out first, then pause: YouTube's pause screen never shows
      clearTimeout(clearTimer);
      lastState = null;
      const t = setTimeout(() => send("pauseVideo"), 850);
      return () => clearTimeout(t);
    }
    resync();
    send("playVideo");
  });
  $effect(() => void (settings.bgMediaRate, sync?.mode, src.kind === "yt" && videoMs && speed()));
  // clips: cut exactly on each clip boundary of the song's clock (a seek, not a reload)
  $effect(() => {
    if (src.kind !== "yt" || !sync || sync.mode !== "clips" || stop) return;
    const { clipMs, pos } = sync;
    let timer: ReturnType<typeof setTimeout>;
    const next = () => (timer = setTimeout(() => (resync(), next()), clipMs - (pos() % clipMs) + 15));
    next();
    return () => clearTimeout(timer);
  });

  onMount(() => {
    const onVis = () => (hidden = document.hidden);
    const onResize = () => (win = { w: innerWidth, h: innerHeight, dpr: devicePixelRatio });
    addEventListener("resize", onResize);
    const onMessage = (e: MessageEvent) => {
      if (e.source !== frame?.contentWindow) return;
      try {
        const d = typeof e.data === "string" ? JSON.parse(e.data) : e.data;
        if (d?.event === "onError") return void (index + 1 < ids.length ? ((index += 1), (videoMs = 0)) : onFail());
        const info = d?.event === "infoDelivery" ? d.info : null;
        const state = d?.event === "onStateChange" ? d.info : info?.playerState;
        if (info?.duration > 0 && !videoMs) ((videoMs = info.duration * 1000), speed(), stop ? send("pauseVideo") : resync());
        if (state === 1) shown = true;
        if (typeof state === "number") ytState(state);
        if (state === 0) sync ? (resync(), send("playVideo")) : send("playVideo"); // ended: the song (or loop) goes on
        // drifted (a seek in the song, a rounded playback rate): put it back in step
        const w = want();
        if (w !== null && !stop && typeof info?.currentTime === "number" && Math.abs(info.currentTime * 1000 - w) > 1800) resync();
      } catch {}
    };
    addEventListener("message", onMessage);
    document.addEventListener("visibilitychange", onVis);
    return () => {
      removeEventListener("message", onMessage);
      removeEventListener("resize", onResize);
      document.removeEventListener("visibilitychange", onVis);
      clearTimeout(clearTimer);
      if (video) {
        // Detach the resource before the element is discarded so its decoder and buffers can close now.
        video.pause();
        video.removeAttribute("src");
        video.load();
      }
    };
  });

  // Saturation, color shift and tint are one filter on the media (below). The tint used to be a layer of its own in
  // "color" blend mode over the whole background, which had the GPU keep and blend a second full-window copy of it.
  let graded = $derived(settings.bgSaturation !== 1 || settings.bgHue !== 0 || settings.bgTintAmount > 0);
  let filter = $derived(
    [
      graded && "url(#helios-grade)",
      settings.bgMediaBlur && `blur(${settings.bgMediaBlur}px)`,
    ].filter(Boolean).join(" ") || "none",
  );
  let drift = $derived(settings.bgMediaDrift && settings.bgMotion > 0);
</script>

{#if graded}
  <svg class="defs" aria-hidden="true">
    <filter id="helios-grade" color-interpolation-filters="sRGB" x="0" y="0" width="1" height="1">
      <feColorMatrix type="saturate" values={String(settings.bgSaturation)} />
      <feColorMatrix type="hueRotate" values={String(settings.bgHue)} result="g" />
      <feFlood flood-color={tint} flood-opacity={settings.bgTintAmount} result="t" />
      <feBlend mode="color" in="t" in2="g" />
      <feComposite in2="g" operator="in" />
    </filter>
  </svg>
{/if}
<div class="media" class:on={shown && (src.kind !== "yt" || clear)} class:snap style:filter style:--pad="{-settings.bgMediaBlur * 2}px">
  <div
    class="move"
    class:drift
    class:contain={settings.bgMediaFit === "contain"}
    style:animation-duration="{60 / Math.max(0.1, settings.bgMotion)}s"
    style:animation-play-state={stop ? "paused" : "running"}
  >
    {#if src.kind === "image"}
      <img src={src.url} alt="" onload={() => (shown = true)} onerror={onFail} />
    {:else if src.kind === "video"}
      <video bind:this={video} src={src.url} autoplay muted loop playsinline onplaying={() => (shown = true)} onerror={onFail}></video>
    {:else}
      {#key ids[index]}
        <iframe
          bind:this={frame}
          class="yt"
          src={wallUrl(ids[index], src.kind === "yt" && src.loop)}
          title="Background video"
          tabindex="-1"
          style:width="{ytW}px"
          style:height="{ytW * 0.5625}px"
          style:transform="translate(-50%, -50%) scale({ytScale})"
          allow="autoplay; encrypted-media"
          referrerpolicy="strict-origin-when-cross-origin"
          onload={subscribe}
        ></iframe>
      {/key}
    {/if}
  </div>
</div>
<div
  class="shade"
  style:background-color="rgba(0,0,0,{settings.bgDim})"
  style:background-image="radial-gradient(ellipse 99% 85% at 30% 40%, transparent, rgba(0,0,0,{settings.bgVignette}))"
></div>

<style>
  .defs {
    position: absolute;
    width: 0;
    height: 0;
  }
  .media,
  .shade {
    position: absolute;
    inset: 0;
    pointer-events: none;
  }
  .media {
    inset: var(--pad, 0); /* blur softens the edges: bleed past them */
    overflow: hidden;
    opacity: 0;
    transition: opacity 0.8s ease;
  }
  .media.on {
    opacity: 1;
  }
  .media.snap {
    transition: none;
  }
  .move {
    position: absolute;
    inset: 0;
  }
  .drift {
    animation: drift ease-in-out infinite alternate;
  }
  @keyframes drift {
    from {
      transform: scale(1.06) translate(-1.5%, -1%);
    }
    to {
      transform: scale(1.14) translate(1.5%, 1.2%);
    }
  }
  img,
  video {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
  .contain img,
  .contain video {
    object-fit: contain;
  }
  /* 16:9 player at 1080p, scaled (inline) to cover the window, a touch more to crop YouTube's edges and letterboxing */
  .yt {
    position: absolute;
    left: 50%;
    top: 50%;
    border: 0;
  }
</style>
