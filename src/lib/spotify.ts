import { invoke } from "@tauri-apps/api/core";

// Minimal types for the parts of the Web Playback SDK we use.
export type SdkTrack = {
  uri: string;
  name: string;
  duration_ms?: number;
  artists: { name: string }[];
  album: { name: string; images: { url: string; width?: number | null }[] };
};
export type SdkState = {
  paused: boolean;
  position: number;
  timestamp?: number; // Date.now() when Spotify measured position (undocumented, so optional)
  duration: number;
  shuffle: boolean;
  repeat_mode: 0 | 1 | 2; // off, context, track
  track_window: { current_track: SdkTrack | null; next_tracks: SdkTrack[] };
};
export type SdkPlayer = {
  connect(): Promise<boolean>;
  disconnect(): void;
  addListener(event: string, cb: (arg: any) => void): void;
  togglePlay(): Promise<void>;
  resume(): Promise<void>;
  pause(): Promise<void>;
  nextTrack(): Promise<void>;
  previousTrack(): Promise<void>;
  seek(ms: number): Promise<void>;
  setVolume(v: number): Promise<void>;
  getVolume(): Promise<number>;
  activateElement(): Promise<void>;
  getCurrentState(): Promise<SdkState | null>; // local to the SDK, no network
};

declare global {
  interface Window {
    Spotify: { Player: new (opts: { name: string; getOAuthToken: (cb: (t: string) => void) => void; volume?: number }) => SdkPlayer };
    onSpotifyWebPlaybackSDKReady: () => void;
  }
}

let sdk: Promise<void> | null = null;
export function loadSdk(): Promise<void> {
  return (sdk ??= new Promise((resolve, reject) => {
    window.onSpotifyWebPlaybackSDKReady = resolve;
    const s = document.createElement("script");
    s.src = "https://sdk.scdn.co/spotify-player.js";
    s.onerror = () => reject(new Error("Couldn't load the Spotify player (offline?)"));
    document.head.appendChild(s);
  }));
}

export const token = () => invoke<string>("token");

/** One-off Web API call (only on user actions, never polled). Returns parsed JSON when there is a body. */
export async function api<T = unknown>(path: string, method = "GET", body?: unknown): Promise<T | null> {
  const res = await fetch(`https://api.spotify.com/v1${path}`, {
    method,
    headers: { Authorization: `Bearer ${await token()}`, ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`Spotify ${res.status}: ${(await res.text()) || res.statusText}`);
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

export const bestImage = (images: { url: string; width?: number | null }[], target = 640) =>
  [...images].sort((a, b) => Math.abs((a.width ?? target) - target) - Math.abs((b.width ?? target) - target))[0]?.url ?? null;
