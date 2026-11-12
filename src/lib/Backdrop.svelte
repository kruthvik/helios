<script lang="ts">
  import { onMount, untrack } from "svelte";
  import { settings, game, frozen, view } from "./settings.svelte";
  import { autoBg } from "./mood";
  import { drawBackdrop, drawRainGL, pulse, grade, vivid, hexRgb, lerpRgb, ease, type Frame, type Rgb, type Scene } from "./backdrop";
  import { ytId, loadBgFile, type Src } from "./media";
  import { rainFree } from "./rainglass";
  import { capMs } from "./vsync";
  import MediaLayer from "./MediaLayer.svelte";

  // maxFps: the miniplayer caps the background low so a game running alongside keeps the GPU
  // mv: the song's music video ids while it should be the wallpaper (with the song's clock to follow)
  let {
    colors,
    art,
    maxFps = Infinity,
    mv = null,
    playing = false,
    pos = () => 0,
    songMs = 0,
  }: { colors: readonly string[]; art: string | null; maxFps?: number; mv?: string[] | null; playing?: boolean; pos?: () => number; songMs?: number } = $props();

  // ---- your own background, or the music video: shown by MediaLayer over a still canvas ----
  let file = $state<Src | null>(null);
  let fileUrl = "";
  $effect(() => {
    if (settings.bgMode !== "media" || settings.bgMediaSrc !== "file") {
      // A blob URL pins the entire upload, including large videos, even with no media element left.
      URL.revokeObjectURL(fileUrl);
      fileUrl = "";
      file = null;
      return;
    }
    void view.bgFileRev; // a new upload
    let live = true;
    loadBgFile()
      .then((b) => {
        if (!live) return;
        URL.revokeObjectURL(fileUrl);
        fileUrl = b ? URL.createObjectURL(b) : "";
        file = b ? { kind: b.type.startsWith("video/") ? "video" : "image", url: fileUrl } : null;
      })
      .catch(() => live && (file = null));
    return () => void (live = false);
  });
  let deadMv = $state(""); // a music video that refused to embed: back to the scene
  let mvKey = $derived(mv?.join() ?? "");
  let mvOn = $derived(settings.bgVideo !== "off" && !!mvKey && deadMv !== mvKey);
  $effect(() => void (view.mvBg = mvOn)); // the page shows its "hide this video" button, and effects may step aside
  let yt = $derived(ytId(settings.bgYt));
  let deadOwn = $state(false);
  $effect(() => void (settings.bgYt, settings.bgMediaSrc, file, (deadOwn = false)));
  let media = $derived.by<Src | null>(() => {
    if (mvOn) return { kind: "yt", ids: mv!, loop: false };
    if (settings.bgMode !== "media" || deadOwn) return null;
    return settings.bgMediaSrc === "youtube" ? (yt ? { kind: "yt", ids: [yt], loop: true } : null) : file;
  });
  let sync = $derived(mvOn ? { mode: settings.bgVideo as "stretch" | "clips", clipMs: settings.bgClipSec * 1000, songMs, pos } : null);

  // One small canvas instead of a stack of animated full-window layers: soft gradients look the same
  // drawn at 1/SCALE resolution and upscaled by the GPU, but use a fraction of the GPU memory.
  // Scenes with fine lines and points (waves, stars, windows) are drawn at 1/2.5 of the display's real pixels:
  // at 1/2 they cost some 35 MB more in the GPU process, and the contour map fell to 51 fps, so it stays soft.
  // Counted in real pixels, not CSS ones: on a display scaled to 150% the old half-size canvas was stretched three
  // times, and stars came out as squares and lines as staircases.
  const SHARP = ["skyline", "retro", "orbits", "koi", "jellyfish", "sunset", "dunes", "ocean", "galaxy", "ridges", "warp", "flock", "rainglass", "papercut", "plexus"];
  const FADE_MS = 1800; // album-to-album color crossfade
  // Max = every display frame; a lower cap is every second, third... one (see vsync.ts)
  let fps = $derived(Math.min(settings.bgFps >= 120 ? Infinity : settings.bgFps, maxFps));

  let canvas = $state<HTMLCanvasElement>();
  // Auto: a scene picked from the song's colors
  let auto = $derived(settings.bgMode === "auto" ? autoBg(colors) : null);
  $effect(() => void (view.autoBg = auto ?? ""));
  // under a picture or video the canvas only shows (still) while it loads, or around a "fit" picture
  let scene0 = $derived<Frame["mode"]>(media ? "fill" : (auto ?? (settings.bgMode === "media" ? "mesh" : (settings.bgMode as Frame["mode"]))));
  let dpr = $state(devicePixelRatio);
  // The rainy window is a shader on a canvas of its own (WebGL can't share the 2D one), unless WebGL2 is missing
  let glCanvas = $state<HTMLCanvasElement>();
  let glFailed = $state(false);
  let useGl = $derived(scene0 === "rainglass" && !glFailed);
  let redrawGl: (() => void) | null = null; // a WebGL canvas only holds its picture within the frame that drew it
  let ghostAt = $state<HTMLElement>();
  // a shader costs the same at any size, so it gets more of the display's pixels than the scenes drawn by the CPU
  let SCALE = $derived(Math.max(1, (useGl ? 1.5 : SHARP.includes(scene0) ? 2.5 : 4) / dpr));
  // A new scene fades in over the last frame of the old one instead of cutting. Before the page updates, so the
  // copy is taken while the old scene's canvas is still there and at its size. GPU copy, freed after the fade.
  let shownScene = "";
  $effect.pre(() => {
    const next = scene0;
    untrack(() => {
      const prev = shownScene;
      shownScene = next;
      if (!prev || prev === next || !ctx || !canvas || !ghostAt || settings.reduceMotion || document.hidden) return;
      const from = glCanvas ?? canvas;
      if (glCanvas) redrawGl?.();
      const ghost = document.createElement("canvas");
      ghost.width = from.width;
      ghost.height = from.height;
      ghost.style.cssText = "position:absolute;inset:0;width:100%;height:100%;pointer-events:none";
      ghost.getContext("2d", { alpha: false })?.drawImage(from, 0, 0);
      ghostAt.before(ghost);
      ghost.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 700, easing: "ease-out" }).finished.finally(() => {
        ghost.remove();
        ghost.width = ghost.height = 1;
      });
    });
  });
  $effect(() => {
    void [SCALE, glCanvas];
    resize();
  });
  $effect(() => {
    if (useGl) return;
    rainFree(); // the rain shader's WebGL context is only kept while it's the scene
    redrawGl = null;
    if (scene0 !== "rainglass") glFailed = false; // picked again later, it gets another try
  });
  let grainOn = $derived(settings.grain && !game("gmNoGrain"));
  // Film grain: the noise drawn once into a canvas as faint white and black specks, which the GPU lays over the
  // background as it is. It used to be a layer blended in "overlay" mode: for that the whole background was
  // drawn into a second full-window buffer and blended on every frame, some 90 MB of GPU memory.
  const GRAIN = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.9' numOctaves='2' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E";
  let grainCanvas = $state<HTMLCanvasElement>();
  let grainTile: HTMLCanvasElement | null = null;
  let sized = $state(0); // changes with the window's size
  $effect(() => {
    void sized;
    const cv = grainCanvas;
    if (!cv) return;
    let gone = false;
    const paint = () => {
      const g = cv.getContext("2d");
      if (gone || !g || !grainTile) return;
      cv.width = innerWidth;
      cv.height = innerHeight;
      g.fillStyle = g.createPattern(grainTile, "repeat")!;
      g.fillRect(0, 0, cv.width, cv.height);
    };
    if (grainTile) paint();
    else {
      const img = new Image();
      img.onload = () => {
        const tile = document.createElement("canvas");
        tile.width = tile.height = 160;
        const g = tile.getContext("2d", { willReadFrequently: true })!;
        g.drawImage(img, 0, 0, 160, 160);
        const d = g.getImageData(0, 0, 160, 160), px = d.data;
        for (let i = 0; i < px.length; i += 4) {
          const v = (px[i] + px[i + 1] + px[i + 2]) / 382.5 - 1; // -1 darkest speck .. 1 lightest
          px[i] = px[i + 1] = px[i + 2] = v > 0 ? 255 : 0;
          px[i + 3] = Math.abs(v) * px[i + 3] * (v > 0 ? 0.05 : 0.08); // overlay lightened less than it darkened on a dim picture
        }
        g.putImageData(d, 0, 0);
        grainTile = tile;
        paint();
      };
      img.src = GRAIN;
    }
    return () => {
      gone = true;
      cv.width = cv.height = 1;
    };
  });
  let speed = $derived(settings.reduceMotion || game("gmStillBg") || frozen() ? 0 : settings.bgMotion);

  // The beat's flash of brightness. A scene that redraws every frame anyway just dims itself less on the beat,
  // which is the same picture; as a CSS filter the GPU ran an extra full-window pass on every frame for it. A
  // still scene, a capped frame rate or too little dimming to give back keep the filter.
  let selfBeat = $derived(!media && speed > 0 && fps === Infinity && settings.bgDim >= 0.3 && !["fill", "solid", "blur"].includes(scene0));

  let ctx: CanvasRenderingContext2D | null = null;
  let raf = 0;
  let timer: ReturnType<typeof setTimeout> | 0 = 0;
  let last = 0;
  let resized = false; // resizing clears the canvas: redraw on the next vsync, whatever the cap
  let animT = 0; // animation clock in seconds, advanced by speed
  let from: Rgb[] = [];
  let to: Rgb[] = [];
  let fadeAt = -Infinity;
  let artImg: HTMLImageElement | null = null;
  const scene: Scene = { W: 0, H: 0, blurred: null, blurKey: "" };

  // Settled colors return `to` itself, so the renderer can reuse its cached color strings.
  const shown = (now: number) => {
    const p = ease(Math.min(1, (now - fadeAt) / FADE_MS));
    return p >= 1 ? to : from.map((c, i) => lerpRgb(c, to[i], p));
  };

  // Under a cap, sleep until just before the next frame is due instead of waking on every vsync
  // (a 240 Hz monitor at 15 fps: 15 wake-ups a second, not 240). The rAF still lands it on a vsync.
  const schedule = (waitMs: number) => {
    if (waitMs > 12) timer = setTimeout(() => ((timer = 0), (raf = requestAnimationFrame(frame))), waitMs - 6);
    else raf = requestAnimationFrame(frame);
  };

  function frame(now: number) {
    raf = 0;
    if (document.hidden || !ctx || !canvas) return;
    // user-set cap: lower = less drawing work, Max = smoothest, drawn on the very next vsync
    const frameMs = capMs(fps);
    if (last && !resized && now - last < frameMs) return schedule(frameMs - (now - last));
    resized = false;
    animT += last ? (Math.min(100, now - last) / 1000) * speed : 0;
    last = now;
    const mode = scene0 === "blur" && !art ? "fill" : scene0;
    const cols = shown(now);
    const f: Frame = {
      mode,
      t: animT,
      colors: cols,
      k: settings.bgIntensity,
      saturation: settings.bgSaturation,
      blur: settings.bgBlur / SCALE,
      solid: settings.bgSolidFrom === "album" && cols.length ? `rgb(${cols[0].join()})` : settings.bgSolid, // the song's main color, crossfading with it
      art: artImg,
      scale: SCALE,
      dim: selfBeat ? Math.max(0, 1 - (1 - settings.bgDim) * (1 + 0.2 * pulse.beat)) : settings.bgDim,
      vignette: settings.bgVignette,
    };
    if (useGl && glCanvas) {
      const gl = glCanvas;
      redrawGl = () => void drawRainGL(gl, scene, f);
      if (!drawRainGL(gl, scene, f)) glFailed = true; // no WebGL2, or the context was lost: the 2D version takes over
    } else drawBackdrop(ctx, canvas, scene, f);
    const moving = speed > 0 && mode !== "fill" && mode !== "solid";
    if (moving || now - fadeAt < FADE_MS) schedule(frameMs);
    else last = 0;
  }
  const kick = () => {
    if (!document.hidden && !raf && !timer && ctx) raf = requestAnimationFrame(frame);
  };

  function resize() {
    if (!canvas) return;
    dpr = devicePixelRatio;
    scene.W = innerWidth;
    scene.H = innerHeight;
    const w = Math.max(1, Math.ceil(innerWidth / SCALE)), h = Math.max(1, Math.ceil(innerHeight / SCALE));
    canvas.width = useGl ? 1 : w;
    canvas.height = useGl ? 1 : h;
    if (glCanvas && (glCanvas.width !== w || glCanvas.height !== h)) {
      glCanvas.width = w;
      glCanvas.height = h;
    }
    resized = true;
    sized = innerWidth * 1e5 + innerHeight;
    clearTimeout(timer);
    timer = 0;
    kick();
  }

  // Tint from "Album color": the cover's most vivid color (the most spread between its channels), the same for
  // drawn scenes, your own media and music videos
  let tintHex = $derived.by(() => {
    if (settings.bgTintFrom !== "album" || !colors.length) return settings.bgTint;
    const chroma = (h: string) => { const c = hexRgb(h); return Math.max(...c) - Math.min(...c); };
    return colors.reduce((a, b) => (chroma(b) > chroma(a) ? b : a));
  });

  // New album colors: crossfade from whatever is on screen now.
  $effect(() => {
    const tint = hexRgb(tintHex); // tint and hue shift grade the album colors (and crossfade like a new album)
    const next = colors.map((c) => vivid(grade(hexRgb(c), settings.bgHue, tint, settings.bgTintAmount)));
    untrack(() => {
      const now = performance.now();
      from = from.length ? shown(now) : next;
      to = next;
      fadeAt = now;
      kick();
    });
  });

  // Image loading owns its handlers separately from visual settings, so a slider cannot cancel a pending cover.
  $effect(() => {
    const src = scene0 === "blur" ? art : null;
    if (!src) {
      artImg = null;
      if (scene.blurred) scene.blurred.width = scene.blurred.height = 1;
      scene.blurred = null;
      scene.blurKey = "";
      return;
    }
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => ((artImg = img), kick());
    img.src = src;
    return () => { img.onload = null; };
  });

  // Any visual setting changing needs a redraw (and may restart the loop).
  $effect(() => {
    void [scene0, settings.bgIntensity, settings.bgSaturation, settings.bgBlur, settings.bgSolid, settings.bgSolidFrom, settings.bgDim, grainOn, settings.bgVignette, speed];
    untrack(kick);
  });

  onMount(() => {
    ctx = canvas!.getContext("2d", { alpha: false });
    resize();
    addEventListener("resize", resize);
    const onVisibility = () => {
      if (!document.hidden) return kick();
      cancelAnimationFrame(raf);
      clearTimeout(timer);
      raf = timer = 0;
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      removeEventListener("resize", resize);
      document.removeEventListener("visibilitychange", onVisibility);
      cancelAnimationFrame(raf);
      clearTimeout(timer);
      URL.revokeObjectURL(fileUrl);
      file = null;
      artImg = null;
      if (scene.blurred) scene.blurred.width = scene.blurred.height = 1;
      scene.blurred = null;
      canvas!.width = canvas!.height = 1;
      ctx = null;
      rainFree();
    };
  });
</script>

<div class="backdrop" class:pulse={!media} class:cssbeat={!media && !selfBeat} aria-hidden="true">
  <canvas bind:this={canvas}></canvas>
  {#if useGl}<canvas bind:this={glCanvas}></canvas>{/if}
  <span bind:this={ghostAt} hidden></span>
  {#if media}
    <MediaLayer
      src={media}
      {sync}
      tint={tintHex}
      paused={settings.reduceMotion || game("gmStillBg") || frozen() || (mvOn ? !playing : settings.bgMotion === 0)}
      onFail={() => (mvOn ? (deadMv = mvKey) : (deadOwn = true))}
    />
  {/if}
  {#if grainOn}<canvas class="grain" bind:this={grainCanvas}></canvas>{/if}
</div>

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    z-index: 0;
    overflow: hidden;
    background: #0b0b0d;
    contain: strict;
    pointer-events: none;
  }
  canvas {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
  }
</style>
