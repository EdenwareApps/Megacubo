<script>
	import { main } from '../../modules/bridge/renderer'
    import { initApp } from '../src/scripts/app'
    import { onMount } from 'svelte'
    
    const transparentImage = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVQYV2NgYAAAAAMAAWgmWQ0AAAAASUVORK5CYII='

    let entries = [], headerActions = [], lang = {}, icons = {}, path = ''
	onMount(async () => {
        main.on('lang', () => {
            lang = main.lang
        })
        main.waitMain(() => {
            initApp()
            const wrap = document.querySelector('wrap')
            main.menu.on('updated', () => {
                path = main.menu.path
                icons = main.menu.icons                
                const activeKeys = main.menu.currentEntries.map(e => e.key)
                Array.from(wrap.getElementsByTagName('a')).forEach(e => {
                    activeKeys.includes(e.getAttribute('key')) || wrap.removeChild(e)
                })
                entries = main.menu.currentEntries.filter(e => !e.top)
                if(!main.menu.path) {
                    headerActions = main.menu.currentEntries.filter(e => e.top)
                }
            })
        })
    })
</script>
<div id="menu">
    <header>
        <div>
            <span class="menu-location" aria-hidden="true">
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
                <span class="menu-location-pagination">
                    <i class="fas fa-stream"></i>
                    <span></span>
                </span>
            </span>
            <span class="menu-omni">
                <span id="menu-search">
                    <input type="text" id="menu-omni-input" placeholder="{lang.WHAT_TO_WATCH}" />
                    <div class="menu-omni-submit">
                        <i class="fas fa-search"></i>
                    </div>
                </span>
            </span>
            <span class="menu-time" aria-hidden="true">
                <time></time>
                <a href="#search" class="header-entry entry-ignore portrait-only" title="{lang.SEARCH}" aria-label="{lang.SEARCH}" 
                    onclick="main.omni.showPortrait()">
                    <i class="fas fa-search" aria-hidden="true"></i>
                </a>
                {#each headerActions as e}
                    <a href="{e.url}" tabindex="{e.tabindex}" class="header-entry header-entry-{e.fa.split('fa-').pop()}" title="{e.name}" aria-label="{e.name}" 
                        data-type="{e.type}" data-path="{e.path}">
                        <i class="{e.fa}" aria-hidden="true"></i>
                    </a>
                {/each}
                <svg class="logo" height="100%" width="100%" viewBox="0 0 100 100">
                    <text x="0" y="94%" font-family="'megacubo'" font-size="100" textLength="100" lengthAdjust="spacingAndGlyphs" style="fill: var(--font-color);">&#xe900;</text>
                </svg>
            </span>
        </div>
    </header>
    <div class="content-out">
        <content>
            <a href="#close-menu" title="{lang.CLOSE}" id="menu-playing-close">
                <div>
                    <i class="fas fa-times-circle"></i>
                </div>
            </a>
            <wrap>
                {#each entries as e (e.key)}
                    <a href="{e.url}" tabindex="{e.tabindex}" class="{e.class}" title="{e.name}" aria-label="{e.name}" 
                        data-type="{e.type}" data-path="{e.path}" key="{e.key}">
                        <span class="{e.wrapperClass}">
                            {#if e.cover}
                                <div class="entry-cover-container" aria-hidden="true">
                                    <img src="{icons[e.path].url}" alt="" />
                                </div>
                            {/if}
                            <span class="entry-data-in">
                                <span class="entry-name">
                                    {@html e.statusFlags}
                                    <span class="entry-name-label">
                                        {@html e.prepend}
                                        {@html e.rawname||e.name}
                                    </span>
                                </span>
                                <span class="entry-details">{@html [e.details, e.maskText].filter(v => v).join(' &middot; ')}</span>
                            </span>
                            <span class="entry-icon-image">
                                {#if (!icons[e.path] || icons[e.path].url.startsWith('fa'))}
                                    <i class="{e.fa}" style="{e.faStyle||''}" aria-hidden="true"></i>
                                {:else}
                                    {#if !e.cover}
                                        <img src="{transparentImage}" alt="" style="background-image: url({icons[e.path].url})" aria-hidden="true" />
                                    {/if}
                                {/if}
                            </span>
                        </span>
                    </a>
                {/each}
            </wrap>
        </content>
    </div>
    <div id="home-arrows" aria-hidden="true">
        <div>
            <span id="home-arrows-top">
                <i class="fas fa-chevron-up"></i>
            </span>
            <span id="home-arrows-bottom">
                <i class="fas fa-chevron-down"></i>
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
#menu {
    width: var(--menu-width);
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
}
#menu header, #menu content {
    width: 100%;
    display: flex;
    flex-basis: 100%;
    clear: both;
}
#menu header {
    height: var(--menu-header-height);
    box-sizing: border-box;
    justify-content: space-between;
    padding: 0 var(--padding);
    transition: opacity var(--menu-fx-nav-duration) ease-out 0s;
}
#menu header div {
    justify-content: space-between;
    display: flex;
    flex: 1;
}
#menu header time, #menu header .menu-location {
    font-size: var(--menu-entry-name-font-size);
    color: var(--font-color);
    display: inline-flex;
    align-items: center;
    white-space: nowrap;
}
#menu header i {
    font-size: calc(1.125 * var(--menu-entry-name-font-size));
}
body.portrait #menu header i {
    font-size: calc(1.5 * var(--menu-entry-name-font-size));
}
#menu header .menu-location {
    width: 100%; /* Android <9 compat */
}
#menu header .menu-omni {
    display: flex;
    align-self: center;
    flex-grow: inherit;
    text-align: right;
}
body.video.menu-playing #menu header .menu-omni {
    visibility: visible !important;
}
#menu header .menu-omni > span {
    background: linear-gradient(to bottom, rgba(255,255,255,0.0625) 0%, rgba(255, 255, 255, 0.09) 100%);
    border-radius: var(--padding-2x);
    min-width: calc(var(--menu-entry-name-font-size) * 14);
    text-align: left;
    align-items: center;
    margin-right: calc(var( --padding) * 2);
    padding: var(--menu-padding) calc(2 * var(--menu-padding));
    vertical-align: middle;
}
#menu header .menu-omni input {
    border-width: 0;
    width: calc(100% - var(--menu-entry-name-font-size));    
    min-width: calc(13 * var(--menu-entry-name-font-size));
    background: transparent;
    font-size: var(--menu-entry-name-font-size);    
}
body.home #menu content a.entry-2x, body.menu-wide #menu content a.entry-2x {
    width: calc(200% / var(--entries-per-row));
    max-width: 100%;
}
body.portrait #menu content a.entry-2x {
    height: calc(200% / var(--entries-per-col));
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
body.portrait:not(.portrait-search) #menu header .menu-omni {
    display: none;
}
body.portrait.portrait-search .header-entry {
    display: none;
}
body.portrait.portrait-search #menu header .menu-location {
    display: none;
}
body.portrait:not(.home) .header-entry-info-circle, body.portrait:not(.home) .header-entry-power-off, body.portrait:not(.home) .header-entry-plus {
    display: none;
}
body.portrait.portrait-search #menu header .menu-omni > span {
    width: 100%;
}
body.portrait .menu-omni > span {
    min-width: 0;
}
body.portrait .header-entry {
    padding: var(--padding-half) var(--padding-2x) !important;
}
body.portrait .menu-time time {
    display: none !important;
}
body.portrait .menu-omni > span {
    background: transparent;
}
body:not(.portrait) #menu content a.entry-2x {
    width: calc(200% / var(--entries-per-row));
}
#menu header .menu-omni input, #menu header .menu-omni i, #menu header .menu-omni input::-webkit-input-placeholder {
    color: var(--secondary-font-color);
    text-shadow: none;
}
#menu header .menu-omni > span.selected {
    background: linear-gradient(to bottom, rgba(255,255,255,0.625) 0%, rgba(255,255,255,0.825) 100%);
}
#menu header .menu-omni > span.selected input, #menu header .menu-omni > span.selected i, #menu header .menu-omni > span.selected input::-webkit-input-placeholder {
    color: var(--background-color);
}
#menu header .menu-omni i {
    display: inline-block;
    box-sizing: border-box;
    cursor: pointer;
    font-size: var(--menu-entry-name-font-size);
}
.menu-omni-submit {
    justify-content: center;
    align-items: center;
    height: calc(var(--menu-entry-name-font-size) + (2 * var(--menu-padding)));
    padding: 0 var(--padding);
}
#menu header .menu-location-text {
    margin-top: calc(var(--padding) * -0.075);
}
#menu header .menu-location-icon {
    display: flex;
    align-items: center;    
    margin-right: var(--padding);
}
#menu header .menu-location-icon img {
    height: var(--menu-entry-name-font-size);
    vertical-align: bottom;
    background-size: contain;
    background-repeat: no-repeat;
    background-position: center;
}
#menu header .menu-location-pagination {
    display: none;
    margin-left: var(--padding-2x);
}
#menu header .logo {
    margin-left: var(--padding);
    width: auto;
    font-size: var(--menu-entry-name-font-size);
    height: var(--menu-entry-name-font-size);
}

#menu .menu-time {
    display: flex;
    align-items: center;
    filter: drop-shadow(var(--drop-shadow));
}
div#home-arrows {
    position: relative;
    width: 100vw;
    align-items: center;
    z-index: 1;
}
span#home-arrows-top {
    transform: translateY(calc(-2 * var(--padding)));
}
span#home-arrows-bottom {
    transform: translateY(var(--padding));
    bottom: 0;
}
div#home-arrows > div {
    position: relative; 
    width: 100vw;
    height: var(--menu-content-height);  
    z-index: 0;
    padding: 0;
    top: calc((var(--menu-height) - var(--menu-header-height)) * -1);
    left: calc(((100vw - var(--menu-width)) / 2) * -1);
    display: flex;
    box-sizing: border-box;
    pointer-events: none;
    justify-content: center;
}
div#home-arrows > div > * {
    color: white;
    pointer-events: all;
    font-size: 4vmin;
    height: 4vmin;
    cursor: pointer;
    opacity: 0;
    position: absolute;
    display: flex;
    align-items: baseline;
}
#menu .content-out {    
    height: var(--menu-content-height);
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
    justify-content: center;
    transition: -webkit-mask-image 0.2s linear;
}
#menu content wrap {
    overflow-x: hidden;
    overflow-y: auto;
    display: inline-block;
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
    width: calc(100% / var(--entries-per-row));
    height: var(--menu-entry-height);
    box-sizing: border-box;
    padding: var(--menu-padding);
    display: inline-block;
    overflow: hidden;
    color: var(--font-color);
    text-align: center;
    scroll-snap-align: start;
}
#menu .entry-loading {
    opacity: var(--opacity-level-2);
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
    width: 92%;
    height: 64%;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: var(--radius);
    position: absolute;
    bottom: 4%;
    left: 4%;
}
#menu content a .entry-icon-image i {
    width: auto;
    height: auto !important;
    font-size: calc(var(--menu-entry-icon-height) * 0.9);
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
#menu content a span.entry-wrapper {
    width: 100%;
    height: 100%;
    overflow: hidden;
    position: relative;
    display: inline-block;    
    border-radius: var(--radius);
    border: 0px solid rgba(255, 255, 255, 0);
    box-sizing: content-box;
    background: linear-gradient(to top, rgba(255, 255, 255, 0.025) 0%, rgba(255, 255, 255, 0) 75%, rgba(255, 255, 255, 0.025) 100%);
}
#menu content a:not(.selected) span.entry-wrapper {
    border: 1px solid rgba(255, 255, 255, 0.009);
    width: calc(100% - 2px);
    height: calc(100% - 2px);
}
#menu content a.entry-cover:not(.selected) span.entry-wrapper {
    border: 1px solid rgba(255,255,255,0.03) !important;
    width: calc(100% - 2px);
    height: calc(100% - 2px);
}
#menu content a.selected span.entry-wrapper {
    background: linear-gradient(to top, rgba(255, 255, 255, 0.15) 0%, rgba(255, 255, 255, 0.05) 75%, rgba(255, 255, 255, 0.375) 100%);
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
body.video #menu header > div > span {
    visibility: hidden !important;
}
body.menu-playing #menu content {
    background: transparent;
}
body.menu-playing #menu {
    width: 100vw;
}
body.menu-playing #main {
    background: linear-gradient(to bottom, rgba(0, 0, 0, 0.75) 0, rgba(0, 0, 0, 0.75) calc(100vh - var(--controls-height)), #000 100vh);
}
#menu-playing-close {
    position: absolute;
    right: 0;
    cursor: pointer;
    color: #ffffff;
}
#menu-playing-close > div {
    position: relative;
    height: var(--menu-header-height);
    font-size: calc(1.5 * var(--menu-entry-name-font-size));
    padding: 0;
    top: calc(var(--menu-header-height) * -1);
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
#menu content a.selected span.entry-wrapper.entry-cover-active {
    box-shadow: 0 1px 2px white;
}
.entry-cover-active > div {
    position: absolute;
    width: inherit;
    height: inherit;
    z-index: -999;
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
    z-index: 9;
    background: var(--modal-background-color);
    position: absolute;
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
    height: var(--modal-height);
    z-index: 4;
    color: #000;
    display: block;
    box-sizing: border-box;
    top: calc(var(--menu-padding-top) + var(--padding));
    bottom: calc(var(--menu-padding-bottom) + var(--padding));
    right: calc(var(--menu-padding-right) + var(--padding));
    left: calc(var(--menu-padding-left) + var(--padding));
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
    pointer-events: all;
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
body.modal header {
    visibility: hidden !important;
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
    color: #000;
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
    box-sizing: border-box;
    max-width: var(--menu-modal-option-min-width);
    width: 100%;
    font-size: var(--menu-entry-name-font-size);
    display: flex;
    align-items: center;
}
.modal-template-slider, .modal-template-question {
    padding: 1.5vmax 0;
}
a.modal-template-option, a.modal-template-option-detailed {
    border-bottom: 2px solid rgba(0,0,0,0.02);
    box-shadow: 0 -0.5vmin 1vmin 0.5vmin rgba(0, 0, 0, 0.01);
    justify-content: center;
    background: linear-gradient(to bottom, rgba(0,0,0, 0.05) 0%, transparent 150%);
    color: black;
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
    box-shadow: 0 0 2vh 0.5vh rgba(0, 0, 0, 0.125);
    background: white;
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
    background: linear-gradient(to bottom, rgba(255, 255, 255, 0.72) 0%, rgba(255, 255, 255, 0.95) 5%, rgba(255, 255, 255, 0.9) 20%, rgba(255, 255, 255, 0.8) 100%);
    border-radius: var(--radius);
    box-sizing: border-box;    
    flex-direction: column;
    display: flex;
}
.modal-template-options {
    background: linear-gradient(to bottom, rgba(255, 255, 255, 0.4) 0%, rgba(255, 255, 255, 0.7) 100%);
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