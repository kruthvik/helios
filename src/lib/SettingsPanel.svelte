<script lang="ts">
  import { fly, fade } from "svelte/transition";
  import { cubicOut } from "svelte/easing";
  import { settings, defaults, resetSettings, view, calm, type Settings } from "./settings.svelte";
  import Icon from "./Icon.svelte";
  import { fmtOffset } from "./lyrics";
  import { ytId, saveBgFile } from "./media";
  import { SCENES, LYRIC_MODES, FX_NAMES, loadLooks, saveLook, applyLook, deleteLook, surprise } from "./looks.svelte";
  import { FX } from "./effects";
  let looks = $state(loadLooks());
  let lookName = $state("");
  let lookNote = $state("");

  let {
    onClose,
    onLogout,
    sleepLabel,
    onSleep,
  }: {
    onClose: () => void;
    onLogout: () => void;
    sleepLabel: string | null;
    onSleep: (v: number | "track" | null) => void;
  } = $props();

  type Key = keyof Settings;

  // ---- search: hides every row (and section) that doesn't mention the query, options included ("ocean", "outline") ----
  const JUMP = [["looks", "Looks"], ["lyrics", "Lyrics"], ["background", "Background"], ["effects", "Effects"], ["viz", "Visualizer"], ["layout", "Layout"], ["look", "Look"], ["behaviour", "Behaviour"], ["mini", "Miniplayer"], ["video", "Video"], ["game", "Game"], ["keys", "Keys"]];
  let query = $state("");
  let body = $state<HTMLElement>();
  let hits = $state(1);
  function filter() {
    if (!body) return;
    const q = query.trim().toLowerCase();
    let total = 0;
    for (const sec of body.querySelectorAll("section")) {
      const whole = !q || !!sec.querySelector("h3")?.textContent?.toLowerCase().includes(q);
      let shown = 0, prev = false;
      for (const el of sec.children as HTMLCollectionOf<HTMLElement>) {
        if (el.tagName === "H3") continue;
        // a hint goes with the setting above it; subheadings only make sense when nothing is filtered
        const hit: boolean = whole || (el.tagName !== "H4" && (el.textContent!.toLowerCase().includes(q) || (el.classList.contains("hint") && prev)));
        el.hidden = !hit;
        prev = hit;
        if (hit) shown++;
      }
      sec.hidden = !shown;
      total += shown;
    }
    hits = total;
  }
  $effect(() => {
    query;
    filter();
  });
  // settings that appear or vanish (a toggle opening its options) get filtered too
  $effect(() => {
    if (!body) return;
    const mo = new MutationObserver(() => query.trim() && filter());
    mo.observe(body, { childList: true, subtree: true });
    return () => mo.disconnect();
  });
  // your own background: one picture, GIF or video, kept in IndexedDB
  let fileInput = $state<HTMLInputElement>();
  let fileError = $state("");
  async function pickFile(e: Event & { currentTarget: HTMLInputElement }) {
    const f = e.currentTarget.files?.[0];
    e.currentTarget.value = "";
    if (!f) return;
    if (!/^(image|video)\//.test(f.type)) return void (fileError = "Pick a picture, GIF or video file.");
    try {
      await saveBgFile(f);
      fileError = "";
      settings.bgMediaName = f.name;
      view.bgFileRev++;
    } catch {
      fileError = "Couldn't store that file (the disk may be full).";
    }
  }
  const anchorLabel = (v: number) => (Math.abs(v - 0.5) < 0.02 ? "middle" : `${Math.round(v * 100)}% down`);
  const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
  const BG_NAMES: Record<string, string> = { mesh: "Gradient", blur: "Album" }; // where the menu name differs from the scene's
  const ICON_THEMES = ["rounded", "sharp", "solid", "thin"] as const;
  const MODES = LYRIC_MODES;
  const WORD_HINTS: Record<string, string> = {
    own: "Words light up the way this style does it, as they're sung.",
    sweep: "Each word fills in smoothly from left to right as it's sung, like karaoke.",
    pop: "Each word brightens and lifts a hair the moment it's sung.",
    off: "No word timing: the whole line lights up at once.",
  };
  // Word highlight for the current style. Scroll and Glance have no effect of their own: theirs is the sweep.
  type WordHl = Settings["wordHl"][string];
  let wordPlain = $derived(settings.lyricsMode === "scroll" || settings.lyricsMode === "glance");
  let wordShown = $derived.by(() => {
    const hl = settings.wordHl[settings.lyricsMode] ?? "own";
    return wordPlain && hl === "own" ? "sweep" : hl;
  });
  let wordOpts = $derived<[WordHl, string][]>([
    ...(wordPlain ? [] : [["own", MODES.find(([v]) => v === settings.lyricsMode)![1]] as [WordHl, string]]),
    ["sweep", "Sweep"],
    ["pop", "Pop"],
    ["off", "Off"],
  ]);
  const MODE_HINTS: Record<Settings["lyricsMode"], string> = {
    scroll: "Every line, scrolling with the song.",
    spotlight: "Bigger text with just the lines around it; the word being sung grows a little.",
    kinetic: "Words fill as they're sung; long-held notes light up letter by letter and float.",
    reveal: "Letters flow in like ink as they're sung; the next line waits as a faint ghost.",
    bounce: "A ball hops from word to word, landing on each one as it's sung.",
    wave: "Sung letters light up and ripple in a gentle wave across the line.",
    neon: "Each word glows up like a neon sign as it's sung; the rest wait as unlit tubes.",
    typewriter: "Letters type themselves in as they're sung, with a cursor marking the spot.",
    chroma: "Sung letters light up in a flowing rainbow that drifts across the line.",
    drop: "Each word drops into place with a little bounce as it's sung.",
    glitch: "Each word jolts in with a quick RGB-split glitch as it's sung, then settles crisp.",
    dream: "Words still to come wait soft and out of focus, and each one sharpens into place as it's sung.",
    stamp: "Each word slams down like a rubber stamp as it's sung, with a little kick.",
    flip: "Letters flip upright one after another as they're sung, like a split-flap departures board.",
    marker: "A highlighter swipes behind each word as it's sung, and the ink stays on the line.",
    jelly: "Each word squashes, springs up tall and wobbles to rest as it's sung.",
    glance: "Calm and readable from across the desk, for a second screen while gaming: big current line, the next one below, slow fades and nothing that moves.",
  };
</script>

<!-- shows only once a setting differs from its default; puts just that one back -->
{#snippet reset(label: string, key: Key)}
  {#if settings[key] !== defaults[key]}
    <button
      class="reset"
      title="Reset to default"
      aria-label="Reset {label} to default"
      transition:fade={{ duration: 150 }}
      onclick={(e) => (e.preventDefault(), ((settings[key] as unknown) = defaults[key]))}><Icon name="undo" size={12} /></button
    >
  {/if}
{/snippet}

{#snippet segmented<K extends Key>(label: string, key: K, options: [Settings[K], string][])}
  <div class="row">
    <span class="label">{label}{@render reset(label, key)}</span>
    <div class="seg" class:grid={options.length > 4} role="radiogroup" aria-label={label}>
      {#each options as [value, text]}
        <button role="radio" aria-checked={settings[key] === value} class:on={settings[key] === value} onclick={() => (settings[key] = value)}>
          {text}
        </button>
      {/each}
    </div>
  </div>
{/snippet}

{#snippet slider(label: string, key: Key, min: number, max: number, step: number, unit = "", fmt = (v: number) => String(v))}
  <label class="row">
    <span class="label">{label}{@render reset(label, key)}<span class="val">{fmt(settings[key] as number)}{unit}</span></span>
    <input
      type="range"
      {min}
      {max}
      {step}
      value={settings[key] as number}
      oninput={(e) => ((settings[key] as number) = Number(e.currentTarget.value))}
      style:--fill="{(((settings[key] as number) - min) / (max - min)) * 100}%"
    />
  </label>
{/snippet}

{#snippet picker(label: string, key: "bgSolid" | "bgTint" | "fxTint" | "vizTint" | "lyricsInk" | "lyricsGlowColor")}
  <label class="row inline">
    <span class="label">{label}{@render reset(label, key)}</span>
    <input type="color" bind:value={settings[key]} />
  </label>
{/snippet}

{#snippet toggle(label: string, key: Key)}
  <label class="row inline">
    <span class="label">{label}{@render reset(label, key)}</span>
    <input class="switch" type="checkbox" role="switch" checked={settings[key] as boolean} onchange={(e) => ((settings[key] as boolean) = e.currentTarget.checked)} />
  </label>
{/snippet}

<div class="scrim" transition:fade={{ duration: 180 }} onclick={onClose} role="presentation"></div>

<aside class="panel" transition:fly={{ x: 40, duration: 260, easing: cubicOut }} aria-label="Settings">
  <header>
    <h2>Customize</h2>
    <button class="icon-btn" aria-label="Close settings" onclick={onClose}><Icon name="close" size={18} /></button>
  </header>
  <div class="find">
    <input
      class="text search"
      type="search"
      placeholder="Search settings"
      aria-label="Search settings"
      bind:value={query}
      onkeydown={(e) => e.key === "Escape" && (query ? (query = "") : e.currentTarget.blur())}
    />
    {#if !query.trim()}
      <nav class="jump" aria-label="Jump to a section">
        {#each JUMP as [id, text]}
          <button onclick={() => body?.querySelector(`#set-${id}`)?.scrollIntoView({ behavior: calm() ? "auto" : "smooth", block: "start" })}>{text}</button>
        {/each}
      </nav>
    {/if}
  </div>

  <div class="body" bind:this={body}>
    <section id="set-looks">
      <h3>Looks</h3>
      <button class="ghost wide" onclick={() => (lookNote = surprise())}><Icon name="tune" size={15} /> Surprise me</button>
      {#if lookNote}<p class="hint active">{lookNote}</p>{/if}
      {#if Object.keys(looks).length}
        <div class="row">
          <span class="label">Your looks</span>
          <div class="looks">
            {#each Object.entries(looks) as [name, look] (name)}
              <span class="look">
                <button title="Switch to {name}" onclick={() => (applyLook(look), (lookNote = `Switched to ${name}`))}>{name}</button>
                <button class="x" aria-label="Delete {name}" title="Delete" onclick={() => (looks = deleteLook(name))}><Icon name="close" size={11} /></button>
              </span>
            {/each}
          </div>
        </div>
      {/if}
      <form class="row inline" onsubmit={(e) => (e.preventDefault(), lookName.trim() && ((looks = saveLook(lookName.trim())), (lookNote = `Saved "${lookName.trim()}"`), (lookName = "")))}>
        <input class="text" placeholder="Name this look" aria-label="Name for the current look" maxlength="24" bind:value={lookName} />
        <button class="ghost" disabled={!lookName.trim()}>Save</button>
      </form>
      <p class="hint">Saves the background, effects, lyric style, layout and colors as they are now, to switch back any time. R in the player picks a random look.</p>
    </section>
    {#if query.trim() && !hits}<p class="empty">Nothing matches "{query.trim()}".</p>{/if}
    <section id="set-lyrics">
      <h3>Lyrics</h3>
      <h4>Motion & highlight</h4>
      {@render segmented("Style", "lyricsMode", MODES)}
      <p class="hint">{MODE_HINTS[settings.lyricsMode]}</p>
      <!-- remembered per lyric style; Scroll and Glance have no effect of their own, so theirs is the sweep -->
      <div class="row">
        <span class="label">Word highlight</span>
        <div class="seg" role="radiogroup" aria-label="Word highlight">
          {#each wordOpts as [v, text]}
            <button role="radio" aria-checked={wordShown === v} class:on={wordShown === v} onclick={() => (settings.wordHl = { ...settings.wordHl, [settings.lyricsMode]: v })}>{text}</button>
          {/each}
        </div>
      </div>
      <p class="hint">{WORD_HINTS[wordShown]} Remembered for each style.</p>
      {#if settings.lyricsMode !== "glance" && settings.lyricsMode !== "scroll"}
        {@render slider("Effect strength", "lyricsFx", 0.5, 2, 0.1, "×", (v) => v.toFixed(1))}
      {/if}
      {@render segmented("Animation", "lyricsMotion", [["spring", "Spring"], ["smooth", "Smooth"], ["instant", "Instant"]])}
      {#if settings.lyricsMode === "scroll"}
        {@render toggle("Focus current line", "lyricsFocus")}
      {/if}

      <h4>Text</h4>
      {@render slider("Text size", "lyricsSize", 16, 64, 1, "px")}
      {@render segmented("Align", "lyricsAlign", [["left", "Left"], ["center", "Center"], ["right", "Right"]])}
      {@render segmented("Text color", "lyricsColor", [["white", "White"], ["tint", "Soft tint"], ["song", "From song"], ["custom", "Custom"]])}
      {#if settings.lyricsColor === "custom"}{@render picker("Text color", "lyricsInk")}{/if}
      {@render toggle("Glow", "lyricsGlow")}
      {@render segmented("Glow & highlight color", "lyricsGlowFrom", [["accent", "Accent"], ["song", "From song"], ["custom", "Custom"]])}
      {#if settings.lyricsGlowFrom === "custom"}{@render picker("Glow color", "lyricsGlowColor")}{/if}
      {@render segmented("Text edge", "lyricsEdge", [["none", "Off"], ["outline", "Outline"], ["shadow", "Shadow"]])}

      <h4>Position & timing</h4>
      {@render slider("Current line height", "lyricsAnchor", 0.15, 0.75, 0.01, "", anchorLabel)}
      {@render slider("Current line height in TV mode", "lyricsAnchorTv", 0.15, 0.75, 0.01, "", anchorLabel)}
      <p class="hint">Where the line being sung sits: slide right to move it lower. TV mode keeps its own, since its lyrics sit above the player bar.</p>
      {@render slider("Global timing", "lyricsOffsetMs", -2000, 2000, 50, "", fmtOffset)}
      <p class="hint">Moves every song's lyrics. Lyrics showing up after the singing: slide right (earlier). Showing up before it: slide left (later). To fix just one song, hover the lyrics and use Earlier / Later, or press [ and ].</p>
      {@render toggle("Dots during instrumental breaks", "lyricsInterludes")}
      {@render toggle("Hide lyrics when a song has none", "hideNoLyrics")}
      {#if settings.hideNoLyrics}<p class="hint">Songs without lyrics (or instrumentals) show just the player; your layout comes back with the next song that has lyrics.</p>{/if}
    </section>

    <section id="set-sources">
      <h3>Lyrics sources</h3>
      {@render toggle("LRCLIB (line synced)", "sourceLrclib")}
      {@render toggle("NetEase (often word synced)", "sourceNetease")}
      {@render toggle("Prefer word-by-word timing", "preferWordSync")}
      {@render segmented("When tied, prefer", "sourceOrder", [["lrclib", "LRCLIB"], ["netease", "NetEase"]])}
    </section>

    <section id="set-background">
      <h3>Background</h3>
      {@render segmented("Style", "bgMode", SCENES)}
      {#if settings.bgMode === "media"}
        {@render segmented("Source", "bgMediaSrc", [["file", "Picture, GIF or video"], ["youtube", "YouTube"]])}
        {#if settings.bgMediaSrc === "file"}
          <input bind:this={fileInput} type="file" accept="image/*,video/*" hidden onchange={pickFile} />
          <button class="ghost wide" onclick={() => fileInput?.click()}>{settings.bgMediaName ? `${settings.bgMediaName} · Change` : "Choose a file"}</button>
          {#if fileError}<p class="hint active">{fileError}</p>{/if}
        {:else}
          <label class="row">
            <span class="label">YouTube link</span>
            <input class="text" type="url" placeholder="https://youtube.com/watch?v=…" bind:value={settings.bgYt} />
          </label>
          {#if settings.bgYt.trim() && !ytId(settings.bgYt)}<p class="hint active">That doesn't look like a YouTube video link.</p>{/if}
        {/if}
        {@render segmented("Fit", "bgMediaFit", [["cover", "Fill the window"], ["contain", "Show it whole"]])}
        {@render slider("Blur", "bgMediaBlur", 0, 40, 1, "px")}
        {@render toggle("Slow pan & zoom", "bgMediaDrift")}
        {@render slider("Video speed", "bgMediaRate", 0.25, 2, 0.05, "×", (v) => v.toFixed(2))}
        <p class="hint">Plays muted. Saturation, color shift, tint, dim and vignette below work on it too; Speed sets how fast it pans, and Still pauses a video.</p>
      {/if}
      {#if settings.bgMode !== "solid"}
        {@render slider("Speed", "bgMotion", 0, 3, 0.1, "×", (v) => (v === 0 ? "Still " : v.toFixed(1)))}
        {@render slider("Movement", "bgIntensity", 0, 2.5, 0.1, "×", (v) => v.toFixed(1))}
        {@render slider("Saturation", "bgSaturation", 0.4, 2, 0.05, "", (v) => v.toFixed(2))}
      {/if}
      {#if settings.bgMode === "blur"}
        {@render slider("Blur", "bgBlur", 0, 160, 2, "px")}
      {/if}
      {#if settings.bgMode === "solid"}
        {@render segmented("Color", "bgSolidFrom", [["album", "From song"], ["custom", "Custom"]])}
        {#if settings.bgSolidFrom === "custom"}{@render picker("Color", "bgSolid")}{:else}<p class="hint">The main color of each song's cover, fading from song to song. Dim darkens it.</p>{/if}
      {/if}
      {#if settings.bgMode !== "solid"}
        {@render slider("Frame rate", "bgFps", 10, 120, 5, "", (v) => (v >= 120 ? "Max" : `${v} fps`))}
        {@render toggle("Save power while Helios is in the background", "ecoUnfocused")}
        <p class="hint">The background and effects drop to 20 fps while another window is in front, and come straight back when you return.</p>
      {/if}
      {#if settings.bgMode === "auto"}<p class="hint">Picks a scene to suit each song's colors{view.autoBg ? `; this song: ${BG_NAMES[view.autoBg] ?? cap(view.autoBg)}` : ""}.</p>{/if}
      {#if settings.bgMode !== "solid"}
        {@render slider("Color shift", "bgHue", -180, 180, 5, "°", (v) => (v > 0 ? `+${v}` : String(v)))}
        {@render segmented("Tint from", "bgTintFrom", [["album", "From song"], ["custom", "Custom"]])}
        {#if settings.bgTintFrom === "custom"}
          {@render picker("Tint color", "bgTint")}
        {:else}
          <p class="hint">Tints toward the most vivid color of each album's cover, so every song gets its own wash.</p>
        {/if}
        {@render slider("Tint", "bgTintAmount", 0, 1, 0.05, "%", (v) => String(Math.round(v * 100)))}
      {/if}
      {@render slider("Dim", "bgDim", 0, 0.85, 0.01, "%", (v) => String(Math.round(v * 100)))}
      {@render slider("Vignette", "bgVignette", 0, 0.9, 0.05, "%", (v) => String(Math.round(v * 100)))}
      {@render toggle("Film grain", "grain")}
      <h4>Music video</h4>
      {@render segmented("Music video as background", "bgVideo", [["off", "Off"], ["stretch", "Whole video"], ["clips", "Clips"]])}
      {#if settings.bgVideo !== "off"}
        <p class="hint">
          {settings.bgVideo === "stretch"
            ? "The whole video, sped up or slowed down so it lasts exactly as long as the song."
            : "Short clips from all through the video, cut together in time with the song."}
          Muted, it pauses with the song and replaces the style above whenever a song has an official video.
        </p>
        {#if settings.bgVideo === "clips"}{@render slider("Clip length", "bgClipSec", 1, 12, 0.5, "s")}{/if}
        {@render toggle("Keep the Hide video button showing while idle", "mvSkipAlways")}
        <p class="hint">The Hide video button (bottom right) turns the video background off for just that song; Helios remembers.</p>
      {/if}
    </section>

    <section id="set-effects">
      <h3>Effects</h3>
      {@render toggle("Auto: pick effects to suit each song's colors", "fxAuto")}
      {#if settings.fxAuto}<p class="hint">Each song gets its own mix of effects, each tuned to its colors{view.autoFx.length ? `; this song: ${view.autoFx.map(cap).join(" + ")}` : ""}. The sliders below still scale the whole mix.</p>{/if}
      <div class="row" class:muted={settings.fxAuto}>
        <span class="label"
          >Pick any mix{#if settings.fxList.length}<button
              class="reset"
              title="Turn all effects off"
              aria-label="Turn all effects off"
              transition:fade={{ duration: 150 }}
              onclick={() => (settings.fxList = [])}><Icon name="undo" size={12} /></button
            >{/if}</span
        >
        <div class="seg grid" role="group" aria-label="Effects">
          {#each FX.map((v) => [v, FX_NAMES[v]] as const) as [v, l]}
            <button
              class:on={settings.fxAuto ? view.autoFx.includes(v) : settings.fxList.includes(v)}
              aria-pressed={settings.fxList.includes(v)}
              onclick={() => ((settings.fxAuto = false), (settings.fxList = settings.fxList.includes(v) ? settings.fxList.filter((x) => x !== v) : [...settings.fxList, v]))}
            >{l}</button>
          {/each}
        </div>
      </div>
      {#if settings.fxList.length || settings.fxAuto}
        {@render slider("Amount", "fxAmount", 0.2, 3, 0.1, "×", (v) => v.toFixed(1))}
        {@render slider("Speed", "fxSpeed", 0.2, 3, 0.1, "×", (v) => v.toFixed(1))}
        {@render slider("Size", "fxSize", 0.4, 2.5, 0.1, "×", (v) => v.toFixed(1))}
        {@render segmented("Color", "fxColor", [["album", "From song"], ["white", "White"], ["tint", "Custom"]])}
        {#if settings.fxColor === "tint"}
          {@render picker("Effect color", "fxTint")}
        {/if}
        {@render toggle("Disable effects when a music video is playing", "fxOffMv")}
        <p class="hint">Effects run only while music plays, follow the background frame rate, and switch off with Reduce motion.</p>
      {/if}
    </section>

    <section id="set-viz">
      <h3>Audio visualizer</h3>
      {@render toggle("Show the music's sound bands", "vizOn")}
      {#if settings.vizOn}
        {#if view.vizError}<p class="hint active">Couldn't listen to the audio output: {view.vizError}</p>{/if}
        {@render segmented("Style", "vizStyle", [["wave", "Wave"], ["bars", "Bars"], ["mirror", "Mirror"]])}
        {@render segmented("Color", "vizColor", [["album", "From song"], ["custom", "Custom"]])}
        {#if settings.vizColor === "custom"}
          {@render picker("Visualizer color", "vizTint")}
        {/if}
        {@render slider("Height", "vizHeight", 0.08, 0.75, 0.01, "%", (v) => String(Math.round(v * 100)))}
        {@render segmented("Starts from", "vizOnBar", [[false, "Bottom of the window"], [true, "Top of the TV player bar"]])}
        {@render slider("Opacity", "vizOpacity", 0.15, 1, 0.05, "%", (v) => String(Math.round(v * 100)))}
        {@render slider("Sensitivity", "vizGain", 0.5, 2, 0.05, "×", (v) => v.toFixed(2))}
        {@render slider("Smoothness", "vizSmooth", 0, 1, 0.05, "%", (v) => String(Math.round(v * 100)))}
        {@render toggle("Background pulses with the beat", "vizPulse")}
        {#if settings.vizPulse}{@render slider("Pulse strength", "vizPulseAmount", 0.25, 3, 0.05, "×", (v) => v.toFixed(2))}{/if}
        <p class="hint">Reacts to everything your PC is playing, not just Spotify. Nothing is recorded; it rests when there's silence, and switches off with Reduce motion or game mode's "Turn off effects".</p>
      {/if}
    </section>
    <section id="set-layout">
      <h3>Layout & size</h3>
      {@render segmented("Layout", "layout", [["lyrics-right", "Lyrics right"], ["lyrics-left", "Lyrics left"], ["header", "Header"], ["corner", "Corner"], ["player-only", "Player"], ["lyrics-only", "Focus"], ["tv", "TV"]])}
      {#if settings.layout === "header"}<p class="hint">A slim now-playing strip on top with the lyrics centered below it. Good for tall windows and vertical screens.</p>{/if}
      {#if settings.layout === "corner"}<p class="hint">The lyrics take the middle; the player shrinks to a small glass card in the bottom-left. Made for video and picture backgrounds.</p>{/if}
      {#if settings.layout === "lyrics-right" || settings.layout === "lyrics-left"}
        <button class="ghost wide" onclick={() => (settings.layout = settings.layout === "lyrics-right" ? "lyrics-left" : "lyrics-right")}>
          <Icon name="swap" size={15} /> Swap sides
        </button>
        {@render slider("Lyrics distance", "lyricsSpace", 0, 40, 0.5, "", (v) => v.toFixed(1))}
        {@render slider("Lyrics width", "lyricsWidth", 360, 1200, 20, "px")}
      {/if}
      {@render slider("Interface scale", "uiScale", 0.75, 1.5, 0.05, "%", (v) => String(Math.round(v * 100)))}
      {@render slider("Album art", "artSize", 160, 520, 10, "px")}
      {@render slider("Art corners", "artRadius", 0, 60, 1, "px")}
      {@render toggle("Art shadow", "artShadow")}
      {@render toggle("Art glow in the song's color", "artGlow")}
    </section>

    <section id="set-look">
      <h3>Look</h3>
      <div class="row inline">
        <span class="label">Accent{@render reset("Accent", "accent")}</span>
        <div class="accent">
          <button class="chip" class:on={settings.accent === "auto"} onclick={() => (settings.accent = "auto")}>From song</button>
          <input
            type="color"
            aria-label="Custom accent color"
            value={settings.accent === "auto" ? "#1db954" : settings.accent}
            oninput={(e) => (settings.accent = e.currentTarget.value)}
          />
        </div>
      </div>
      <div class="row">
        <span class="label">Icons{@render reset("Icons", "iconTheme")}</span>
        <div class="icon-themes" role="radiogroup" aria-label="Icon theme">
          {#each ICON_THEMES as t}
            <button role="radio" aria-checked={settings.iconTheme === t} class:on={settings.iconTheme === t} onclick={() => (settings.iconTheme = t)}>
              <span class="preview {t}">
                <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path class="f" d="M7.5 4.8v14.4l12-7.2z" /></svg>
                <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M16 4h4v4M4 20 20 4M20 16v4h-4M14.5 14.5 20 20M4 4l5 5" /></svg>
              </span>
              {t}
            </button>
          {/each}
        </div>
      </div>
      {@render segmented("Play button", "playShape", [["circle", "Circle"], ["squircle", "Squircle"], ["bare", "Bare"]])}
      {@render segmented("Font", "font", [["segoe", "Clean"], ["geometric", "Geometric"], ["serif", "Serif"], ["mono", "Mono"]])}
      {@render toggle("Reduce motion", "reduceMotion")}
    </section>

    <section id="set-topbar">
      <h3>Top bar</h3>
      {@render segmented("Side", "toolbarSide", [["right", "Right"], ["left", "Left"]])}
      {@render toggle("Miniplayer button", "toolMini")}
      {@render toggle("Lyrics button", "toolLyrics")}
      {@render toggle("Queue button", "toolQueue")}
      {@render toggle("Fullscreen button", "toolFullscreen")}
      <p class="hint">Customize always stays so you can find your way back. Every button also has a shortcut below.</p>
    </section>

    <section id="set-behaviour">
      <h3>Behaviour</h3>
      {@render toggle("Start playing when I press Play here", "playOnStart")}
      {@render toggle("Hide controls when idle", "autoHide")}
      {#if settings.autoHide}
        {@render slider("Hide after", "hideDelay", 1, 10, 0.5, "s")}
        {@render toggle("Hide cursor too", "hideCursor")}
      {/if}
      {@render toggle("Hide top-right icons when idle", "toolbarHide")}
      {#if settings.toolbarHide}
        {@render toggle("Fade them to faint instead", "toolbarDim")}
      {/if}
      {@render toggle("Show time remaining", "showRemaining")}
      {@render toggle("Show what's up next", "showUpNext")}
      {@render toggle("Media keys & Windows media overlay", "mediaKeys")}
      {@render toggle("Always on top", "alwaysOnTop")}
      {@render toggle("Limit memory use", "memLimit")}
      {#if settings.memLimit}
        {@render slider("Memory limit", "memLimitMb", 300, 1000, 50, " MB")}
      {/if}
    </section>

    <section id="set-mini">
      <h3>Miniplayer</h3>
      <p class="hint">A small always-handy player for a second screen or while gaming (P). Only the miniplayer runs, the background drops to 15 fps, and lyrics update just once per line.</p>
      {@render toggle("Show lyrics", "miniLyrics")}
      {@render toggle("Keep on top of other windows", "miniOnTop")}
      {#if settings.miniLyrics}
        {@render toggle("Show the next line", "miniNext")}
        {@render toggle("Center the lyrics", "miniCenter")}
        {@render slider("Lyrics size", "miniTextSize", 0.8, 1.5, 0.05, "%", (v) => String(Math.round(v * 100)))}
      {/if}
      {@render slider("Background darkness", "miniWash", 0, 0.8, 0.01, "%", (v) => String(Math.round(v * 100)))}
    </section>

    <section id="set-video">
      <h3>Music videos</h3>
      {@render toggle("Offer music videos", "videoEnabled")}
      {#if settings.videoEnabled}
        <p class="hint">When a song has an official video on YouTube, a "Music video" button appears on the album art.</p>
        {@render slider("Video size", "videoSize", 0.6, 1, 0.01, "%", (v) => String(Math.round(v * 100)))}
        {@render toggle("Play music videos automatically", "videoAutoplay")}
        {@render toggle("Resume music when the video closes", "resumeAfterVideo")}
        {@render toggle("Prefer HD", "videoHd")}
        <p class="hint">Best effort: YouTube mostly picks quality from the video's size on screen, so a bigger video (or fullscreen) helps most. You can always use the gear in the video.</p>
        {@render toggle("Lyrics on the video", "videoLyrics")}
        {#if settings.videoLyrics}
          {@render slider("Lyrics size", "videoLyricsSize", 0.7, 1.6, 0.05, "%", (v) => String(Math.round(v * 100)))}
          <p class="hint">Lyric videos are already skipped. If a video has its own lyrics or the timing is off (intros, skits), use the buttons beside the video; Helios remembers per video.</p>
        {/if}
      {/if}
    </section>

    <section id="set-game">
      <h3>Game mode</h3>
      {@render toggle("Game mode", "gameMode")}
      <p class="hint">Keeps Helios light while you play. Press G anywhere, even in the miniplayer. Pick what it changes:</p>
      {@render toggle("Freeze the moving background", "gmStillBg")}
      {@render toggle("Turn off effects", "gmNoFx")}
      {@render toggle("Instant animations", "gmMotion")}
      {@render toggle("No blur (frosted glass, lyric focus)", "gmNoBlur")}
      {@render toggle("No film grain", "gmNoGrain")}
      {@render toggle("Pause visuals while the game is in front", "gmUnfocused")}
    </section>

    <section id="set-sleep">
      <h3>Sleep timer</h3>
      <div class="seg" role="radiogroup" aria-label="Sleep timer">
        {#each [[null, "Off"], [15, "15m"], [30, "30m"], [60, "1h"], ["track", "End of song"]] as [v, text]}
          {@const on = v === null ? !sleepLabel : false}
          <button role="radio" aria-checked={on} class:on onclick={() => onSleep(v as number | "track" | null)}>{text}</button>
        {/each}
      </div>
      {#if sleepLabel}<p class="hint active">{sleepLabel}</p>{/if}
    </section>

    <section id="set-keys">
      <h3>Shortcuts</h3>
      <dl class="keys">
        {#each [["Space", "Play / pause"], ["← →", "Seek 5 seconds"], ["Shift ← →", "Previous / next track"], ["↑ ↓", "Volume"], ["M", "Mute"], ["L", "Show / hide lyrics"], ["Z", "Focus mode (lyrics only)"], ["G", "Game mode"], ["T", "TV mode (lyrics up top, player bar along the bottom)"], ["S", "Swap sides"], ["V", "Music video"], ["F", "Fullscreen"], ["P", "Miniplayer"], ["C", "Copy song link"], ["[ ]", "Lyrics 0.1s earlier / later for this song"], ["Q", "Queue"], [",", "Settings"], ["B / Shift B", "Next / previous background"], ["Y / Shift Y", "Next / previous lyric style"], ["E", "Effects on / off"], ["R", "Surprise me: a random look"], ["Esc", "Close panels / video"]] as [k, v]}
          <dt><kbd>{k}</kbd></dt>
          <dd>{v}</dd>
        {/each}
      </dl>
    </section>
  </div>

  <footer>
    <button class="ghost" onclick={resetSettings}>Reset to defaults</button>
    <button class="ghost danger" onclick={onLogout}><Icon name="logout" size={16} /> Sign out</button>
  </footer>
</aside>

<style>
  .scrim {
    position: fixed;
    inset: 0;
    z-index: 40;
    background: rgba(0, 0, 0, 0.25);
  }
  .panel {
    position: fixed;
    top: 10px;
    right: 10px;
    bottom: 10px;
    z-index: 50;
    width: min(360px, calc(100vw - 20px));
    display: flex;
    flex-direction: column;
    background: rgba(18, 18, 22, 0.72);
    backdrop-filter: blur(28px) saturate(1.4);
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 16px;
    box-shadow: 0 24px 60px rgba(0, 0, 0, 0.45);
    overflow: hidden;
  }
  header,
  footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.9rem 1rem;
  }
  header {
    border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  }
  footer {
    border-top: 1px solid rgba(255, 255, 255, 0.06);
    gap: 0.5rem;
  }
  h2 {
    margin: 0;
    font-size: 1rem;
    font-weight: 650;
    letter-spacing: 0.01em;
  }
  h3 {
    margin: 0 0 0.6rem;
    font-size: 0.68rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.14em;
    color: rgba(255, 255, 255, 0.45);
  }
  .find {
    padding: 0.7rem 1rem 0.2rem;
  }
  .search {
    width: 100%;
    box-sizing: border-box;
  }
  .jump {
    display: flex;
    flex-wrap: wrap;
    gap: 0.3rem;
    margin-top: 0.55rem;
  }
  .jump button {
    padding: 0.22rem 0.55rem;
    border-radius: 999px;
    font-size: 0.7rem;
    background: rgba(255, 255, 255, 0.06);
    color: rgba(255, 255, 255, 0.65);
    transition: background 0.15s, color 0.15s;
  }
  .jump button:hover {
    background: rgba(255, 255, 255, 0.13);
    color: #fff;
  }
  .body :global([hidden]) {
    display: none !important;
  }
  .empty {
    margin: 1.5rem 0;
    text-align: center;
    font-size: 0.8rem;
    color: rgba(255, 255, 255, 0.45);
  }
  h4 {
    margin: 0.9rem 0 0.55rem;
    font-size: 0.74rem;
    font-weight: 650;
    color: rgba(255, 255, 255, 0.6);
  }
  h3 + h4 {
    margin-top: 0;
  }
  section {
    scroll-margin-top: 0.5rem;
  }
  .body {
    flex: 1;
    overflow-y: auto;
    padding: 0.5rem 1rem 1rem;
    scrollbar-width: thin;
    scrollbar-color: rgba(255, 255, 255, 0.15) transparent;
  }
  section {
    padding: 0.85rem 0;
  }
  section + section {
    border-top: 1px solid rgba(255, 255, 255, 0.05);
  }
  .row {
    display: flex;
    flex-direction: column;
    gap: 0.45rem;
    margin-bottom: 0.8rem;
  }
  .row.inline {
    flex-direction: row;
    align-items: center;
    justify-content: space-between;
  }
  .label {
    display: flex;
    justify-content: space-between;
    font-size: 0.82rem;
    color: rgba(255, 255, 255, 0.82);
  }
  .val {
    font-variant-numeric: tabular-nums;
    color: rgba(255, 255, 255, 0.45);
  }

  .seg {
    display: flex;
    flex-wrap: wrap;
    padding: 3px;
    gap: 2px;
    background: rgba(255, 255, 255, 0.06);
    border-radius: 9px;
  }
  .seg button {
    flex: 1;
    padding: 0.38rem 0.3rem;
    font-size: 0.76rem;
    border-radius: 7px;
    color: rgba(255, 255, 255, 0.65);
    transition: background 0.15s, color 0.15s;
  }
  .seg button:hover {
    color: #fff;
  }
  .seg button.on {
    background: rgba(255, 255, 255, 0.14);
    color: #fff;
  }
  /* long pickers (styles, backgrounds, effects): equal tiles in tidy columns instead of ragged wrapped rows */
  /* Auto is choosing: the manual picks step back (clicking one switches back to manual) */
  .row.muted .seg {
    opacity: 0.55;
  }
  .seg.grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(5.6rem, 1fr));
    gap: 3px;
    padding: 4px;
    border-radius: 11px;
  }
  .seg.grid button {
    min-height: 2.1rem;
    padding: 0.42rem 0.4rem;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    background: rgba(255, 255, 255, 0.03);
    transition: background 0.15s, color 0.15s, box-shadow 0.15s;
  }
  .seg.grid button:hover {
    background: rgba(255, 255, 255, 0.08);
  }
  .seg.grid button.on {
    background: color-mix(in oklab, var(--accent, #fff) 22%, rgba(255, 255, 255, 0.08));
    box-shadow: inset 0 0 0 1px color-mix(in oklab, var(--accent, #fff) 55%, transparent);
  }

  .reset {
    display: inline-grid;
    place-items: center;
    width: 18px;
    height: 18px;
    margin-left: 0.35rem;
    vertical-align: -3px;
    border-radius: 50%;
    color: rgba(255, 255, 255, 0.45);
    transition: color 0.15s, background 0.15s;
  }
  .reset:hover,
  .reset:focus-visible {
    color: #fff;
    background: rgba(255, 255, 255, 0.12);
  }
  .switch {
    appearance: none;
    width: 34px;
    height: 20px;
    border-radius: 999px;
    background: rgba(255, 255, 255, 0.18);
    position: relative;
    cursor: pointer;
    transition: background 0.2s;
    margin: 0;
  }
  .switch::after {
    content: "";
    position: absolute;
    top: 3px;
    left: 3px;
    width: 14px;
    height: 14px;
    border-radius: 50%;
    background: #fff;
    transition: transform 0.2s cubic-bezier(0.2, 0.8, 0.2, 1);
  }
  .switch:checked {
    background: var(--accent);
  }
  .switch:checked::after {
    transform: translateX(14px);
  }
  .switch:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }

  input[type="color"] {
    width: 34px;
    height: 24px;
    padding: 0;
    border: 1px solid rgba(255, 255, 255, 0.15);
    border-radius: 6px;
    background: none;
    cursor: pointer;
  }
  input[type="color"]::-webkit-color-swatch-wrapper {
    padding: 2px;
  }
  input[type="color"]::-webkit-color-swatch {
    border: none;
    border-radius: 4px;
  }
  .accent {
    display: flex;
    gap: 0.5rem;
    align-items: center;
  }
  .chip {
    font-size: 0.74rem;
    padding: 0.3rem 0.65rem;
    border-radius: 999px;
    background: rgba(255, 255, 255, 0.06);
    color: rgba(255, 255, 255, 0.7);
  }
  .chip.on {
    background: rgba(255, 255, 255, 0.16);
    color: #fff;
  }

  .icon-themes {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 6px;
  }
  .icon-themes button {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.35rem;
    padding: 0.55rem 0.2rem;
    font-size: 0.7rem;
    text-transform: capitalize;
    border-radius: 9px;
    background: rgba(255, 255, 255, 0.05);
    color: rgba(255, 255, 255, 0.65);
    border: 1px solid transparent;
  }
  .icon-themes button.on {
    border-color: var(--accent);
    color: #fff;
  }
  .preview {
    display: flex;
    gap: 4px;
  }
  .preview svg {
    fill: none;
    stroke: currentColor;
    stroke-width: 2;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
  .preview svg .f {
    fill: currentColor;
  }
  .preview.sharp svg {
    stroke-linecap: square;
    stroke-linejoin: miter;
  }
  .preview.solid svg {
    stroke-width: 2.6;
  }
  .preview.thin svg {
    stroke-width: 1.4;
  }
  .preview.thin svg .f {
    fill: none;
  }

  .looks {
    display: flex;
    flex-wrap: wrap;
    gap: 0.35rem;
  }
  .look {
    display: inline-flex;
    align-items: center;
    border-radius: 999px;
    background: rgba(255, 255, 255, 0.07);
    font-size: 0.78rem;
  }
  .look button {
    padding: 0.3rem 0.2rem 0.3rem 0.7rem;
  }
  .look .x {
    display: grid;
    padding: 0.3rem 0.5rem 0.3rem 0.3rem;
    opacity: 0.5;
  }
  .look .x:hover {
    opacity: 1;
  }
  form.row .text {
    flex: 1;
    min-width: 0;
  }
  .hint {
    margin: -0.2rem 0 0.6rem;
    font-size: 0.74rem;
    line-height: 1.45;
    color: rgba(255, 255, 255, 0.45);
  }
  .hint.active {
    margin-top: 0.6rem;
    color: var(--accent);
  }
  .link {
    color: var(--accent);
    text-decoration: underline;
    font-size: inherit;
  }
  .text {
    padding: 0.5rem 0.65rem;
    border-radius: 8px;
    border: 1px solid rgba(255, 255, 255, 0.1);
    background: rgba(255, 255, 255, 0.05);
    color: #fff;
    font: inherit;
    font-size: 0.8rem;
    outline: none;
    user-select: text;
  }
  .text:focus {
    border-color: var(--accent);
  }
  .wide {
    width: 100%;
    justify-content: center;
    margin-bottom: 0.8rem;
    background: rgba(255, 255, 255, 0.06);
  }
  .keys {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 0.45rem 0.8rem;
    margin: 0;
    font-size: 0.8rem;
  }
  .keys dt {
    margin: 0;
  }
  .keys dd {
    margin: 0;
    color: rgba(255, 255, 255, 0.65);
  }
  kbd {
    display: inline-block;
    min-width: 1.4em;
    padding: 0.1rem 0.4rem;
    border-radius: 5px;
    background: rgba(255, 255, 255, 0.09);
    border: 1px solid rgba(255, 255, 255, 0.1);
    font: inherit;
    font-size: 0.72rem;
    text-align: center;
  }
  .ghost {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    font-size: 0.78rem;
    padding: 0.45rem 0.7rem;
    border-radius: 8px;
    color: rgba(255, 255, 255, 0.7);
  }
  .ghost:hover {
    background: rgba(255, 255, 255, 0.08);
    color: #fff;
  }
  .danger:hover {
    color: #ff8a8a;
  }
  .icon-btn {
    display: grid;
    place-items: center;
    width: 30px;
    height: 30px;
    border-radius: 8px;
    color: rgba(255, 255, 255, 0.7);
  }
  .icon-btn:hover {
    background: rgba(255, 255, 255, 0.08);
    color: #fff;
  }
</style>
