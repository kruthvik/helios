<script lang="ts">
  import { onMount } from "svelte";
  import { settings, game, frozen, view } from "./settings.svelte";
  import { autoFx } from "./mood";
  import { step, FX, type Fx, type P } from "./effects";
  import { hexRgb } from "./backdrop";
  import { capMs } from "./vsync";
  // Particles over the background, any mix of effects at once. Each effect keeps its own particles, so turning one
  // off drops every trace of it on the spot. Runs only while music plays, honours the background frame cap, and
  // stamps pre-rendered sprites (no per-particle gradients) on a half-resolution canvas, so it stays light.
  let { colors, playing, maxFps = Infinity, off = false }: { colors: readonly string[]; playing: boolean; maxFps?: number; off?: boolean } = $props();

  // Half resolution on a plain display; a scaled-up one (150%, 200%) gets the same share of its real pixels, or
  // particles were stretched three and four times and looked soft.
  let SCALE = 2;
  let canvas = $state<HTMLCanvasElement>();
  let ctx: CanvasRenderingContext2D | null = null;
  // Auto: a mix of effects picked (and each tuned) from the song's colors; the sliders still scale it all
  let auto = $derived(settings.fxAuto ? new Map(autoFx(colors).map((a) => [a.fx, a])) : null);
  $effect(() => void (view.autoFx = auto ? [...auto.keys()] : []));
  let active = $derived<Fx[]>(off || settings.reduceMotion || game("gmNoFx") ? [] : auto ? [...auto.keys()] : FX.filter((f) => settings.fxList.includes(f)));
  let running = $derived(playing && !frozen()); // a focused game pauses the effects like a paused song
  let fps = $derived(Math.min(settings.bgFps >= 120 ? Infinity : Math.max(30, settings.bgFps), maxFps));
  let palette = $derived(
    settings.fxColor === "tint" ? shades(settings.fxTint)
    : settings.fxColor === "album" && colors.length ? [...colors]
    : ["#ffffff"],
  );
  // a tint as three shades (as is, lighter, deeper) so the particles don't look flat
  function shades(hex: string) {
    const c = hexRgb(hex);
    const toHex = (v: number[]) => "#" + v.map((x) => Math.round(Math.max(0, Math.min(255, x))).toString(16).padStart(2, "0")).join("");
    return [toHex(c), toHex(c.map((x) => x + (255 - x) * 0.45)), toHex(c.map((x) => x * 0.7))];
  }

  const lists = new Map<Fx, P[]>();
  const spare = new Map<Fx, P[]>();
  let raf = 0, timer: ReturnType<typeof setTimeout> | 0 = 0, last = 0, clock = 0, W = 0, H = 0;
  const sprites = new Map<string, HTMLCanvasElement>();

  // one 64px sprite per (kind, color), drawn once and stamped with drawImage
  const NOTES = ["♪", "♫", "♩", "♬"];
  function sprite(kind: P["kind"], color: string, glyph = "") {
    const key = kind + color + glyph;
    let s = sprites.get(key);
    if (s) return s;
    s = document.createElement("canvas");
    s.width = s.height = 64;
    const g = s.getContext("2d")!;
    const [R, G, B] = hexRgb(color).map(Math.round);
    const c = (a: number) => `rgba(${R},${G},${B},${a})`;
    const radial = (stops: [number, string][]) => {
      const r = g.createRadialGradient(32, 32, 0, 32, 32, 32);
      for (const [o, col] of stops) r.addColorStop(o, col);
      g.fillStyle = r;
      g.fillRect(0, 0, 64, 64);
    };
    if (kind === "note") {
      // a music note with a soft glow in its color
      g.font = "600 40px 'Segoe UI Symbol', 'Segoe UI', sans-serif";
      g.textAlign = "center";
      g.textBaseline = "middle";
      g.shadowColor = c(0.9);
      g.shadowBlur = 10;
      g.fillStyle = `rgb(${(R + 510) / 3},${(G + 510) / 3},${(B + 510) / 3})`; // a pale tint reads on any background
      g.fillText(glyph, 32, 34);
    } else if (kind === "lantern") {
      // paper lantern: warm halo, a body lit from the flame at its base
      const [wr, wg, wb] = [(R + 255) / 2, (G + 160) / 2, (B + 70) / 2].map(Math.round); // pulled toward warm
      const w = (a: number) => `rgba(${wr},${wg},${wb},${a})`;
      const halo = g.createRadialGradient(32, 38, 0, 32, 38, 32);
      halo.addColorStop(0, w(0.55));
      halo.addColorStop(0.45, w(0.16));
      halo.addColorStop(1, w(0));
      g.fillStyle = halo;
      g.fillRect(0, 0, 64, 64);
      const body = g.createLinearGradient(0, 22, 0, 44);
      body.addColorStop(0, w(0.55));
      body.addColorStop(0.75, w(0.95));
      body.addColorStop(1, "rgba(255,245,215,1)");
      g.fillStyle = body;
      g.beginPath();
      g.moveTo(25, 22);
      g.lineTo(39, 22);
      g.quadraticCurveTo(42, 33, 38.5, 44);
      g.lineTo(25.5, 44);
      g.quadraticCurveTo(22, 33, 25, 22);
      g.fill();
    } else if (kind === "seed") {
      // a dandelion seed: a fine stalk and a little parachute of filaments, each with a soft tip
      g.strokeStyle = "rgba(255,255,255,.85)";
      g.fillStyle = "rgba(255,255,255,.9)";
      g.lineWidth = 1.2;
      g.beginPath();
      g.moveTo(32, 34);
      g.lineTo(32, 60);
      for (let k = 0; k < 11; k++) {
        const a = Math.PI * (1.05 + 0.9 * (k / 10));
        g.moveTo(32, 34);
        g.lineTo(32 + Math.cos(a) * 24, 34 + Math.sin(a) * 24);
      }
      g.stroke();
      for (let k = 0; k < 11; k++) {
        const a = Math.PI * (1.05 + 0.9 * (k / 10));
        g.beginPath();
        g.arc(32 + Math.cos(a) * 24, 34 + Math.sin(a) * 24, 1.6, 0, Math.PI * 2);
        g.fill();
      }
      g.fillStyle = c(0.9);
      g.beginPath();
      g.ellipse(32, 60, 1.6, 3, 0, 0, Math.PI * 2);
      g.fill();
    } else if (kind === "orb") radial([[0, c(0.32)], [0.62, c(0.26)], [0.8, c(0.14)], [1, c(0)]]); // soft disc, a bokeh light
    else if (kind === "glow") radial([[0, "rgba(255,255,255,.95)"], [0.12, c(0.9)], [0.4, c(0.25)], [1, c(0)]]);
    else if (kind === "dot") radial([[0, "rgba(255,255,255,.95)"], [0.35, c(0.7)], [1, c(0)]]);
    else if (kind === "star") {
      radial([[0, "rgba(255,255,255,1)"], [0.1, c(0.85)], [0.35, c(0.18)], [1, c(0)]]);
      // the four-point glint of a bright star
      g.globalCompositeOperation = "lighter";
      for (const [w, h] of [[30, 1.6], [1.6, 30]]) {
        const l = g.createRadialGradient(32, 32, 0, 32, 32, 30);
        l.addColorStop(0, "rgba(255,255,255,.9)");
        l.addColorStop(1, "rgba(255,255,255,0)");
        g.fillStyle = l;
        g.fillRect(32 - w, 32 - h, w * 2, h * 2);
      }
    } else {
      // bubble: clear body, a rim that shifts from the album color to a pale complement (thin-film shimmer)
      radial([[0, c(0)], [0.68, c(0.05)], [0.88, c(0.32)], [0.97, "rgba(255,255,255,.55)"], [1, c(0)]]);
      g.globalCompositeOperation = "lighter";
      const sheen = g.createLinearGradient(8, 56, 56, 8);
      sheen.addColorStop(0, "rgba(255,120,220,0)");
      sheen.addColorStop(0.5, "rgba(120,220,255,.16)");
      sheen.addColorStop(1, "rgba(255,240,140,0)");
      g.fillStyle = sheen;
      g.beginPath();
      g.arc(32, 32, 30, 0, Math.PI * 2);
      g.fill();
      g.globalCompositeOperation = "source-over";
      // window highlights
      g.fillStyle = "rgba(255,255,255,.7)";
      g.beginPath();
      g.ellipse(21, 19, 7, 3.5, -0.75, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = "rgba(255,255,255,.35)";
      g.beginPath();
      g.arc(44, 45, 2.2, 0, Math.PI * 2);
      g.fill();
    }
    sprites.set(key, s);
    return s;
  }

  function draw(fx: Fx, ps: P[]) {
    if (!ctx) return;
    ctx.globalCompositeOperation = fx === "bubbles" || fx === "snow" || fx === "petals" || fx === "confetti" || fx === "butterflies" || fx === "notes" || fx === "balloons" || fx === "planes" || fx === "leaves" || fx === "seeds" ? "source-over" : "lighter";
    ctx.lineCap = "round";
    for (const p of ps) {
      if (p.a <= 0.01) continue;
      const col = p.c < 0 ? "#ffffff" : palette[p.c % palette.length];
      ctx.globalAlpha = Math.min(1, p.a);
      if (p.kind === "trail") {
        // a streak covering the last `tail` seconds of motion. Only the few rockets and shooting stars get a
        // gradient; sparks (up to 1600) are a plain stroke, plus a white core while they're fresh and bright.
        const tl = p.tail ?? 0.06;
        const tx = p.x - p.vx * tl, ty = p.y - p.vy * tl;
        if (p.rocket || fx === "meteors" || (p.c < 0 && fx === "stars")) {
          const g = ctx.createLinearGradient(p.x, p.y, tx, ty);
          g.addColorStop(0, "#fff");
          g.addColorStop(0.25, col);
          g.addColorStop(1, "rgba(0,0,0,0)");
          ctx.strokeStyle = g;
        } else ctx.strokeStyle = col;
        ctx.lineWidth = p.r;
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(tx, ty);
        ctx.stroke();
        if (!p.rocket && p.c >= 0 && p.a > 0.6) {
          ctx.strokeStyle = "#fff";
          ctx.lineWidth = p.r * 0.5;
          ctx.beginPath();
          ctx.moveTo(p.x, p.y);
          ctx.lineTo(p.x - p.vx * tl * 0.3, p.y - p.vy * tl * 0.3);
          ctx.stroke();
        }
        continue;
      }
      if (p.kind === "petal" || p.kind === "confetti") {
        // a spinning shape; squashing one axis with the spin reads as fluttering / flipping in 3D
        const rot = p.rot ?? 0;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(rot);
        ctx.fillStyle = p.kind === "petal" && palette.length === 1 ? "#ffc8d8" : col; // white petals look odd: soft pink
        if (p.kind === "petal") {
          ctx.scale(1, 0.45 + 0.55 * Math.abs(Math.sin(rot * 1.3)));
          ctx.beginPath();
          ctx.ellipse(0, 0, p.r, p.r * 0.62, 0, 0, Math.PI * 2);
          ctx.fill();
        } else {
          ctx.scale(1, Math.cos(rot * 2.1));
          ctx.fillRect(-p.r, -p.r * 0.5, p.r * 2, p.r);
        }
        ctx.restore();
        continue;
      }
      if (p.kind === "fly") {
        // butterfly: wings beat (squash across the body), upper wings bigger, a pale spot on each
        const flap = 0.2 + 0.8 * Math.abs(Math.sin(clock * 9 + p.seed));
        const r = p.r, wing = palette.length === 1 ? "#cfe0ff" : col; // white wings look flat: a pale blue
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot ?? 0);
        ctx.fillStyle = wing;
        for (const side of [-1, 1]) {
          ctx.beginPath();
          ctx.ellipse(r * 0.12, side * r * 0.5 * flap, r * 0.42, r * 0.52 * flap, side * 0.35, 0, Math.PI * 2);
          ctx.ellipse(-r * 0.32, side * r * 0.36 * flap, r * 0.3, r * 0.36 * flap, -side * 0.5, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.fillStyle = "rgba(255,255,255,.4)";
        for (const side of [-1, 1]) {
          ctx.beginPath();
          ctx.ellipse(r * 0.2, side * r * 0.6 * flap, r * 0.13, r * 0.15 * flap, 0, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.fillStyle = "rgba(25,20,30,.75)";
        ctx.beginPath();
        ctx.ellipse(0, 0, r * 0.5, r * 0.08, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
        continue;
      }
      if (p.kind === "leaf") {
        // a leaf: pointed oval with a center vein, squashing as it turns over in the air
        const r = p.r, rot = p.rot ?? 0;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(rot);
        ctx.scale(1, 0.45 + 0.55 * Math.abs(Math.cos(rot * 1.7)));
        ctx.fillStyle = palette.length === 1 ? ["#e0823d", "#c9532c", "#e6b54a"][Math.floor(p.seed) % 3] : col; // white leaves: autumn instead
        ctx.beginPath();
        ctx.moveTo(-r, 0);
        ctx.quadraticCurveTo(0, -r * 0.62, r, 0);
        ctx.quadraticCurveTo(0, r * 0.62, -r, 0);
        ctx.fill();
        ctx.strokeStyle = "rgba(0,0,0,.28)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(-r * 1.2, 0);
        ctx.lineTo(r * 0.8, 0);
        ctx.stroke();
        ctx.restore();
        continue;
      }
      if (p.kind === "seed") {
        const r = p.r * 1.6;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot ?? 0);
        ctx.drawImage(sprite("seed", col), -r, -r, r * 2, r * 2);
        ctx.restore();
        continue;
      }
      if (p.kind === "balloon") {
        // a balloon on a wavy string, with a knot and a window highlight
        const r = p.r;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot ?? 0);
        ctx.strokeStyle = "rgba(255,255,255,.35)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(0, r * 1.1);
        ctx.bezierCurveTo(r * 0.35 * Math.sin(clock * 2 + p.seed), r * 2, -r * 0.35, r * 2.6, r * 0.15 * Math.sin(clock * 1.6 + p.seed), r * 3.4);
        ctx.stroke();
        ctx.fillStyle = palette.length === 1 ? "#ff8fa3" : col; // white balloons look odd: a soft pink
        ctx.beginPath();
        ctx.ellipse(0, 0, r * 0.84, r, 0, 0, Math.PI * 2);
        ctx.moveTo(-r * 0.14, r * 1.12);
        ctx.lineTo(r * 0.14, r * 1.12);
        ctx.lineTo(0, r * 0.94);
        ctx.fill();
        ctx.fillStyle = "rgba(255,255,255,.45)";
        ctx.beginPath();
        ctx.ellipse(-r * 0.32, -r * 0.4, r * 0.16, r * 0.28, -0.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
        continue;
      }
      if (p.kind === "plane") {
        // a paper dart seen from above: a pale top wing and a shaded one in the album color, a crease down the middle
        const r = p.r;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot ?? 0);
        ctx.fillStyle = "#f6f3ec";
        ctx.beginPath();
        ctx.moveTo(r, 0);
        ctx.lineTo(-r, -r * 0.62);
        ctx.lineTo(-r * 0.55, 0);
        ctx.fill();
        ctx.fillStyle = palette.length === 1 ? "#c9d3e6" : col;
        ctx.beginPath();
        ctx.moveTo(r, 0);
        ctx.lineTo(-r * 0.55, 0);
        ctx.lineTo(-r, r * 0.62);
        ctx.fill();
        ctx.strokeStyle = "rgba(0,0,0,.25)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(r, 0);
        ctx.lineTo(-r * 0.55, 0);
        ctx.stroke();
        ctx.restore();
        continue;
      }
      if (p.kind === "note") {
        const r = p.r;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot ?? 0);
        ctx.drawImage(sprite("note", col, NOTES[Math.floor(p.seed) % NOTES.length]), -r, -r, r * 2, r * 2);
        ctx.restore();
        continue;
      }
      if (p.kind === "lantern") {
        const r = p.r * 2.6; // the sprite includes the halo around the body
        ctx.drawImage(sprite("lantern", col), p.x - r, p.y - r, r * 2, r * 2);
        continue;
      }
      const r = p.kind === "bubble" ? p.r * (1 + 0.035 * Math.sin(clock * 2.3 + p.seed)) : p.r; // bubbles breathe
      ctx.drawImage(sprite(p.kind, fx === "snow" ? "#ffffff" : col), p.x - r, p.y - r, r * 2, r * 2);
    }
  }

  function frame(now: number) {
    raf = 0;
    if (!ctx) return;
    // traces of anything switched off go right away
    for (const fx of lists.keys()) if (!active.includes(fx)) {
      lists.delete(fx);
      spare.delete(fx);
    }
    if (!active.length) return void ((canvas!.width = canvas!.height = 1), (last = 0)); // all off: give the memory back
    if (canvas!.width === 1) resize();
    const paused = !running || document.hidden;
    const frameMs = capMs(fps);
    if (!paused && last && now - last < frameMs) return schedule(frameMs - (now - last));
    const dt = !paused && last ? Math.min(0.1, (now - last) / 1000) * settings.fxSpeed : 0;
    last = paused ? 0 : now;
    clock += dt;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas!.width, canvas!.height);
    ctx.setTransform(1 / SCALE, 0, 0, 1 / SCALE, 0, 0);
    for (const fx of active) {
      const a = auto?.get(fx);
      const env = { W, H, amount: settings.fxAmount * (a?.amount ?? 1), size: settings.fxSize * (a?.size ?? 1), colors: palette.length, output: spare.get(fx) };
      // paused: just repaint what's there (so a switched-off effect still vanishes), no stepping
      const prior = lists.get(fx) ?? [];
      const ps = paused ? prior : step(fx, prior, dt * (a?.speed ?? 1), clock, env, Math.random);
      if (!paused) {
        // The step has finished reading prior; empty it now so dead particles are not retained.
        prior.length = 0;
        spare.set(fx, prior);
      }
      lists.set(fx, ps);
      draw(fx, ps);
    }
    ctx.globalAlpha = 1;    if (!paused) schedule(frameMs);
  }
  const schedule = (waitMs: number) => {
    if (waitMs > 12) timer = setTimeout(() => ((timer = 0), (raf = requestAnimationFrame(frame))), waitMs - 6);
    else raf = requestAnimationFrame(frame);
  };
  const kick = () => {
    if (!raf && !timer && ctx) raf = requestAnimationFrame(frame);
  };

  function resize() {
    if (!canvas) return;
    W = innerWidth;
    H = innerHeight;
    if (!active.length) return; // stays 1×1 until an effect is on
    SCALE = Math.max(1, 2 / devicePixelRatio);
    canvas.width = Math.ceil(W / SCALE);
    canvas.height = Math.ceil(H / SCALE);
  }

  $effect(() => {
    void [active, auto, running, settings.fxAmount, settings.fxSpeed, settings.fxSize]; // any of these may restart the loop
    if (timer) {
      clearTimeout(timer);
      timer = 0;
    } // a change applies on the very next frame, not after a capped wait
    kick();
  });
  $effect(() => {
    void palette;
    for (const s of sprites.values()) s.width = s.height = 0; // free the GPU memory now, not at some later GC
    sprites.clear(); // new album colors
  });

  onMount(() => {
    ctx = canvas!.getContext("2d");
    resize();
    addEventListener("resize", resize);
    document.addEventListener("visibilitychange", kick);
    kick();
    return () => {
      removeEventListener("resize", resize);
      document.removeEventListener("visibilitychange", kick);
      cancelAnimationFrame(raf);
      clearTimeout(timer);
      for (const s of sprites.values()) s.width = s.height = 1;
      sprites.clear();
      lists.clear();
      spare.clear();
      canvas!.width = canvas!.height = 1;
      ctx = null;
    };
  });
</script>

<canvas class="fx" class:off={!active.length} bind:this={canvas} aria-hidden="true"></canvas>

<style>
  .fx {
    position: fixed;
    inset: 0;
    width: 100%;
    height: 100%;
    z-index: 0;
    pointer-events: none;
  }
  .off {
    display: none;
  }
</style>
