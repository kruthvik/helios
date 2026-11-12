// Particle effects over the background: pure state stepping (drawing lives in Effects.svelte).
export type Fx = "bubbles" | "fireflies" | "snow" | "fireworks" | "stars" | "petals" | "rain" | "embers" | "confetti" | "notes" | "butterflies" | "lanterns" | "sparkles" | "meteors" | "orbs" | "balloons" | "planes" | "leaves" | "seeds";
export const FX: Fx[] = ["orbs", "stars", "rain", "snow", "petals", "leaves", "seeds", "confetti", "bubbles", "fireflies", "embers", "lanterns", "butterflies", "notes", "sparkles", "meteors", "balloons", "planes", "fireworks"];
export type P = {
  kind: "glow" | "orb" | "balloon" | "plane" | "leaf" | "seed" | "bubble" | "dot" | "star" | "trail" | "petal" | "confetti" | "note" | "fly" | "lantern";
  x: number; y: number; vx: number; vy: number;
  r: number; // draw radius (trail: line width)
  a: number; // alpha this frame
  c: number; // palette index
  life: number; ttl: number; seed: number;
  z?: number; // depth 0..1 (snow) / brightness class (stars)
  tail?: number; // trail: seconds of motion the streak covers
  rocket?: boolean;
  burst?: "peony" | "ring" | "willow" | "crackle";
  popY?: number; // bubbles burst when they rise past this
  drag?: number; grav?: number; // sparks
  rot?: number; vr?: number; // petals, confetti: spin angle and speed
};
export type Env = { W: number; H: number; amount: number; size: number; colors: number; output?: P[] };

const MAX_SPARKS = 1600;
export const spawnCount = (fx: Fx, amount: number) =>
  Math.round(amount * { bubbles: 18, fireflies: 30, snow: 120, fireworks: 0, stars: 170, petals: 34, rain: 140, embers: 45, confetti: 60, notes: 22, butterflies: 9, lanterns: 18, sparkles: 40, meteors: 12, orbs: 11, balloons: 12, planes: 5, leaves: 22, seeds: 26 }[fx]);

// fade in over `inS`, out over the last `outS` of a particle's life
const fade = (p: P, inS: number, outS: number) => Math.max(0, Math.min(1, p.life / inS, (p.ttl - p.life) / outS));

export function step(fx: Fx, ps: P[], dt: number, t: number, e: Env, rnd: () => number): P[] {
  // The renderer alternates two arrays; keep ordering and random calls identical to an allocating step.
  const out = e.output ?? [];
  if (out === ps) throw new Error("Particle output must not alias its input");
  out.length = 0;
  const { W, H, size } = e;
  const n = spawnCount(fx, e.amount);
  const color = () => Math.floor(rnd() * e.colors);
  const base = (o: Partial<P>): P => ({ kind: "glow", x: 0, y: 0, vx: 0, vy: 0, r: 4, a: 0, c: color(), life: 0, ttl: 10, seed: rnd() * 100, ...o });

  // top up the field gradually so a new effect eases in instead of appearing all at once
  if (fx !== "fireworks") {
    let live = 0; // bubble droplets don't count (counted in place: this runs every frame)
    for (const p of ps) if (p.kind !== "dot" || fx === "snow") live++;
    let budget = Math.max(1, Math.ceil(n * dt * 0.8));
    const first = live === 0 && (fx === "stars" || fx === "snow" || fx === "rain" || fx === "lanterns"); // a sky, snowfall, shower or lantern festival starts full
    for (let k = live; k < n && (first || budget-- > 0); k++) {
      if (fx === "bubbles") {
        const r = (10 + 26 * rnd() ** 2) * size;
        ps.push(base({ kind: "bubble", r, x: rnd() * W, y: H + r + rnd() * H * 0.2, vy: -(22 + 34 * rnd()) * (0.7 + r / 70), ttl: 1e9, popY: -r + rnd() * H * 0.45 }));
      } else if (fx === "snow") {
        const z = rnd() ** 1.6; // most flakes far away, a few close
        // staggered above the top edge, so new flakes never arrive as a row
        ps.push(base({ kind: "dot", z, r: (1.4 + 4.6 * z) * size, x: rnd() * W, y: first ? rnd() * H : -10 - rnd() * H * 0.3, vy: 14 + 46 * z, ttl: 1e9 }));
      } else if (fx === "rain") {
        const z = rnd();
        ps.push(base({ kind: "trail", c: -1, z, r: (0.8 + 1.2 * z) * size, x: rnd() * W * 1.2 - W * 0.1, y: first ? rnd() * H : -20 - rnd() * H * 0.3, vx: -60 - 40 * z, vy: 620 + 520 * z, tail: 0.035, ttl: 1e9, drag: 1, grav: 0 }));
      } else if (fx === "petals") {
        ps.push(base({ kind: "petal", r: (6 + 7 * rnd()) * size, x: rnd() * W * 1.3 - W * 0.15, y: -20 - rnd() * H * 0.4, vx: 18 + 26 * rnd(), vy: 28 + 30 * rnd(), rot: rnd() * 6.3, vr: (rnd() - 0.5) * 2.4, ttl: 1e9 }));
      } else if (fx === "confetti") {
        ps.push(base({ kind: "confetti", r: (4 + 4 * rnd()) * size, x: rnd() * W, y: -20 - rnd() * H * 0.5, vx: (rnd() - 0.5) * 30, vy: 55 + 55 * rnd(), rot: rnd() * 6.3, vr: (rnd() - 0.5) * 7, ttl: 1e9 }));
      } else if (fx === "embers") {
        ps.push(base({ r: (3 + 5 * rnd() ** 2) * size, x: W * (0.05 + 0.9 * rnd()), y: H + 10 + rnd() * H * 0.2, vx: (rnd() - 0.5) * 20, vy: -(40 + 60 * rnd()), ttl: 4 + 5 * rnd() }));
      } else if (fx === "notes") {
        // they appear where they are (lower part of the window) and float up, so they never arrive as a wave
        ps.push(base({ kind: "note", r: (10 + 8 * rnd()) * size, x: W * (0.04 + 0.92 * rnd()), y: H * (0.35 + 0.65 * rnd()), vy: -(24 + 26 * rnd()), rot: 0, ttl: 7 + 6 * rnd() }));
      } else if (fx === "butterflies") {
        const h = rnd() * Math.PI * 2, s = 38 + 28 * rnd();
        ps.push(base({ kind: "fly", r: (10 + 7 * rnd()) * size, x: W * (0.1 + 0.8 * rnd()), y: H * (0.15 + 0.7 * rnd()), vx: Math.cos(h) * s, vy: Math.sin(h) * s, ttl: 1e9 }));
      } else if (fx === "lanterns") {
        const z = rnd() ** 1.4; // most far away and small, a few close
        ps.push(base({ kind: "lantern", z, r: (4 + 9 * z) * size, x: W * (0.04 + 0.92 * rnd()), y: first ? H * (0.1 + 0.95 * rnd()) : H + 30 + rnd() * H * 0.5, vx: (rnd() - 0.5) * 6, vy: -(10 + 24 * z), ttl: 1e9 }));
      } else if (fx === "sparkles") {
        // a glint that flashes in place, anywhere, then is gone
        ps.push(base({ kind: "star", z: 1, r: (5 + 9 * rnd() ** 2) * size, x: rnd() * W, y: rnd() * H, vy: -6 - 8 * rnd(), ttl: 0.7 + 1.1 * rnd(), life: -rnd() * 1.5 }));
      } else if (fx === "meteors") {
        // a shower from the upper right, all on the same slant; staggered so they never arrive as a row
        const sp = (700 + 500 * rnd()) * (H / 1000 + 0.4);
        ps.push(base({ kind: "trail", r: (1.2 + 1.6 * rnd()) * size, tail: 0.1 + 0.06 * rnd(), x: W * (0.2 + 1.1 * rnd()), y: -40 - rnd() * H * 0.8, vx: -sp * 0.55, vy: sp * 0.83, ttl: 1e9, drag: 1, grav: 0 }));
      } else if (fx === "leaves") {
        ps.push(base({ kind: "leaf", r: (9 + 7 * rnd()) * size, x: rnd() * W * 1.2 - W * 0.1, y: -30 - rnd() * H * 0.5, vx: 12 + 20 * rnd(), vy: 34 + 24 * rnd(), rot: 0, ttl: 1e9 }));
      } else if (fx === "seeds") {
        // dandelion seeds riding the breeze across the window, rising a little; they fade in where they are
        ps.push(base({ kind: "seed", r: (9 + 6 * rnd()) * size, x: rnd() * W * 1.1 - W * 0.1, y: H * (0.15 + 0.8 * rnd()), vx: 22 + 26 * rnd(), vy: -(4 + 9 * rnd()), rot: 0, ttl: 1e9 }));
      } else if (fx === "balloons") {
        const r = (13 + 9 * rnd()) * size;
        ps.push(base({ kind: "balloon", r, x: W * (0.04 + 0.92 * rnd()), y: H + r * 4 + rnd() * H * 0.4, vy: -(26 + 24 * rnd()), rot: 0, ttl: 1e9 }));
      } else if (fx === "planes") {
        // paper planes gliding across from either side (vr: direction, z: speed), well spread out
        const dir = rnd() < 0.5 ? 1 : -1;
        ps.push(base({ kind: "plane", r: (13 + 6 * rnd()) * size, vr: dir, z: 110 + 70 * rnd(), x: dir > 0 ? -60 - rnd() * W * 0.8 : W + 60 + rnd() * W * 0.8, y: H * (0.08 + 0.6 * rnd()), rot: 0, ttl: 1e9 }));
      } else if (fx === "orbs") {
        // big soft out-of-focus lights drifting slowly, like bokeh in front of the scene
        const h = rnd() * Math.PI * 2, s = 5 + 9 * rnd();
        ps.push(base({ kind: "orb", r: (40 + 70 * rnd() ** 1.5) * size, x: rnd() * W, y: rnd() * H, vx: Math.cos(h) * s, vy: Math.sin(h) * s, ttl: 14 + 12 * rnd() }));
      } else if (fx === "fireflies") {
        const h = rnd() * Math.PI * 2, s = 6 + 12 * rnd();
        ps.push(base({ r: (12 + 10 * rnd()) * size, x: rnd() * W, y: H * (0.25 + 0.75 * rnd()), vx: Math.cos(h) * s, vy: Math.sin(h) * s, ttl: 10 + 12 * rnd() }));
      } else {
        const z = rnd() ** 4; // a handful of bright stars among many faint ones
        ps.push(base({ kind: z > 0.55 ? "star" : "glow", z, r: (2.2 + 9 * z) * size, x: rnd() * W, y: rnd() * H, vx: -1.5 - 2 * rnd(), ttl: 25 + 50 * rnd() }));
      }
    }
    // stars: now and then a shooting star
    if (fx === "stars" && rnd() < dt * 0.09 * e.amount) {
      const sp = (900 + 600 * rnd()) * (H / 1000 + 0.4), ang = Math.PI * (0.15 + 0.12 * rnd());
      out.push(base({ kind: "trail", c: -1, x: W * (0.1 + 0.8 * rnd()), y: H * 0.35 * rnd(), vx: Math.cos(ang) * sp * (rnd() < 0.5 ? -1 : 1), vy: Math.sin(ang) * sp, r: 1.6 * size, ttl: 0.7, tail: 0.09, drag: 1, grav: 0 }));
    }
  } else if (rnd() < dt * 0.55 * e.amount) {
    const g = H * 0.5, apex = H * (0.12 + 0.33 * rnd());
    const burst = (["peony", "peony", "ring", "willow", "crackle"] as const)[Math.floor(rnd() * 5)];
    ps.push(base({ rocket: true, burst, kind: "trail", r: 2.4 * size, tail: 0.06, x: W * (0.12 + 0.76 * rnd()), y: H + 10, vx: (rnd() - 0.5) * 50, vy: -Math.sqrt(2 * g * (H - apex)), ttl: 6 }));
  }

  let sparks = 0;
  for (const p of ps) {
    p.life += dt;
    if (p.life > p.ttl) continue;
    if (fx === "bubbles") {
      if (p.kind === "dot") {
        // droplets from a pop
        p.vy += 260 * dt;
        p.a = 1 - p.life / p.ttl;
      } else {
        p.x += Math.sin(t * 1.1 + p.seed) * 14 * dt;
        p.a = 0.9 * Math.max(0, Math.min(1, (H + p.r - p.y) / (H * 0.2) + 0.15));
        if (p.y < p.popY!) {
          for (let i = 0; i < 7; i++) {
            const ang = (i / 7) * Math.PI * 2 + rnd(), sp = (60 + 80 * rnd()) * size;
            out.push(base({ kind: "dot", c: p.c, x: p.x + Math.cos(ang) * p.r * 0.8, y: p.y + Math.sin(ang) * p.r * 0.8, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp, r: (1.6 + 1.6 * rnd()) * size, ttl: 0.45 }));
          }
          continue;
        }
      }
    } else if (fx === "snow") {
      const z = p.z!;
      p.x += Math.sin(t * (0.5 + 0.4 * z) + p.seed) * (8 + 22 * z) * dt;
      p.a = 0.3 + 0.6 * z;
      // recycle: back to a random spot above the top, so the fall stays even instead of arriving in waves
      if (p.y > H + p.r) {
        p.y = -p.r - rnd() * H * 0.25;
        p.x = rnd() * W;
      }
      if (p.x < -10) p.x += W + 20;
      else if (p.x > W + 10) p.x -= W + 20;
    } else if (fx === "fireflies") {
      // slow wander that steers back on screen; mostly dim with a soft blink now and then
      const turn = (rnd() - 0.5) * 2.2 * dt + (p.x < 0 || p.x > W || p.y < 0 || p.y > H ? 1.4 * dt : 0);
      const c = Math.cos(turn), s = Math.sin(turn);
      [p.vx, p.vy] = [p.vx * c - p.vy * s, p.vx * s + p.vy * c];
      const blink = Math.sin(t * 0.9 + p.seed) * 0.5 + 0.5;
      p.a = fade(p, 2, 2.5) * (0.18 + 0.82 * blink ** 6);
    } else if (fx === "rain") {
      p.a = 0.18 + 0.32 * p.z!;
      if (p.y > H + 20) {
        p.y = -20 - rnd() * H * 0.25;
        p.x = rnd() * W * 1.2;
      }
    } else if (fx === "petals" || fx === "confetti") {
      // tumble: spin, sway side to side, and flutter (petals glide, confetti falls faster and flips)
      p.rot! += p.vr! * dt;
      p.x += Math.sin(t * (fx === "petals" ? 0.9 : 2.2) + p.seed) * (fx === "petals" ? 26 : 14) * dt;
      p.a = 0.85;
      if (p.y > H + 30) {
        p.y = -20 - rnd() * H * 0.3;
        p.x = rnd() * W * (fx === "petals" ? 1.3 : 1) - (fx === "petals" ? W * 0.15 : 0);
      }
      if (p.x > W + 30) p.x -= W + 60;
    } else if (fx === "notes") {
      // drift up, sway and rock gently, dissolve before the top
      p.x += Math.sin(t * 1.3 + p.seed) * 22 * dt;
      p.rot = Math.sin(t * 1.7 + p.seed) * 0.35;
      p.a = fade(p, 1.2, 2.5) * 0.85;
    } else if (fx === "butterflies") {
      // heading wanders in lazy curves and turns back near the edges; a little bob with each wingbeat
      const off = p.x < W * 0.04 || p.x > W * 0.96 || p.y < H * 0.06 || p.y > H * 0.94;
      const turn = (Math.sin(t * 0.7 + p.seed) * 1.5 + (off ? 2.4 : 0)) * dt;
      const c = Math.cos(turn), s = Math.sin(turn);
      [p.vx, p.vy] = [p.vx * c - p.vy * s, p.vx * s + p.vy * c];
      p.y += Math.sin(t * 7 + p.seed) * 16 * dt;
      p.rot = Math.atan2(p.vy, p.vx);
      p.a = fade(p, 1.5, 1) * 0.92;
    } else if (fx === "lanterns") {
      // rise and sway; the flame flickers softly; they fade into the distance near the top, then start again below
      p.x += Math.sin(t * 0.4 + p.seed) * 6 * dt;
      const flick = 0.85 + 0.15 * Math.sin(t * 7 + p.seed * 5) * Math.sin(t * 3.1 + p.seed);
      p.a = Math.min(1, p.life / 2) * Math.max(0, Math.min(1, p.y / (H * 0.35))) * (0.55 + 0.45 * p.z!) * flick;
      if (p.y < -p.r * 4) {
        p.y = H + 30 + rnd() * H * 0.2;
        p.x = W * (0.04 + 0.92 * rnd());
      }
    } else if (fx === "embers") {
      // rise, drift, and flicker as they cool
      p.vx += (rnd() - 0.5) * 60 * dt;
      p.a = fade(p, 0.6, 2.2) * (0.55 + 0.45 * Math.sin(t * 9 + p.seed * 3) ** 2);
    } else if (fx === "sparkles") {
      if (p.life < 0) {
        // not lit yet: waits, unseen, so new sparkles don't all flash at once
        p.a = 0;
        out.push(p);
        continue;
      }
      p.a = Math.sin((Math.PI * p.life) / p.ttl) ** 2;
    } else if (fx === "meteors") {
      p.a = 0.85;
      if (p.y > H + 60 || p.x < -60) {
        p.y = -40 - rnd() * H * 0.6;
        p.x = W * (0.2 + 1.1 * rnd());
      }
    } else if (fx === "leaves") {
      // the falling-leaf swing: side to side like a pendulum, tilting with each swing
      const sw = Math.sin(t * 1.2 + p.seed);
      p.x += Math.cos(t * 1.2 + p.seed) * 46 * dt;
      p.rot = sw * 0.9 + p.seed;
      p.a = 0.9;
      if (p.y > H + 30) {
        p.y = -30 - rnd() * H * 0.3;
        p.x = rnd() * W * 1.2 - W * 0.2;
      }
    } else if (fx === "seeds") {
      p.y += Math.sin(t * 0.9 + p.seed) * 12 * dt;
      p.rot = Math.sin(t * 0.7 + p.seed) * 0.35;
      p.a = Math.min(1, p.life / 1.5) * 0.85;
      if (p.x > W + 40 || p.y < -40) {
        p.x = -40 - rnd() * W * 0.2;
        p.y = H * (0.2 + 0.75 * rnd());
      }
    } else if (fx === "balloons") {
      // rise and sway on the breeze, tilting with it; off the top, start again from below
      p.x += Math.sin(t * 0.8 + p.seed) * 14 * dt;
      p.rot = Math.sin(t * 0.8 + p.seed - 0.6) * 0.14;
      p.a = 0.92;
      if (p.y < -p.r * 4) {
        p.y = H + p.r * 4 + rnd() * H * 0.2;
        p.x = W * (0.04 + 0.92 * rnd());
      }
    } else if (fx === "planes") {
      // glide with a gentle bob, sinking a little; every so often a loop-the-loop (up and over, whichever way it flies)
      const dir = p.vr!, cyc = (p.life + p.seed) % 12, loop = cyc > 9 ? (cyc - 9) / 3 : 0;
      const ang = (dir > 0 ? 0 : Math.PI) + 0.16 * Math.sin(t * 0.7 + p.seed) - dir * (loop - Math.sin(loop * Math.PI * 2) / (Math.PI * 2)) * Math.PI * 2;
      p.vx = Math.cos(ang) * p.z!;
      p.vy = Math.sin(ang) * p.z! + 10;
      p.rot = ang;
      p.a = 0.95;
      if (dir > 0 ? p.x > W + 80 : p.x < -80) {
        p.x = dir > 0 ? -80 - rnd() * W * 0.4 : W + 80 + rnd() * W * 0.4;
        p.y = H * (0.08 + 0.6 * rnd());
      }
      if (p.y > H + 60) p.y = H * 0.1;
    } else if (fx === "orbs") {
      p.a = fade(p, 4, 4) * (0.35 + 0.15 * Math.sin(t * 0.6 + p.seed));
    } else if (fx === "stars" && p.kind !== "trail") {
      const tw = 0.5 + 0.5 * Math.sin(t * (0.5 + (p.seed % 1.9)) + p.seed);
      p.a = fade(p, 4, 4) * (0.3 + 0.7 * p.z!) * (0.45 + 0.55 * tw);
      if (p.x < -10) p.x += W + 20;
    } else if (p.kind === "trail" && !p.rocket) {
      // sparks (and shooting stars): drag, gravity, fade; crackle and willow tails glitter at the end
      const dragK = Math.pow(p.drag ?? 0.15, dt);
      p.vx *= dragK;
      p.vy = p.vy * dragK + (p.grav ?? H * 0.16) * dt;
      const k = p.life / p.ttl;
      p.a = fx === "stars" ? Math.sin(Math.PI * k) : (1 - k) ** 1.4;
      if ((p.burst === "crackle" || p.burst === "willow") && k > 0.55) p.a *= rnd() < 0.5 ? 1.4 : 0.2;
      sparks++;
    } else if (p.rocket) {
      p.vy += H * 0.5 * dt;
      p.vx *= Math.pow(0.6, dt);
      p.a = 0.9;
      if (p.vy > -H * 0.05) {
        explode(p, out, sparks, H, size, color, rnd, base);
        continue;
      }
    } else p.a = (1 - p.life / p.ttl) ** 2; // burst flash
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    out.push(p);
  }
  return out;
}

function explode(p: P, out: P[], sparks: number, H: number, size: number, color: () => number, rnd: () => number, base: (o: Partial<P>) => P) {
  const kind = p.burst ?? "peony";
  const count = kind === "ring" ? 42 : kind === "willow" ? 60 : 70 + Math.floor(rnd() * 30);
  const speed = (kind === "willow" ? 150 : 210) * (0.7 + 0.5 * rnd()) * size * (H / 900 + 0.35);
  const second = rnd() < 0.4 ? color() : p.c;
  for (let i = 0; i < count && sparks + out.length < MAX_SPARKS; i++) {
    const ang = (i / count) * Math.PI * 2 + rnd() * 0.15;
    // peony/crackle: a filled sphere (random radius); ring: one crisp circle; willow: slow, drooping, long
    const sp = kind === "ring" ? speed : speed * Math.sqrt(0.15 + 0.85 * rnd());
    out.push(base({
      kind: "trail", burst: kind, c: i % 3 === 0 ? second : p.c, x: p.x, y: p.y,
      vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp,
      r: (kind === "willow" ? 1.4 : 2) * size,
      ttl: kind === "willow" ? 2.4 + rnd() : 1.2 + 0.8 * rnd(),
      tail: kind === "willow" ? 0.14 : 0.07,
      drag: kind === "willow" ? 0.35 : 0.12,
      grav: H * (kind === "willow" ? 0.22 : 0.14),
    }));
  }
  out.push(base({ c: p.c, x: p.x, y: p.y, r: 90 * size, ttl: 0.4 }));
}
