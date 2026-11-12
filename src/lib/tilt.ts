// Press-and-drag tilt for the album art, plus press-and-hold to trigger an action.
// Writes CSS vars on the element (--rx/--ry tilt in deg, --gx/--gy glare position in %, --hold ms)
// and toggles .pressed / .holding / .fired; all motion itself is CSS so it stays on the compositor.
export type TiltOpts = { onHold: () => void; holdMs?: number; max?: number; still?: boolean };

const SLOP = 12; // px: a real drag means "tilting"; the tremor of pressing a trackpad or mouse doesn't
const WAIT = 380; // ms of holding still before the fill even starts, so playing with the cover never triggers it

export function tilt(el: HTMLElement, opts: TiltOpts) {
  let o = opts;
  let id = -1, x0 = 0, y0 = 0, timer: ReturnType<typeof setTimeout> | 0 = 0, raf = 0;
  let px = 0, py = 0;

  const stopHold = () => (clearTimeout(timer), (timer = 0), el.classList.remove("holding"));
  const paint = () => {
    raf = 0;
    const r = el.getBoundingClientRect();
    const nx = Math.max(-1, Math.min(1, ((px - r.left) / r.width) * 2 - 1));
    const ny = Math.max(-1, Math.min(1, ((py - r.top) / r.height) * 2 - 1));
    const max = o.still ? 0 : (o.max ?? 14);
    el.style.setProperty("--rx", `${(-ny * max).toFixed(2)}deg`);
    el.style.setProperty("--ry", `${(nx * max).toFixed(2)}deg`);
    el.style.setProperty("--gx", `${((nx + 1) * 50).toFixed(1)}%`);
    el.style.setProperty("--gy", `${((ny + 1) * 50).toFixed(1)}%`);
  };
  const move = (e: PointerEvent) => {
    if (e.pointerId !== id) return;
    (px = e.clientX), (py = e.clientY);
    if (timer && Math.hypot(px - x0, py - y0) > SLOP) stopHold();
    raf ||= requestAnimationFrame(paint);
  };
  const down = (e: PointerEvent) => {
    if (e.button !== 0 || id !== -1 || (e.target as Element).closest("button, a, input")) return;
    e.preventDefault(); // no native image drag (it cancels the pointer and kills the tilt) or text selection
    id = e.pointerId;
    (x0 = px = e.clientX), (y0 = py = e.clientY);
    el.setPointerCapture(id);
    el.classList.remove("fired");
    el.classList.add("pressed", "holding");
    const ms = o.holdMs ?? 650;
    el.style.setProperty("--hold", `${ms}ms`);
    el.style.setProperty("--hold-wait", `${WAIT}ms`);
    paint();
    timer = setTimeout(() => {
      timer = 0;
      el.classList.remove("holding");
      void el.offsetWidth; // restart the pop animation if it ran before
      el.classList.add("fired");
      o.onHold();
    }, ms + WAIT);
  };
  const up = (e: PointerEvent) => {
    if (e.pointerId !== id) return;
    id = -1;
    stopHold();
    cancelAnimationFrame(raf), (raf = 0);
    el.classList.remove("pressed");
    for (const v of ["--rx", "--ry"]) el.style.setProperty(v, "0deg"); // springs back via CSS
  };

  el.addEventListener("pointerdown", down);
  el.addEventListener("pointermove", move);
  el.addEventListener("pointerup", up);
  el.addEventListener("pointercancel", up);
  el.addEventListener("lostpointercapture", up);
  return {
    update: (n: TiltOpts) => void (o = n),
    destroy() {
      stopHold();
      cancelAnimationFrame(raf);
      el.removeEventListener("pointerdown", down);
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      el.removeEventListener("pointercancel", up);
      el.removeEventListener("lostpointercapture", up);
    },
  };
}
