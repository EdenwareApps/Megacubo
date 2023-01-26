console.log('Initializing node...')

process.env.UV_THREADPOOL_SIZE = 16

cordova = false

try {
    if(require.resolve('cordova-bridge')){
        cordova = require('cordova-bridge')
    }
} catch(e) {
    cordova = false
}

Buffer = require('safe-buffer').Buffer
const fs = require('fs'), path = require('path'), sanitizeFilename = require('sanitize-filename')

APPDIR = path.resolve(typeof(__dirname) != 'undefined' ? __dirname : process.cwd()).replace(new RegExp('\\\\', 'g'), '/')
MANIFEST = require(APPDIR + '/package.json')

tuning = false
moment = require('moment-timezone')
onexit = require('node-cleanup')
sanitize = txt => sanitizeFilename(txt).replace(new RegExp('[^\x00-\x7F]+', 'g'), '')

require(APPDIR + '/modules/supercharge')(global)

if(cordova){
    let datadir = cordova.app.datadir(), temp = path.join(path.dirname(datadir), 'cache')
    paths = {data: datadir +'/Data', temp}
} else if(fs.existsSync(APPDIR +'/.portable') && checkDirWritePermissionSync(APPDIR +'/.portable')){
    paths = {data: APPDIR +'/.portable/Data', temp: APPDIR +'/.portable/temp'}
} else {
	paths = require('env-paths')(global.MANIFEST.window.title, {suffix: ''})
}

Object.keys(paths).forEach(k => {
    paths[k] = forwardSlashes(paths[k])
    console.log('DEFAULT PATH ' + k + '=' + paths[k])
})

crashlog = require(APPDIR + '/modules/crashlog')

process.on('warning', e => {
    console.warn(e, e.stack)
})
process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason)
    crashlog.save('Unhandled Rejection at:', promise, 'reason:', reason)
})
process.on('uncaughtException', (exception) => {
    console.error('uncaughtException', exception)
    crashlog.save('uncaughtException', exception)
    return false
})

storage = require(APPDIR + '/modules/storage')({main: true})

onexit(() => {
    isExiting = true
    console.log('APP_EXIT', traceback())
    if(typeof(streamer) != 'undefined' && streamer.active){
        streamer.stop()
    }
    if(typeof(tuning) != 'undefined' && tuning){
        tuning.destroy()
    }
    if(typeof(ui) != 'undefined' && ui){
        ui.emit('exit', true)
        ui.destroy()
    }
})

config = require(APPDIR + '/modules/config')(paths['data'] + '/config.json')
Download = require(APPDIR + '/modules/download')
jimp = null

enableConsole = (enable) => {
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

enableConsole(config.get('enable-console'))

console.log('Loading modules...')

const Bridge = require(APPDIR + '/modules/bridge')
const FFMPEG = require(APPDIR + '/modules/ffmpeg')
const Explorer = require(APPDIR + '/modules/explorer')
const Language = require(APPDIR + '/modules/lang')
const Cloud = require(APPDIR + '/modules/cloud')
const Channels = require(APPDIR + '/modules/channels')
const IconServer = require(APPDIR + '/modules/icon-server')
const Streamer = require(APPDIR + '/modules/streamer')
const OSD = require(APPDIR + '/modules/osd')
const Options = require(APPDIR + '/modules/options')
const Search = require(APPDIR + '/modules/search')
const History = require(APPDIR + '/modules/history')
const Bookmarks = require(APPDIR + '/modules/bookmarks')
const Watching = require(APPDIR + '/modules/watching')
const Theme = require(APPDIR + '/modules/theme')
const Energy = require(APPDIR + '/modules/energy')
const Analytics = require(APPDIR + '/modules/analytics')
const AutoConfig = require(APPDIR + '/modules/autoconfig')
const Diagnostics = require(APPDIR + '/modules/diagnostics')
const StreamState = require(APPDIR + '/modules/stream-state')
const Downloads = require(APPDIR + '/modules/downloads')
const OMNI = require(APPDIR + '/modules/omni')
const Mega = require(APPDIR + '/modules/mega')
const Zap = require(APPDIR + '/modules/zap')

console.log('Modules loaded.')

ui = new Bridge()
ffmpeg = new FFMPEG()
lang = false
activeEPG = ''
isStreamerReady = false
downloadsInBackground = {}

displayErr = (...args) => {
    console.error.apply(null, args)
    ui.emit('display-error', args.map(v => String(v)).join(", "))
}

uiReadyCallbacks = []
uiReady = (fn) => {
    if(Array.isArray(uiReadyCallbacks)){
        uiReadyCallbacks.push(fn)
    } else {
        fn()
    }
}

setNetworkConnectionState = state => {
    Download.setNetworkConnectionState(state)
    if(typeof(lists) != 'undefined'){
        lists.setNetworkConnectionState(state).catch(console.error)
        if(state && isStreamerReady){
            lists.manager.updateLists().catch(global.displayErr)
        }
    }
}

resolveFileFromClient = data => {
    return new Promise((resolve, reject) => {
        const check = file => {
            try {
                fs.access(file, fs.constants.R_OK, err => {
                    if(err) return reject(err)
                    resolve(file)
                })
            } catch(err) {
                reject(err)
            }
        }
        console.warn('!!! RESOLVE FILE !!!', data)
        if(data){
            if(data.length){
                check(data[0])
            } else if(data.filename && data.filename.path) {
                check(data.filename.path)
            } else {
                reject('invalid file data*')
            }
        } else {
            reject('invalid file data')
        }
    })
}

importFileFromClient = (data, target) => {
    return new Promise((resolve, reject) => {
        const process = (file, callback) => {
            if(target){
                fs.copyFile(file, target, err => {
                    if(err){
                        console.error('IMPORT ERROR ' + JSON.stringify(err))
                        reject(err)
                    } else {
                        resolve(file)
                    }
                })
            } else {
                fs.readFile(file, (err, data) => {
                    if(err){
                        console.error('IMPORT ERROR ' + JSON.stringify(err))
                        reject(err)
                    } else {
                        resolve(data)
                    }
                })
            }
        }
        console.warn('!!! IMPORT FILE !!!', data)
        resolveFileFromClient(data).then(file => {
            process(file, err => {
                if(err){
                    reject(err)
                } else {
                    resolve(file)
                }
            })
        }).catch(reject)
    })
}

updateEPGConfig = c => {
    const next = c => {
        activeEPG = config.get('epg-'+ lang.locale)
        console.log('SET-EPG', activeEPG, activeEPG)
        if(activeEPG == 'disabled'){
            activeEPG = false
            lists.manager.setEPG('', false).catch(console.error)
        } else {
            if(!activeEPG || activeEPG == 'auto'){
                activeEPG = c['epg-'+ lang.countryCode] || c['epg-'+ lang.locale] || false
            }
            lists.manager.setEPG(activeEPG || '', false).catch(console.error)
        }
    }
    if(c){
        next(c)
    } else {
        cloud.get('configure').then(next).catch(console.error)
    }
    console.log('SET-EPG', activeEPG)
}

setupCompleted = () => {
    const l = config.get('lists')
    const fine = (l && l.length) || config.get('communitary-mode-lists-amount')
    if(fine != config.get('setup-completed')) {
        config.set('setup-completed', fine)        
    }
    return fine
}

videoErrorTimeoutCallback = ret => {
    console.log('video-error-timeout-callback', ret)
    if(ret == 'try-other'){
        streamer.handleFailure(null, 'timeout', true, true)
    } else if(ret == 'retry') {
        streamer.retry()
    } else if(ret == 'transcode') {
        streamer.transcode()
    } else if(ret == 'stop') {
        streamer.stop()
    } else {
        ui.emit('streamer-reset-timeout')
    }
}

var playOnLoaded, tuningHintShown, showingSlowBroadcastDialog

function init(language){
    if(lang) return
    lang = new Language(language, config.get('locale'), APPDIR + '/lang')
    lang.load().catch(displayErr).finally(() => {
        console.log('Language loaded.')       
        jimp = require(APPDIR + '/modules/jimp-wrapper')        

        epgSetup = false
        moment.locale(lang.locale)
        cloud = new Cloud()
        
        const Lists = require(APPDIR + '/modules/lists')

        osd = new OSD()
        lists = new Lists()
        lists.setNetworkConnectionState(Download.isNetworkConnected).catch(console.error)       

        autoconfig = new AutoConfig()
        autoconfig.start().catch(console.error)

        omni = new OMNI()
        mega = new Mega()
        energy = new Energy()
        streamer = new Streamer()
        channels = new Channels()
        downloads = new Downloads(paths.temp)
        theme = new Theme()
        search = new Search()
        histo = new History()
        options = new Options()
        watching = new Watching()
        bookmarks = new Bookmarks()
        icons = new IconServer({folder: paths['data'] + '/icons'})        

        rmdir(streamer.opts.workDir, false, true)

        explorer = new Explorer({})
        
        console.log('Initializing premium...')
        Premium = require(APPDIR + '/modules/premium-helper')
        if(typeof(Premium) != 'undefined'){
			premium = new Premium()
		}

        streamState = new StreamState()
        zap = new Zap()

        explorer.addFilter(channels.hook.bind(channels))
        explorer.addFilter(bookmarks.hook.bind(bookmarks))
        explorer.addFilter(histo.hook.bind(histo))
        explorer.addFilter(watching.hook.bind(watching))
        explorer.addFilter(lists.manager.hook.bind(lists.manager))
        explorer.addFilter(options.hook.bind(options))
        explorer.addFilter(theme.hook.bind(theme))
        explorer.addFilter(search.hook.bind(search))

        ui.on('explorer-update-range', icons.renderRange.bind(icons))
        explorer.on('render', icons.render.bind(icons))

        explorer.on('action', async e => {
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
                    if(tuning){
                        tuning.destroy()
                        tuning = null
                    }
                    zap.setZapping(false, null, true)
                    if(typeof(e.action) == 'function') { // execute action for stream, if any
                        let ret = e.action(e)
                        if(ret && ret.catch) ret.catch(console.error)
                    } else {
                        streamer.play(e)
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
                    } else if(e.url && mega.isMega(e.url)) {
                        if(tuning){
                            tuning.destroy()
                            tuning = null
                        }
                        zap.setZapping(false, null, true)
                        streamer.play(e)
                    }
                    break
            }
        })
        ui.on('config-set', (k, v) => config.set(k, v))
        ui.on('crash', (...args) => crashlog.save(...args))
        ui.on('lists-manager', ret => {
            console.log('lists-manager', ret)
            switch(ret){
                case 'agree':
                    ui.emit('explorer-reset-selection')
                    explorer.open('', 0).catch(displayErr)
                    config.set('communitary-mode-lists-amount', lists.opts.defaultCommunityModeReach)
                    explorer.info(lang.LEGAL_NOTICE, lang.TOS_CONTENT)
                    lists.manager.updateLists(true).catch(global.displayErr)
                    break
                case 'retry':
                    lists.manager.updateLists(true).catch(global.displayErr)
                    break
                case 'add-list':
                    ui.emit('prompt', lang.ASK_IPTV_LIST, 'http://.../example.m3u', '', 'lists-manager', false, 'fas fa-plus-square')
                    break
                case 'back':
                    explorer.refresh()
                    break
                default:
                    lists.manager.addList(ret).catch(err => {
                        lists.manager.check()
                    })
                    break
            }
        })
        ui.on('reload', ret => {
            console.log('reload', ret)
            switch(ret){
                case 'agree':
                    break
                default:
                    lists.manager.addList(ret).catch(err => {
                        lists.manager.check()
                    })
                    break
            }
        })
        ui.on('reload-dialog', async () => {
            console.log('reload-dialog')
            if(!streamer.active) return
            let opts = [{template: 'question', text: lang.RELOAD}], def = 'retry'
            let isCH = streamer.active.type != 'video' && 
                (
                    channels.isChannel(streamer.active.data.terms ? streamer.active.data.terms.name : streamer.active.data.name) 
                    || 
                    global.mega.isMega(streamer.active.data.originalUrl || streamer.active.data.url)
                )
            if(isCH){
                opts.push({template: 'option', text: lang.PLAYALTERNATE, fa: config.get('tuning-icon'), id: 'try-other'})
                def = 'try-other'
            }
            opts.push({template: 'option', text: lang.RELOAD_THIS_BROADCAST, fa: 'fas fa-redo', id: 'retry'})
            if(typeof(streamer.active.transcode) == 'function' && !streamer.active.isTranscoding()){
                opts.push({template: 'option', text: lang.FIX_AUDIO_OR_VIDEO +' &middot; '+ lang.TRANSCODE, fa: 'fas fa-film', id: 'transcode'})
            }
            if(opts.length > 2){
                let ret = await explorer.dialog(opts, def)
                videoErrorTimeoutCallback(ret)
            } else { // only reload actionm is available
                streamer.retry()
            }
        })
        ui.on('testing-stop', () => {
            console.warn('TESTING STOP')
            streamState.cancelTests()
        })
        ui.on('tuning-stop', () => {
            console.warn('TUNING ABORT')
            if(tuning) tuning.destroy()
        })
        ui.on('tune', () => {
            let data = streamer.active ? streamer.active.data : streamer.lastActiveData
            console.warn('RETUNNING', data)
            if(data) streamer.tune(data)
        })
        ui.on('retry', () => {
            console.warn('RETRYING')
            streamer.retry()
        })
        ui.on('video-transcode', () => {
            console.error('VIDEO TRANSCODE')
            streamer.transcode(null, err => {
                if(err) streamer.handleFailure(null, 'unsupported format')
            })
        })
        ui.on('video-error', async (type, errData) => {
            if(zap && zap.isZapping){
                await zap.go()
            } else if(streamer.active && !streamer.active.isTranscoding()) {
                console.error('VIDEO ERROR', type, errData)
                if(type == 'timeout'){
                    if(!showingSlowBroadcastDialog){
                        let opts = [{template: 'question', text: lang.SLOW_BROADCAST}], def = 'wait'
                        let isCH = streamer.active.type != 'video' && channels.isChannel(streamer.active.data.terms ? streamer.active.data.terms.name : streamer.active.data.name)
                        if(isCH){
                            opts.push({template: 'option', text: lang.PLAYALTERNATE, fa: config.get('tuning-icon'), id: 'try-other'})
                            def = 'try-other'
                        }
                        opts.push({template: 'option', text: lang.RELOAD_THIS_BROADCAST, fa: 'fas fa-redo', id: 'retry'})
                        opts.push({template: 'option', text: lang.WAIT, fa: 'fas fa-clock', id: 'wait'})
                        if(!isCH){
                            opts.push({template: 'option', text: lang.STOP, fa: 'fas fa-stop', id: 'stop'})                        
                        }
                        showingSlowBroadcastDialog = true
                        let ret = await explorer.dialog(opts, def)
                        showingSlowBroadcastDialog = false
                        videoErrorTimeoutCallback(ret)
                    }
                } else {
                    console.error('VIDEO ERR', type, errData)
                    if(streamer.active && streamer.active.type == 'hls' && streamer.active.adapters.length){
                        console.error('VIDEO ERR EXT', streamer.active.endpoint)
                    }
                    streamer.handleFailure(null, type)
                }
            }
        })
        ui.on('share', () => {
            streamer.share()
        })
        ui.on('stop', () => {
            if(streamer.active){
                console.warn('STREAMER STOP FROM CLIENT')
                streamer.emit('stop-from-client')
                streamer.stop()
                if(tuning){
                    tuning.pause()
                }
                console.warn('STREAMER STOPPED')
            }
            let isEPGEnabledPath = !search.isSearching() && channels.activeEPG && [lang.TRENDING, lang.BOOKMARKS, lang.LIVE].some(p => explorer.path.substr(0, p.length) == p)
            if(isEPGEnabledPath){ // update current section data for epg freshness
                explorer.refresh()
            }
        })  
        ui.on('set-epg', url => {
            epgSetup = true
            console.log('SET-EPG', url, activeEPG)
            config.set('epg-'+ lang.locale, url || 'disabled')
            lists.manager.setEPG(url, true).catch(console.error)
        })
        ui.on('open-url', url => {
            console.log('OPENURL', url)
            if(url){
                let parts = mega.parse(url)
                if(parts && parts.name && parts.name == 'configure'){
                    console.log('OPENURL configure', parts)
                    autoconfig.start(parts).catch(console.error)
                } else {
                    storage.raw.set('open-url', url, true)
                    const name = lists.manager.nameFromSourceURL(url), e = {
                        name, 
                        url, 
                        terms: {
                            name: lists.terms(name), 
                            group: []
                        }
                    }
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
        ui.on('open-name', name => {
            console.log('OPEN STREAM BY NAME', name)
            if(name){
                const e = {name, url: mega.build(name)}
                if(isStreamerReady){
                    streamer.play(e)
                } else {
                    playOnLoaded = e
                }
            }
        })
        ui.on('about', url => {
            if(streamer.active){
                streamer.about()
            } else {
                options.about()
            }
        })
        ui.on('network-state-up', () => setNetworkConnectionState(true))
        ui.on('network-state-down', () => setNetworkConnectionState(false))
        ui.on('network-ip', ip => {
            if(ip && isNetworkIP(ip)){
                networkIP = () => {
                    return ip
                }
            }
        })
        /*
        ui.assign('playback', () => {
            return new Promise((resolve, reject) => {
                resolve({
                    testing: !!streamState.testing,
                    tuning: !!(tuning && tuning.tuner && tuning.tuner.active()),
                    playing: !!streamer.active
                })
            })
        })
        */
        streamer.on('streamer-connect', async (src, codecs, info) => {
            if(!streamer.active) return
            console.error('CONNECT', src, codecs, info)       
            let cantune
            if(streamer.active.mediaType == 'live'){
                if(tuning){
                    if(tuning.tuner && tuning.tuner.entries.length > 1){
                        cantune = true
                    }
                } else if(channels.isChannel(info.name)) {
                    cantune = true
                }
            }
            ui.emit('streamer-connect', src, codecs, '', streamer.active.mediaType, info, cantune)
            if(cantune){
                if(!tuningHintShown && histo.get().length){
                    tuningHintShown = true
                }
                if(!tuningHintShown){                        
                    tuningHintShown = true
                    ui.emit('streamer-show-tune-hint')
                }
            }
        })
        streamer.on('streamer-disconnect', err => {
            console.warn('DISCONNECT', err, tuning !== false)
            ui.emit('streamer-disconnect', err, tuning !== false)
        })
        streamer.on('stop', (err, data) => {
            console.warn('STREAMER STOP', err, data)
            ui.emit('remove-status-flag-from-all', 'fas fa-play-circle faclr-green')
            ui.emit('set-loading', data, false)
            ui.emit('streamer-stop')
        })
        config.on('change', (keys, data) => {
            ui.emit('config', keys, data)
            console.warn('config change', keys, data)
            if(['lists', 'communitary-mode-lists-amount', 'communitary-mode-interests'].some(k => keys.includes(k))){
                explorer.refresh()
                lists.manager.updateLists().catch(global.displayErr)
            }
        })     
        ui.once('init', () => {
            explorer.start()  
            icons.refresh()
            streamState.sync()
            if(Array.isArray(uiReadyCallbacks)){
                uiReadyCallbacks.forEach(f => f())
                uiReadyCallbacks = null
                const prompt = async c => {
                    let chosen = await global.explorer.dialog([
                        {template: 'question', text: ucWords(MANIFEST.name) +' v'+ MANIFEST.version +' > v'+ c.version, fa: 'fas fa-star'},
                        {template: 'message', text: lang.NEW_VERSION_AVAILABLE},
                        {template: 'option', text: lang.YES, id: 'yes', fa: 'fas fa-check-circle'},
                        {template: 'option', text: lang.NO_THANKS, id: 'no', fa: 'fas fa-times-circle'},
                        {template: 'option', text: lang.HOW_TO_UPDATE, id: 'how', fa: 'fas fa-question-circle'}
                    ], 'yes')
                    console.log('update callback', chosen)
                    if(chosen == 'yes'){
                        ui.emit('open-external-url', 'https://megacubo.net/update?ver=' + MANIFEST.version)
                    } else if(chosen == 'how') {
                        await global.explorer.dialog([
                            {template: 'question', text: lang.HOW_TO_UPDATE, fa: 'fas fa-question-circle'},
                            {template: 'message', text: lang.UPDATE_APP_INFO},
                            {template: 'option', text: 'OK', id: 'submit', fa: 'fas fa-check-circle'}
                        ], 'yes')
                        prompt(c)
                    }
                }
                const afterListUpdate = async () => {
                    if(!lists.activeLists.length && config.get('communitary-mode-lists-amount')){
                        lists.manager.updateLists().catch(global.displayErr)
                    }
                    let c = await cloud.get('configure')
                    updateEPGConfig(c)
                    console.log('checking update...')
                    crashlog.send().catch(console.error)
                    if(c.version > MANIFEST.version){
                        console.log('new version found', c.version)
                        prompt(c)
                    } else {
                        console.log('updated')
                    }
                }
                lists.manager.waitListsReady().then(afterListUpdate).catch(console.error)
                analytics = new Analytics()
                diagnostics = new Diagnostics()
                if(setupCompleted()){
                    lists.manager.updateLists(true).catch(global.displayErr)
                } else {
                    const Wizard = require(APPDIR + '/modules/wizard');
                    wizard = new Wizard()
                }
                explorer.addFilter(downloads.hook.bind(downloads))
            }
        })
        ui.on('streamer-ready', () => {        
            isStreamerReady = true  
            if(!streamer.active){
                lists.manager.waitListsReady().then(() => {
                    if(playOnLoaded){
                        streamer.play(playOnLoaded)
                    } else if(config.get('resume')) {
                        if(explorer.path){
                            console.log('resume skipped, user navigated away')
                        } else {
                            console.log('resuming', histo.resumed, streamer)
                            histo.resume()
                        }
                    }
                }).catch(console.error)
            }
        })
        ui.once('close', () => {
            console.warn('Client closed!')
            energy.exit()
        })
        ui.once('exit', () => {
            process.exit(0)
        })
        ui.on('suspend', () => { // cordova only
            if(streamer.active && !config.get('miniplayer-auto')){
                streamer.stop()
            }
            if(tuning){
                tuning.destroy()
            }
            if(streamState){
                streamState.cancelTests()
            }
        })

        console.warn('Prepared to connect...')
        ui.emit('backend-ready', config.all(), lang.getTexts())
    })
}

ui.on('get-lang-callback', (locale, timezone, ua, online) => {
    console.log('get-lang-callback', timezone, ua, online)
    if(timezone && (timezone != config.get('timezone'))){
        config.set('timezone', timezone)
    }
    moment.tz.setDefault(timezone)
    if(ua && ua != config.get('default-user-agent')){
        config.set('default-user-agent', ua)
    }
    if(typeof(online) == 'boolean'){
        setNetworkConnectionState(online)
    }
    if(!lang){
        console.log('get-lang-callback 1', lang)
        init(locale)
    } else {
        console.log('get-lang-callback 2', lang)
        lang.ready(() => {
            ui.emit('backend-ready', config.all(), lang.getTexts())
        })
    }
})

if(cordova) {
    ui.emit('get-lang')
}
