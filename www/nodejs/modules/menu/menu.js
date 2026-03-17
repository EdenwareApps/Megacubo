import { EventEmitter } from 'node:events'
import { basename, traceback, trackPromise } from '../utils/utils.js'
import lang from '../lang/lang.js'
import storage from '../storage/storage.js'
import Limiter from '../limiter/limiter.js'
import mega from '../mega/mega.js'
import config from '../config/config.js'
import renderer from '../bridge/bridge.js'
import { inWorker } from '../paths/paths.js'
import channelEpgPosFilter from '../epg/posfilter.js'

class Menu extends EventEmitter {
    constructor(opts) {
        super()
        this.pages = { '': [] }
        this.opts = {
            debug: false
        }
        if (opts) {
            this.opts = Object.assign(this.opts, opts)
        }
        this.rendering = true
        this.waitingRender = false
        this.navigating = false
        this.path = ''
        this.filters = []
        this.outputFilters = []
        this.posFilters = []
        this.currentEntries = []
        this.openToken = 0
        this.backIcon = 'fas fa-chevron-left'
        this.lastRecommendationsRefresh = 0
        this.liveSections = []
        // Entradas revogadas da home com avoidImmediateRemoval
        this.staleHomeEntries = []
        this.staleHomeCleanupTimer = null
        this.softRefreshLimiter = {
            limiter: new Limiter(() => {
                this.softRefresh()
                this.deepRefreshLimiter.limiter.fromNow()
            }, { intervalMs: 5000, async: true, initialDelay: 1000 }),
            path: ''
        }
        this.deepRefreshLimiter = {
            limiter: new Limiter(p => {
                this.deepRefresh(p)
                this.softRefreshLimiter.limiter.fromNow()
            }, { intervalMs: 5000, initialDelay: 1000 }),
            path: ''
        }
        this.setupEventListeners()
    }
    // Adiciona entradas revogadas da home em staleHomeEntries
    retainStaleHomeEntries(oldEntries, newEntries) {
        const now = Date.now()
        const newNames = newEntries.map(e => e.name)
        for (const entry of oldEntries) {
            if (
                entry.avoidImmediateRemoval === true &&
                !newNames.includes(entry.name)
                // Não existe uma nova entrada com o mesmo nome
            ) {
                // Verifica se já existe uma entrada mais nova com o mesmo nome
                const already = this.staleHomeEntries.find(e => e.name === entry.name)
                if (!already) {
                    this.staleHomeEntries.push({
                        ...entry,
                        _staleTimestamp: now
                    })
                }
            }
        }
        this.scheduleStaleHomeCleanup()
    }
    // Limpa entradas expiradas de staleHomeEntries
    cleanupStaleHomeEntries() {
        const now = Date.now()
        const maxAge = 5 * 60 * 1000 // 5 minutos
        this.staleHomeEntries = this.staleHomeEntries.filter(e => (now - e._staleTimestamp) < maxAge)
        this.scheduleStaleHomeCleanup()
    }
    // Agenda limpeza automática com base no tempo restante da entrada mais antiga
    scheduleStaleHomeCleanup() {
        if (this.staleHomeCleanupTimer) {
            clearTimeout(this.staleHomeCleanupTimer)
            this.staleHomeCleanupTimer = null
        }
        if (!this.staleHomeEntries.length) return
        const now = Date.now()
        const oldest = this.staleHomeEntries.reduce((min, e) => e._staleTimestamp < min ? e._staleTimestamp : min, this.staleHomeEntries[0]._staleTimestamp)
        const maxAge = 5 * 60 * 1000
        const timeLeft = Math.max(0, maxAge - (now - oldest))
        this.staleHomeCleanupTimer = setTimeout(() => {
            this.cleanupStaleHomeEntries()
        }, timeLeft)
    }
    setupEventListeners() {
        renderer.ready(async () => {
            global.streamer.on('streamer-connect', () => {
                this.softRefreshLimiter.limiter.pause()
                this.deepRefreshLimiter.limiter.pause()
            })
            global.streamer.on('streamer-disconnect', () => {
                this.softRefreshLimiter.limiter.resume()
                this.deepRefreshLimiter.limiter.resume()
            })
            renderer.ui.on('menu-playing', showing => {                
                if (global.streamer.active && !showing) {
                    this.softRefreshLimiter.limiter.pause()
                    this.deepRefreshLimiter.limiter.pause()
                } else {
                    this.softRefreshLimiter.limiter.resume()
                    this.deepRefreshLimiter.limiter.resume()
                }
            })
            osd.on('show', (text, icon, name, duration) => {
                if(duration == 'persistent' && text.includes('...')) {
                    if(!this.osdBusies) this.osdBusies = {}
                    if(!this.osdBusies[name]) this.osdBusies[name] = this.setBusy(name, 2000)
                } else {
                    if(this.osdBusies && this.osdBusies[name]) {
                        this.osdBusies[name].release()
                        delete this.osdBusies[name]
                    }
                }
            })
            osd.on('hide', name => {
                if(this.osdBusies && this.osdBusies[name]) {
                    this.osdBusies[name].release()
                    delete this.osdBusies[name]
                }
            })
        })
        renderer.ui.on('menu-open', async (path, tabindex) => {
            await this.withBusy(path, async () => {
                this.opts.debug && console.log('menu-open', path, tabindex)
                await this.open(path, tabindex).catch(e => this.displayErr(e))
            })
        })
        renderer.ui.on('menu-action', async (path, tabindex) => {
            await this.withBusy(path, async () => {
                await this.action(path, tabindex).catch(e => this.displayErr(e))
            })
        })
        renderer.ui.on('menu-back', async () => {
            await this.withBusy(this.dirname(this.path), async () => {
                await this.back().catch(e => this.displayErr(e))
            })
        })
        renderer.ui.on('menu-check', async (path, val) => {
            await this.withBusy(path, async () => {
                await this.check(path, val)
            })
        })
        renderer.ui.on('menu-input', async (path, val) => {
            await this.withBusy(path, async () => {
                this.opts.debug && console.log('menu-input', path, val)
                await this.input(path, val)
            })
        })
        renderer.ui.on('menu-select', async (path, tabindex) => {
            await this.withBusy(path, async () => {
                await this.select(path, tabindex).catch(e => this.displayErr(e))
            })
        })
        this.on('open', async path => {
            if (path === this.liveSectionPath) return
            clearTimeout(this.liveSectionTimer)

            const section = this.liveSections.find(s => s.path === path)
            if (!section) {
                this.liveSectionPath = null
                return
            }

            this.liveSectionPath = path
            const cb = async () => {
                if (path !== this.liveSectionPath) {
                    clearTimeout(this.liveSectionTimer)
                    this.liveSectionPath = null
                    return
                }
                let data
                try {
                    data = await section.callback()
                } catch (e) {
                    this.opts.debug && console.error('live section callback error', e)
                }
                if (path !== this.liveSectionPath) {
                    clearTimeout(this.liveSectionTimer)
                    this.liveSectionPath = null
                    return
                }
                if (data && Array.isArray(data[0])) {
                    this.render(data[0], path, data[1] || {})
                }
                this.liveSectionTimer = setTimeout(cb, section.interval)
            }
            await cb()
        })
    }
    setLiveSection(path, interval=1000, callback) {
        this.liveSections.push({path, interval, callback})
    }
    setBusy(path, timeoutOrOpts = 0) {
        const hasOptions = timeoutOrOpts && typeof timeoutOrOpts === 'object'
        const opts = hasOptions ? {
            timeout: 0,
            icon: 'fa-mega busy-x',
            lock: false,
            ...timeoutOrOpts
        } : {
            timeout: Number(timeoutOrOpts) || 0,
            icon: 'fa-mega busy-x',
            lock: false
        }

        opts.timeout = Number(opts.timeout) || 0
        opts.icon = opts.icon || 'fa-mega busy-x'
        const uid = opts.id || ('busy-' + Date.now())

        if (typeof this.busies === 'undefined') {
            this.busies = new Map()
        }
        this.busies.set(uid, path)
        renderer.ui.emit('menu-busy', Array.from(this.busies.values()))

        const releaseHooks = []
        let released = false
        let timeoutId

        const release = (reason = 'release') => {
            if (released) {
                return
            }
            released = true

            if (timeoutId) {
                clearTimeout(timeoutId)
                timeoutId = null
            }

            this.busies.delete(uid)
            if (this.busies.size) {
                renderer.ui.emit('menu-busy', Array.from(this.busies.values()))
            } else {
                renderer.ui.emit('menu-busy', false)
            }

            while (releaseHooks.length) {
                const hook = releaseHooks.shift()
                try {
                    hook()
                } catch (err) {
                    console.error('menu.setBusy release hook failed:', err)
                }
            }

            if (typeof opts.onRelease === 'function') {
                try {
                    opts.onRelease(reason)
                } catch (err) {
                    console.error('menu.setBusy onRelease failed:', err)
                }
            }
        }

        if (opts.message && global?.osd) {
            const osdId = opts.osdId || uid
            try {
                global.osd.show(String(opts.message), opts.icon, osdId, 'persistent')
                releaseHooks.push(() => {
                    try {
                        global.osd.hide(osdId)
                    } catch (err) {
                        console.error('menu.setBusy osd hide failed:', err)
                    }
                })
            } catch (err) {
                console.error('menu.setBusy osd show failed:', err)
            }
        }

        if (opts.timeout > 0) {
            timeoutId = setTimeout(() => {
                timeoutId = null
                if (typeof opts.onTimeout === 'function') {
                    try {
                        opts.onTimeout()
                    } catch (err) {
                        console.error('menu.setBusy onTimeout failed:', err)
                    }
                }
                release('timeout')
            }, opts.timeout)
        }

        return { release }
    }
    async withBusy(path, fn, opts = 0) {
        const hasOptions = opts && typeof opts === 'object'
        const timeout = hasOptions ? (opts.timeout || 60000) : (Number(opts) || 60000) // Default 60s timeout
        const busyOpts = hasOptions ? { ...opts, timeout } : { timeout }
        const busy = this.setBusy(path, busyOpts)
        try {
            await fn();
        } catch (e) {
            this.displayErr(e);
        } finally {
            busy.release();
        }
    }
    clearBusies() {
        // Clear all pending busies (useful for cleanup after errors)
        if (this.busies && this.busies.size > 0) {
            this.busies.clear();
            renderer.ui.emit('menu-busy', false);
        }
    }
    async updateHomeFilters() {
        // Antes de atualizar, salva as entradas antigas
        const oldEntries = Array.isArray(this.pages['']) ? this.pages[''].slice() : []
        this.pages[''] = await this.applyFilters([], '')
        // Após atualizar, verifica entradas revogadas
        this.retainStaleHomeEntries(oldEntries, this.pages[''])
        this.path || this.refresh()
    }
    async dialog(opts, def, mandatory, dialogId = null) {
        let uid = dialogId || ('ac-' + Date.now())
        renderer.ui.emit('dialog', opts, uid, def, mandatory, dialogId)
        return new Promise(resolve => renderer.ui.once(uid, resolve))
    }
    async prompt(atts) {
        if (!atts.placeholder)
            atts.placeholder = atts.question
        if (!atts.callback)
            atts.callback = 'ac-' + Date.now()
        renderer.ui.emit('prompt', atts)
        return new Promise(resolve => renderer.ui.once(atts.callback, resolve))
    }
    info(question, message, fa) {
        renderer.ui.emit('info', question, message, fa)
    }
    checkFlags(entries) {
        return entries.map(n => {
            let e = Object.assign({}, n)
            let details = []
            if (e.details) {
                details.push(e.details)
            }
            if (e.usersPercentage || e.users) {
                let s = '', c = 'fire'
                if (typeof(e.trend) == 'number') {
                    if (e.trend == -1) {
                        c = 'caret-down'
                        s = ' style="color: #f30;font-weight: bold;"'
                    } else {
                        c = 'caret-up'
                        s = ' style="color: green;font-weight: bold;"'
                    }
                }
                details.push('<i class="fas fa-' + c + '" ' + s + '></i> ' + lang.TRENDING)
            }
            if (e.position && this.path == lang.TRENDING) {
                details.push('<i class="fas fa-trophy" style="transform: scale(0.8)"></i> ' + e.position)
            }
            e.details = details.join(' <span style="opacity: 0.25">&middot</span> ')
            return e
        })
    }
    emptyEntry(txt, icon) {
        return {
            name: txt || lang.EMPTY,
            icon: icon || 'fas fa-info-circle',
            type: 'action',
            class: 'entry-empty'
        }
    }
    start() {
        this.open('').catch(e => this.displayErr(e))
    }
    refresh(deep=false, p) {
        if (typeof(p) != 'string') p = this.path
        if (p != this.path || this.navigating) return
        const type = deep === true ? 'deepRefreshLimiter' : 'softRefreshLimiter'
        if (this[type].path === this.path) {
            this[type].limiter.call()
        } else {
            this[type].path = this.path
            this[type].limiter.skip(p || this.path)
        }
    }
    refreshNow(deep=false) {
        if(deep === true) {
            this.deepRefreshLimiter.limiter.skip(this.path)
        } else {
            this.softRefreshLimiter.limiter.skip(this.path)
        }
    }
    softRefresh(p) {
        if (typeof(p) !== 'string') p = this.path
        if (p !== this.path || !this.rendering) return
        let page
        if (this.path && typeof(this.pages[p]) !== 'undefined') {
            page = this.pages[p]
            delete this.pages[p]
        }
        this.open(p).then(() => {
            if(page && !this.pages[p]) {
                this.pages[p] = page
            }
        }).catch(err => {
            console.error(err)
            if(page && !this.pages[p]) {
                this.pages[p] = page
            }
            this.open(p).catch(e => this.displayErr(err))
        })
    }
    deepRefresh(p) {
        if (typeof(p) != 'string') p = this.path
        if (p != this.path || !this.rendering) return
        const requestToken = ++this.openToken
        this.deepRead(p).then(async ret => {
            if (requestToken !== this.openToken) {
                if (this.opts.debug) {
                    console.log('deepRefresh skipped (outdated)', { path: p, requestToken, currentToken: this.openToken })
                }
                return
            }
            await this.render(ret.entries, p, {
                parent: ret.parent,
                icon: (ret.parent ? ret.fa : '') || 'fas fa-box-open',
                openToken: requestToken
            })
        }).catch(err => this.displayErr(err))
    }
    inSelect() {
        if (typeof(this.pages[this.dirname(this.path)]) != 'undefined') {
            const pp = this.dirname(this.path)
            const p = this.findEntry(this.pages[pp], basename(this.path), {fullPath: this.path})
            return p && p.type == 'select'
        }
    }
    async back(level, deep) {
        let p = this.path
        if (this.opts.debug) {
            console.log('back', this.path)
        }
        if (this.path) {
            if (this.inSelect()) {
                this.path = this.dirname(this.path)
            }
            let e = this.findEntry(this.pages[this.path], lang.BACK)
            if (this.opts.debug) {
                console.log('back', this.path, p, e)
            }
            if (e && e.action) {
                let ret = e.action()
                if (ret && ret.catch)
                    ret.catch(e => this.displayErr(e))
                return
            }
            if (typeof(level) != 'number') {
                level = 1
            }
            while (p && level > 0) {
                p = this.dirname(p)
                level--
            }
            if (this.opts.debug) {
                console.log('back', p, deep)
            }
            if (this.pages[p]) {
                let fa, isSearch = p == lang.SEARCH
                if (isSearch) {
                    fa = 'fas fa-search'
                } else {
                    fa = 'fa-mega busy-x'
                }
                await this.render(this.pages[p], p, {parent: {name: p.split('/').pop(), fa}})
                if (isSearch) return
            }
            await this.open(p, undefined, deep, true, true, true).catch(e => this.displayErr(e))
        } else {
            await this.refresh()
        }
    }
    prependFilter(f) {
        this.filters.unshift(f)
    }
    addFilter(f) {
        this.filters.push(f)
    }
    prependOutputFilter(f) {
        this.outputFilters.unshift(f)
    }
    addOutputFilter(f) {
        this.outputFilters.push(f)
    }
    prependPosFilter(f) {
        this.posFilters.unshift(f)
    }
    addPosFilter(f) {
        this.posFilters.push(f)
    }
    async applyFilters(entries, path) {
        for (let i = 0; i < this.filters.length; i++) {
            this.opts.debug && console.log('Menu filter ' + (i + 1) + '/' + this.filters.length)
            const es = await this.filters[i](entries, path).catch(err => console.error(err))
            if (Array.isArray(es)) {
                entries = es
            } else {
                this.opts.debug && console.log('Menu filter failure at filter #' + i, this.filters[i], es)
            }
        }
        if (Array.isArray(entries)) {
            this.opts.debug && console.log('Menu filtering DONE ' + this.filters.length)
            const basePath = path ? path + '/' : ''
            for (let i = 0; i < entries.length; i++) {
                if (entries[i].type == 'back') {
                    entries[i].path = this.dirname(path)
                } else {
                    entries[i].path = basePath + entries[i].name
                }
                if (typeof(entries[i].checked) == 'function') {
                    entries[i].value = !!entries[i].checked(entries[i])
                } else if (typeof(entries[i].value) == 'function') {
                    entries[i].value = entries[i].value()
                }
            }
            this.opts.debug && console.log('Menu filtering DONE* ', !!inWorker)
        }
        return entries || []
    }
    async applyOutputFilters(entries, path) {
        if (!Array.isArray(entries) || !this.outputFilters.length) {
            return entries || []
        }
        for (let i = 0; i < this.outputFilters.length; i++) {
            this.opts.debug && console.log('Menu output filter ' + (i + 1) + '/' + this.outputFilters.length)
            const es = await this.outputFilters[i](entries, path).catch(err => console.error(err))
            if (Array.isArray(es)) {
                entries = es
            } else {
                this.opts.debug && console.log('Menu output filter failure at filter #' + i, this.outputFilters[i], es)
            }
        }
        return entries || []
    }
    async applyPosFilters(entries, path) {
        if (!Array.isArray(entries) || !this.posFilters.length) {
            return entries || []
        }
        for (let i = 0; i < this.posFilters.length; i++) {
            this.opts.debug && console.log('Menu pos filter ' + (i + 1) + '/' + this.posFilters.length)
            const es = await this.posFilters[i](entries, path).catch(err => console.error(err))
            if (Array.isArray(es)) {
                entries = es
            }
        }
        return entries || []
    }
    syncPages() {
        if(this.path.includes('/') && !this.path.includes(lang.SEARCH) && !this.path.includes(lang.EPG)) {
            for(const page in this.pages) {
                if (this.path && !this.path.includes(page)) {
                    delete this.pages[page]
                }
            }
        }
    }
    check(destPath, value) {
        let name = basename(destPath), dir = this.dirname(destPath)
        if (typeof(this.pages[dir]) == 'undefined') {
            console.error(dir + 'NOT FOUND IN', this.pages)
        } else {
            if (!this.pages[dir].some((e, k) => {
                if (e.name == name) {
                    //console.warn('CHECK', dir, k, this.pages[dir])
                    if (typeof(this.pages[dir][k].value) != 'function') {
                        this.pages[dir][k].value = value
                    }
                    if (typeof(e.action) == 'function') {
                        let ret = e.action(e, value)
                        if (ret && ret.catch)
                            ret.catch(err => console.error(err))
                    }
                    return true
                }
            })) {
                console.warn('CHECK ' + destPath + ' (' + value + ') NOT FOUND IN ', this.pages)
            }
        }
    }
    input(destPath, value) {
        let name = basename(destPath), dir = this.dirname(destPath)
        if (this.opts.debug) {
            console.log('input()', destPath, value, name, dir)
        }
        if (typeof(this.pages[dir]) == 'undefined') {
            console.error(dir + 'NOT FOUND IN', this.pages)
        } else {
            let trustedActionTriggered = this.pages[dir].some((e, k) => {
                if (e.name == name && ['input', 'slider'].includes(e.type)) {
                    this.pages[dir][k].value = value
                    if (typeof(e.action) == 'function') {
                        let ret = e.action(e, value)
                        if (ret && ret.catch)
                            ret.catch(err => console.error(err))
                    }
                    console.error('input ok', e, this.path, destPath)
                    return true
                }
            })
            if (!trustedActionTriggered) {
                if (dir != this.path) {
                    dir = this.path
                    this.pages[dir].some((e, k) => {
                        if (e.name == name && ['input', 'slider'].includes(e.type)) {
                            this.pages[dir][k].value = value
                            if (typeof(e.action) == 'function') {
                                let ret = e.action(e, value)
                                if (ret && ret.catch)
                                    ret.catch(err => console.error(err))
                            }
                            console.error('input ok', e, this.pages[dir][k])
                            return true
                        }
                    })
                }
                console.error('input ok?', dir)
            }
        }
    }
    async action(destPath, tabindex) {
        // Track menu.action() to detect hangs
        return trackPromise((async () => {
            let name = basename(destPath), dir = this.dirname(destPath)
            if (this.opts.debug) {
                console.log('action ' + destPath + ' | ' + dir, tabindex)
            }
            if (typeof(this.pages[dir]) == 'undefined') {
                console.error(dir + 'NOT FOUND IN', this.pages)
            } else {
                const inSelect = this.pages[dir].some(e => typeof(e.selected) != 'undefined')
                let i = this.findEntryIndex(this.pages[dir], name, tabindex)
                if(typeof(i) == 'number') {
                    if (inSelect) {
                        this.pages[dir].forEach((e, j) => {
                            this.pages[dir][i].selected = j == i    
                        })
                    }
                    this.emit('action', this.pages[dir][i])
                    return true
                } else {
                    console.error('ACTION ' + name + ' (' + tabindex + ') NOT FOUND IN ', { dir, destPath, keys: Object.keys(this.pages) }, this.pages[dir])
                }
            }
        })(), `menu.action(${destPath})`, 30000)
    }
    dirname(path) {
        let i = String(path).lastIndexOf('/')
        if (i <= 0) {
            return ''
        } else {
            return path.substr(0, i)
        }
    }
    async deepRead(destPath, tabindex) {
        if (['.', '/'].includes(destPath)) {
            destPath = ''
        }
        let page, parent
        const parts = destPath ? destPath.split('/') : []
        const pages = { '': this.pages[''] }
        const finish = entries => ({entries, parent})
        let next = async () => {
            if (parts.length) {
                let previousPage = page
                let name = parts.shift()
                let fullPath = page ? page + '/' + name : name
                let entry = this.findEntry(pages[page], name, {fullPath})
                page = fullPath
                if (entry && ['group', 'select'].includes(entry.type)) {
                    parent = entry
                    let entries = await this.readEntry(entry, page)
                    entries = await this.applyFilters(entries, page)
                    if (entry.type == 'group') {
                        entries = this.addMetaEntries(entries, page)
                    }
                    this.pages[page] = pages[page] = entries
                    if (this.opts.debug) {
                        console.log('updated page', page, entries)
                    }
                    return next()
                }
                if (typeof(this.pages[destPath]) != 'undefined') { // fallback
                    console.error('deep path not found, falling back', destPath, this.pages[destPath])
                    return finish(this.pages[destPath])
                }
                if (typeof(this.pages[fullPath]) != 'undefined') { // fallback
                    console.error('deep path not found, falling back', fullPath, this.pages[fullPath])
                    return finish(this.pages[fullPath])
                }
                console.error('deep path not found, falling back', previousPage, this.pages[previousPage])
                return finish(this.pages[previousPage])
            }
            return finish(pages[destPath])
        }
        return next()
    }
    async read(destPath, tabindex, allowCache) {
        if (this.opts.debug) {
            console.error('read', destPath, tabindex, allowCache)
        }
        const refPath = this.path
        if (['.', '/'].includes(destPath)) {
            destPath = ''
        }
        const parentPath = this.dirname(destPath)
        if (typeof(this.pages[parentPath]) == 'undefined') {
            return this.deepRead(destPath, tabindex)
        }
        const basePath = basename(destPath), finish = (entries, parent) => {
            if (!parent) {
                parent = {name: basePath, fa: 'fas fa-home', entries}
            }
            return {entries, parent}
        }
        if (!basePath) {
            const es = await this.applyFilters(this.pages[parentPath], parentPath)
            this.pages[parentPath] = es
            return finish(this.pages[parentPath])
        }
        let i = this.findEntryIndex(this.pages[parentPath], basePath, tabindex)
        if(typeof(i) == 'number') {
            const e = this.pages[parentPath][i]
            if (['group', 'select'].includes(e.type)) {
                if (allowCache && typeof(this.pages[destPath]) != 'undefined') {
                    return finish(this.pages[destPath], e)
                }
                let es = await this.readEntry(e, parentPath)
                if (!Array.isArray(es)) {
                    return es
                }
                es = await this.applyFilters(es, destPath)
                if (e.type == 'group') {
                    es = this.addMetaEntries(es, destPath, parentPath)
                }
                this.pages[destPath] = es
                return finish(this.pages[destPath], e)
            }
        } else {
            // Busca em staleHomeEntries se for home
            if (parentPath === '') {
                const stale = this.findEntry(this.pages[parentPath], basePath, {tabindex, isFolder, path: ''})
                if (stale) {
                    return finish([stale])
                }
            }
            // maybe it's a 'ghost' page like search results, which is not linked on navigation
            // but shown directly via render() instead
            if (typeof(this.pages[destPath]) != 'undefined') { // fallback
                console.error('path not found, falling back', destPath, this.pages[destPath])
                return finish(this.pages[destPath])
            }
            console.error('path not found', {
                parentPath,
                destPath,
                tabindex,
                basePath,
                page: this.pages[parentPath]
            })
            throw 'path not found'
        }
    }
    async open(destPath, tabindex, deep, isFolder, backInSelect) {
        if (!destPath || ['.', '/'].includes(destPath)) {
            destPath = ''
        }
        if (this.opts.debug) {
            console.error('open', destPath, tabindex)
        }
        const requestToken = ++this.openToken
        this.emit('open', destPath)
        
        // Track menu.open() to detect hangs
        this.navigating = true
        return trackPromise((async () => {
            let parentEntry, name = basename(destPath), parentPath = this.dirname(destPath)
            const finish = async (es) => {
                if (requestToken !== this.openToken) {
                    if (this.opts.debug) {
                        console.log('open finish skipped (outdated)', { destPath, requestToken, currentToken: this.openToken })
                    }
                    return false
                }
                if (backInSelect && parentEntry && parentEntry.type == 'select') {
                    if (this.opts.debug) {
                        console.log('backInSelect', backInSelect, parentEntry, destPath)
                    }
                    return this.open(this.dirname(destPath), -1, deep, isFolder, backInSelect)
                }
                if(!destPath || !parentEntry || parentEntry.type == 'group') {
                    this.path = destPath
                }
                es = this.addMetaEntries(es, destPath, parentPath)
                this.pages[this.path] = es
                await this.render(this.pages[this.path], this.path, { parent: parentEntry, openToken: requestToken })
                return true
            }
            if (this.opts.debug) {
                console.log('readen1', this.pages[parentPath], parentPath, name)
            }
            if (Array.isArray(this.pages[parentPath])) {
                const i = this.pages[parentPath].findIndex(e => e.name == name)
                if (this.opts.debug) {
                    console.log('readen1.5', i)
                }
                if (i != -1) {
                    const e = this.pages[parentPath][i]
                    if (e.url && (!e.type || e.type == 'stream')) { // force search results to open directly
                        return this.action(destPath, tabindex)
                    } else if(e.type == 'group' && parentPath.startsWith(lang.SEARCH)) {
                        if (this.opts.debug) {
                            console.log('readen1.6', e)
                        }
                        let es = await this.readEntry(e, parentPath)
                        es = await this.applyFilters(es, destPath)
                        return this.render(es, destPath, { parent: e, openToken: requestToken })
                    } else if(e.type == 'group') {
                        // Handle normal groups (like "Recomendado para você")
                        parentEntry = e
                        let es = await this.readEntry(e, parentPath)
                        es = await this.applyFilters(es, destPath)
                        return finish(es)
                    }
                }
            }
            let ret = await this[deep === true ? 'deepRead' : 'read'](parentPath, undefined)
            if (this.opts.debug) {
                console.log('readen2', {ret, page: this.pages[parentPath], parentPath, name, destPath, tabindex, deep, isFolder, backInSelect}, traceback())
            }
            if (ret === -1 || ret === undefined) return
            parentEntry = ret.parent
            if (name) {
                // Try to find entry in ret.entries first, but if not found, try in this.pages[parentPath]
                // This handles cases where the entry was filtered out or the array was modified
                let e = this.findEntry(ret.entries, name, {
                    tabindex, isFolder, fullPath: destPath, path: parentPath === '' ? '' : parentPath
                })
                if (!e && Array.isArray(this.pages[parentPath])) {
                    e = this.findEntry(this.pages[parentPath], name, {
                        tabindex, isFolder, fullPath: destPath, path: parentPath === '' ? '' : parentPath
                    })
                }
                if (this.opts.debug) {
                    console.log('findEntry', destPath, ret.entries, name, tabindex, isFolder, e)
                }
                if (e) {
                    parentEntry = e
                    if (e.type == 'group') {
                        let es = await this.readEntry(e, parentPath)
                        es = await this.applyFilters(es, destPath)
                        return finish(es)
                    } else if (e.type == 'select') {
                        if (backInSelect) {
                            return this.open(this.dirname(destPath), -1, deep, isFolder, backInSelect)
                        } else {
                            await this.select(destPath, tabindex)
                            return true
                        }
                    } else {
                        this.action(destPath, tabindex)
                        return true
                    }
                } else {
                    if (this.opts.debug) {
                        console.log('noParentEntry', destPath, this.pages[destPath], ret)
                    }
                    if (typeof(this.pages[destPath]) != 'undefined') {
                        return finish(this.pages[destPath])
                    } else {
                        return this.open(this.dirname(destPath), undefined, deep, undefined, backInSelect)
                    }
                }
            } else {
                this.path = destPath
                await this.render(this.pages[this.path], this.path, { parent: parentEntry, openToken: requestToken })
                return true
            }
        })(), `menu.open(${destPath})`, 30000).finally(() => {
            // Delay 2 seconds before allowing new refresh to avoid rapid refresh cycles
            setTimeout(() => {
                this.navigating = false
            }, 2000)
        })
    }
    async readEntry(e, parentPath) {
        // Track menu.readEntry() to detect hangs
        const name = e?.name || 'unknown'
        const timeoutMs = 30000
        let entriesPromise
        let rendererType = 'entries'
        if (!e) {
            return []
        }
        if (typeof(e.renderer) == 'function') {
            rendererType = 'function'
            entriesPromise = e.renderer(e)
        } else if (typeof(e.renderer) == 'string') {
            rendererType = 'storage'
            entriesPromise = storage.get(e.renderer)
        } else {
            entriesPromise = e.entries || []
        }

        if (!entriesPromise || typeof entriesPromise.then !== 'function') {
            return Array.isArray(entriesPromise) ? entriesPromise : []
        }

        let timeoutId
        const timeoutPromise = new Promise(resolve => {
            timeoutId = setTimeout(() => {
                if (entriesPromise && typeof entriesPromise.cancel === 'function') {
                    entriesPromise.cancel()
                }
                console.warn('menu.readEntry timeout:', {
                    name,
                    parentPath: parentPath || '',
                    rendererType,
                    entriesPromise,
                    timeoutMs
                })
                resolve([])
            }, timeoutMs)
        })

        const result = await trackPromise(
            Promise.race([
                entriesPromise.then(entries => Array.isArray(entries) ? entries : []),
                timeoutPromise
            ]),
            `menu.readEntry(${name})`,
            timeoutMs + 5000
        )
        if (timeoutId) {
            clearTimeout(timeoutId)
        }
        return result
    }
    findEntryIndex(entries, name, tabindex, isFolder) {
        let ret = false
        if (Array.isArray(entries)) {
            entries.some((e, i) => {
                if (e.name == name) {
                    let fine
                    if (typeof(tabindex) == 'number' && tabindex != -1) {
                        fine = tabindex == i
                    } else if (isFolder) {
                        fine = ['group', 'select'].includes(e.type)
                    } else {
                        fine = true
                    }
                    if (fine) {
                        ret = i
                        return true
                    }
                }
            })
            if (ret === false) {
                let candidates = entries.map((e, i) => {
                    e._index = i
                    return e
                }).filter(e => {
                    if (e.name == name) {
                        return true
                    }
                })
                if (candidates.length == 1) {
                    ret = candidates[0]._index
                } else if (candidates.length) {
                    ret = candidates.sort((a, b) => {
                        return Math.abs(a.tabindex - tabindex) - Math.abs(b.tabindex - tabindex)
                    }).shift()._index
                }
                if (this.opts.debug) {
                    if (ret === false) {
                        console.log('findEntry did not found it by name')
                    } else {
                        console.log('findEntry did not found it by tabindex ' + tabindex + ' picking nearest one (' + ret.tabindex + ')', ret)
                    }
                }
            }
        }
        return ret
    }
    findEntry(entries, name, opts={}) {
        const i = this.findEntryIndex(entries, name, opts.tabindex, opts.isFolder)
        if(i !== false) return entries[i]
        if(opts.fullPath && this.pages[opts.fullPath]) {
            return { // return a meta entry to keep navigation
                name,
                type: 'group',
                entries: this.pages[opts.fullPath]
            }
        }
        // Busca em staleHomeEntries apenas se path for home
        const currentPath = typeof opts.fullPath === 'string' ? opts.fullPath : (typeof opts.path === 'string' ? opts.path : '')
        if (currentPath === '' && this.staleHomeEntries && this.staleHomeEntries.length) {
            const now = Date.now()
            const maxAge = 5 * 60 * 1000
            // Remove expiradas e busca
            this.staleHomeEntries = this.staleHomeEntries.filter(e => (now - e._staleTimestamp) < maxAge)
            const stale = this.staleHomeEntries.find(e => e.name === name)
            if (stale) {
                return stale
            }
        }
    }
    async select(destPath, tabindex) {
        if (this.opts.debug) {
            console.log('select ' + destPath + ', ' + tabindex)
        }
        let ret = await this.read(destPath, tabindex)
        if (ret && ret != -1) {
            if (ret.entries && ret.entries.length > 1) {
                let d = this.dirname(destPath)
                let icon = ret.parent ? ret.fa : ''
                renderer.ui.emit('menu-select', ret.entries, destPath, icon)
            } else {
                await this.open(destPath, tabindex, undefined, undefined, true) // set backInSelect to prevent looping
            }
        }
        return ret
    }
    canApplyStreamTesting(entries) {
        return entries.length && entries.some(e => e.url && (!e.type || e.type == 'stream') && !mega.isMega(e.url))
    }
    addMetaEntries(entries, path, backTo) {
        // Home path (empty) doesn't need back button
        if (!path || path === '') {
            // Remove any back entries from home (check only first 3 positions)
            for (let i = Math.min(2, entries.length - 1); i >= 0; i--) {
                if (entries[i].type === 'back' || entries[i].name === lang.BACK) {
                    entries.splice(i, 1);
                    break; // Only one back entry expected
                }
            }
            for (let i = 0; i < entries.length; i++) {
                entries[i].tabindex = i
            }
            return entries
        }
        
        // Check if first entry is already back (most common case)
        if (entries.length > 0 && (entries[0].type === 'back' || entries[0].name === lang.BACK)) {
            // Already correct, just set tabindex
            for (let i = 0; i < entries.length; i++) {
                entries[i].tabindex = i
            }
            return entries
        }
        
        // Check only first 3 positions for back entry (never beyond that)
        for (let i = Math.min(2, entries.length - 1); i >= 0; i--) {
            if (entries[i].type === 'back' || entries[i].name === lang.BACK) {
                entries.splice(i, 1);
                break; // Only one back entry expected
            }
        }
        
        if (!entries.length) {
            entries.push(this.emptyEntry())
        }
        
        // Add back button as first entry
        entries.unshift({
            name: lang.BACK,
            type: 'back',
            fa: this.backIcon,
            path: backTo || this.dirname(path)
        });
        
        if (!config.get('auto-test')) {
            let has = entries.some(e => e.name == lang.TEST_STREAMS)
            if (!has && this.canApplyStreamTesting(entries)) {
                entries.splice(1, 0, {
                    name: lang.TEST_STREAMS,
                    fa: 'fas fa-satellite-dish',
                    type: 'action',
                    path: path + '/' + lang.TEST_STREAMS,
                    action: async () => {
                        global.streamer.state.test(entries, '', true)
                    }
                })
            }
        }

        const viewportSize = global.config.get('view-size')
        const viewportLimit = 2 * (viewportSize.portrait.x * viewportSize.portrait.y)

        if (entries.length > viewportLimit && !entries.some(e => e.name === lang.SCROLL_TO_TOP)) {
            entries.push({
                name: lang.SCROLL_TO_TOP,
                fa: 'fas fa-arrow-up',
                type: 'action',
                class: 'entry-scroll-to-top',
                action: () => {
                    renderer.ui.emit('scroll-to-top')
                }
            })
        }
        
        for (let i = 0; i < entries.length; i++) {
            entries[i].tabindex = i
        }
        return entries
    }
    currentStreamEntries(includeMegaStreams) {        
        return this.currentEntries.filter(e => {
            if (e.url && (!e.type || e.type == 'stream' || e.type == 'select')) {
                return includeMegaStreams === true || !mega.isMega(e.url)
            }
        })
    }
    cleanEntries(entries, props) {
        return entries.map(entry => {
            let clone
            for (const prop of props) {
                if (typeof entry[prop] !== 'undefined') {
                    if (!clone) {
                        clone = { ...entry }
                    }
                    delete clone[prop]
                }
            }
            return clone || entry
        })
    }
    async render(entries, path, opts = {}) {
        if (this.opts.debug) {
            console.log('render', entries, path, opts)
        }
        if (!Array.isArray(entries)) {
            return
        }
        const { openToken } = opts
        if (typeof openToken === 'number' && openToken !== this.openToken) {
            if (this.opts.debug) {
                console.log('render skipped (outdated)', { path, openToken, currentToken: this.openToken })
            }
            return
        }
        let processed = entries
        if (opts.filter === true) {
            processed = await this.applyFilters(processed, path)
        }
        if (typeof openToken === 'number' && openToken !== this.openToken) {
            if (this.opts.debug) {
                console.log('render skipped after filters (outdated)', { path, openToken, currentToken: this.openToken })
            }
            return
        }
        processed = await this.applyOutputFilters(processed, path)
        if (typeof openToken === 'number' && openToken !== this.openToken) {
            if (this.opts.debug) {
                console.log('render skipped after output filters (outdated)', { path, openToken, currentToken: this.openToken })
            }
            return
        }
        const prepared = processed.map(entry => {
            const item = { ...entry }
            if (!item.type) {
                if (item.name === lang.BACK) {
                    item.type = 'back'
                } else if (typeof item.renderer === 'function' || Array.isArray(item.entries)) {
                    item.type = 'group'
                } else if (typeof item.action === 'function' && !item.url) {
                    item.type = 'action'
                } else {
                    item.type = 'stream'
                }
            }
            if (typeof item.path !== 'string') {
                item.path = item.type === 'back'
                    ? this.dirname(path)
                    : (path ? `${path}/${item.name}` : item.name)
            }
            return item
        })
        let withMeta = this.addMetaEntries(prepared, path, opts.backTo)
        const emitEntries = entriesToEmit => {
            if (!this.rendering) {
                return
            }
            const icon = opts.icon || opts?.parent?.fa || 'fas fa-home'
            const payload = this.cleanEntries(this.checkFlags(entriesToEmit), ['checked', 'users', 'terms'])
            renderer.ui.emit('render', payload, path, icon)
            this.emit('render', entriesToEmit, path)
            this.syncPages()
        }
        if (typeof openToken === 'number' && openToken !== this.openToken) {
            if (this.opts.debug) {
                console.log('render skipped before pos filters (outdated)', { path, openToken, currentToken: this.openToken })
            }
            return
        }
        this.pages[path] = withMeta
        this.currentEntries = withMeta
        if (typeof path === 'string') {
            this.path = path
        }
        emitEntries(withMeta)
        if (!this.rendering || !this.posFilters.length) {
            return
        }
        const enriched = await this.applyPosFilters(withMeta, path)
        const finalEntries = Array.isArray(enriched) ? enriched : withMeta
        if (typeof openToken === 'number' && openToken !== this.openToken) {
            if (this.opts.debug) {
                console.log('render skipped after pos filters (outdated)', { path, openToken, currentToken: this.openToken })
            }
            return
        }
        this.pages[path] = finalEntries
        this.currentEntries = finalEntries
        emitEntries(finalEntries)
    }
    suspendRendering() {
        this.rendering = false
    }
    resumeRendering() {
        this.emit('rendered')
        this.rendering = true
    }
    async waitRendering() {
        if(!this.rendering) {
            await new Promise(resolve => this.once('rendered', resolve))
        }
        return true
    }
    chooseFile(mimeTypes = '*') {
        return new Promise((resolve, reject) => {
            const id = 'menu-choose-file-' + parseInt(10000000 * Math.random())
            renderer.ui.once(id, data => {
                if (data == null)
                    return reject('File not selected')
                renderer.ui.resolveFileFromClient(data).then(resolve).catch(reject)
            })
            renderer.ui.emit('open-file', renderer.ui.uploadURL, id, mimeTypes)
        })
    }
    displayErr(...args) {
        console.error(...args, traceback())
        renderer.ui.emit('display-error', args.map(v => String(v)).join(', '))
    }
}

const menuInstance = global.menu || (inWorker ? {} : (global.menu = new Menu({})))

if (menuInstance && typeof menuInstance.addPosFilter === 'function' && !menuInstance._epgPosFilterRegistered) {
    menuInstance.addPosFilter(channelEpgPosFilter)
    menuInstance._epgPosFilterRegistered = true
}

export default menuInstance

