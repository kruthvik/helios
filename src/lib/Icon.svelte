<script lang="ts" module>
  // Shapes as data (not {@html}), so Svelte creates real SVG elements.
  // f = a shape themes may fill; everything else is stroked.
  type Shape =
    | { p: string; f?: true }
    | { r: [x: number, y: number, w: number, h: number]; f?: true }
    | { c: [cx: number, cy: number, r: number]; f?: true };

  const ICONS = {
    play: [{ p: "M7.5 4.8v14.4l12-7.2z", f: true }],
    pause: [{ r: [6, 4.8, 4, 14.4], f: true }, { r: [14, 4.8, 4, 14.4], f: true }],
    next: [{ p: "M5.5 5.2v13.6l9.8-6.8z", f: true }, { p: "M18.5 5v14" }],
    prev: [{ p: "M18.5 5.2v13.6l-9.8-6.8z", f: true }, { p: "M5.5 5v14" }],
    shuffle: [{ p: "M16 4h4v4M4 20 20 4M20 16v4h-4M14.5 14.5 20 20M4 4l5 5" }],
    repeat: [{ p: "M17 2.5 20.5 6 17 9.5M3.5 11V9.5A3.5 3.5 0 0 1 7 6h13.5M7 21.5 3.5 18 7 14.5M20.5 13v1.5A3.5 3.5 0 0 1 17 18H3.5" }],
    volume: [{ p: "M4 9.5h3.5L12 5.5v13l-4.5-4H4z", f: true }, { p: "M15.5 9a4 4 0 0 1 0 6M18.5 6.5a7.5 7.5 0 0 1 0 11" }],
    mute: [{ p: "M4 9.5h3.5L12 5.5v13l-4.5-4H4z", f: true }, { p: "m16 9.5 5 5M21 9.5l-5 5" }],
    tune: [{ p: "M4 7h9M19 7h1M4 17h3M13 17h7" }, { c: [16, 7, 2.5] }, { c: [10, 17, 2.5] }],
    minimize: [{ p: "M6 12h12" }],
    maximize: [{ r: [6.5, 6.5, 11, 11] }],
    fullscreen: [{ p: "M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5" }],
    close: [{ p: "M7 7l10 10M17 7 7 17" }],
    mini: [{ r: [3, 5, 18, 14] }, { r: [12, 12, 6, 4], f: true }],
    expand: [{ p: "M14 4h6v6M20 4l-6.5 6.5M10 20H4v-6M4 20l6.5-6.5" }],
    logout: [{ p: "M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 17l5-5-5-5M15 12H4" }],
    music: [{ p: "M9 18V5l11-2v13" }, { c: [6, 18, 3], f: true }, { c: [17, 16, 3], f: true }],
    queue: [{ p: "M4 6h11M4 11h11M4 16h7" }, { p: "M15.5 14v6l5-3z", f: true }],
    swap: [{ p: "M7 4 3.5 7.5 7 11M3.5 7.5H17M17 13l3.5 3.5L17 20M20.5 16.5H7" }],
    search: [{ c: [11, 11, 6.5] }, { p: "m16 16 4.5 4.5" }],
    edit: [{ p: "M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16z" }, { p: "m13.5 6.5 4 4" }],
    minus: [{ p: "M6 12h12" }],
    plus: [{ p: "M12 6v12M6 12h12" }],
    undo: [{ p: "M9 14 4 9l5-5" }, { p: "M4 9h10.5a5.5 5.5 0 0 1 0 11H11" }],
    check: [{ p: "m5 12.5 4.5 4.5L19 7.5" }],
    video: [{ r: [3, 6, 13, 12] }, { p: "m16 10.5 5-3v9l-5-3z", f: true }],
    moon: [{ p: "M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z" }],
    focus: [{ p: "M4 7h16M4 12h16M7 17h10" }],
    link: [{ p: "M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" }],
  } satisfies Record<string, Shape[]>;
  export type IconName = keyof typeof ICONS;
</script>

<script lang="ts">
  import { settings } from "./settings.svelte";

  let { name, size = 22 }: { name: IconName; size?: number } = $props();
  let shapes = $derived(ICONS[name] as Shape[]);
</script>

<svg class="icon {settings.iconTheme}" viewBox="0 0 24 24" width="{size / 16}em" height="{size / 16}em" aria-hidden="true">
  {#each shapes as s}
    {#if "p" in s}
      <path d={s.p} class:f={s.f} />
    {:else if "r" in s}
      <rect x={s.r[0]} y={s.r[1]} width={s.r[2]} height={s.r[3]} class:f={s.f} />
    {:else}
      <circle cx={s.c[0]} cy={s.c[1]} r={s.c[2]} class:f={s.f} />
    {/if}
  {/each}
</svg>

<style>
  .icon {
    display: block;
    flex-shrink: 0;
    fill: none;
    stroke: currentColor;
    stroke-width: 2;
    stroke-linecap: round;
    stroke-linejoin: round;
    overflow: visible;
  }
  .f {
    fill: currentColor;
  }
  rect {
    rx: 1.4px;
  }

  .sharp {
    stroke-linecap: square;
    stroke-linejoin: miter;
  }
  .sharp rect {
    rx: 0;
  }

  .solid {
    stroke-width: 2.6;
  }
  .solid rect {
    rx: 2px;
  }

  .thin {
    stroke-width: 1.4;
  }
  .thin .f {
    fill: none;
  }
</style>
