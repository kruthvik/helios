<script lang="ts">
  import { untrack } from "svelte";
  import { fly, fade } from "svelte/transition";
  import { cubicOut } from "svelte/easing";
  import { api, bestImage, type SdkTrack } from "./spotify";
  import Icon from "./Icon.svelte";

  type QItem = { uri: string; name: string; artists: string; cover: string | null; durationMs: number };
  type ApiTrack = {
    uri: string;
    name: string;
    duration_ms: number;
    artists?: { name: string }[];
    album?: { images: { url: string; width?: number | null }[] };
    show?: { name: string; images: { url: string; width?: number | null }[] };
  };

  let { upNext, onSkipTo, onClose }: { upNext: SdkTrack[]; onSkipTo: (n: number) => void; onClose: () => void } = $props();

  const fromSdk = (t: SdkTrack): QItem => ({
    uri: t.uri,
    name: t.name,
    artists: t.artists.map((a) => a.name).join(", "),
    cover: bestImage(t.album.images, 64),
    durationMs: t.duration_ms ?? 0,
  });
  const fromApi = (t: ApiTrack): QItem => ({
    uri: t.uri,
    name: t.name,
    artists: t.artists?.map((a) => a.name).join(", ") ?? t.show?.name ?? "",
    cover: bestImage(t.album?.images ?? t.show?.images ?? [], 64),
    durationMs: t.duration_ms,
  });

  // Show the SDK's next tracks instantly, then fill in the full queue with one request.
  let items = $state.raw<QItem[]>(untrack(() => upNext.map(fromSdk)));
  let loading = $state(true);
  let failed = $state(false);
  api<{ queue: ApiTrack[] }>("/me/player/queue")
    .then((r) => r?.queue?.length && (items = r.queue.slice(0, 30).map(fromApi)))
    .catch(() => (failed = true))
    .finally(() => (loading = false));

  const fmt = (ms: number) => `${Math.floor(ms / 60000)}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, "0")}`;
</script>

<div class="scrim" transition:fade={{ duration: 160 }} onclick={onClose} role="presentation"></div>

<aside class="queue" aria-label="Up next" transition:fly={{ x: 28, duration: 260, easing: cubicOut }}>
  <header>
    <h2>Up next</h2>
    <button class="icon-btn" aria-label="Close queue" onclick={onClose}><Icon name="close" size={18} /></button>
  </header>
  <ol>
    {#each items as item, i (item.uri + i)}
      <li in:fly={{ y: 8, duration: 220, delay: Math.min(i, 10) * 18 }}>
        <button onclick={() => onSkipTo(i + 1)} title="Skip to this track">
          {#if item.cover}<img src={item.cover} alt="" loading="lazy" />{:else}<span class="ph"><Icon name="music" size={16} /></span>{/if}
          <span class="what">
            <span class="t">{item.name}</span>
            <span class="a">{item.artists}</span>
          </span>
          {#if item.durationMs}<span class="dur">{fmt(item.durationMs)}</span>{/if}
        </button>
      </li>
    {:else}
      {#if !loading}<li class="empty">Nothing queued.</li>{/if}
    {/each}
    {#if loading}<li class="more">Loading the rest…</li>{/if}
    {#if failed && items.length}<li class="more">Couldn't load the full queue.</li>{/if}
  </ol>
</aside>

<style>
  .scrim {
    position: fixed;
    inset: 0;
    z-index: 40;
  }
  .queue {
    position: fixed;
    z-index: 50;
    top: 10px;
    right: 10px;
    bottom: 10px;
    width: min(340px, calc(100vw - 20px));
    display: flex;
    flex-direction: column;
    background: rgba(18, 18, 22, 0.72);
    backdrop-filter: blur(28px) saturate(1.4);
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 16px;
    box-shadow: 0 24px 60px rgba(0, 0, 0, 0.45);
    overflow: hidden;
    font-size: 0.88rem;
  }
  header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 0.9rem 1rem;
    border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  }
  h2 {
    margin: 0;
    font-size: 1rem;
  }
  ol {
    list-style: none;
    margin: 0;
    padding: 0.4rem;
    overflow-y: auto;
    scrollbar-width: thin;
    scrollbar-color: rgba(255, 255, 255, 0.15) transparent;
  }
  li button {
    width: 100%;
    display: flex;
    align-items: center;
    gap: 0.7rem;
    padding: 0.45rem 0.5rem;
    border-radius: 10px;
    text-align: left;
    transition: background 0.15s;
  }
  li button:hover {
    background: rgba(255, 255, 255, 0.07);
  }
  img,
  .ph {
    width: 40px;
    height: 40px;
    border-radius: 6px;
    object-fit: cover;
    flex-shrink: 0;
    background: rgba(255, 255, 255, 0.06);
  }
  .ph {
    display: grid;
    place-items: center;
    color: rgba(255, 255, 255, 0.4);
  }
  .what {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
  }
  .t,
  .a {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .t {
    font-weight: 600;
  }
  .a {
    font-size: 0.78rem;
    color: rgba(255, 255, 255, 0.55);
  }
  .dur {
    font-size: 0.74rem;
    color: rgba(255, 255, 255, 0.45);
    font-variant-numeric: tabular-nums;
  }
  .empty,
  .more {
    padding: 0.9rem 0.6rem;
    color: rgba(255, 255, 255, 0.5);
    font-size: 0.8rem;
    text-align: center;
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
