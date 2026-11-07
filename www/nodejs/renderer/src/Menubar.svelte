<script>
  import { onMount } from "svelte";
  import Clock from "./Clock.svelte";
  import { main } from "../../modules/bridge/renderer";

  // Initialize with safe defaults to prevent context issues
  let txt = $state("");
  let display = $state("none");
	let {
    path = $bindable(''),
		icons = $bindable({})
	} = $props();

  // $bindable variables are initialized with default values

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
    if (!main.menu?.currentEntries?.length) return;
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
  <span class="menu-location" class:menu-location-empty={!path && display === 'none'} aria-hidden="true">
    <span class="menu-location-anchor">
      <span class="menu-location-icon">
      </span>
      <span class="menu-location-text">{path ? path.split("/").pop() : ''}</span>
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
  color: var(--nf-text-dim);
  display: flex;
  flex-direction: row;
  font-size: var(--menu-entry-name-font-size);
  font-weight: 500;
  letter-spacing: 0.01em;
  box-sizing: border-box;
  isolation: isolate;
}
#menubar::before {
  content: '';
  position: absolute;
  left: calc(var(--padding) * -1);
  right: calc(var(--padding) * -1);
  bottom: calc(var(--padding) * -1);
  height: calc(100% + var(--menu-entry-name-font-size) * 3);
  background: linear-gradient(180deg, rgba(11, 11, 14, 0) 0%, rgba(11, 11, 14, 0.75) 55%, var(--nf-black) 100%);
  pointer-events: none;
  z-index: -1;
}  
.menu-location {
  border-radius: var(--nf-radius) var(--nf-radius) 0 0;
  padding: var(--padding-quarter) var(--padding) var(--padding-quarter) var(--padding);
  -webkit-backdrop-filter: blur(8px) saturate(1.15);
  backdrop-filter: blur(8px) saturate(1.15);
}
body.side-menu #menubar .menu-location,
body.omni #menubar .menu-location {
  opacity: 0;
  visibility: hidden;
}
#menubar .menu-location-empty {
  opacity: 0;
  visibility: hidden;
  transition: opacity 0.2s ease-in;
}
.menu-location-text {
  color: var(--nf-text);
}
.menu-location-pagination {
  padding-left: var(--padding-2x);
  color: var(--nf-accent);
}
.menu-location-pagination > span {
  color: var(--nf-text-dim);
  padding-left: var(--padding-half);
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
