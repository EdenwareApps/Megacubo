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

process.on('warning', e => {
    console.warn(e, e.stack)
})
process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason)
})
process.on('uncaughtException', (exception) => {
    console.error('uncaughtException', exception)
    return false
})

APPDIR = path.resolve(typeof(__dirname) != 'undefined' ? __dirname : process.cwd()).replace(new RegExp('\\\\', 'g'), '/')
MANIFEST = require(APPDIR + '/package.json')
COMMUNITARY_LISTS_DEFAULT_AMOUNT = cordova ? 12 : 16

tuning = false
moment = require('moment-timezone')
onexit = require('node-cleanup')
sanitize = txt => sanitizeFilename(txt).replace(new RegExp('[^\x00-\x7F]+', 'g'), '')

require(APPDIR + '/modules/supercharge')(global)

if(cordova){
    let datadir = cordova.app.datadir(), temp = path.join(path.dirname(datadir), 'cache')
    paths = {data: datadir + path.sep + 'Data', temp}
} else {
	paths = require('env-paths')('Megacubo', {suffix: ''})
}

Object.keys(paths).forEach(k => {
    paths[k] = paths[k].replaceAll('\\', '/')
    console.log('DEFAULT PATH ' + k + '=' + paths[k])
})

storage = require(APPDIR + '/modules/storage')({main: true})

onexit(() => {
    global.isExiting = true
    console.log('APP_EXIT', traceback())
    if(typeof(streamer) != 'undefined' && streamer.active){
        streamer.stop()
    }
    if(typeof(tuning) != 'undefined' && tuning){
        tuning.destroy()
    }
    if(typeof(ui) != 'undefined' && ui){
        ui.emit('exit')
        ui.destroy()
    }
})

config = new (require(APPDIR + '/modules/config'))(paths['data'] + '/config.json')
base64 = new (require(APPDIR + '/modules/base64'))()
Download = require(APPDIR + '/modules/download')
jimp = require(APPDIR + '/modules/jimp-wrapper')

enableConsole = (enable) => {
    let fns = ['log', 'warn']
    if(typeof(originalConsole) == 'undefined'){ // initialize
        originalConsole = {}
        fns.forEach(f => originalConsole[f] = console[f].bind(console))
        config.on('change', (keys, data) => keys.includes('enable-console') && enableConsole(data['enable-console']))
        if(enable) return // enabled by default, stop here
    }
    if(enable){
        fns.forEach(f => { global.console[f] = console[f] = originalConsole[f] })
    } else {
        fns.forEach(f => { global.console[f] = console[f] = () => {}})
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
const Diagnostics = require(APPDIR + '/modules/diagnostics')
const StreamState = require(APPDIR + '/modules/stream-state')
const Downloads = require(APPDIR + '/modules/downloads')
const OMNI = require(APPDIR + '/modules/omni')
const Mega = require(APPDIR + '/modules/mega')

console.log('Initializing premium...')
Premium = require(APPDIR + '/modules/premium-helper')

console.log('Modules loaded.')

rmdir = (folder, itself, cb) => {
    const rimraf = require('rimraf')
    let dir = folder
    if(dir.charAt(dir.length - 1) == '/'){
        dir = dir.substr(0, dir.length - 1)
    }
    if(!itself){
        dir += '/*'
    }
    if(cb === true){ // sync
        try {
            rimraf.sync(dir)
        } catch(e) {}
    } else {
        try {
            rimraf(dir, cb || (() => {}))
        } catch(e) {
            if(typeof(cb) == 'function'){
                cb()
            }
        }
    }
}

ui = new Bridge()
ffmpeg = new FFMPEG()
lang = false
activeEPG = ''
isUILoaded = false
isStreamerReady = false
downloadsInBackground = {}

displayErr = (...args) => {
    console.error.apply(null, args)
    ui.emit('display-error', args.map(v => String(v)).join(", "))
}

setNetworkConnectionState = state => {
    Download.setNetworkConnectionState(state)
    if(typeof(lists) != 'undefined'){
        lists.setNetworkConnectionState(state).catch(console.error)
        if(state){
            lists.manager.UIUpdateLists()
        }
    }
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
        if(data){
            if(data.length){
                data.forEach(file => {
                   process(file, err => {
                        if(err){
                            reject(err)
                        } else {
                            resolve(file)
                        }
                    })
                })
            } else if(data.dataURI) {
                resolve(base64.decode(data.dataURI))
            } else if(data.filename && data.filename.path) {
                process(data.filename.path, err => {
                     if(err){
                         reject(err)
                     } else {
                         resolve(file)
                     }
                })
            } else {
                reject('invalid file data*')
            }
        } else {
            reject('invalid file data')
        }
    })
}

updateEPGConfig = c => {
    const next = c => {
        activeEPG = global.config.get('epg')
        console.log('SET-EPG', activeEPG, global.activeEPG)
        if(activeEPG == 'disabled'){
            activeEPG = false
            lists.manager.setEPG('', false)
        } else {
            if(activeEPG == '' || activeEPG == 'auto'){
                activeEPG = c['epg-'+ lang.countryCode] || c['epg-'+ lang.locale] || false
            }
            lists.manager.setEPG(activeEPG || '', false)
        }
    }
    if(c){
        next(c)
    } else {
        cloud.get('configure').then(next).catch(console.error)
    }
    console.log('SET-EPG', activeEPG)
}

var playOnLoaded

function init(language){
    console.log('Language', language)
    Language(language, APPDIR + '/lang').then(ret => {  
        console.warn('Language loaded.', typeof(ret))
       
        let epgSetup = false
        lang = ret

        moment.locale(lang.locale)    

        cloud = new Cloud()
        
        const Lists = require(APPDIR + '/modules/lists')

        osd = new OSD()
        lists = new Lists()
        lists.setNetworkConnectionState(Download.isNetworkConnected).catch(console.error)

        activeLists = {my: [], communitary: [], length: 0}

        if(config.get('setup-complete')){
            lists.manager.UIUpdateLists(true)
        }

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

        explorer = new Explorer({},
            [
                {name: lang.LIVE, fa: 'fas fa-tv', details: '<i class="fas fa-play-circle"></i> '+ lang.WATCH, type: 'group', renderer: channels.entries.bind(channels)},
                {name: lang.VIDEOS, fa: 'fas fa-folder-open', details: lang.CATEGORIES, type: 'group', renderer: channels.more.bind(channels)}
            ]
        )
        
        if(typeof(Premium) != 'undefined'){
			premium = new Premium()
		}
        
        streamState = new StreamState()

        explorer.addFilter(bookmarks.hook.bind(bookmarks))
        explorer.addFilter(histo.hook.bind(histo))
        explorer.addFilter(watching.hook.bind(watching))
        explorer.addFilter(lists.manager.hook.bind(lists.manager))
        explorer.addFilter(options.hook.bind(options))
        explorer.addFilter(theme.hook.bind(theme))
        explorer.addFilter(search.hook.bind(search))

        ui.on('explorer-update-range', icons.renderRange.bind(icons))
        explorer.on('render', icons.render.bind(icons))

        explorer.on('action', e => {
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
                    if(typeof(e.action) == 'function') { // execute action for stream, if any
                        e.action(e)
                    } else {
                        streamer.play(e)
                    }
                    break
                case 'action':
                    if(typeof(e.action) == 'function') {
                        e.action(e)
                    } else if(e.url && mega.isMega(e.url)) {
                        streamer.play(e)
                    }
                    break
            }
        })
        ui.on('config-set', (k, v) => {
            config.set(k, v)
        })
        ui.on('add-list', url => {
            lists.manager.addList(url).then(() => {}).catch(err => {
                lists.manager.check()
            })
        })
        ui.on('lists-manager', ret => {
            console.log('lists-manager', ret)
            switch(ret){
                case 'agree':
                    ui.emit('explorer-reset-selection')
                    explorer.open('', 0).catch(displayErr)
                    config.set('shared-mode-reach', COMMUNITARY_LISTS_DEFAULT_AMOUNT)
                    ui.emit('info', lang.LEGAL_NOTICE, lang.TOS_CONTENT)
                    lists.manager.UIUpdateLists(true)
                    break
                case 'retry':
                    lists.manager.UIUpdateLists(true)
                    break
                case 'add-list':
                    ui.emit('prompt', lang.ASK_IPTV_LIST, 'http://.../example.m3u', '', 'lists-manager', false, 'fas fa-plus-square')
                    break
                case 'back':
                    explorer.refresh()
                    break
                default:
                    lists.manager.addList(ret).then(() => {}).catch(err => {
                        lists.manager.check()
                    })
                    break
            }
        })
        ui.on('testing-stop', () => {
            console.warn('TESTING STOP')
            streamState.cancelTests()
        })
        ui.on('tuning-stop', () => {
            console.warn('TUNING ABORT')
            if(tuning){
                tuning.destroy()
            }
        })
        ui.on('tune', () => {
            let data = streamer.active ? streamer.active.data : streamer.lastActiveData
            console.warn('RETUNNING', data)
            if(data){
                streamer.tune(data)
            }
        })
        ui.on('retry', () => {
            console.warn('RETRYING')
            let data = streamer.active ? streamer.active.data : streamer.lastActiveData
            if(data){
                streamer.play(data)
            }
        })
        ui.on('video-transcode', () => {
            console.error('VIDEO TRANSCODE')
            streamer.transcode(null, err => {
                if(err){
                    streamer.handleFailure(null, 'unsupported format')
                }
            })
        })
        ui.on('video-error', (type, errData) => {
            if(streamer.active && !streamer.active.transcoderStarting){
                console.error('VIDEO ERROR', type, errData)
                if(type == 'timeout'){
                    let opts = [{template: 'question', text: lang.SLOW_TRANSMISSION}], def = 'wait'
                    let isCH = streamer.active.type != 'video' && channels.isChannel(streamer.active.data.terms.name)
                    if(isCH){
                        opts.push({template: 'option', text: lang.DO_TUNE, fa: 'fas fa-satellite-dish', id: 'try-other'})
                        def = 'try-other'
                    }
                    opts.push({template: 'option', text: lang.WAIT, fa: 'fas fa-clock', id: 'wait'})
                    if(!isCH){
                        opts.push({template: 'option', text: lang.STOP, fa: 'fas fa-stop', id: 'stop'})                        
                    }
                    ui.emit('dialog', opts, 'video-error-timeout-callback', def)
                } else {
                    console.error('VIDEO ERR', type, errData)
                    if(streamer.active && streamer.active.type == 'hls' && streamer.active.adapters.length){
                        console.error('VIDEO ERR EXT', streamer.active.endpoint)
                    }
                    streamer.handleFailure(null, type)
                }
            }
        })
        ui.on('video-error-timeout-callback', ret => {
            console.log('video-error-timeout-callback', ret)
            if(ret == 'try-other'){
                console.error('VIDEO ERR', 'timeout', {details: 'try-other'})
                streamer.handleFailure(null, 'timeout', true, true)
            } else if(ret == 'stop'){
                console.error('VIDEO ERR', 'timeout', {details: 'stop'})
                streamer.stop()
            } else {
                ui.emit('streamer-reset-timeout')
            }
        })
        ui.on('video-slow', () => {
            console.error('VIDEO SLOW')
            osd.show(lang.SLOW_SERVER, 'fas fa-info-circle', 'video-slow', 'normal')
        })
        ui.on('share', () => {
            streamer.share()
        })
        ui.on('stop', () => {
            if(streamer.active){
                console.warn('STREAMER STOP FROM CLIENT')
                streamer.stop()
                if(tuning){
                    tuning.pause()
                }
                console.warn('STREAMER STOPPED')
            }
        })  
        ui.on('set-epg', url => {
            epgSetup = true
            console.log('SET-EPG', url, global.activeEPG)
            global.config.set('epg', url || 'disabled')
            lists.manager.setEPG(url, true)
        })
        ui.on('open-url', url => {
            console.log('OPENURL', url)
            if(url){
                global.storage.raw.set('open-url', url, true)
                const name = lists.manager.nameFromSourceURL(url), e = {
                    name, 
                    url, 
                    terms: {
                        name: lists.terms(name), 
                        group: []
                    }
                }
                if(isStreamerReady){
                    streamer.play(e)
                } else {
                    playOnLoaded = e
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
            if(ip){
                global.networkIP = () => {
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
        streamer.on('streamer-connect', (src, codecs, info) => {
            console.warn('CONNECT', src, codecs, info)       
            ui.emit('streamer-connect', src, codecs, '', streamer.active.mediaType, info, tuning !== false)
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
            if(['lists', 'shared-mode-reach'].some(k => keys.includes(k))){
                explorer.refresh()
                lists.manager.UIUpdateLists(true)
            }
        })     
        ui.once('init', () => {
            console.warn('Client init')
            explorer.start()  
            icons.refresh()
            streamState.sync()
            if(!isUILoaded){
                isUILoaded = true
                const afterListUpdate = () => {
                    if(!lists.manager.updatingLists && !activeLists.length && config.get('shared-mode-reach')){
                        lists.manager.UIUpdateLists()
                    }
                    cloud.get('configure').then(c => {
                        updateEPGConfig(c)
                        console.log('checking update...')
                        let vkey = 'version', newVersion = MANIFEST.version
                        if(c[vkey] > MANIFEST.version){
                            console.log('new version found', c[vkey])
                            newVersion = c[vkey]
                            ui.on('updater-cb', chosen => {
                                console.log('update callback', chosen)
                                if(chosen == 'yes'){
                                    ui.emit('open-external-url', 'https://megacubo.net/update?ver=' + MANIFEST.version)
                                }
                            })
                            ui.emit('dialog', [
                                {template: 'question', text: ucWords(MANIFEST.name) +' v'+ MANIFEST.version +' > v'+ c[vkey], fa: 'fas fa-star'},
                                {template: 'message', text: lang.NEW_VERSION_AVAILABLE},
                                {template: 'option', text: lang.YES, id: 'yes', fa: 'fas fa-check-circle'},
                                {template: 'option', text: lang.NO, id: 'no', fa: 'fas fa-times-circle'}
                            ], 'updater-cb', 'yes')
                        } else {
                            console.log('updated')
                        }
                    }).catch(console.error)
                }
                if(lists.manager.updatingLists || !config.get('setup-complete')){
                    lists.manager.once('lists-updated', afterListUpdate)                
                } else {
                    afterListUpdate()
                }
                analytics = new Analytics() 
                diagnostics = new Diagnostics() 
                explorer.addFilter(downloads.hook.bind(downloads))
            }
        })
        ui.on('streamer-ready', () => {        
            isStreamerReady = true  
            if(!streamer.active){
                let next = () => {                
                    if(playOnLoaded){
                        streamer.play(playOnLoaded)
                    } else if(config.get('resume')){
                        if(global.explorer.path){
                            console.log('resume skipped, user navigated away')
                        } else {
                            console.log('resuming', histo.resumed, global.streamer)
                            histo.resume()
                        }
                    }
                }
                if(lists.manager.updatingLists || !config.get('setup-complete')){
                    lists.manager.once('lists-updated', next)
                } else {
                    next()
                }
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
        ui.emit('backend-ready', config.all(), lang)
    })
}

let language = config.get('locale')
ui.on('get-lang-callback', (locale, timezone, ua, online) => {
    console.log('get-lang-callback', language, timezone, ua, online)
    if(timezone && (timezone != config.get('timezone'))){
        config.set('timezone', timezone)
    }
    moment.tz.setDefault(timezone)
    if(ua && ua != config.get('ua')){
        config.set('ua', ua)
    }
    if(typeof(online) == 'boolean'){
        setNetworkConnectionState(online)
    }
    if(!language){
        locale = locale.replace(new RegExp(' +', 'g'), '').split(',').filter(s => [2, 5].includes(s.length))
        language = locale.length ? locale[0] : ''
        console.log('get-lang-callback 1', language)
        init(language)
    } else if(lang) {
        console.log('get-lang-callback 2', language)
        ui.emit('backend-ready', config.all(), lang)
    }
})
if(language){
    init(language)
} else if(global.cordova) {
    ui.emit('get-lang')
}
