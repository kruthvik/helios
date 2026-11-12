<script lang="ts">
  import { untrack } from "svelte";
  import { fly, fade } from "svelte/transition";
  import { cubicOut } from "svelte/easing";
  import { cleanTitle, searchCandidates, type Candidate, type Lyrics, type Source } from "./lyrics";
  import Icon from "./Icon.svelte";

  let {
    track,
    current,
    hasOverride,
    onPick,
    onReset,
    onClose,
    onFile,
  }: {
    track: { name: string; artists: string; durationMs: number };
    current: Lyrics | null;
    hasOverride: boolean;
    onPick: (source: Source, id: string) => void;
    onReset: () => void;
    onClose: () => void;
    onFile: (text: string) => void;
  } = $props();

  async function loadFile(e: Event) {
    const f = (e.currentTarget as HTMLInputElement).files?.[0];
    if (f && f.size < 2_000_000) onFile(await f.text()); // lyrics are kilobytes; refuse anything that clearly isn't
  }

  // Prefilled once from the song; the user edits them freely after that.
  let title = $state(untrack(() => cleanTitle(track.name)));
  let artist = $state(untrack(() => track.artists.split(",")[0].trim()));
  let results = $state.raw<Candidate[] | null>(null);
  let searching = $state(false);

  async function search(e?: Event) {
    e?.preventDefault();
    searching = true;
    results = await searchCandidates(title, artist, track.durationMs).catch(() => []);
    searching = false;
  }
  search();

  const fmt = (ms: number) => `${Math.floor(ms / 60000)}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, "0")}`;
  const diff = (c: Candidate) => Math.round((c.durationMs - track.durationMs) / 1000);
  const isCurrent = (c: Candidate) => current && current.kind !== "none" && current.source === c.source && current.id === c.id;
</script>

<div class="scrim" transition:fade={{ duration: 160 }} onclick={onClose} role="presentation"></div>

<div class="sheet" role="dialog" aria-label="Choose lyrics" transition:fly={{ y: 16, duration: 240, easing: cubicOut }}>
  <header>
    <div>
      <h2>Lyrics don't match?</h2>
      <p>Pick another version. Helios remembers it for this song.</p>
    </div>
    <button class="icon-btn" aria-label="Close" onclick={onClose}><Icon name="close" size={18} /></button>
  </header>

  <form class="search" onsubmit={search}>
    <input bind:value={title} placeholder="Title" aria-label="Title" />
    <input bind:value={artist} placeholder="Artist" aria-label="Artist" />
    <button class="go" type="submit" aria-label="Search"><Icon name="search" size={16} /></button>
  </form>

  <ul class="results" aria-busy={searching}>
    {#if !results || searching}
      {#each [0, 1, 2, 3] as _}<li class="skeleton"></li>{/each}
    {:else if !results.length}
      <li class="empty">Nothing found. Try a shorter title, or clear the artist.</li>
    {:else}
      {#each results as c (c.source + c.id)}
        {@const d = diff(c)}
        <li>
          <button class:on={isCurrent(c)} onclick={() => onPick(c.source, c.id)}>
            <span class="what">
              <span class="t">{c.title}</span>
              <span class="a">{c.artist}</span>
            </span>
            <span class="tags">
              <span class="tag">{c.source === "lrclib" ? "LRCLIB" : "NetEase"}</span>
              {#if c.synced === true}<span class="tag good">synced</span>{:else if c.synced === false}<span class="tag">plain</span>{/if}
              <span class="tag" class:good={Math.abs(d) <= 2} class:bad={Math.abs(d) > 8}>{fmt(c.durationMs)}{d ? ` (${d > 0 ? "+" : ""}${d}s)` : ""}</span>
              {#if isCurrent(c)}<Icon name="check" size={16} />{/if}
            </span>
          </button>
        </li>
      {/each}
    {/if}
  </ul>

  <footer>
    <label class="ghost" title=".lrc (synced), .srt / .vtt subtitles, or plain .txt">
      <Icon name="plus" size={15} /> Use your own file
      <input type="file" accept=".lrc,.srt,.vtt,.txt,text/plain" hidden onchange={loadFile} />
    </label>
    {#if hasOverride}
      <button class="ghost" onclick={onReset}><Icon name="undo" size={15} /> Go back to automatic</button>
    {/if}
  </footer>
</div>

<style>
  .scrim {
    position: fixed;
    inset: 0;
    z-index: 40;
    background: rgba(0, 0, 0, 0.35);
  }
  .sheet {
    position: fixed;
    z-index: 50;
    left: 50%;
    top: 50%;
    translate: -50% -50%;
    width: min(560px, calc(100vw - 32px));
    max-height: min(620px, calc(100vh - 64px));
    display: flex;
    flex-direction: column;
    background: rgba(18, 18, 22, 0.78);
    backdrop-filter: blur(28px) saturate(1.4);
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 18px;
    box-shadow: 0 30px 80px rgba(0, 0, 0, 0.5);
    overflow: hidden;
    font-size: 0.9rem;
  }
  header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    padding: 1.1rem 1.1rem 0.6rem;
  }
  h2 {
    margin: 0;
    font-size: 1.05rem;
  }
  header p {
    margin: 0.25rem 0 0;
    color: rgba(255, 255, 255, 0.55);
    font-size: 0.8rem;
  }
  .search {
    display: flex;
    gap: 0.5rem;
    padding: 0.4rem 1.1rem 0.8rem;
  }
  input {
    flex: 1;
    min-width: 0;
    padding: 0.55rem 0.75rem;
    border-radius: 10px;
    border: 1px solid rgba(255, 255, 255, 0.1);
    background: rgba(255, 255, 255, 0.05);
    color: #fff;
    font: inherit;
    outline: none;
    user-select: text;
  }
  input:focus {
    border-color: var(--accent);
  }
  .go {
    display: grid;
    place-items: center;
    width: 2.4rem;
    border-radius: 10px;
    background: rgba(255, 255, 255, 0.1);
  }
  .go:hover {
    background: rgba(255, 255, 255, 0.18);
  }
  .results {
    list-style: none;
    margin: 0;
    padding: 0 0.6rem 0.8rem;
    overflow-y: auto;
    scrollbar-width: thin;
    scrollbar-color: rgba(255, 255, 255, 0.15) transparent;
  }
  .results button {
    width: 100%;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.8rem;
    padding: 0.6rem 0.6rem;
    border-radius: 10px;
    text-align: left;
    transition: background 0.15s;
  }
  .results button:hover {
    background: rgba(255, 255, 255, 0.07);
  }
  .results button.on {
    background: color-mix(in oklab, var(--accent) 16%, transparent);
  }
  .what {
    display: flex;
    flex-direction: column;
    min-width: 0;
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
  .tags {
    display: flex;
    align-items: center;
    gap: 0.3rem;
    flex-shrink: 0;
    color: var(--accent);
  }
  .tag {
    font-size: 0.68rem;
    padding: 0.18rem 0.45rem;
    border-radius: 6px;
    background: rgba(255, 255, 255, 0.07);
    color: rgba(255, 255, 255, 0.6);
    font-variant-numeric: tabular-nums;
  }
  .tag.good {
    color: #8ee6a8;
  }
  .tag.bad {
    color: #ff9a9a;
  }
  .skeleton {
    height: 2.7rem;
    margin: 0.3rem 0.6rem;
    border-radius: 10px;
    background: linear-gradient(90deg, rgba(255, 255, 255, 0.04), rgba(255, 255, 255, 0.1), rgba(255, 255, 255, 0.04));
    background-size: 200% 100%;
    animation: shimmer 1.3s linear infinite;
  }
  @keyframes shimmer {
    to {
      background-position: -200% 0;
    }
  }
  .empty {
    padding: 1.2rem 0.6rem;
    color: rgba(255, 255, 255, 0.55);
    text-align: center;
  }
  footer {
    display: flex;
    justify-content: space-between;
    padding: 0.6rem 1.1rem 0.9rem;
    border-top: 1px solid rgba(255, 255, 255, 0.06);
  }
  .ghost {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    font-size: 0.8rem;
    padding: 0.45rem 0.7rem;
    border-radius: 8px;
    color: rgba(255, 255, 255, 0.75);
    cursor: pointer;
  }
  .ghost:hover {
    background: rgba(255, 255, 255, 0.08);
    color: #fff;
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
