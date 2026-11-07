<script>
    import { onMount, tick } from 'svelte';
    import { initApp } from '../src/scripts/app';
    import { css } from '../src/scripts/utils';
    import { main } from '../../modules/bridge/renderer';
    import { setupCrashlog } from '../../modules/crashlog/renderer';
	import VirtualGrid from './VirtualGrid.svelte';
    import SpatialNavigation from './SpatialNavigation.svelte';
    import Menubar from './Menubar.svelte';
    import Dialog from './Dialog.svelte'

    const transparentImage = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVQYV2NgYAAAAAMAAWgmWQ0AAAAASUVORK5CYII=';

    // Initialize with safe defaults to prevent context issues
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

    // $state variables are already initialized with default values    
    let container = $state(document.documentElement);

    let selectedIndex = $state(0);
    
    let lastRange = null;
    let spatialNavigation = $state(null);
    let virtualGrid = $state(null);
    let menubar = $state(null);
    let dialog;

    // Billboard (hero) mirrors the focused entry — it is purely presentational and
    // never participates in SpatialNavigation, so keyboard/remote focus is unchanged.
    const onHome = $derived(!path);
    const focusedItem = $derived(items[selectedIndex] || null);
    // Some icons are Font Awesome class names ("fas fa-plus") instead of image URLs.
    // Those can't be used as artwork, so the billboard falls back to the text title.
    const focusedArt = $derived((() => {
        const url = (focusedItem && icons[focusedItem.path]?.url) || '';
        return (url && !/\s/.test(url) && !/^fa[slrbd]?-/i.test(url)) ? url : '';
    })());
    const focusedIs2x = $derived(!!focusedItem?.class?.includes('entry-2x'));
    // Entries without artwork (recommendations, placeholders, channels without a
    // logo) still paint the billboard: it falls back to the app logo instead of
    // leaving the hero with an empty ("none") background.
    const defaultHeroArt = './assets/images/default_icon_white.png';
    const heroBackdropArt = $derived(focusedArt || defaultHeroArt);
    // Billboard badge: playable entries (channels, streams, meta entries) keep the
    // play glyph, anything else shows its own icon (e.g. "fas fa-fire" for trending).
    const focusedMetaIcon = $derived((() => {
        const item = focusedItem;
        if (!item) return 'fas fa-play';
        const fa = String(item.fa || '').trim();
        const playable = !!(item.isChannel || item.programme ||
            (item.class && String(item.class).includes('entry-meta-stream')) ||
            (typeof item.url == 'string' && (/^mega:\/\//i.test(item.url) || /mediaType=live/i.test(item.url))));
        if (!playable && /(^|\s)fa-[\w-]+/.test(fa)) {
            return fa;
        }
        return 'fas fa-play';
    })());
    // The badge is already a circle, so a circular glyph inside it draws a circle
    // within a circle ("fa-play-circle"). Any "-circle" is dropped from the icon
    // that lands in the badge; the entry glyph itself stays untouched.
    function circleFreeIcon(icon) {
        return String(icon || '')
            .trim()
            .replace(/(^|\s)fa-([\w-]*?)-circle(?=\s|$)/g, '$1fa-$2')
            .replace(/(^|\s)fa-circle-([\w-]+)/g, '$1fa-$2');
    }
    const heroBadgeIcon = $derived(circleFreeIcon(focusedMetaIcon));
    const focusedMeta = $derived((() => {
        let text = [focusedItem?.details, main?.menu?.maskValue?.(focusedItem?.value, focusedItem?.mask)].filter(v => v).join(' &middot; ');
        // The badge already renders the entry glyph, so an icon opening the details
        // ("<i class='fas fa-play-circle'></i> Ao Vivo · ...") would duplicate it.
        const badgeGlyph = (focusedMetaIcon.match(/fa-[\w-]+/) || [''])[0];
        if (!text || !badgeGlyph) {
            return text;
        }
        let leading;
        while ((leading = text.match(/^\s*<i\b[^>]*>\s*<\/i>/))) {
            const glyph = (leading[0].match(/fa-[\w-]+/) || [''])[0];
            if (!glyph || !(glyph.includes(badgeGlyph) || badgeGlyph.includes(glyph))) break;
            text = text.slice(leading[0].length);
        }
        return text.trim();
    })());
    const gridColumns = $derived(Math.max(1, (main?.menu?.gridLayoutX || viewSize.x || 1)));
    const focusedRow = $derived(gridColumns ? Math.floor(selectedIndex / gridColumns) : 0);
    function rowOf(item) {
        return Math.floor((item?.tabindex || 0) / (gridColumns || 1));
    }

    // The backend knows whether an artwork is opaque only after it is fetched, which usually
    // happens after the entries are prepared; deriving the cover state from the reactive icon
    // map makes the entries stretch as soon as the artwork arrives, on the very first visit.
    function isCover(item) {
        if (!item || item.side) return false;
        const icon = icons && icons[item.path];
        if (icon && icon.cover) {
            return !!(main?.config?.['stretch-logos'] || item.class?.includes('entry-force-cover'));
        }
        return !!item.cover;
    }

    function wrapperClass(item) {
        const base = (item?.wrapperClass || '').replace(' entry-cover-active', '');
        return isCover(item) ? base + ' entry-cover-active' : base;
    }

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
                    return main?.menu?.isVisible?.() && !main?.menu?.inSideMenu?.() && !dialog?.inDialog?.()
                },
                default: true,
                overScrollAction: (direction, e) => {
                    if (direction == 'up' || direction == 'down') {
                        let playing = main?.menu?.inPlayer?.()
                        if (!playing) {
                            /*
                            // Disabled for now because it is too aggressive and can cause the menu to jump around unexpectedly.
                            let n, i = main?.menu?.selectedIndex || 0
                            const x = main?.menu?.gridLayoutX || 0, container = main?.menu?.scrollContainer
                            // Ensure valid scrollTop calculation
                            if (container) {
                                const maxScrollTop = Math.max(0, container.scrollHeight - container.clientHeight);
                                const top = direction == 'up' ? 0 : maxScrollTop;
                                container.scrollTop = top
                            }
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
                            if (main?.menu?.emit) {
                                main.menu.emit('focus-index', n)
                                main.menu.emit('x-select', null)
                            }
                            */
                            return true
                        } else if(direction == 'up') {
                            main?.menu?.showWhilePlaying?.(false)
                        }
                    } else if(direction == 'left' && !main?.menu?.inSideMenu?.() && !dialog?.inDialog?.()) {
                        main?.menu?.sideMenu?.(true)
                        return true
                    }
                }
            },
            {
                name: 'nav-menu',
                selector: 'body.side-menu #menu nav a',
                condition: () => {
                    return main?.menu?.inSideMenu?.() && !dialog?.inDialog?.() && main?.menu?.isVisible?.()
                },
                overScrollAction: (direction, e) => {
                    if (direction == 'up' || direction == 'down') {
                        return true // disable vertical default overscroll behavior when in side menu
                        let playing = main?.menu?.inPlayer?.()
                        if (!playing) {
                            const entryNavs = main?.menu?.container?.querySelectorAll?.('entry-nav') || [];
                            const n = direction == 'down' ? entryNavs[0] : entryNavs[entryNavs.length - 1];
                            spatialNavigation.focus(n)
                            return true
                        } else if(direction == 'up' || direction == 'left') {
                            main?.menu?.showWhilePlaying?.(false)
                        }
                    } else if(direction == 'right') {
                        main?.menu?.sideMenu?.(false)
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
                    return main?.menu?.inPlayer?.() && !dialog?.inDialog?.() && !main?.menu?.isVisible?.()
                },
                overScrollAction: direction => {
                    if (direction == 'down') {
                        if (main?.idle?.activeTime?.() > 1) { // was idle, ignore initial focus on player
                            main?.menu?.showWhilePlaying?.(true)
                        } else {
                            main?.menu?.reset?.()                            
                        }
                    } else if (direction == 'up') {
                        if (main?.idle?.activeTime?.() > 1) { // was idle, ignore initial focus on player
                            if (main?.streamer?.seekbarFocus?.()) {
                                main?.menu?.reset?.()
                                main?.idle?.start?.()
                                main?.idle?.lock?.(1)
                            } else {
                                main?.streamer?.seekbarFocus?.(true)
                            }
                        } else {
                            main?.menu?.reset?.()
                        }
                    }
                    return true
                }
            }
        ]).forEach(spatialNavigation.addLayout.bind(spatialNavigation))
    }

    function focusElement(element) {
        if (main?.menu?.sideMenuTransitioning) return
        spatialNavigation.focus(element)
    }

    function itemFocusCallback({ index, element }) {
        if (selectedIndex == index) return;
        selectedIndex = index;
        if (main?.menu) {
            main.menu.selectedElement = element;
            main.menu.selectedElementX = element;
            main.menu.selectedIndex = index;
            main.menu.emit('select', element);
        }
        menubar.setIndex(index);
    }

    function itemXFocusCallback({ index, element }) {
        if (main?.menu) {
            main.menu.selectedElementX = element;
            main.menu.emit('x-select', element);
        }
    }

    function itemNavigateCallback(element) {
        if (element && main?.menu) {
            const key = main.menu.getKey?.(element);
            if (key == main.menu.lastSelectedKey) return;
            main.menu.lastSelectedKey = key;
            main.menu.sounds?.play?.('click-in', {volume: 30})
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
        if (!itemReference || !itemReference.offsetWidth) return 100; // fallback
        if (!row) return itemReference.offsetWidth;
        if (row?.class?.includes('entry-2x') && window.innerWidth > window.innerHeight) {
            return itemReference.offsetWidth * 2;
        }
        return itemReference.offsetWidth;
    }

    function itemHeight(row, index) {
        if (!itemReference || !itemReference.offsetHeight) return 100; // fallback
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
                        // Ensure scrollTop is valid before setting it
                        const validScrollTop = isFinite(scrollTop) && scrollTop >= 0 ? scrollTop : 0;
                        if (main?.menu?.scrollContainer) {
                            main.menu.scrollContainer.scrollTop = validScrollTop
                        }
                    }
                    spatialNavigation.focusIndex(selectedIndex)
                }
                if (main?.menu) {
                    main.menu.navigation = spatialNavigation;
                    main.menu.dialogs = dialog;
                    // "Back to top" must go through the grid: scrolling the viewport before the
                    // first rows are rendered lets the mandatory scroll-snap pull it back down.
                    main.menu.scrollToTop = async () => {
                        const done = await virtualGrid?.scrollToIndex?.(0)
                        if (done === false) {
                            main.menu.scrollTop(0, false, true)
                        }
                    };
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
                    main.menu.on('side-menu', async () => {
                        // The sidebar changes the grid viewport and card sizes, so the
                        // virtual rows must be measured again after the layout settles.
                        await tick();
                        refresh();
                    });
                    main.menu.on('focus', element => {
                        spatialNavigation.focus(element)
                    });
                    container = main.menu.scrollContainer;
                }
                setupNavigation();
            });
        });
    });

    $effect(() => {
        if (range && typeof range.start === 'number' && typeof range.end === 'number') {
            if (!lastRange || lastRange.start != range.start || lastRange.end != range.end) {
                lastRange = {start: range.start, end: range.end};
                if (main && main.menu) {
                    main.emit('menu-update-range', lastRange, main.menu.path)
                }
            }
        }
    });
</script>
<div id="main">
    {#if focusedItem && onHome}
    <div id="menu-hero" aria-hidden="true">
        <div class="hero-backdrop" class:hero-backdrop-default={!focusedArt} style:background-image={`url("${heroBackdropArt}")`}></div>
        <div class="hero-scrim"></div>
        <div class="hero-body">
            {#if focusedArt}
            <div class="hero-art"><img src="{focusedArt}" alt="" draggable="false" /></div>
            {/if}
            <div class="hero-info">
                <div class="hero-title">{@html focusedItem.rawname || focusedItem.name}</div>
                <div class="hero-meta">
                    <span class="hero-play"><i class="{heroBadgeIcon}"></i></span>
                    {#if focusedMeta}
                    <span class="hero-meta-text">{@html focusedMeta}</span>
                    {/if}
                </div>
            </div>
        </div>
    </div>
    {/if}
    <a href="#close-menu" aria-label="{lang.CLOSE}" title="{lang.CLOSE}" id="menu-playing-close">
        <div>
            <i class="fas fa-times-circle"></i>
        </div>
    </a>
    <button id="nav-toggle" type="button" aria-label="{lang.MENU || 'Menu'}" title="{lang.MENU || 'Menu'}" tabindex="-1">
        <i class="fas fa-bars" aria-hidden="true"></i>
    </button>
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
                    <a href="{e.url}" tabindex="{e.tabindex}" class="entry entry-nav" data-type="{e.type}" data-path="{e.path}" key="{e.key}" aria-label="{e.name}" data-original-icon="{e.originalIcon}" data-question="{e.question}" draggable="false">
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
            </nav>
        </div>
        <div class="content-out">
            <content role="region" onmousemove={(event) => main?.menu?.closeOnHover?.(event)}>
                <VirtualGrid width="var(--menu-width)" height="var(--menu-height)" items={items || []} let:item itemWidth={itemWidth} itemHeight={itemHeight} bind:this={virtualGrid} bind:range bind:isTop bind:isBottom bind:refresh>
                    {#snippet children(item)}
                    <a href="{item.url}" tabindex="{item.tabindex}" class="{item.class} {selectedIndex == item.tabindex ? 'selected' : ''} {rowOf(item) === focusedRow ? 'focus-row' : ''}" title="{item.name}" aria-label="{item.name}" 
                        data-type="{item.type}" data-path="{item.path}" key="{item.key}"  draggable="false" 
                        data-range-start="{item.range ? item.range.start : 0}" data-range-end="{item.range ? item.range.end : 100}" data-range-step="{item.range ? item.range.step || 1 : 1}" 
                        data-mask="{item.mask}" data-original-icon="{item.originalIcon}" data-question="{item.question}" 
                        style="order: {item.tabindex};" onmouseenter={(event) => focusElement(event.target)}
                        >
                        <span class="{wrapperClass(item)}">
                            {#if isCover(item) && icons && icons[item.path] && icons[item.path].url}
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
                                <span class="entry-details">{@html [item.details, main?.menu?.maskValue?.(item.value, item.mask)].filter(v => v).join(' &middot; ')}</span>
                            </span>
                            <span class="entry-icon-image">
                                {#if (!icons || !icons[item.path] || item.type == 'back' || (icons[item.path].url && icons[item.path].url.startsWith('fa')))}
                                    <i class="{item.fa}" style="{item.faStyle||''}" aria-hidden="true"></i>
                                {:else}
                                    {#if !isCover(item) && icons && icons[item.path] && icons[item.path].url}
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
            {#if path !== undefined && icons !== undefined}
            <Menubar path={path || ''} icons={icons || {}} bind:this={menubar}></Menubar>
            {/if}
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
    transition: transform var(--menu-fx-nav-duration) ease-in-out 0s, top var(--menu-fx-nav-duration) ease-in-out 0s;
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
.side-menu-out {
    position: fixed;
    top: 0;
    left: 0;
    z-index: 3;
    display: flex;
    width: var(--nav-width);
    height: var(--menu-height);
    padding-right: var(--padding-quarter); /* bugfix: avoid a white vertical line on menu-playing */
    background: linear-gradient(90deg, rgba(11, 11, 14, 0.995) 0%, rgba(11, 11, 14, 0.99) 88%, rgba(11, 11, 14, 0.86) 96%, rgba(11, 11, 14, 0.62) 100%);
    -webkit-backdrop-filter: blur(10px);
    backdrop-filter: blur(10px);
    transform: translateX(-100%);
    transition: transform var(--menu-fx-nav-duration) ease-in-out 0s, box-shadow var(--menu-fx-nav-duration) ease-in-out 0s;
}
body.side-menu .side-menu-out {
    transform: none;
    box-shadow: 0.4vmax 0 4vmax rgba(0, 0, 0, 0.55);
}
body.side-menu-instant .side-menu-out {
    transition: none;
}
body.video:not(.menu-playing) .side-menu-out {
    display: none;
}
body.video:not(.menu-playing) #menu {
    top: 100vh;
}
#nav-toggle {
    position: fixed;
    top: 50%;
    left: 0;
    z-index: 4;
    transform: translateY(-50%);
    display: flex;
    /* Touch devices get a proper tap target; on desktop the pill stays compact. */
    width: 3.6vmin;
    height: 5.4vmin;
    padding: 0;
    margin: 0;
    align-items: center;
    justify-content: center;
    border: 1px solid var(--nf-line);
    border-left: 0;
    border-radius: 0 999px 999px 0;
    background: rgba(15, 15, 19, 0.92);
    color: var(--nf-text);
    font-size: 1.9vmin;
    line-height: 1;
    cursor: pointer;
    opacity: 0.8;
    transition: opacity 0.15s ease-out 0s, background-color 0.15s ease-out 0s;
}
#nav-toggle:hover {
    opacity: 1;
    background: rgba(30, 30, 36, 0.98);
}
#nav-toggle i {
    margin-right: var(--menu-padding);
}
@media (pointer: coarse) {
    /* Finger-friendly target: a ~3.6vmin pill is only ~14px wide on a phone,
       far below the 44px minimum touch size, so taps landed on the grid behind. */
    #nav-toggle {
        width: max(46px, 3.6vmin);
        height: max(58px, 5.4vmin);
        font-size: max(18px, 1.9vmin);
        opacity: 0.94;
        touch-action: manipulation;
        -webkit-tap-highlight-color: transparent;
    }
}
body.side-menu #nav-toggle,
body.omni #nav-toggle,
body.dialog #nav-toggle,
body.video #nav-toggle {
    opacity: 0;
    pointer-events: none;
}
body.video #menubar {
    display: none;
}
#menu content {
    width: 100%;
    display: flex;
    flex-basis: 100%;
    clear: both;
}
body.omni div#background {
	background: var(--shadow-background-color) !important;
}
body.omni content {
    opacity: var(--opacity-level-2);    
}
#menu .menu-omni {
    position: fixed;
    left: 0;
    top: -30vh;
    background: linear-gradient(to bottom, var(--background-color) -50%, var(--background-color) 36%, var(--shadow-background-color) 77.5%, transparent 100%);
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
    transition: top 0.15s ease-in 0s;
}
body.omni .menu-omni {
    top: 0 !important;
}
body.video.menu-playing #menu .menu-omni {
    background: linear-gradient(to bottom, var(--shadow-background-color) -50%, #000 37%, var(--shadow-background-color) 77.5%, transparent 100%) !important;
}
#menu .menu-omni > span {
    background: rgba(255, 255, 255, 0.08);
    border: 1px solid var(--nf-line);
    border-radius: 999px;
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
    background: transparent;
    border-top-left-radius: var(--radius);
    border-bottom-left-radius: var(--radius);
    max-height: var(--menu-height);    
    scroll-snap-type: y mandatory;
    overflow: hidden auto;
}
body.side-menu svelte-virtual-grid-contents a .entry-wrapper span, body.side-menu svelte-virtual-grid-contents a .entry-cover-container {
    opacity: 0.5;
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
    line-height: 140%; 
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
    background: transparent;
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
    border: 1px solid var(--nf-line);
    background: linear-gradient(180deg, var(--nf-surface) 0%, var(--nf-surface-2) 100%);
    transition: transform 0.1s ease-in;
    width: 98%;
    height: 96%;
}
body:not(.portrait) #menu svelte-virtual-grid-contents a.entry-2x span.entry-wrapper {
    width: 98.75%;
}
#menu a.selected span.entry-wrapper {
    border-color: var(--nf-accent);
    background: linear-gradient(to top, rgba(150, 150, 150, 0.5) 0%, rgba(150, 150, 150, 0.75) 75%, rgba(150, 150, 150, 1) 100%);
    box-shadow: 0 0 0 2px var(--nf-accent), 0 1vmin 2.5vmin rgba(0, 0, 0, 0.85), 0 0 3.5vmin var(--nf-accent-soft);
    z-index: 0;
}
svelte-virtual-grid-contents a.selected {
    overflow: visible !important;
}
svelte-virtual-grid-contents a.selected > span {
    transform: scale(1.06);
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
    top: -10vh;
    z-index: 1;
    transition: top var(--menu-fx-nav-duration) ease-in-out 0s;
}
body.video.menu-playing #menu-playing-close {
    top: calc(2 * var(--padding));
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
    background: var(--nf-accent);
}
span.entry-status-flag-failure {
    background: var(--nf-danger);
}
.entry-cover-container {    
    min-height: 100%;
    display: flex;
    justify-content: center;
}
/* ------------------------------------------------------------------
   Netflix-like restyle (keeps the virtual grid + SpatialNavigation
   untouched, only the visual layer changes).
   The theme module injects !important rules based on the user theme,
   so those overrides need matching specificity + !important.
------------------------------------------------------------------ */
html:not(.curtains-closed) body:not(.video) div#background > div {
    background: radial-gradient(135% 120% at 78% -12%, rgba(139, 92, 246, 0.16) 0%, rgba(20, 20, 20, 0.9) 42%, #0a0a0a 100%) !important;
}
html:not(.curtains-closed) body:not(.video) div#background {
    filter: brightness(0.4) saturate(0.8);
}
html:not(.curtains-closed) body.omni div#background {
    filter: none;
    background: var(--nf-black) !important;
}
html:not(.curtains-closed) body.omni div#background > div {
    background: var(--nf-black) !important;
}
#menu .menu-omni {
    background: linear-gradient(to bottom, rgba(0, 0, 0, 0.97) -50%, rgba(0, 0, 0, 0.94) 36%, rgba(0, 0, 0, 0.55) 77.5%, transparent 100%);
}
body #menu svelte-virtual-grid-contents a span.entry-wrapper {
    background: linear-gradient(180deg, var(--nf-surface) 0%, var(--nf-surface-2) 100%) !important;
    border: 1px solid var(--nf-line) !important;
}
/* the grid keeps its own scrollbar, which breaks the cinematic look */
body #menu content svelte-virtual-grid-viewport {
    scrollbar-width: none;
}
body #menu content svelte-virtual-grid-viewport::-webkit-scrollbar {
    width: 0;
    height: 0;
}
body #menu content a.selected span.entry-wrapper, body #menu nav a.selected .entry-wrapper {
    border: 1px solid var(--nf-accent) !important;
}
body #menu content a.selected span.entry-wrapper {
    box-shadow: 0 0 0 1px var(--nf-accent-soft), 0 1.2vmax 2.4vmax rgba(0, 0, 0, 0.55);
}
#menu content a:not(.selected):hover span.entry-wrapper {
    border-color: rgba(255, 255, 255, 0.16) !important;
}
#menu .menu-omni input, #menu .menu-omni i, #menu .menu-omni input::-webkit-input-placeholder {
    color: var(--nf-text) !important;
    text-shadow: none;
    font-weight: 500;
}
#menu .menu-omni.selected > span {
    background: rgba(255, 255, 255, 0.14) !important;
    border-color: var(--nf-accent);
    box-shadow: 0 0 0 2px var(--nf-accent-soft), 0 0 3vmin rgba(0, 0, 0, 0.6);
}
#menu .menu-omni.selected > span input, #menu .menu-omni.selected > span i, #menu .menu-omni.selected > span input::-webkit-input-placeholder {
    color: #ffffff !important;
}
#menu .menu-omni input::-webkit-input-placeholder {
    color: var(--nf-text-dim) !important;
}
#menu nav .entry-wrapper {
    position: relative;
    padding: 0 calc(var(--padding) * 1.25);
    justify-content: flex-start !important;
    font-weight: 600;
    letter-spacing: 0.01em;
    color: var(--nf-text-dim) !important;
    border-radius: var(--nf-radius);
    transition: background 0.15s ease-out 0s, color 0.15s ease-out 0s, box-shadow 0.15s ease-out 0s;
}
body #menu nav a .entry-wrapper {
    background: rgba(255, 255, 255, 0.035) !important;
    border: 1px solid transparent !important;
}
body #menu nav a:not(.selected):hover .entry-wrapper {
    background: rgba(255, 255, 255, 0.09) !important;
}
body #menu nav a.selected .entry-wrapper {
    background: linear-gradient(90deg, rgba(139, 92, 246, 0.55) 0%, rgba(139, 92, 246, 0.06) 100%) !important;
    border: 1px solid rgba(139, 92, 246, 0.7) !important;
    color: #ffffff !important;
    box-shadow: inset 3px 0 0 var(--nf-accent-bright), 0 0 2.5vmin rgba(139, 92, 246, 0.24);
}
body #menu nav a.selected .entry-wrapper > i, body #menu nav a.selected .entry-wrapper .fa {
    color: #ffffff !important;
}
#menu nav a .entry-wrapper i, #menu nav a .entry-wrapper .fa, #menu nav a .entry-wrapper .fas {
    width: 1.5em;
    text-align: center;
    margin-right: var(--padding-half);
}
#menu-playing-close > div {
    background: rgba(0, 0, 0, 0.55);
    border-radius: var(--nf-radius);
    padding: 0 var(--padding);
}
#menu-playing-close.selected > div {
    background: var(--nf-accent);
}
#menu-playing-close.selected > div > i {
    color: #ffffff !important;
}
body:not(.portrait) #menu content a span.entry-data-in {
    top: 0 !important;
    left: 0 !important;
    right: 0 !important;
    bottom: 0 !important;
    width: 100% !important;
    height: auto !important;
    box-sizing: border-box;
    display: flex !important;
    flex-direction: column;
    justify-content: flex-end;
    align-items: flex-start;
    text-align: left;
    padding: 0 calc(var(--padding) * 1.5) calc(var(--padding) * 0.9) calc(var(--padding) * 1.5);
    background: linear-gradient(to top, rgba(6, 6, 9, 0.95) 0%, rgba(6, 6, 9, 0.8) 16%, rgba(6, 6, 9, 0.4) 38%, rgba(6, 6, 9, 0.08) 58%, rgba(6, 6, 9, 0) 72%);
}
body:not(.portrait) #menu content a span.entry-name,
body:not(.portrait) #menu content a span.entry-details {
    text-align: left !important;
    -webkit-box-pack: start !important;
    width: 100%;
}
body:not(.portrait) #menu content a .entry-icon-image {
    top: 3% !important;
    bottom: auto !important;
    left: 8% !important;
    width: 84% !important;
    height: 62% !important;
}
body:not(.portrait) #menu content a.entry-2x .entry-icon-image {
    left: 6% !important;
    width: 88% !important;
    height: 66% !important;
}
body:not(.portrait) #menu content a .entry-icon-image i {
    font-size: calc(var(--menu-entry-name-font-size) * 3.6) !important;
}
body:not(.portrait) #menu content a span.entry-name {
    font-size: calc(var(--menu-entry-name-font-size) * 1.02);
}
#menu content a span.entry-name {
    font-weight: 600;
    letter-spacing: 0.015em;
    text-shadow: 0 1px 2px rgba(0, 0, 0, 0.75);
}
#menu content a span.entry-details {
    color: var(--nf-text-dim);
}
#menu content a.selected span.entry-name {
    color: #ffffff;
}
body:not(.portrait) #menu content a.selected {
    overflow: visible;
    z-index: 3;
}
body:not(.portrait) #menu content a {
    transition: transform 0.16s ease-out 0s, opacity 0.22s ease-out 0s;
}
body:not(.portrait) #menu content a.selected {
    transform: scale(var(--nf-focus-scale));
}
body:not(.portrait) #menu content a:hover span.entry-icon-image,
#menu content a.selected span.entry-icon-image {
    transform: scale(1.03);
    transition: transform 0.2s ease-out 0s;
}
/* Netflix-style row emphasis: only the row that holds the focus stays fully lit */
body.home:not(.portrait) #menu content a:not(.focus-row) {
    opacity: 0.82;
}
body.home:not(.portrait) #menu content a:not(.focus-row):hover {
    opacity: 0.85;
}
div#arrow > div > * {
    color: var(--nf-text-dim);
}
div#arrow > div > *:hover {
    color: #ffffff;
}
body.omni #nav-toggle,
body.dialog #nav-toggle {
    opacity: 0;
    pointer-events: none;
}
#menu .side-menu-out nav {
    margin-left: 0;
    padding-left: calc(var(--padding) * 1.25);
    border-radius: 0;
    background: transparent;
    -webkit-backdrop-filter: none;
    backdrop-filter: none;
    scrollbar-width: thin;
    scrollbar-color: rgba(255, 255, 255, 0.18) transparent;
}
#menu .side-menu-out nav::-webkit-scrollbar {
    width: 4px;
}
#menu .side-menu-out nav::-webkit-scrollbar-thumb {
    background: rgba(255, 255, 255, 0.16);
    border-radius: 999px;
}
#menu .side-menu-out nav::-webkit-scrollbar-track {
    background: transparent;
}

/*------------------------------------------------------------------
   Billboard (hero) + cinematic band on the home screen.
   The hero is decorative (aria-hidden) and sits *behind* the grid,
   so it never takes part in SpatialNavigation. The grid keeps all of
   its rows fully reachable: the viewport is shortened by exactly two
   card rows, which are the rows the hero frees up.
------------------------------------------------------------------ */
body:not(.portrait):not(.video) #menu content svelte-virtual-grid-viewport {
    height: calc(var(--menu-height) - 30px) !important;
}
/* Shrink the cards just enough for three whole rows to clear the menubar,
   so the last row of any grid is never cut in half. */
body:not(.portrait):not(.video) {
    --menu-entry-height: calc((var(--menu-height) - 30px) / 3);
}
body.home:not(.portrait):not(.video) #menu content svelte-virtual-grid-viewport {
    height: calc(var(--menu-entry-height) * 2) !important;
    margin-bottom: 30px;
    align-self: flex-end;
}
body.omni #menu-hero,
body.video #menu-hero,
body.portrait #menu-hero {
    opacity: 0;
    pointer-events: none;
}
/* The scroll hints would overlap the omni search field. */
body.omni div#arrow {
    opacity: 0;
}
/* On the home browse screen the billboard sits above the grid, so the top
   scroll hint starts right below it instead of floating over the artwork. */
body.home:not(.portrait):not(.video) div#arrow > div {
    padding-top: calc(var(--menu-height) - (var(--menu-entry-height) * 2) - (var(--padding-2x) * 3));
}
/* With the sidebar expanded the billboard would sit behind it, so it is
   dropped and the grid gets the full height back (Netflix browse behaviour). */
body.side-menu #menu-hero {
    pointer-events: none;
}
/* The grid behind the expanded sidebar keeps a readable dim instead of
   disappearing (Netflix dims the browse area while the menu is open). */
body.side-menu #menu svelte-virtual-grid-contents a .entry-wrapper span,
body.side-menu #menu svelte-virtual-grid-contents a .entry-cover-container {
    opacity: 0.5;
}
#menu-hero {
    --nf-hero-h: calc(var(--menu-height) - (var(--menu-entry-height) * 2));
    /* The grid sits at the bottom of the content area leaving this gap above the
       menubar. The hero backdrop may bleed into it, but the hero *content* has to
       be lifted by the same amount, otherwise the first card row covers (and the
       mask fades) the billboard artwork and footer. */
    --nf-hero-inset: 30px;
    --nf-hero-body-h: calc(var(--nf-hero-h) - var(--nf-hero-inset));
    position: fixed;
    top: 0;
    left: 0;
    width: 100vw;
    height: var(--nf-hero-h);
    overflow: hidden;
    pointer-events: none;
    transition: opacity 0.25s ease-out 0s;
    contain: strict;
    /* Fade the last 28px so the artwork dissolves into the grid instead of
       ending on a hard line. */
    -webkit-mask-image: linear-gradient(to bottom, #000 calc(100% - 28px), transparent 100%);
    mask-image: linear-gradient(to bottom, #000 calc(100% - 28px), transparent 100%);
}
#menu-hero .hero-backdrop {
    position: absolute;
    inset: -12% -6%;
    background-position: center 30%;
    background-size: cover;
    transform: scale(1.08);
    filter: blur(1vmax) brightness(0.45) saturate(1.15);
    opacity: 0.92;
    animation: nf-hero-in 0.5s ease-out 0s both;
}
/* Fallback artwork: the app logo, centred and without the blurred-cover
   treatment (it would just look like a smear when enlarged). */
#menu-hero .hero-backdrop.hero-backdrop-default {
    background-position: center 40%;
    background-size: 34vmin auto;
    background-repeat: no-repeat;
    filter: none;
    opacity: 0.28;
}
#menu-hero .hero-scrim {
    position: absolute;
    inset: 0;
    background:
        linear-gradient(to bottom, rgba(11, 11, 14, 0.92) 0%, rgba(11, 11, 14, 0.32) 22%, rgba(11, 11, 14, 0) 46%),
        linear-gradient(to top, rgba(11, 11, 14, 1) 0%, rgba(11, 11, 14, 0.86) 26%, rgba(11, 11, 14, 0.34) 68%, rgba(11, 11, 14, 0.12) 100%),
        linear-gradient(to right, rgba(11, 11, 14, 0.9) 0%, rgba(11, 11, 14, 0.46) 44%, rgba(11, 11, 14, 0.08) 76%);
}
#menu-hero .hero-body {
    position: absolute;
    left: calc(var(--padding) * 2.4);
    right: calc(var(--padding) * 2.4);
    bottom: calc(var(--nf-hero-inset) + (var(--padding) * 1.2));
    max-height: calc(var(--nf-hero-body-h) - (var(--padding) * 1.5));
    display: flex;
    flex-direction: row;
    align-items: flex-end;
    gap: calc(var(--padding) * 1.5);
    animation: nf-hero-in 0.4s ease-out 0s both;
}
#menu-hero .hero-info {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: calc(var(--padding) * 0.5);
    min-width: 0;
    flex: 1 1 auto;
    padding-bottom: calc(var(--padding) * 0.15);
}
#menu-hero .hero-art {
    display: flex;
    align-items: flex-end;
    height: calc(var(--nf-hero-h) * 0.66);
    max-width: 22%;
    min-width: 0;
    flex: 0 0 auto;
}
#menu-hero .hero-art img {
    max-width: 100%;
    max-height: 100%;
    object-fit: contain;
    object-position: left bottom;
    filter: drop-shadow(0 0.5vmax 1.4vmax rgba(0, 0, 0, 0.85));
}
#menu-hero .hero-title {
    font-size: calc(var(--menu-entry-name-font-size) * 2.9);
    line-height: 1.04;
    font-weight: 800;
    letter-spacing: -0.02em;
    color: #ffffff;
    text-shadow: 0 0.2vmax 1.6vmax rgba(0, 0, 0, 0.85);
    max-width: 68ch;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
}
#menu-hero .hero-title * {
    font-size: inherit !important;
    font-weight: inherit !important;
    color: inherit !important;
}
#menu-hero .hero-meta {
    display: flex;
    align-items: center;
    gap: calc(var(--padding) * 0.8);
    font-size: var(--menu-entry-name-font-size);
    color: #d8d8d8;
    text-shadow: 0 1px 2px rgba(0, 0, 0, 0.8);
}
#menu-hero .hero-meta-text:empty {
    display: none;
}
#menu-hero .hero-play {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: calc(var(--menu-entry-name-font-size) * 1.9);
    height: calc(var(--menu-entry-name-font-size) * 1.9);
    border-radius: 50%;
    background: var(--nf-accent);
    color: #ffffff;
    font-size: calc(var(--menu-entry-name-font-size) * 0.72);
    box-shadow: 0 0.4vmax 1.6vmax rgba(0, 0, 0, 0.6);
    text-shadow: none;
    flex: 0 0 auto;
}
@keyframes nf-hero-in {
    from {
        opacity: 0;
    }
    to {
        opacity: 1;
    }
}
/* Netflix-style focus: white ring + purple halo + elevation */
body:not(.portrait) #menu content a.selected > span {
    transform: none !important;
}
body:not(.portrait) #menu content a.selected span.entry-wrapper {
    border-color: #ffffff !important;
    box-shadow:
        0 0 0 2px rgba(255, 255, 255, 0.95),
        0 1.4vmax 2.8vmax rgba(0, 0, 0, 0.68),
        0 0 3.4vmax rgba(139, 92, 246, 0.32) !important;
}
body:not(.portrait) #menu content a.selected span.entry-name {
    color: #ffffff !important;
}
body #menu nav a, body #menu .menu-omni {
    transition: transform 0.16s ease-out 0s;
}
@media (prefers-reduced-motion: reduce) {
    body:not(.portrait) #menu content a,
    body:not(.portrait) #menu content a:hover span.entry-icon-image,
    #menu content a.selected span.entry-icon-image,
    #menu-hero,
    body #menu nav a,
    body #menu .menu-omni {
        transition: none !important;
    }
    body:not(.portrait) #menu content a.selected {
        transform: none;
    }
    #menu-hero .hero-backdrop, #menu-hero .hero-body {
        animation: none;
    }
}
</style>