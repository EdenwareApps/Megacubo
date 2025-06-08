<script>
    import { onMount } from 'svelte';
    import { initApp } from '../src/scripts/app';
    import { css } from '../src/scripts/utils';
    import { main } from '../../modules/bridge/renderer';
    import { setupCrashlog } from '../../modules/crashlog/renderer';
	import VirtualGrid from './VirtualGrid.svelte';
    import SpatialNavigation from './SpatialNavigation.svelte';
    import Menubar from './Menubar.svelte';
    import Dialog from './Dialog.svelte'

    const transparentImage = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVQYV2NgYAAAAAMAAWgmWQ0AAAAASUVORK5CYII=';

    let items = $state([]);
    let sideMenuItems = $state([]);
    let lang = $state({});
    let icons = $state({});
    let path = $state('');
    let refresh = $state(() => {});
    let viewSize = $state({ x: 0, y: 0, size: 1 });
    let range = $state({start: 0, end: 0, renderStart: 0, renderEnd: 0});
    let isTop = $state(false);
    let isBottom = $state(false);    
    let container = $state(document.documentElement);

    let selectedIndex = $state(0);
    let lastRange = null;
    let spatialNavigation;
    let virtualGrid;
    let menubar;
    let dialog;

    function setupNavigation() {
        ([
            {
                name: 'default',
                selector: [
                    '#menu svelte-virtual-grid-contents a',
                    'body.video #menu-playing-close',
                    '.menu-omni'
                ],
                condition: () => {
                    return main.menu.isVisible() && !main.menu.inSideMenu() && !dialog.inDialog()
                },
                default: true,
                overScrollAction: (direction, e) => {
                    if (direction == 'up' || direction == 'down') {
                        let playing = main.menu.inPlayer()
                        if (!playing) {
                            let n, i = main.menu.selectedIndex
                            const x = main.menu.gridLayoutX, container = main.menu.scrollContainer
                            const top = direction == 'up' ? 0 : container.scrollHeight - container.clientHeight
                            container.scrollTop = top
                            if (e) {
                                let positionInRow = i, has2xEntry = items.slice(0, 2).some(item => item.class?.includes('entry-2x'))
                                if (positionInRow >= x) {
                                    positionInRow -= Math.floor(i / x) * x
                                }
                                if(positionInRow && has2xEntry && direction == 'down') {
                                    positionInRow++
                                }
                                if (positionInRow === x) {
                                    positionInRow = 0
                                }
                                if(direction == 'up') {
                                    if (has2xEntry && positionInRow > 0 && positionInRow < (x - 1)) {
                                        positionInRow++;
                                    }
                                    let floor  = (items.length % x) ? items.length : (items.length - 1)
                                    floor = (Math.floor(floor / x) * x)
                                    if (has2xEntry) floor--
                                    i = positionInRow + floor
                                    if(items[i]) {
                                        n = i
                                    } else {
                                        n = items.length - 1
                                    }
                                } else {
                                    if (positionInRow == 1) {
                                        positionInRow = 0
                                    } else if (positionInRow < (x - 1)) {
                                        positionInRow--
                                    } else {
                                        positionInRow = 2
                                    }
                                    i = positionInRow
                                    if(items[i]) {
                                        n = i
                                    } else {
                                        n = 0
                                    }
                                }
                            }
                            if (typeof(n) !== 'number') {
                                n = i
                            }
                            main.menu.emit('focus-index', n)
                            main.menu.emit('x-select', null)
                            return true
                        } else if(direction == 'up') {
                            main.menu.showWhilePlaying(false)
                        }
                    } else if(direction == 'left' && !main.menu.inSideMenu() && !dialog.inDialog()) {
                        main.menu.sideMenu(true)
                        return true
                    }
                }
            },
            {
                name: 'nav-menu',
                selector: 'body.side-menu #menu nav a',
                condition: () => {
                    return main.menu.inSideMenu() && !dialog.inDialog() && main.menu.isVisible()
                },
                overScrollAction: (direction, e) => {
                    if (direction == 'up' || direction == 'down') {
                        let playing = main.menu.inPlayer()
                        if (!playing) {
                            let n = [...main.menu.container.querySelectorAll('entry-nav')][direction == 'down' ? 'shift' : 'pop']()
                            spatialNavigation.focus(n)
                            return true
                        } else if(direction == 'up' || direction == 'left') {
                            main.menu.showWhilePlaying(false)
                        }
                    } else if(direction == 'right') {
                        main.menu.sideMenu(false)
                        return true
                    }
                }
            },
            {
                name: 'dialog',
                selector: '.dialog-content input, .dialog-content textarea, .dialog-content button, .dialog-content a',
                condition: () => {
                    return dialog.inDialog()
                },
                overScrollAction: (direction, e) => {
                    if (direction == 'left' || direction == 'right') {
                        const element = document.querySelector('.dialog-template-slider-track:not(.selected)')
                        if (element) {
                            spatialNavigation.focus(element)
                            return true
                        }
                    }
                }
            },
            {
                name: 'player',
                selector: [
                    'body.video-paused button.control-layer-icon',
                    'controls button, div#arrow-down-hint i',
                    'seekbar > div'
                ],
                condition: () => {
                    return main.menu.inPlayer() && !dialog.inDialog() && !main.menu.isVisible()
                },
                overScrollAction: direction => {
                    if (direction == 'down') {
                        if (main.idle.activeTime() > 1) { // was idle, ignore initial focus on player
                            main.menu.showWhilePlaying(true)
                        } else {
                            main.menu.reset()                            
                        }
                    } else if (direction == 'up') {
                        if (main.idle.activeTime() > 1) { // was idle, ignore initial focus on player
                            if (main.streamer.seekbarFocus()) {
                                main.menu.reset()
                                main.idle.start()
                                main.idle.lock(1)
                            } else {
                                main.streamer.seekbarFocus(true)
                            }
                        } else {
                            main.menu.reset()
                        }
                    }
                    return true
                }
            }
        ]).forEach(spatialNavigation.addLayout.bind(spatialNavigation))
    }

    function focusElement(element) {
        if (main.menu.sideMenuTransitioning) return
        spatialNavigation.focus(element)
    }

    function itemFocusCallback({ index, element }) {
        if (selectedIndex == index) return;
        selectedIndex = index;
        main.menu.selectedElement = element;
        main.menu.selectedElementX = element;
        main.menu.selectedIndex = index;
        main.menu.emit('select', element);
        menubar.setIndex(index);
    }

    function itemXFocusCallback({ index, element }) {
        main.menu.selectedElementX = element;
        main.menu.emit('x-select', element);
    }

    function itemNavigateCallback(element) {
        if (element) {
            const key = main.menu.getKey(element);
            if (key == main.menu.lastSelectedKey) return;
            main.menu.lastSelectedKey = key;
            main.menu.sounds.play('click-in', {volume: 30})
        }
    }

    function updateViewSize() {
        if (!main.config) return;
        const portrait = window.innerWidth <= window.innerHeight;
        if (main.config?.['view-size']) {
            Object.assign(viewSize, main.config['view-size'][portrait ? 'portrait' : 'landscape']);
            viewSize.size = viewSize.x * viewSize.y;
        }
        const style = `
        body:not(.portrait) svelte-virtual-grid-contents {        
            grid-template-columns: repeat(auto-fit, calc(var(--menu-entry-width) - (0.25 * var(--menu-padding))));
            grid-template-rows: repeat(auto-fit, calc(var(--menu-entry-height) - (0.25 * var(--menu-padding))));
        }
        body.portrait svelte-virtual-grid-contents {
            grid-template-columns: repeat(auto-fit, calc(var(--menu-entry-width) - (0.25 * var(--menu-padding))));
            grid-template-rows: repeat(auto-fit, calc(var(--menu-entry-height) - (0.25 * var(--menu-padding))));
        }
        body:not(.portrait) .entry-2x {
            grid-column: span 2 !important;
        }
        body.portrait .entry-2x {
            grid-row: span 2 !important;
        }
        `
        css(style, 'update-view-size');
        updateEntry2x();
    }

    function updateEntry2x() {
        if (items.length > 0) {
            let style = '';
            const entry2xIndex = items.slice(0, viewSize.size).findIndex(entry => {
                return entry?.class?.includes('entry-2x');
            });
            if (entry2xIndex > -1) {
                if (window.innerWidth > window.innerHeight) {
                    style = `
                    svelte-virtual-grid-contents a.entry-2x {
                        grid-column: span 2 !important;
                    }
                    `
                } else {
                    style = `
                    svelte-virtual-grid-contents a.entry-2x {
                        grid-row: span 2 !important;
                    }
                    `
                }
            } else {
                style = `
                /* empty style */
                `
            }
            css(style, 'update-entry-2x');
        }
    }

    const itemReference = document.createElement('div');
    itemReference.style.cssText = `
        width: var(--menu-entry-width);
        height: var(--menu-entry-height);
        display: inline-block;
        position: fixed;
        top: -100vh;
        left: 0;
    `;
    document.body.appendChild(itemReference);

    function itemWidth(row, index) {
        if (!row) return itemReference.offsetWidth;
        if (row?.class?.includes('entry-2x') && window.innerWidth > window.innerHeight) {
            return itemReference.offsetWidth * 2;
        }
        return itemReference.offsetWidth;
    }

    function itemHeight(row, index) {
        if (!row) return itemReference.offsetHeight;
        if (row?.class?.includes('entry-2x') && window.innerWidth < window.innerHeight) {
            return itemReference.offsetHeight * 2;
        }
        return itemReference.offsetHeight;
    }

    window.addEventListener('resize', updateViewSize);

    setupCrashlog(window);
    onMount(async () => {
        main.on('lang', () => {
            lang = main.lang;
        });
        main.on('config', updateViewSize);
        main.waitMain(() => {
            initApp().catch(err => console.error(err)).finally(() => {
                const reset = async () => {
                    const {selectedIndex, scrollTop} = spatialNavigation.reset()
                    if (spatialNavigation.inDefaultLayout()) {
                        await virtualGrid.scrollToIndex(selectedIndex)
                        main.menu.scrollContainer.scrollTop = scrollTop
                    }
                    spatialNavigation.focusIndex(selectedIndex)
                }
                main.menu.navigation = spatialNavigation;
                main.menu.dialogs = dialog;
                main.menu.on('reset', reset);
                main.menu.on('navigate', reset);
                main.menu.on('updated', () => {
                    lastRange = null;
                    path = main.menu.path;
                    icons = main.menu.icons;
                    items = main.menu.currentEntries;
                    if (!main.menu.path) {
                        sideMenuItems = main.menu.currentEntries.filter(e => e.side);
                    }
                    updateEntry2x();
                    refresh();
                });
                main.menu.on('arrow', (direction, notCyclic) => {
                    spatialNavigation.navigate(direction, notCyclic)
                });
                main.menu.on('focus-index', async index => {
                    await virtualGrid.scrollToIndex(index)
                    spatialNavigation.focusIndex(index)
                });
                main.menu.on('focus', element => {
                    spatialNavigation.focus(element)
                });
                container = main.menu.scrollContainer;
                setupNavigation();
            });
        });
    });

    $effect(() => {
        if (!lastRange || lastRange.start != range.start || lastRange.end != range.end) {
            lastRange = {start: range.start, end: range.end};
            main.emit('menu-update-range', lastRange, main.menu?.path)
        }
    });
</script>
<div id="main">
    <a href="#close-menu" aria-label="{lang.CLOSE}" title="{lang.CLOSE}" id="menu-playing-close">
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
                    {#each sideMenuItems as e (e.key)}
                    <a href="{e.url}" tabindex="{e.tabindex}" class="entry entry-nav" data-type="{e.type}" data-path="{e.path}" key="{e.key}" aria-label="{e.name}" data-original-icon="{e.originalIcon}" data-question="{e.question}" data-dialog-details="{e.dialogDetails}" draggable="false">
                        <span class="entry-wrapper">
                            <i class="{e.fa}"></i>
                            <span>
                                {@html e.prepend}
                                {@html e.rawname || e.name}
                            </span>
                        </span>
                    </a>
                    {/each}
                </div>
                <div class="side-menu-toggle">
                    <div>
                        <span>
                            <img src="assets/images/default_icon_white.png" alt="" style="width: 4vmax; height: 4vmax; margin: 0.5vmax 0;" loading="lazy" />
                        </span>
                    </div>
                </div>
            </nav>
        </div>
        <div class="content-out">
            <content role="region" onmouseenter={() => main.menu.sideMenu(false)}>
                <VirtualGrid width="var(--menu-width)" height="var(--menu-height)" items={items} let:item itemWidth={itemWidth} itemHeight={itemHeight} bind:this={virtualGrid} bind:range bind:isTop bind:isBottom bind:refresh>
                    {#snippet children(item)}
                    <a href="{item.url}" tabindex="{item.tabindex}" class="{item.class} {selectedIndex == item.tabindex ? 'selected' : ''}" title="{item.name}" aria-label="{item.name}" 
                        data-type="{item.type}" data-path="{item.path}" key="{item.key}"  draggable="false" 
                        data-range-start="{item.range ? item.range.start : 0}" data-range-end="{item.range ? item.range.end : 100}" 
                        data-mask="{item.mask}" data-original-icon="{item.originalIcon}" data-question="{item.question}" data-dialog-details="{item.dialogDetails}"
                        style="order: {item.tabindex};" onmouseenter={(event) => focusElement(event.target)}
                        >
                        <span class="{item.wrapperClass}">
                            {#if item.cover}
                                <div class="entry-cover-container" aria-hidden="true">
                                    <img src="{icons[item.path].url}" alt="" draggable="false" />
                                </div>
                            {/if}
                            <span class="entry-data-in">
                                <span class="entry-name">
                                    <span class="{item.statusFlagsClass}">{@html item.statusFlags}</span>
                                    <span class="entry-name-label">
                                        {@html item.prepend}
                                        {@html item.rawname||item.name}
                                    </span>
                                </span>
                                <span class="entry-details">{@html [item.details, main.menu.maskValue(item.value, item.mask)].filter(v => v).join(' &middot; ')}</span>
                            </span>
                            <span class="entry-icon-image">
                                {#if (!icons[item.path] || item.type == 'back' || icons[item.path].url.startsWith('fa'))}
                                    <i class="{item.fa}" style="{item.faStyle||''}" aria-hidden="true"></i>
                                {:else}
                                    {#if !item.cover}
                                        <img src="{transparentImage}" draggable="false" alt="" style="background-image: url({icons[item.path].url})" aria-hidden="true" />
                                    {/if}
                                {/if}
                            </span>
                        </span>
                    </a>
                    {/snippet}
                </VirtualGrid>
            </content>
            <div id="arrow" aria-hidden="true">
                <div>
                    <span id="arrow-up" style="opacity: {isTop ? '0' : '1'};">
                        <i class="fas fa-chevron-up"></i>
                    </span>
                    <span style="flex-grow: 1;"></span>
                    <span id="arrow-down" style="opacity: {isBottom ? '0' : '1'};">
                        <i class="fas fa-chevron-down"></i>
                    </span>
                </div>
            </div>
            <Menubar path={path} icons={icons} bind:this={menubar}></Menubar>
            <SpatialNavigation 
                debug={false} container={container} bind:this={spatialNavigation} bind:path 
                onFocus={itemFocusCallback} onXFocus={itemXFocusCallback} onNavigate={itemNavigateCallback} 
            />
        </div>
    </div>
</div>
<Dialog bind:this={dialog}></Dialog>
<style global>
svelte-virtual-grid-viewport {
    -webkit-overflow-scrolling: touch;
    scroll-snap-type: y mandatory;
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
    overflow: scroll hidden;
    position: fixed;
    top: 0;
    left: 0;
    scrollbar-width: none;
    -ms-overflow-style: none;
}
#menu::-webkit-scrollbar {
    display: none;
}
div#arrow {
    visibility: hidden;
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
    background: transparent;
    padding: 0.75vmax 3vmax;
    color: var(--secondary-font-color);
    position: absolute;
    z-index: 1;
    opacity: 1;
    transition: opacity 0.15s ease-in 0s;
    align-self: center;
    box-shadow: inset -0.1vmin 0 rgba(255,255,255, 0.175);
}
html.curtains-closed .side-menu-toggle > div > span, body.video .side-menu-toggle > div > span {
    background: black;
}
html.curtains-closed .side-menu-toggle > div > span, body.video .side-menu-toggle > div > span, body.side-menu .side-menu-toggle > div > span {
    opacity: 0;
    box-shadow: none;
}
body.side-menu:not(.idle) .side-menu-toggle > div > span {
    background: var(--background-color);
}
body:not(.side-menu) .side-menu-toggle > div > span > img {
    animation: shake 5s infinite ease-out;
}
@keyframes shake {
    0% { margin-left: 0vh; }
    92% { margin-left: 0vh; }
    94% { margin-left: 0.5vh; }
    96% { margin-left: 0vh; }
    98% { margin-left: 0.5vh; }
    100% { margin-left: 0vh; }
}
body.video #menubar  {
    display: none;
}
.side-menu-out {
    transition: width 0.15s ease-in;
    display: flex; 
    width: var(--nav-width);
    max-height: var(--menu-height);
    padding-right: var(--padding-quarter); /* bugfix: avoid a white vertical line on menu-playing */
}
body.video:not(.menu-playing) .side-menu-out {
    display: none;
}
.side-menu-toggle i.fa-chevron-down {
    animation: fa-shake 5s 3 ease-in;
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
#menu .menu-omni {
    position: fixed;
    left: var(--nav-width);
    top: 0;
    background: linear-gradient(to bottom, transparent 0%, var(--background-color) 2%, var(--background-color) 70%, transparent 100%);
    width: 100%;
    z-index: 2;
    justify-content: center;
    display: flex;
    align-self: center;
    flex-grow: inherit;
    padding: var(--padding-2x) 0 10vmin 0;
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
    background: linear-gradient(to bottom, rgba(255,255,255, 1) 0%, rgba(255,255,255, 0.5) 100%);
    border-radius: var(--padding-2x);
    min-width: calc(var(--menu-entry-name-font-size) * 14);
    text-align: left;
    align-items: center;
    margin-right: calc( var(--padding) * 2);
    padding: var(--menu-padding) var(--menu-padding-2x);
    vertical-align: middle;
    display: flex;
    flex-direction: row;
    margin: 2vmin 0 4vmin 0;
}
#menu .menu-omni input {
    width: calc(100% - var(--menu-entry-name-font-size));    
    min-width: calc(13 * var(--menu-entry-name-font-size));
    font-size: var(--menu-entry-name-font-size);   
    background: transparent;
    line-height: 150%; 
    border-width: 0;
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
    color: var(--shadow-background-color);
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
    display: flex;
    justify-content: center;
    align-items: center;
    height: calc(var(--menu-entry-name-font-size) + var(--menu-padding-2x));
    padding: 0 var(--padding);
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
    scroll-snap-type: y mandatory;
    overflow: hidden auto;
}
body.side-menu #menu .content-out {
    border-top-left-radius: 0;
    border-bottom-left-radius: 0;
}
body.side-menu svelte-virtual-grid-contents a .entry-wrapper span, body.side-menu svelte-virtual-grid-contents a .entry-cover-container {
    opacity: 0.333;
}
#menu nav > div {
    width: 100%;
    height: 100%;
    display: flex;
    box-sizing: border-box;
    flex-direction: column;
}
#menu nav a {
    width: 100%;
    display: flex;
    margin-bottom: var(--menu-padding);
    box-sizing: border-box;
    scroll-snap-align: start;
}
#menu nav a .entry-wrapper {
    display: block;
    color: var(--font-color);
    height: calc((var(--menu-height) - (10 * var(--menu-padding))) / 10);
    font-size: var(--menu-entry-name-font-size);
    align-items: center;
    justify-content: center;
    align-content: center;
    display: flex;
    line-height: 100%; 
    box-sizing: border-box !important;
    white-space: pre-wrap;
    flex-grow: 1;
    overflow: hidden;
    border-radius: var(--radius);
}
body.video #menu a span.entry-wrapper {
    background: var(--alpha-shadow-background-color) !important;
}
body.video #menu a.selected span.entry-wrapper {
    background: black !important;
}
#menu nav a .entry-wrapper > span {
    margin-left: var(--padding-half);
    white-space: normal;
}
body.side-menu:not(.dialog) #menu nav {
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
.menu-busy {
    display: none;
    padding: var(--padding-half) var(--padding-half) var(--padding-half) var(--padding);
    font-size: calc(var(--menu-entry-name-font-size) * 2);
    max-height: calc(var(--menu-entry-name-font-size) * 2);
}
div#arrow {
    position: relative;
    left: calc(var(--menu-width) * -1);
    width: 100%;
    align-items: center;
    z-index: 1;
    pointer-events: none;
}
div#arrow > div {
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
div#arrow > div > * {
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
    transition: -webkit-mask-image 0.2s ease-in;
}
svelte-virtual-grid-contents {
    display: grid !important;
    width: var(--menu-width);
    min-height: var(--menu-height);
    overflow: visible;
    min-height: 100%;
    padding: 0;
}
#menu content a {
    display: flex;
    overflow: hidden;
    text-align: center;
    position: relative;
    box-sizing: border-box;
    scroll-snap-align: start;
    color: var(--font-color);
    padding: var(--menu-padding);
    min-height: var(--menu-entry-height);
}
.busy-x, #menu svelte-virtual-grid-contents a.entry-busy span.entry-icon-image i, #menu svelte-virtual-grid-contents a.entry-busy span.entry-icon-image img,
#menu svelte-virtual-grid-contents a.entry-busy-x span.entry-icon-image i, #menu svelte-virtual-grid-contents a.entry-busy-x span.entry-icon-image img {
    -webkit-mask-image: linear-gradient(90deg, rgba(0, 0, 0, 0.1) 0%, rgba(0, 0, 0, 0.3) 50%, rgba(0, 0, 0, 0.1) 100%);
    mask-image: linear-gradient(90deg, rgba(0, 0, 0, 0.1) 0%, rgba(0, 0, 0, 0.3) 50%, rgba(0, 0, 0, 0.1) 100%);
    animation: shine-pulse 1.33s infinite;
    -webkit-mask-size: 200% 100%;
    mask-size: 200% 100%;
}
.busy-x {
    -webkit-mask-image: linear-gradient(90deg, rgba(0, 0, 0, 0.1) 0%, rgba(0, 0, 0, 1) 50%, rgba(0, 0, 0, 0.1) 100%);
    mask-image: linear-gradient(90deg, rgba(0, 0, 0, 0.1) 0%, rgba(0, 0, 0, 1) 50%, rgba(0, 0, 0, 0.1) 100%);
}
@keyframes shine-pulse {
    0% {
        -webkit-mask-position: -200% 0;
        mask-position: -200% 0;
        will-change: mask-position;
    }
    100% {
        -webkit-mask-position: 200% 0;
        mask-position: 200% 0;
    }
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
#menu svelte-virtual-grid-contents a span.entry-wrapper {
    overflow: hidden;
    position: absolute;
    display: inline-flex;    
    border-radius: var(--radius);
    box-sizing: border-box;
    border: 1px solid rgba(255, 255, 255, 0.009);
    transition: transform 0.1s ease-in;
    width: 98%;
    height: 96%;
}
#menu a.selected span.entry-wrapper {
    border-color: rgba(255, 255, 255, 0.009);
    background: linear-gradient(to top, rgba(150, 150, 150, 0.5) 0%, rgba(150, 150, 150, 0.75) 75%, rgba(150, 150, 150, 1) 100%);
    box-shadow: 0 0 2px white;
    z-index: 0;
}
svelte-virtual-grid-contents a.selected {
    overflow: visible !important;
}
svelte-virtual-grid-contents a.selected > span {
    transform: scale(1.01);
    transform-origin: center center;
}
controls button.selected span.button-icon, seekbar div.selected, a.control-layer-icon.selected, button.control-layer-icon.selected, div#arrow-down-hint i.selected {
    transform-origin: center center;    
    filter: drop-shadow(0 0 1vmin #ffffff);
}
seekbar div.selected {
    transform: scaleY(2);
}
controls button.selected span.button-icon, a.control-layer-icon.selected, button.control-layer-icon.selected, div#arrow-down-hint i.selected {
    transform: scale(1.25);
}
div#arrow-down-hint.selected-parent {
    filter: drop-shadow(0 0 1vmin #ffffff);
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
    z-index: 1;
    width: 100%;
    padding: var(--menu-padding) 0 var(--padding-2x) 0;
    text-shadow: var(--solid-text-shadow);
}
#menu content a span.entry-name {
    letter-spacing: 0.033em;
    font-size: var(--menu-entry-name-font-size);
    min-height: var(--menu-entry-name-font-size);
    line-height: 150%;
    -webkit-font-smoothing: antialiased;    
    overflow: hidden;
    display: -webkit-box;
    text-overflow: ellipsis;
    line-clamp: 2;
    -webkit-line-clamp: 2;
    -webkit-box-pack: center;
    -webkit-box-orient: vertical;
}
#menu content a.selected span.entry-name,
#menu content a:hover span.entry-name,
#menu content a:focus span.entry-name,
#menu content a:active span.entry-name {
    -webkit-box-orient: initial;
    -webkit-box-pack: center;
}
#menu content a span.entry-details {
    line-height: 150%;
    color: var(--secondary-font-color);
    font-size: var(--menu-entry-details-font-size);
    min-height: var(--menu-entry-details-font-size);
    overflow: hidden;
    display: -webkit-box;
    text-overflow: ellipsis;
    line-clamp: 1;
    -webkit-line-clamp: 1;
    -webkit-box-pack: center;
    -webkit-box-orient: vertical;
}
#menu content a.selected span.entry-details,
#menu content a:hover span.entry-details,
#menu content a:focus span.entry-details,
#menu content a:active span.entry-details {
    -webkit-box-orient: initial;
    -webkit-box-pack: center;
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
    background: linear-gradient(to bottom, rgba(0, 0, 0, 0.75) 0, rgba(0, 0, 0, 0.75) calc(100vh - var(--controls-height)), rgba(0, 0, 0, 0.8) 100vh);
    position: fixed;
    top: 0;
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
    width: 100%;
    height: 100%;
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
    background: linear-gradient(to bottom, var(--alpha-shadow-background-color) -10%, transparent 100%);
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
.entry-cover-container {    
    min-height: 100%;
    display: flex;
    justify-content: center;
}
</style>