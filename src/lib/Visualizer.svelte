<script lang="ts">
  import { onMount } from "svelte";
  import { settings, game, calm, view } from "./settings.svelte";
  import { hexRgb, pulse } from "./backdrop";

  // Audio bands along the bottom of the window, over the background. The bands come from the Rust side, which
  // reads what Windows is playing (Spotify's own player is DRM-protected, so the page can't read its audio).
  // Draws only while sound comes in or the bars are still settling; nothing runs in silence.
  // lift: in TV layout the player bar's height, so it stands on the bar instead of hiding behind it
  let { colors, lift = 0 }: { colors: readonly string[]; lift?: number } = $props();

  const SCALE = 2; // half resolution: soft shapes don't need more
  let canvas = $state<HTMLCanvasElement>();
  let ctx: CanvasRenderingContext2D | null = null;
  let on = $derived(settings.vizOn && !calm() && !game("gmNoFx"));
  let palette = $derived(settings.vizColor === "custom" ? [settings.vizTint, settings.vizTint] : colors.length ? [...colors] : ["#ffffff"]);

  const BANDS = 48;
  const target = new Float32Array(BANDS), level = new Float32Array(BANDS), peak = new Float32Array(BANDS);
  let raf = 0, last = 0, heard = 0, W = 0, H = 0, bassAvg = 0, beat = 0, shown = -1;
  // the background swells with the beat (a CSS variable it reads: scale and brightness, both cheap to animate)
  function setBeat(v: number) {
    const r = Math.round(v * 100) / 100;
    pulse.beat = r;
    if (r === shown) return;
    // set on the background itself: on the page root it restyled every element, every frame
    const el = document.querySelector<HTMLElement>(".backdrop");
    if (el) el.style.setProperty("--beat", String((shown = r)));
  }

  // Each band against its own recent peak: music has far less energy up high, so with one scale for all the
  // treble half of the screen barely moved. The floor (a share of the loudest band) keeps hiss from being blown up.
  const norm = new Float32Array(BANDS).fill(48);
  function onBands(b: number[]) {
    const gain = settings.vizGain;
    let loud = 0;
    for (let i = 0; i < BANDS; i++) loud = Math.max(loud, b[i] ?? 0);
    for (let i = 0; i < BANDS; i++) {
      const v = b[i] ?? 0;
      norm[i] = Math.max(v, norm[i] * 0.995); // eases back down over a few seconds
      target[i] = Math.min(1, (v / Math.max(norm[i], loud * 0.3, 24)) ** 1.15 * 0.9 * gain);
    }
    heard = performance.now();
    if (!raf) raf = requestAnimationFrame(frame);
  }

  // one smooth curve through the band levels (quadratic through midpoints): no corners, no jitter
  function curve(g: CanvasRenderingContext2D, ys: Float32Array, w: number, base: number, h: number, dir: 1 | -1) {
    const x = (i: number) => ((i + 0.5) / BANDS) * w, y = (i: number) => base - dir * ys[i] * h;
    g.moveTo(0, y(0));
    for (let i = 0; i < BANDS - 1; i++) g.quadraticCurveTo(x(i), y(i), (x(i) + x(i + 1)) / 2, (y(i) + y(i + 1)) / 2);
    g.lineTo(w, y(BANDS - 1));
  }

  const soft = new Float32Array(BANDS);
  let across: CanvasGradient | null = null, acrossW = 0;
  let acrossPalette: readonly string[] | null = null;
  let fade: CanvasGradient | null = null, fadeH = 0, fadeMirror = false;
  function frame(now: number) {
    raf = 0;
    if (!ctx || !canvas) return;
    const dt = last ? Math.min(0.05, (now - last) / 1000) : 1 / 60;
    last = now;
    if (now - heard > 150) target.fill(0); // sound stopped: everything settles down
    // fast rise, slower easy fall (fluid rather than twitchy); the smoothing slider stretches the fall
    const fall = 9 - 6.5 * settings.vizSmooth;
    let alive = false;
    for (let i = 0; i < BANDS; i++) {
      const k = target[i] > level[i] ? Math.min(1, dt * 28) : Math.min(1, dt * fall);
      level[i] += (target[i] - level[i]) * k;
      peak[i] = Math.max(level[i], peak[i] - dt * 0.45);
      if (level[i] > 0.004 || peak[i] > 0.004) alive = true;
    }
    for (let i = 0; i < BANDS; i++) soft[i] = (level[Math.max(0, i - 1)] + level[i] * 2 + level[Math.min(BANDS - 1, i + 1)]) / 4;
    // the beat: how far the bass jumps above its recent average (kicks, not a steady hum), fast in, slow out
    const bass = (level[0] + level[1] + level[2] + level[3] + level[4] + level[5]) / 6;
    bassAvg += (bass - bassAvg) * Math.min(1, dt * 1.5);
    const kick = Math.max(0, Math.min(1, (bass - bassAvg * 0.9) * 3));
    beat += (kick - beat) * Math.min(1, dt * (kick > beat ? 30 : 5));
    setBeat(settings.vizPulse ? beat * settings.vizPulseAmount : 0);
    const w = canvas.width, h = canvas.height, g = ctx;
    g.globalCompositeOperation = "source-over";
    g.globalAlpha = 1;
    g.clearRect(0, 0, w, h);
    // across: the album's colors (or the custom one); up and down: fading into the page
    if (!across || acrossW !== w || acrossPalette !== palette) {
      across = g.createLinearGradient(0, 0, w, 0);
      const gradient = across;
      palette.forEach((c, i) => gradient.addColorStop(palette.length > 1 ? i / (palette.length - 1) : 0, c));
      acrossW = w;
      acrossPalette = palette;
    }
    g.fillStyle = g.strokeStyle = across;
    const style = settings.vizStyle;
    if (style === "wave") {
      g.beginPath();
      curve(g, soft, w, h, h * 0.92, 1);
      g.lineTo(w, h);
      g.lineTo(0, h);
      g.closePath();
      g.globalAlpha = 0.55;
      g.fill();
      g.globalAlpha = 1;
      g.lineJoin = "round";
      for (const [lw, a] of [[7, 0.18], [2.2, 0.95]]) {
        // a soft halo, then the crisp bright line on top
        g.lineWidth = lw;
        g.globalAlpha = a;
        g.beginPath();
        curve(g, soft, w, h, h * 0.92, 1);
        g.stroke();
      }
    } else {
      const mirror = style === "mirror", base = mirror ? h / 2 : h, reach = mirror ? h * 0.48 : h * 0.94;
      const slot = w / BANDS, bw = Math.max(1.5, slot * 0.62), r = Math.min(bw / 2, 4);
      g.beginPath();
      for (let i = 0; i < BANDS; i++) {
        const x = i * slot + (slot - bw) / 2, bh = Math.max(1.5, level[i] * reach);
        g.roundRect(x, base - bh, bw, mirror ? bh * 2 : bh + r, r);
      }
      g.globalAlpha = 0.9;
      g.fill();
      // peak caps drifting down after each hit
      g.beginPath();
      for (let i = 0; i < BANDS; i++) {
        if (peak[i] < 0.02) continue;
        const x = i * slot + (slot - bw) / 2, py = base - peak[i] * reach - 4;
        g.rect(x, py, bw, 2);
        if (mirror) g.rect(x, base + peak[i] * reach + 2, bw, 2);
      }
      g.globalAlpha = 0.75;
      g.fill();
    }
    // fade the shapes out toward the page (and toward the middle line's far ends in Mirror)
    g.globalCompositeOperation = "destination-in";
    g.globalAlpha = 1;
    const mirror = style === "mirror";
    if (!fade || fadeH !== h || fadeMirror !== mirror) {
      fade = g.createLinearGradient(0, 0, 0, h);
      if (mirror) {
        fade.addColorStop(0, "rgba(0,0,0,0)");
        fade.addColorStop(0.5, "rgba(0,0,0,1)");
        fade.addColorStop(1, "rgba(0,0,0,0)");
      } else {
        fade.addColorStop(0, "rgba(0,0,0,.35)");
        fade.addColorStop(0.55, "rgba(0,0,0,1)");
        fade.addColorStop(1, "rgba(0,0,0,.55)");
      }
      fadeH = h;
      fadeMirror = mirror;
    }
    g.fillStyle = fade;
    g.fillRect(0, 0, w, h);
    if (alive) raf = requestAnimationFrame(frame);
    else {
      last = 0;
      setBeat(0);
    }
  }

  function resize() {
    if (!canvas) return;
    W = innerWidth;
    H = innerHeight * settings.vizHeight;
    canvas.width = Math.ceil(W / SCALE);
    canvas.height = Math.max(1, Math.ceil(H / SCALE));
  }
  $effect(() => {
    void settings.vizHeight;
    resize();
    if (!raf && ctx) raf = requestAnimationFrame(frame); // redraw at the new size
  });

  // the pulse styles only exist while it's in use (an idle filter on the background would still cost a GPU pass)
  $effect(() => {
    const pulse = on && settings.vizPulse;
    document.documentElement.classList.toggle("beat", pulse);
    return () => document.documentElement.classList.remove("beat");
  });

  // capture runs only while the visualizer is on
  $effect(() => {
    if (!on) return;
    let stopped = false;
    let stop = () => {};
    (async () => {
      try {
        const { invoke, Channel } = await import("@tauri-apps/api/core");
        const ch = new Channel<number[]>();
        ch.onmessage = (b) => !stopped && onBands(b);
        await invoke("viz_start", { onBands: ch });
        view.vizError = "";
        stop = () => void invoke("viz_stop").catch(() => {});
        if (stopped) stop();
      } catch (e) {
        view.vizError = String(e);
      }
    })();
    return () => {
      stopped = true;
      stop();
      target.fill(0);
      setBeat(0);
    };
  });

  onMount(() => {
    ctx = canvas!.getContext("2d");
    resize();
    addEventListener("resize", resize);
    return () => {
      removeEventListener("resize", resize);
      cancelAnimationFrame(raf);
      canvas!.width = canvas!.height = 1;
      across = fade = null;
      acrossPalette = null;
      ctx = null;
    };
  });
</script>

<canvas class="viz" class:off={!on} bind:this={canvas} style:height="{settings.vizHeight * 100}vh" style:bottom="{lift}px" style:opacity={settings.vizOpacity} aria-hidden="true"></canvas>

<style>
  .viz {
    position: fixed;
    left: 0;
    right: 0;
    bottom: 0;
    width: 100%;
    z-index: 0;
    pointer-events: none;
    transition: opacity 0.4s ease;
  }
  .off {
    display: none;
  }
  /* not under a picture or video (the canvas is covered there), and never the grain */
  :global(html.beat .backdrop.pulse > canvas:not(.grain)) {
    transform: scale(calc(1 + var(--beat, 0) * 0.02));
  }
  /* a moving scene brightens itself as it draws (Backdrop.svelte); only a still one needs the filter */
  :global(html.beat .backdrop.cssbeat > canvas:not(.grain)) {
    filter: brightness(calc(1 + var(--beat, 0) * 0.2));
  }
</style>
