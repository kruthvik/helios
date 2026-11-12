export const defaults = {
  // Background
  bgMode: "mesh" as "auto" | "mesh" | "aurora" | "lava" | "silk" | "prism" | "ripples" | "sunset" | "bokeh" | "retro" | "vortex" | "mosaic" | "jellyfish" | "ocean" | "dunes" | "orbits" | "topo" | "koi" | "skyline" | "galaxy" | "ridges" | "warp" | "flock" | "kaleido" | "rainglass" | "papercut" | "plexus" | "media" | "blur" | "solid",
  bgMotion: 1, // speed multiplier, 0 = still
  bgFps: 60, // background frame cap; 120 = every display frame
  bgIntensity: 1, // how far the gradient travels
  bgDim: 0.3, // 0..0.85 darkening overlay
  bgBlur: 80, // px, blur mode
  bgSaturation: 1.2,
  bgSolid: "#0e0f13",
  bgSolidFrom: "custom" as "custom" | "album", // solid background: your color, or the song's main color
  bgTint: "#ff7a3c", // a color the album's colors are pulled toward
  bgTintAmount: 0, // 0 = album colors as they are
  bgHue: 0, // degrees: turns the album's colors around the color wheel
  bgVignette: 0.35, // darkening toward the corners
  grain: true,
  // Your own background (style "media"): an uploaded picture / GIF / video (kept in IndexedDB) or a YouTube link
  bgMediaSrc: "file" as "file" | "youtube",
  bgMediaName: "", // the uploaded file's name, to show in Settings
  bgYt: "", // YouTube link
  bgMediaFit: "cover" as "cover" | "contain",
  bgMediaBlur: 0, // px
  bgMediaDrift: true, // a slow pan and zoom across the picture
  bgMediaRate: 1, // video speed
  bgTintFrom: "custom" as "custom" | "album", // your own backgrounds and music videos: tint toward the tint color or the album's
  // The song's music video as the background (muted, in step with the song), whenever there is one
  bgVideo: "off" as "off" | "stretch" | "clips",
  bgClipSec: 4, // clips: seconds per cut
  ecoUnfocused: false, // background and effects drop to 20 fps while another window is in front
  mvSkipAlways: false, // the "hide this video" button stays visible while idle
  // Effects: particles over the background
  fxList: [] as ("bubbles" | "fireflies" | "snow" | "fireworks" | "stars" | "petals" | "rain" | "embers" | "confetti" | "notes" | "butterflies" | "lanterns" | "sparkles" | "meteors" | "orbs" | "balloons" | "planes" | "leaves" | "seeds")[], // any mix; empty = off
  fxAmount: 1,
  fxSpeed: 1,
  fxSize: 1,
  fxAuto: false, // pick the effect from each song's colors (overrides the list)
  fxColor: "album" as "album" | "white" | "tint", // particle colors
  fxTint: "#ffb35c",
  fxOffMv: false, // no effects while a music video plays (the video player, or the video background)

  // Layout & sizing
  layout: "lyrics-right" as "lyrics-right" | "lyrics-left" | "header" | "corner" | "player-only" | "lyrics-only" | "tv",
  uiScale: 1,
  artSize: 320,
  artRadius: 14,
  artShadow: true,
  artGlow: false, // a soft halo around the cover in the song's (accent) color
  lyricsSpace: 4, // em between player and lyrics (renamed from lyricsGap so old saved values don't carry over)
  lyricsWidth: 780, // px max width of the lyrics column

  // Lyrics
  lyricsSize: 32,
  lyricsAlign: "left" as "left" | "center" | "right",
  lyricsFocus: true, // blur & fade lines away from the current one
  lyricsMode: "scroll" as "scroll" | "spotlight" | "kinetic" | "reveal" | "bounce" | "wave" | "neon" | "typewriter" | "chroma" | "drop" | "glitch" | "dream" | "stamp" | "flip" | "marker" | "jelly" | "glance",
  lyricsFx: 1, // strength of word effects (lift, growth, the bounce ball's arc)
  lyricsGlow: true,
  lyricsColor: "white" as "white" | "tint" | "song" | "custom", // lyric text: white, a soft tint of the song's color, the song's color, or your own
  lyricsInk: "#ffe9c7", // lyric text color when "custom"
  lyricsGlowFrom: "accent" as "accent" | "song" | "custom", // color of lyric glows, edges and highlights
  lyricsGlowColor: "#7ad7ff",
  lyricsEdge: "none" as "none" | "outline" | "shadow", // an outline or soft shadow around lyric text, in the accent color
  lyricsMotion: "spring" as "spring" | "smooth" | "instant",
  // per lyric style, how words light as they're sung: the style's own effect, a sweep, a pop, or off (a line at a time)
  wordHl: {} as Record<string, "own" | "sweep" | "pop" | "off">,
  // audio visualizer along the bottom (bands of what Windows is playing)
  vizOn: false,
  vizStyle: "wave" as "wave" | "bars" | "mirror",
  vizColor: "album" as "album" | "custom",
  vizTint: "#ffffff",
  vizHeight: 0.22,
  vizOpacity: 0.7,
  vizGain: 1,
  vizSmooth: 0.5,
  vizPulse: true, // the background swells a touch with the bass while the visualizer is on
  vizPulseAmount: 1, // how strongly it swells
  vizOnBar: false, // TV layout: stand on the player bar instead of starting at the bottom of the window
  hideNoLyrics: false, // a song without lyrics shows just the player
  lyricsOffsetMs: 0, // global; per-song offsets live with the song
  lyricsAnchor: 0.4, // where the current line sits, as a fraction of the lyrics area's height (0.4: a little above centre)
  lyricsAnchorTv: 0.4, // the same, in TV mode
  lyricsInterludes: true,
  sourceLrclib: true,
  sourceNetease: true,
  sourceOrder: "lrclib" as "lrclib" | "netease", // which wins a tie
  preferWordSync: true,

  // Appearance
  accent: "auto", // "auto" = from album art, else a hex color
  iconTheme: "rounded" as "rounded" | "sharp" | "solid" | "thin",
  playShape: "circle" as "circle" | "squircle" | "bare",
  font: "segoe" as "segoe" | "geometric" | "serif" | "mono",
  reduceMotion: false,

  // Game mode: one switch (G) that applies whichever of these the user keeps on
  gameMode: false,
  gmStillBg: true, // freeze the moving background
  gmNoFx: true, // turn effects off
  gmMotion: true, // instant animations (lyrics, layout changes, cover tilt)
  gmNoBlur: true, // no frosted glass or lyric blur (the heaviest GPU work)
  gmNoGrain: true, // no film grain
  gmUnfocused: true, // pause visuals while another window (the game) is in front

  // Music videos (keyless YouTube search)
  videoEnabled: true,
  videoAutoplay: false, // open the video as soon as one is found
  videoSize: 0.9, // share of the window the video fills
  resumeAfterVideo: true,
  videoHd: false, // ask YouTube for HD (best effort: embeds mostly choose by player size)
  videoLyrics: false, // captions over the video, timed to the video
  videoLyricsSize: 1,

  // Miniplayer (the light, glanceable mode for gaming)
  miniLyrics: true,
  miniOnTop: true,
  miniNext: true, // show the upcoming line under the current one
  miniTextSize: 1, // lyrics size; the window grows to fit
  miniCenter: false, // center the lyrics
  miniWash: 0.42, // how dark the background behind the text gets

  // Behaviour
  playOnStart: true, // "Play here" starts the song; off = it loads paused
  autoHide: true,
  // Top bar (the tool icons)
  toolbarSide: "right" as "right" | "left",
  toolbarHide: true, // the top icons fade out while you're idle (works even with "Hide controls" off)
  toolbarDim: false, // …to faint instead of fully
  toolMini: true,
  toolLyrics: true,
  toolQueue: true,
  toolFullscreen: true,
  hideDelay: 2.5, // seconds
  hideCursor: true,
  showRemaining: true,
  showUpNext: true,
  mediaKeys: true,
  alwaysOnTop: false,
  memLimit: false, // hold the whole app under memLimitMb (mem.rs); costs the odd dropped frame, so off unless asked for
  memLimitMb: 500,
};

export type Settings = typeof defaults;

const KEY = "helios.settings.v1";

function load(): Settings {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? "{}");
    // 30 fps was the old default and read as steppy next to 60 fps lyrics: move it up once (a picked value stays)
    if (saved.bgFps === 30 && !localStorage.getItem("helios.fps60")) saved.bgFps = 60;
    localStorage.setItem("helios.fps60", "1");
    // one effect used to be a single choice ("fx"); carry it over into the list
    if (typeof saved.fx === "string" && !saved.fxList) saved.fxList = saved.fx === "none" ? [] : [saved.fx];
    delete saved.fx;
    delete saved.glanceWords;
    if (saved.fxAlbumColors === false && !saved.fxColor) saved.fxColor = "white"; // was an on/off switch
    delete saved.fxAlbumColors;
    // word highlighting used to be an on/off list plus one Sweep / Pop / Off choice shared by Scroll and Glance
    if (!saved.wordHl && (saved.wordsOff || saved.lyricsWordStyle)) {
      saved.wordHl = {};
      const ws = saved.lyricsWordStyle === "plain" ? "off" : saved.lyricsWordStyle;
      if (ws === "off" || ws === "pop") saved.wordHl.scroll = saved.wordHl.glance = ws;
      for (const m of saved.wordsOff ?? []) saved.wordHl[m] = "off";
    }
    delete saved.wordsOff;
    delete saved.lyricsWordStyle;
    return { ...defaults, ...saved, fxList: [...(saved.fxList ?? defaults.fxList)], wordHl: { ...saved.wordHl } };
  } catch {
    return { ...defaults };
  }
}

export const settings: Settings = $state(load());

// Window focus, for "pause visuals while another window is in front".
// autoFx / autoBg: what Auto picked for the current song, so Settings can show it
// lowMem: the app is close to its memory budget (the Rust side watches the whole process tree, see mem.rs)
export const view = $state({ focused: document.hasFocus(), autoFx: [] as string[], autoBg: "", vizError: "", bgFileRev: 0, mvBg: false, lowMem: false });
addEventListener("focus", () => (view.focused = true));
addEventListener("blur", () => (view.focused = false));

type GameKey = "gmStillBg" | "gmNoFx" | "gmMotion" | "gmNoBlur" | "gmNoGrain" | "gmUnfocused";
/** True when game mode is on and this part of it is enabled. */
export const game = (k: GameKey) => settings.gameMode && settings[k];
/** Instant animations: the user's Reduce motion, or game mode asking for it. */
export const calm = () => settings.reduceMotion || game("gmMotion");
/** Visuals paused because the game has focus. */
export const frozen = () => game("gmUnfocused") && !view.focused;

export const resetSettings = () => Object.assign(settings, defaults, { fxList: [], wordHl: {} });

$effect.root(() => {
  $effect(() => localStorage.setItem(KEY, JSON.stringify(settings)));
});

export const FONTS: Record<Settings["font"], string> = {
  segoe: `"Segoe UI Variable Display", "Segoe UI", -apple-system, "SF Pro Display", system-ui, sans-serif`,
  geometric: `Bahnschrift, "DIN Alternate", "Avenir Next", "Segoe UI", sans-serif`,
  serif: `"Iowan Old Style", "Palatino Linotype", Palatino, Georgia, serif`,
  mono: `"Cascadia Code", "SF Mono", Consolas, monospace`,
};

/** Lyrics source order from settings, preferred first. */
export function lyricsPrefs() {
  const order = settings.sourceOrder === "lrclib" ? (["lrclib", "netease"] as const) : (["netease", "lrclib"] as const);
  return {
    sources: order.filter((s) => (s === "lrclib" ? settings.sourceLrclib : settings.sourceNetease)),
    preferWordSync: settings.preferWordSync,
  };
}
