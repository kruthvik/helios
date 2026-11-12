import { invoke } from "@tauri-apps/api/core";
import { currentMonitor, getCurrentWindow, LogicalSize, PhysicalPosition, PhysicalSize } from "@tauri-apps/api/window";
import { settings } from "./settings.svelte";

// Switches the one window between the full app and a small fixed-size miniplayer, remembering where each lived.
type Bounds = { x: number; y: number; w: number; h: number; max: boolean };

const MODE = "helios.mini";
const FULL = "helios.fullBounds"; // physical px
const SPOT = "helios.miniSpot"; // physical px
export const MINI_W = 400;
// the lyrics area grows with the text size, and shrinks when the next line is hidden
export const miniHeight = (lyrics: boolean) => (lyrics ? 92 + Math.round((settings.miniNext ? 76 : 58) * settings.miniTextSize) : 92);

const win = getCurrentWindow();
const readJson = <T>(k: string): T | null => {
  try {
    return JSON.parse(localStorage.getItem(k) ?? "null");
  } catch {
    return null;
  }
};

export const savedMini = () => localStorage.getItem(MODE) === "1";
export const saveMini = (on: boolean) => localStorage.setItem(MODE, on ? "1" : "0");

/** `fromFull` = false on startup, when the window is already mini-sized and its bounds aren't worth saving. */
export async function enterMini(lyrics: boolean, fromFull: boolean) {
  if (fromFull) {
    if (await win.isFullscreen()) await invoke("toggle_fullscreen");
    const [p, s, max] = await Promise.all([win.outerPosition(), win.outerSize(), win.isMaximized()]);
    localStorage.setItem(FULL, JSON.stringify({ x: p.x, y: p.y, w: s.width, h: s.height, max } satisfies Bounds));
    if (max) await win.unmaximize();
  }
  await win.setMinSize(new LogicalSize(MINI_W, miniHeight(false)));
  await win.setResizable(false);
  await win.setSize(new LogicalSize(MINI_W, miniHeight(lyrics)));
  const spot = readJson<{ x: number; y: number }>(SPOT);
  if (spot) return win.setPosition(new PhysicalPosition(spot.x, spot.y));
  // First time: top-right corner of this screen, clear of the edges.
  const m = await currentMonitor();
  if (!m) return;
  const area = m.workArea;
  const pad = Math.round(20 * m.scaleFactor);
  const w = Math.round(MINI_W * m.scaleFactor);
  await win.setPosition(new PhysicalPosition(area.position.x + area.size.width - w - pad, area.position.y + pad));
}

export const resizeMini = (lyrics: boolean) => win.setSize(new LogicalSize(MINI_W, miniHeight(lyrics)));

export async function exitMini() {
  const p = await win.outerPosition();
  localStorage.setItem(SPOT, JSON.stringify({ x: p.x, y: p.y }));
  await win.setResizable(true);
  await win.setMinSize(new LogicalSize(380, 420)); // same as tauri.conf.json
  const full = readJson<Bounds>(FULL);
  await win.setSize(full ? new PhysicalSize(full.w, full.h) : new LogicalSize(1100, 680));
  if (full) await win.setPosition(new PhysicalPosition(full.x, full.y));
  else await win.center();
  if (full?.max) await win.maximize();
}
