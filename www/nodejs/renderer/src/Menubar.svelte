<script>
  import { onMount } from "svelte";
  import Clock from "./Clock.svelte";
  import { main } from "../../modules/bridge/renderer";

  let txt = $state("");
  let display = $state("none");
	let {
    path = $bindable(),
		icons = $bindable()
	} = $props();

  let timer = 0, visible = false, duration = 5000;

  export function show(t) {
    clearTimeout(timer);
    if (typeof t == "string" && t !== txt) {
      txt = t;
    }
    if (!visible) {
      visible = true;
      display = "inline-block";
    }
    if (main.menu.selectedIndex < 2) {
      timer = setTimeout(() => {
        if (visible) {
          visible = false;
          display = "none";
        }
      }, duration);
    }
  };

  export function setIndex(index) {
    if (!main?.menu.currentEntries?.length) return;
    const total = main.menu.currentEntries.length;
    show(" " + (index + 1) + "/" + total);
  }

  onMount(async () => {
    const listener = () => {
      let selected = main.menu.selectedIndex,
        total = main.menu.currentEntries.length;
      show(" " + (selected + 1) + "/" + total);
    };
    main.on("menu-ready", () => {
      main.menu.on("scroll", show);
    })
  });
</script>

<div id="menubar">
  <span class="menu-location" aria-hidden="true">
    <span class="menu-location-anchor">
      <span class="menu-location-icon">
        {#if icons[path]}
          {#if icons[path].url.startsWith("fa")}
            <i class={icons[path].url} aria-hidden="true"></i>
          {:else}
            <img src={icons[path].url} alt="" loading="lazy" />
          {/if}
        {/if}
      </span>
      <span class="menu-location-text">{path.split("/").pop()}</span>
    </span>
    <span class="menu-location-pagination" style="display: {display}">
      <i class="fas fa-stream"></i>
      <span>{txt}</span>
    </span>
  </span>
  <span class="menu-time" aria-hidden="true">
    <Clock></Clock>
    <span class="menu-busy">
      <i class="fas fa-mega busy-x" aria-hidden="true"></i>
    </span>
  </span>
</div>

<style global>
#menubar {
  position: absolute;
  width: var(--menu-width);
  color: var(--font-color);
  display: flex;
  flex-direction: row;
  font-size: var(--menu-entry-name-font-size);
  box-sizing: border-box;
}  
.menu-location {
  background: var(--background-color);
  padding: var(--padding-quarter) var(--padding) var(--padding-quarter) var(--padding-quarter);
  border-top-right-radius: var(--radius);
}
.menu-location-pagination {
  padding-left: var(--padding-2x);
}
.menu-location-icon img {
  max-width: var(--padding-2x);
  max-height: var(--padding-2x);
  object-fit: contain;
  object-position: center;
  transform-origin: center;
  height: var(--menu-entry-name-font-size);
  vertical-align: bottom;
  background-size: contain;
  background-repeat: no-repeat;
  background-position: center;
}
</style>
