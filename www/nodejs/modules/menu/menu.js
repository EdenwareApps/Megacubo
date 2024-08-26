import { EventEmitter } from 'events'
import { basename, traceback } from '../utils/utils.js'
import lang from '../lang/lang.js'
import storage from '../storage/storage.js'
import Limiter from '../limiter/limiter.js'
import mega from '../mega/mega.js'
import config from '../config/config.js'
import renderer from '../bridge/bridge.js'

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
        this.addFilter(async (es, path) => {
            return es.map(e => {
                let o = e
                if (o) {
                    if (!e.path || e.path.indexOf(path) == -1) {
                        o.path = e.name
                        if (path) {
                            o.path = path + '/' + o.path
                        }
                    }
                    if (typeof (e.checked) == 'function') {
                        o.value = !!e.checked(e)
                    } else if (typeof (e.value) == 'function') {
                        o.value = e.value()
                    }
                }
                return o
            })
        })
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
        const ui = renderer.get()
        renderer.ready(async () => {
            global.streamer.on('streamer-connect', () => {
                this.softRefreshLimiter.limiter.pause()
                this.deepRefreshLimiter.limiter.pause()
            })
            global.streamer.on('streamer-disconnect', () => {
                this.softRefreshLimiter.limiter.resume()
                this.deepRefreshLimiter.limiter.resume()
            })
            ui.on('menu-playing', showing => {                
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
        })
        ui.on('menu-open', (path, tabindex) => {
            if (this.opts.debug) {
                console.log('menu-open', path, tabindex)
            }
            this.open(path, tabindex).catch(e => this.displayErr(e))
        })
        ui.on('menu-action', (path, tabindex) => this.action(path, tabindex))
        ui.on('menu-back', () => this.back())
        ui.on('menu-check', (path, val) => this.check(path, val))
        ui.on('menu-input', (path, val) => {
            if (this.opts.debug) {
                console.log('menu-input', path, val)
            }
            this.input(path, val)
        })
        ui.on('menu-select', (path, tabindex) => {
            this.select(path, tabindex).catch(e => this.displayErr(e))
        })
        this.applyFilters(this.pages[this.path], this.path).then(es => {
            this.pages[this.path] = es
            if (this.waitingRender) {
                this.waitingRender = false
                this.render(this.pages[this.path], this.path, 'fas fa-home')
            }
        }).catch(e => this.displayErr(e))
    }
    async updateHomeFilters() {
        this.pages[''] = await this.applyFilters([], '')
        this.path || this.refresh()
    }
    dialog(opts, def, mandatory) {
        return new Promise((resolve, reject) => {
            let uid = 'ac-' + Date.now()
            renderer.get().once(uid, ret => resolve(ret))
            renderer.get().emit('dialog', opts, uid, def, mandatory)
        })
    }
    prompt(atts) {
        return new Promise((resolve, reject) => {
            if (!atts.placeholder)
                atts.placeholder = atts.question
            if (!atts.callback)
                atts.callback = 'ac-' + Date.now()
            renderer.get().once(atts.callback, ret => resolve(ret))
            renderer.get().emit('prompt', atts)
        })
    }
    info(question, message, fa) {
        renderer.get().emit('info', question, message, fa)
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
                if (typeof (e.trend) == 'number') {
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
        if (typeof (this.pages[this.path]) != 'undefined') {
            this.render(this.pages[this.path], this.path, 'fas fa-home')
        } else {
            this.waitingRender = true
        }
    }
    refresh(deep = false, p) {
        if (this.rendering) {
            const type = deep === true ? 'deepRefreshLimiter' : 'softRefreshLimiter'
            this.refreshingPath = this.path
            if (this[type].path == this.path) {
                this[type].limiter.call()
            } else {
                this[type].path = this.path
                this[type].limiter.skip(p)
            }
        }
    }
    refreshNow() {
        this.softRefresh(this.path, true)
    }
    softRefresh(p, force) {
        if (force !== true && this.refreshingPath != this.path)
            return
        if (!this.startExecTime)
            this.startExecTime = (Date.now() / 1000)
        if (this.rendering) {
            if (this.path && typeof (this.pages[this.path]) != 'undefined') {
                delete this.pages[this.path]
            }
            this.open(this.path).catch(e => this.displayErr(e))
        }
    }
    deepRefresh(p, force) {
        if (force !== true && this.refreshingPath != this.path)
            return
        if (!this.startExecTime)
            this.startExecTime = (Date.now() / 1000)
        if (this.rendering) {
            if (!p) {
                p = this.path
            }
            this.deepRead(p).then(ret => {
                this.render(ret.entries, p, (ret.parent ? ret.fa : '') || 'fas fa-box-open')
            }).catch(e => this.displayErr(e))
        }
    }
    inSelect() {
        if (typeof (this.pages[this.dirname(this.path)]) != 'undefined') {
            let p = this.findEntry(this.pages[this.dirname(this.path)], basename(this.path))
            return p && p.type == 'select'
        }
    }
    back(level, deep) {
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
            if (typeof (level) != 'number') {
                level = 1
            }
            while (p && level > 0) {
                p = this.dirname(p)
                level--
            }
            if (this.opts.debug) {
                console.log('back', p, deep)
            }
            this.open(p, undefined, deep, true, true, true).catch(e => this.displayErr(e))
        } else {
            this.refresh()
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
                const es = await filters[i](entries, path).catch(console.error)
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
            entries = entries.map(e => {
                if (!e.path) {
                    e.path = basePath + e.name
                } else if (e.path && basename(e.path) !== e.name) {
                    e.path += '/' + e.name
                }
                return e
            })
            this.opts.debug && console.log('Menu filtering DONE* ', !!paths.inWorker)
        }
        return entries || []
    }
    syncPages() {
        Object.keys(this.pages).forEach(page => {
            if (this.path && this.path.indexOf(page) == -1) {
                delete this.pages[page]
            }
        })
    }
    check(destPath, value) {
        let name = basename(destPath), dir = this.dirname(destPath)
        if (typeof (this.pages[dir]) == 'undefined') {
            console.error(dir + 'NOT FOUND IN', this.pages)
        } else {
            if (!this.pages[dir].some((e, k) => {
                if (e.name == name) {
                    //console.warn('CHECK', dir, k, this.pages[dir])
                    if (typeof (this.pages[dir][k].value) != 'function') {
                        this.pages[dir][k].value = value
                    }
                    if (typeof (e.action) == 'function') {
                        let ret = e.action(e, value)
                        if (ret && ret.catch)
                            ret.catch(console.error)
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
        if (typeof (this.pages[dir]) == 'undefined') {
            console.error(dir + 'NOT FOUND IN', this.pages)
        } else {
            let trustedActionTriggered = this.pages[dir].some((e, k) => {
                if (e.name == name && ['input', 'slider'].includes(e.type)) {
                    this.pages[dir][k].value = value
                    if (typeof (e.action) == 'function') {
                        let ret = e.action(e, value)
                        if (ret && ret.catch)
                            ret.catch(console.error)
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
                            if (typeof (e.action) == 'function') {
                                let ret = e.action(e, value)
                                if (ret && ret.catch)
                                    ret.catch(console.error)
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
    action(destPath, tabindex) {
        let name = basename(destPath), dir = this.dirname(destPath)
        if (this.opts.debug) {
            console.log('action ' + destPath + ' | ' + dir, tabindex)
        }
        if (typeof (this.pages[dir]) == 'undefined') {
            console.error(dir + 'NOT FOUND IN', this.pages)
        } else {
            const inSelect = this.pages[dir].some(e => typeof (e.selected) != 'undefined')
            let i = this.findEntryIndex(this.pages[dir], name, tabindex)
            if(typeof(i) == 'number') {
                if (inSelect) {
                    this.pages[dir].forEach((e, j) => {
                        this.pages[dir][i].selected = j == i    
                    })
                }
                this.emit('action', this.pages[dir][i])
                if (inSelect) {
                    this.path = this.dirname(this.path)
                }
                return true
            } else {
                console.warn('ACTION ' + name + ' (' + tabindex + ') NOT FOUND IN ', { dir }, this.pages[dir])
            }
        }
    }
    setLoadingEntries(es, state, txt) {
        es.map(e => {
            if (typeof (e) == 'string') {
                return { name: e }
            } else {
                let _e = {};
                ['path', 'url', 'name', 'tabindex'].forEach(att => {
                    if (e[att]) {
                        _e[att] = e[att]
                    }
                });
                return _e
            }
        }).forEach(e => renderer.get().emit('set-loading', e, state, txt))
    }
    dirname(path) {
        let i = path.lastIndexOf('/')
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
                let entry = this.findEntry(pages[page], name)
                page = newPage
                if (['group', 'select'].indexOf(entry.type) != -1) {
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
                    return await next()
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
        return await next()
    }
    async read(destPath, tabindex, allowCache) {
        const refPath = this.path
        if (['.', '/'].includes(destPath)) {
            destPath = ''
        }
        let parentPath = this.dirname(destPath)
        if (typeof (this.pages[parentPath]) == 'undefined') {
            return await this.deepRead(destPath, tabindex)
        }
        let basePath = basename(destPath), finish = (entries, parent) => {
            if (![refPath, destPath].includes(this.path)) {
                console.warn('Out of sync read() blocked', refPath, destPath, this.path)
                return -1 // user already navigated away, abort it
            }
            if (!parent || !['select'].includes(parent.type)) {
                this.path = destPath
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
            if (['group', 'select'].indexOf(e.type) != -1) {
                if (allowCache && typeof (this.pages[destPath]) != 'undefined') {
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
            if (typeof (this.pages[destPath]) != 'undefined') { // fallback
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
        if (Array.isArray(this.pages[parentPath])) {
            const i = this.pages[parentPath].findIndex(e => e.name == name)
            if (i != -1) {
                const e = this.pages[parentPath][i]
                if (e.url && (!e.type || e.type == 'stream')) { // force search results to open directly
                    return this.action(destPath, tabindex)
                }
            }
        }
        let finish = async (es) => {
            if (backInSelect && parentEntry && parentEntry.type == 'select') {
                if (this.opts.debug) {
                    console.log('backInSelect', backInSelect, parentEntry, destPath)
                }
                return await this.open(this.dirname(destPath), -1, deep, isFolder, backInSelect)
            }
            this.path = destPath
            es = this.addMetaEntries(es, destPath, parentPath)
            this.pages[this.path] = es
            await this.render(this.pages[this.path], this.path, parentEntry)
            return true
        }
        let ret = await this[deep === true ? 'deepRead' : 'read'](parentPath, undefined)
        if (this.opts.debug) {
            console.log('readen', {parentPath, name, destPath, tabindex, deep, isFolder, backInSelect}, traceback())
        }
        if (ret == -1)
            return
        parentEntry = ret.parent
        if (name) {
            let e = this.findEntry(ret.entries, name, tabindex, isFolder)
            if (this.opts.debug) {
                console.log('findEntry', destPath, ret.entries, name, tabindex, isFolder, e)
            }
            if (e) {
                parentEntry = e
                if (e.type == 'group') {
                    let es = await this.readEntry(e, parentPath)
                    es = await this.applyFilters(es, destPath)
                    return await finish(es)
                } else if (e.type == 'select') {
                    if (backInSelect) {
                        return await this.open(this.dirname(destPath), -1, deep, isFolder, backInSelect)
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
                if (typeof (this.pages[destPath]) != 'undefined') {
                    return await finish(this.pages[destPath])
                } else {
                    return await this.open(this.dirname(destPath), undefined, deep, undefined, backInSelect)
                }
            }
        } else {
            this.path = destPath
            await this.render(this.pages[this.path], this.path, parentEntry)
            return true
        }
    }
    async readEntry(e) {
        let entries
        if (!e)
            return []
        if (typeof (e.renderer) == 'function') {
            entries = await e.renderer(e)
        } else if (typeof (e.renderer) == 'string') {
            entries = await storage.get(e.renderer)
        } else {
            entries = e.entries || []
        }
        if (Array.isArray(entries)) {
            return entries.map(n => {
                if (typeof (n.path) != 'string') {
                    n.path = (e.path ? e.path + '/' : '') + n.name
                } else {
                    if (n.path) {
                        if (basename(n.path) != n.name || (n.name == e.name && basename(this.dirname(n.path)) != n.name)) {
                            if (this.opts.debug) {
                                console.log('npath', n.path, n.name, n, e)
                            }
                            n.path += '/' + n.name
                        }
                    }
                }
                return n
            })
        }
        return []
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
    findEntry(entries, name, tabindex, isFolder) {
        let i = this.findEntryIndex(entries, name, tabindex, isFolder)
        return i === false ? false : entries[i]
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
                renderer.get().emit('menu-select', ret.entries, destPath, icon)
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
            let backEntry = {
                name: lang.BACK,
                type: 'back',
                fa: this.backIcon,
                path: backTo || this.dirname(path)
            }
            entries.unshift(backEntry)
            if (!config.get('auto-test')) {
                let has = entries.some(e => e.name == lang.TEST_STREAMS)
                if (!has && this.canApplyStreamTesting(entries)) {
                    entries.splice(1, 0, {
                        name: lang.TEST_STREAMS,
                        fa: 'fas fa-satellite-dish',
                        type: 'action',
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
        let nentries = []
        entries.forEach(e => {
            let n = Object.assign({}, e)
            props.split(',').forEach(prop => {
                if (typeof (n[prop]) != 'undefined') {
                    delete n[prop]
                }
            })
            nentries.push(n)
        })
        return nentries
    }
    render(es, path, parentEntryOrIcon, backTo) {
        if (this.opts.debug) {
            console.log('render', es, path, parentEntryOrIcon, backTo)
        }
        if (Array.isArray(es)) {
            this.currentEntries = es.slice(0)
            this.currentEntries = this.addMetaEntries(this.currentEntries, path, backTo)
            this.currentEntries = this.currentEntries.map((e, i) => {
                if (!e.type) {
                    e.type = 'stream'
                }
                if (typeof (e.path) != 'string') {
                    e.path = path || ''
                }
                if (e.path) {
                    if (basename(e.path) != e.name) {
                        e.path += '/' + e.name
                    }
                }
                return e
            })
            this.pages[path] = this.currentEntries.slice(0)
            this.currentEntries = this.cleanEntries(this.currentEntries, 'renderer,entries,action')
            if (path && this.path != path)
                this.path = path
        }
        if (this.rendering) {
            const icon = typeof (parentEntryOrIcon) == 'string' ? parentEntryOrIcon : (parentEntryOrIcon ? parentEntryOrIcon.fa : 'fas fa-home')
            renderer.get().emit('render', this.cleanEntries(this.checkFlags(this.currentEntries), 'checked,users,terms'), path, icon)
            this.emit('render', this.currentEntries, path, parentEntryOrIcon, backTo)
            this.syncPages()
        }
    }
    suspendRendering() {
        this.rendering = false
    }
    resumeRendering() {
        this.rendering = true
    }
    chooseFile(mimeTypes = '*') {
        return new Promise((resolve, reject) => {
            const id = 'menu-choose-file-' + parseInt(10000000 * Math.random())
            renderer.get().once(id, data => {
                if (data == null)
                    return reject('File not selected')
                renderer.get().resolveFileFromClient(data).then(resolve).catch(reject)
            })
            renderer.get().emit('open-file', renderer.get().uploadURL, id, mimeTypes)
        })
    }
    displayErr(...args) {
        console.error(...args)
        console.error('TRACEBACK = '+traceback())
        renderer.get().emit('display-error', args.map(v => String(v)).join(', '))
    }
}

export default (global.menu || (global.menu = new Menu({})))
