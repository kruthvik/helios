/** Resolves once the image is decoded (or failed to load), so swapping it in never shows a half-loaded frame. */
export function decoded(src: string): Promise<void> {
  const img = new Image();
  img.src = src;
  return img.decode().catch(() => {});
}
