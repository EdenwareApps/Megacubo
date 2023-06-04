console.log('Initializing node...')
process.env.UV_THREADPOOL_SIZE = 16

global.cordova = false

try {
    if(require.resolve('cordova-bridge')){
        global.cordova = require('cordova-bridge')
    }
} catch(e) {
    global.cordova = false
}

if(!global.cordova){    
    const electron = require('electron')
    if(typeof(electron) == 'string'){ // get electron path and relaunch from it
        const { spawn } = require('child_process')
        spawn(electron, [__filename], { detached: true, stdio: 'ignore' }).unref()
        process.exit()
    }
}

// Buffer = require('safe-buffer').Buffer
const fs = require('fs'), path = require('path'), sanitizeFilename = require('sanitize-filename')

global.APPDIR = String(__dirname || process.cwd()).replace(new RegExp('\\\\', 'g'), '/')
if(!global.APPDIR.endsWith('/package.nw') && !fs.existsSync(global.APPDIR + '/package.json')){
    global.APPDIR += '/package.nw'
}
global.MANIFEST = JSON.parse(fs.readFileSync(global.APPDIR + '/package.json'))

global.tuning = false
global.moment = require('moment-timezone')
global.onexit = require('node-cleanup')
global.sanitize = txt => sanitizeFilename(txt).replace(new RegExp('[^\x00-\x7F]+', 'g'), '')

require('./modules/supercharge')(global)

if(global.cordova){
    let datadir = global.cordova.app.datadir(), temp = path.join(path.dirname(datadir), 'cache')
    global.paths = {data: datadir +'/Data', temp}
} else {
    if(fs.existsSync(global.APPDIR +'/.portable') && checkDirWritePermissionSync(global.APPDIR +'/.portable')) {
        global.paths = {data: global.APPDIR +'/.portable/Data', temp: global.APPDIR +'/.portable/temp'}
    } else {
    	global.paths = require('env-paths')(global.global.MANIFEST.window.title, {suffix: ''})
    }
}

Object.keys(global.paths).forEach(k => {
    global.paths[k] = forwardSlashes(global.paths[k])
    console.log('DEFAULT PATH ' + k + '=' + global.paths[k])
})

global.crashlog = require('./modules/crashlog')

process.on('warning', e => {
    console.warn(e, e.stack)
})
process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason, reason.stack || '')
    global.crashlog.save('Unhandled Rejection at:', promise, 'reason:', reason)
})
process.on('uncaughtException', (exception) => {
    console.error('uncaughtException: '+ global.crashlog.stringify(exception), exception.stack)
    global.crashlog.save('uncaughtException', exception)
    return false
})

global.storage = require('./modules/storage')({main: true})

global.onexit(() => {
    global.isExiting = true
    console.log('APP_EXIT', traceback())
    if(typeof(global.streamer) != 'undefined' && global.streamer.active){
        global.streamer.stop()
    }
    if(typeof(global.tuning) != 'undefined' && global.tuning){
        global.tuning.destroy()
    }
    if(typeof(global.ui) != 'undefined' && global.ui){
        global.ui.emit('exit', true)
        global.ui.destroy()
    }
})

let uiReadyCallbacks = []
global.uiReady = (f, done) => {
    const ready = !Array.isArray(uiReadyCallbacks)
    if(typeof(f) == 'function'){
        if(ready){
            f()
        } else {
            uiReadyCallbacks.push(f)
        }
    }
    if(!ready && done === true){
        uiReadyCallbacks.map(f => f())
        uiReadyCallbacks = null
    }
    return ready
}

global.config = require('./modules/config')(global.paths['data'] + '/config.json')
global.Download = require('./modules/download')
global.jimp = null

let originalConsole
function enableConsole(enable){
    let fns = ['log', 'warn']
    if(typeof(originalConsole) == 'undefined'){ // initialize
        originalConsole = {}
        fns.forEach(f => originalConsole[f] = console[f].bind(console))
        global.config.on('change', (keys, data) => keys.includes('enable-console') && enableConsole(data['enable-console']))
        if(enable) return // enabled by default, stop here
    }
    if(enable){
        fns.forEach(f => { console[f] = originalConsole[f] })
    } else {
        fns.forEach(f => { console[f] = () => {}})
    }
}

enableConsole(global.config.get('enable-console'))

console.log('Loading modules...')

const Bridge = require('./modules/bridge')
const FFMPEG = require('./modules/ffmpeg')
const Explorer = require('./modules/explorer')
const Language = require('./modules/lang')
const Cloud = require('./modules/cloud')
const Channels = require('./modules/channels')
const IconServer = require('./modules/icon-server')
const Streamer = require('./modules/streamer')
const OSD = require('./modules/osd')
const Options = require('./modules/options')
const Search = require('./modules/search')
const History = require('./modules/history')
const Bookmarks = require('./modules/bookmarks')
const Watching = require('./modules/watching')
const Theme = require('./modules/theme')
const Energy = require('./modules/energy')
const Analytics = require('./modules/analytics')
const Diagnostics = require('./modules/diagnostics')
const StreamState = require('./modules/stream-state')
const Downloads = require('./modules/downloads')
const OMNI = require('./modules/omni')
const Mega = require('./modules/mega')

console.log('Modules loaded.')

global.ui = new Bridge()
global.ffmpeg = new FFMPEG()
global.lang = false
global.activeEPG = ''

let isStreamerReady = false

global.displayErr = (...args) => {
    console.error.apply(null, args)
    global.ui.emit('display-error', args.map(v => String(v)).join(', '))
}

global.setNetworkConnectionState = state => {
    global.Download.setNetworkConnectionState(state)
    if(typeof(lists) != 'undefined'){
        global.lists.setNetworkConnectionState(state).catch(console.error)
        if(state && isStreamerReady){
            global.lists.manager.update()
        }
    }
}

global.setupCompleted = () => {
    const l = global.config.get('lists')
    const fine = (l && l.length) || global.config.get('communitary-mode-lists-amount')
    if(fine != global.config.get('setup-completed')) {
        global.config.set('setup-completed', fine)        
    }
    return fine
}

let playOnLoaded, tuningHintShown, showingSlowBroadcastDialog

const videoErrorTimeoutCallback = ret => {
    console.log('video-error-timeout-callback', ret)
    if(ret == 'try-other'){
        global.streamer.handleFailure(null, 'timeout', true, true)
    } else if(ret == 'retry') {
        global.streamer.retry()
    } else if(ret == 'transcode') {
        global.streamer.transcode()
    } else if(ret == 'stop') {
        global.streamer.stop()
    } else {
        global.ui.emit('streamer-reset-timeout')
    }
}


const init = (language, timezone) => {
    if(global.lang) return
    global.lang = new Language(language, global.config.get('locale'), global.APPDIR + '/lang', timezone)
    global.lang.load().catch(global.displayErr).finally(() => {
        console.log('Language loaded.')       
        global.jimp = require('./modules/jimp-wrapper')

        global.moment.locale(global.lang.locale)
        global.cloud = new Cloud()
        
        const Lists = require('./modules/lists')
        const Discovery = require('./modules/discovery')
        
        global.osd = new OSD()
        global.discovery = new Discovery()
        global.discovery.register(global.cloud.discovery.bind(global.cloud), 24 * 3600)

        global.lists = new Lists()
        global.lists.setNetworkConnectionState(global.Download.isNetworkConnected).catch(console.error)       

        const omni = new OMNI()
        
        global.mega = new Mega()
        global.energy = new Energy()
        global.streamer = new Streamer()
        global.channels = new Channels()
        global.downloads = new Downloads(global.paths.temp)
        global.theme = new Theme()
        global.search = new Search()
        global.histo = new History()
        global.options = new Options()
        global.watching = new Watching()
        global.bookmarks = new Bookmarks()
        global.icons = new IconServer({folder: global.paths['data'] + '/icons'})        

        global.rmdir(global.streamer.opts.workDir, false, true)

        global.explorer = new Explorer({})
        
        console.log('Initializing premium...')
        Premium = require('./modules/premium-helper')
        if(typeof(Premium) != 'undefined'){
			global.premium = new Premium()
		}

        streamState = new StreamState()
        streamState.on('state', (url, state) => {
            if(!global.explorer.pages[global.explorer.path]) return
            let source = ''
            global.explorer.pages[global.explorer.path].some(e => {
                if(e.url == url){
                    source = e.source
                    return true
                }
            })
            if(source){
                global.discovery.reportHealth(source, state != 'offline')
            }
        })

        global.explorer.addFilter(global.channels.hook.bind(global.channels))
        global.explorer.addFilter(global.bookmarks.hook.bind(global.bookmarks))
        global.explorer.addFilter(global.histo.hook.bind(global.histo))
        global.explorer.addFilter(global.watching.hook.bind(global.watching))
        global.explorer.addFilter(global.lists.manager.hook.bind(global.lists.manager))
        global.explorer.addFilter(global.options.hook.bind(global.options))
        global.explorer.addFilter(global.theme.hook.bind(global.theme))
        global.explorer.addFilter(global.search.hook.bind(global.search))

        global.ui.on('explorer-update-range', global.icons.renderRange.bind(global.icons))
        global.explorer.on('render', global.icons.render.bind(global.icons))

        global.explorer.on('action', async e => {
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
                        global.tuning.destroy()
                        global.tuning = null
                    }
                    global.streamer.zap.setZapping(false, null, true)
                    if(typeof(e.action) == 'function') { // execute action for stream, if any
                        let ret = e.action(e)
                        if(ret && ret.catch) ret.catch(console.error)
                    } else {
                        global.streamer.play(e)
                    }
                    break
                case 'input':
                    if(typeof(e.action) == 'function') {
                        let defVal = typeof(e.value) == 'function' ? e.value() : (e.value || undefined)
                        let val = await global.explorer.prompt(e.name, '', defVal, false, e.fa, null)
                        let ret = e.action(e, val)
                        if(ret && ret.catch) ret.catch(console.error)
                    }
                    break
                case 'action':
                    if(typeof(e.action) == 'function') {
                        let ret = e.action(e)
                        if(ret && ret.catch) ret.catch(console.error)
                    } else if(e.url && global.mega.isMega(e.url)) {
                        if(global.tuning){
                            global.tuning.destroy()
                            global.tuning = null
                        }
                        global.streamer.zap.setZapping(false, null, true)
                        global.streamer.play(e)
                    }
                    break
            }
        })
        global.ui.on('config-set', (k, v) => global.config.set(k, v))
        global.ui.on('crash', (...args) => global.crashlog.save(...args))
        global.ui.on('lists-manager', ret => {
            console.log('lists-manager', ret)
            switch(ret){
                case 'agree':
                    global.ui.emit('explorer-reset-selection')
                    global.explorer.open('', 0).catch(global.displayErr)
                    global.config.set('communitary-mode-lists-amount', global.lists.opts.defaultCommunityModeReach)
                    global.explorer.info(global.lang.LEGAL_NOTICE, global.lang.TOS_CONTENT)
                    global.lists.manager.update()
                    break
                case 'retry':
                    global.lists.manager.update()
                    break
                case 'add-list':
                    global.ui.emit('prompt', global.lang.ASK_IPTV_LIST, 'http://.../example.m3u', '', 'lists-manager', false, 'fas fa-plus-square')
                    break
                case 'back':
                    global.explorer.refresh()
                    break
                default:
                    global.lists.manager.addList(ret).catch(global.displayErr)
                    break
            }
        })
        global.ui.on('reload', ret => {
            console.log('reload', ret)
            switch(ret){
                case 'agree':
                    break
                default:
                    global.lists.manager.addList(ret).catch(err => {
                        global.lists.manager.catch(global.displayErr)
                    })
                    break
            }
        })
        global.ui.on('reload-dialog', async () => {
            console.log('reload-dialog')
            if(!global.streamer.active) return
            let opts = [{template: 'question', text: global.lang.RELOAD}], def = 'retry'
            let isCH = global.streamer.active.type != 'video' && 
                (
                    global.channels.isChannel(global.streamer.active.data.terms ? global.streamer.active.data.terms.name : global.streamer.active.data.name) 
                    || 
                    global.mega.isMega(global.streamer.active.data.originalUrl || global.streamer.active.data.url)
                )
            if(isCH){
                opts.push({template: 'option', text: global.lang.PLAYALTERNATE, fa: global.config.get('tuning-icon'), id: 'try-other'})
                def = 'try-other'
            }
            opts.push({template: 'option', text: global.lang.RELOAD_THIS_BROADCAST, fa: 'fas fa-redo', id: 'retry'})
            if(typeof(global.streamer.active.transcode) == 'function' && !global.streamer.active.isTranscoding()){
                opts.push({template: 'option', text: global.lang.FIX_AUDIO_OR_VIDEO +' &middot; '+ global.lang.TRANSCODE, fa: 'fas fa-film', id: 'transcode'})
            }
            if(opts.length > 2){
                let ret = await global.explorer.dialog(opts, def)
                videoErrorTimeoutCallback(ret)
            } else { // only reload actionm is available
                global.streamer.retry()
            }
        })
        global.ui.on('testing-stop', () => {
            console.warn('TESTING STOP')
            streamState.cancelTests()
        })
        global.ui.on('tuning-stop', () => {
            console.warn('TUNING ABORT')
            if(global.tuning) global.tuning.destroy()
        })
        global.ui.on('tune', () => {
            let data = global.streamer.active ? global.streamer.active.data : global.streamer.lastActiveData
            console.warn('RETUNNING', data)
            if(data) global.streamer.tune(data)
        })
        global.ui.on('retry', () => {
            console.warn('RETRYING')
            global.streamer.retry()
        })
        global.ui.on('video-transcode', () => {
            console.error('VIDEO TRANSCODE')
            global.streamer.transcode(null, err => {
                if(err) global.streamer.handleFailure(null, 'unsupported format')
            })
        })
        global.ui.on('video-error', async (type, errData) => {
            if(global.streamer.zap.isZapping){
                await global.streamer.zap.go()
            } else if(global.streamer.active && !global.streamer.active.isTranscoding()) {
                console.error('VIDEO ERROR', type, errData)
                if(type == 'timeout'){
                    if(!showingSlowBroadcastDialog){
                        let opts = [{template: 'question', text: global.lang.SLOW_BROADCAST}], def = 'wait'
                        let isCH = global.streamer.active.type != 'video' && global.channels.isChannel(global.streamer.active.data.terms ? global.streamer.active.data.terms.name : global.streamer.active.data.name)
                        if(isCH){
                            opts.push({template: 'option', text: global.lang.PLAYALTERNATE, fa: global.config.get('tuning-icon'), id: 'try-other'})
                            def = 'try-other'
                        }
                        opts.push({template: 'option', text: global.lang.RELOAD_THIS_BROADCAST, fa: 'fas fa-redo', id: 'retry'})
                        opts.push({template: 'option', text: global.lang.WAIT, fa: 'fas fa-clock', id: 'wait'})
                        if(!isCH){
                            opts.push({template: 'option', text: global.lang.STOP, fa: 'fas fa-stop', id: 'stop'})                        
                        }
                        showingSlowBroadcastDialog = true
                        let ret = await global.explorer.dialog(opts, def)
                        showingSlowBroadcastDialog = false
                        videoErrorTimeoutCallback(ret)
                    }
                } else {
                    console.error('VIDEO ERR', type, errData)
                    if(global.streamer.active && global.streamer.active.type == 'hls' && global.streamer.active.adapters.length){
                        console.error('VIDEO ERR EXT', global.streamer.active.endpoint)
                    }
                    global.streamer.handleFailure(null, type)
                }
            }
        })
        global.ui.on('share', () => {
            global.streamer.share()
        })
        global.ui.on('stop', () => {
            if(global.streamer.active){
                console.warn('STREAMER STOP FROM CLIENT')
                global.streamer.emit('stop-from-client')
                global.streamer.stop()
                if(global.tuning){
                    global.tuning.pause()
                }
            }
            let isEPGEnabledPath = !global.search.isSearching() && global.channels.activeEPG && [global.lang.TRENDING, global.lang.BOOKMARKS, global.lang.LIVE].some(p => global.explorer.path.substr(0, p.length) == p)
            if(isEPGEnabledPath){ // update current section data for epg freshness
                global.explorer.refresh()
            }
        })  
        global.ui.on('set-epg', url => {
            console.log('SET-EPG', url, global.activeEPG)
            global.config.set('epg-'+ global.lang.locale, url || 'disabled')
            global.lists.manager.setEPG(url, true).catch(console.error)
        })
        global.ui.on('open-url', url => {
            console.log('OPENURL', url)
            if(url){
                global.storage.raw.set('open-url', url, true)
                const name = global.lists.manager.nameFromSourceURL(url), e = {
                    name, 
                    url, 
                    terms: {
                        name: global.lists.terms(name), 
                        group: []
                    }
                }
                global.lists.manager.waitListsReady().then(() => {                       
                    if(isStreamerReady){
                        global.streamer.play(e)
                    } else {
                        playOnLoaded = e
                    }
                }).catch(console.error)
            }
        })
        global.ui.on('open-name', name => {
            console.log('OPEN STREAM BY NAME', name)
            if(name){
                const e = {name, url: global.mega.build(name)}
                if(isStreamerReady){
                    global.streamer.play(e)
                } else {
                    playOnLoaded = e
                }
            }
        })
        global.ui.on('about', async () => {
            if(global.streamer.active){
                global.ui.emit('streamer-client-pause')
                await global.streamer.about()
                global.ui.emit('streamer-client-resume')
            } else {
                global.options.about()
            }
        })
        global.ui.on('network-state-up', () => global.setNetworkConnectionState(true))
        global.ui.on('network-state-down', () => global.setNetworkConnectionState(false))
        global.ui.on('network-ip', ip => {
            if(ip && isNetworkIP(ip)){
                networkIP = () => {
                    return ip
                }
            }
        })
        global.streamer.on('streamer-connect', async (src, codecs, info) => {
            if(!global.streamer.active) return
            console.error('CONNECT', src, codecs, info)       
            let cantune
            if(global.streamer.active.mediaType == 'live'){
                if(global.tuning){
                    if(global.tuning.tuner && global.tuning.tuner.entries.length > 1){
                        cantune = true
                    }
                } else if(global.channels.isChannel(info.name)) {
                    cantune = true
                }
            }
            global.ui.emit('streamer-connect', src, codecs, '', global.streamer.active.mediaType, info, cantune)
            if(cantune){
                if(!tuningHintShown && global.histo.get().length){
                    tuningHintShown = true
                }
                if(!tuningHintShown){                        
                    tuningHintShown = true
                    global.ui.emit('streamer-show-tune-hint')
                }
            }
        })
        global.streamer.on('streamer-disconnect', err => {
            console.warn('DISCONNECT', err, global.tuning !== false)
            global.ui.emit('streamer-disconnect', err, global.tuning !== false)
        })
        global.streamer.on('stop', (err, data) => {
            global.ui.emit('remove-status-flag-from-all', 'fas fa-play-circle faclr-green')
            global.ui.emit('set-loading', data, false)
            global.ui.emit('streamer-stop')
        })
        global.config.on('change', (keys, data) => {
            global.ui.emit('config', keys, data)
            if(['lists', 'communitary-mode-lists-amount', 'communitary-mode-interests'].some(k => keys.includes(k))){
                global.explorer.refresh()
                global.lists.manager.update()
            }
        })     
        global.ui.once('init', () => {
            global.explorer.start()  
            global.icons.refresh()
            streamState.sync()
            if(!global.uiReady()){
                global.uiReady(null, true)
            }
        })
        global.ui.on('streamer-ready', () => {        
            isStreamerReady = true  
            if(!global.streamer.active){
                global.lists.manager.waitListsReady().then(() => {
                    if(playOnLoaded){
                        global.streamer.play(playOnLoaded)
                    } else if(global.config.get('resume')) {
                        if(global.explorer.path){
                            console.log('resume skipped, user navigated away')
                        } else {
                            console.log('resuming', global.histo.resumed, streamer)
                            global.histo.resume()
                        }
                    }
                }).catch(console.error)
            }
        })
        global.ui.once('close', () => {
            console.warn('Client closed!')
            global.energy.exit()
        })
        global.ui.once('exit', () => {
            process.exit(0)
        })
        global.ui.on('suspend', () => { // cordova only
            if(global.streamer.active && !global.config.get('miniplayer-auto')){
                global.streamer.stop()
            }
            if(global.tuning){
                global.tuning.destroy()
            }
            if(streamState){
                streamState.cancelTests()
            }
        })

        global.uiReady(async () => {
            const updatePrompt = async c => { // 'recursive-ready' update dialog
                let chosen = await global.explorer.dialog([
                    {template: 'question', text: ucWords(global.MANIFEST.name) +' v'+ global.MANIFEST.version +' > v'+ c.version, fa: 'fas fa-star'},
                    {template: 'message', text: global.lang.NEW_VERSION_AVAILABLE},
                    {template: 'option', text: global.lang.YES, id: 'yes', fa: 'fas fa-check-circle'},
                    {template: 'option', text: global.lang.NO_THANKS, id: 'no', fa: 'fas fa-times-circle'},
                    {template: 'option', text: global.lang.HOW_TO_UPDATE, id: 'how', fa: 'fas fa-question-circle'}
                ], 'yes')
                console.log('update callback', chosen)
                if(chosen == 'yes'){
                    global.ui.emit('open-external-url', 'https://megacubo.net/update?ver=' + global.MANIFEST.version)
                } else if(chosen == 'how') {
                    await global.explorer.dialog([
                        {template: 'question', text: global.lang.HOW_TO_UPDATE, fa: 'fas fa-question-circle'},
                        {template: 'message', text: global.lang.UPDATE_APP_INFO},
                        {template: 'option', text: 'OK', id: 'submit', fa: 'fas fa-check-circle'}
                    ], 'yes')
                    await updatePrompt(c)
                }
            }
            global.diag = new Diagnostics()

            const setupComplete = !!global.setupCompleted()
            if(!setupComplete) {
                const Wizard = require('./modules/wizard');
                const wizard = new Wizard()
                await wizard.init()
            }

            global.explorer.addFilter(global.downloads.hook.bind(global.downloads))
            new Analytics()
            await global.crashlog.send().catch(console.error) 
                       
            global.lists.manager.update()
            await global.lists.manager.waitListsReady()

            let c = await global.cloud.get('configure') // all below in func depends on 'configure' data
            await global.options.updateEPGConfig(c).catch(console.error)
            console.log('checking update...')
            if(!global.config.get('hide-updates')){
                if(c.version > global.MANIFEST.version){
                    console.log('new version found', c.version)
                    await updatePrompt(c)
                } else {
                    console.log('updated')
                }
            }
        })
        
        console.warn('Prepared to connect...')
        global.ui.emit('backend-ready', global.config.all(), global.lang.getTexts())
    })
}

global.ui.on('get-lang-callback', (locale, timezone, ua, online) => {
    console.log('get-lang-callback', timezone, ua, online)
    if(timezone){
        global.moment.tz.setDefault(timezone.name)
    }
    if(ua && ua != global.config.get('default-user-agent')){
        global.config.set('default-user-agent', ua)
    }
    if(typeof(online) == 'boolean'){
        global.setNetworkConnectionState(online)
    }
    if(!global.lang){
        console.log('get-lang-callback 1')
        init(locale, timezone)
    } else {
        console.log('get-lang-callback 2')
        global.lang.ready().catch(global.displayErr).finally(() => {
            global.ui.emit('backend-ready', global.config.all(), global.lang.getTexts())        
        })
    }
})

if(global.cordova) {
    global.ui.emit('get-lang')
} else {
    let remoteModuleExternal = parseFloat(process.versions.electron) >= 22
    remoteModuleExternal && require('@electron/remote/main').initialize()
    const { app, BrowserWindow, globalShortcut } = require('electron')
    onexit(() => {        
        app.quit()
    })
    app.on('window-all-closed', () => {
        app.quit()        
    })
    if(remoteModuleExternal){
        app.on('browser-window-created', (_, window) => {
            require('@electron/remote/main').enable(window.webContents)
        })
    }
    app.commandLine.appendSwitch('no-prefetch')
    app.commandLine.appendSwitch('use-gl', 'desktop')
    app.commandLine.appendSwitch('disable-http-cache')
    app.commandLine.appendSwitch('disable-websql', 'true')
    app.commandLine.appendSwitch('enable-gpu-rasterization')
    app.commandLine.appendSwitch('enable-accelerated-video')
    app.commandLine.appendSwitch('disable-site-isolation-trials')
    app.commandLine.appendSwitch('enable-accelerated-video-decode')
    app.commandLine.appendSwitch('enable-accelerated-mjpeg-decode')
    app.commandLine.appendSwitch('enable-native-gpu-memory-buffers')
    app.commandLine.appendSwitch('enable-features', 'PlatformHEVCDecoderSupport') 
    app.commandLine.appendSwitch('disable-features', 'SitePerProcess')
    app.whenReady().then(() => {
        const window = new BrowserWindow({  
            titleBarStyle: 'hidden',
            frame: false,
            icon: path.join(global.APPDIR, 'default_icon.png'),
            webPreferences: {
                cache: false,
                disablePreconnect: true,
                dnsPrefetchingEnabled: false,
                contextIsolation: false, // false is required for nodeIntegration
                nodeIntegration: true,
                nodeIntegrationInWorker: true,
                nodeIntegrationInSubFrames: false,
                enableRemoteModule: true,
                webSecurity: false // desabilita o webSecurity
            }
        })
        window.loadURL('file://'+ global.APPDIR +'/electron.html') // file:// is required on Linux to prevent blank window on Electron 9.1.2
        app.on('browser-window-focus', () => { // We'll use Ctrl+M to enable Miniplayer instead of minimizing
            globalShortcut.registerAll(['CommandOrControl+M'], () => { return })
        })
        app.on('browser-window-blur', () => {
            globalShortcut.unregisterAll()
        })
    }).catch(console.error)
}
