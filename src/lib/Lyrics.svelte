<script lang="ts">
  import { onMount, tick, untrack } from "svelte";
  import { measuredLyricHeight } from "./lyric-height";
  import { activeLine, wordGroups, CJK, fmtOffset, type Line, type Lyrics, type Word } from "./lyrics";
  import { settings, calm } from "./settings.svelte";
  import Icon from "./Icon.svelte";

  type DLine = Line & { interlude?: boolean };

  let {
    lyrics,
    anchorMs,
    anchorAt,
    playing,
    offsetMs,
    trackOffsetMs,
    chromeHidden,
    onSeek,
    onNudge,
    onFix,
  }: {
    lyrics: Lyrics | null;
    anchorMs: number; // position at the last SDK event (or the seek bar while dragging)
    anchorAt: number; // performance.now() of that event
    playing: boolean;
    offsetMs: number; // total offset (global + this song)
    trackOffsetMs: number;
    chromeHidden: boolean;
    onSeek: (ms: number) => void;
    onNudge: (deltaMs: number | null) => void; // null = reset this song's offset
    onFix: () => void;
  } = $props();

  // lyric text color; the tints follow the accent, which is the album's color unless set by hand
  const INK = { white: "#fff", tint: "color-mix(in oklab, var(--song, var(--accent)) 30%, #fff)", song: "color-mix(in oklab, var(--song, var(--accent)) 72%, #fff)" };
  // how far down the lyrics area the current line sits (Settings; TV mode has its own, as its lyrics sit above the player bar)
  let ANCHOR = $derived(settings.layout === "tv" ? settings.lyricsAnchorTv : settings.lyricsAnchor);
  // Distinct on purpose: spring visibly overshoots and ripples down the list, smooth glides with no bounce.
  const MOTION = {
    // soft starts (no instant jump off the line), long settles; spring keeps a small overshoot
    spring: { dur: 1050, ease: "cubic-bezier(.3, .1, .2, 1.12)", stagger: 38 },
    smooth: { dur: 1000, ease: "cubic-bezier(.33, 0, .15, 1)", stagger: 20 },
    instant: { dur: 0, ease: "linear", stagger: 0 },
    glance: { dur: 1300, ease: "cubic-bezier(.45, 0, .25, 1)", stagger: 0 }, // slow and even: nothing to catch your eye mid-game
  };

  let viewport = $state<HTMLElement>();
  let viewH = $state(0);
  const lineEls: HTMLElement[] = []; // plain: only read when measuring
  let tops = $state.raw<number[]>([]);
  let heights = $state.raw<number[]>([]);
  let rowHeights = $state.raw<string[]>([]);
  let measuring = $state(true);
  let measurementPending = false, disposed = false;
  let measuredWidth = 0, measuredHeight = 0;
  let manualY = $state<number | null>(null);
  let manualTimer: ReturnType<typeof setTimeout>;

  let now = $state(performance.now());
  let visible = $state(!document.hidden);
  // max(0): right after an SDK event the clock may not have ticked yet; the anchor itself is exact then
  // Lyrics run this much ahead of the audio: every lit state eases in over a few hundred ms, so without it a word
  // only *looks* lit after it has started (that read as "always a bit late").
  const EARLY = 120;
  let pos = $derived(anchorMs + (playing ? Math.max(0, now - anchorAt) : 0) + offsetMs + EARLY);
  let mode = $derived(settings.lyricsMode);
  // lines blur by their distance (--d) from the current one. Only set where it's used: a custom property is
  // inherited, so changing it on a line restyles every word in it
  let focusBlur = $derived(settings.lyricsFocus && mode === "scroll");
  let motion = $derived(
    calm() || settings.lyricsMotion === "instant" ? MOTION.instant : mode === "glance" ? MOTION.glance : MOTION[settings.lyricsMotion],
  );

  // Lines plus "interlude" rows for long instrumental gaps.
  let lines: DLine[] = $derived.by(() => {
    if (lyrics?.kind !== "synced") return [];
    const src = lyrics.lines;
    const out: DLine[] = [];
    if (settings.lyricsInterludes && src[0]?.t > 4000) out.push({ t: 0, end: src[0].t, text: "", interlude: true });
    src.forEach((l, i) => {
      if (!l.text) return settings.lyricsInterludes && out.push({ ...l, interlude: true });
      out.push(l);
      const next = src[i + 1];
      if (settings.lyricsInterludes && next && l.words && next.t - l.end > 6000)
        out.push({ t: l.end, end: next.t, text: "", interlude: true });
    });
    return out;
  });

  // The list starts gliding a little before a line is sung so it settles on time instead of rushing in late.
  let lead = $derived(motion.dur * 0.3);
  // State set from the clock, not derived from it: the position changes every frame, and as deriveds these two
  // had every line and word of the song re-checked each frame just to find that the line hadn't changed.
  let active = $state(-1);
  let focus = $state(-1);
  $effect.pre(() => {
    active = activeLine(lines, pos);
    focus = activeLine(lines, pos + lead);
  });
  // Quick lines get a shorter glide so one never cuts off the previous one mid-move (that reads as a jolt).
  let dur = $derived.by(() => {
    const a = lines[focus], b = lines[focus + 1];
    return a && b ? Math.min(motion.dur, Math.max(motion.dur * 0.5, (b.t - a.t) * 0.9)) : motion.dur;
  });
  let targetY = $derived.by(() => {
    const i = Math.max(focus, 0); // before the first line, park on the first line
    return tops.length ? tops[i] + heights[i] / 2 - viewH * ANCHOR : 0;
  });
  let y = $derived(manualY ?? targetY);
  // Lines well outside the view (and outside the stretch the list is gliding over) are hidden and jump instead of
  // glide: otherwise every line of the song ran its own transform transition on each line change, so Chromium made
  // 100+ GPU layers at every line and tore them down after (lag, flicker and memory swings), all for lines off screen.
  let prevY = $state(0);
  $effect(() => {
    const v = y;
    const t = setTimeout(() => (prevY = v), motion.dur + 8 * motion.stagger + 400); // once this glide has settled
    return () => clearTimeout(t);
  });
  let lo = $derived(Math.min(prevY, y) - viewH * 0.6);
  let hi = $derived(Math.max(prevY, y) + viewH * 1.6);

  // Words of the active line. Scroll's sweep keeps the source's own syllables (the fill runs smoothly across them);
  // Pop and the other styles animate whole words, so a lit syllable never pokes into the rest of its word.
  let cur = $derived(lines[active] as DLine | undefined);
  // How words light (Settings, per style): the style's own effect, a Sweep or Pop that works in any style, or off.
  // Scroll and Glance have no effect of their own, so theirs is the sweep. Without word timing from the source,
  // words are timed from the line.
  let hl = $derived(settings.wordHl[mode] ?? "own");
  let wordsOn = $derived(hl !== "off");
  let generic = $derived(hl === "sweep" || hl === "pop" ? hl : hl === "own" && (mode === "scroll" || mode === "glance") ? "sweep" : null);
  function wordsOf(l: DLine | undefined) {
    if (!l || l.interlude || !wordsOn) return undefined;
    const syl = generic === "sweep" && !!l.words?.length;
    return { ws: syl ? l.words! : wordGroups(l), gap: syl || CJK.test(l.text) ? "" : " " }; // wordGroups trims, so re-add spaces
  }
  // Every line keeps its word spans for the whole song: a line change only flips classes (which ease), and no
  // line ever re-lays out (adding or dropping spans could re-wrap a line and jolt the list).
  let wl = $derived(lines.map(wordsOf));
  // only the lines around the current one follow the clock; the rest are simply sung or not
  let ticking = $derived(new Set([active - 1, active, active + 1, focus]));
  let words: Word[] | undefined = $derived(wl[active]?.ws);
  const LONG_MS = 900; // kinetic: words held this long swell and glow
  let letters = $derived(!generic && (mode === "kinetic" || mode === "reveal" || mode === "wave" || mode === "typewriter" || mode === "chroma" || mode === "flip")); // these animate each letter along the word's progress

  // The styles whose look follows a word's exact progress (a sweep across it, letter by letter, the marker's
  // stroke). The others only switch a word on, and writing an unused --p on it every frame still had the browser
  // restyle and repaint that word every frame.
  let needP = $derived(letters || generic === "sweep" || mode === "marker");

  // ---- bounce: a ball that arcs from word to word, landing on each as it starts ----
  let boxes = $state.raw<{ x: number; y: number }[]>([]);
  function measureWords() {
    const els = lineEls[active]?.querySelectorAll<HTMLElement>(".word, .w") ?? [];
    boxes = Array.from(els, (el) => ({ x: el.offsetLeft + el.offsetWidth / 2, y: el.offsetTop }));
  }
  $effect(() => {
    void words;
    if (mode === "bounce") queueMicrotask(measureWords);
  });
  let ball = $derived.by(() => {
    if (mode !== "bounce" || !words?.length || boxes.length !== words.length) return null;
    const k = words.findLastIndex((w) => w.t <= pos);
    if (k < 0) return { x: boxes[0].x, y: boxes[0].y, lift: 0 };
    const a = boxes[k], b = boxes[k + 1];
    if (!b) return { x: a.x, y: a.y, lift: 0 }; // last word: it just rests there
    // Like a real ball: rest on the word, then one quick hop that lands right as the next word starts.
    // Long pauses don't turn into slow floaty arcs, and quick words get small low hops.
    const gap = Math.max(words[k + 1].t - words[k].t, 1);
    const hop = Math.min(gap, 460);
    const t = Math.max(0, Math.min(1, (pos - (words[k + 1].t - hop)) / hop));
    return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, lift: 4 * t * (1 - t) * Math.min(1, hop / 380) };
  });

  // Own clock: every frame only while something on screen follows the exact position (word fills, letters,
  // the ball, interlude dots). Otherwise (line-synced Scroll, Glance, plain word style, or the rest of a line
  // after its last word is sung) one wake-up exactly when the next line starts, so nothing runs in between.
  let wordsEnd = $derived(words?.length ? words[words.length - 1].t + words[words.length - 1].d : -Infinity);
  let animating = $derived(
    !!cur?.interlude || pos < wordsEnd,
  );
  // Styles that only switch words on (Neon, Drop, Pop...) need the clock at each word's start and end, not every
  // frame between: a wake-up per word instead of a redraw of the page per frame.
  let perFrame = $derived(needP || mode === "bounce" || !!cur?.interlude);
  $effect(() => {
    if (!playing || !visible) return;
    if (animating && perFrame) {
      let id = requestAnimationFrame(function tick() {
        now = performance.now();
        id = requestAnimationFrame(tick);
      });
      return () => cancelAnimationFrame(id);
    }
    void now; // re-arm after each wake-up
    // next event: the glide toward the coming line, or that line's highlight, whichever is first
    const glide = lines[focus + 1]?.t, hl = lines[active + 1]?.t;
    let nextT = Math.min(glide == null ? Infinity : glide - lead, focus > active && hl != null ? hl : Infinity);
    const live = anchorMs + performance.now() - anchorAt + offsetMs + EARLY;
    for (const w of words ?? []) for (const t of [w.t, w.t + w.d]) if (t > live && t < nextT) nextT = t;
    if (nextT === Infinity) return;
    const id = setTimeout(() => (now = performance.now()), Math.max(0, nextT - live) + 4);
    return () => clearTimeout(id);
  });

  onMount(() => {
    const onVisibility = () => {
      visible = !document.hidden;
      now = performance.now(); // catch up before painting the first restored frame
    };
    document.addEventListener("visibilitychange", onVisibility);
    document.fonts?.addEventListener("loadingdone", requestMeasure);
    return () => {
      disposed = true;
      document.removeEventListener("visibilitychange", onVisibility);
      document.fonts?.removeEventListener("loadingdone", requestMeasure);
      clearTimeout(manualTimer);
    };
  });

  // Measure line positions (offsetTop ignores transforms) whenever content or sizing changes.
  function measure() {
    lineEls.length = lines.length; // drop the previous song's detached elements
    const els = lineEls;
    tops = els.map((el) => el?.offsetTop ?? 0);
    heights = els.map((el) => el?.offsetHeight ?? 0);
    rowHeights = els.map((el) => el ? measuredLyricHeight(getComputedStyle(el).height) : "");
    measuredWidth = viewport?.clientWidth ?? 0;
    measuredHeight = viewport?.clientHeight ?? 0;
    if (mode === "bounce") measureWords(); // wrapping may have changed
  }
  function requestMeasure() {
    if (measurementPending || disposed) return;
    measurementPending = true;
    measuring = true;
    void tick().then(() => {
      if (!disposed) {
        measure();
        measuring = false;
      }
      measurementPending = false;
    });
  }
  $effect(() => {
    void [lines, wl, settings.lyricsSize, settings.uiScale, settings.font, settings.lyricsMode, settings.layout];
    if (!viewport) return;
    untrack(requestMeasure);
    const ro = new ResizeObserver(() => {
      if (viewport && (viewport.clientWidth !== measuredWidth || viewport.clientHeight !== measuredHeight)) requestMeasure();
    });
    ro.observe(viewport);
    return () => ro.disconnect();
  });

  // New song: back to the top, auto-follow on.
  $effect(() => {
    void lyrics;
    manualY = null;
  });

  function onWheel(e: WheelEvent) {
    const max = (tops.at(-1) ?? 0) + (heights.at(-1) ?? 0) - viewH * ANCHOR;
    manualY = Math.max(-viewH * ANCHOR, Math.min(max, (manualY ?? targetY) + e.deltaY));
    clearTimeout(manualTimer);
    manualTimer = setTimeout(() => (manualY = null), 3200);
  }

  const wordP = (w: Word) => Math.max(0, Math.min(1, (pos - w.t) / Math.max(w.d, 1)));
  const interludeP = (l: DLine) => Math.max(0, Math.min(1, (pos - l.t) / Math.max(l.end - l.t, 1)));
  // Lines below the active one start moving a beat later, which makes the list flow like a wave.
  const delay = (i: number) => (manualY === null ? Math.min(Math.max(0, i - focus + 1), 8) * motion.stagger : 0);

  let sourceLabel = $derived(
    !lyrics || lyrics.kind === "none"
      ? ""
      : `${lyrics.source === "lrclib" ? "LRCLIB" : lyrics.source === "file" ? "Your file" : "NetEase"} · ${
          lyrics.kind === "synced" ? (lyrics.wordSynced ? "word sync" : "line sync") : lyrics.kind === "plain" ? "unsynced" : "instrumental"
        }`,
  );
</script>

<section
  class="lyrics mode-{mode} {generic ? `ws-${generic}` : wordsOn ? '' : 'ws-plain'}"
  class:wd={wordsOn}
  class:center={settings.lyricsAlign === "center"}
  class:right={settings.lyricsAlign === "right"}
  class:focus={focusBlur}
  class:manual={manualY !== null}
  class:still={motion.dur === 0}
  class:noglow={!settings.lyricsGlow}
  class:edge-outline={settings.lyricsEdge === "outline"}
  class:edge-shadow={settings.lyricsEdge === "shadow"}
  style:--fx={settings.lyricsFx}
  style:--ink={settings.lyricsColor === "custom" ? settings.lyricsInk : INK[settings.lyricsColor]}
  style:--accent={settings.lyricsGlowFrom === "song" ? "var(--song)" : settings.lyricsGlowFrom === "custom" ? settings.lyricsGlowColor : undefined}
  style:--size="calc({settings.lyricsSize}px * var(--s, 1))"
  style:--dur="{manualY === null ? dur : 220}ms"
  style:--ease={manualY === null ? motion.ease : "ease-out"}
  aria-label="Lyrics"
>
  {#if settings.lyricsEdge === "outline"}
    <!-- Text edge: a 1px ring strictly outside the letters (it can't show through see-through unsung words, which a
         stroke or drop-shadow did), as bright as the text it rings, so it lights up with each word -->
    <svg class="defs" aria-hidden="true">
      <filter id="helios-edge" x="-5%" y="-20%" width="110%" height="140%">
        <feComponentTransfer in="SourceAlpha" result="solid"><feFuncA type="discrete" tableValues="0 1 1 1 1 1 1 1 1 1" /></feComponentTransfer>
        <feMorphology in="SourceAlpha" operator="dilate" radius="1" result="fat" />
        <feComposite in="fat" in2="solid" operator="out" result="ring" />
        <feFlood style="flood-color: color-mix(in oklab, var(--accent) 85%, #000)" />
        <feComposite in2="ring" operator="in" result="edge" />
        <feMerge><feMergeNode in="edge" /><feMergeNode in="SourceGraphic" /></feMerge>
      </filter>
    </svg>
  {/if}
  {#if lyrics && lyrics.kind !== "none"}
    <div class="toolbar" class:gone={chromeHidden}>
      <span class="badge">{sourceLabel}</span>
      {#if lyrics.kind === "synced"}
        <div class="nudge" role="group" aria-label="Lyrics timing for this song">
          <button class="step" title="Lyrics come in too late? Show them 0.1s sooner ([)" onclick={() => onNudge(100)}>Earlier</button>
          <button class="val" title="This song's timing. Click to reset" onclick={() => onNudge(null)}>{fmtOffset(trackOffsetMs)}</button>
          <button class="step" title="Lyrics run ahead of the singing? Show them 0.1s later (])" onclick={() => onNudge(-100)}>Later</button>
        </div>
      {/if}
      <button class="tool" title="Wrong lyrics? Pick another version" onclick={onFix}><Icon name="edit" size={15} /> Fix</button>
    </div>
  {/if}

  {#if !lyrics}
    <div class="status shimmer" aria-live="polite"><span></span><span></span><span></span></div>
  {:else if lyrics.kind === "none" || lyrics.kind === "instrumental"}
    <div class="status">
      <Icon name="music" size={30} />
      <p>{lyrics.kind === "none" ? "No lyrics found" : "Instrumental"}</p>
      {#if lyrics.kind === "none"}<button class="tool" onclick={onFix}><Icon name="search" size={15} /> Search manually</button>{/if}
    </div>
  {:else if lyrics.kind === "plain"}
    <div class="plain-scroll">
      <p class="note">Not synced for this track</p>
      {#each lyrics.lines as text}<p class="plain">{text || " "}</p>{/each}
    </div>
  {:else}
    <!-- svelte-ignore a11y_no_static_element_interactions (wheel only pauses auto-follow) -->
    <div class="viewport" bind:this={viewport} bind:clientHeight={viewH} onwheel={onWheel}>
      {#each lines as line, i (line.t + (line.interlude ? "i" : ""))}
        {@const d = Math.abs(i - active)}
        {@const far = tops.length > 0 && ((tops[i] ?? 0) + (heights[i] ?? 0) < lo || (tops[i] ?? 0) > hi)}
        {@const skip = mode === "scroll" && hl !== "pop" && !measuring && far}
        <button
          class="line"
          class:active={i === active}
          class:past={i < active}
          class:interlude={line.interlude}
          class:near={d === 1}
          class:upcoming={i === active + 1}
          class:layer={Math.abs((tops[i] ?? 0) - (tops[Math.max(focus, 0)] ?? 0)) < viewH * 1.1}
          class:far={far}
          class:skip={skip}
          style:height={skip ? rowHeights[i] : undefined}
          style:--d={focusBlur ? Math.min(d, 4) : null}
          style:transform="translateY({-y}px) scale({i === focus ? 1 : mode === 'spotlight' ? 0.9 : 0.965})"
          style:transition-delay="{delay(i)}ms"
          bind:this={lineEls[i]}
          onclick={() => onSeek(line.t - offsetMs)}
        >
          {#if line.interlude}
            {@const p = i === active ? interludeP(line) : 0}
            <span class="dots" aria-label="Instrumental break">
              {#each [0, 1, 2] as k}
                <span style:--p={Math.max(0, Math.min(1, p * 3 - k))}></span>
              {/each}
            </span>
          {:else if wl[i]}
            {@const { ws, gap } = wl[i]!}
            <!-- no whitespace between the tags below: Svelte would turn it into spaces inside words -->
            {#each ws as w, k}{@const p = ticking.has(i) ? wordP(w) : i < active ? 1 : 0}{#if letters}{@const chars = Array.from(w.text)}<span class="word" class:long={w.d >= LONG_MS} class:on={p > 0} class:cur={p > 0 && p < 1} style:--p={needP ? p : null} style:--n={chars.length}>{#each chars as ch, ci}<span class="ch" style:--i={ci}>{ch}</span>{/each}</span>{:else}<span class={generic ? "w" : "word"} class:on={p > 0} class:cur={p > 0 && p < 1} style:--p={needP ? p : null} data-t={mode === "neon" ? w.text : null}>{w.text}</span>{/if}{#if k < ws.length - 1}{gap}{/if}{/each}{#if ball && i === active}<span class="ball" aria-hidden="true" style:--bx="{ball.x}px" style:--by="{ball.y}px" style:--lift={ball.lift}></span>{/if}
          {:else}
            {line.text}
          {/if}
        </button>
      {/each}
      <div class="tail"></div>
    </div>
  {/if}
</section>

<style>
  .lyrics {
    position: relative;
    height: 100%;
    min-height: 0;
    display: flex;
    flex-direction: column;
    justify-content: center;
  }

  /* ---- toolbar ---- */
  .toolbar {
    position: absolute;
    top: 0;
    right: 0;
    z-index: 2;
    display: flex;
    align-items: center;
    gap: 0.4rem;
    font-size: 0.72rem;
    opacity: 0;
    transform: translateY(-4px);
    transition: opacity 0.3s ease, transform 0.3s ease;
  }
  .lyrics:hover .toolbar:not(.gone),
  .toolbar:focus-within {
    opacity: 1;
    transform: none;
  }
  .badge {
    padding: 0.3rem 0.6rem;
    border-radius: 999px;
    background: rgba(255, 255, 255, 0.07);
    color: rgba(255, 255, 255, 0.6);
    letter-spacing: 0.02em;
  }
  .nudge {
    display: flex;
    align-items: center;
    border-radius: 999px;
    background: rgba(255, 255, 255, 0.07);
  }
  .nudge button {
    display: grid;
    place-items: center;
    height: 1.9rem;
    min-width: 1.9rem;
    color: rgba(255, 255, 255, 0.75);
    border-radius: 999px;
  }
  .nudge button:hover {
    color: #fff;
    background: rgba(255, 255, 255, 0.08);
  }
  .nudge .step {
    padding: 0 0.7rem;
    font-size: 0.72rem;
  }
  .nudge .val {
    min-width: 3.1rem;
    font-variant-numeric: tabular-nums;
  }
  .tool {
    display: flex;
    align-items: center;
    gap: 0.35rem;
    padding: 0.4rem 0.75rem;
    border-radius: 999px;
    background: rgba(255, 255, 255, 0.07);
    color: rgba(255, 255, 255, 0.8);
    font-size: 0.72rem;
    transition: background 0.15s, color 0.15s;
  }
  .tool:hover {
    background: rgba(255, 255, 255, 0.14);
    color: #fff;
  }

  /* ---- synced lines ---- */
  .viewport {
    position: relative;
    height: 100%;
    overflow: hidden;
    mask-image: linear-gradient(to bottom, transparent 0, #000 16%, #000 80%, transparent 100%);
  }
  .tail {
    height: 60%;
  }
  .line {
    position: relative; /* anchors the bounce ball and word measurements */
    display: block;
    width: 100%;
    margin: 0;
    padding: 0.36em 0.45em;
    border-radius: 0.5em;
    text-align: inherit;
    font: inherit;
    font-size: var(--size);
    font-weight: 750;
    line-height: 1.24;
    letter-spacing: -0.02em;
    color: var(--ink);
    background: none;
    border: none;
    cursor: pointer;
    opacity: 0.3;
    transform-origin: left center;
    transition:
      transform var(--dur) var(--ease),
      opacity 0.6s cubic-bezier(0.4, 0, 0.2, 1),
      filter 0.6s cubic-bezier(0.4, 0, 0.2, 1),
      text-shadow 0.6s cubic-bezier(0.4, 0, 0.2, 1),
      background-color 0.2s ease;
    text-wrap: balance;
  }
  /* With word highlighting, a line still to come already wears its "unsung" look at full line opacity (each style
     dims its own words), so starting a line changes nothing until words are sung. Fading the line up while its
     words faded down was a brighten-dip-settle flicker at every line. */
  .lyrics.wd .line:not(.past):not(.interlude) {
    opacity: 1;
  }
  /* only lines within about a screen of the current one keep their own GPU layer (and blur); a long song no longer holds one per line.
     Far-off lines still glide: Chromium composites any running transform transition on its own. */
  .line.layer {
    will-change: transform;
  }
  /* Other styles animate offscreen words during seeks, so only skip the verified scroll styles. */
  .lyrics .viewport .line.skip {
    content-visibility: hidden;
  }
  .lyrics .viewport .line.far {
    visibility: hidden;
    transition: none !important; /* beats the styles' own transition lists */
  }
  .center {
    text-align: center;
  }
  .center .line {
    transform-origin: center;
  }
  .right {
    text-align: right;
  }
  .right .line {
    transform-origin: right center;
  }
  .line:hover {
    opacity: 0.65;
    background-color: rgba(255, 255, 255, 0.05);
  }
  .line.past {
    opacity: 0.2;
  }
  .line.active {
    opacity: 1;
  }
  /* only lines near the viewport blur: off-screen ones would each hold a filter layer for nothing */
  .focus .line.layer:not(.active):not(:hover) {
    filter: var(--edge,) blur(calc(var(--d) * 0.6px));
  }
  .manual .line {
    filter: var(--edge, none) !important;
    opacity: 0.55;
  }
  .manual .line.active {
    opacity: 1;
  }
  .line:focus-visible {
    outline: 2px solid var(--accent);
  }

  /* word-level: sung part fills in from the left with a soft edge, and lifts slightly */
  .word,
  .ws-pop .w {
    display: inline-block;
    white-space: pre;
    transition: transform 0.35s cubic-bezier(0.2, 0.8, 0.2, 1), text-shadow 0.4s ease;
  }
  /* the unsung shade of a sweep word eases in as its line becomes current, and back out as it finishes */
  @property --dim {
    syntax: "<color>";
    inherits: false;
    initial-value: rgba(255, 255, 255, 0.32);
  }
  /* Sweep and Pop work in every style (class .w, so the style's own word rules stay out of it) */
  .ws-sweep .line:not(.past) .w {
    --dim: color-mix(in oklab, var(--ink) 32%, transparent); /* the unsung part follows Text color too */
  }
  /* plain inline text, so a word sung in syllables wraps exactly like normal text instead of between syllables */
  .ws-sweep .w {
    color: transparent;
    transition: --dim 0.6s cubic-bezier(0.4, 0, 0.2, 1);
    /* a soft leading edge, a little brighter than the sung part, that travels with the voice */
    background-image: linear-gradient(
      90deg,
      var(--ink) calc(var(--p) * 120% - 20%),
      color-mix(in oklab, var(--ink), var(--accent) 25%) calc(var(--p) * 120% - 8%),
      var(--dim) calc(var(--p) * 120%)
    );
    -webkit-background-clip: text;
    background-clip: text;
  }
  .ws-pop .w {
    color: color-mix(in oklab, var(--ink) 32%, transparent);
    /* no scale and no overshoot: a lit word only brightens and rises a hair, so it never overlaps its neighbours */
    transition: color 0.28s cubic-bezier(0.4, 0, 0.2, 1), transform 0.45s cubic-bezier(0.22, 1, 0.36, 1), text-shadow 0.5s ease;
  }
  .ws-pop .w.on {
    color: var(--ink);
    transform: translateY(-0.03em);
    text-shadow: 0 0 18px color-mix(in oklab, var(--accent) 40%, transparent);
  }
  .ws-sweep.mode-scroll .line.active,
  .ws-sweep.mode-glance .line.active,
  .ws-plain.mode-scroll .line.active,
  .ws-plain.mode-glance .line.active {
    text-shadow: 0 0 30px color-mix(in oklab, var(--accent) 30%, transparent);
  }

  /* interlude dots */
  .interlude {
    padding-block: 0.5em;
  }
  .dots {
    display: inline-flex;
    gap: 0.35em;
    vertical-align: middle;
  }
  .dots span {
    width: 0.32em;
    height: 0.32em;
    border-radius: 50%;
    background: var(--ink);
    opacity: calc(0.25 + var(--p) * 0.75);
    transform: scale(calc(0.8 + var(--p) * 0.35));
    transition: opacity 0.2s, transform 0.2s;
  }
  .interlude.active .dots {
    animation: breathe 2.4s ease-in-out infinite;
  }
  @keyframes breathe {
    50% {
      transform: scale(1.12);
    }
  }

  /* ---- styles: all share the scrolling engine above, so lines always glide instead of popping in and out ---- */
  /* --fx (Effect strength) scales every lift, growth and arc below. */
  /* No will-change on words or letters: one GPU layer per letter, made at every line change, was the hitch.
     They draw inside their line's layer. */
  .ch {
    /* each letter's own progress through its word: 0 → 1 as the word is sung */
    --lp: clamp(0, var(--p) * var(--n) - var(--i), 1);
    display: inline-block;
    white-space: pre;
  }

  /* spotlight: bigger text, only the lines either side stay faintly visible; the sung word grows a touch */
  .mode-spotlight .line {
    font-size: calc(var(--size) * 1.15);
    opacity: 0;
  }
  .mode-spotlight .line.near {
    opacity: 0.22;
  }
  .mode-spotlight .line.active {
    opacity: 1;
  }
  /* with words lit, the next line is already dimmed by its words, so the line itself shows brighter to match */
  .lyrics.wd.mode-spotlight .line:not(.past):not(.active) {
    opacity: 0;
  }
  .lyrics.wd.mode-spotlight .line.upcoming:not(.past) {
    opacity: 0.6;
  }
  .mode-spotlight .word {
    color: color-mix(in oklab, var(--ink) 36%, transparent);
    transform-origin: 50% 85%;
    transition:
      color 0.35s cubic-bezier(0.4, 0, 0.2, 1),
      transform 0.6s cubic-bezier(0.22, 1, 0.36, 1),
      text-shadow 0.6s ease;
  }
  .mode-spotlight .word.on {
    color: var(--ink);
  }
  /* growth stays small enough for the word gap to absorb it, so neighbours are never covered */
  .mode-spotlight .word.cur {
    transform: translateY(calc(-0.03em * var(--fx))) scale(calc(1 + 0.06 * var(--fx)));
    text-shadow: 0 0 26px color-mix(in oklab, var(--accent) 55%, transparent);
  }

  /* kinetic: a wave runs through every letter as it's sung, lifting it and lighting it up;
     long-held words swell, glow and breathe back down when the note ends */
  .mode-kinetic .ch {
    opacity: calc(0.3 + 0.7 * var(--lp));
    transform: translateY(calc((0.04em - 0.13em * var(--lp)) * var(--fx)));
    transition:
      transform 0.5s cubic-bezier(0.22, 1, 0.36, 1),
      opacity 0.3s linear,
      text-shadow 0.8s ease;
  }
  .mode-kinetic .word {
    transform-origin: 50% 90%;
    transition: transform 0.9s cubic-bezier(0.22, 1, 0.36, 1);
  }
  /* a transform only: making room with margin re-wrapped lines near the edge, which jolted the whole list */
  .mode-kinetic .word.long.cur {
    transform: scale(calc(1 + 0.06 * var(--fx)));
  }
  .mode-kinetic .word.long.cur .ch {
    transform: translateY(calc(-0.16em * var(--lp) * var(--fx)));
    text-shadow:
      0 0 14px color-mix(in oklab, var(--accent) 80%, transparent),
      0 0 34px color-mix(in oklab, var(--accent) 45%, transparent);
  }
  .mode-kinetic .line:not(.active) {
    transform-origin: left center;
  }

  /* reveal: letters flow in like ink as they're sung; the next line waits as a faint ghost */
  .mode-reveal .line:not(.past):not(.active):not(.upcoming):not(:hover) {
    opacity: 0;
  }
  .mode-reveal .line.upcoming:not(:hover) {
    opacity: 0.12;
    filter: var(--edge,) blur(1.5px);
  }
  .mode-reveal .line.past {
    opacity: 0.3;
  }
  .mode-reveal .ch {
    opacity: var(--lp);
    transform: translateY(calc((1 - var(--lp)) * 0.28em * var(--fx))) scale(calc(0.92 + 0.08 * var(--lp)));
    transform-origin: 50% 100%;
    transition:
      opacity 0.4s cubic-bezier(0.4, 0, 0.2, 1),
      transform 0.65s cubic-bezier(0.22, 1, 0.36, 1);
  }
  /* with words on, the ghost lives on the letters, so it fades straight into the ink instead of the line flashing */
  .mode-reveal .line.upcoming:has(.ch):not(:hover) {
    opacity: 1;
  }
  .lyrics.mode-reveal .line.upcoming .ch {
    opacity: 0.12;
  }
  .mode-reveal .word.cur .ch {
    text-shadow: 0 0 22px color-mix(in oklab, var(--accent) 45%, transparent);
  }

  /* bounce: a ball arcs over the line and lands on each word as it starts */
  .mode-bounce .word {
    color: color-mix(in oklab, var(--ink) 40%, transparent);
    transition: color 0.3s cubic-bezier(0.4, 0, 0.2, 1);
  }
  .mode-bounce .word.on {
    color: var(--ink);
  }
  .mode-bounce .word.cur {
    color: color-mix(in oklab, var(--accent) 30%, var(--ink));
  }
  .ball {
    position: absolute;
    left: 0;
    top: 0;
    width: 0.17em;
    height: 0.17em;
    border-radius: 50%;
    background: color-mix(in oklab, var(--accent) 75%, var(--ink));
    box-shadow: 0 0 14px color-mix(in oklab, var(--accent) 70%, transparent);
    pointer-events: none;
    /* a hint of squash when it lands */
    transform: translate(calc(var(--bx) - 50%), calc(var(--by) - 0.1em - var(--lift) * 0.42em * var(--fx)))
      scale(calc(1.06 - 0.06 * var(--lift)), calc(0.94 + 0.06 * var(--lift)));
  }

  /* glance: just now and next, slow even glide, high contrast for reading from across the desk */
  .mode-glance .line {
    font-size: calc(var(--size) * 1.1);
    opacity: 0;
    transition:
      transform var(--dur) var(--ease),
      opacity 0.9s ease,
      text-shadow 0.9s ease,
      background-color 0.2s ease;
  }
  .mode-glance .line.upcoming {
    opacity: 0.4;
  }
  .mode-glance .line.active {
    opacity: 1;
    text-shadow: 0 2px 18px rgba(0, 0, 0, 0.5);
  }
  .mode-glance .line:hover {
    opacity: 0.65;
  }
  .lyrics.wd.mode-glance .line:not(.past):not(.active):not(.upcoming) {
    opacity: 0;
  }

  /* wave: sung letters light up and ripple; unsung ones sit flat and dim (the ripple scales with each letter's progress) */
  .mode-wave .ch {
    opacity: calc(0.3 + 0.7 * var(--lp));
    transition: opacity 0.25s ease;
  }
  .mode-wave .word.on .ch {
    animation: wave 1.5s ease-in-out infinite;
    animation-delay: calc(var(--i) * -0.11s);
  }
  /* the ripple settles flat as its line finishes, instead of snapping still */
  @property --live {
    syntax: "<number>";
    inherits: true;
    initial-value: 0;
  }
  .mode-wave .word {
    transition: --live 0.7s cubic-bezier(0.4, 0, 0.2, 1);
  }
  .mode-wave .line.active .word {
    --live: 1;
  }
  .mode-wave .word.cur .ch {
    text-shadow: 0 0 20px color-mix(in oklab, var(--accent) 50%, transparent);
  }
  @keyframes wave {
    0%,
    100% {
      transform: translateY(0);
    }
    50% {
      transform: translateY(calc(-0.14em * var(--lp) * var(--fx) * var(--live)));
    }
  }

  /* neon: unsung words are unlit tubes; each one glows up smoothly as it's sung and holds a steady glow.
     The tube's outline stays and lights up with the fill (dropping it mid-fade made every word dip, a flicker). */
  .mode-neon .line:not(.past) .word {
    color: color-mix(in oklab, var(--ink) 16%, transparent); /* a faint glass fill so unlit tubes read at a glance */
    -webkit-text-stroke: 1px color-mix(in oklab, var(--ink) 30%, transparent);
  }
  /* Lines still to come are unlit tubes too, so nothing switches look when a line starts: it just lights up as
     it's sung, and stays lit once sung. (The tube is set on the line, so far lines without word spans match.) */
  .mode-neon .line:not(.active):not(.past):not(.interlude) {
    color: color-mix(in oklab, var(--ink) 16%, transparent); /* a faint glass fill so unlit tubes read at a glance */
    -webkit-text-stroke: 1px var(--ink); /* the line's own dimming makes this match the current line's unlit tubes */
  }
  .lyrics.mode-neon .line:not(.active):not(.past) .word {
    color: color-mix(in oklab, var(--ink) 16%, transparent); /* a faint glass fill so unlit tubes read at a glance */
  }
  /* with words lit the line shows at full opacity, so its tubes take the unlit shade themselves; Sweep and Pop
     then fill inside the tubes */
  .lyrics.wd.mode-neon .line:not(.past):not(.interlude) {
    -webkit-text-stroke: 1px color-mix(in oklab, var(--ink) 30%, transparent);
  }
  /* a finished line's glow and tube outline fade out with it rather than cutting off (the outline used to vanish in
     one frame as the line ended, thinning every letter at once: a flicker) */
  .mode-neon .word {
    -webkit-text-stroke: 1px transparent;
    transition: color 0.5s ease, -webkit-text-stroke-color 0.5s ease, text-shadow 0.7s ease;
  }
  .mode-neon .line:not(.interlude) {
    -webkit-text-stroke: 1px transparent;
    transition:
      transform var(--dur) var(--ease),
      opacity 0.6s cubic-bezier(0.4, 0, 0.2, 1),
      filter 0.6s cubic-bezier(0.4, 0, 0.2, 1),
      text-shadow 0.6s cubic-bezier(0.4, 0, 0.2, 1),
      background-color 0.2s ease,
      color 0.35s ease,
      -webkit-text-stroke-color 0.5s ease;
  }
  /* The lit tube is a copy of the word laid over the unlit one and faded in by opacity, which the GPU does alone.
     Easing the color, outline and glow themselves had the word laid out, painted and redrawn with its 40px glow on
     every frame of every fade: a fifth of a CPU core while singing. The copies of the current and the next line
     get their layers ahead of time, so none is made at the moment a word starts. */
  .mode-neon .line.layer .word {
    position: relative;
  }
  .mode-neon .line.layer .word::after {
    content: attr(data-t) / "";
    position: absolute;
    inset: 0;
    color: var(--ink);
    -webkit-text-stroke: 1px var(--ink);
    text-shadow:
      0 0 4px var(--ink),
      0 0 16px var(--accent),
      0 0 40px color-mix(in oklab, var(--accent) 60%, transparent);
    opacity: 0;
    pointer-events: none;
    transition: opacity 0.4s ease;
  }
  .mode-neon .line.active .word::after,
  .mode-neon .line.upcoming .word::after {
    will-change: opacity;
  }
  .mode-neon .line:not(.past) .word.on::after {
    opacity: 1;
  }
  .mode-neon .line.past .word::after {
    transition-duration: 0.6s; /* goes out with its line */
  }
  /* typewriter: letters appear as they're sung, with a cursor on the one being typed; set in a mono face */
  .mode-typewriter .line {
    font-family: "Cascadia Mono", Consolas, "SF Mono", ui-monospace, monospace;
    font-size: calc(var(--size) * 0.9);
    letter-spacing: -0.01em;
  }
  .mode-typewriter .ch {
    --typing: calc(clamp(0, var(--lp) * 40, 1) * clamp(0, (1 - var(--lp)) * 40, 1)); /* 1 only mid-letter */
    /* untyped letters wait as a faint ghost (about as bright as the dim lines around it) instead of vanishing
       when the line starts, so the line types over itself rather than blinking out first */
    opacity: calc(0.3 + 0.7 * clamp(0, var(--lp) * 40, 1));
    box-shadow: 0.08em 0 0 0 color-mix(in oklab, var(--accent) calc(var(--typing) * 100%), transparent);
  }

  /* chroma: sung letters take on a rainbow that keeps flowing along the line; unsung ones wait dim */
  @property --hue {
    syntax: "<number>";
    inherits: true;
    initial-value: 0;
  }
  .mode-chroma .line.active {
    animation: hue-flow 7s linear infinite;
  }
  .still.mode-chroma .line.active {
    animation: none;
  }
  @keyframes hue-flow {
    to {
      --hue: 360;
    }
  }
  .mode-chroma .ch {
    opacity: calc(0.32 + 0.68 * var(--lp));
    transition: opacity 0.25s ease, color 0.6s ease, text-shadow 0.6s ease;
  }
  .mode-chroma .word.on .ch {
    color: oklch(0.84 0.15 calc(var(--hue) + var(--i) * 24));
  }
  .mode-chroma .word.cur .ch {
    text-shadow: 0 0 18px oklch(0.75 0.2 calc(var(--hue) + var(--i) * 24) / 0.6);
  }

  /* drop: unsung words hang a little above, tilted and faint; each one drops into place with a bounce */
  /* every line still to come hangs, so nothing jumps up when a line starts (its words are only waiting to drop) */
  .mode-drop .line:not(.past) .word {
    opacity: 0.25;
    transform: translateY(calc(-0.22em * var(--fx))) rotate(calc(-4deg * var(--fx)));
    transition:
      transform 0.6s cubic-bezier(0.34, 1.6, 0.5, 1),
      opacity 0.22s ease;
  }
  .mode-drop .line:not(.past) .word.on {
    opacity: 1;
    transform: none;
  }
  .mode-drop .word {
    transition:
      transform 0.6s cubic-bezier(0.22, 1, 0.36, 1),
      opacity 0.4s ease;
  }

  /* glitch: a word jolts in with a split of red and accent and a jitter, then settles crisp */
  .mode-glitch .line:not(.past) .word {
    color: color-mix(in oklab, var(--ink) 30%, transparent);
    transition: color 0.12s steps(2);
  }
  .mode-glitch .line:not(.past) .word.on {
    color: var(--ink);
  }
  .mode-glitch .line.active .word.cur {
    animation: glitch 0.42s steps(1) both;
  }
  @keyframes glitch {
    0% {
      transform: translate(calc(3px * var(--fx)), -1px) skewX(-8deg);
      text-shadow: calc(-4px * var(--fx)) 0 #ff2a6d, calc(4px * var(--fx)) 0 var(--accent);
      clip-path: inset(10% 0 35% 0);
    }
    20% {
      transform: translate(calc(-3px * var(--fx)), 1px);
      text-shadow: calc(3px * var(--fx)) 0 #ff2a6d, calc(-3px * var(--fx)) 0 var(--accent);
      clip-path: inset(45% 0 5% 0);
    }
    40% {
      transform: translate(calc(2px * var(--fx)), 0) skewX(5deg);
      text-shadow: calc(-2px * var(--fx)) 0 #ff2a6d, calc(2px * var(--fx)) 0 var(--accent);
      clip-path: none;
    }
    60% {
      transform: translate(calc(-1px * var(--fx)), 0);
      text-shadow: calc(1px * var(--fx)) 0 #ff2a6d, calc(-1px * var(--fx)) 0 var(--accent);
    }
    80%,
    100% {
      transform: none;
      text-shadow: 0 0 16px color-mix(in oklab, var(--accent) 40%, transparent);
    }
  }

  /* dream: words still to come wait soft and out of focus, a touch larger; each sharpens into place as it's sung.
     The blur is only on the current and next line (a blur per word on every line ahead would be heavy). */
  /* The blur, fade and scale ease through registered variables rather than filter/opacity/transform transitions:
     those ran on the compositor, which lifted each word onto its own GPU layer for the length of its fade and dropped
     it back after, re-drawing the word (a visible flick on every word). Same values and timing, drawn in place. */
  @property --dz-b {
    syntax: "<length>";
    inherits: false;
    initial-value: 0px;
  }
  @property --dz-o {
    syntax: "<number>";
    inherits: false;
    initial-value: 1;
  }
  @property --dz-s {
    syntax: "<number>";
    inherits: false;
    initial-value: 1;
  }
  .mode-dream .line:not(.past) .word {
    display: inline-block;
    --dz-o: 0.4;
    --dz-s: 1.05;
    filter: blur(var(--dz-b));
    opacity: var(--dz-o);
    transform: scale(var(--dz-s));
    transition:
      --dz-b 0.8s ease,
      --dz-o 0.8s ease,
      --dz-s 1s cubic-bezier(0.22, 1, 0.36, 1),
      text-shadow 0.8s ease;
  }
  .mode-dream .line.active .word,
  .mode-dream .line.upcoming .word {
    --dz-b: calc(2.5px * var(--fx));
  }
  .lyrics.mode-dream .line:not(.past) .word.on {
    --dz-b: 0px;
    --dz-o: 1;
    --dz-s: 1;
  }
  .mode-dream .line.active .word.cur {
    text-shadow: 0 0 24px color-mix(in oklab, var(--accent) 55%, transparent);
  }

  /* stamp: each word slams down from big and tilted, overshoots a hair and settles, as it's sung */
  .mode-stamp .line:not(.past) .word {
    display: inline-block;
    opacity: 0.22;
    transition: opacity 0.2s ease;
  }
  .mode-stamp .line:not(.past) .word.on {
    opacity: 1;
    animation: stamp 0.42s cubic-bezier(0.3, 0.9, 0.3, 1.25) both;
  }
  .mode-stamp .line.active .word.cur {
    text-shadow: 0 0 18px color-mix(in oklab, var(--accent) 45%, transparent);
  }
  @keyframes stamp {
    0% {
      opacity: 0;
      transform: scale(calc(1 + 0.8 * var(--fx))) rotate(-7deg);
    }
    55% {
      opacity: 1;
      transform: scale(0.94) rotate(1.5deg);
    }
    100% {
      transform: none;
    }
  }

  /* marker: a highlighter pen swipes behind each word as it's sung; the ink stays on, fainter, once the line is done */
  .mode-marker .word {
    --ink-hl: color-mix(in oklab, var(--accent) 45%, transparent);
    background: linear-gradient(var(--ink-hl), var(--ink-hl)) no-repeat 0 88% / calc(var(--p) * 100%) 42%;
    border-radius: 0.12em;
    -webkit-box-decoration-break: clone;
    box-decoration-break: clone;
  }
  .mode-marker .line:not(.past) .word:not(.on) {
    opacity: 0.45;
  }
  .mode-marker .line.past .word {
    --ink-hl: color-mix(in oklab, var(--accent) 20%, transparent);
  }

  /* jelly: each word squashes, springs up tall and wobbles to rest as it's sung */
  .mode-jelly .line:not(.past) .word {
    display: inline-block;
    opacity: 0.35;
    transform-origin: 50% 90%;
    transition: opacity 0.2s ease;
  }
  .mode-jelly .line:not(.past) .word.on {
    opacity: 1;
    animation: jelly 0.75s cubic-bezier(0.3, 0.7, 0.4, 1) both;
  }
  @keyframes jelly {
    25% {
      transform: scale(calc(1 + 0.25 * var(--fx)), calc(1 - 0.22 * var(--fx)));
    }
    45% {
      transform: scale(calc(1 - 0.12 * var(--fx)), calc(1 + 0.16 * var(--fx)));
    }
    65% {
      transform: scale(calc(1 + 0.05 * var(--fx)), calc(1 - 0.05 * var(--fx)));
    }
    100% {
      transform: none;
    }
  }

  /* flip: letters lie tipped back like the cards of a departures board and flip upright one by one as they're sung */
  .mode-flip .line {
    font-family: Bahnschrift, "DIN Alternate", "Segoe UI", sans-serif;
    letter-spacing: 0.02em;
  }
  .mode-flip .ch {
    --flip: calc(1 - var(--lp));
    opacity: calc(0.3 + 0.7 * var(--lp));
    transform: perspective(300px) rotateX(calc(-75deg * var(--flip) * var(--fx)));
    transform-origin: 50% 70%;
    color: color-mix(in oklab, var(--accent) calc(clamp(0, var(--lp) * (1 - var(--lp)) * 4, 1) * 70%), var(--ink));
  }

  /* Words of a finished line ease back to plain text as it leaves (lines still to come keep their unsung look). */
  .lyrics .line.past .word,
  .lyrics .line.past .w {
    --dim: var(--ink);
    color: var(--ink);
    transform: none;
    text-shadow: inherit; /* plain, or the Text edge shadow */
  }
  .lyrics .line.past .ch {
    opacity: 1;
    color: inherit; /* chroma's rainbow eases back to white */
    transform: none;
    text-shadow: inherit; /* plain, or the Text edge shadow */
    box-shadow: none;
  }

  .still .word,
  .still .w,
  .still .ch {
    animation: none;
    transition: none;
  }
  .noglow:not(.edge-shadow) .line,
  .noglow:not(.edge-shadow) .word,
  .noglow:not(.edge-shadow) .word::after,
  .noglow:not(.edge-shadow) .w,
  .noglow:not(.edge-shadow) .ch {
    text-shadow: none !important;
  }
  /* Glow off but Text edge on: keep just the edge shadow, everywhere */
  .noglow.edge-shadow .word,
  .noglow.edge-shadow .word::after,
  .noglow.edge-shadow .w,
  .noglow.edge-shadow .ch {
    text-shadow: inherit !important;
  }

  /* Text edge (Settings): a fine outline just outside the letters, or a soft shadow, in the accent color.
     The outline traces whatever is drawn, so it never covers the letters (a text stroke did, wherever they were
     see-through: unsung words and the sweep), and it lights up with each word as it's sung. */
  .lyrics.edge-outline {
    --edge: url(#helios-edge);
  }
  .defs {
    position: absolute;
    width: 0;
    height: 0;
  }
  .lyrics.edge-outline .line {
    filter: var(--edge);
  }
  .lyrics.edge-shadow .line {
    text-shadow:
      0 0.05em 0.16em color-mix(in oklab, var(--accent) 65%, #000),
      0 0 0.5em color-mix(in oklab, var(--accent) 40%, transparent);
  }
  .noglow .ball {
    box-shadow: none;
  }

  /* ---- plain (unsynced) ---- */
  .plain-scroll {
    height: 100%;
    overflow-y: auto;
    scrollbar-width: none;
    padding: 3rem 0.4em 40%;
    mask-image: linear-gradient(to bottom, transparent 0, #000 10%, #000 85%, transparent 100%);
  }
  .plain-scroll::-webkit-scrollbar {
    display: none;
  }
  .plain {
    margin: 0;
    padding: 0.2em 0;
    font-size: calc(var(--size) * 0.75);
    font-weight: 650;
    line-height: 1.35;
    opacity: 0.85;
  }
  .note {
    font-size: 0.68rem;
    text-transform: uppercase;
    letter-spacing: 0.14em;
    opacity: 0.45;
    margin: 0 0 1rem;
  }

  /* ---- states ---- */
  .status {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.8rem;
    color: rgba(255, 255, 255, 0.6);
    font-size: 1.05rem;
  }
  .status p {
    margin: 0;
  }
  .shimmer {
    align-items: stretch;
    gap: 1rem;
    padding: 0 0.4em;
  }
  .shimmer span {
    height: calc(var(--size) * 0.9);
    border-radius: 0.4em;
    background: linear-gradient(90deg, rgba(255, 255, 255, 0.05), rgba(255, 255, 255, 0.12), rgba(255, 255, 255, 0.05));
    background-size: 200% 100%;
    animation: shimmer 1.4s linear infinite;
  }
  .shimmer span:nth-child(2) {
    width: 78%;
  }
  .shimmer span:nth-child(3) {
    width: 56%;
  }
  @keyframes shimmer {
    to {
      background-position: -200% 0;
    }
  }
</style>
