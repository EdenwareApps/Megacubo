<script>
    import { onMount } from 'svelte'
    import { initApp } from '../src/scripts/app'
	import { main } from '../../modules/bridge/renderer'
	import { setupCrashlog } from '../../modules/crashlog/renderer'
    
    const transparentImage = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVQYV2NgYAAAAAMAAWgmWQ0AAAAASUVORK5CYII='

    let entries = [], headerActions = [], lang = {}, icons = {}, path = ''
    setupCrashlog(window)
	onMount(async () => {
        main.on('lang', () => {
            lang = main.lang
        })
        main.waitMain(() => {
            initApp().catch(console.error).finally(() => {
                const wrap = document.querySelector('wrap')
                main.menu.on('updated', () => {
                    path = main.menu.path
                    icons = main.menu.icons                
                    const activeKeys = main.menu.currentEntries.map(e => e.key);
                    [...wrap.getElementsByTagName('a')].forEach(e => {
                        activeKeys.includes(e.getAttribute('key')) || wrap.removeChild(e)
                    })
                    entries = main.menu.currentEntries
                    if(!main.menu.path) {
                        headerActions = main.menu.currentEntries.filter(e => e.side)
                    }
                })
            })
        })
    })
</script>
<a href="#close-menu" title="{lang.CLOSE}" id="menu-playing-close">
    <div>
        <i class="fas fa-times-circle"></i>
    </div>
</a>
<div id="menu">
    <span class="menu-omni" style="flex: 1;">
        <span id="menu-search">
            <input type="text" id="menu-omni-input" placeholder="{lang.WHAT_TO_WATCH}" />
            <div class="menu-omni-submit">
                <i class="fas fa-search"></i>
            </div>
        </span>
    </span>
    <div class="side-menu-out">
        <nav>
            <div>
                {#each headerActions as e (e.key)}
                <a href="{e.url}" tabindex="{e.tabindex}" class="entry entry-nav"data-type="{e.type}" data-path="{e.path}" key="{e.key}" aria-label="{e.name}" data-original-icon="{e.originalIcon}" data-question="{e.question}" data-dialog-details="{e.dialogDetails}" draggable="false">
                    <span class="entry-wrapper">
                        <i class="{e.fa}"></i> 
                        <span>
                            {@html e.prepend}
                            {@html e.rawname||e.name}
                        </span>
                    </span>
                </a>
                {/each}
            </div>
            <div class="side-menu-toggle">
                <div>
                    <span>
                        <img src="assets/images/default_icon_white.png" alt="" style="width: 5vmax; height: 5vmax;" />
                    </span>
                </div>
            </div>
        </nav>
    </div>
    <div class="content-out">
        <content>
            <wrap>
                {#each entries as e (e.key)}
                    <a href="{e.url}" tabindex="{e.tabindex}" class="{e.class}" title="{e.name}" aria-label="{e.name}" 
                        data-type="{e.type}" data-path="{e.path}" key="{e.key}"  draggable="false" 
                        data-range-start="{e.range ? e.range.start : 0}" data-range-end="{e.range ? e.range.end : 100}" 
                        data-mask="{e.mask}" data-original-icon="{e.originalIcon}" data-question="{e.question}" data-dialog-details="{e.dialogDetails}" 
                        style="order: {e.tabindex};">
                        <span class="{e.wrapperClass}">
                            {#if e.cover}
                                <div class="entry-cover-container" aria-hidden="true">
                                    <img src="{icons[e.path].url}" alt="" draggable="false" />
                                </div>
                            {/if}
                            <span class="entry-data-in">
                                <span class="entry-name">
                                    <span class="{e.statusFlagsClass}">{@html e.statusFlags}</span>
                                    <span class="entry-name-label">
                                        {@html e.prepend}
                                        {@html e.rawname||e.name}
                                    </span>
                                </span>
                                <span class="entry-details">{@html [e.details, e.maskText].filter(v => v).join(' &middot; ')}</span>
                            </span>
                            <span class="entry-icon-image">
                                {#if (!icons[e.path] || e.type == 'back' || icons[e.path].url.startsWith('fa'))}
                                    <i class="{e.fa}" style="{e.faStyle||''}" aria-hidden="true"></i>
                                {:else}
                                    {#if !e.cover}
                                        <img src="{transparentImage}" draggable="false" alt="" style="background-image: url({icons[e.path].url})" aria-hidden="true" />
                                    {/if}
                                {/if}
                            </span>
                        </span>
                    </a>
                {/each}
            </wrap>
        </content>
        <div id="home-arrows" aria-hidden="true">
            <div>
                <span id="home-arrows-top">
                    <i class="fas fa-chevron-up"></i>
                </span>
                <span style="flex-grow: 1;"></span>
                <span id="home-arrows-bottom">
                    <i class="fas fa-chevron-down"></i>
                </span>
            </div>
        </div>
        <div id="menubar">
            <span class="menu-location" aria-hidden="true">
                <span class="menu-location-anchor">
                    <span class="menu-location-icon">
                        {#if icons[path]}
                            {#if icons[path].url.startsWith('fa')}
                                <i class="{icons[path].url}" aria-hidden="true"></i>
                            {:else}
                                <img src="{icons[path].url}" alt="" />
                            {/if}
                        {/if}
                    </span>
                    <span class="menu-location-text">{path.split('/').pop()}</span>
                </span>
                <span class="menu-location-pagination">
                    <i class="fas fa-stream"></i>
                    <span></span>
                </span>
            </span>
            <span class="menu-time" aria-hidden="true">
                <time></time>
                <span class="menu-busy">
                    <i class="fas fa-mega spin-x-alt" aria-hidden="true"></i>
                </span>
            </span>
        </div>
    </div>
</div>
<div id="modal">
    <div>
        <div>
            <div id="modal-content"></div>
        </div>
    </div>
</div>
<style global>
html {
    --nav-width: 30vmax;
}
body.portrait {
    --nav-width: 77vw;
}
#menu {
    width: 100vw;
    height: var(--menu-height);
    margin-top: var(--menu-padding-top);
    margin-bottom: var(--menu-padding-bottom);
    margin-right: var(--menu-padding-right);
    margin-left: var(--menu-padding-left);
    display: flex;
    flex-wrap: wrap;
    border-radius: var(--radius);
    transition: transform var(--menu-fx-nav-duration) ease-in-out 0s;
    transform: none;    
    flex-direction: column;    
    scroll-snap-type: x mandatory;
    overflow: scroll hidden;
    padding-bottom: calc((var(--menu-scrollbar-width) * 4) + var(--menu-padding-bottom));
    position: fixed;
    top: 0;
}
#menu > * {
    scroll-snap-align: start;
}
.side-menu-toggle, .side-menu-toggle > div {
    width: 0 !important;
    overflow: visible;
}
.side-menu-toggle > div {
    height: var(--menu-height);
    display: flex;
    color: var(--font-color);
    padding: var(--padding-2x) var(--padding);
    box-sizing: border-box;
    font-size: 4vmin;
    align-items: center;
    justify-content: center;
    margin-left: var(--menu-scrollbar-width);
}
.side-menu-toggle > div > span {
    flex-direction: row;
    display: flex;
    width: var(--padding);
    justify-content: center;
    border-radius: 100vw;
    background: linear-gradient(to bottom, var(--background-color), var(--shadow-background-color));
    padding: 0.75vmax 3vmax;
    color: var(--secondary-font-color);
    position: absolute;
    z-index: 1;
    align-self: center;
    box-shadow: 0 0 1vmax rgba(255, 255, 255, 0.125);
}
body.idle .side-menu-toggle > div > span, body.side-menu-hint .side-menu-toggle > div > span {
    background: black;
}
body.side-menu:not(.idle) .side-menu-toggle > div > span {
    background: var(--background-color);
}
body:not(.side-menu) .side-menu-toggle > div > span {
    animation: shake 5s infinite ease-out;
}
@keyframes shake {
    0% { margin-left: 0vh; }
    84% { margin-left: 0vh; }
    88% { margin-left: 0.5vh; }
    92% { margin-left: 0vh; }
    96% { margin-left: 0.5vh; }
    100% { margin-left: 0vh; }
}
#menubar {
    position: absolute;
    width: var(--menu-width);
    color: var(--font-color);
    display: flex;
    flex-direction: row;
    font-size: var(--menu-entry-name-font-size);
    box-sizing: border-box;
}
body.video #menubar  {
    display: none;
}
body .side-menu-out {
    transition: width 0.15s linear;
    display: flex; 
    width: var(--nav-width);
    max-height: var(--menu-height);
}
body.modal .side-menu-toggle {
    opacity: 0.25;
}
body.video:not(.menu-playing) .side-menu-out {
    display: none;
}
.side-menu-toggle i.fa-chevron-down {
    animation: fa-shake 5s 3 linear;
    animation-iteration-count: infinite;
    transform: inherit;
}
@keyframes fa-shake {
    0%, 3%, 8% {
        transform: translateX(0vmin);
    }
    7% {
        transform: translateX(-0.5vmin);
    }
}
#menu content {
    width: 100%;
    display: flex;
    flex-basis: 100%;
    clear: both;
}
.menu-location {
    background: var(--background-color);
    padding: var(--padding-quarter) var(--padding) var(--padding-quarter) var(--padding-quarter);
    border-top-right-radius: var(--radius);
}
.menu-location-pagination {
    padding-left: var(--padding-2x);
}
#menu .menu-omni {
    position: fixed;
    left: var(--nav-width);
    top: 0;
    background: linear-gradient(to bottom, var(--background-color) 70%, transparent 100%);
    width: 100%;
    z-index: 1;
    justify-content: center;
    display: flex;
    align-self: center;
    flex-grow: inherit;
    padding: var(--padding-2x) 0;
    align-items: center;
    color: var(--font-color);
    font-size: var(--menu-entry-name-font-size);
}
body.side-menu #menu .menu-omni {
    left: 0;
}
body.video.menu-playing #menu .menu-omni {
    visibility: visible !important;
}
#menu .menu-omni > span {
    background: linear-gradient(to bottom, rgba(255,255,255,0.0625) 0%, rgba(255, 255, 255, 0.09) 100%);
    border-radius: var(--padding-2x);
    min-width: calc(var(--menu-entry-name-font-size) * 14);
    text-align: left;
    align-items: center;
    margin-right: calc(var( --padding) * 2);
    padding: var(--menu-padding) var(--menu-padding-2x);
    vertical-align: middle;
    display: flex;
    flex-direction: row;
}
#menu .menu-omni input {
    border-width: 0;
    width: calc(100% - var(--menu-entry-name-font-size));    
    min-width: calc(13 * var(--menu-entry-name-font-size));
    background: transparent;
    font-size: var(--menu-entry-name-font-size);    
}
body.home #menu content a.entry-2x, body.menu-wide #menu content a.entry-2x {
    width: 100%;
    max-width: var(--menu-width);
}
body.portrait #menu content a.entry-2x {
    height: calc((var(--menu-height) / var(--entries-per-col)) * 2);
}
body.portrait span.entry-icon-image {
    height: 100% !important;
    left: 0 !important;
    justify-content: left !important;
    bottom: 0 !important;
    max-width: calc(1.25 * var(--menu-entry-height));
    justify-content: center !important;
}
body.portrait span.entry-icon-image img {
    max-width: calc(var(--menu-entry-height) * 0.94);
}
body.portrait #menu content a span.entry-data-in {
    height: -webkit-fill-available;
    display: flex;
    align-items: start;
    justify-content: center;
    flex-direction: column;
    padding-left: calc(1.25 * var(--menu-entry-height));
    box-sizing: border-box;
    padding-bottom: 0;
    top: 0;
}
body.portrait #menu content a .entry-name, body.portrait #menu content a .entry-details {
    text-align: left !important;
}
body:not(.portrait) .portrait-only {
    display: none !important;
}
body.portrait:not(.portrait-search) .portrait-only {
    display: block;
}
body:not(.portrait) .landscape-only {
    display: block;
}
body.portrait:not(.portrait-search) .landscape-only {
    display: none !important;
}
body.portrait:not(.portrait-search) #menu .menu-omni {
    display: none;
}
body.portrait.portrait-search #menu .menu-omni > span {
    width: 100%;
}
body.portrait .menu-omni > span {
    min-width: 0;
}
body.portrait .menu-omni > span {
    background: transparent;
}
body:not(.portrait) #menu content a.entry-2x {
    width: 100%;
}
#menu .menu-omni input, #menu .menu-omni i, #menu .menu-omni input::-webkit-input-placeholder {
    color: var(--secondary-font-color);
    text-shadow: none;
}
#menu .menu-omni.selected > span {
    background: linear-gradient(to bottom, rgba(255,255,255,0.625) 0%, rgba(255,255,255,0.825) 100%);
}
#menu .menu-omni.selected > span input, #menu .menu-omni.selected > span i, #menu .menu-omni.selected > span input::-webkit-input-placeholder {
    color: var(--background-color);
}
#menu .menu-omni i {
    display: inline-block;
    box-sizing: border-box;
    cursor: pointer;
    font-size: var(--menu-entry-name-font-size);
}
.menu-omni-submit {
    justify-content: center;
    align-items: center;
    height: calc(var(--menu-entry-name-font-size) + var(--menu-padding-2x));
    padding: 0 var(--padding);
}
#menu .menu-location-icon img {
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
#menu nav {
    display: flex;
    align-self: start;
    padding-top: calc(var(--padding) * 0.625);
    padding-left: var(--padding-half);
    padding-right: var(--padding-half);
    margin-left: var(--padding-half);
    flex-basis: 100%;
    background: rgba(0,0,0, 0.1);
    border-top-left-radius: var(--radius);
    border-bottom-left-radius: var(--radius);
    max-height: var(--menu-height);
    overflow: hidden auto;
}
body.side-menu #menu .content-out {
    border-top-left-radius: 0;
    border-bottom-left-radius: 0;
}
body.side-menu wrap a .entry-wrapper span, body.side-menu wrap a .entry-cover-container {
    opacity: 0.333;
}
#menu nav > div {
    width: 100%;
    box-sizing: border-box;
    display: flex;
    flex-direction: column;
}
#menu nav a {
    width: 100%;
    display: flex;
    margin-bottom: var(--padding);
    min-height: calc((var(--menu-height) / 10) - var(--padding));
    box-sizing: border-box;
}
#menu nav a .entry-wrapper {
    display: block;
    color: var(--font-color);
    height: calc(var(--padding) * 4);
    padding: calc(1.34 * var(--padding)) 0;
    font-size: var(--menu-entry-name-font-size);
    align-items: center;
    justify-content: center;
    align-content: center;
    display: flex;
    line-height: 100%; 
    box-sizing: border-box !important;
    white-space: pre-wrap;
}
#menu nav a .entry-wrapper > span {
    margin-left: var(--padding-half);
    white-space: normal;
}
body.side-menu:not(.modal) #menu nav {
    display: flex;    
}
body.side-menu .side-menu-toggle {
    display: none;
}
#menu .menu-time {
    display: flex;
    flex-grow: 1;
    align-items: flex-end;
    filter: drop-shadow(var(--drop-shadow));
    flex-direction: column;
}
#menu .menu-time time {
    background: var(--background-color);
    padding: var(--padding-quarter) var(--padding-quarter) var(--padding-quarter) var(--padding);
    border-top-left-radius: var(--radius);
}
.menu-busy {
    display: none;
    padding: var(--padding-half) var(--padding-half) var(--padding-half) var(--padding);
    font-size: calc(var(--menu-entry-name-font-size) * 2);
    max-height: var(--menu-entry-name-font-size);
}
.menu-busy i {
    bottom: var(--menu-entry-name-font-size);
    position: relative;
}
div#home-arrows {
    position: relative;
    left: calc(var(--menu-width) * -1);
    width: 100%;
    align-items: center;
    z-index: 1;
    pointer-events: none;
}
div#home-arrows > div {
    width: var(--menu-width);
    height: var(--menu-height);  
    z-index: 0;
    padding: 0;
    display: flex;
    box-sizing: border-box;
    pointer-events: none;    
    justify-content: center;
    flex-direction: column;
    align-items: center;
}
div#home-arrows > div > * {
    color: white;
    pointer-events: all;
    font-size: 4vmin;
    height: 4vmin;
    cursor: pointer;
    opacity: 0;
    display: flex;
    align-items: baseline;
}
#menu .content-out {    
    height: var(--menu-height);
    display: flex;
    align-items: flex-end;
    width: 100%;
    background: rgba(0,0,0, 0.1);
    border-radius: var(--radius);
}
#menu content {
    height: inherit;
    display: flex;
    position: relative;
    justify-content: left;
    transition: -webkit-mask-image 0.2s linear;
}
#menu content wrap {
    overflow-x: hidden;
    overflow-y: auto;
    display: grid;
    list-style-type: none;
    box-sizing: border-box;
    text-align: left;
    font-size: 0;
    width: var(--menu-width);
    height: inherit;
    scroll-snap-type: y mandatory;
    transition: transform var(--menu-fx-nav-duration) ease-in-out 0s;
}
#menu content wrap a {
    height: var(--menu-entry-height);
    box-sizing: border-box;
    padding: var(--menu-padding);
    display: inline-flex;
    overflow: hidden;
    color: var(--font-color);
    text-align: center;
    scroll-snap-align: start;
    grid-row-start: auto;
    grid-row-end: auto;
    grid-column-start: auto;
    grid-column-end: auto;
}
#menu wrap a.entry-busy .entry-wrapper > span {
    animation: fading-pulse 1.5s infinite ease-out;
}
@keyframes fading-pulse {
    0% { opacity: 0.5; }
    50% { opacity: 1; }
    100% { opacity: 0.5; }
}
#menu .entry-icon-image i, #menu content a span.entry-name, #menu content a span.entry-details {
    display: block;
}
#menu .entry-icon-image i {
    mask-image: radial-gradient(circle at 50% -30%, rgba(0, 0, 0, 1) 0%, rgba(0, 0, 0, 0.8) 35%, rgba(0, 0, 0, 0) 100%);
    -webkit-mask-image: radial-gradient(circle at 50% -30%, rgba(0, 0, 0, 1) 0%, rgba(0, 0, 0, 0.8) 35%, rgba(0, 0, 0, 0) 100%);
}
#menu content a.entry-disabled .entry-icon-image {
    filter: saturate(0.15);
    opacity: var(--opacity-level-3);
}
#menu content a * {
    color: inherit;
}
#menu content a .entry-icon-image i:not(.spin-x-alt) {
    opacity: 0.95;
}
#menu content a .entry-icon-image i.fa-play-circle {
    opacity: var(--opacity-level-4);
}
#menu content a .entry-icon-image i.fa-toggle-off {
    opacity: 0.65;
}
#menu content a .entry-icon-image {
    width: var(--menu-entry-icon-width);
    height: var(--menu-entry-icon-height);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border-radius: var(--radius);
    position: absolute;
    bottom: 4%;
    left: 4%;
    overflow: hidden;
    -webkit-text-size-adjust: none;
    text-size-adjust: none;
}
#menu content a.entry-2x .entry-icon-image {
    width: calc(2 * var(--menu-entry-icon-width));
}
#menu content a .entry-icon-image i {
    width: auto;
    height: auto !important;
    font-size: var(--menu-entry-icon-innersize);
    line-height: normal;
    -webkit-text-size-adjust: none;
    text-size-adjust: none;
}
body.portrait #menu content a .entry-icon-image i {
    font-size: calc((var(--menu-entry-height) * 0.65) * var(--font-scaling)) !important;
    margin-top: var(--padding);
}
#menu content a .entry-icon-image img {
    height: auto !important;
    max-height: 100%;
    width: 100%;
    background-repeat: no-repeat;
    background-position: center center;
    background-size: contain;
    object-fit: contain;
}
#menu content a .entry-icon-image .entry-cover-container img {
    background-size: cover;
    object-fit: cover;
}
#menu content .entry-icon-image .fas:before {
    display: flex;
    justify-content: center;
}
#menu a span.entry-wrapper {
    overflow: hidden;
    position: relative;
    display: inline-flex;    
    border-radius: var(--radius);
    box-sizing: content-box;
    background: linear-gradient(to top, rgba(75, 75, 75, 0.25) 0%, rgba(75, 75, 75, 0.5) 75%, rgba(75, 75, 75, 0.75) 100%);
    border: 1px solid rgba(255, 255, 255, 0.009);
    width: calc(100% - 2px);
    height: calc(100% - 2px);
}
#menu content a.entry-cover span.entry-wrapper {
    border: 1px solid rgba(255,255,255,0.03) !important;
    width: calc(100% - 2px);
    height: calc(100% - 2px);
}
#menu a.selected span.entry-wrapper {
    border-color: rgba(255, 255, 255, 0.009);
    background: linear-gradient(to top, rgba(150, 150, 150, 0.5) 0%, rgba(150, 150, 150, 0.75) 75%, rgba(150, 150, 150, 1) 100%);
    box-shadow: 0 0 2px white;
}
#menu content a span.entry-name, #menu content a span.entry-details {
    text-align: center;
    white-space: normal;
    word-break: break-word;
}
#menu content a span.entry-data-in {
    z-index: 1;
    position: absolute;
    display: inline-block;
    text-align: center;    
    top: var(--menu-padding);
    left: 0;
    z-index: 1;
    width: 100%;
}
#menu content a span.entry-name {
    letter-spacing: 0.033em;
    font-size: var(--menu-entry-name-font-size);
    min-height: var(--menu-entry-name-font-size);
    display: inline-block;
    line-height: 150%;
    text-shadow: 1px 1px black, 0 0 4px black;
    -webkit-font-smoothing: antialiased;
}
#menu content a span.entry-details {
    line-height: 150%;
    font-size: var(--menu-entry-details-font-size);
    min-height: var(--menu-entry-details-font-size);
    color: var(--secondary-font-color);
    text-shadow: 1px 1px black, 0 0 4px black;
}
div#arrow-down-hint {
    justify-content: center;
    width: 100vw;
    height: 0;
    opacity: var(--opacity-level-2);
}
div#arrow-down-hint i {
    display: inline;
    color: var(--font-color);
    font-size: calc(var(--controls-button-height) * 0.5);
    top: calc(-2 * var(--padding));
    position: relative;
    cursor: pointer;
    padding: var(--padding);
}

span.entry-status-flags {
    line-height: 100%;    
}
span.entry-status-flag {
    border-radius: var(--radius);
    height: calc(var(--menu-entry-name-font-size) + var(--padding-quarter));
    min-width: calc(var(--menu-entry-name-font-size) + var(--padding-quarter));
    font-weight: bold;
    text-transform: uppercase;
    display: inline-flex;
    justify-content: center;
    align-items: center;
    opacity: 0.9;
    box-sizing: border-box; 
    white-space: pre;   
}
span.entry-status-flag i.fas.fa-times, span.entry-status-flag i.fas.fa-check {
    margin: calc(var(--padding-quarter) * 0.5) calc(var(--padding-quarter) * 0.5) 0 calc(var(--padding-quarter) * 0.5);
    font-size: calc(var(--menu-entry-name-font-size) - var(--padding-quarter));
}
span.entry-status-flag i.fas.fa-play {
    margin: calc(var(--padding-quarter) * 0.5) 0 0 calc(var(--padding-quarter) * 0.75);
    font-size: calc(var(--menu-entry-name-font-size) - (2 * var(--padding-quarter)));
}
body.portrait span.entry-status-flag i.fas.fa-play {
    margin: calc(var(--padding-quarter) * 0.5) 0 0 calc(var(--padding-quarter) * 1.25);
    font-size: calc(var(--menu-entry-name-font-size) - (4 * var(--padding-quarter)));
}

body:not(.menu-playing) #menu-playing-close {
    visibility: hidden;
}
body.menu-playing controls {
    visibility: hidden;
}
body.menu-playing #menu .content-out {
    overflow: visible;
}
body.menu-playing #menu content {
    border-bottom-left-radius: 0;
    border-bottom-right-radius: 0;
    border-top-right-radius: 0;
}
body.menu-playing #menu content {
    background: transparent;
}
body.menu-playing #menu {
    width: 100vw;
}
body.video.menu-playing #main {
    background: linear-gradient(to bottom, rgba(0, 0, 0, 0.75) 0, rgba(0, 0, 0, 0.75) calc(100vh - var(--controls-height)), #000 100vh);
}
#menu-playing-close {
    position: absolute;
    cursor: pointer;
    color: #ffffff;
    right: calc(2.5 * var(--padding));
    top: calc(2 * var(--padding));
    z-index: 1;
}
#menu-playing-close > div {
    position: relative;
    height: var(--menu-header-height);
    font-size: calc(1.5 * var(--menu-entry-name-font-size));
    padding: 0;
    top: 0;
    line-height: 100%;
    border-top-left-radius: 2vmin;
    border-top-right-radius: 2vmin;
    display: inline-flex;
    align-items: center;
}
#menu-playing-close.selected > div > i {
    color: #ffffff;
    font-size: calc(1.75 * var(--menu-entry-name-font-size)) !important;
}
#menu a.selected span.entry-wrapper.entry-cover-active {
    box-shadow: 0 1px 2px white;
}
.entry-cover-active > div {
    position: absolute;
    width: inherit;
    height: inherit;
    z-index: 0;
    justify-content: center;
    align-items: center;
    display: flex;
}
.entry-disabled.entry-cover-active .entry-wrapper {
    opacity: var(--opacity-level-3);
}
.entry-cover span.entry-name-label {
    text-transform: uppercase;
}
.entry-cover .entry-data-in {
    filter: var(--drop-shadow);
    background: radial-gradient(ellipse farthest-corner, rgba(0, 0, 0, 0.15) 33%, transparent 72%);
}
.entry-cover-active > div > img {
    object-fit: cover;
    border-radius: var(--radius);
    min-width: 100%;
    min-height: 100%;
    height: -webkit-fill-available;
    width: -webkit-fill-available;
}
.entry-cover .entry-wrapper {
    background: linear-gradient(to bottom, var(--background-color), transparent);
}
.entry-cover-active .entry-data-in {
    top: 0 !important;
    background: linear-gradient(to bottom, var(--shadow-background-color) -10%, transparent 100%);
    padding-bottom: calc(var(--menu-entry-name-font-size) * 6);
}
.entry-cover-active .entry-name {
    padding: var(--padding-quarter) var(--padding-half);
    padding-top: var(--padding-half);
    border-radius: var(--radius);    
    border-top-left-radius: 0;
    border-top-right-radius: 0;
    display: inline-block;    
    margin-top: 0;
}
.entry-cover .entry-wrapper {
    background: linear-gradient(to bottom, rgba(0,0,0, 0.3), transparent) !important;
}
.funny-text {
    display: inline-block;
    font-weight: bold;
}
span.entry-status-flag-success {
    background: #094;
}
span.entry-status-flag-failure {
    background: #f04;
}
div#modal {
    position: fixed;
    width: 100vw;
    height: 100vh;
    left: 0;
    z-index: 8;
    background: var(--osd-background-color);
    top: 0;
    left: 0;
    opacity: 0;
    pointer-events: none;
}
div#modal > div {
    position: fixed;
    top: 0;
    left: 0;
    width: auto;
    height: auto;
    z-index: 4;
    color: #000;
    box-sizing: border-box;
    top: calc(var(--menu-padding-top) + var(--padding));
    bottom: calc(var(--menu-padding-bottom) + var(--padding));
    right: calc(var(--menu-padding-right) + var(--padding));
    left: calc(var(--menu-padding-left) + var(--padding));
    display: flex;
    align-items: center;
}
div#modal > div > div {
    display: table;
    vertical-align: middle;
    text-align: center;
    height: var(--modal-height);
}
div#modal > div > div > div {
    display: table-cell;
    width: var(--menu-width);
    vertical-align: middle;    
    transform: scale(var(--menu-fx-nav-deflate));
    transition: transform var(--menu-fx-nav-duration) ease-in-out 0s;    
}
body.modal div#modal > div > div > div {
    transform: none;
    pointer-events: initial;
}
body.modal div#home-arrows {
    visibility: hidden;
}
body.modal wrap {
    opacity: var(--opacity-level-2);
}
body.modal #modal {
    opacity: 1;
}
span.modal-template-message {
    font-size: var(--menu-entry-name-font-size);
    margin-bottom: var(--padding);
    padding: 1.5vmax var(--padding);
    display: flex;
    justify-content: center;
    line-height: 175%;
    flex-shrink: 999;
    overflow: auto;
    word-break: break-word;
}
span.modal-template-message font {
    display: contents;
}
span.modal-template-spacer {
    max-width: var(--menu-modal-option-min-width);
    padding: var(--padding);
    box-sizing: border-box;
    display: block;
    width: 100%;
}
span.modal-template-text, span.modal-template-textarea {
    padding: 0 var(--padding);
    display: flex;
    max-width: var(--menu-modal-option-min-width);
    width: 100%;
    box-sizing: border-box;
    align-items: center;    
    font-size: var(--menu-entry-name-font-size);
    background: linear-gradient(to top, rgba(255, 255, 255, 0.5), white);
    border-radius: var(--radius);
    border-bottom-left-radius: 0;
    border-bottom-right-radius: 0;
}
span.modal-template-text i, span.modal-template-textarea i {
    color: #000;
    opacity: var(--opacity-level-2);
}
span.modal-template-text i {
    padding-right: var(--padding-half);
}
span.modal-template-textarea i {
    padding-right: var(--padding);
}
span.modal-template-textarea {
    margin-bottom: var(--padding);
}
span.modal-template-textarea, span.modal-template-textarea textarea {
    min-height: 20vmax;
}
span.modal-template-text input, span.modal-template-textarea textarea {
    opacity: var(--opacity-level-4);
    background: transparent;
    padding: 0;
    width: inherit;
    min-height: 7vmax;
    border: 0;
    outline: 0;
    max-width: 97%;
    display: inline-block;
    font-size: var(--menu-entry-name-font-size);    
    border-radius: var(--radius);
}
span.modal-template-textarea textarea {
    min-height: 25vh;
    padding: var(--padding);
    line-height: 150%;
}
span.modal-template-question {
    text-align: left;
}
span.modal-template-question i {
    margin-right: var(--padding);
}
span.modal-template-question img {
    height: 2.5vmax;
    width: 2.5vmax;
    background-size: contain;
    background-position: center center;
    margin-right: var(--padding);
    background-repeat: no-repeat;
}
.modal-template-slider, .modal-template-option, .modal-template-option-detailed, .modal-template-question {
    width: 100%;
    display: flex;
    min-height: 7vh;
    align-items: center;
    box-sizing: border-box;
    font-size: var(--menu-entry-name-font-size);
    max-width: var(--menu-modal-option-min-width);
}
.modal-template-question {
    padding: 0 0 1.5vmax 0;
}
.modal-template-slider {
    padding: 1.5vmax 0;
}
a.modal-template-option, a.modal-template-option-detailed {
    justify-content: center;
    background: linear-gradient(to bottom, rgba(255,255,255, 0.2) 0%, transparent 150%);
    color: var(--shadow-background-color);
}
a.modal-template-option > div, a.modal-template-option-detailed > div {
    padding: 2.5vmax 0;
}
a.modal-template-option.selected, a.modal-template-option-detailed.selected .modal-template-option-detailed-name {
    font-weight: bold;
}
a.modal-template-option i, a.modal-template-option-detailed i {
    margin-right: var(--padding);
}
a.modal-template-option.selected, a.modal-template-option-detailed.selected {
    background: linear-gradient(to bottom, rgba(255,255,255,1) 0%, rgba(255,255,255,0.4) 100%);
    opacity: 1;
}
div.modal-template-option-detailed-name {
    display: flex;
    flex-direction: row;
    align-items: center;
    margin-bottom: var(--padding-half);
    justify-content: center;
}
div.modal-template-option-detailed-details {
    display: block;
    width: 100%;
    font-size: var(--menu-entry-details-font-size);
    opacity: var(--opacity-level-4);
    height: auto;
}
span.modal-template-text.selected-parent i, span.modal-template-text.selected-parent input, 
span.modal-template-textarea.selected-parent i, span.modal-template-textarea.selected-parent textarea, 
span.modal-template-text input:focus, span.modal-template-textarea textarea:focus {
    opacity: 1;
}
.modal-wrap {
    max-height: var(--modal-height);
    padding: 0;
    border-radius: var(--radius);
}
.modal-wrap > div {
    overflow: hidden;
    max-height: var(--modal-height);
    padding: var(--padding);
    background: var(--secondary-font-color);
    color: var(--shadow-background-color);
    border-radius: var(--radius);
    box-sizing: border-box;    
    flex-direction: column;
    display: flex;
}
.modal-template-options {
    box-sizing: border-box;
    overflow: auto;
    max-height: inherit;
    display: flex;
    flex-direction: column;
    flex-shrink: 1;
    border-radius: var(--radius);    
}
@media only screen and (min-width: 321px) and (orientation:landscape) {
    .modal-template-options.two-columns {
        flex-direction: row;
        flex-wrap: wrap;
    }
    .modal-template-options.two-columns a.modal-template-option, .modal-template-options.two-columns a.modal-template-option-detailed {
        width: 50%;
    }
}

span.modal-template-slider a:first-child, span.modal-template-slider a:last-child {
    width: 4.9%;
    display: inline-block;
}
span.modal-template-slider {
    background: #fff;
}
span.modal-template-slider .modal-template-slider-track {
    width: calc(100% - (8 * var(--padding)));
    height: calc(4 * var(--padding));
    display: inline-block;
    margin: var(--padding);
    vertical-align: sub;
}

input.modal-template-slider-track {
    overflow: hidden;
    width: 80px;
    -webkit-appearance: none;
    background: linear-gradient(to bottom, transparent -100%, var(--modal-background-color) 400%);
    border-radius: var(--radius);
}
input.modal-template-slider-track::-webkit-slider-runnable-track {
    height: 10px;
    -webkit-appearance: none;
    margin-top: -1px;
    display: block;
}
input.modal-template-slider-track::-webkit-slider-thumb {
    width: 10px;
    -webkit-appearance: none;
    height: 10px;
    cursor: ew-resize;
    background: var(--background-color);
    box-shadow: calc(100vw * -1) 0 0 100vw var(--background-color);
}
span.modal-template-slider-left, span.modal-template-slider-right {
    cursor: pointer;
    font-size: calc(4 * var(--padding));
}

.entry-cover-container {    
    min-height: 100%;
    display: flex;
    justify-content: center;
}
</style>