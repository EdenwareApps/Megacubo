import { EventEmitter } from 'node:events'
import { basename, traceback } from '../utils/utils.js'
import lang from '../lang/lang.js'
import storage from '../storage/storage.js'
import Limiter from '../limiter/limiter.js'
import mega from '../mega/mega.js'
import config from '../config/config.js'
import renderer from '../bridge/bridge.js'
import { inWorker } from '../paths/paths.js'

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
        this.path = ''
        this.filters = []
        this.outputFilters = []
        this.currentEntries = []
        this.backIcon = 'fas fa-chevron-left'
        this.liveSections = []
        this.softRefreshLimiter = {
            limiter: new Limiter(() => {
                this.softRefresh()
                this.deepRefreshLimiter.limiter.fromNow()
            }, 5000),
            path: ''
        }
        this.deepRefreshLimiter = {
            limiter: new Limiter(p => {
                this.deepRefresh(p)
                this.softRefreshLimiter.limiter.fromNow()
            }, 5000),
            path: ''
        }
        this.setupEventListeners()
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
                if (global.streamer.active) {
                    if (showing) {
                        this.softRefreshLimiter.limiter.resume()
                        this.deepRefreshLimiter.limiter.resume()
                    } else {
                        this.softRefreshLimiter.limiter.pause()
                        this.deepRefreshLimiter.limiter.pause()
                    }
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
        this.on('open', path => {
            if(path === this.liveSectionPath) return
            clearInterval(this.liveSectionTimer)
            this.liveSectionPath = path
            for(const section of this.liveSections) {
                const match = section.path.includes('*') ? path.match(section.path) : path == section.path
                if(match) {
                    this.liveSectionTimer = setInterval(() => {
                        if(typeof(section.callback) == 'function') {
                            section.callback()
                        } else {
                            menu.refresh()                                
                        }
                    }, section.interval)
                }
            }
        })
    }
    setLiveSection(path, interval=1000, callback) {
        this.liveSections.push({path, interval, callback})
    }
    setBusy(path, timeout=0) {
        const uid = 'busy-' + Date.now()
        if(typeof(this.busies) == 'undefined') this.busies = new Map()
        this.busies.set(uid, path)
        renderer.ui.emit('menu-busy', Array.from(this.busies.values()))
        const release = () => {
            this.busies.delete(uid)
            this.busies.size || renderer.ui.emit('menu-busy', false)
        }
        timeout && setTimeout(release, timeout) // busy state blocks the menu, so we should release it after some time
        return {release}
    }
    async withBusy(path, fn, timeout = 0) {
        const busy = this.setBusy(path, timeout);
        try {
            await fn();
        } catch (e) {
            this.displayErr(e);
        } finally {
            busy.release();
        }
    }
    async updateHomeFilters() {
        this.pages[''] = await this.applyFilters([], '')
        this.path || this.refresh()
    }
    async dialog(opts, def, mandatory) {
        let uid = 'ac-' + Date.now()
        renderer.ui.emit('dialog', opts, uid, def, mandatory)
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
                let s = '', c = e.users > 1 ? 'users' : 'user'
                if (typeof(e.trend) == 'number') {
                    if (e.trend == -1) {
                        c = 'caret-down'
                        s = ' style="color: #f30;font-weight: bold;"'
                    } else {
                        c = 'caret-up'
                        s = ' style="color: green;font-weight: bold;"'
                    }
                }
                if (e.usersPercentage) {
                    let p = e.usersPercentage >= 1 ? Math.round(e.usersPercentage) : e.usersPercentage.toFixed(e.usersPercentage >= 0.1 ? 1 : 2)
                    details.push('<i class="fas fa-' + c + '" ' + s + '></i> ' + p + '%')
                } else if (e.users) {
                    details.push('<i class="fas fa-' + c + '" ' + s + '></i> ' + e.users)
                }
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
        if (p != this.path) return
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
        this.deepRead(p).then(async ret => {
            await this.render(ret.entries, p, {
                parent: ret.parent,
                icon: (ret.parent ? ret.fa : '') || 'fas fa-box-open'
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
    async applyFilters(entries, path) {
        for(const filters of [this.filters, this.outputFilters]) {
            for(let i=0; i<filters.length; i++) {
                this.opts.debug && console.log('Menu filter '+ (i + 1) +'/'+ filters.length)
                const es = await filters[i](entries, path).catch(err => console.error(err))
                if (Array.isArray(es)) {
                    entries = es
                } else {
                    this.opts.debug && console.log('Menu filter failure at filter #'+ i, filters[i], es)
                }
            }
        }
        if (Array.isArray(entries)) {
            this.opts.debug && console.log('Menu filtering DONE '+ this.filters.length)
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
                let newPage = page ? page + '/' + name : name
                let entry = this.findEntry(pages[page], name, newPage)
                page = newPage
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
                if (typeof(this.pages[newPage]) != 'undefined') { // fallback
                    console.error('deep path not found, falling back', newPage, this.pages[newPage])
                    return finish(this.pages[newPage])
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
        this.emit('open', destPath)
        let parentEntry, name = basename(destPath), parentPath = this.dirname(destPath)
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
                    return this.render(es, destPath, {parent: e})
                }
            }
        }
        let ret = await this[deep === true ? 'deepRead' : 'read'](parentPath, undefined)
        if (this.opts.debug) {
            console.log('readen2', {ret, page: this.pages[parentPath], parentPath, name, destPath, tabindex, deep, isFolder, backInSelect}, traceback())
        }
        if (ret === -1 || ret === undefined) return
        parentEntry = ret.parent
        let finish = async (es) => {
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
            await this.render(this.pages[this.path], this.path, {parent: parentEntry})
            return true
        }
        if (name) {
            const e = this.findEntry(ret.entries, name, {
                tabindex, isFolder, fullPath: destPath
            })
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
            await this.render(this.pages[this.path], this.path, {parent: parentEntry})
            return true
        }
    }
    async readEntry(e) {
        let entries
        if (!e)
            return []
        if (typeof(e.renderer) == 'function') {
            entries = await e.renderer(e)
        } else if (typeof(e.renderer) == 'string') {
            entries = await storage.get(e.renderer)
        } else {
            entries = e.entries || []
        }
        return Array.isArray(entries) ? entries : []
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
        if (path && (!entries.length || entries[0].type != 'back')) {
            if (!entries.length) {
                entries.push(this.emptyEntry())
            }
            if (backTo) {
                let backEntry = {
                    name: lang.BACK,
                    type: 'back',
                    fa: this.backIcon,
                    path: backTo || this.dirname(path)
                }
                entries.unshift(backEntry)
            } else if (!entries.length || entries[0].type != 'back') {
                entries.unshift({
                    name: lang.BACK,
                    type: 'back',
                    fa: this.backIcon,
                    path: this.dirname(path)
                })
            }
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
        }
        entries = entries.map((e, i) => {
            e.tabindex = i
            return e
        })
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
        return entries.map(e => {
            let n, started
            for(const prop of props) {
                if (typeof(e[prop]) != 'undefined') {
                    if (!started) {
                        n = Object.assign({}, e)
                        started = true
                    }
                    delete n[prop]
                }
            }
            return started ? n : e
        })
    }
    async render(es, path, opts={}) {
        if (this.opts.debug) {
            console.log('render', es, path, opts)
        }
        if (Array.isArray(es)) {
            if(opts.filter === true) {
                es = await this.applyFilters(es, path)
            }
            for (let i = 0; i < es.length; i++) {
                if (!es[i].type) {
                    es[i].type = 'stream'
                }
                if (typeof(es[i].path) !== 'string') {
                    if (es[i].type == 'back') {
                        es[i].path = this.dirname(path)
                    } else {
                        es[i].path = path +'/'+ es[i].name
                    }
                }
            }
            this.currentEntries = es.slice(0)
            this.currentEntries = this.addMetaEntries(this.currentEntries, path, opts.backTo)
            this.pages[path] = this.currentEntries.slice(0)
            this.currentEntries = this.cleanEntries(this.currentEntries, ['renderer','entries','action'])
            if (typeof(path) === 'string') this.path = path
            if (this.rendering) {
                const icon = opts.icon || opts?.parent?.fa || 'fas fa-home'
                const cleanedEntries = this.cleanEntries(this.checkFlags(this.currentEntries), ['checked','users','terms']);
                renderer.ui.emit('render', cleanedEntries, path, icon)
                this.emit('render', this.currentEntries, path)
                this.syncPages()
            }
        }
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

export default (global.menu || (inWorker ? {} : (global.menu = new Menu({}))))
