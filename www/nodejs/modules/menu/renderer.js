import { ESMitter as EventEmitter } from 'esm-itter'
import sounds from './sound'
import { main } from '../bridge/renderer'

class MenuBase extends EventEmitter {
    constructor(container) {
        super()
        this.sounds = sounds
        this.debug = false
        this.path = ''
        this.container = container
        this.wrap = container.querySelector('svelte-virtual-grid-contents')
        this.scrollContainer = this.wrap.parentNode
        container.addEventListener('click', event => {
            event.preventDefault()
            const a = event.target.closest('a')
            if (a && !a.classList.contains('entry-ignore')) {
                const fromSideMenu = event.target.closest('nav') !== null;
                if (fromSideMenu) {
                    this.sideMenuPending = true
                }
                this.action(a)
            }
        })
        main.on('config', (_, c) => this.sounds.volume = c.volume)
        if (main.config && main.config['volume'] !== undefined) {
            this.sounds.volume = main.config['volume']
        }
    }
    buildElementFromHTML(code) {
        const wrap = document.createElement('span')
        wrap.innerHTML = code
        return wrap.firstElementChild
    }
    async readClipboard() {
        if (typeof(window.capacitor?.clipboard) === 'function') {
            const ret = await window.capacitor.clipboard()
            if (typeof(ret?.value) === 'string') {
                return ret.value
            }
        }
        return parent.electron.readClipboard()
    }
    async writeClipboard(text) {
        if (typeof(window.capacitor?.clipboard) === 'function') {
            await window.capacitor.clipboard({value: text})
        } else {
            parent.electron.writeClipboard(text)
        }
    }
}

class MenuIcons extends MenuBase {
    constructor(container) {
        super(container)
        this.icons = {'': {url: 'fas fa-home'}}
        this.defaultIcons = {
            'back': 'fas fa-chevron-left',
            'action': 'fas fa-cog',
            'slider': 'fas fa-cog',
            'input': 'fas fa-keyboard',
            'stream': 'fas fa-play-circle',
            'check': 'fas fa-toggle-off',
            'group': 'fas fa-box-open'
        }
        main.on('icon', data => {
            if (data.tabIndex == -1) return
            const fullPath = [data.path, data.name].filter(v => v).join('/')
            if (typeof(this.icons[fullPath]) == 'undefined') {
                this.icons[fullPath] = {}
            }
            let changed
            const isCover = !data.alpha
            if (!data.force) {
                if (this.icons[fullPath].cover === false && isCover) return
                if (this.icons[fullPath].cover === isCover) return
            }
            if (this.icons[fullPath].cover != isCover) {
                this.icons[fullPath].cover = isCover
                changed = true
            }
            if (this.icons[fullPath].url != data.url) {
                this.icons[fullPath].url = data.url
                changed = true
            }
            if (changed) this.emit('updated')
        })
    }
}

class MenuScrolling extends MenuIcons {
    constructor(container) {
        super(container)
        this.selectedIndex = 0
        const scrollEndTrigger = () => {
            if (this.isScrolling) {
                this.isScrolling = false
                this.scrollContainer.style.scrollSnapType = 'y mandatory'
            }
            if (this.lastScrollTop !== this.scrollContainer.scrollTop) {
                this.lastScrollTop = this.scrollContainer.scrollTop
                this.emit('scroll', this.scrollContainer.scrollTop)
            }
        }
        this.scrollendPolyfillElement(this.container)
        this.scrollendPolyfillElement(this.scrollContainer)
        for (const type of ['scrollend', 'resize']) {
            this.scrollContainer.addEventListener(type, scrollEndTrigger, {passive: true})
        }
        this.scrollContainer.addEventListener('scroll', () => {
            if (!this.isScrolling) {
                this.isScrolling = true
                this.scrollContainer.style.scrollSnapType = 'none'
            }
        })
        const resizeListener = () => this.resize()
        window.addEventListener('resize', resizeListener)
        screen.orientation?.addEventListener('change', resizeListener)
        setTimeout(resizeListener, 0)
    }
    setGrid(x, y, px, py) {
        this._gridLayoutX = x
        this._gridLayoutY = y
        this._gridLayoutPortraitX = px
        this._gridLayoutPortraitY = py
        this.resize()
    }
    resize(force) {
        if (force !== true && this.lastSize && this.lastSize.x == window.innerWidth && this.lastSize.y == window.innerHeight) return
        this.lastSize = {x: window.innerWidth, y: window.innerHeight}
        const portrait = (window.innerHeight > window.innerWidth)
        this.gridLayoutX = portrait ? this._gridLayoutPortraitX : this._gridLayoutX
        this.gridLayoutY = portrait ? this._gridLayoutPortraitY : this._gridLayoutY
        const wide = main.config['view-size'][portrait ? 'portrait' : 'landscape'].x >= 3
        const verticalLayout = main.config['view-size'][portrait ? 'portrait' : 'landscape'].x == 1
        document.body.classList[wide ? 'add' : 'remove']('menu-wide')
        document.body.classList[verticalLayout ? 'add' : 'remove']('portrait')
        this.sideMenuSync(true)
    }
    scrollTop(y, animate) {
        // Ensure y is a valid number
        if (typeof(y) == 'number' && isFinite(y) && y >= 0 && this.scrollContainer.scrollTop != y) {
            this.scrollContainer.scroll({
                top: y,
                left: 0,
                behavior: animate ? 'smooth' : 'instant'
            })
        }
        // Ensure returned value is valid
        const currentScrollTop = this.scrollContainer.scrollTop;
        return isFinite(currentScrollTop) && currentScrollTop >= 0 ? currentScrollTop : 0;
    }
    opposite(selected, items, direction) {
        let i, n = items.indexOf(selected), x = this.gridLayoutX
        switch(direction) {
            case 'down': i = n % x; break
            case 'up': 
                i = (Math.floor(items.length / x) * x) + (n % x)
                if (i >= items.length) i = ((Math.floor(items.length / x) - 1) * x) + (n % x)
                break
            case 'left': 
                i = n + (x - 1)
                if (i >= items.length) i = items.length - 1
                break
            case 'right': 
                i = n - (x - 1)
                if (i < 0) i = 0
                break
        }
        return items[i]
    }
    reset(force) {
        this.emit('reset', force)
    }
}

class MenuBBCode extends MenuScrolling {
    constructor(container) {
        super(container)
        this.funnyTextColors = ['#3F0', '#39F', '#8d45ff', '#ff02c9', '#e48610']
        this.bbCodeMap = {
            'b': fragment => fragment.substr(0, 2) == '[|' ? '</strong>' : '<strong>',
            'i': fragment => fragment.substr(0, 2) == '[|' ? '</i>' : '<i>',
            'alpha': fragment => fragment.substr(0, 2) == '[|' ? '</font>' : '<font style="color: var(--secondary-font-color); text-shadow: none;">',
            'color': (fragment, name) => {
                if (fragment.substr(0, 2) == '[|') return '</font>'
                let color = name.split(' ').slice(1).join(' ')
                return '<font style="color: '+ color +';">'
            }
        }
    }
    removeBBCode(text) {
        return text.replace(new RegExp('\\[\\|?([^\\]]*)\\]', 'g'), '')
    }
    parseBBCode(text) {
        if (typeof(this.replaceBBCodeFnPtr) == 'undefined') {
            this.replaceBBCodeRegex = new RegExp('\\[(fun|'+ Object.keys(this.bbCodeMap).join('|') +')')
            this.replaceBBCodeFnPtr = this.replaceBBCode.bind(this)
            this.replaceBBCodeFunnyTextFnPtr = this.replaceBBCodeFunnyText.bind(this)
        }
        if (text.match(this.replaceBBCodeRegex)) {
            text = text.replace(new RegExp('\\[fun\\]([^\\[]*)\\[\\|?fun\\]', 'gi'), this.replaceBBCodeFunnyTextFnPtr)
            return text.replace(new RegExp('\\[\\|?([^\\]]*)\\]', 'g'), this.replaceBBCodeFnPtr)
        }
        return text
    }
    replaceBBCode(fragment, name) {
        const tag = name.split(' ').shift().toLowerCase()
        return this.bbCodeMap[tag] ? this.bbCodeMap[tag](fragment, name) : fragment
    }
    replaceBBCodeFunnyText(fragment, name) {
        return this.makeFunnyText(name)
    }
    makeFunnyText(text) {
        if (text.includes('&') && text.includes(';')) {
            const wrap = document.createElement('span')
            wrap.innerHTML = text
            text = wrap.innerText
        }
        if (!main.config['kids-fun-titles']) return text
        const lettersPerColor = (text.length > 15 ? 3 : (text.length > 5 ? 2 : 1))
        const scales = [1, 0.9675, 0.925]
        const a = (this.funnyTextColors.length * lettersPerColor)
        return text.split('').map((chr, i) => {
            i--
            const scale = i < 2 ? 1 : scales[Math.floor(Math.random()*scales.length)]
            const oi = i
            const r = Math.floor(i / a)
            if (r) i -= r * a
            const j = Math.floor(i / lettersPerColor)
			if (chr == ' ') chr = '&nbsp;';
            return '<font class="funny-text" style="color: '+ (oi == -1 ? 'white' : this.funnyTextColors[j]) +';transform: scale('+ scale +');">'+chr+'</font>'
        }).join('')
    }
    maskValue(value, mask) {
        if (typeof(value) == 'boolean') {
            return main.lang[value ? 'ENABLED' : 'DISABLED'];
        }
        if (typeof(mask) == 'string' && mask.length) {
            if (mask == 'time') {
                return main.clock?.humanize(value, true) || '';
            }
            let maskedValue = value;
            if (maskedValue.length > 18) {
                maskedValue = maskedValue.slice(0, 15) +'...'
            }
            return mask.replace('{0}', maskedValue);
        }
        return '';
    }
}

class MenuPlayer extends MenuBBCode {
    constructor(container) {
        super(container)
    }
    inPlayer() {
        return typeof(streamer) != 'undefined' && streamer.active
    }
    isVisible(element, ignoreViewport) {
        if (element) {
            if (element.style.display === 'none' || element.style.visibility === 'hidden' || parseFloat(element.style.opacity) === 0) return false
            let parent = element.parentElement
            while (parent) {
                if (!parent || window.getComputedStyle(parent).visibility === 'hidden') return false
                if (parent === document.body) break
                parent = parent.parentElement
            }
            const rect = element.getBoundingClientRect()
            if (ignoreViewport !== true) {
                if (!element.parentElement) return false
                const parentElement = element.parentElement?.tagName == 'SVELTE-VIRTUAL-GRID-CONTENTS' ? element.parentElement.parentNode : element.parentElement
                if (!parentElement) return false
                const parentRect = parentElement.getBoundingClientRect()
                const intersectionLeft = Math.max(rect.left, parentRect.left)
                const intersectionRight = Math.min(rect.right, parentRect.right)
                const intersectionTop = Math.max(rect.top, parentRect.top)
                const intersectionBottom = Math.min(rect.bottom, parentRect.bottom)
                if (intersectionRight <= intersectionLeft || intersectionBottom <= intersectionTop) return false
                const intersectionArea = (intersectionRight - intersectionLeft) * (intersectionBottom - intersectionTop)
                const elementArea = rect.width * rect.height
                if (intersectionArea < 0.75 * elementArea) return false
            }
            return element.offsetParent !== null
        }
        return !this.inPlayer() || document.body.classList.contains('menu-playing')
    }
    showWhilePlaying(enable) {
        if (enable && document.body.classList.contains('video')) {
            if (!document.body.classList.contains('menu-playing')) {
                document.body.classList.add('menu-playing')
                this.emit('menu-playing', true)
            }
        } else {
            if (document.body.classList.contains('menu-playing')) {
                document.body.classList.remove('menu-playing')
                this.emit('menu-playing', false)
            }
        }
		this.sideMenu(false, 'instant')
    }
}

class MenuFx extends MenuPlayer {
    constructor(container) {
        super(container)
        this.fxNavTimer = 0
        this.on('before-navigate', (newPath, oldPath) => {
            if (typeof(oldPath) != 'string' || newPath.length >= oldPath.length) {
                this.fxNavIn()
            } else {
                this.fxNavOut()
            }
        })
        setTimeout(() => {
            this.container.parentNode.classList.add('effect-inflate-deflate-parent')
        })
    }
    fxNavIn() {
        if (!main.config['fx-nav-intensity']) return
        clearTimeout(this.fxNavTimer)
        if (this.container.classList.contains('effect-inflate')) {
            this.container.classList.remove('effect-inflate')
            setTimeout(() => this.fxNavIn(), 0)
        } else {
            this.container.style.transition = 'none'
            this.container.classList.remove('effect-deflate')
            this.container.classList.add('effect-inflate')
            this.fxNavTimer = setTimeout(() => this.container.classList.remove('effect-inflate'), 1500)
        }
    }
    fxNavOut() {
        if (!main.config['fx-nav-intensity']) return
        clearTimeout(this.fxNavTimer)
        if (this.container.classList.contains('effect-deflate')) {
            this.container.classList.remove('effect-deflate')
            setTimeout(() => this.fxNavOut(), 0)
        } else {
            this.container.style.transition = 'none'
            this.container.classList.remove('effect-inflate')
            this.container.classList.add('effect-deflate')
            this.fxNavTimer = setTimeout(() => this.container.classList.remove('effect-deflate'), 1500)
        }
    }
}

class MenuStatusFlags extends MenuFx {
    constructor(container) {
        super(container)
        this.statusFlags = {}
        this.on('changed', this.processStatusFlags.bind(this))
        main.on('stream-state-set', (url, flag) => flag && this.setStatusFlag(url, flag, false))
        main.on('stream-state-sync', data => {
            Object.keys(data).forEach(url => data[url] && this.setStatusFlag(url, data[url], true))
            this.processStatusFlags()
        })
    }
    setStatusFlag(url, flag, skipProcessing) {
        if (url && (typeof(this.statusFlags[url]) == 'undefined' || this.statusFlags[url] != flag)) {
            this.statusFlags[url] = flag
            if (skipProcessing !== true) this.processStatusFlags()
        }
    }
    statusAddHTML(e) {
        if (e.url && typeof(this.statusFlags[e.url]) != 'undefined') {
            let status = this.statusFlags[e.url], type = e.type || 'stream', cls = e.class || ''
            if (status && !cls.includes('skip-testing') && (type == 'stream' || cls.match(new RegExp('(allow-stream-state|entry-meta-stream)')))) {
                let content = '', cls = ''
                if (status == 'tune') {
                    content = '<i class="fas fa-layer-group"></i>'
                } else if (status == 'folder') {
                    content = '<i class="fas fa-box-open"></i>'
                } else if (status == 'waiting') {
                    content = '<i class="fas fa-clock"></i>'
                } else {
                    let watched = status.endsWith(',watched')
                    if (watched) status = status.substr(0, status.length - 8)
                    let txt = '', icon = watched ? 'fas fa-check' : ''
                    if (status == 'offline') {
                        if (!watched) icon = 'fas fa-times'
                        cls = 'entry-status-flag entry-status-flag-failure'
                    } else {
                        if (!watched) icon = 'fas fa-play'
                        cls = 'entry-status-flag entry-status-flag-success'
                        if (main.config['status-flags-type']) txt = ' '+ status
                    }
                    content = '<i class="'+ icon +'" aria-hidden="true"></i>'+ txt
                    if (main.config['status-flags-type']) content = ' '+ content +' '
                }
                e.statusFlagsClass = cls
                e.statusFlags = content
                const offline = status == 'offline'
                if (offline) {
                    if (!e.class || !e.class.includes('entry-disabled')) {
                        e.class = (e.class || '') +' entry-disabled'
                    }
                } else if (e.class && e.class.includes('entry-disabled')) {
                    e.class = e.class.replace(new RegExp('( |^)entry-disabled', 'g'), '')
                }
            }
        }
        return e
    }
    processStatusFlags() {
        this.currentEntries.map(e => this.statusAddHTML(e))
        this.emit('updated')
    }
}

class MenuNav extends MenuStatusFlags {
    constructor(container) {
        super(container)
        this.sideMenuWidthCache = null
        this.sideMenuSyncTimer = 0
        this.scrollendPolyfillElement(this.container)
        this.container.addEventListener('scrollend', () => this.sideMenuSync())
        screen.orientation?.addEventListener('change', () => setTimeout(() => this.sideMenuSync(true), 400))
        window.addEventListener('resize', () => this.sideMenuSync(true))
		this.on('before-navigate', () => this.sideMenu(false, 'instant'))
        this.sideMenu(false, 'instant')
    }
    
    destroy() {
        if (this.sideMenuSyncTimer) {
            clearTimeout(this.sideMenuSyncTimer);
            this.sideMenuSyncTimer = 0;
        }
        this.container.removeEventListener('scrollend', this.sideMenuSync);
        screen.orientation?.removeEventListener('change', this.sideMenuSync);
        window.removeEventListener('resize', this.sideMenuSync);
        this.removeAllListeners();
    }
    
    scrollendPolyfillElement(element) {
        if ('onscrollend' in window) return
        let isScrolling
        const dispatchScrollEndEvent = () => {
            const event = new CustomEvent('scrollend')
            element.dispatchEvent(event)
        }
        element.addEventListener('scroll', () => {
            window.clearTimeout(isScrolling)
            isScrolling = setTimeout(dispatchScrollEndEvent, 150)
        }, false)
    }
    inSideMenu(strict = false) {
        const w = this.getSideMenuWidth()
        const classList = document.body.classList
        const watching = classList.contains('video') && !classList.contains('menu-playing')
        if (watching) return false
        return strict ? this.container.scrollLeft < 10 : (this.container.scrollLeft <= (w / 2))
    }
    sideMenuSync(resized, inSideMenu) {
        if (resized === true) this.sideMenuWidthCache = null
        const c = typeof(inSideMenu) == 'boolean' ? inSideMenu : this.inSideMenu()
        const n = document.body.classList.contains('side-menu')
        if (c != n) {
            document.body.classList[c ? 'add' : 'remove']('side-menu')
            this.emit('side-menu', c)
        }
    }
    sideMenuTransition() {
        if (!this.sideMenuTransitionCache) {
            this.sideMenuTransitionCache = window.getComputedStyle(this.container).getPropertyValue('transition') || 
                'transform var(--menu-fx-nav-duration) ease-in-out 0s'
        }
        return this.sideMenuTransitionCache
    }
    sideMenu(enable, behavior = 'smooth') {
        const transition = this.sideMenuTransition()
        const left = enable ? 0 : this.getSideMenuWidth()
        if (left == Math.round(this.container.scrollLeft)) {
            this.sideMenuTransitioning = false
            return
        }
        this.sideMenuTransitioning = left
        this.container.style.transition = 'none'
        this.container.addEventListener(behavior == 'smooth' ? 'scrollend' : 'scroll', () => {
            this.container.style.transition = transition
            this.sideMenuTransitioning = false
        }, {once: true})
        if (behavior == 'smooth') {
            this.container.scroll({ top: 0, left, behavior })
        } else {
            this.container.scrollLeft = left
        }
    }
    getSideMenuWidth() {
        if (this.sideMenuWidthCache) return this.sideMenuWidthCache
        const l = document.createElement('div')
        l.style.visibility = 'hidden'
        l.style.boxSize = 'content-box'
        l.style.position = 'absolute'
        l.style.maxHeight = 'none'
        l.style.display = 'inline-block'
        l.style.height = 'var(--nav-width)'
        document.body.appendChild(l)
        this.sideMenuWidthCache = Math.ceil(l.clientHeight)
        document.body.removeChild(l)
        return this.sideMenuWidthCache
    }
}

export class Menu extends MenuNav {
    constructor(container) {
        console.log('🏗️ Menu constructor called with container:', container);
        super(container)
        this.dialogs = {}
        this.currentEntries = []
        console.log('🎯 Menu: Setting up event listeners');
        main.on('render', (entries, path, icon) => {
            console.log('📨 Menu: Received render event from main:', { entries, path, icon });
            this.render(entries, path, icon);
        })
        main.on('menu-select', (entries, path, icon) => {
            console.log('📨 Menu: Received menu-select event from main:', { entries, path, icon });
            this.setupSelect(entries, path, icon);
        })
        main.on('trigger', data => {
            this.get(data).forEach(e => e.click())
        })
        main.on('menu-busy', state => {
            this.busy = state !== false
            document.querySelector('.menu-busy').style.display = this.busy ? 'flex' : 'none'
            document.querySelector('.menu-time time').style.display = this.busy ? 'none' : 'flex'
            if (state) {
                for (const path of state) {
                    this.get({path}).forEach(e => e?.classList.add('entry-busy'))
                }
            } else {
                this.wrap.querySelectorAll('.entry-busy').forEach(e => e.classList.remove('entry-busy'))
            }
        })
    }
    get(data) {
        let ss = []
        if (data) {
            let ks = Object.keys(data)
            if (ks.length) {
                this.currentEntries.forEach((e, i) => {
                    if (ks.every(k => data[k] == e[k])) {
                        const element = this.wrap.querySelector(`[tabindex="${e.tabindex}"]`)
                        ss.push(element)
                    }
                })
            }
        }
        return ss
    }
    diffEntries(a, b) {
        let diff
        ['name', 'details', 'fa', 'type', 'prepend', 'class'].some(p => {
            if (a[p] != b[p]) {
                diff = p
                return true
            }
        })
        return diff
    }
    render(entries, path, icon) {
        if (!Array.isArray(entries)) {
            console.error('❌ Menu.render: entries is not an array!', entries);
            return;
        }        
        
        let prevPath = this.path, navigated = path !== this.path
        entries = entries.map(e => this.prepareEntry(e))
        let changed = this.applyCurrentEntries(entries)
        navigated && this.emit('before-navigate', path, this.path)
        this.path = path
        if (!changed) return
        this.emit('changed')
        this.emit('render', this.path, icon, prevPath)
        navigated && this.emit('navigate', path, this.path)
    }
    applyCurrentEntries(entries) {
        let changed = this.currentEntries.length != entries.length
        if (!changed) {
            changed = entries.some((e, i) => {
                if (!this.currentEntries[i]) {
                    console.log('🔄 Entry changed: missing current entry at index', i);
                    return true;
                }
                for (const k of Object.keys(e)) {
                    if (this.currentEntries[i][k] !== e[k]) return true
                }
            })
        }
        if (changed) this.currentEntries = entries
        return changed
    }
    async check(element) {
        await this.sounds.play('switch', {
            volume: 30,
            time: 250
        })
        const i = element.tabIndex
        const value = !element.querySelector('.fa-toggle-on')
        const path = element.dataset.path
        this.currentEntries[i].fa = 'fas fa-toggle-'+ (value ? 'on' : 'off')
        this.currentEntries[i].value = value
        main.emit('menu-check', path, value)
        this.emit('updated')
    }
    setupSelect(entries, path, fa) {
        if (!Array.isArray(entries)) return;
        let def, element
        try {
            element = this.wrap.querySelector('[data-path="'+ path +'"]')
            if (element) {
                const icon = element.querySelector('img')
                if (icon) {
                    const src = window.getComputedStyle(icon).getPropertyValue('background-image')
                    if (src) {
                        const match = src.match(new RegExp('url\\([\'"]*([^\\)\'"]*)', 'i'))
                        if (match) fa = match[1]
                    }
                }
                def = this.currentEntries[element.tabIndex]?.value
            }
        } catch (e) {
            console.error('Error setting up select', e);
        }
        if (!def) {
            def = entries.find(e => e.selected)?.id || entries[0]?.id
        }
        this.dialogs.select(path.split('/').pop(), entries, fa, def, ret => {
            if (ret) {
                const entry = entries.find(e => e.id == ret)
                if (entry) {
                    main.emit('menu-open', entry.path)
                }
                if (element && this.currentEntries[element.tabIndex] && element.title == this.currentEntries[element.tabIndex].name) {
                    this.currentEntries[element.tabIndex].value = ret
                }
            }
            this.lastSelectTriggerer && setTimeout(() => {
                this.emit('focus', this.lastSelectTriggerer)
                this.lastSelectTriggerer = null
            }, 50)
        })
    }
    setupSlider(element) {
        const path = element.getAttribute('data-path')
        const start = parseInt(element.getAttribute('data-range-start') || 0)
        const end = parseInt(element.getAttribute('data-range-end') || 100)
        const mask = element.getAttribute('data-mask')
        const def = Number(this.currentEntries[element.tabIndex]?.value) || 0
        const fa = element.getAttribute('data-original-icon') || ''
        const question = element.getAttribute('data-question') || element.getAttribute('title')
        const message = element.getAttribute('data-dialog-details')
        this.dialogs.slider(question, message, {start, end}, parseInt(def || 0), mask, value => {
            const i = element.tabIndex
            console.log('slider value', value);
            if (value !== false && value !== null) {
                main.emit('menu-input', path, value)
                if (this.currentEntries[i]) {
                    this.currentEntries[i].value = Number(value)
                    this.prepareEntry(this.currentEntries[i], i)
                }
                this.emit('updated')
            }
            setTimeout(() => this.emit('focus-index', i), 50)
        }, fa)
    }
    getKey(element) {
        const type = element.getAttribute('data-type');
        return (element.getAttribute('data-path') || element.id || element.tagName) + '-' + type;
    }
    async open(element) {
        let path = element.getAttribute('data-path'), type = element.getAttribute('data-type'), tabindex = element.tabIndex || 0
        if (this.busy) return
        
        const key = this.getKey(element);
        if (key != this.lastSelectedKey) {
            this.lastSelectedKey = key;
            switch(type) {
                case 'back':
                    await this.sounds.play('click-out', {
                        volume: 30,
                        time: 300
                    });
                    break;
                case 'group':
                case 'stream':
                    await this.sounds.play('click-in', {
                        volume: 30,
                        time: 225
                    });
                    break;
            }
        }
        if (tabindex == '{tabindex}') tabindex = false
        if (type == 'back') {
            path = path.split('/')
            path.pop()
            path.pop()
            path = path.join('/')
        }
        this.emit('open', type, path, element, tabindex || false)
        if (type == 'action' || type == 'input') {
            main.emit('menu-action', path, tabindex || false)
        } else if (type == 'back') {
            main.emit('menu-back')
        } else if (type == 'select') {
            this.lastSelectTriggerer = element
            main.emit('menu-select', path, tabindex || false)
        } else {
            main.emit('menu-open', path, tabindex || false)
        }
    }
    action(element) {
        let type = element.getAttribute('data-type')
        this.emit('focus', element)
        switch(type) {
            case 'slider': this.setupSlider(element); break
            case 'check': this.check(element); break
            default:
                if (type == 'select') this.lastSelectTriggerer = element
                this.open(element)
        }
        return false
    }
    triggerAction(path, name) {
        return new Promise((resolve, reject) => {
            let failed, timer = 0
            this.once('render', p => {
                if (failed) return
                clearTimeout(timer)
                if (p == path) {
                    let n = -1
                    this.currentEntries.some((e, i) => {
                        if (e.name == name) {
                            n = i
                            return true
                        }
                    })
                    if (n != -1) {
                        this.emit('focus-index', n)
                        this.getIndex(n)?.click()
                        resolve(true)
                    } else {
                        reject('option not found')
                    }
                } else {
                    reject('navigation failed')
                }
            })
            main.emit('menu-open', path)
            timer = setTimeout(() => {
                failed = true
                reject('timeout')
            }, 5000)
        })
    }
    prepareEntry(e, path) {
        if (!e.url) e.url = 'javascript:;'
        if (!e.type) e.type = typeof(e.url) ? 'stream' : 'action'
        if (e.type != 'back') {
            if (!e.fa) {
                if (this.icons[e.path] && this.icons[e.path].url.startsWith('fa')) {
                    e.fa = this.icons[e.path].url
                }
                if (!e.icon || !e.icon.startsWith('fa')) {
                    if (this.defaultIcons[e.type]) e.fa = 'fas '+ this.defaultIcons[e.type]
                } else {
                    e.fa = e.icon
                }
            }
            if (e.fa && !this.icons[e.path]) this.icons[e.path] = {url: e.fa}
        }
        if (e.type == 'check') e.fa = 'fas fa-toggle-'+ (e.value ? 'on' : 'off')
        if (typeof(e.statusFlags) != 'string') e.statusFlags = ''
        if (e.rawname && e.rawname.includes('[')) e.rawname = this.parseBBCode(e.rawname)
        e.wrapperClass = 'entry-wrapper'
        if (!e.side && this.icons[e.path] && this.icons[e.path].cover && (main.config['stretch-logos'] || (e.class && e.class.includes('entry-force-cover')))) {
            e.cover = true
            e.wrapperClass += ' entry-cover-active'
        } else {
            if (e.cover) e.cover = false
            if (e.wrapperClass.includes('entry-cover-active')) {
                e.wrapperClass = e.wrapperClass.replace(new RegExp(' *entry-cover-active *', 'g'), ' ')
            }
        }
        if (typeof(e.prepend) != 'string') e.prepend = ''
        e.key = e.path + (e.id || e.url || '')
        return e
    }
}