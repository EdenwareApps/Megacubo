<script>
    import { onMount } from 'svelte'
    import { main } from '../../modules/bridge/renderer'
	import MediaPlayer from '../src/scripts/mediaplayer'
    import { StreamerClient } from '../../modules/streamer/renderer'
    const load = () => {
        window.player = new MediaPlayer(document.querySelector('player'))
        if(!window.capacitor){
            ['play', 'pause', 'seekbackward', 'seekforward', 'seekto', 'previoustrack', 'nexttrack', 'skipad'].forEach(n => {
                // disable media keys
                try {
                    navigator.mediaSession.setActionHandler(n, () => {})
                } catch(e){}
            })
        }
        main.streamer = window.streamer = new StreamerClient(document.querySelector('controls'))
        main.idle.on('away', () => {
            main.streamer.active || main.streamer.isTuning() || main.idle.energySaver.start()
        })
        main.idle.on('active', () => main.idle.energySaver.end())
        main.streamer.on('hide', () => {
            main.idle.reset() // will not call main.idle.on('active') if not idle, so keep lines below to ensure
            main.idle.energySaver.end()
        })
        main.localEmit('streamer-ready')
        main.emit('streamer-ready')
    }
	onMount(async () => {
        if(main.menu) {
            load()
        } else {
            main.once('menu-ready', load)
        }
	})
</script>
<player>
    <div>
        <video crossorigin plays-inline webkit-playsinline muted poster="./assets/images/blank.png"></video>
        <audio crossorigin plays-inline webkit-playsinline muted poster="./assets/images/blank.png"></audio>
    </div>
</player>
<controls>    
    <div id="streamer-info">
        <div></div>
    </div>
    <seekbar>
        <input type="range" min="0" max="100" value="0" />
        <div>
            <div></div>
        </div>
    </seekbar>
    <div id="buttons">
        <span class="status"></span>
        <span class="filler"></span>  
    </div>    
    <div id="arrow-down-hint">
        <i class="fas fa-chevron-down"></i>
    </div>
</controls>
<div class="curtain curtain-a"></div>
<div class="curtain curtain-b"></div>
<div id="paused-layer" class="control-layer" aria-hidden="true">
    <span class="control-layer-icon">
        <i class="fas fa-play"></i>
    </span>
</div>
<div id="audio-layer" class="control-layer" aria-hidden="true">
    <span class="control-layer-icon">
        <!--
        <i class="fas fa-headphones"></i>
        FFmpeg isn't detecting video stream sometimes
        http://sample.vodobox.com/planete_interdite/planete_interdite_alternate.m3u8
        //-->
    </span>
</div>
<div id="loading-layer" class="control-layer" aria-hidden="true">
    <span class="control-layer-icon">
        <i class="fas fa-circle-notch fa-spin"></i>
    </span>
    <span class="loading-layer-status">
        <span></span>
    </span>
</div>
<div id="cast-layer" class="control-layer" aria-hidden="true">
    <span class="control-layer-icon">
        <i class="fab fa-chromecast"></i>
    </span>
</div>
<div id="seek-back" class="control-layer" aria-hidden="true">
    <span class="control-layer-icon">
        <i class="fas fas fa-backward"></i>
    </span>
    <span class="seek-layer-time">
        <span></span>
    </span>
</div>
<div id="button-action-feedback" class="control-layer" aria-hidden="true">
    <span class="control-layer-icon"></span>
</div>
<div id="seek-fwd" class="control-layer" aria-hidden="true">
    <span class="control-layer-icon">
        <i class="fas fas fa-forward"></i>
    </span>
    <span class="seek-layer-time">
        <span></span>
    </span>
</div>
<style global>
html.playing {
    background-color: transparent !important;
}
html.playing div#background {
    display: none !important;
    visibility: hidden !important;
    animation-name: none !important;
}
html.curtains-alpha .curtain {				
    opacity: 0.6; /* energy saving black filter */
    pointer-events: none;
}
.curtain {
    background: black;
    display: block;
    height: 100vh;
    width: 50vw;
    position: fixed;
    top: 0;
    z-index: 1;
    box-sizing: border-box;
    transition: left 0.15s ease-in 0s, right 0.15s ease-in 0s, opacity 0.15s ease-in 0s;
}
html.curtains-closed .curtain-a {
    left: 0;
}
html.curtains-closed .curtain-b {
    left: 50vw;
}
.curtain-a, html.curtains-opened .curtain-a {
    left: -51vw;
}
.curtain-b, html.curtains-opened .curtain-b {
    left: 101vw;
}
body.video {
    --modal-background-color: rgba(0, 0, 0, 0.75);
}

body.video:not(.modal) #menu header {
    transition: transform var(--menu-fx-nav-duration) ease-in-out 0s;
    transform: scale(var(--menu-fx-nav-default-inflate));
}

body.video #menu,
body.modal #menu {
    transform: scale(var(--menu-fx-nav-default-deflate));
}

body.video:not(.menu-playing) #menu header .menu-location,
body.video-playing.idle:not(.menu-playing) #menu header .menu-time,
body.video:not(.menu-playing) #menu .content-out,
body.video:not(.menu-playing) #menu #home-arrows {
    visibility: hidden;
}

body.video.menu-playing #menu header .menu-location,
body.video.menu-playing #menu .content-out {
    visibility: visible;
}

body.video.idle {
    cursor: none !important;
}

video {
    object-fit: fill;
    width: inherit;
    height: inherit;
    display: block;
}

.control-layer {
    position: absolute;
    top: 0;
    left: 0;
    bottom: calc(var(--controls-height) + var(--seekbar-height));
    width: 100%;
    padding: calc(var(--padding) * 7) 0 var(--padding-2x) 0;
    z-index: 4;
    box-sizing: border-box;
    pointer-events: none;
    align-items: center;
    justify-content: center;
    color: var(--font-color);
    background: linear-gradient(to bottom, rgba(0, 0, 0, 0.5) 0%, rgba(0, 0, 0, 0.25) 80%, rgba(0, 0, 0, 0.125) 90%, transparent 100%);
    font-size: var(--controls-button-height);
    visibility: hidden;
    display: flex;
}

.control-layer-icon {
    padding: 0 2vmin;
    mask-image: var(--controls-mask-image);
    -webkit-mask-image: var(--controls-mask-image);
}

body.menu-playing .control-layer,
body:not(.video) .control-layer {
    display: none;
    visibility: hidden;
}

div#seek-back,
div#seek-fwd {
    font-size: var(--controls-button-height);
    flex-direction: column;
}

div#button-action-feedback i {
    transition: transform 0.5s ease-out 0s, opacity 0.5s ease-out 0s;
}

span.seek-layer-time {
    display: block;
    height: 0;
    font-size: 75%;
}

div#audio-layer {
    font-size: calc(1.5 * var(--controls-height));
}

body.audio:not(.video-paused):not(.video-ended):not(.video-loading):not(.seek-back):not(.seek-fwd):not(.casting) div#audio-layer {
    visibility: visible;
}

body.video-loading:not(.video-paused):not(.menu-playing):not(.video-ended):not(.seek-back):not(.seek-fwd):not(.casting) div#loading-layer {
    visibility: visible;
}

body.video.seek-back div#seek-back {
    visibility: visible;
}

body.video.seek-fwd div#seek-fwd {
    visibility: visible;
}

div#loading-layer {
    opacity: 0;
    transition: opacity 0.5s ease-in 0s;
    flex-direction: column;
    background: linear-gradient(to bottom, rgba(0, 0, 0, 0.125) 0%, rgba(0, 0, 0, 0.068) 80%, rgba(0, 0, 0, 0.042) 90%, transparent 100%);
    width: 100vw;
    text-align: center;
    justify-content: center;
}

div#loading-layer i.fa-mega {
    font-size: 150%;
}

div#loading-layer>span.loading-layer-status {
    height: 0;
}

div#loading-layer>span.loading-layer-status>span {
    padding: calc(0.5 * var(--padding)) calc(1.5 * var(--padding));
    font-size: var(--menu-entry-name-font-size);
    background: var(--modal-background-color);
    border-radius: 25vmin;
    position: relative;
    top: -2vmin;
    display: inline-flex;
    justify-content: center;
}

body.idle div#loading-layer>span.loading-layer-status {
    position: absolute;
    bottom: 15vmin;
}

body.idle div#loading-layer>.control-layer-icon {
    display: none;
}

body.video-loading #loading-layer {
    opacity: 1;
}

body.video-loading.idle i {
    line-height: 150%;
    margin: 0 0.4rem;
}

.control-layer i {
    filter: drop-shadow(0 0 0.75vmin black);
    margin-left: calc(var(--menu-padding-left) / 2);
}

body:not(.video).miniplayer-android div#paused-layer {
    background-color: #000000;
    height: 100vh;
    visibility: visible;
}

body.video-paused:not(.menu-playing):not(.seek-back):not(.seek-fwd) div#paused-layer,
body.video-ended:not(.menu-playing):not(.seek-back):not(.seek-fwd) div#paused-layer {
    visibility: visible;
}

body.video-paused div#audio-layer,
body.video-ended div#audio-layer,
body.video-loading div#audio-layer {
    display: none !important;
}

controls {
    z-index: 1;
    width: inherit;
    height: inherit;
    position: fixed;
    height: auto;
    left: auto;
    right: 0;
    display: block;
    box-sizing: border-box;
    background: linear-gradient(to bottom, transparent 0%, black 100%);
    bottom: calc((var(--controls-height) + var(--seekbar-height)) * -2);
}

body.video controls {
    transition: bottom var(--animation-duration-normal), transform var(--menu-fx-nav-duration) ease-in-out 0s;
    transform: scale(var(--menu-fx-nav-inflate));
}

controls>div {
    display: flex;
    align-items: center;
    height: var(--controls-height);
}

div#streamer-info {
    display: flex;
    justify-content: center;
    position: relative;
    bottom: 0;
    align-items: flex-end;
    opacity: 0;
    transition: opacity var(--menu-fx-nav-duration) ease-in-out 0s;
}

div#streamer-info>div {
    background-color: rgba(0, 0, 0, 0.5);
    color: #fff;
    display: inline-flex;
    flex-direction: column;
    border-radius: var(--radius);
    border-bottom-left-radius: 0;
    border-bottom-right-radius: 0;
    padding: var(--menu-padding) var(--padding) var(--padding) var(--padding);
    text-align: center;
    line-height: 175%;
    font-size: var(--menu-entry-name-font-size);
    position: relative;
    bottom: calc((var(--seekbar-height) - var(--padding)) * -1);
}

body.video:not(.idle):not(.casting):not(.menu-playing) div#streamer-info,
body.video-paused div#streamer-info {
    display: flex;
    justify-content: center;
    position: relative;
    bottom: 0;
    align-items: flex-end;
    opacity: 1;
    transition: opacity var(--menu-fx-nav-duration) ease-in-out 0s;
}

seekbar {
    height: var(--seekbar-height);
    width: inherit;
    display: block;
    opacity: var(--opacity-level-4);
    pointer-events: auto;
    cursor: wait;
}

seekbar>div {
    padding: 0;
    display: block;
    pointer-events: none;
    height: var(--padding);
    margin-top: calc(-1 * var(--padding));
    background-color: rgba(255, 255, 255, 0.1);
    box-shadow: 0 0 12px rgba(0, 0, 0, 0.5);
}

seekbar>div>div {
    padding: 0;
    display: block;
    pointer-events: none;
    height: inherit;
    background-color: #fff;
    border-top-right-radius: 6px;
    border-bottom-right-radius: 6px;
    transition: width 0.1s ease-in-out 0s, background-color 0.6s ease-in-out 0s;
}

body.video seekbar>div>div {
    mask-image: var(--controls-mask-image);
    -webkit-mask-image: var(--controls-mask-image);
}

seekbar input[type="range"] {
    margin: 0;
    height: 100%;
    display: block;
    cursor: pointer;
}

seekbar label {
    top: 0;
    left: 0;
    width: 100%;
    text-align: center;
    position: absolute;
    pointer-events: none;
    display: inline-block;
    text-shadow: 0 0 2vh var(--font-color);
    height: var(--seekbar-height);
    line-height: var(--seekbar-height);
    color: #000;
    font-size: var(--menu-entry-name-font-size);
    overflow: hidden;
    z-index: -1;
}

body.video seekbar label {
    transition: color 0.5s linear 0s;
}

body.audio:not(.miniplayer-android):not(.menu-playing) controls,
body.casting:not(.menu-playing) controls,
body.video.video-playing:not(.idle):not(.menu-playing):not(.miniplayer-android) controls,
body.video.video-paused:not(.miniplayer-android):not(.menu-playing) controls,
body.video.video-ended:not(.miniplayer-android):not(.menu-playing) controls,
body.video.video-loading:not(.miniplayer-android):not(.menu-playing):not(.idle) controls {
    bottom: 0;
    transform: none;
}

body.modal controls {
    visibility: visible;
    transform: scale(var(--menu-fx-nav-default-deflate)) !important;
}

body.miniplayer-android app > *:not(player):not(#paused-layer):not(#loading-layer) {
    visibility: hidden !important;
}

body.miniplayer-android div#paused-layer {
    padding: 0;
}

controls span.filler {
    flex-grow: 1;
}

controls button {
    width: var(--controls-button-height);
    height: var(--controls-button-height);
    border-width: 0;
    background: none;
    overflow: visible;
    text-align: center;
    display: inline-flex;
    flex-direction: column;
    justify-content: center;
    opacity: 0.9;
    margin: 0 0 0 1.5%;
}

body.video controls button span.button-icon {
    transition: -webkit-mask-image 0.2s linear;
    mask-image: var(--controls-mask-image);
    -webkit-mask-image: var(--controls-mask-image);
}

controls button.play-pause {
    opacity: 1;
    margin: 0;
    margin-left: 1.75%;
}

controls button.selected:not(#info),
controls button:hover:not(#info),
controls button:active:not(#info) {
    opacity: 1;
}

controls button.selected:not(#info) span.button-icon,
controls button:hover:not(#info) span.button-icon,
controls button:active:not(#info) span.button-icon {
    mask-image: none;
    -webkit-mask-image: none;
    filter: drop-shadow(0 0 1vmin #ffffff);
}

controls button span.status {
    display: none;
    height: 0;
    width: 100% !important;
    position: relative;
}

controls span.status {
    color: #fff;
    margin-left: 2%;
    font-size: var(--menu-entry-name-font-size);
}

body.video-playing:not(.idle):not(.menu-playing) controls button.selected span.status,
body.video-loading:not(.menu-playing) controls button.selected span.status,
body.video-paused:not(.menu-playing) controls button.selected span.status,
body.video-ended:not(.menu-playing) controls button.selected span.status {
    display: flex;
    justify-content: center;
}

controls button span.status span {
    line-height: 150%;
    color: white;
    font-size: var(--menu-entry-details-font-size);
    position: absolute;
    top: calc(-1.5 * var(--padding));
    white-space: nowrap;
    border-radius: var(--radius);
    display: inline-table;
    padding: 0 var(--padding);
    filter: drop-shadow(0 0 1vmin black);
}

controls span.button-icon {
    /* classes added to override fontAwesome display property */
    width: 100% !important;
    height: 100% !important;
    max-height: var(--controls-button-height);
    display: flex;
    justify-content: center;
    cursor: pointer;
    padding: 2vmin 0;
}

controls button i.fas,
controls button i.fab {
    /* classes added to override fontAwesome display property */
    color: var(--font-color);
    height: 100% !important;
    max-height: var(--controls-button-height);
    font-size: calc(var(--controls-button-height) * 0.5);
    line-height: 100%;
    display: inline-flex;
    align-items: center;
}

controls button span.button-label {
    height: 0;
    z-index: -1;
    position: absolute;
}
controls button span.button-label > span {
    height: var(--controls-button-height);
    margin-top: calc(-1.1 * (var(--seekbar-height) + var(--controls-height)));
    margin-left: calc(-0.75 * var(--controls-button-height));
    display: none;
    width: calc(2 * var( --controls-button-height));
    align-items: flex-end;
    justify-content: center;
    pointer-events: none;
}
body.portrait controls button span.button-label > span {
    margin-top: calc(-1.25 * (var(--seekbar-height) + var(--controls-height)));
}
controls button span.button-label > span > span {
    color: var(--font-color);
    font-size: var(--menu-entry-details-font-size);
    line-height: 125%;
    background: black;
    border: 2px solid #111;
    padding: var(--padding);
    border-radius: var(--radius);
}

controls button.selected span.button-label > span, controls button:hover span.button-label > span {
    display: flex;
}

#stream-info.faclr-green i.fas {
    background: linear-gradient(to bottom, #0f0 29%, white 30%);
    background-clip: text;
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
}

#stream-info.faclr-orange i.fas {
    background: linear-gradient(to bottom, white 29%, #e0d213 30%, #e0d213 59%, white 60%);
    background-clip: text;
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
}

#stream-info.faclr-red i.fas {
    background: linear-gradient(to bottom, white 59%, #f05 60%);
    background-clip: text;
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
}

seekbar.faclr-green>div>div {
    background: #0f0;
    box-shadow: 0 0 1.5vmin 0.2vmin #0f0;
}

seekbar.faclr-orange>div>div {
    background: #e0d213;
    box-shadow: 0 0 1.5vmin 0.2vmin #e0d213;
}

seekbar.faclr-red>div>div {
    background: #f05;
    box-shadow: 0 0 1.5vmin 0.2vmin #f05;
}

controls button.recording.faclr-green i {
    color: #0f0;
}

controls button.recording.faclr-orange i {
    color: #e0d213;
}

controls button.recording.faclr-red i {
    color: #f05;
}

volume {
    display: none;
    pointer-events: auto;
    position: absolute;
    width: 0;
    height: 0;
}

body.menu-playing volume,
body:not(.video) volume {
    display: none !important;
}

volume-wrap {
    position: relative;
    height: calc(var(--controls-button-height) * 0.6);
    width: calc(var(--controls-button-height) * 3);
    left: calc(var(--controls-button-height) * 0.125);
    display: inline-block;
}

volume-wrap>div {
    position: static;
    width: inherit;
    height: inherit;
    transform: rotate(270deg) translate(calc((var(--controls-button-height) * -2.15) * -1), calc((var(--controls-button-height) * 1.25) * -1));
    display: flex;
    flex-direction: row-reverse;
    align-items: center;
}

volume-wrap>div>input[type=range] {
    width: inherit;
    height: inherit;
    cursor: pointer;
    display: inline-block;
    border-radius: var(--radius);
    box-shadow: 0 0 2vmin -1vmin var(--font-color);
    margin: 0;
}

volume-wrap>div>input[type=range]::-webkit-slider-thumb {
    height: var(--controls-button-height);
    width: 0;
    display: inline-block;
}

volume-wrap>div>input[type=range]::-webkit-slider-runnable-track {
    height: inherit;
    width: inherit;
    display: inline-block;
}

volume-wrap #volume-arrow {
    display: inline-flex;
    border-width: calc(var(--controls-button-height) * 0.125) 1vmin calc(var(--controls-button-height) * 0.125) 0;
    border-color: transparent rgba(255, 255, 255, 0.4) transparent transparent;
    border-style: solid;
    box-sizing: border-box;
    position: relative;
    top: 0.1vmin;
    height: calc(var(--controls-button-height) * 0.25);
}

@media all and (orientation:portrait) {

    controls span.status,
    button.fullscreen,
    button.volume,
    button.ratio {
        display: none;
    }
}

body.casting seekbar,
body.casting button.volume,
body.casting button.ratio,
body.casting button.tune,
body.casting button.fullscreen,
body.casting span.status {
    display: none;
}

body.casting.video-playing #cast-layer {
    visibility: visible;
}
</style>