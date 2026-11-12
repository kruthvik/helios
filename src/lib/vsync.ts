// The display's frame interval, measured, so a frame-rate cap can be a whole number of display frames. A cap that
// isn't (60 fps on a 75 Hz monitor) drew on an uneven mix of every frame and every other one, which shows as judder:
// there the old code landed on every second frame, 37 fps. Evenly spaced frames at the nearest rate look smoother
// than the exact number.

let vsync = 1000 / 60;

/** Milliseconds that must have passed since the last drawn frame before the next is due under this cap
 *  (0 = every display frame). Half a display frame of slack, so timer and vsync jitter never skip one. */
export function capMs(fps: number, display = vsync) {
  return fps === Infinity ? 0 : (Math.max(1, Math.round(1000 / fps / display)) - 0.5) * display;
}

if (typeof requestAnimationFrame !== "undefined") {
  // the median of a dozen frames, taken again now and then: the window may have moved to another monitor
  const measure = () => {
    const d: number[] = [];
    let last = 0;
    requestAnimationFrame(function tick(now) {
      if (last) d.push(now - last);
      last = now;
      if (d.length < 12) return void requestAnimationFrame(tick);
      const m = d.sort((a, b) => a - b)[6];
      if (m > 3 && m < 40) vsync = m; // anything else was a hidden or stalled window, not a display
    });
  };
  measure();
  setInterval(() => document.hidden || measure(), 20_000);
}
