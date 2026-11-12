<script lang="ts">
  import { invoke } from "@tauri-apps/api/core";
  import { getCurrentWindow } from "@tauri-apps/api/window";
  import { listen } from "@tauri-apps/api/event";
  import { flushSync, onMount, untrack } from "svelte";
  import { fade, fly } from "svelte/transition";
  import { cubicOut } from "svelte/easing";
  import { api, bestImage, loadSdk, token, type SdkPlayer, type SdkState, type SdkTrack } from "$lib/spotify";
  import { decoded } from "$lib/image";
  import { fetchLyrics, fmtOffset, getOverride, loadCandidate, saveLyricsFile, setOverride, trackKey as keyOf, type Lyrics as LyricsData, type Origin } from "$lib/lyrics";
  import { palette, FALLBACK, type Palette } from "$lib/palette";
  import { settings, FONTS, lyricsPrefs, game, calm, view } from "$lib/settings.svelte";
  import Backdrop from "$lib/Backdrop.svelte";
  import { SCENES, LYRIC_MODES, cycle, surprise } from "$lib/looks.svelte";
  import Lyrics from "$lib/Lyrics.svelte";
  import Icon from "$lib/Icon.svelte";
  import { tilt } from "$lib/tilt";
  import Effects from "$lib/Effects.svelte";
  import Visualizer from "$lib/Visualizer.svelte";
  import SettingsPanel from "$lib/SettingsPanel.svelte";
  import LyricsFix from "$lib/LyricsFix.svelte";
  import Queue from "$lib/Queue.svelte";
  import VideoPlayer from "$lib/VideoPlayer.svelte";
  import { cachedVideos, findVideos } from "$lib/video";
  import MiniPlayer from "$lib/MiniPlayer.svelte";
  import { enterMini, exitMini, resizeMini, savedMini, saveMini } from "$lib/mini";

  type Track = { uri: string; name: string; artists: string; album: string; durationMs: number; cover: string | null };

  const REPEAT = ["off", "context", "track"] as const;
  const VIDEO_LOOKUP_DELAY = 3000; // only search once a song has been playing a bit, not while skipping through
  const win = getCurrentWindow();
  const isMac = navigator.userAgent.includes("Mac");

  let status = $state<"signedOut" | "connecting" | "ready">("signedOut");
  let clientId = $state(localStorage.getItem("helios.spotifyClientId") ?? "");
  let error = $state("");
  let player: SdkPlayer | null = null;
  let deviceId = "";
  let track = $state.raw<Track | null>(null); // null = Helios isn't the active device
  let upNext = $state.raw<SdkTrack[]>([]);
  let playing = $state(false);
  let shuffle = $state(false);
  let repeat = $state<(typeof REPEAT)[number]>("off");
  const savedVolume = Number(localStorage.getItem("helios.volume") ?? 50) || 0;
  let volume = $state(savedVolume);
  let lastVolume = savedVolume || 50;
  let lyrics = $state.raw<LyricsData | null>(null); // raw: replaced wholesale, so no per-line/word proxies
  let trackOffset = $state(0);
  // The cover swaps only once the new image is decoded, so the crossfade never fades in an empty frame
  let shownCover = $state<string | undefined>();
  $effect(() => {
    const c = track?.cover;
    if (!c) return void (shownCover = undefined);
    decoded(c).then(() => track?.cover === c && (shownCover = c));
  });
  let hasOverride = $state(false);
  let pal = $state.raw<Palette>(FALLBACK);
  let panel = $state<"settings" | "queue" | "fix" | null>(null);
  // layouts with both the player and the lyrics; hiding the lyrics remembers which one to come back to
  const BOTH = ["lyrics-right", "lyrics-left", "header", "corner"] as const;
  let lastLyricsLayout: (typeof BOTH)[number] = (BOTH as readonly string[]).includes(settings.layout) ? (settings.layout as (typeof BOTH)[number]) : "lyrics-right";
  let lastLayout = settings.layout;
  let notice = $state("");
  let noticeTimer: ReturnType<typeof setTimeout>;
  let videoIds = $state.raw<string[]>([]);
  // the cover's "Music video" button: shown for 5 s when a video is found, then only while you're active
  let watchFresh = $state(false);
  $effect(() => {
    if (!videoIds.length) return;
    watchFresh = true;
    const t = setTimeout(() => (watchFresh = false), 5000);
    return () => clearTimeout(t);
  });
  let watching = $state(false);
  let barH = $state(0); // the player's height: in TV layout the visualizer stands on it
  // songs whose music video you turned off as the background (the button over it), remembered
  let mvOff = $state<Record<string, true>>(JSON.parse(localStorage.getItem("helios.mvOff") ?? "{}"));
  function toggleMvBg() {
    if (mvOff[tKey]) delete mvOff[tKey];
    else mvOff[tKey] = true;
    localStorage.setItem("helios.mvOff", JSON.stringify(mvOff));
    say(mvOff[tKey] ? "Music video background off for this song" : "Music video background back on");
  }  let wasPlayingBeforeVideo = false;
  let sleepAt = $state<number | null>(null);
  let sleepAfterTrack = $state(false);
  let sleepTimer: ReturnType<typeof setTimeout>;
  // Miniplayer: the whole full-size UI is unmounted, the background drops to 15 fps and nothing ticks per frame.
  let mini = $state(savedMini());

  // Position is anchored to the last SDK event and extrapolated locally while playing.
  let anchorMs = $state(0);
  let anchorAt = $state(0);
  let now = $state(performance.now());
  let dragMs = $state<number | null>(null);

  let duration = $derived(track?.durationMs ?? 0);
  let progress = $derived(dragMs ?? Math.min(duration, anchorMs + (playing ? now - anchorAt : 0)));
  let tKey = $derived(track ? keyOf(track) : "");
  let eco = $derived(settings.ecoUnfocused && !view.focused); // "save power while in the background"
  let mvBgAvail = $derived(settings.bgVideo !== "off" && !mini && !watching && videoIds.length > 0);
  let accent = $derived(settings.accent === "auto" ? pal.accent : settings.accent);
  let prefsKey = $derived(JSON.stringify(lyricsPrefs()));

  // Chrome (buttons, window controls) fades out while playing and idle.
  let awake = $state(true);
  let idleTimer: ReturnType<typeof setTimeout>;
  let idle = $derived(!awake && playing && !panel);
  let hidden = $derived(settings.autoHide && idle);
  function wake() {
    awake = true;
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => (awake = false), settings.hideDelay * 1000);
  }

  function setPos(ms: number) {
    anchorMs = ms;
    anchorAt = performance.now();
  }

  function applyState(s: SdkState | null) {
    const t = s?.track_window.current_track;
    if (!s || !t) {
      track = null; // playback moved to another device
      playing = false;
      return;
    }
    const next = { uri: t.uri, name: t.name, artists: t.artists.map((a) => a.name).join(", "), album: t.album.name, durationMs: s.duration, cover: bestImage(t.album.images) };
    // Keep the same object when nothing changed, so derived UI doesn't churn.
    if (!track || track.name !== next.name || track.artists !== next.artists || track.cover !== next.cover || track.durationMs !== next.durationMs) track = next;
    upNext = s.track_window.next_tracks ?? [];
    playing = !s.paused;
    shuffle = s.shuffle;
    repeat = REPEAT[s.repeat_mode];
    // the event can arrive a while after Spotify measured the position; count that time too, or lyrics run late
    const late = !s.paused && s.timestamp ? Date.now() - s.timestamp : 0;
    // shortcut: timestamp is undocumented, so a gap over 600ms is taken as "means something else" and ignored
    setPos(s.position + (late > 0 && late < 600 ? late : 0));
  }

  // ---- lyrics & colors: fetched once per song (and when lyric settings change), never per tick ----
  function loadLyrics(key: string, t: Track) {
    const o = getOverride(key);
    trackOffset = o.offsetMs ?? 0;
    hasOverride = !!o.source;
    lyrics = null;
    fetchLyrics(t, lyricsPrefs())
      .then((l) => key === tKey && (lyrics = l))
      .catch(() => key === tKey && (lyrics = { kind: "none" }));
  }
  $effect(() => {
    const key = tKey;
    prefsKey;
    if (!key) return;
    untrack(() => loadLyrics(key, track!));
  });
  $effect(() => {
    const cover = track?.cover;
    const key = tKey;
    if (cover) palette(cover).then((p) => key === tKey && (pal = p));
  });
  // taskbar / alt-tab shows what's playing
  $effect(() => {
    win.setTitle(track ? `${track.name} · ${track.artists}` : "Helios").catch(() => {});
  });

  // ---- music video: cached answer immediately, otherwise one search after the song has played a few seconds ----
  $effect(() => {
    const key = tKey;
    videoIds = [];
    if (!key || !(settings.videoEnabled || settings.bgVideo !== "off")) return;
    const cached = cachedVideos(key);
    const found = (ids: string[]) => {
      videoIds = ids;
      untrack(() => settings.videoEnabled && settings.videoAutoplay && ids.length && !watching && !mini && openVideo());
    };
    if (cached) return void found(cached);
    const t = untrack(() => track)!;
    const timer = setTimeout(() => {
      findVideos(key, t)
        .then((ids) => key === tKey && found(ids))
        .catch(() => {}); // no video button is the right fallback when search fails
    }, VIDEO_LOOKUP_DELAY);
    return () => clearTimeout(timer);
  });

  function openVideo() {
    if (!videoIds.length || mini) return;
    panel = null;
    wasPlayingBeforeVideo = playing;
    videoStartMs = livePos();
    videoSync.songMs = null;
    videoSync.playing = false;
    watching = true;
    quietSpotify();
  }
  // Song ⇄ video hand-off. The video opens where the song is and, on closing, the song picks up where the video
  // was (VideoPlayer maps between the two timelines). A plain object: the video writes to it every tick without
  // re-rendering anything here.
  const videoSync = { songMs: null as number | null, playing: false };
  let videoStartMs = $state(0);
  // Spotify must really be quiet while a video plays. The SDK's pause can get dropped (right at a track change, or
  // while this device is still becoming active), so check a moment later and fall back to one Web API pause.
  let quietTimer: ReturnType<typeof setTimeout>;
  function quietSpotify() {
    if (playing) run(() => player!.pause());
    clearTimeout(quietTimer);
    quietTimer = setTimeout(async () => {
      if (!watching) return;
      const s = await player?.getCurrentState().catch(() => null);
      // null = audio isn't on this device: pause wherever it is, but only if we think it's playing
      if (s ? !s.paused : playing) run(() => api("/me/player/pause", "PUT"));
    }, 700);
  }
  // The song can start after the video opens (autoplay at track start, media keys, another device): keep it quiet.
  $effect(() => {
    if (!watching || !playing) return;
    untrack(() => {
      wasPlayingBeforeVideo = true;
      quietSpotify();
    });
  });
  // The video stood in for the song, so when it finishes, move on like Spotify would.
  async function videoEnded() {
    watching = false;
    await run(() => player!.nextTrack());
    run(() => player!.resume());
  }
  function closeVideo() {
    watching = false;
    const at = videoSync.songMs;
    // carry on if the video was playing (switching over, not stopping), or if the song was before it opened
    const resume = settings.resumeAfterVideo && (wasPlayingBeforeVideo || videoSync.playing);
    if (at === null) return void (resume && run(() => player!.resume()));
    // the video ran past the song's end (an outro or skit): the song's finished too, so move on
    if (duration && at >= duration - 1500) return void run(async () => (await player!.nextTrack(), resume || (await player!.pause())));
    const ms = Math.max(0, Math.round(at));
    setPos(ms);
    run(async () => {
      await player!.seek(ms); // seek first, so the song never plays a moment from the old spot
      if (resume) await player!.resume();
    });
  }

  // ---- sleep timer ----
  function sleep(v: number | "track" | null) {
    clearTimeout(sleepTimer);
    sleepAt = null;
    sleepAfterTrack = v === "track";
    if (typeof v === "number") {
      sleepAt = Date.now() + v * 60_000;
      sleepTimer = setTimeout(() => {
        sleepAt = null;
        run(() => player!.pause());
        say("Sleep timer: paused");
      }, v * 60_000);
    }
    if (v !== null) say(v === "track" ? "Pausing after this song" : `Pausing in ${v} minutes`);
  }
  let sleepLabel = $derived(
    sleepAfterTrack ? "Pauses when this song ends" : sleepAt ? `Pauses at ${new Date(sleepAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}` : null,
  );
  // "End of song": pause as soon as the next one starts.
  let sleepFromKey = "";
  $effect(() => {
    const key = tKey;
    if (!sleepAfterTrack) return void (sleepFromKey = key);
    if (sleepFromKey && key !== sleepFromKey) {
      sleepAfterTrack = false;
      untrack(() => run(() => player!.pause().then(() => player!.seek(0))));
      say("Sleep timer: paused");
    }
    sleepFromKey = key;
  });

  function say(text: string) {
    notice = text;
    clearTimeout(noticeTimer);
    noticeTimer = setTimeout(() => (notice = ""), 2600);
  }

  async function copyLink() {
    const id = track?.uri.split(":")[2];
    if (!id) return;
    await navigator.clipboard.writeText(`https://open.spotify.com/track/${id}`);
    say("Song link copied");
  }
  async function toggleFullscreen() {
    await invoke("toggle_fullscreen"); // windowed fullscreen (no separate Space on macOS)
  }
  // Layout changes morph: the browser snapshots before/after and glides the cover, player and lyrics between them.
  function morph(change: () => void) {
    if (calm() || !document.startViewTransition) return change();
    document.startViewTransition(() => {
      change();
      flushSync();
    });
  }
  function setLayout(l: typeof settings.layout) {
    if (l !== settings.layout) morph(() => (settings.layout = l));
  }
  // Settings: a song without lyrics shows just the player. The chosen layout is never changed, so it's back as soon
  // as a song with lyrics plays; while the next song's lyrics load, the current look holds (no flash in between).
  let noLyrics = $state(false);
  $effect(() => {
    if (!lyrics) return;
    const v = settings.hideNoLyrics && (lyrics.kind === "none" || lyrics.kind === "instrumental");
    untrack(() => v !== noLyrics && morph(() => (noLyrics = v)));
  });
  let layout = $derived(noLyrics ? "player-only" : settings.layout); // what's on screen
  // Focus and TV are both lyrics-only views; leaving either goes back to the layout you came from.
  let immersive = $derived(layout === "lyrics-only"); // player hidden (TV keeps it, as a bar along the bottom)
  function toggleView(view: "lyrics-only" | "tv") {
    if (settings.layout === view) setLayout(lastLayout === "lyrics-only" || lastLayout === "tv" ? "lyrics-right" : lastLayout);
    else {
      if (settings.layout !== "lyrics-only" && settings.layout !== "tv") lastLayout = settings.layout;
      setLayout(view);
      say(view === "tv" ? "TV mode · press T to leave" : "Focus mode · press Z to leave");
    }
  }
  const toggleFocus = () => toggleView("lyrics-only");
  // E: effects off, and back to exactly what they were (Auto, or your mix); with nothing to go back to, Auto
  let fxBefore: { list: typeof settings.fxList; auto: boolean } | null = null;
  function toggleFx() {
    if (settings.fxAuto || settings.fxList.length) {
      fxBefore = { list: [...settings.fxList], auto: settings.fxAuto };
      settings.fxAuto = false;
      settings.fxList = [];
      return say("Effects off");
    }
    settings.fxList = fxBefore?.list ?? [];
    settings.fxAuto = fxBefore ? fxBefore.auto : true;
    say("Effects on");
  }
  function toggleGame() {
    settings.gameMode = !settings.gameMode;
    say(settings.gameMode ? "Game mode on · press G to turn off" : "Game mode off");
  }
  const toggleTv = () => toggleView("tv");

  
  // scrolling over the cover sets the volume; a small bubble on the cover shows where it is
  let volPop = $state(false);
  let volPopTimer: ReturnType<typeof setTimeout>;
  function coverWheel(e: WheelEvent) {
    e.preventDefault();
    setVolume(volume - Math.sign(e.deltaY) * 4);
    volPop = true;
    clearTimeout(volPopTimer);
    volPopTimer = setTimeout(() => (volPop = false), 900);
  }

  function nudge(delta: number | null) {
    trackOffset = delta === null ? 0 : trackOffset + delta;
    setOverride(tKey, { offsetMs: trackOffset });
    say(`Lyrics ${fmtOffset(trackOffset)} for this song`); // buttons and keys both confirm what changed
  }
  async function pickLyrics(source: Origin, id: string) {
    setOverride(tKey, { source, id });
    hasOverride = true;
    panel = null;
    const key = tKey;
    lyrics = null;
    const l = await loadCandidate(source, id).catch(() => ({ kind: "none" }) as const);
    if (key === tKey) lyrics = l;
  }
  function resetLyrics() {
    setOverride(tKey, { source: undefined, id: undefined });
    panel = null;
    if (track) loadLyrics(tKey, track);
  }

  // ---- window & OS integration ----
  $effect(() => {
    win.setAlwaysOnTop(settings.alwaysOnTop || (mini && settings.miniOnTop)).catch(() => {});
  });
  $effect(() => {
    invoke("set_memory_budget", { mb: settings.memLimit ? settings.memLimitMb : 0 }).catch(() => {});
    if (!settings.memLimit) view.lowMem = false;
  });

  async function toggleMini() {
    const on = !mini;
    if (on) {
      panel = null;
      if (watching) closeVideo();
    }
    mini = on;
    saveMini(on);
    await (on ? enterMini(settings.miniLyrics, true) : exitMini()).catch((e) => (error = String(e)));
  }
  // lyrics on/off, their size and the next line change the miniplayer's height
  $effect(() => {
    const lyr = settings.miniLyrics;
    void [settings.miniTextSize, settings.miniNext];
    if (untrack(() => mini)) resizeMini(lyr).catch(() => {});
  });

  // Media keys + Windows media overlay show Helios' track.
  $effect(() => {
    const ms = navigator.mediaSession;
    if (!ms) return;
    if (!settings.mediaKeys || !track) {
      ms.metadata = null;
      return;
    }
    ms.metadata = new MediaMetadata({
      title: track.name,
      artist: track.artists,
      album: track.album,
      artwork: track.cover ? [{ src: track.cover, sizes: "640x640", type: "image/jpeg" }] : [],
    });
  });
  // The OS only routes media keys to a page that is itself playing audio, and Spotify's audio lives in its own
  // cross-origin frame. A silent loop here makes Helios the "now playing" app (Windows overlay, macOS Now Playing).
  let silence: HTMLAudioElement | undefined;
  let silenceUrl = "";
  $effect(() => {
    if (!settings.mediaKeys || !track) return void silence?.pause();
    if (!silence) {
      const pcm = new Uint8Array(44 + 8000).fill(128); // 1 s of 8-bit 8 kHz silence
      const v = new DataView(pcm.buffer);
      [..."RIFF"].forEach((c, i) => v.setUint8(i, c.charCodeAt(0)));
      v.setUint32(4, 36 + 8000, true);
      [..."WAVEfmt "].forEach((c, i) => v.setUint8(8 + i, c.charCodeAt(0)));
      v.setUint32(16, 16, true), v.setUint16(20, 1, true), v.setUint16(22, 1, true);
      v.setUint32(24, 8000, true), v.setUint32(28, 8000, true), v.setUint16(32, 1, true), v.setUint16(34, 8, true);
      [..."data"].forEach((c, i) => v.setUint8(36 + i, c.charCodeAt(0)));
      v.setUint32(40, 8000, true);
      silenceUrl = URL.createObjectURL(new Blob([pcm], { type: "audio/wav" }));
      silence = new Audio(silenceUrl);
      silence.loop = true;
    }
    const a = silence;
    // Autoplay may be refused until the first click; do not retain one retry listener per track.
    let live = true;
    const retry = () => void a.play().catch(() => {});
    a.play().catch(() => live && addEventListener("pointerdown", retry, { once: true }));
    return () => {
      live = false;
      removeEventListener("pointerdown", retry);
    };
  });
  $effect(() => {
    if (!settings.mediaKeys || !navigator.mediaSession) return;
    navigator.mediaSession.playbackState = playing ? "playing" : "paused";
    // keep the silent loop going: if anything paused it, Helios would stop getting the media keys
    if (track && silence?.paused) silence.play().catch(() => {});
    if (duration) navigator.mediaSession.setPositionState?.({ duration: duration / 1000, position: Math.min(anchorMs, duration) / 1000, playbackRate: 1 });
  });

  async function run(fn: () => Promise<unknown>) {
    try {
      await fn();
      error = "";
    } catch (e) {
      error = String(e instanceof Error ? e.message : e);
    }
  }

  // ---- controls: playback goes straight to the SDK; only shuffle/repeat/transfer/queue use a one-off Web API call ----
  const playHere = () =>
    run(async () => {
      await player!.activateElement(); // lets the webview start audio from this click
      await api("/me/player", "PUT", { device_ids: [deviceId], play: settings.playOnStart });
    });
  // Resuming after a pause can get dropped: Spotify may treat this device as idle by then, or the webview wants the
  // click passed through before it plays audio. So pass it through, check a moment later, and fall back to one
  // Web API play on this device (a one-off call, not polling).
  let resumeTimer: ReturnType<typeof setTimeout>;
  function resume() {
    return run(async () => {
      await player!.activateElement();
      await player!.resume();
      clearTimeout(resumeTimer);
      resumeTimer = setTimeout(async () => {
        if (watching) return;
        const s = await player?.getCurrentState().catch(() => null);
        if (!s || s.paused) run(() => api(`/me/player/play?device_id=${deviceId}`, "PUT"));
      }, 700);
    });
  }
  // ask the player itself (local, no network) whether it's playing, so a stale "playing" can't turn Play into Pause
  async function togglePlay() {
    const s = await player?.getCurrentState().catch(() => null);
    if (s ? !s.paused : playing) return clearTimeout(resumeTimer), run(() => player!.pause());
    return resume();
  }
  const next = () => run(() => player!.nextTrack());
  const prev = () => run(() => player!.previousTrack());
  const toggleShuffle = () => run(() => api(`/me/player/shuffle?state=${!shuffle}&device_id=${deviceId}`, "PUT"));
  const cycleRepeat = () =>
    run(() => api(`/me/player/repeat?state=${REPEAT[(REPEAT.indexOf(repeat) + 1) % 3]}&device_id=${deviceId}`, "PUT"));

  function seek(ms: number) {
    const clamped = Math.max(0, Math.min(duration, ms));
    setPos(clamped);
    run(() => player!.seek(Math.round(clamped)));
  }
  function commitSeek() {
    if (dragMs === null) return;
    const ms = dragMs;
    dragMs = null;
    seek(ms);
  }
  function setVolume(v: number) {
    v = Math.max(0, Math.min(100, Math.round(v)));
    volume = v;
    if (v > 0) lastVolume = v;
    localStorage.setItem("helios.volume", String(v));
    run(() => player!.setVolume(v / 100));
  }
  async function skipTo(n: number) {
    panel = null;
    // The Web API can't jump inside the queue, so this skips forward until the picked song plays. Each skip must land
    // before the next: a skip asked for while one is in progress is dropped (picking any song only moved one on).
    const want = upNext[n - 1]?.uri;
    const now = async () => (await player?.getCurrentState().catch(() => null))?.track_window.current_track?.uri;
    for (let i = 0; i < Math.min(n, 30); i++) {
      const before = await now();
      if (want && before === want) break;
      await run(() => player!.nextTrack());
      for (let t = 0; t < 40 && (await now()) === before; t++) await new Promise((r) => setTimeout(r, 100));
    }
  }
  function toggleLyrics() {
    if (settings.layout === "player-only") setLayout(lastLyricsLayout);
    else if ((BOTH as readonly string[]).includes(settings.layout))
      (lastLyricsLayout = settings.layout as (typeof BOTH)[number]), setLayout("player-only");
    else setLayout(lastLyricsLayout);
  }
  function swapSides() {
    if (settings.layout !== "player-only") setLayout(settings.layout === "lyrics-right" ? "lyrics-left" : "lyrics-right");
  }

  // ---- session ----
  async function startPlayer() {
    await loadSdk();
    if (disposed) return;
    player?.disconnect(); // a failed/auth-expired session must not leave another SDK frame behind
    const p = new window.Spotify.Player({ name: "Helios", getOAuthToken: (cb) => token().then(cb), volume: volume / 100 });
    p.addListener("ready", ({ device_id }) => {
      deviceId = device_id;
      status = "ready";
      p.getVolume().then((v) => (volume = Math.round(v * 100)));
    });
    p.addListener("not_ready", () => (error = "Connection lost, reconnecting…"));
    p.addListener("player_state_changed", applyState);
    p.addListener("autoplay_failed", () => (error = "Autoplay was blocked. Press play."));
    for (const ev of ["initialization_error", "authentication_error", "account_error", "playback_error"]) {
      p.addListener(ev, ({ message }) => {
        error = `${ev.replace("_", " ")}: ${message}`;
        if (ev !== "playback_error") status = "signedOut";
      });
    }
    player = p;
    try {
      if (!(await p.connect())) throw new Error("Couldn't connect the Spotify player.");
      if (disposed) p.disconnect();
    } catch (e) {
      p.disconnect();
      if (player === p) player = null;
      throw e;
    }
  }

  async function login() {
    if (status === "connecting" || disposed) return;
    status = "connecting";
    error = "";
    try {
      clientId = clientId.trim();
      await invoke("login", { clientId });
      localStorage.setItem("helios.spotifyClientId", clientId);
      await startPlayer(); // status flips to "ready" on the SDK's ready event
    } catch (e) {
      error = String(e);
      status = "signedOut";
    }
  }

  async function logout() {
    panel = null;
    player?.disconnect();
    player = null;
    await invoke("logout");
    status = "signedOut";
    track = null;
    playing = false;
  }

  // `progress` ticks coarsely (and not at all in the miniplayer), so relative seeks read the live position.
  const livePos = () => dragMs ?? Math.min(duration, anchorMs + (playing ? performance.now() - anchorAt : 0));

  function onKey(e: KeyboardEvent) {
    wake();
    if (e.key === "Escape") return watching && !panel ? closeVideo() : (panel = null);
    if (e.target instanceof HTMLInputElement || e.ctrlKey || e.altKey || e.metaKey) return;
    if (e.key.toLowerCase() === "p" && status === "ready") return toggleMini();
    if (mini) {
      const miniKeys: Record<string, () => unknown> = {
        " ": togglePlay,
        ArrowLeft: () => (e.shiftKey ? prev() : seek(livePos() - 5000)),
        ArrowRight: () => (e.shiftKey ? next() : seek(livePos() + 5000)),
        ArrowUp: () => setVolume(volume + 5),
        ArrowDown: () => setVolume(volume - 5),
        m: () => setVolume(volume ? 0 : lastVolume),
        l: () => (settings.miniLyrics = !settings.miniLyrics),
        g: toggleGame,
        c: copyLink,
      };
      const fn = track && miniKeys[e.key.length === 1 ? e.key.toLowerCase() : e.key];
      if (fn) (e.preventDefault(), fn());
      return;
    }
    if (e.key === ",") return (panel = panel === "settings" ? null : "settings");
    if (e.key.toLowerCase() === "f") return toggleFullscreen();
    if (!track || watching) return; // during a video, VideoPlayer owns Space
    const keys: Record<string, () => unknown> = {
      " ": togglePlay,
      ArrowLeft: () => (e.shiftKey ? prev() : seek(livePos() - 5000)),
      ArrowRight: () => (e.shiftKey ? next() : seek(livePos() + 5000)),
      ArrowUp: () => setVolume(volume + 5),
      ArrowDown: () => setVolume(volume - 5),
      m: () => setVolume(volume ? 0 : lastVolume),
      l: toggleLyrics,
      s: swapSides,
      q: () => (panel = panel === "queue" ? null : "queue"),
      z: toggleFocus,
      g: toggleGame,
      "[": () => nudge(100), // lyrics earlier
      "]": () => nudge(-100), // lyrics later
      t: toggleTv,
      c: copyLink,
      v: () => (watching ? closeVideo() : openVideo()),
      // looks from the keyboard: step through backgrounds and lyric styles, effects on/off, a random look
      b: () => say(`Background: ${cycle("bgMode", SCENES, e.shiftKey ? -1 : 1)}`),
      y: () => say(`Lyrics: ${cycle("lyricsMode", LYRIC_MODES, e.shiftKey ? -1 : 1)}`),
      e: toggleFx,
      r: () => say(surprise()),
    };
    const fn = keys[e.key.length === 1 ? e.key.toLowerCase() : e.key];
    if (fn) (e.preventDefault(), fn());
  }

  const fmt = (ms: number) => {
    const s = Math.floor(Math.max(0, ms) / 1000);
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  };

  // Clock for the seek bar and times (lyrics keep their own). It ticks about every half pixel of bar travel,
  // which looks continuous without a frame-by-frame loop; nothing when paused, hidden, or the bar isn't shown.
  let visible = $state(!document.hidden);
  $effect(() => {
    if (!playing || !visible || watching || mini) return;
    now = performance.now();
    const msPerPx = duration / (settings.artSize * settings.uiScale);
    const id = setInterval(() => (now = performance.now()), Math.max(16, Math.min(250, msPerPx / 2)));
    return () => clearInterval(id);
  });

  let disposed = false;
  onMount(() => {
    const onVisibility = () => (visible = !document.hidden);
    document.addEventListener("visibilitychange", onVisibility);
    const ms = navigator.mediaSession;
    // Windows picks "play" or "pause" from its own idea of the state, which can be stale while Spotify plays (then
    // the key did nothing). Both ask the player what it's really doing and do the opposite.
    ms?.setActionHandler("play", () => player && togglePlay());
    ms?.setActionHandler("pause", () => player && togglePlay());
    ms?.setActionHandler("nexttrack", next);
    ms?.setActionHandler("previoustrack", prev);
    ms?.setActionHandler("seekto", (d) => d.seekTime != null && seek(d.seekTime * 1000));
    const noMenu = (e: MouseEvent) => e.preventDefault();
    document.addEventListener("contextmenu", noMenu);
    // Canvas gradients and paths drawn every frame are freed only by a full GC, which a busy animation loop with a
    // tiny JS heap never triggers: unchecked, the renderer grew ~0.8 MB/s. gc() is exposed by --expose-gc in
    // tauri.conf.json; on a few-MB heap a full collection takes a few ms, done in an idle slot.
    // Asked for as "async": it then runs from an empty stack, the only kind of collection after which Blink compacts
    // its heap and hands pages back. The plain gc() freed the objects but left the heap fragmented and growing.
    const gc = (globalThis as { gc?: (o: object) => unknown }).gc;
    const collect = () => gc?.({ type: "major", execution: "async" });
    // Every 45 s, not more often: the collection itself blocks the page for about 15 ms (a dropped frame), however
    // little there is to free; in 45 s the heap grows by some 10 MB.
    const gcTimer = gc && setInterval(() => !document.hidden && requestIdleCallback(collect, { timeout: 1000 }), 45000);
    // The Rust side watches the whole app's memory (mem.rs) and says when it nears the budget: collect right away,
    // and at the budget itself lighten what can be lightened for the next ten minutes.
    let lowMemTimer: ReturnType<typeof setTimeout>;
    const unlistenMem = listen<boolean>("memory-pressure", (e) => {
      // "last-resort" also shrinks the heaps themselves (measured: the page's process gave back ~50 MB of 190)
      // for one ~20 ms pause, which is why the regular collection above doesn't do it
      gc?.({ type: "major", execution: "async", flavor: "last-resort" });
      if (!e.payload) return; // true only at the budget itself, when trimming unused memory wasn't enough
      view.lowMem = true;
      clearTimeout(lowMemTimer);
      lowMemTimer = setTimeout(() => (view.lowMem = false), 600_000);
    });
    wake();
    if (mini) enterMini(settings.miniLyrics, false).catch(() => {}); // reopened in the miniplayer
    invoke<boolean>("has_saved_login").then((saved) => {
      if (saved && clientId && !disposed) login();
    });
    return () => {
      disposed = true;
      clearInterval(gcTimer || undefined);
      clearTimeout(lowMemTimer);
      unlistenMem.then((off) => off());
      document.removeEventListener("visibilitychange", onVisibility);
      clearTimeout(idleTimer);
      clearTimeout(sleepTimer);
      clearTimeout(noticeTimer);
      clearTimeout(volPopTimer);
      clearTimeout(quietTimer);
      clearTimeout(resumeTimer);
      document.removeEventListener("contextmenu", noMenu);
      for (const action of ["play", "pause", "nexttrack", "previoustrack", "seekto"] as const) ms?.setActionHandler(action, null);
      if (ms) ms.metadata = null;
      if (silence) {
        silence.pause();
        silence.removeAttribute("src");
        silence.load();
        silence = undefined;
      }
      URL.revokeObjectURL(silenceUrl);
      player?.disconnect();
      player = null;
    };
  });
</script>

<svelte:window onpointermove={wake} onpointerdown={wake} onkeydown={onKey} />
<svelte:document onpointerleave={() => playing && (awake = false)} />

<Backdrop
    colors={pal.colors}
    art={track?.cover ?? null}
    maxFps={mini ? 15 : eco ? 20 : Infinity}
    mv={mvBgAvail && !mvOff[tKey] ? videoIds : null}
    {playing}
    pos={livePos}
    songMs={duration}
  />
{#if !mini}<Effects colors={pal.colors} {playing} maxFps={eco ? 20 : Infinity} off={settings.fxOffMv && (watching || view.mvBg)} /><Visualizer colors={pal.colors} lift={settings.layout === "tv" && settings.vizOnBar ? barH : 0} />{/if}

<div
  class="app {layout}"
  class:mac={isMac}
  class:hidden
  class:hide-cursor={hidden && settings.hideCursor}
  class:calm={calm()}
  class:no-blur={game("gmNoBlur")}
  style:--accent={accent}
  style:--song={pal.accent}
  style:--s={settings.uiScale}
  style:--ui-s={settings.uiScale}
  style:--art="{settings.artSize}px"
  style:--art-radius="{settings.artRadius}px"
  style:--gap="{settings.lyricsSpace}em"
  style:--lw="{settings.lyricsWidth}px"
  style:font-size="{16 * settings.uiScale}px"
  style:font-family={FONTS[settings.font]}
>
  <!-- the miniplayer is its own drag region; this bar would sit on top of its buttons -->
  <div class="titlebar" class:left={settings.toolbarSide === "left"} data-tauri-drag-region style:display={mini ? "none" : null}>
    {#if status === "ready" && !watching && !mini}
      <div class="tools" class:gone={idle && settings.toolbarHide && !settings.toolbarDim} class:dim={idle && settings.toolbarHide && settings.toolbarDim}>
        {#if settings.toolMini}<button aria-label="Miniplayer" title="Miniplayer (P)" onclick={toggleMini}><Icon name="mini" size={16} /></button>{/if}
        {#if track}
          {#if settings.toolLyrics}
            <button
              aria-label={settings.layout === "player-only" ? "Show lyrics" : "Hide lyrics"}
              title="Lyrics (L)"
              class:on={settings.layout !== "player-only"}
              onclick={toggleLyrics}><Icon name="music" size={16} /></button
            >
          {/if}
          {#if settings.toolQueue}<button aria-label="Queue" title="Queue (Q)" class:on={panel === "queue"} onclick={() => (panel = "queue")}><Icon name="queue" size={16} /></button>{/if}
        {/if}
        {#if settings.toolFullscreen}<button aria-label="Fullscreen" title="Fullscreen (F)" onclick={toggleFullscreen}><Icon name="fullscreen" size={16} /></button>{/if}
        <button aria-label="Customize" title="Customize (,)" onclick={() => (panel = "settings")}><Icon name="tune" size={16} /></button>
      </div>
    {/if}
  </div>

  <!-- Window controls: invisible until the pointer touches the very top edge. Mac gets traffic lights on the left. -->
  <div class="edge" aria-hidden="true"></div>
  <div class="wc">
    {#if isMac}
      <button class="tl close" aria-label="Close" onclick={() => win.close()}></button>
      <button class="tl min" aria-label="Minimize" onclick={() => win.minimize()}></button>
      {#if !mini}<button class="tl max" aria-label="Fullscreen" onclick={toggleFullscreen}></button>{/if}
    {:else}
      <button aria-label="Minimize" onclick={() => win.minimize()}><Icon name="minimize" size={16} /></button>
      {#if !mini}<button aria-label="Maximize" onclick={() => win.toggleMaximize()}><Icon name="maximize" size={14} /></button>{/if}
      <button class="close" aria-label="Close" onclick={() => win.close()}><Icon name="close" size={16} /></button>
    {/if}
  </div>

  {#if mini}
    <MiniPlayer
      {track}
      ready={status === "ready"}
      {playing}
      {anchorMs}
      {anchorAt}
      {duration}
      {lyrics}
      offsetMs={settings.lyricsOffsetMs + trackOffset}
      onTogglePlay={togglePlay}
      onPrev={prev}
      onNext={next}
      onSeek={seek}
      onPlayHere={playHere}
      onExpand={toggleMini}
    />
  {:else if status !== "ready"}
    <div class="center" in:fly={{ y: 10, duration: 500, easing: cubicOut }}>
      <h1 class="brand">Helios</h1>
      <p class="muted">Your music, with the words.</p>
      <label for="spotify-client-id">Spotify application client ID</label>
      <input id="spotify-client-id" bind:value={clientId} disabled={status === "connecting"} autocomplete="off" spellcheck="false" />
      <p class="fine">Create a Spotify developer app and add http://127.0.0.1:8898/callback as its redirect URI.</p>
      <button class="pill" onclick={login} disabled={status === "connecting"}>
        {status === "connecting" ? "Connecting…" : "Sign in with Spotify"}
      </button>
      <p class="fine">Requires Spotify Premium</p>
    </div>
  {:else if !track}
    <div class="center" in:fly={{ y: 10, duration: 500, easing: cubicOut }}>
      <h1 class="brand">Ready when you are</h1>
      <p class="muted">Bring what you're playing over, or pick <b>Helios</b> in any Spotify app.</p>
      <button class="pill" onclick={playHere}>Play here</button>
    </div>
  {:else if watching && videoIds.length}
    <VideoPlayer
      ids={videoIds}
      {lyrics}
      title="{track.name} by {track.artists}"
      onClose={closeVideo}
      onEnded={videoEnded}
      onPlaying={quietSpotify}
      startMs={videoStartMs}
      songMs={duration}
      sync={videoSync}
      onUnavailable={() => (closeVideo(), say("YouTube won't allow this video to play here"))}
    />
  {:else}
    <main class="stage" in:fade={{ duration: 400 }}>
      {#if !immersive}
        <div class="player" bind:offsetHeight={barH}>
          <div
            class="art"
            class:shadow={settings.artShadow}
            class:glow={settings.artGlow}
            use:tilt={{ onHold: toggleLyrics, still: calm() }}
            onwheel={coverWheel}
            title="Hold to {settings.layout === 'player-only' ? 'show' : 'hide'} lyrics · scroll for volume"
          >
            {#key shownCover}
              {#if shownCover}
                <img src={shownCover} alt="Cover art for {track.album || track.name}" draggable="false" in:fade={{ duration: 500 }} out:fade={{ duration: 500 }} />
              {/if}
            {/key}
            <span class="fill" aria-hidden="true"></span>
            <span class="glare" aria-hidden="true"></span>
            {#if volPop}<span class="volpop" transition:fade={{ duration: 180 }}>{volume}%</span>{/if}
            {#if videoIds.length && settings.videoEnabled}
              <button class="watch" class:away={!watchFresh && !awake} onclick={openVideo} title="Watch the music video (V)" in:fade={{ duration: 300 }}>
                <Icon name="video" size={15} /> Music video
              </button>
            {/if}
          </div>

          {#key tKey}
            <div class="meta" in:fly={{ y: 6, duration: 420, easing: cubicOut }}>
              <h1><button class="title" title="Copy song link (C)" onclick={copyLink}>{track.name}</button></h1>
              <p class="muted" title={track.artists}>{track.artists}</p>
            </div>
          {/key}

          <div class="seek">
            <input
              type="range"
              aria-label="Seek"
              min="0"
              max={duration}
              value={progress}
              oninput={(e) => (dragMs = Number(e.currentTarget.value))}
              onchange={commitSeek}
              onwheel={(e) => (e.preventDefault(), seek(livePos() - Math.sign(e.deltaY) * 5000))}
              style:--fill="{duration ? (progress / duration) * 100 : 0}%"
            />
            <button class="times" title="Toggle remaining / total time" onclick={() => (settings.showRemaining = !settings.showRemaining)}>
              <span>{fmt(progress)}</span>
              <span>{settings.showRemaining ? `-${fmt(duration - progress)}` : fmt(duration)}</span>
            </button>
          </div>

          <div class="controls chrome">
            <button class="icon" class:on={shuffle} aria-label="Shuffle" aria-pressed={shuffle} onclick={toggleShuffle}>
              <Icon name="shuffle" size={19} />
            </button>
            <button class="icon big" aria-label="Previous" onclick={prev}><Icon name="prev" size={24} /></button>
            <button class="play {settings.playShape}" aria-label={playing ? "Pause" : "Play"} onclick={togglePlay}>
              <Icon name={playing ? "pause" : "play"} size={settings.playShape === "bare" ? 40 : 26} />
            </button>
            <button class="icon big" aria-label="Next" onclick={next}><Icon name="next" size={24} /></button>
            <button class="icon" class:on={repeat !== "off"} aria-label="Repeat: {repeat}" onclick={cycleRepeat}>
              <Icon name="repeat" size={19} />
              {#if repeat === "track"}<span class="badge">1</span>{/if}
            </button>
          </div>

          <div class="volume chrome">
            <button class="icon" aria-label={volume ? "Mute" : "Unmute"} onclick={() => setVolume(volume ? 0 : lastVolume)}>
              <Icon name={volume ? "volume" : "mute"} size={17} />
            </button>
            <input
              type="range"
              aria-label="Volume"
              min="0"
              max="100"
              value={volume}
              oninput={(e) => setVolume(Number(e.currentTarget.value))}
              onwheel={(e) => (e.preventDefault(), setVolume(volume - Math.sign(e.deltaY) * 4))}
              style:--fill="{volume}%"
            />
          </div>

          {#if settings.showUpNext && upNext[0]}
            <button class="upnext chrome" onclick={() => (panel = "queue")}>
              <span class="label">Up next</span>
              <span class="name">{upNext[0].name} · {upNext[0].artists.map((a) => a.name).join(", ")}</span>
            </button>
          {/if}
        </div>
      {/if}

      {#if layout !== "player-only"}
        <div class="lyrics-col">
          <Lyrics
            {lyrics}
            anchorMs={dragMs ?? anchorMs}
            {anchorAt}
            playing={playing && dragMs === null}
            offsetMs={settings.lyricsOffsetMs + trackOffset}
            trackOffsetMs={trackOffset}
            chromeHidden={hidden}
            onSeek={seek}
            onNudge={nudge}
            onFix={() => (panel = "fix")}
          />
        </div>
      {/if}

      {#if immersive}
        <!-- Focus mode keeps a slim now-playing line so you still know what's on. -->
        <div class="focusbar chrome" style:--fp="{duration ? (progress / duration) * 100 : 0}%">
          {#if track.cover}<img src={track.cover} alt="" />{/if}
          <span class="name">
            <b>{track.name}</b>
            <span>{track.artists}</span>
          </span>
          <span class="time">{fmt(progress)} / {fmt(duration)}</span>
          <button class="icon" aria-label="Previous" onclick={prev}><Icon name="prev" size={18} /></button>
          <button class="icon fplay" aria-label={playing ? "Pause" : "Play"} onclick={togglePlay}><Icon name={playing ? "pause" : "play"} size={20} /></button>
          <button class="icon" aria-label="Next" onclick={next}><Icon name="next" size={18} /></button>
          <button class="icon" aria-label="Exit focus mode (Z)" title="Exit focus mode (Z)" onclick={toggleFocus}><Icon name="close" size={15} /></button>
          <!-- a slim progress line along the bar's bottom edge -->
          <span class="fprog" aria-hidden="true"></span>
        </div>
      {/if}
    </main>
  {/if}

  {#if mvBgAvail && track && status === "ready"}
    <!-- turns the music video background off (or back on) for this song; fades away while idle unless kept -->
    <button
      class="mvskip"
      class:away={idle && !settings.mvSkipAlways}
      title={mvOff[tKey] ? "Show the music video behind this song again" : "Hide this song's music video background"}
      onclick={toggleMvBg}><Icon name="video" size={14} /> {mvOff[tKey] ? "Show video" : "Hide video"}</button
    >
  {/if}

  {#if error}
    <div class="toast" role="alert" transition:fly={{ y: 8, duration: 220 }}>
      <button aria-label="Dismiss: {error}" onclick={() => (error = "")}>{error}</button>
    </div>
  {:else if notice}
    <div class="toast info" role="status" transition:fly={{ y: 8, duration: 220 }}>
      <span>{notice}</span>
    </div>
  {/if}

  {#if panel === "settings"}
    <SettingsPanel onClose={() => (panel = null)} onLogout={logout} {sleepLabel} onSleep={sleep} />
  {:else if panel === "queue"}
    <Queue {upNext} onSkipTo={skipTo} onClose={() => (panel = null)} />
  {:else if panel === "fix" && track}
    <LyricsFix {track} current={lyrics} {hasOverride} onPick={pickLyrics} onReset={resetLyrics} onClose={() => (panel = null)} onFile={(text) => (saveLyricsFile(tKey, text), pickLyrics("file", tKey))} />
  {/if}
</div>

<style>
  /* Only <html> gets a color: a body background would paint over the backdrop layer. */
  :global(html) {
    background: #0b0b0d;
  }
  :global(html, body) {
    margin: 0;
    height: 100%;
    color: #f5f5f7;
    overflow: hidden;
    -webkit-font-smoothing: antialiased;
    user-select: none;
  }
  :global(button) {
    background: none;
    border: none;
    color: inherit;
    font: inherit;
    cursor: pointer;
    padding: 0;
  }
  :global(button:focus-visible) {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
    border-radius: 8px;
  }
  :global(input[type="range"]) {
    appearance: none;
    width: 100%;
    height: 4px;
    margin: 0;
    border-radius: 2px;
    background: linear-gradient(to right, rgba(255, 255, 255, 0.92) var(--fill), rgba(255, 255, 255, 0.16) var(--fill));
    cursor: pointer;
  }
  :global(input[type="range"]:hover) {
    background: linear-gradient(to right, var(--accent) var(--fill), rgba(255, 255, 255, 0.16) var(--fill));
  }
  :global(input[type="range"]::-webkit-slider-thumb) {
    appearance: none;
    width: 12px;
    height: 12px;
    border-radius: 50%;
    background: #fff;
    box-shadow: 0 1px 4px rgba(0, 0, 0, 0.4);
    transform: scale(0);
    transition: transform 0.18s cubic-bezier(0.2, 1.3, 0.4, 1);
  }
  :global(input[type="range"]:hover::-webkit-slider-thumb),
  :global(input[type="range"]:active::-webkit-slider-thumb),
  :global(input[type="range"]:focus-visible::-webkit-slider-thumb) {
    transform: scale(1);
  }
  .calm :global(*),
  .calm :global(*::before),
  .calm :global(*::after) {
    transition-duration: 0.01ms !important;
    animation-duration: 0.01ms !important;
  }

  .app {
    position: relative;
    z-index: 1; /* above the backdrop (z-index 0) */
    height: 100vh;
    display: flex;
    flex-direction: column;
    letter-spacing: -0.005em;
  }

  /* Chrome auto-hide */
  .chrome {
    transition: opacity 0.45s ease, translate 0.45s ease;
  }
  .hidden .chrome {
    opacity: 0;
    translate: 0 4px;
    pointer-events: none;
  }
  .hide-cursor {
    cursor: none;
  }

  /* ---- top bar: drag area + tools (queue, settings) ---- */
  .titlebar {
    position: absolute;
    inset: 0 0 auto 0;
    height: 44px;
    z-index: 30;
    display: flex;
    justify-content: flex-end;
    padding: 8px 10px;
    box-sizing: border-box;
  }
  .titlebar.left {
    justify-content: flex-start;
  }
  .mac .titlebar.left {
    padding-left: 78px; /* clear of the traffic lights */
  }
  .tools {
    display: flex;
    gap: 2px;
  }
  .left .tools {
    flex-direction: row-reverse; /* Customize stays at the outer edge on either side */
  }
  .tools {
    transition: opacity 0.45s ease, translate 0.45s ease;
  }
  .tools.gone {
    opacity: 0;
    translate: 0 -4px;
    pointer-events: none;
  }
  .tools.dim {
    opacity: 0.22;
  }
  .tools.dim:hover {
    opacity: 1;
    transition-duration: 0.15s;
  }
  .tools button,
  .wc button:not(.tl) {
    display: grid;
    place-items: center;
    width: 32px;
    height: 28px;
    border-radius: 7px;
    color: rgba(255, 255, 255, 0.62);
    transition: background 0.15s, color 0.15s;
  }
  .tools button:hover,
  .tools button.on,
  .wc button:not(.tl):hover {
    background: rgba(255, 255, 255, 0.1);
    color: #fff;
  }

  /* ---- window controls: revealed only from the very top edge ---- */
  .edge {
    position: fixed;
    inset: 0 0 auto 0;
    height: 6px;
    z-index: 61;
  }
  .wc {
    position: fixed;
    top: 0;
    right: 0;
    z-index: 60;
    display: flex;
    gap: 2px;
    padding: 6px 8px 8px;
    border-bottom-left-radius: 12px;
    background: rgba(12, 12, 15, 0.55);
    backdrop-filter: blur(16px);
    opacity: 0;
    translate: 0 -100%;
    pointer-events: none;
    transition: opacity 0.22s ease, translate 0.28s cubic-bezier(0.2, 0.8, 0.2, 1);
  }
  .edge:hover + .wc,
  .wc:hover,
  .wc:focus-within {
    opacity: 1;
    translate: 0 0;
    pointer-events: auto;
  }
  .wc .close:hover {
    background: #e5484d !important;
  }
  .mac .wc {
    right: auto;
    left: 0;
    gap: 8px;
    padding: 10px 12px 10px 14px;
    border-radius: 0 0 12px 0;
  }
  .tl {
    width: 12px;
    height: 12px;
    border-radius: 50%;
    box-shadow: inset 0 0 0 0.5px rgba(0, 0, 0, 0.25);
  }
  .tl.close {
    background: #ff5f57;
  }
  .tl.min {
    background: #febc2e;
  }
  .tl.max {
    background: #28c840;
  }

  /* ---- empty / sign-in states ---- */
  .center {
    margin: auto;
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
    gap: 0.8em;
    padding: 2em;
  }
  .brand {
    margin: 0;
    font-size: 2.4em;
    font-weight: 750;
    letter-spacing: -0.03em;
  }
  .muted {
    margin: 0;
    color: rgba(255, 255, 255, 0.62);
  }
  .fine {
    margin: 0;
    font-size: 0.75em;
    color: rgba(255, 255, 255, 0.4);
  }
  .pill {
    margin-top: 0.6em;
    padding: 0.8em 1.8em;
    border-radius: 999px;
    background: #fff;
    color: #000;
    font-weight: 700;
    transition: transform 0.2s cubic-bezier(0.2, 1.3, 0.4, 1), background 0.25s;
  }
  .pill:hover {
    transform: scale(1.04);
    background: var(--accent);
  }
  .pill:disabled {
    opacity: 0.6;
    transform: none;
  }

  /* ---- layout: player | spacer | lyrics, centered as a group. The spacer is exactly the "Lyrics distance" setting. ---- */
  .stage {
    flex: 1;
    min-height: 0;
    display: grid;
    grid-template-columns: minmax(0, calc(var(--art) * var(--s))) minmax(0, var(--gap)) minmax(0, var(--lw));
    grid-template-areas: "player . lyrics";
    justify-content: center;
    align-items: center;
    padding: 3.5em clamp(2em, 6vw, 7em) 2.5em;
  }
  .lyrics-left .stage {
    grid-template-columns: minmax(0, var(--lw)) minmax(0, var(--gap)) minmax(0, calc(var(--art) * var(--s)));
    grid-template-areas: "lyrics . player";
  }
  .player-only .stage {
    grid-template-columns: minmax(0, calc(var(--art) * var(--s)));
    grid-template-areas: "player";
    justify-content: center;
  }
  .lyrics-only .stage {
    grid-template-columns: minmax(0, var(--lw));
    grid-template-rows: minmax(0, 1fr) auto;
    grid-template-areas: "lyrics" "focusbar";
    justify-content: center;
    row-gap: 1em;
  }
  /* TV: big lyrics across the top that sink into a tall, glassy player bar along the bottom (player laid flat). */
  .tv .stage {
    grid-template-columns: minmax(0, 1fr);
    grid-template-rows: minmax(0, 1fr) auto;
    grid-template-areas: "lyrics" "player";
    justify-content: stretch;
    align-items: stretch;
    padding: 3em 0 0;
  }
  .tv .lyrics-col {
    --s: calc(var(--ui-s) * 1.3);
    justify-self: center;
    width: min(92vw, calc(var(--lw) * 1.5));
    margin-bottom: -7vh; /* run under the bar's soft top edge */
    text-align: center;
    z-index: 0;
  }
  /* Focus centers its lyrics over the centered now-playing bar, like TV */
  .lyrics-only .lyrics-col :global(.line),
  .tv .lyrics-col :global(.line) {
    text-align: center;
    transform-origin: center;
  }
  .tv .player {
    position: relative;
    z-index: 1;
    height: clamp(150px, 26vh, 280px);
    box-sizing: border-box;
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto minmax(0, 15em);
    grid-template-rows: 1fr auto;
    grid-template-areas: "art meta controls upnext" "art seek seek volume";
    align-items: center;
    column-gap: clamp(1em, 2.5vw, 2.4em);
    row-gap: 0.6em;
    padding: 2.4em clamp(1.5em, 4vw, 4em) 1.6em;
  }
  /* the glass: blur and darken, fading in from nothing at the top so the lyrics dissolve into it */
  .tv .player::before {
    content: "";
    position: absolute;
    inset: 0;
    z-index: -1;
    background: linear-gradient(to bottom, rgba(0, 0, 0, 0), rgba(0, 0, 0, 0.32) 45%, rgba(0, 0, 0, 0.42));
    backdrop-filter: blur(22px) saturate(1.2);
    mask-image: linear-gradient(to bottom, transparent, #000 40%);
    pointer-events: none;
  }
  .tv .art {
    grid-area: art;
    height: 100%;
    width: auto;
    max-width: none;
    max-height: none;
    align-self: stretch;
  }
  .tv .meta {
    grid-area: meta;
    min-width: 0;
    align-self: end;
  }
  .tv .meta h1 {
    font-size: 1.8em;
  }
  .tv .seek {
    grid-area: seek;
  }
  .tv .controls {
    grid-area: controls;
    gap: 1.1em;
    align-self: end;
  }
  .tv .volume {
    grid-area: volume;
    width: 100%;
  }
  .tv .upnext {
    grid-area: upnext;
    align-self: end;
    min-width: 0;
  }  .player {
    view-transition-name: player;
    grid-area: player;
    width: 100%;
    display: flex;
    flex-direction: column;
    gap: 1.05em;
  }
  .lyrics-col {
    view-transition-name: lyrics;
    grid-area: lyrics;
    width: 100%;
    height: 100%;
    min-height: 0;
  }

  .art {
    view-transition-name: art;
    position: relative;
    width: 100%;
    max-height: 54vh;
    max-width: 54vh;
    aspect-ratio: 1;
    align-self: center;
    border-radius: var(--art-radius);
    overflow: hidden;
    background: rgba(255, 255, 255, 0.05);
    cursor: grab;
    touch-action: none;
    /* tilt rides on transform, press/pop on scale, so they never fight */
    transform: perspective(900px) rotateX(var(--rx, 0deg)) rotateY(var(--ry, 0deg));
    transition:
      border-radius 0.3s,
      box-shadow 0.3s,
      transform 0.7s cubic-bezier(0.3, 1.5, 0.4, 1),
      scale 0.5s cubic-bezier(0.3, 1.4, 0.4, 1);
  }
  .art:hover {
    scale: 1.012;
  }
  .art:global(.pressed) {
    cursor: grabbing;
    scale: 0.97;
    transition:
      border-radius 0.3s,
      box-shadow 0.3s,
      transform 0.14s ease-out,
      scale 0.25s cubic-bezier(0.2, 0.8, 0.2, 1);
  }
  .art:global(.fired) {
    animation: art-pop 0.55s cubic-bezier(0.3, 1.5, 0.4, 1);
  }
  @keyframes art-pop {
    0% { scale: 0.95; }
    45% { scale: 1.035; }
    100% { scale: 1; }
  }
  /* hold-to-switch: a soft tide rising from the bottom */
  .fill {
    position: absolute;
    inset: 0;
    z-index: 1;
    pointer-events: none;
    background: linear-gradient(to top, rgba(255, 255, 255, 0.3), rgba(255, 255, 255, 0.18) 85%, rgba(255, 255, 255, 0));
    transform: scaleY(0);
    transform-origin: bottom;
    transition: transform 0.32s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.3s;
  }
  .art:global(.holding) .fill {
    transform: scaleY(1);
    transition: transform var(--hold, 750ms) cubic-bezier(0.45, 0, 0.3, 1) var(--hold-wait, 0ms);
  }
  .art:global(.fired) .fill {
    animation: fill-flash 0.6s ease-out forwards;
  }
  @keyframes fill-flash {
    0% { transform: scaleY(1); opacity: 1; }
    100% { transform: scaleY(1); opacity: 0; }
  }
  .volpop {
    position: absolute;
    left: 50%;
    top: 50%;
    translate: -50% -50%;
    z-index: 2;
    padding: 0.45em 0.9em;
    border-radius: 999px;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
    background: rgba(0, 0, 0, 0.45);
    backdrop-filter: blur(10px);
    pointer-events: none;
  }
  /* light catching the cover where you hold it */
  .glare {
    position: absolute;
    inset: 0;
    z-index: 1;
    pointer-events: none;
    background: radial-gradient(circle at var(--gx, 50%) var(--gy, 50%), rgba(255, 255, 255, 0.22), transparent 55%);
    mix-blend-mode: soft-light;
    opacity: 0;
    transition: opacity 0.5s ease;
  }
  .art:global(.pressed) .glare {
    opacity: 1;
    transition: opacity 0.15s ease;
  }
  .calm .art,
  .calm .art:global(.pressed) {
    scale: 1;
    animation: none;
  }
  .art.glow {
    box-shadow:
      0 0 calc(var(--art) * 0.3) calc(var(--art) * -0.02) color-mix(in oklab, var(--accent) 55%, transparent),
      0 0 0 1px rgba(255, 255, 255, 0.05);
  }
  .art.shadow.glow {
    box-shadow:
      0 30px 70px -20px rgba(0, 0, 0, 0.6),
      0 0 calc(var(--art) * 0.3) calc(var(--art) * -0.02) color-mix(in oklab, var(--accent) 55%, transparent),
      0 0 0 1px rgba(255, 255, 255, 0.05);
  }
  .art.shadow {
    box-shadow:
      0 30px 70px -20px rgba(0, 0, 0, 0.6),
      0 22px 60px -30px color-mix(in oklab, var(--accent) 45%, transparent), /* a hint of the album's color */
      0 0 0 1px rgba(255, 255, 255, 0.05);
  }
  .art img {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
  .watch {
    position: absolute;
    left: 50%;
    bottom: 0.8em;
    translate: -50% 0;
    display: flex;
    align-items: center;
    gap: 0.4em;
    padding: 0.5em 0.95em;
    border-radius: 999px;
    font-size: 0.78em;
    font-weight: 650;
    background: rgba(0, 0, 0, 0.5);
    backdrop-filter: blur(14px) saturate(1.4);
    border: 1px solid rgba(255, 255, 255, 0.14);
    opacity: 0.88;
    transition: opacity 0.2s, transform 0.2s cubic-bezier(0.2, 1.3, 0.4, 1), background 0.2s, translate 0.45s ease;
  }
  .watch.away {
    opacity: 0;
    translate: -50% 6px;
    pointer-events: none;
    transition-duration: 0.45s;
  }
  .watch:hover {
    opacity: 1;
    transform: scale(1.05);
    background: rgba(0, 0, 0, 0.65);
  }

  .meta h1 {
    margin: 0;
    font-size: 1.45em;
    font-weight: 700;
    letter-spacing: -0.02em;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .title {
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    font-weight: inherit;
    letter-spacing: inherit;
    text-align: left;
  }
  .title:hover {
    text-decoration: underline;
    text-decoration-color: rgba(255, 255, 255, 0.35);
    text-underline-offset: 0.18em;
  }
  .meta p {
    margin-top: 0.2em;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .seek {
    display: flex;
    flex-direction: column;
    gap: 0.5em;
  }
  .times {
    display: flex;
    justify-content: space-between;
    font-size: 0.72em;
    font-variant-numeric: tabular-nums;
    color: rgba(255, 255, 255, 0.5);
    cursor: default;
  }

  .controls {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  .icon {
    position: relative;
    display: grid;
    place-items: center;
    padding: 0.45em;
    border-radius: 50%;
    color: rgba(255, 255, 255, 0.6);
    transition: color 0.15s, transform 0.2s cubic-bezier(0.2, 1.3, 0.4, 1);
  }
  .icon:hover {
    color: #fff;
  }
  .icon:active {
    transform: scale(0.88);
  }
  .icon.big {
    color: rgba(255, 255, 255, 0.9);
  }
  .icon.on {
    color: var(--accent);
  }
  .icon.on::after {
    content: "";
    position: absolute;
    bottom: 0;
    left: 50%;
    width: 4px;
    height: 4px;
    margin-left: -2px;
    border-radius: 50%;
    background: currentColor;
  }
  .badge {
    position: absolute;
    top: 0.1em;
    right: 0.05em;
    font-size: 0.55em;
    font-weight: 800;
  }
  .play {
    display: grid;
    place-items: center;
    width: 3.6em;
    height: 3.6em;
    background: #fff;
    color: #000;
    transition: transform 0.22s cubic-bezier(0.2, 1.3, 0.4, 1), background 0.25s, border-radius 0.3s;
  }
  .play.circle {
    border-radius: 50%;
  }
  .play.squircle {
    border-radius: 32%;
  }
  .play.bare {
    background: none;
    color: #fff;
  }
  .play:hover {
    transform: scale(1.07);
  }
  .play:active {
    transform: scale(0.93);
  }

  .volume {
    display: flex;
    align-items: center;
    gap: 0.4em;
    width: 55%;
    align-self: center;
  }

  .upnext {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.15em;
    min-width: 0;
    font-size: 0.74em;
    color: rgba(255, 255, 255, 0.5);
    border-radius: 8px;
    padding: 0.3em 0.5em;
    transition: color 0.15s, background 0.15s, opacity 0.45s ease, translate 0.45s ease;
  }
  .upnext:hover {
    color: rgba(255, 255, 255, 0.85);
    background: rgba(255, 255, 255, 0.05);
  }
  .upnext .label {
    font-size: 0.85em;
    text-transform: uppercase;
    letter-spacing: 0.14em;
    opacity: 0.7;
  }
  .upnext .name {
    max-width: 100%;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .focusbar {
    position: relative;
    grid-area: focusbar;
    justify-self: center;
    display: flex;
    align-items: center;
    gap: 0.5em;
    width: min(100%, 34em);
    padding: 0.5em 0.7em 0.5em 0.5em;
    border-radius: 1.1em;
    background: rgba(255, 255, 255, 0.08);
    backdrop-filter: blur(18px);
    box-shadow: 0 12px 40px -16px rgba(0, 0, 0, 0.6);
    overflow: hidden;
  }
  .focusbar img {
    width: 3.2em;
    height: 3.2em;
    border-radius: 0.7em;
    object-fit: cover;
    flex: none;
  }
  .focusbar .name {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 0.1em;
    white-space: nowrap;
  }
  .focusbar .name > * {
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .focusbar .name b {
    font-weight: 650;
  }
  .focusbar .name span {
    font-size: 0.82em;
    color: rgba(255, 255, 255, 0.6);
  }
  .focusbar .time {
    font-size: 0.75em;
    font-variant-numeric: tabular-nums;
    color: rgba(255, 255, 255, 0.5);
    white-space: nowrap;
  }
  .focusbar .fplay {
    background: rgba(255, 255, 255, 0.14);
    border-radius: 50%;
  }
  .fprog {
    position: absolute;
    left: 0;
    bottom: 0;
    height: 2px;
    width: var(--fp);
    background: var(--accent);
    opacity: 0.8;
    transition: width 0.3s linear;
  }

  .toast {
    position: absolute;
    left: 50%;
    bottom: 1.2em;
    translate: -50% 0;
    max-width: min(520px, 90vw);
    z-index: 35;
  }
  .toast button,
  .toast span {
    display: block;
    padding: 0.6em 1em;
    border-radius: 10px;
    background: rgba(30, 10, 12, 0.75);
    backdrop-filter: blur(16px);
    border: 1px solid rgba(255, 120, 120, 0.25);
    color: #ffb4b4;
    font-size: 0.8em;
    text-align: left;
  }
  .toast.info span {
    background: rgba(18, 18, 22, 0.75);
    border-color: rgba(255, 255, 255, 0.1);
    color: rgba(255, 255, 255, 0.9);
  }

  /* Header: a slim now-playing strip on top, lyrics centered under it (tall windows, vertical monitors) */
  .header .stage {
    grid-template-columns: minmax(0, var(--lw));
    grid-template-rows: auto minmax(0, 1fr);
    grid-template-areas: "player" "lyrics";
    justify-content: center;
    align-items: stretch;
    row-gap: 1.4em;
    padding: 3.2em 2em 1.5em;
  }
  .header .player,
  .corner .player {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    grid-template-areas: "art meta controls" "art seek seek";
    align-items: center;
    column-gap: 1.2em;
    row-gap: 0.3em;
  }
  .header .art,
  .corner .art {
    grid-area: art;
    width: clamp(64px, 13vh, 132px);
    max-width: none;
    max-height: none;
  }
  .header .meta,
  .corner .meta {
    grid-area: meta;
    min-width: 0;
    text-align: left;
    align-self: end;
  }
  .header .seek,
  .corner .seek {
    grid-area: seek;
  }
  .header .controls,
  .corner .controls {
    grid-area: controls;
    gap: 0.5em;
    align-self: end;
  }
  .header .volume,
  .header .upnext,
  .corner .volume,
  .corner .upnext {
    display: none;
  }
  .header .lyrics-col :global(.line),
  .corner .lyrics-col :global(.line) {
    text-align: center;
    transform-origin: center;
  }
  /* Corner: the lyrics have the stage; the player is a small glass card in the bottom-left (made for video backgrounds) */
  .corner .stage {
    grid-template-columns: minmax(0, var(--lw));
    grid-template-areas: "lyrics";
    justify-content: center;
    padding: 3em 2em 7em;
  }
  .corner .player {
    position: fixed;
    left: 1.4em;
    bottom: 1.4em;
    z-index: 2;
    width: min(24em, calc(100vw - 2.8em));
    grid-template-columns: auto minmax(0, 1fr);
    grid-template-areas: "art meta" "art controls" "seek seek";
    padding: 0.8em;
    border-radius: 1.1em;
    background: rgba(0, 0, 0, 0.28);
    backdrop-filter: blur(18px);
    box-shadow: 0 16px 48px -18px rgba(0, 0, 0, 0.7);
    font-size: 0.86em;
  }
  .corner .art {
    width: 4.6em;
  }
  .corner .controls {
    justify-content: flex-start;
  }
  .mvskip {
    position: fixed;
    right: 1.2em;
    bottom: 1.2em;
    z-index: 3;
    display: flex;
    align-items: center;
    gap: 0.45em;
    padding: 0.45em 0.85em;
    border-radius: 999px;
    font-size: 0.78em;
    color: rgba(255, 255, 255, 0.85);
    background: rgba(0, 0, 0, 0.35);
    backdrop-filter: blur(12px);
    transition: opacity 0.45s ease, background 0.2s;
  }
  .mvskip:hover {
    background: rgba(0, 0, 0, 0.55);
  }
  .tv .mvskip {
    bottom: calc(clamp(150px, 26vh, 280px) + 1em); /* above the TV player bar */
  }
  .mvskip.away {
    opacity: 0;
    pointer-events: none;
  }

  /* Narrow windows: stack the player above the lyrics. */
  @media (max-width: 760px) {
    .stage,
    .lyrics-left .stage {
      grid-template-columns: minmax(0, 1fr);
      grid-template-rows: auto minmax(0, 1fr);
      grid-template-areas: "player" "lyrics";
      padding: 3em 1.5em 1.5em;
      row-gap: 1em;
    }
    .player-only .stage {
      grid-template-rows: minmax(0, 1fr);
    }
    .lyrics-only .stage {
      grid-template-rows: minmax(0, 1fr) auto;
      grid-template-areas: "lyrics" "focusbar";
    }
    .app:not(.player-only) .art {
      max-height: 24vh;
      max-width: 24vh;
    }
    .app:not(.player-only) .upnext {
      display: none;
    }
  }
  /* game mode: no frosted glass and no lyric blur (the heaviest GPU work) */
  .no-blur :global(*),
  .no-blur :global(*::before) {
    backdrop-filter: none !important;
  }
  .no-blur :global(.line) {
    filter: none !important;
  }
  /* the accent glides between albums instead of snapping (registered so it can be animated) */
  @property --accent {
    syntax: "<color>";
    inherits: true;
    initial-value: #1ed760;
  }
  @property --song {
    syntax: "<color>";
    inherits: true;
    initial-value: #1ed760;
  }
  .app {
    transition: --accent 1.2s ease, --song 1.2s ease;
  }
  :global(::selection) {
    background: color-mix(in oklab, var(--accent) 45%, transparent);
    color: #fff;
  }
  /* layout morphs (see setLayout): one calm, matched curve for every moving piece */
  :global(::view-transition-group(*)) {
    animation-duration: 0.62s;
    animation-timing-function: cubic-bezier(0.33, 0, 0.15, 1);
  }
  :global(::view-transition-old(*)),
  :global(::view-transition-new(*)) {
    animation-duration: 0.42s;
    animation-timing-function: ease;
  }
  /* the cover keeps its shape while it moves: no cross-fade ghosting between two copies */
  :global(::view-transition-old(art)) {
    display: none;
  }
  :global(::view-transition-new(art)) {
    animation: none;
  }
</style>
