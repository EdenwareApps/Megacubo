import paths from './modules/paths/paths.js'
import electron from 'electron'
import { spawn } from 'child_process'
import path from 'path'
import crashlog from './modules/crashlog/crashlog.js'
import onexit from 'node-cleanup'
import streamer from './modules/streamer/main.js'
import lang from './modules/lang/lang.js'
import lists from './modules/lists/lists.js'
import Theme from './modules/theme/theme.js'
import options from './modules/options/options.js'
import recommendations from './modules/recommendations/recommendations.js'
import icons from './modules/icon-server/icon-server.js'
import np from './modules/network-ip/network-ip.js'
import energy from './modules/energy/energy.js'
import Wizard from './modules/wizard/wizard.js'
import downloads from './modules/downloads/downloads.js'
import cloud from './modules/cloud/cloud.js'
import './modules/analytics/analytics.js'
import omni from './modules/omni/omni.js'
import config from './modules/config/config.js'
import Download from './modules/download/download.js'
import renderer from './modules/bridge/bridge.js'
import storage from './modules/storage/storage.js'
import channels from './modules/channels/channels.js'
import { getFilename } from 'cross-dirname'
import { createRequire } from 'module'
import menu from './modules/menu/menu.js'
import { moment, rmdirSync, ucWords } from './modules/utils/utils.js'
import osd from './modules/osd/osd.js'
import ffmpeg from './modules/ffmpeg/ffmpeg.js'
import promo from './modules/promoter/promoter.js'
import mega from './modules/mega/mega.js'
                
/* Preload script variables */
Object.assign(global, {
    channels,
    cloud,
    config,
    Download,
    downloads,
    ffmpeg,
    icons,
    lang,
    lists,
    menu,
    moment,
    options,
    osd,
    paths,
    promo,
    recommendations,
    renderer,
    storage,
    streamer
})

console.log('[main] Initializing node...')
process.env.UV_THREADPOOL_SIZE = 16
if (!paths.android) {
    if (typeof(electron) === 'string') {
        const file = getFilename()
        console.log('[main] Electron: ' + electron +' '+ file)
        const args = [file, ...process.argv.slice(2)]
        const child = spawn(electron, args, { detached: true, stdio: 'ignore' })
        child.unref()
        process.exit()
    }
}

process.on('warning', e => console.warn(e, e.stack))
process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled rejection at:', promise, 'reason:', reason, reason.stack || '')
    crashlog.save('Unhandled rejection at:', promise, 'reason:', reason)
})
process.on('uncaughtException', exception => {
    console.error('uncaughtException: ' + crashlog.stringify(exception), exception.stack)
    crashlog.save('uncaughtException', exception)
    return false
})
onexit(() => {
    global.isExiting = true
    console.error('APP_EXIT')
    if (typeof(streamer) != 'undefined' && streamer.active) {
        streamer.stop()
    }
    if (streamer.tuning) {
        streamer.tuning.destroy()
        streamer.tuning = null
    }
    rmdirSync(paths.temp, false)
    if (typeof(renderer) != 'undefined' && renderer) {
        renderer.ui.emit('exit', true)
        renderer.ui.destroy()
    }
})

let originalConsole
function enableConsole(enable) {
    let fns = ['log', 'warn']
    if (typeof(originalConsole) == 'undefined') { // initialize
        originalConsole = {}
        fns.forEach(f => originalConsole[f] = console[f].bind(console))
        config.on('change', (keys, data) => keys.includes('enable-console') && enableConsole(data['enable-console']))
        if (enable)
            return // enabled by default, stop here
    }
    if (enable) {
        fns.forEach(f => { console[f] = originalConsole[f] })
    } else {
        fns.forEach(f => { console[f] = () => {} })
    }
}
enableConsole(config.get('enable-console') || process.argv.includes('--inspect'))
console.log('[main] Loading modules...')
console.log('[main] Modules loaded.')
global.activeEPG = ''
streamer.tuning = null
let isStreamerReady, playOnLoaded, tuningHintShown, showingSlowBroadcastDialog
const setupCompleted = () => {
    const l = config.get('lists')
    const fine = (l && l.length) || config.get('communitary-mode-lists-amount')
    if (fine != config.get('setup-completed')) {
        config.set('setup-completed', fine)
    }
    return fine
}
const setNetworkConnectionState = state => {
    Download.setNetworkConnectionState(state)
    if (state && isStreamerReady) {
        lists.manager.update()
    }
}
const videoErrorTimeoutCallback = ret => {
    console.log('video-error-timeout-callback', ret)
    if (ret == 'try-other') {
        streamer.handleFailure(null, 'timeout', true, true).catch(e => menu.displayErr(e))
    } else if (ret == 'retry') {
        streamer.reload()
    } else if (ret == 'transcode') {
        streamer.transcode()
    } else if (ret == 'external') {
        renderer.ui.emit('external-player')
    } else if (ret == 'stop') {
        streamer.stop()
    } else {
        renderer.ui.emit('streamer-reset-timeout')
    }
}
let initialized
const init = async (language, timezone) => {
    if (initialized) return
    initialized = true
    await lang.load(language, config.get('locale'), paths.cwd + '/lang', timezone).catch(e => menu.displayErr(e))
    console.log('Language loaded.')
    moment.locale([
        lang.locale +'-'+ lang.countryCode,
        lang.locale
    ])
    
    global.theme = new Theme()
    
    rmdirSync(streamer.opts.workDir, false)
    console.log('Initializing premium...')

    const Premium = await import('./modules/premium-helper/premium-helper.js')
    global.premium = new Premium.default()

    streamer.state.on('state', (url, state, source) => {
        if (source) {
            lists.discovery.reportHealth(source, state != 'offline')
        }
    })
    menu.addFilter(channels.hook.bind(channels))
    menu.addFilter(channels.bookmarks.hook.bind(channels.bookmarks))
    menu.addFilter(channels.history.hook.bind(channels.history))
    menu.addFilter(channels.trending.hook.bind(channels.trending))
    menu.addFilter(lists.manager.hook.bind(lists.manager))
    menu.addFilter(options.hook.bind(options))
    menu.addFilter(theme.hook.bind(theme))
    menu.addFilter(channels.search.hook.bind(channels.search))
    menu.addOutputFilter(recommendations.hook.bind(recommendations))
    renderer.ui.on('menu-update-range', icons.renderRange.bind(icons))
    menu.on('render', icons.render.bind(icons))
    menu.on('action', async e => {
        const busy = menu.setBusy(e.path)
        if (typeof(e.type) == 'undefined') {
            if (typeof(e.url) == 'string') {
                e.type = 'stream'
            } else if (typeof(e.action) == 'function') {
                e.type = 'action'
            }
        }
        switch(e.type){
            case 'stream':
                if(streamer.tuning){
                    streamer.tuning.destroy()
                    streamer.tuning = null
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
                if(typeof(e.action) == 'function') {
                    let ret = e.action(e)
                    if(ret && ret.catch) ret.catch(e => menu.displayErr(e))
                } else if(e.url && mega.isMega(e.url)) {
                    if(streamer.tuning){
                        streamer.tuning.destroy()
                        streamer.tuning = null
                    }
                    streamer.zap.setZapping(false, null, true)
                    streamer.play(e)
                }
                break
        }
        busy.release()
    })
    renderer.ui.on('config-set', (k, v) => config.set(k, v))
    renderer.ui.on('crash', (...args) => crashlog.save(...args))
    renderer.ui.on('lists-manager', ret => {
        console.log('lists-manager', ret)
        switch (ret) {
            case 'agree':
                menu.open('', 0).catch(e => menu.displayErr(e))
                config.set('communitary-mode-lists-amount', lists.opts.defaultCommunityModeReach)
                menu.info(lang.LEGAL_NOTICE, lang.TOS_CONTENT)
                lists.manager.update()
                break
            case 'retry':
                lists.manager.update()
                break
            case 'add-list':
                menu.prompt({
                    question: lang[ALLOW_ADDING_LISTS ? 'ASK_IPTV_LIST' : 'OPEN_URL'],
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
                lists.manager.addList(ret).catch(e => menu.displayErr(e))
                break
        }
    })
    renderer.ui.on('reload', ret => {
        console.log('reload', ret)
        switch (ret) {
            case 'agree':
                break
            default:
                lists.manager.addList(ret).catch(e => menu.displayErr(e))
                break
        }
    })
    renderer.ui.on('reload-dialog', async () => {
        console.log('reload-dialog')
        if (!streamer.active)
            return
        let opts = [{ template: 'question', text: lang.RELOAD }], def = 'retry'
        let isCH = streamer.active.type != 'video' &&
            (channels.isChannel(streamer.active.data.terms ? streamer.active.data.terms.name : streamer.active.data.name)
            || mega.isMega(streamer.active.data.originalUrl || streamer.active.data.url))
        if (isCH) {
            opts.push({ template: 'option', text: lang.PLAY_ALTERNATE, fa: config.get('tuning-icon'), id: 'try-other' })
            def = 'try-other'
        }
        opts.push({ template: 'option', text: lang.RELOAD_THIS_BROADCAST, fa: 'fas fa-redo', id: 'retry' })
        if (!paths.android) {
            opts.push({ template: 'option', text: lang.OPEN_EXTERNAL_PLAYER, fa: 'fas fa-window-restore', id: 'external' })
        }
        if (typeof(streamer.active.transcode) == 'function' && !streamer.active.isTranscoding()) {
            opts.push({ template: 'option', text: lang.FIX_AUDIO_OR_VIDEO + ' &middot; ' + lang.TRANSCODE, fa: 'fas fa-wrench', id: 'transcode' })
        }
        if (opts.length > 2) {
            let ret = await menu.dialog(opts, def)
            videoErrorTimeoutCallback(ret)
        } else { // only reload action is available
            streamer.reload()
        }
    })
    renderer.ui.on('testing-stop', () => {
        console.warn('TESTING STOP')
        streamer.state.cancelTests()
    })
    renderer.ui.on('tuning-stop', () => {
        console.warn('TUNING ABORT')
        streamer.tuning && streamer.tuning.destroy()
    })
    renderer.ui.on('tune', () => {
        let data = streamer.active ? streamer.active.data : streamer.lastActiveData
        console.warn('RETUNNING', data)
        if (data) {
            streamer.tune(data).catch(e => menu.displayErr(e))
        } else {
            streamer.zap.go().catch(e => menu.displayErr(e))
        }
    })
    renderer.ui.on('retry', () => {
        console.warn('RETRYING')
        streamer.reload()
    })
    renderer.ui.on('video-error', async (type, errData) => {
        console.error('VIDEO ERROR', { type, errData })
        if (streamer.zap.isZapping) {
            await streamer.zap.go()
        } else if (streamer.active && !streamer.active.isTranscoding()) {
            if (type == 'timeout') {
                if (!showingSlowBroadcastDialog) {
                    let opts = [{ template: 'question', text: lang.SLOW_BROADCAST }], def = 'wait'
                    let isCH = streamer.active.type != 'video' && channels.isChannel(streamer.active.data.terms ? streamer.active.data.terms.name : streamer.active.data.name)
                    if (isCH) {
                        opts.push({ template: 'option', text: lang.PLAY_ALTERNATE, fa: config.get('tuning-icon'), id: 'try-other' })
                        def = 'try-other'
                    }
                    opts.push({ template: 'option', text: lang.RELOAD_THIS_BROADCAST, fa: 'fas fa-redo', id: 'retry' })
                    opts.push({ template: 'option', text: lang.WAIT, fa: 'fas fa-clock', id: 'wait' })
                    if (!isCH) {
                        opts.push({ template: 'option', text: lang.STOP, fa: 'fas fa-stop', id: 'stop' })
                    }
                    showingSlowBroadcastDialog = true
                    let ret = await menu.dialog(opts, def, true)
                    showingSlowBroadcastDialog = false
                    videoErrorTimeoutCallback(ret)
                }
            } else {
                const active = streamer.active
                if (active) {
                    if (type == 'playback') {
                        if (errData && errData.details && errData.details == 'NetworkError') {
                            type = 'request error'
                        }
                        if (type == 'playback') { // if type stills being 'playback'
                            const data = active.data
                            Object.assign(data, {
                                allowBlindTrust: false,
                                skipSample: false
                            })
                            const info = await streamer.info(data.url, 2, data).catch(e => {
                                type = 'request error'
                            })
                            const ret = await streamer.typeMismatchCheck(info).catch(console.error)
                            if (ret === true)
                                return
                        }
                    }
                    if (!paths.android && type == 'playback') {
                        // skip if it's not a false positive due to tuning-blind-trust
                        const openedExternal = await streamer.askExternalPlayer(active.codecData).catch(console.error)
                        if (openedExternal === true) return
                    }
                    streamer.handleFailure(null, type).catch(e => menu.displayErr(e))
                }
            }
        }
    })
    renderer.ui.on('share', () => streamer.share())
    renderer.ui.on('stop', () => {
        if (streamer.active) {
            console.warn('STREAMER STOP FROM CLIENT')
            streamer.emit('stop-from-client')
            streamer.stop()
            streamer.tuning && streamer.tuning.pause()
        }
        let isEPGEnabledPath = !channels.search.isSearching() && [lang.TRENDING, lang.BOOKMARKS, lang.LIVE].some(p => menu.path.startsWith(p))
        if (isEPGEnabledPath) { // update current section data for epg freshness
            menu.refresh()
        }
    })
    renderer.ui.on('open-url', url => {
        console.log('OPENURL', url)
        omni.open(url).catch(e => menu.displayErr(e))
    })
    renderer.ui.on('open-name', name => {
        console.log('OPEN STREAM BY NAME', name)
        if (name) {            
            const e = { name, url: mega.build(name) }
            if (isStreamerReady) {
                streamer.play(e)
            } else {
                playOnLoaded = e
            }
        }
    })
    renderer.ui.on('about', async () => {
        if (streamer.active) {
            await streamer.about()
        } else {
            options.about()
        }
    })
    renderer.ui.on('network-state-up', () => setNetworkConnectionState(true))
    renderer.ui.on('network-state-down', () => setNetworkConnectionState(false))
    renderer.ui.on('network-ip', ip => {
        if (ip && np.isNetworkIP(ip)) {
            np.networkIP = () => ip
        }
    })
    options.on('devtools-open', () => {
        const { BrowserWindow } = electron
        BrowserWindow.getAllWindows().shift().openDevTools()
    })
    streamer.on('streamer-connect', async (src, codecs, info) => {
        if (!streamer.active)
            return
        console.error('CONNECT', src, codecs, info)
        let cantune
        if (streamer.active.mediaType == 'live') {
            if (streamer.tuning) {
                if (streamer.tuning.tuner && streamer.tuning.tuner.entries.length > 1) {
                    cantune = true
                }
            } else if (channels.isChannel(info.name)) {
                cantune = true
            }
        }
        renderer.ui.emit('streamer-connect', src, codecs, '', streamer.active.mediaType, info, cantune)
        if (cantune) {
            if (!tuningHintShown && channels.history.get().length) {
                tuningHintShown = true
            }
            if (!tuningHintShown) {
                tuningHintShown = true
                renderer.ui.emit('streamer-show-tune-hint')
            }
        }
    })
    streamer.on('streamer-disconnect', err => {
        console.warn('DISCONNECT', err, streamer.tuning !== false)
        renderer.ui.emit('streamer-disconnect', err, streamer.tuning !== false)
    })
    streamer.on('stop', (err, data) => {
        renderer.ui.emit('remove-status-flag-from-all', 'fas fa-play-circle faclr-green')
        renderer.ui.emit('streamer-stop')
    })
    config.on('change', (keys, data) => {
        renderer.ui.emit('config', keys, data)
        if (['lists', 'communitary-mode-lists-amount', 'interests'].some(k => keys.includes(k))) {
            menu.refresh()
            lists.manager.update()
        }
    })
    renderer.ui.once('menu-ready', () => {
        menu.start()
        icons.refresh()
    })
    renderer.ui.once('streamer-ready', async () => {
        isStreamerReady = true
        streamer.state.sync()
        renderer.ready() || renderer.ready(null, true)
        if (!streamer.active) {
            await lists.manager.ready().catch(console.error)
            if (playOnLoaded) {
                streamer.play(playOnLoaded)
            } else if (config.get('resume')) {
                if (menu.path) {
                    console.log('resume skipped, user navigated away')
                } else {
                    console.log('resuming', channels.history.resumed, streamer)
                    channels.history.resume()
                }
            }
        }
    })
    renderer.ui.once('close', () => {
        console.warn('Client closed!')
        energy.exit()
    })
    renderer.ui.once('exit', () => {
        console.error('Immediate exit called from client.')
        process.exit(0)
    })
    renderer.ui.on('suspend', () => {
        streamer.tuning && streamer.tuning.destroy()
        streamer.state && streamer.state.cancelTests()
    })
    renderer.ready(async () => {
        const updatePrompt = async (c) => {
            let chosen = await menu.dialog([
                { template: 'question', text: ucWords(paths.manifest.name) + ' v' + paths.manifest.version + ' > v' + c.version, fa: 'fas fa-star' },
                { template: 'message', text: lang.NEW_VERSION_AVAILABLE },
                { template: 'option', text: lang.YES, id: 'yes', fa: 'fas fa-check-circle' },
                { template: 'option', text: lang.HOW_TO_UPDATE, id: 'how', fa: 'fas fa-question-circle' },
                { template: 'option', text: lang.WHATS_NEW, id: 'changelog', fa: 'fas fa-info-circle' },
                { template: 'option', text: lang.NO_THANKS, id: 'no', fa: 'fas fa-times-circle' }
            ], 'yes')
            console.log('update callback', chosen)
            if (chosen == 'yes') {
                renderer.ui.emit('open-external-url', 'https://megacubo.net/update?ver=' + paths.manifest.version)
            } else if (chosen == 'how') {
                await menu.dialog([
                    { template: 'question', text: lang.HOW_TO_UPDATE, fa: 'fas fa-question-circle' },
                    { template: 'message', text: lang.UPDATE_APP_INFO },
                    { template: 'option', text: 'OK', id: 'submit', fa: 'fas fa-check-circle' }
                ], 'yes')
                await updatePrompt(c)
            } else if (chosen == 'changelog') {
                renderer.ui.emit('open-external-url', 'https://github.com/EdenwareApps/Megacubo/releases/latest')
                await updatePrompt(c)
            }
        }
        const setupComplete = setupCompleted()
        if (!setupComplete) {
            const wizard = new Wizard()
            await wizard.init()
        }
        menu.addFilter(downloads.hook.bind(downloads))
        lists.manager.update()
        await crashlog.send().catch(console.error)
        await lists.manager.ready()
        console.log('WaitListsReady resolved!')
        let err, c = await cloud.get('configure').catch(e => err = e) // all below in func depends on 'configure' data
        if (err) {
            console.error(err)
            c = {}
        }
        console.log('checking update...')
        if (!config.get('hide-updates')) {
            if (c.version > paths.manifest.version) {
                console.log('new version found', c.version)
                await updatePrompt(c)
            } else {
                console.log('updated')
            }
        }
        renderer.ui.emit('arguments', process.argv)
    })
    console.warn('Prepared to connect.')
    renderer.ui.emit('main-ready', config.all(), lang.getTexts())
}
renderer.ui.once('get-lang-callback', (locale, timezone, ua, online) => {
    console.log('[main] get-lang-callback', timezone, ua, online)
    if (timezone) {
        moment.tz.setDefault(timezone.name)
    }
    if (ua && ua != config.get('default-user-agent')) {
        config.set('default-user-agent', ua)
    }
    if (typeof(online) == 'boolean') {
        setNetworkConnectionState(online)
    }
    if (!initialized) {
        console.log('get-lang-callback 1')
        init(locale, timezone)
    } else {
        console.log('get-lang-callback 2')
        lang.ready().catch(e => menu.displayErr(e)).finally(() => {
            renderer.ui.emit('main-ready', config.all(), lang.getTexts())
        })
    }
})
if (paths.android) {
    renderer.ui.emit('get-lang')
} else {
    console.log('[main] Initializing window...')
    let remote
    const tcpFastOpen = config.get('tcp-fast-open') ? 'true' : 'false'
    const contextIsolation = parseFloat(process.versions.electron) >= 22
    const require = createRequire(getFilename())
    if(contextIsolation) {
        remote = require('@electron/remote/main')
        remote.initialize()
    }

    const { app, BrowserWindow, globalShortcut, Menu } = electron
    if(!app.requestSingleInstanceLock()) {
        console.error('Already running.')
        app.quit()
    }
    console.log('[main] Initializing window...')
    Menu.setApplicationMenu(null)
    onexit(() => app.quit())
    if (contextIsolation) {
        app.once('browser-window-created', (_, window) => {
            remote.enable(window.webContents)
        })
    }
    const initAppWindow = async () => {
        console.log('[main] Initializing window... 3')
        const isLinux = process.platform == 'linux'
        await channels.updateUserTasks(app).catch(console.error)
        console.log('[main] Initializing window... 4')
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
        app.commandLine.appendSwitch('enable-features', 'PlatformHEVCDecoderSupport') // TODO: Allow user to activate Metal (macOS) and VaapiVideoDecoder (Linux) features
        app.commandLine.appendSwitch('disable-features', 'IsolateOrigins,SitePerProcess,NetworkPrediction')
        app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required")
        app.commandLine.appendSwitch('disable-web-security')
        await app.whenReady()
        console.log('[main] Initializing window... 5')
        global.window = new BrowserWindow({
            width: 320,
            height: 240,
            frame: false,
            maximizable: false,
            minimizable: false,
            titleBarStyle: 'hidden',
            webPreferences: {
                cache: false,
                sandbox: false,
                contextIsolation,
                fullscreenable: true,
                disablePreconnect: true,
                dnsPrefetchingEnabled: false,
                nodeIntegration: false,
                nodeIntegrationInWorker: false,
                nodeIntegrationInSubFrames: false,
                preload: path.join(paths.cwd, 'dist/preload.js'),
                enableRemoteModule: true,
                experimentalFeatures: true,
                webSecurity: false // desabilita o webSecurity
            }
        })
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
                renderer.ui.emit('arguments', commandLine)
            }
        })
        window.once('closed', () => window.closed = true) // prevent bridge IPC error
        renderer.ui.setElectronWindow(window)
        renderer.bridgeReady((err, port) => {
            window.loadURL('http://127.0.0.1:'+ port +'/renderer/electron.html', { userAgent: renderer.ui.ua })
        })
        console.log('[main] Initializing window... 6')    
    }
    initAppWindow().catch(console.error)
}
console.log('[main] Main initialized.')

export default {paths, config, osd, channels, lists, energy, lang, options, streamer, storage, renderer}
