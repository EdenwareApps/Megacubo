<script>
    import { onMount } from 'svelte';
    import DragDrop from './DragDrop.svelte'
    import Player from './Player.svelte'
    import Theme from './Theme.svelte'
    import Menu from './Menu.svelte'
    import Osd from './Osd.svelte'
    
    // Ensure DOM is ready before rendering components
    let mounted = $state(false);
    
    onMount(() => {
        mounted = true;
    });
</script>
<svelte:head>
    <link rel="stylesheet" global href="./assets/css/all.min.css" />
    <link rel="stylesheet" global href="./assets/icons/icons.css" />
</svelte:head>
<Theme />
{#if mounted}
<Player />
<Menu />
<Osd />
<DragDrop />
{/if}
<style global>
:root {
    --font-size: 16px;
    --font-scaling: 1;
    --playlist-width: 25vw;
    --main-icons-width: 5vw;
    --padding: 1vw;
    --padding-quarter: 0.25vw;
    --padding-half: 0.5vw;
    --padding-2x: 2vw;
    --radius: 9px;
    --line-width: 0.25vw;
    --drop-shadow: drop-shadow(2px 2px 2px rgba(0,0,0,0.5));
    --animation-duration-short: 0.2s;
    --animation-duration-normal: 0.36s;
    --animation-duration-long: 0.5s;
    --animation-duration-timing: ease-in-out;
    --menu-fx-nav-intensity-step: 0.06;
    --menu-fx-nav-intensity: var(--menu-fx-nav-intensity-step);
    --menu-fx-nav-default-inflate: calc(1 + var(--menu-fx-nav-intensity-step));
    --menu-fx-nav-default-deflate: calc(1 - var(--menu-fx-nav-intensity-step));
    --menu-fx-nav-inflate: calc(1 + var(--menu-fx-nav-intensity));
    --menu-fx-nav-deflate: calc(1 - var(--menu-fx-nav-intensity));
    --menu-fx-nav-semi-inflate: calc(1 + (var(--menu-fx-nav-intensity)) / 10);
    --menu-fx-nav-semi-deflate: calc(1 - (var(--menu-fx-nav-intensity)) / 10);
    --menu-fx-nav-duration: 0.1s;
    --menu-width: calc(100vw - (var(--menu-padding-right) + var(--menu-padding-left)));
    --menu-height: calc(100vh - (var(--menu-padding-top) + var(--menu-padding-bottom)));
    --entries-per-row: 2;
    --entries-per-col: 2;
    --menu-padding: calc(var(--menu-height) * 0.01);
    --menu-padding-2x: calc(var(--menu-height) * 0.02);
    --menu-entry-width: calc((var(--menu-width) - var(--menu-scrollbar-width)) / var(--entries-per-row));
    --menu-entry-name-font-size: calc(var(--font-size) * var(--font-scaling));
    --menu-entry-details-font-size: calc(var(--menu-entry-name-font-size) * 0.8);
    --menu-scrollbar-width: 12px;
    --menu-scrollbar-color: rgba(255, 255, 255, 0.25);
    --menu-header-height: 6vmax;
    --menu-content-border-size: calc(var(--menu-height) * 0.005);
    --menu-content-vertical-padding: calc((var(--menu-height) * 0.025) - (2 * var(--menu-content-border-size)));
    --menu-entry-height: calc((var(--menu-height) - 1px) / var(--entries-per-col));
    --menu-entry-icon-width: calc((0.92 * var(--menu-entry-width)) - var(--menu-padding-2x));
    --menu-entry-icon-height: calc((0.62 * var(--menu-entry-height)) - var(--menu-padding-2x));
    --menu-entry-icon-innersize: calc((0.92 * var(--menu-entry-icon-height)) * var(--font-scaling));
    --font-color: #ffffff;
    --menu-padding-top: 0px;
    --menu-padding-bottom: 0.5vmin;
    --menu-padding-right: 0.5vmin;
    --menu-padding-left: 0.5vmin;
    --dialog-height: calc(100vh - var(--menu-padding-top) - var(--menu-padding-bottom) - (2 * var(--padding)));
    --opacity-level-1: 0.075;
    --opacity-level-2: 0.25;
    --opacity-level-3: 0.5;
    --opacity-level-4: 0.75;
    --controls-height: calc(var(--menu-entry-name-font-size) * 3);
    --controls-button-height: calc(var(--controls-height) - 2vmin);
    --controls-mask-image: linear-gradient(to bottom, rgba(0, 0, 0, 0.8) 20%, rgba(0, 0, 0, 1) 50%, rgba(0, 0, 0, 0.9) 50.5%, rgba(0, 0, 0, 0.3) 100%);
    --seekbar-height: calc(var(--padding) * 3);
    --solid-text-shadow: 1px 1px 0 black, -1px -1px 0 black, -1px 1px 0 black, 1px -1px 0 black, 2px 2px 0 black;
}
::-webkit-scrollbar {
    height: var(--menu-scrollbar-width);
    width: var(--menu-scrollbar-width);
}
::-webkit-scrollbar-thumb {
    border-radius: 1vmax;
    background: var(--menu-scrollbar-color);
    box-shadow: 0px 1px 2px rgba(0, 0, 0, 0.75);
}
* {
    outline: 0;
    text-decoration: none;
    -webkit-overflow-scrolling: auto;
    -webkit-tap-highlight-color: transparent;
    -moz-tap-highlight-color: transparent;
}
html, body, body > *, app > *, #main > * {
    overscroll-behavior: none;
}
html, body {
    margin: 0;
    padding: 0;
    border-width: 0;
    width: 100vw;
    height: 100vh;
    overflow: hidden;
    box-sizing: border-box;
}
html {
    max-width: 100vw;
    max-height: 100vh;
    touch-action: manipulation;
    background-color: transparent;
    width: 100vw;
    height: 100vh;
    margin: 0;
    padding: 0;
    background-color: #100927;
}
body {
    position: fixed; /* prevents scroll bug */
    top: 0;
    display: flex;
    align-items: flex-end;
    justify-content: left;
    margin: 0;
    overflow: hidden;
    background-color: transparent;
    overscroll-behavior-y: none; /* prevents scroll snap bug */
}
app {
    width: 100vw;
    height: 100vh; /* prevents positioning bug */
    overflow: hidden;
}
player {
    width: 100vw;
    height: 100vh;
    display: none;
    pointer-events: none;
    align-items: center;				
    justify-content: center;
    z-index: -2;
    background: #000;
}	
player div {
    width: 100vw;
    height: 100vh;
}
body:not(input):not(textarea) {
    -moz-user-select: none; /* Firefox */
    -ms-user-select: none; /* Internet Explorer */
    -khtml-user-select: none; /* KHTML browsers (e.g. Konqueror) */
    -webkit-user-select: none; /* Chrome, Safari, and Opera */
    -webkit-touch-callout: none; /* Disable Android and iOS callouts*/
}
#menu, #menu header, #osd-root, controls, wrap {
    transform: translateZ(0);
    backface-visibility: hidden;
    will-change: transform;
}
#main {
    width: 100%;
    height: 100%;
    display: flex;
    top: 0;
    left: 0;
    position: absolute;
    justify-content: center;
    background-color: transparent;
}
body:not(.video) #main {
    background: linear-gradient(to bottom, transparent 0%, var(--alpha-background-color) calc(var(--menu-header-height) + var(--menu-padding-top) + (var(--menu-padding) * 4)));
}
body.dialog .dialog-wrap {
    transform: scale(var(--menu-fx-nav-inflate));
}
input {
    font-family: inherit;
}
button.button-alpha i {
    opacity: var(--opacity-level-3);
}
.faclr-green {
    color: #094 !important;
}
.faclr-orange {
    color: #f50 !important;
}
.faclr-red {
    color: #f05 !important;
}
.faclr-darkred {
    color: #930d42 !important;
}
.faclr-purple {
    color: #af07c1 !important;
}
.fa-blink-alpha {
    animation: blink-alpha 1.1s infinite linear;
}
@keyframes blink-alpha {
    0% { opacity: 1; }
    20% { opacity: 1; }
    50% { opacity: var(--opacity-level-3); }
    80% { opacity: 1; }
    100% { opacity: 1; }
}
.fa-blink {
    animation: blink 1.1s infinite linear;
}
@keyframes blink {
    0% { opacity: 1; }
    49% { opacity: 1; }
    50% { opacity: 0; }
    100% { opacity: 0; }
}
input[type=range] {
    -webkit-appearance: none; /* Hides the slider so that custom slider can be made */
    width: 100%; /* Specific width is required for Firefox. */
    background: transparent; /* Otherwise white in Chrome */
}
input[type=range]::-webkit-slider-thumb {
    -webkit-appearance: none;
    background-color: inherit;
    width: 1em;
    height: 100%;
}
input[type=range]:focus {
    outline: none;
}
@keyframes slide-in-from-left {
    from { 
        opacity: 0.25;
        transform: scaleX(0); 
    }
    to {
        opacity: 1;
        transform: scaleX(1);
    }
}
.slide-in-from-left {    
    animation: slide-in-from-left 0.250s;
    transform-origin: left;
}
@keyframes spin-x-alt {
    0% {
        transform: scaleX(1);
        opacity: 0.75;
    }
    25% {
        opacity: 0.6;
    }
    50% {
        transform: scaleX(-1);
        opacity: 0.75;
    }
    75% {
        opacity: 0.6;
    }
    100% {
        transform: scaleX(1);
        opacity: 0.75;
    }
}
.spin-x-alt {    
    animation: spin-x-alt 3s infinite;
    display: inline-block;
}
@keyframes inflate {
    0% {
		transform: rotateX(0deg) scale(var(--menu-fx-nav-deflate));
    }
    70% {
        transform: rotateX(-0.075deg) scale(var(--menu-fx-nav-semi-inflate));
    }
    100% {
        transform: none;
    }
}
@keyframes deflate {
    0% {
		transform: rotateX(0deg) scale(var(--menu-fx-nav-inflate));
    }
    70% {
        transform: rotateX(0.075deg) scale(var(--menu-fx-nav-semi-deflate));
    }
    100% {
        transform: rotateX(0deg) scale(1);
    }
}
.effect-inflate {
    animation: inflate var(--menu-fx-nav-duration) 1;
}
.effect-deflate {
    animation: deflate var(--menu-fx-nav-duration) 1;
}
.effect-inflate-deflate-parent {
    perspective: 10vmin;
    transform-origin: center center;
}
body.miniplayer-android {
    pointer-events: none;
}
body.fullscreen.idle {
    cursor: none !important;
}
</style>