/** Recover Blink/WebKit's 1/64px layout unit from rounded CSSOM serialization. */
export function measuredLyricHeight(css: string): string {
  if (!css.endsWith("px")) return css;
  const value = Number.parseFloat(css);
  return Number.isFinite(value) ? `${Math.round(value * 64) / 64}px` : css;
}

