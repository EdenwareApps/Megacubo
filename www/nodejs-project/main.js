console.log('Initializing node...')
process.env.UV_THREADPOOL_SIZE = 16

require('./modules/paths')
if(!paths.cordova) {
    const electron = require('electron')
    if (typeof(electron) === 'string') {
        const { spawn } = require('child_process')
        const args = [__filename, ...process.argv.slice(2)]
        const child = spawn(electron, args, { detached: true, stdio: 'ignore' })
        child.unref()
        process.exit()
    }
}

const fs = require('fs'), path = require('path')
global.ALLOW_ADDING_LISTS = fs.existsSync(paths.cwd +'/ALLOW_ADDING_LISTS.md')
global.ALLOW_COMMUNITY_LISTS = ALLOW_ADDING_LISTS && fs.existsSync(paths.cwd +'/ALLOW_COMMUNITY.md')

require('./modules/supercharge')(global)

const crashlog = require('./modules/crashlog')
process.on('warning', e => console.warn(e, e.stack))
process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled rejection at:', promise, 'reason:', reason, reason.stack || '')
    crashlog.save('Unhandled rejection at:', promise, 'reason:', reason)
})
process.on('uncaughtException', (exception) => {
    console.error('uncaughtException: '+ crashlog.stringify(exception), exception.stack)
    crashlog.save('uncaughtException', exception)
    return false
})

const onexit = require('node-cleanup')
onexit(() => {
    global.isExiting = true
    console.error('APP_EXIT='+ traceback())
    const streamer = require('./modules/streamer/main')
    if(typeof(streamer) != 'undefined' && streamer.active){
        streamer.stop()
    }
    if(global.tuning){
        tuning.destroy()
        tuning = null
    }
    rmdir(paths.temp, false, true)
    if(typeof(renderer) != 'undefined' && renderer){
        renderer.emit('exit', true)
        renderer.destroy()
    }
})

let rendererReadyCallbacks = []
global.rendererReady = (f, done) => {
    const ready = !Array.isArray(rendererReadyCallbacks)
    if(typeof(f) == 'function'){
        if(ready){
            f()
        } else {
            rendererReadyCallbacks.push(f)
        }
    }
    if(!ready && done === true){
        const callbacks = rendererReadyCallbacks
        rendererReadyCallbacks = null
        callbacks.map(f => {
            try {
                const p = f()
                if(p && typeof(p.catch) == 'function') {
                    p.catch(console.error)
                }
            } catch(e) {
                console.error(e)
            }
        })
    }
    return ready
}

const Storage = require('./modules/storage')
global.config = require('./modules/config')(paths.data + '/config.json')
global.storage = new Storage({main: true})
global.Download = require('./modules/download')

let originalConsole
function enableConsole(enable){
    let fns = ['log', 'warn']
    if(typeof(originalConsole) == 'undefined'){ // initialize
        originalConsole = {}
        fns.forEach(f => originalConsole[f] = console[f].bind(console))
        config.on('change', (keys, data) => keys.includes('enable-console') && enableConsole(data['enable-console']))
        if(enable) return // enabled by default, stop here
    }
    if(enable){
        fns.forEach(f => { console[f] = originalConsole[f] })
    } else {
        fns.forEach(f => { console[f] = () => {}})
    }
}

enableConsole(config.get('enable-console') || process.argv.includes('--inspect'))

console.log('Loading modules...')

const Bridge = require('./modules/bridge')
const Language = require('./modules/lang')

console.log('Modules loaded.')

global.renderer = new Bridge()
global.activeEPG = ''
global.tuning = null

global.displayErr = (...args) => {
    console.error.apply(null, args)
    renderer.emit('display-error', args.map(v => String(v)).join(', '))
}

let isStreamerReady, playOnLoaded, tuningHintShown, showingSlowBroadcastDialog

global.updateUserTasks = async app => {
    if(process.platform != 'win32') return
    if(app) { // set from cache, Electron won't set after window is opened
        const tasks = await storage.get('user-tasks')
        if(tasks && !app.setUserTasks(tasks)) {
            throw 'Failed to set user tasks. '+ JSON.stringify(tasks)
        }
        return
    }
    const limit = 12
    const entries = []
    const bookmarks = require('./modules/bookmarks')
    entries.push(...bookmarks.get().slice(0, limit))
    if(entries.length < limit) {
        const history = require('./modules/history')
        for(const entry of history.get()) {
            if(!entries.some(e => e.name == entry.name)) {
                entries.push(entry)
                if(entries.length == limit) break
            }
        }
        const watching = require('./modules/watching')
        if(entries.length < limit && Array.isArray(watching.currentEntries)) {
            for(const entry of watching.currentEntries) {
                if(!entries.some(e => e.name == entry.name)) {
                    entries.push(entry)
                    if(entries.length == limit) break
                }
            }
        }
    }
    const tasks = entries.map(entry => {
        return {
            arguments: '"'+ entry.url +'"',
            title: entry.name,
            description: entry.name,
            program: process.execPath,
            iconPath: process.execPath,
            iconIndex: 0
        }
    })
    await storage.set('user-tasks', tasks, {
        expiration: true,
        permanent: true
    })
}

const setupCompleted = () => {
    const l = config.get('lists')
    const fine = (l && l.length) || config.get('communitary-mode-lists-amount')
    if(fine != config.get('setup-completed')) {
        config.set('setup-completed', fine)        
    }
    return fine
}

const setNetworkConnectionState = state => {
    Download.setNetworkConnectionState(state)
    const lists = require('./modules/lists')
    lists.setNetworkConnectionState(state).catch(console.error)
    if(state && isStreamerReady){
        lists.manager.update()
    }
}

const videoErrorTimeoutCallback = ret => {
    console.log('video-error-timeout-callback', ret)
    const streamer = require('./modules/streamer/main')
    if(ret == 'try-other'){
        streamer.handleFailure(null, 'timeout', true, true).catch(displayErr)
    } else if(ret == 'retry') {
        streamer.reload()
    } else if(ret == 'transcode') {
        streamer.transcode()
    } else if(ret == 'external') {
        renderer.emit('external-player')
    } else if(ret == 'stop') {
        streamer.stop()
    } else {
        renderer.emit('streamer-reset-timeout')
    }
}

const init = (language, timezone) => {
    if(global.lang) return
    global.lang = new Language(language, config.get('locale'), paths.cwd + '/lang', timezone)
    lang.load().catch(displayErr).finally(() => {
        console.log('Language loaded.')

        const OSD = require('./modules/osd')
        const Menu = require('./modules/menu')
        const Channels = require('./modules/channels')
        const Theme = require('./modules/theme')
        const Promoter = require('./modules/promoter')

        const moment = require('moment-timezone')
        moment.locale(lang.locale)

        const lists = require('./modules/lists')
        lists.setNetworkConnectionState(Download.isNetworkConnected).catch(console.error)

        global.channels = new Channels()
        global.theme = new Theme()
        global.osd = new OSD()
        global.menu = new Menu({})

        const streamer = require('./modules/streamer/main')
        rmdir(streamer.opts.workDir, false, true)
        
        console.log('Initializing premium...')
        Premium = require('./modules/premium-helper')
        if(typeof(Premium) != 'undefined'){
			global.premium = new Premium()
		}

        promo = new Promoter()
        
        const streamState = require('./modules/stream-state')
        streamState.on('state', (url, state, source) => {
            if(source) {
                const discovery = require('./modules/discovery')
                discovery.reportHealth(source, state != 'offline')
            }
        })

        const bookmarks = require('./modules/bookmarks')
        const search = require('./modules/search')
        const watching = require('./modules/watching')
        const history = require('./modules/history')
        const options = require('./modules/options')
        const recommendations = require('./modules/recommendations')
        
        menu.addFilter(channels.hook.bind(channels))
        menu.addFilter(bookmarks.hook.bind(bookmarks))
        menu.addFilter(history.hook.bind(history))
        menu.addFilter(watching.hook.bind(watching))
        menu.addFilter(lists.manager.hook.bind(lists.manager))
        menu.addFilter(options.hook.bind(options))
        menu.addFilter(theme.hook.bind(theme))
        menu.addFilter(search.hook.bind(search))
        menu.addFilter(recommendations.hook.bind(recommendations))

        const icons = require('./modules/icon-server')
        renderer.on('menu-update-range', icons.renderRange.bind(icons))
        menu.on('render', icons.render.bind(icons))

        menu.on('action', async e => {
            console.warn('ACTION', e, typeof(e.action))
            if(typeof(e.type) == 'undefined'){
                if(typeof(e.url) == 'string'){
                    e.type = 'stream'
                } else if(typeof(e.action) == 'function') {
                    e.type = 'action'
                }
            }
            switch(e.type){
                case 'stream':
                    if(global.tuning){
                        tuning.destroy()
                        tuning = null
                    }
                    streamer.zap.setZapping(false, null, true)
                    if(typeof(e.action) == 'function') { // execute action for stream, if any
                        let ret = e.action(e)
                        if(ret && ret.catch) ret.catch(console.error)
                    } else {
                        streamer.play(e)
                    }
                    break
                case 'input':
                    if(typeof(e.action) == 'function') {
                        let defaultValue = typeof(e.value) == 'function' ? e.value() : (e.value || undefined)
                        let val = await menu.prompt({
                            question: e.name,
                            placeholder: '',
                            defaultValue,
                            multiline: e.multiline,
                            fa: e.fa
                        })
                        let ret = e.action(e, val)
                        if(ret && ret.catch) ret.catch(console.error)
                    }
                    break
                case 'action':
                    const mega = require('./modules/mega')
                    if(typeof(e.action) == 'function') {
                        let ret = e.action(e)
                        if(ret && ret.catch) ret.catch(displayErr)
                    } else if(e.url && mega.isMega(e.url)) {
                        if(global.tuning){
                            tuning.destroy()
                            tuning = null
                        }
                        streamer.zap.setZapping(false, null, true)
                        streamer.play(e)
                    }
                    break
            }
        })
        renderer.on('config-set', (k, v) => config.set(k, v))
        renderer.on('crash', (...args) => crashlog.save(...args))
        renderer.on('lists-manager', ret => {
            console.log('lists-manager', ret)
            switch(ret){
                case 'agree':
                    renderer.emit('menu-reset-selection')
                    menu.open('', 0).catch(displayErr)
                    config.set('communitary-mode-lists-amount', lists.opts.defaultCommunityModeReach)
                    menu.info(lang.LEGAL_NOTICE, lang.TOS_CONTENT)
                    lists.manager.update()
                    break
                case 'retry':
                    lists.manager.update()
                    break
                case 'add-list':
                    menu.prompt({
                        question: lang[ALLOW_ADDING_LISTS? 'ASK_IPTV_LIST' : 'OPEN_URL'], 
                        placeholder: 'http://.../example.m3u',
                        defaultValue: '',
                        callback: 'lists-manager', 
                        fa: 'fas fa-plus-square'
                    }).catch(console.error)
                    break
                case 'back':
                    menu.refresh()
                    break
                default:
                    lists.manager.addList(ret).catch(displayErr)
                    break
            }
        })
        renderer.on('reload', ret => {
            console.log('reload', ret)
            switch(ret){
                case 'agree':
                    break
                default:
                    lists.manager.addList(ret).catch(displayErr)
                    break
            }
        })
        renderer.on('reload-dialog', async () => {
            console.log('reload-dialog')
            if(!streamer.active) return
            const mega = require('./modules/mega')
            let opts = [{template: 'question', text: lang.RELOAD}], def = 'retry'
            let isCH = streamer.active.type != 'video' && 
                (
                    channels.isChannel(streamer.active.data.terms ? streamer.active.data.terms.name : streamer.active.data.name) 
                    || 
                    mega.isMega(streamer.active.data.originalUrl || streamer.active.data.url)
                )
            if(isCH){
                opts.push({template: 'option', text: lang.PLAY_ALTERNATE, fa: config.get('tuning-icon'), id: 'try-other'})
                def = 'try-other'
            }
            opts.push({template: 'option', text: lang.RELOAD_THIS_BROADCAST, fa: 'fas fa-redo', id: 'retry'})
            if(!paths.cordova){
                opts.push({template: 'option', text: lang.OPEN_EXTERNAL_PLAYER, fa: 'fas fa-window-restore', id: 'external'})
            }
            if(typeof(streamer.active.transcode) == 'function' && !streamer.active.isTranscoding()){
                opts.push({template: 'option', text: lang.FIX_AUDIO_OR_VIDEO +' &middot; '+ lang.TRANSCODE, fa: 'fas fa-film', id: 'transcode'})
            }
            if(opts.length > 2){
                let ret = await menu.dialog(opts, def)
                videoErrorTimeoutCallback(ret)
            } else { // only reload action is available
                streamer.reload()
            }
        })
        renderer.on('testing-stop', () => {
            console.warn('TESTING STOP')
            streamState.cancelTests()
        })
        renderer.on('tuning-stop', () => {
            console.warn('TUNING ABORT')
            if(global.tuning) tuning.destroy()
        })
        renderer.on('tune', () => {
            let data = streamer.active ? streamer.active.data : streamer.lastActiveData
            console.warn('RETUNNING', data)
            if(data) {
                streamer.tune(data).catch(displayErr)
            } else {
                streamer.zap.go().catch(displayErr)
            }
        })
        renderer.on('retry', () => {
            console.warn('RETRYING')
            streamer.reload()
        })
        renderer.on('video-error', async (type, errData) => {
            console.error('VIDEO ERROR', {type, errData})
            if(streamer.zap.isZapping){
                await streamer.zap.go()
            } else if(streamer.active && !streamer.active.isTranscoding()) {
                if(type == 'timeout') {
                    if(!showingSlowBroadcastDialog){
                        let opts = [{template: 'question', text: lang.SLOW_BROADCAST}], def = 'wait'
                        let isCH = streamer.active.type != 'video' && channels.isChannel(streamer.active.data.terms ? streamer.active.data.terms.name : streamer.active.data.name)
                        if(isCH){
                            opts.push({template: 'option', text: lang.PLAY_ALTERNATE, fa: config.get('tuning-icon'), id: 'try-other'})
                            def = 'try-other'
                        }
                        opts.push({template: 'option', text: lang.RELOAD_THIS_BROADCAST, fa: 'fas fa-redo', id: 'retry'})
                        opts.push({template: 'option', text: lang.WAIT, fa: 'fas fa-clock', id: 'wait'})
                        if(!isCH){
                            opts.push({template: 'option', text: lang.STOP, fa: 'fas fa-stop', id: 'stop'})                        
                        }
                        showingSlowBroadcastDialog = true
                        let ret = await menu.dialog(opts, def, true)
                        showingSlowBroadcastDialog = false
                        videoErrorTimeoutCallback(ret)
                    }
                } else {
                    const active = streamer.active
                    if(active) {
                        if(type == 'playback') {
                            if(errData && errData.details && errData.details == 'NetworkError') {
                                type = 'request error'
                            }
                            if(type == 'playback') { // if type stills being 'playback'
                                const data = active.data
                                Object.assign(data, {
                                    allowBlindTrust: false,
                                    skipSample: false
                                })
                                const info = await streamer.info(data.url, 2, data).catch(e => {
                                    type = 'request error'
                                })
                                const ret = await streamer.typeMismatchCheck(info).catch(console.error)
                                if(ret === true) return
                            }
                        }
                        if(!paths.cordova && type == 'playback') {
                            // skip if it's not a false positive due to tuning-blind-trust
                            const openedExternal = await streamer.askExternalPlayer().catch(console.error)
						    if(openedExternal === true) return
                        }
                        streamer.handleFailure(null, type).catch(displayErr)
                    }
                }
            }
        })
        renderer.on('share', () => streamer.share())
        renderer.on('stop', () => {
            if(streamer.active){
                console.warn('STREAMER STOP FROM CLIENT')
                streamer.emit('stop-from-client')
                streamer.stop()
                tuning && tuning.pause()
            }
            let isEPGEnabledPath = !search.isSearching() && channels.loadedEPG && [lang.TRENDING, lang.BOOKMARKS, lang.LIVE].some(p => menu.path.substr(0, p.length) == p)
            if(isEPGEnabledPath){ // update current section data for epg freshness
                menu.refresh()
            }
        })
        renderer.on('open-url', url => {
            console.log('OPENURL', url)
            if(url){
                const isM3U = url.match(new RegExp('(get.php\\?username=|\\.m3u($|[^A-Za-z0-9])|\/supratv\\.)'))
                if(isM3U) {
                    lists.manager.addList(url).catch(displayErr)
                } else {
                    const name = listNameFromURL(url), e = {
                        name, 
                        url, 
                        terms: {
                            name: lists.terms(name), 
                            group: []
                        }
                    }
                    config.set('open-url', url)
                    lists.manager.waitListsReady().then(() => {                       
                        if(isStreamerReady){
                            streamer.play(e)
                        } else {
                            playOnLoaded = e
                        }
                    }).catch(console.error)
                }
            }
        })
        renderer.on('open-name', name => {
            console.log('OPEN STREAM BY NAME', name)
            if(name){
                const mega = require('./modules/mega')
                const e = {name, url: mega.build(name)}
                if(isStreamerReady){
                    streamer.play(e)
                } else {
                    playOnLoaded = e
                }
            }
        })
        renderer.on('about', async () => {
            if(streamer.active){
                await streamer.about()
            } else {
                options.about()
            }
        })
        renderer.on('network-state-up', () => setNetworkConnectionState(true))
        renderer.on('network-state-down', () => setNetworkConnectionState(false))
        renderer.on('network-ip', ip => {
            const np = require('./modules/network-ip')
            if(ip && np.isNetworkIP(ip)){
                np.networkIP = () => ip
            }
        })
        streamer.on('streamer-connect', async (src, codecs, info) => {
            if(!streamer.active) return
            console.error('CONNECT', src, codecs, info)       
            let cantune
            if(streamer.active.mediaType == 'live'){
                if(global.tuning){
                    if(tuning.tuner && tuning.tuner.entries.length > 1){
                        cantune = true
                    }
                } else if(channels.isChannel(info.name)) {
                    cantune = true
                }
            }
            renderer.emit('streamer-connect', src, codecs, '', streamer.active.mediaType, info, cantune)
            if(cantune){
                if(!tuningHintShown && history.get().length){
                    tuningHintShown = true
                }
                if(!tuningHintShown){                        
                    tuningHintShown = true
                    renderer.emit('streamer-show-tune-hint')
                }
            }
        })
        streamer.on('streamer-disconnect', err => {
            console.warn('DISCONNECT', err, tuning !== false)
            renderer.emit('streamer-disconnect', err, tuning !== false)
        })
        streamer.on('stop', (err, data) => {
            renderer.emit('remove-status-flag-from-all', 'fas fa-play-circle faclr-green')
            renderer.emit('set-loading', data, false)
            renderer.emit('streamer-stop')
        })
        config.on('change', (keys, data) => {
            renderer.emit('config', keys, data)
            if(['lists', 'communitary-mode-lists-amount', 'interests'].some(k => keys.includes(k))){
                menu.refresh()
                lists.manager.update()
            }
        })
        renderer.once('menu-ready', () => {
            menu.start()  

            const icons = require('./modules/icon-server')
            icons.refresh()
        })
        renderer.once('streamer-ready', () => {        
            isStreamerReady = true
            streamState.sync()
            rendererReady() || rendererReady(null, true)
            if(!streamer.active){
                lists.manager.waitListsReady().then(() => {
                    if(playOnLoaded){
                        streamer.play(playOnLoaded)
                    } else if(config.get('resume')) {
                        if(menu.path){
                            console.log('resume skipped, user navigated away')
                        } else {
                            console.log('resuming', history.resumed, streamer)
                            history.resume()
                        }
                    }
                    menu.updateHomeFilters()
                }).catch(console.error)
            }
        })
        renderer.once('close', () => {
            console.warn('Client closed!')
            const energy = require('./modules/energy')
            energy.exit()
        })
        renderer.once('exit', () => {
            console.error('Immediate exit called from client.')
            process.exit(0)
        })
        renderer.on('suspend', () => { // cordova only
            if(streamer.active && !config.get('miniplayer-auto')){
                streamer.stop()
            }
            tuning && tuning.destroy()
            streamState && streamState.cancelTests()
        })

        rendererReady(async () => {
            const updatePrompt = async c => { // 'recursive-ready' update dialog
                let chosen = await menu.dialog([
                    {template: 'question', text: ucWords(paths.manifest.name) +' v'+ paths.manifest.version +' > v'+ c.version, fa: 'fas fa-star'},
                    {template: 'message', text: lang.NEW_VERSION_AVAILABLE},
                    {template: 'option', text: lang.YES, id: 'yes', fa: 'fas fa-check-circle'},
                    {template: 'option', text: lang.HOW_TO_UPDATE, id: 'how', fa: 'fas fa-question-circle'},
                    {template: 'option', text: lang.WHATS_NEW, id: 'changelog', fa: 'fas fa-info-circle'},
                    {template: 'option', text: lang.NO_THANKS, id: 'no', fa: 'fas fa-times-circle'}
                ], 'yes')
                console.log('update callback', chosen)
                if(chosen == 'yes'){
                    renderer.emit('open-external-url', 'https://megacubo.net/update?ver=' + paths.manifest.version)
                } else if(chosen == 'how') {
                    await menu.dialog([
                        {template: 'question', text: lang.HOW_TO_UPDATE, fa: 'fas fa-question-circle'},
                        {template: 'message', text: lang.UPDATE_APP_INFO},
                        {template: 'option', text: 'OK', id: 'submit', fa: 'fas fa-check-circle'}
                    ], 'yes')
                    await updatePrompt(c)
                } else if(chosen == 'changelog') {
                    renderer.emit('open-external-url', 'https://github.com/EdenwareApps/Megacubo/releases/latest')
                    await updatePrompt(c)
                }
            }

            const setupComplete = setupCompleted()
            if(!setupComplete) {
                const Wizard = require('./modules/wizard');
                const wizard = new Wizard()
                await wizard.init()
            }

            const downloads = require('./modules/downloads')
            menu.addFilter(downloads.hook.bind(downloads))
            await crashlog.send().catch(console.error) 
                       
            lists.manager.update()
            await lists.manager.waitListsReady()

            console.log('WaitListsReady resolved!')
            const cloud = require('./modules/cloud')
            let err, c = await cloud.get('configure').catch(e => err = e) // all below in func depends on 'configure' data
            if(err) {
                console.error(err)
                c = {}
            }
            await options.updateEPGConfig(c).catch(console.error)
            console.log('checking update...')
            if(!config.get('hide-updates')){
                if(c.version > paths.manifest.version){
                    console.log('new version found', c.version)
                    await updatePrompt(c)
                } else {
                    console.log('updated')
                }
            }
            renderer.emit('arguments', process.argv)
        })
        
        console.warn('Prepared to connect...')
        renderer.emit('main-ready', config.all(), lang.getTexts())
                
        require('./modules/analytics')
        require('./modules/omni')
    })
}

renderer.once('get-lang-callback', (locale, timezone, ua, online) => {
    console.log('get-lang-callback', timezone, ua, online)
    if(timezone){
        const moment = require('moment-timezone')
        moment.tz.setDefault(timezone.name)
    }
    if(ua && ua != config.get('default-user-agent')){
        config.set('default-user-agent', ua)
    }
    if(typeof(online) == 'boolean'){
        setNetworkConnectionState(online)
    }
    if(!global.lang){
        console.log('get-lang-callback 1')
        init(locale, timezone)
    } else {
        console.log('get-lang-callback 2')
        lang.ready().catch(displayErr).finally(() => {
            renderer.emit('main-ready', config.all(), lang.getTexts())        
        })
    }
})

if(paths.cordova) {
    renderer.emit('get-lang')
} else {
    const tcpFastOpen = config.get('tcp-fast-open') ? 'true' : 'false'
    const contextIsolation = parseFloat(process.versions.electron) >= 22
    contextIsolation && require('@electron/remote/main').initialize()
    const { app, BrowserWindow, globalShortcut, Menu } = require('electron')

    app.requestSingleInstanceLock() || app.quit()    
    Menu.setApplicationMenu(null)
    onexit(() => app.quit())
    if(contextIsolation){
        app.once('browser-window-created', (_, window) => {
            require('@electron/remote/main').enable(window.webContents)
        })
    }

    const initAppWindow = async () => {
        const isLinux = process.platform == 'linux'
        await updateUserTasks(app).catch(console.error)

        if (config.get('gpu')) {
            config.get('gpu-flags').forEach(f => {
                if (isLinux && f == 'in-process-gpu') {
                    // --in-process-gpu chromium flag is enabled by default to prevent IPC
                    // but it causes fatal error on Linux
                    return
                }
                app.commandLine.appendSwitch(f)
            })
        } else {
            app.disableHardwareAcceleration()
        }

        app.commandLine.appendSwitch('no-zygote')
        app.commandLine.appendSwitch('no-sandbox')
        app.commandLine.appendSwitch('no-prefetch')
        app.commandLine.appendSwitch('disable-websql', 'true')
        app.commandLine.appendSwitch('password-store', 'basic')
        app.commandLine.appendSwitch('disable-http-cache', 'true')
        app.commandLine.appendSwitch('enable-tcp-fast-open', tcpFastOpen) // networking environments that do not fully support the TCP Fast Open standard may have problems connecting to some websites
        app.commandLine.appendSwitch('disable-transparency', 'true')
        app.commandLine.appendSwitch('disable-site-isolation-trials')
        app.commandLine.appendSwitch('enable-smooth-scrolling', 'true')
        app.commandLine.appendSwitch('enable-experimental-web-platform-features') // audioTracks support
        app.commandLine.appendSwitch('enable-features', 'PlatformHEVCDecoderSupport')  // TODO: Allow user to activate Metal (macOS) and VaapiVideoDecoder (Linux) features
        app.commandLine.appendSwitch('disable-features', 'IsolateOrigins,SitePerProcess,NetworkPrediction')
        app.commandLine.appendSwitch('disable-web-security')
        
        await app.whenReady()
        global.window = new BrowserWindow({ // this global will be accessed from preload.js
            width: 320,
            height: 240,
            frame: false,
            maximizable: false, // macos
            minimizable: false, // macos
            titleBarStyle: 'hidden',
            webPreferences: {
                cache: false,
                sandbox: false,
                fullscreenable: true,
                disablePreconnect: true,
                dnsPrefetchingEnabled: false,
                contextIsolation, // false is required for nodeIntegration, but true is required for preload script
                nodeIntegration: false,
                nodeIntegrationInWorker: false,
                nodeIntegrationInSubFrames: false,
                preload: path.join(paths.cwd, 'preload.js'),
                enableRemoteModule: true,
                experimentalFeatures: true, // audioTracks support
                webSecurity: false // desabilita o webSecurity
            }
        })
        window.loadURL('http://127.0.0.1:'+ renderer.opts.port +'/renderer/electron.html', {userAgent: renderer.ua}) // file:// is required on Linux to prevent blank window on Electron 9.1.2
        app.on('browser-window-focus', () => {
            // We'll use Ctrl+M to enable Miniplayer instead of minimizing
            globalShortcut.registerAll(['CommandOrControl+M'], () => { return })
            globalShortcut.registerAll(['F11'], () => { return })
        })
        app.on('browser-window-blur', () => {
            globalShortcut.unregisterAll()
        })
        app.on('second-instance', (event, commandLine) => {
            if (window) {
                window.isMinimized() || window.restore()
                window.focus()
                renderer.emit('arguments', commandLine)
            }
        })
        window.once('closed', () => window.closed = true) // prevent bridge IPC error
        renderer.setElectronWindow(window)
    }

    initAppWindow().catch(console.error)
}
