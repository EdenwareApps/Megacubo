
const Events = require('events'), path = require('path')

class Explorer extends Events {
	constructor(opts, entries){
        super()
        this.pages = {
            '': entries
        }
        this.opts = {
            debug: false
        }
        if(opts){
            this.opts = Object.assign(this.opts, opts)
        }
        this.rendering = true
        this.waitingRender = false
        this.path = ''
        this.filters = []
        this.currentEntries = []
        this.backIcon = 'fas fa-chevron-left'
        this.addFilter((es, path) => { 
            return new Promise((resolve, reject) => {
                resolve(es.map(e => {
                    let o = e
                    if(o){
                        if(!e.path || e.path.indexOf(path) == -1){
                            o.path = e.name
                            if(path){
                                o.path = path +'/'+ o.path
                            }
                        }
                        if(typeof(e.checked) == 'function'){
                            o.value = !!e.checked(e)
                        } else if(typeof(e.value) == 'function'){
                            o.value = e.value()
                        }
                    }
                    return o
                }))
            })
        })
        global.ui.on('explorer-open', (path, tabindex) => {
            if(this.opts.debug){
                console.log('explorer-open', path, tabindex)
            }
            this.open(path, tabindex).catch(global.displayErr)
        })
        global.ui.on('explorer-check', (path, val) => {
            this.check(path, val)
        })
        global.ui.on('explorer-input', (path, val) => {
            if(this.opts.debug){
                console.log('explorer-input', path)
            }
            this.input(path, val)
        })
        global.ui.on('explorer-action', (path, tabindex) => {
            this.action(path, tabindex)
        })
        global.ui.on('explorer-select', (path, tabindex) => {
            this.select(path, tabindex)
        })
        global.ui.on('explorer-back', () => {
            this.back()
        })
        this.applyFilters(this.pages[this.path], this.path).then(es => {
            this.pages[this.path] = es
            if(this.waitingRender){
                this.waitingRender = false
                this.render(this.pages[this.path], this.path, 'fas fa-home')
            }
        }).catch(global.displayErr)
    }
    updateHomeFilters(){
        this.applyFilters(this.pages[''], '').then(es => {
            this.pages[""] = es
            if(this.path == ""){
                this.refresh()
            }
        }).catch(console.error)
    }
    checkFlags(entries){
        return entries.map(n => {
            let e = Object.assign({}, n)
            let details = []
            if(e.details){
                details.push(e.details)
            }
            if(e.users){
                let c = e.users > 1 ? 'users' : 'user'
                details.push('<i class="fas fa-' + c + '"></i> ' + e.users)
            }
            if(e.position && this.path == global.lang.BEEN_WATCHED){
                details.push('<i class="fas fa-trophy" style="transform: scale(0.8)"></i> '+ e.position)
            }
            e.details = details.join(' &middot ')
            return e
        })
    }
    emptyEntry(txt, icon){
        return {
            name: txt || global.lang.EMPTY, 
            icon: icon || 'fas fa-info-circle', 
            type: 'action',
            class: 'entry-empty'
        }
    }
    start(){
        if(typeof(this.pages[this.path]) != 'undefined'){
            this.render(this.pages[this.path], this.path, 'fas fa-home')
        } else {
            this.waitingRender = true
        }
    }
    refresh(force){
        if(this.rendering){
            if(this.path && typeof(this.pages[this.path]) != 'undefined'){
                delete this.pages[this.path]
            }
            this.open(this.path).catch(global.displayErr)
        }
    }
    deepRefresh(p){
        if(this.rendering){
            if(!p){
                p = this.path
            }
            this.suspendRendering()
            this.open('').then(() => {
                this.resumeRendering()
                this.open(p, undefined, true).catch(global.displayErr)
            }).catch(global.displayErr)
        }
    }
    inSelect(){
        if(typeof(this.pages[this.dirname(this.path)]) != 'undefined'){
            let p = this.selectEntry(this.pages[this.dirname(this.path)], this.basename(this.path))
            return p && p.type == 'select'
        }
    }
    back(level, deep){
        let p = this.path
        if(this.opts.debug){
            console.log('back', this.path)
        }
        if(this.path) {
            if(this.inSelect()){
                this.path = this.dirname(this.path)
            }
            if(this.opts.debug){
                console.log('back', this.path, p)
            }
            if(typeof(level) != 'number'){
                level = 1
            }
            while(p && level){
                p = this.dirname(p)
                level--
            }
            if(this.opts.debug){
                console.log('back', p, deep)
            }
            this.open(p, undefined, deep).catch(global.displayErr)
        }
    }
    deepBack(level){
        let p = this.path
        if(this.path) {
            if(this.inSelect()){
                this.path = this.dirname(this.path)
            }
            let next = (e) => {
                let parent = this.selectEntry(this.pages[this.dirname(e.path)], this.basename(e.path))
                this.render(this.pages[e.path], e.path, parent.servedIcon || parent.fa || 'fas fa-folder-open')
            }
            if(typeof(level) != 'number'){
                level = 1
            }
            while(p && level){
                p = this.dirname(p)
                level--
            }
            p = this.selectEntry(this.pages[this.dirname(p)], this.basename(p))
            next(p)
        }
    }
    prependFilter(f){
        this.filters.unshift(f)
    }
    addFilter(f){
        this.filters.push(f)
    }
    applyFilters(entries, path){
        return new Promise((resolve, reject) => {
            let i = 0, next = () => {
                if(typeof(this.filters[i]) == 'undefined'){
                    entries = entries.map(e => {
                        if(typeof(e.path) != 'string'){
                            e.path = path || ''
                        }
                        if(e.path && this.basename(e.path) != e.name){
                            e.path += '/'+ e.name
                        }
                        return e
                    })
                    resolve(entries)
                } else {
                    this.filters[i](entries, path).then(es => {
                        i++
                        entries = es
                        next()
                    }).catch(e => {
                        i++
                        console.error(e)
                        next()
                    })
                }
            }
            next()
        })
    }
    syncPages(){
        Object.keys(this.pages).forEach(page => {
            if(this.path.indexOf(page) == -1){
                delete this.pages[page]
            }
        })
    }
    check(destPath, value){
        let name = this.basename(destPath), dir = this.dirname(destPath)
        if(typeof(this.pages[dir]) == 'undefined'){
            console.error(dir + 'NOT FOUND IN', this.pages)
        } else {
            if(!this.pages[dir].some((e, k) => {
                if(e.name == name){
                    //console.warn('CHECK', dir, k, this.pages[dir])
                    if(typeof(this.pages[dir][k].value) != 'function'){
                        this.pages[dir][k].value = value
                    }
                    if(typeof(e.action) == 'function'){
                        e.action(e, value)
                    }
                    return true
                }
            })){
                console.warn('CHECK '+ destPath +' ('+ value +') NOT FOUND IN ', this.pages)
            }
        }
    }
    input(destPath, value){
        let name = this.basename(destPath), dir = this.dirname(destPath)        
        if(this.opts.debug){
            console.log('input()', destPath, value, name, dir)
        }
        if(typeof(this.pages[dir]) == 'undefined'){
            console.error(dir + 'NOT FOUND IN', this.pages)
        } else {
            let trustedActionTriggered = this.pages[dir].some((e, k) => {
                if(e.name == name){
                    this.pages[dir][k].value = value
                    if(typeof(e.action) == 'function'){
                        e.action(e, value)
                    }
                    return true
                }
            })
            if(!trustedActionTriggered){
                dir = this.path
                this.pages[dir].some((e, k) => {
                    if(e.name == name){
                        this.pages[dir][k].value = value
                        if(typeof(e.action) == 'function'){
                            e.action(e, value)
                        }
                        return true
                    }
                })
            }
        }
    }
    action(destPath, tabindex){
        let name = this.basename(destPath), dir = this.dirname(destPath)
        if(this.opts.debug){
            console.log('action '+ destPath, tabindex)
        }
        if(typeof(this.pages[dir]) == 'undefined'){
            console.error(dir + 'NOT FOUND IN', this.pages)
        } else {
            let inSelect = this.pages[dir].some(e => typeof(e.selected) != 'undefined')
            if(!this.pages[dir].some((e, k) => {
                if(e.name == name && (typeof(tabindex) != 'number' || k == tabindex)){
                    if(inSelect){
                        this.pages[dir][k].selected = true
                    }
                    this.emit('action', e)
                    if(this.inSelect()){
                        this.path = this.dirname(this.path)
                    }
                    return true
                } else {
                    if(inSelect){
                        this.pages[dir][k].selected = false
                    }
                }
            })){
                console.warn('ACTION '+ name +' ('+ tabindex +') NOT FOUND IN ', dir, this.pages)
            }
        }
    }
    basename(path){
        let i = path.lastIndexOf('/')
        if(i == 0){
            return path.substr(1)
        } else if(i == -1) {
            return path
        } else {
            return path.substr(i + 1)
        }
    }
    dirname(path){
        let i = path.lastIndexOf('/')
        if(i <= 0){
            return ''
        } else {
            return path.substr(0, i)
        }
    }
    deepRead(destPath, tabindex){        
        return new Promise((resolve, reject) => {
            if(['.', '/'].includes(destPath)){
                destPath = ''
            }
            let parent, parts = destPath ? destPath.split('/') : [], pages = {'' : this.pages['']}
            let finish = entries => {
                resolve({entries, parent})
            }
            let p = ''
            let next = () => {
                if(parts.length){
                    let n = parts.shift()
                    let np = p ? p + '/' + n : n
                    if(typeof(this.pages[np]) == 'undefined'){
                        let e = this.selectEntry(pages[p], n)
                        p = np
                        if(['group', 'select'].indexOf(e.type) != -1){
                            parent = e
                            this.readEntry(e, p).then(es => {
                                this.applyFilters(es, p).then(es => {
                                    if(e.type == 'group'){
                                        es = this.addMetaEntries(es, p)
                                    }
                                    this.pages[p] = pages[p] = es
                                    next()
                                })
                            }).catch(reject)
                        } else {
                            if(typeof(this.pages[destPath]) != 'undefined'){ // fallback
                                console.error('deep path not found, falling back', destPath, this.pages[destPath])
                                return finish(this.pages[destPath])
                            }
                            reject('deep path not found')
                        }
                    } else {
                        pages[np] = this.pages[np]
                        p = np
                        next()
                    }
                } else {
                    finish(pages[destPath])
                } 
            }
            next()
        })
    }
    read(destPath, tabindex){
        return new Promise((resolve, reject) => {
            if(['.', '/'].includes(destPath)){
                destPath = ''
            }
            let parentPath = this.dirname(destPath)
            if(typeof(this.pages[parentPath]) == 'undefined'){
                return this.deepRead(destPath, tabindex).then(resolve).catch(reject)
            }
            let basePath = this.basename(destPath), finish = (entries, parent) => {
                if(!parent || !['select'].includes(parent.type)){
                    this.path = destPath
                }
                resolve({entries, parent})
            }
            if(!basePath){
                this.applyFilters(this.pages[parentPath], parentPath).then(es => {
                    this.pages[parentPath] = es
                    finish(this.pages[parentPath])
                })
                return
            }
            let page = this.pages[parentPath]
            let hr = page.some((e, i) => {
                if(e.name == basePath && (typeof(tabindex) != 'number' || i == tabindex)){
                    if(['group', 'select'].indexOf(e.type) != -1){
                        this.readEntry(e, parentPath).then(es => {
                            this.applyFilters(es, destPath).then(es => {
                                if(e.type == 'group'){
                                    es = this.addMetaEntries(es, destPath, parentPath)
                                }
                                this.pages[destPath] = es
                                finish(this.pages[destPath], e)
                            })
                        }).catch(reject)
                    }
                    return true
                }
            })
            if(!hr){
                if(typeof(this.pages[destPath]) != 'undefined'){ // fallback
                    console.error('path not found, falling back', destPath, this.pages[destPath])
                    return finish(this.pages[destPath])
                }
                console.error('path not found', page, basePath)
                reject('path not found')
            }
        })
    }
    open(destPath, tabindex, deep){
        if(['.', '/'].includes(destPath)){
            destPath = ''
        }
        if(this.opts.debug){
            console.log('open', destPath, tabindex, traceback())
        }
        return new Promise((resolve, reject) => {
            this.emit('open', destPath)
            let icon = '', name = this.basename(destPath), parentPath = this.dirname(destPath)
            let finish = es => {                
                console.log('explorer.opened', destPath, es, parentPath)
                this.path = destPath
                es = this.addMetaEntries(es, destPath, parentPath)
                this.pages[this.path] = es
                this.render(this.pages[this.path], this.path, icon)
                resolve(true)
            }
            let next = ret => {
                if(this.opts.debug){
                    console.log('readen', destPath, tabindex, ret, traceback())
                }
                icon = ret.parent ? (ret.parent.servedIcon || ret.parent.fa || '') : ''
                if(name){
                    let e = this.selectEntry(ret.entries, name, tabindex)
                    if(e){
                        icon = e.servedIcon || e.fa || ''
                        if(e.type && ['group', 'select'].includes(e.type)){
                            this.readEntry(e, parentPath).then(es => {
                                this.applyFilters(es, destPath).then(finish).catch(reject)
                            }).catch(reject)
                        } else {
                            this.action(destPath, tabindex)
                            resolve(true)
                        }
                    } else {
                        if(typeof(this.pages[destPath]) != 'undefined'){
                            finish(this.pages[destPath])
                        } else {
                            this.open(this.dirname(destPath), undefined, deep).then(resolve).catch(reject)
                        }
                    }
                } else {
                    this.path = destPath
                    this.render(this.pages[this.path], this.path, icon)
                    resolve(true)
                }
            }
            if(parentPath == this.path){
                next({parent: this.selectEntry(this.pages[this.dirname(parentPath)], this.basename(parentPath)), entries: this.pages[this.path]})
                return
            }
            if(this.opts.debug){
                console.log('readen', deep, parentPath, name)
            }
            this[deep === true ? 'deepRead' : 'read'](parentPath).then(next).catch(err => {
                global.displayErr(err)
                if(name){
                    global.ui.emit('set-loading', {name}, false)
                }
                reject(err)
            })
        })
    }
    readEntry(e){
        return new Promise((resolve, reject) => {  
            let next = entries => {
                entries = entries.map(n => {
                    if(typeof(n.path) != 'string'){
                        n.path = e.path || ''
                    }
                    if(n.path){
                        if(this.basename(n.path) != n.name || n.name == e.name){
                            n.path += '/'+ n.name
                        }
                    }
                    return n
                })
                resolve(entries)
            }
            if(typeof(e.renderer) == 'function'){
                e.renderer(e).then(next).catch(reject)
            } else if(typeof(e.renderer) == 'string'){
                global.tstorage.get(e.renderer, entries => {
                    if(Array.isArray(entries)){
                        next(entries)
                    } else {
                        next([])
                    }
                })
            } else {
                next(e.entries || [])
            }
        })
    }
    selectEntry(entries, name, tabindex){
        let ret = false
        entries.some((e, i) => {
            if(e.name == name && (typeof(tabindex) != 'number' || tabindex == i)){
                ret = e
                return true
            }
        })
        return ret
    }
    select(destPath, tabindex){
        if(this.opts.debug){
            console.log('select', destPath, tabindex)
        }
        return new Promise((resolve, reject) => {
            this.read(destPath, tabindex).then(ret => {
                let d = this.dirname(destPath)
                let icon = ret.parent ? (ret.parent.servedIcon ? ret.parent.servedIcon : ret.parent.fa) : ''
                global.ui.emit('explorer-select', ret.entries, destPath, icon)
            }).catch(global.displayErr)
        })
    }
    canApplyStreamTesting(entries){
        return entries.length && entries.some(e => e.url && (!e.type || e.type == 'stream') && !global.mega.isMega(e.url))
    }
    addMetaEntries(entries, path, backTo){
        if(path){
            if(!entries.length || entries[0].type != 'back'){
                if(!entries.length){
                    entries.push(this.emptyEntry())
                }
                let backEntry = {
                    name: global.lang.BACK,
                    type: 'back',
                    fa: this.backIcon,
                    path: backTo || this.dirname(path)
                }
                entries.unshift(backEntry)
                if(!global.config.get('auto-testing')){
                    let has = entries.some(e => e.name == global.lang.TEST_STREAMS)
                    if(!has && this.canApplyStreamTesting(entries)){
                        entries.splice(1, 0, {
                            name: global.lang.TEST_STREAMS,
                            fa: 'fas fa-satellite-dish',
                            type: 'action',
                            action: () => {
                                global.streamState.test(entries)
                            }
                        })
                    }
                }
            }
        }
        entries = entries.map((e, i) => {
            e.tabindex = i
            return e
        })
        return entries
    }
    currentStreamEntries(includeMegaStreams){
        return this.currentEntries.filter(e => {
            return (!e.type ? (typeof(e.url) != 'undefined') : (e.type == 'stream')) && (includeMegaStreams !== true || global.mega.isMega(e.url))
        })
    }
    cleanEntries(entries, props){ // clean entries by removing specific props
        let nentries = []
        entries.forEach(e => {
            let n = Object.assign({}, e)
            props.split(',').forEach(prop => {
                if(typeof(n[prop]) != 'undefined'){
                    delete n[prop]
                }
            })
            nentries.push(n)
        })
        return nentries
    }
    render(es, path, icon, backTo){
        if(this.opts.debug){
            console.log('render', es, path, icon, backTo)
        }
        if(Array.isArray(es)){
            this.currentEntries = es.slice(0)
            this.currentEntries = this.addMetaEntries(this.currentEntries, path, backTo)
            this.currentEntries = this.currentEntries.map((e, i) => {
                if(!e.type){
                    e.type = 'stream'
                }
                if(typeof(e.path) != 'string'){
                    e.path = path || ''
                }
                if(e.path){
                    if(this.basename(e.path) != e.name){
                        e.path += '/'+ e.name
                    }
                }
                return e
            })
            this.pages[path] = this.currentEntries.slice(0)
            this.currentEntries = this.cleanEntries(this.currentEntries, 'renderer,entries,action')
            if(path && this.path != path){
                this.path = path
            }
            this.syncPages()
        }
        if(this.rendering){
            global.ui.emit('render', this.cleanEntries(this.checkFlags(this.currentEntries), 'users,terms'), path, icon)
            this.emit('render', this.currentEntries, path, icon, backTo)
        }
    }
    suspendRendering(){
        this.rendering = false
    }
    resumeRendering(){
        this.rendering = true
    }
}

module.exports = Explorer
