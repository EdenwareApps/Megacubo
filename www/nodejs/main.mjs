import paths from './modules/paths/paths.js'
import path from 'path'
import { fileURLToPath } from 'url'

// Initialize paths immediately to avoid undefined __dirname
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
import crashlog from './modules/crashlog/crashlog.js'
import onexit from 'node-cleanup'
import streamer from './modules/streamer/main.js'
import lang from './modules/lang/lang.js'
import lists from './modules/lists/lists.js'
import Theme from './modules/theme/theme.js'
import options from './modules/options/options.js'
import recommendations from './modules/smart-recommendations/compatibility-wrapper.mjs'
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
import menu from './modules/menu/menu.js'
import { moment, forwardSlashes, rmdirSync, ucWords } from './modules/utils/utils.js'
import osd from './modules/osd/osd.js'
import ffmpeg from './modules/ffmpeg/ffmpeg.js'
import promo from './modules/promoter/promoter.js'
import mega from './modules/mega/mega.js'

const electronDistFile = path.join(__dirname, forwardSlashes(__dirname).includes('/dist') ? 'electron.js' : 'dist/electron.js')
let electron = {}

// Initialize electron module asynchronously
async function initializeElectron() {
    if (process.platform !== 'android') {
        try {
            console.log('🔄 Loading electron module...')
            const electronModule = await import(electronDistFile)
            electron = electronModule.default || electronModule
            console.log('✅ Electron module loaded successfully')
            
            // Initialize electron window after module is loaded
            if (electron.remote) {
                console.log('🚀 Initializing Electron window...')
                await initElectronWindow()
            } else {
                console.warn('⚠️ Electron remote not available')
            }
        } catch (error) {
            console.warn('❌ Could not load electron module:', error.message)
        }
    }
}

// Initialize Electron - detect if running as main app or imported as library
// Check multiple conditions to handle different execution contexts
const isMainModule = (
    // Direct execution
    import.meta.url === `file://${process.argv[1]}` ||
    // Via bin.js or similar launchers
    process.argv[1]?.includes('bin.js') ||
    process.argv[1]?.includes('main.mjs') ||
    process.argv[1]?.includes('main.js') ||
    // Command line arguments indicating app mode
    process.argv.includes('debug') ||
    process.argv.includes('start') ||
    // Default: assume main module unless explicitly imported
    !process.env.MEGACUBO_AS_LIBRARY
)

if (isMainModule) {
    console.log('🚀 Running as main module, initializing Electron...')
    initializeElectron().catch(err => console.warn('Electron initialization error:', err.message))
} else {
    console.log('📚 Running as imported library, skipping Electron initialization')
}

// Remote initialization moved to initElectronWindow function

// set globally available objects
Object.assign(global, {
    channels,
    cloud,
    config,
    Download,
    downloads,
    energy,
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

process.env.UV_THREADPOOL_SIZE = 16
process.on('uncaughtException', (err, origin) => {
    console.error({err, origin})
    console.error('uncaughtException: ' + err.message, err.stack)
    crashlog.save('uncaughtException', err)
    
    // Handle database operation errors gracefully
    if (err && err.message && (
        err.message.includes('Mutex acquisition timeout') ||
        err.message.includes('file closed') ||
        err.message.includes('Database is destroyed')
    )) {
        console.warn('Database operation error handled gracefully, continuing...')
        return false // Don't crash the process
    }
    
    // Handle file descriptor errors gracefully
    if (err && err.code && (
        err.code === 'EBADF' ||
        err.code === 'ENOENT' ||
        err.code === 'EACCES'
    )) {
        console.warn('File operation error handled gracefully:', err.message)
        return false // Don't crash the process
    }
    
    return false
})

process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection:', reason)
    crashlog.save('unhandledRejection', reason)
    
    // Handle HTTP 403 errors specifically
    if (reason && typeof reason === 'string' && reason.includes('Access forbidden (403)')) {
        console.warn('HTTP 403 error handled gracefully, continuing...')
        return // Don't crash the process
    }
    
    // Handle database operation errors gracefully
    if (reason && reason.message && (
        reason.message.includes('Mutex acquisition timeout') ||
        reason.message.includes('file closed') ||
        reason.message.includes('Database is destroyed')
    )) {
        console.warn('Database operation error handled gracefully, continuing...')
        return // Don't crash the process
    }
    
    // Handle file descriptor errors gracefully
    if (reason && reason.code && (
        reason.code === 'EBADF' ||
        reason.code === 'ENOENT' ||
        reason.code === 'EACCES'
    )) {
        console.warn('File operation error handled gracefully:', reason.message)
        return // Don't crash the process
    }
    
    // Handle network/HTTP errors gracefully
    if (reason && (
        (reason.message && reason.message.includes('HTTP error')) ||
        (typeof reason === 'string' && reason.includes('HTTP error'))
    )) {
        console.warn('HTTP/Network error handled gracefully:', reason.message || reason)
        return // Don't crash the process
    }
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
    rmdirSync(streamer.opts.workDir, false)
    if (typeof(renderer) != 'undefined' && renderer) {
        renderer.ui.emit('exit', true)
        renderer.ui.destroy()
    }
})

let originalConsole, initialized, isStreamerReady, playOnLoaded, tuningHintShown, showingSlowBroadcastDialog
function enableConsole(enable) {
    let fns = ['log', 'warn']
    if (typeof(originalConsole) == 'undefined') { // initialize
        originalConsole = {
            error: console.error.bind(console)
        }
        fns.forEach(f => originalConsole[f] = console[f].bind(console))
        config.on('change', (keys, data) => keys.includes('enable-console') && enableConsole(data['enable-console']))
        console.error = (...args) => originalConsole.error('\x1b[31m%s\x1b[0m', ...args)
        if (enable) return // enabled by default, stop here
    }
    enable = true
    if (enable) {
        fns.forEach(f => { console[f] = originalConsole[f] })
    } else {
        fns.forEach(f => { console[f] = () => {} })
    }
}

const debug = config.get('enable-console') || process.argv.includes('--inspect')
enableConsole(debug)

global.activeEPG = ''
streamer.tuning = null

const setupCompleted = () => {
    const l = config.get('lists')
    const fine = Boolean((l && l.length) || config.get('communitary-mode-lists-amount'))
    const current = config.get('setup-completed')
    console.log('setupCompleted', { fine, current })
    if (fine !== current) {
        config.set('setup-completed', fine)
    }
    return fine
}
const setNetworkConnectionState = state => {
    if (state && isStreamerReady) {
        lists.loader.reset()
    }
}
const callAction = (e, value) => {
    const ret = e.action?.(e, value)
    ret?.catch(err => console.error(err))
}
const handleVideoError = async (type, errData) => {
    console.error('VIDEO ERROR', { type, errData })
    if (streamer.zap.isZapping) {
        await streamer.zap.go()
    } else if (streamer.active && !streamer.active.isTranscoding()) {
        if (type == 'timeout') {
            if (!showingSlowBroadcastDialog) {
                let opts = [{ template: 'question', text: lang.SLOW_BROADCAST }], def = 'wait'
                let isCH = streamer.active.type != 'video' && channels.isChannel(streamer.active.data.nameTerms || streamer.active.data.name)
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
                        const ret = await streamer.typeMismatchCheck(info).catch(err => console.error(err))
                        if (ret === true)
                            return
                    }
                }
                if (!paths.android && type == 'playback') {
                    // skip if it's not a false positive due to tuning-blind-trust
                    const openedExternal = await streamer.askExternalPlayer(active.codecData).catch(err => console.error(err))
                    if (openedExternal === true) return
                }
                streamer.handleFailure(null, type).catch(e => menu.displayErr(e))
            }
        }
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
const setupRendererHandlers = () => {
    const { ui } = renderer
    ui.on('menu-update-range', icons.renderRange.bind(icons))
    ui.on('config-set', (k, v) => config.set(k, v))
    ui.on('crash', (...args) => crashlog.save(...args))
    ui.on('lists-manager', ret => {
        switch (ret) {
            case 'agree':
                menu.open('', 0).catch(e => menu.displayErr(e))
                config.set('communitary-mode-lists-amount', lists.opts.defaultCommunityModeReach)
                menu.info(lang.LEGAL_NOTICE, lang.TOS_CONTENT)
                lists.loader.reset()
                break
            case 'retry':
                lists.loader.reset()
                break
            case 'add-list':
                menu.prompt({
                    question: lang[paths.ALLOW_ADDING_LISTS ? 'ASK_IPTV_LIST' : 'OPEN_URL'],
                    placeholder: 'http://.../example.m3u',
                    defaultValue: '',
                    callback: 'lists-manager',
                    fa: 'fas fa-cloud-download-alt'
                }).catch(err => console.error(err))
                break
            case 'back':
                menu.refresh()
                break
            default:
                lists.manager.addList(ret).catch(e => menu.displayErr('Error adding list: ' + e))
                break
        }
    })
    ui.on('reload', ret => {
        console.log('reload', ret)
        switch (ret) {
            case 'agree':
                break
            default:
                lists.manager.addList(ret).catch(e => menu.displayErr(e))
                break
        }
    })
    ui.on('reload-dialog', async () => {
        console.log('reload-dialog')
        if (!streamer.active)
            return
        let opts = [{ template: 'question', text: lang.RELOAD }], def = 'retry'
        let isCH = streamer.active.type != 'video' &&
            (channels.isChannel(streamer.active.data.nameTerms || streamer.active.data.name)
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
    ui.on('testing-stop', () => {
        console.warn('TESTING STOP')
        streamer.state.cancelTests()
    })
    ui.on('tuning-stop', () => {
        console.warn('TUNING ABORT')
        streamer.tuning && streamer.tuning.destroy()
    })
    ui.on('tune', () => {
        let data = streamer.active ? streamer.active.data : streamer.lastActiveData
        console.warn('RETUNNING', data)
        if (data) {
            streamer.tune(data).catch(e => menu.displayErr(e))
        } else {
            streamer.zap.go().catch(e => menu.displayErr(e))
        }
    })
    ui.on('retry', () => {
        console.warn('RETRYING')
        streamer.reload()
    })
    ui.on('video-error', handleVideoError)
    ui.on('share', () => streamer.share())
    ui.on('stop', () => {
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
    ui.on('open-url', url => {
        console.log('OPENURL', {url})
        url && omni.open(url).catch(e => menu.displayErr(e))
    })
    ui.on('open-name', name => {
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
    ui.on('about', async () => {
        if (streamer.active) {
            await streamer.about()
        } else {
            options.about()
        }
    })
    ui.on('network-state-up', () => setNetworkConnectionState(true))
    ui.on('network-state-down', () => setNetworkConnectionState(false))
    ui.on('network-ip', ip => {
        if (ip && np.isNetworkIP(ip)) {
            np.networkIP = () => ip
        }
    })
    ui.once('menu-ready', () => {
        menu.start()
        icons.refresh()
    })
    ui.once('streamer-ready', async () => {
        isStreamerReady = true
        streamer.state.sync()
        renderer.ready() || renderer.ready(null, true)
        if (!streamer.active) {
            await lists.ready().catch(err => console.error(err))
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
    ui.once('close', () => {
        console.warn('Client closed!')
        energy.exit()
    })
    ui.once('exit', () => {
        console.error('Immediate exit called from client.')
        process.exit(0)
    })
    ui.on('suspend', () => {
        streamer.tuning && streamer.tuning.destroy()
        streamer.state && streamer.state.cancelTests()
    })
}

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
const initElectronWindow = async () => {
    console.log('🪟 Starting Electron window initialization...')
    const { app, BrowserWindow, globalShortcut, Menu } = electron
    
    // Initialize remote before creating window
    if (electron.remote) {
        console.log('🔗 Initializing Electron remote...')
        electron.remote.initialize()
        console.log('✅ Electron remote initialized')
    }
    
    const isLinux = process.platform == 'linux', appCmd = app.commandLine    
    const tcpFastOpen = config.get('tcp-fast-open') ? 'true' : 'false'
    
    // Enable Remote Debugging for MCP Electron Desktop Automation
    appCmd.appendSwitch('remote-debugging-port', '9222')

    let gpuFlags = config.get('gpu-flags')
    if (config.get('gpu')) {
        if (!gpuFlags) {
            gpuFlags = Object.keys(options.availableGPUFlags.enable)
        }
        gpuFlags.forEach(f => {
            if (f == 'use-gl') {
                appCmd.appendSwitch(f, 'desktop')
            } else {
                appCmd.appendSwitch(f)
            }
        })
    } else {
        if (!gpuFlags) {
            gpuFlags = Object.keys(options.availableGPUFlags.disable)
        }
        gpuFlags.forEach(f => {
            appCmd.appendSwitch(f)
        })
        try {
            app.disableHardwareAcceleration()
        } catch (e) {
            console.error('Error disabling hardware acceleration', e)
        }
    }

    const features = ['SharedImageManager', 'PlatformHEVCDecoderSupport', 'VaapiVideoDecoder'];
    ['in-process-gpu', 'disable-gpu-sandbox'].forEach(f => {
        if(config.get(f) !== false) {
            appCmd.appendSwitch(f)
        }
    })

    if (process.platform == 'darwin' && config.get('use-metal')) {
        features.unshift('Metal')
    } else if (process.platform == 'linux' && config.get('use-vaapi')) {
        features.unshift('VaapiVideoDecoder')
    } else if (config.get('use-vulkan')) {
        features.unshift('Vulkan')
    }

    appCmd.appendSwitch('password-store', 'basic')
    appCmd.appendSwitch('enable-tcp-fast-open', tcpFastOpen) // networking environments that do not fully support the TCP Fast Open standard may have problems connecting to some websites
    appCmd.appendSwitch('disable-transparency', 'true')
    appCmd.appendSwitch('enable-smooth-scrolling', 'true')
    appCmd.appendSwitch('enable-experimental-web-platform-features') // audioTracks support
    appCmd.appendSwitch('enable-features', features.join(',')) // TODO: Allow user to activate Metal (macOS) and VaapiVideoDecoder (Linux) features
    appCmd.appendSwitch('disable-features', 'IsolateOrigins,NetworkPrediction,OpenVR,UseSkiaRenderer')
    appCmd.appendSwitch('autoplay-policy', 'no-user-gesture-required')
    appCmd.appendSwitch('gtk-version', '4') // https://www.reddit.com/r/Gentoo/comments/yu2s3j/comment/l8pxlz7/

    if(!app.requestSingleInstanceLock()) {
        console.error('Already running.')
        app.quit()
    }
        
    Menu.setApplicationMenu(null)
    onexit(() => app.quit())
        
    await channels.updateUserTasks(app).catch(err => console.error(err))
    await app.whenReady()

    app.on('browser-window-created', (_, window) => {
        console.log('Browser window created')
        electron.remote.enable(window.webContents)
        
        // Capture renderer console logs and errors (only warnings and errors by default)
        window.webContents.on('console-message', (event, level, message, line, sourceId) => {
            // Only log warnings and errors, skip info and debug messages
            if (level >= 2) { // 2 = warning, 3 = error
                const levelName = ['debug', 'info', 'warning', 'error'][level] || 'unknown'
                const sourceStr = sourceId ? `${sourceId}:${line}` : 'unknown'
                const logFn = level === 3 ? console.error : console.warn
                logFn(`🖥️ [Renderer ${levelName}] ${message} ${sourceStr}`)
            }
        })
        
        // Capture renderer errors
        window.webContents.on('crashed', (event, killed) => {
            console.error('💥 Renderer process crashed:', killed ? 'killed' : 'crashed')
        })
        
        // Capture uncaught exceptions in renderer
        window.webContents.on('unresponsive', () => {
            console.warn('⚠️ Renderer process became unresponsive')
        })
        
        window.webContents.on('responsive', () => {
            console.log('✅ Renderer process became responsive again')
        })
        
        // Capture preload script errors
        window.webContents.on('preload-error', (event, preloadPath, error) => {
            console.error('❌ Preload script error:', preloadPath)
            console.error('   Error:', error.message)
            console.error('   Stack:', error.stack)
        })
        
        // Capture IPC errors
        window.webContents.on('ipc-message', (event, channel, ...args) => {
            if (channel === 'error' || channel === 'console-error') {
                console.error('🖥️ [Renderer IPC Error]', ...args)
            }
        })
    })
    
    console.log('🪟 Creating BrowserWindow...')
    
    // Verify preload script exists
    const preloadPath = path.join(paths.cwd, 'dist/preload.js')
    console.log('📄 Preload script path:', preloadPath)
    try {
        const fs = require('fs')
        const preloadExists = fs.existsSync(preloadPath)
        console.log('📄 Preload script exists:', preloadExists)
        if (preloadExists) {
            const stats = fs.statSync(preloadPath)
            console.log('📄 Preload script size:', stats.size, 'bytes')
        }
    } catch (error) {
        console.error('❌ Error checking preload script:', error.message)
    }
    
    global.window = new BrowserWindow({
        width: 240,
        height: 180,
        show: false,
        frame: false,
        maximizable: false,
        minimizable: false,
        titleBarStyle: 'hidden',
        minimized: true,  // Start minimized
        webPreferences: {
            cache: false,
            sandbox: false,
            contextIsolation: true,
            fullscreenable: true,
            disablePreconnect: true,
            dnsPrefetchingEnabled: false,
            nodeIntegration: false,
            nodeIntegrationInWorker: false,
            nodeIntegrationInSubFrames: false,
            preload: path.join(paths.cwd, 'dist/preload.js'),
            experimentalFeatures: true,
            navigateOnDragDrop: true,
            devTools: debug,
            webSecurity: false // desabilita o webSecurity
        }
    })
    console.log('✅ BrowserWindow created successfully')
    
    // Show window immediately after creation for debugging
    console.log('🪟 Showing window immediately for debugging...')
    window.show()
    window.focus()

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
        if (err) {
            console.error('❌ Bridge ready error:', err)
            return
        }
        console.log('🌉 Bridge ready, loading URL on port:', port)
        window.loadURL('http://127.0.0.1:'+ port +'/renderer/electron.html', { userAgent: renderer.ui.ua })
        window.setAlwaysOnTop(true) // trick to take focus
        window.focus()
        window.setAlwaysOnTop(false)
        console.log('🌐 URL loaded, showing window again...')
        window.show()
        console.log('✅ Window should be visible now!')
    })
}
const init = async (locale, timezone) => {
    if (initialized) return
    
    // Check startup window configuration
    const startupWindow = config.get('startup-window')
    console.log('🔧 Startup window configuration:', startupWindow)
    if (startupWindow !== 'miniplayer') {
        console.log('🪟 Showing window (not miniplayer mode)')
        if (global?.window) {
            global.window.show()
            console.log('✅ Window shown successfully')
        } else {
            console.warn('⚠️ Global window not available')
        }
    } else {
        console.log('📱 Starting in miniplayer mode')
    }
    
    initialized = true
    await lang.load(locale, config.get('locale'), paths.cwd + '/lang', timezone).catch(e => menu.displayErr(e))
    console.log('Language loaded.')
    moment.locale([
        lang.locale +'-'+ lang.countryCode,
        lang.locale
    ])
    
    global.theme = new Theme()
    
    console.log('Initializing premium...')

    const Premium = await import('./modules/premium-helper/premium-helper.js')
    if(Premium) {
        const p = typeof(Premium.default) == 'function' ? Premium.default : Premium
        global.premium = new p()
    }

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
    // Register promoter output filter AFTER recommendations to ensure it runs last
    // (promoter needs to see the complete list including "Recomendado para Você")
    if (!promo._outputFilterRegistered) {
        menu.addOutputFilter(promo.applyOutputFilter.bind(promo))
        promo._outputFilterRegistered = true
    }
    menu.on('render', icons.render.bind(icons))
    menu.on('action', async e => {
        await menu.withBusy(e.path, async () => {
            if (typeof (e.type) == 'undefined') {
                if (typeof (e.url) == 'string') {
                    e.type = 'stream'
                } else if (typeof (e.action) == 'function') {
                    e.type = 'action'
                }
            }
            switch (e.type) {
                case 'stream':
                    if (streamer.tuning) {
                        streamer.tuning.destroy()
                        streamer.tuning = null
                    }
                    streamer.zap.setZapping(false, null, true)
                    if (typeof (e.action) == 'function') { // execute action for stream, if any
                        callAction(e)
                    } else {
                        streamer.play(e)
                    }
                    break
                case 'input':
                    if (typeof (e.action) == 'function') {
                        let defaultValue = typeof (e.value) == 'function' ? e.value() : (e.value || undefined)
                        let val = await menu.prompt({
                            question: e.name,
                            placeholder: '',
                            defaultValue,
                            multiline: e.multiline,
                            fa: e.fa
                        })
                        callAction(e, val)
                    }
                    break
                case 'action':
                    if (typeof (e.action) == 'function') {
                        callAction(e)
                    } else if (e.url && mega.isMega(e.url)) {
                        if (streamer.tuning) {
                            streamer.tuning.destroy()
                            streamer.tuning = null
                        }
                        streamer.zap.setZapping(false, null, true)
                        streamer.play(e)
                    }
                    break
            }
        })
    })
    setupRendererHandlers()
    options.on('devtools-open', () => {
        const { BrowserWindow } = electron
        BrowserWindow.getAllWindows().shift().openDevTools()
    })
    recommendations.on('updated', () => {
        console.log('🔄 Recommendations updated. Now: ' + parseInt(new Date().getTime()/1000))
        setTimeout(() => {
            if (!menu.path) {
                menu.updateHomeFilters().catch(err => console.error(err))
            }
        }, 1000)
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
            lists.loader.reset()
        }
    })
    renderer.ready(async () => {
        const setupComplete = setupCompleted()
        if (!setupComplete) {
            // Ensure menu is ready before starting wizard
            await new Promise(resolve => {
                if (menu && menu.dialogs && menu.dialogs.dialog) {
                    resolve()
                } else {
                    renderer.ui.once('menu-ready', () => {
                        // Give menu a moment to fully initialize
                        setTimeout(resolve, 100)
                    })
                }
            })
            const wizard = new Wizard()
            await wizard.init()
        }
        menu.addFilter(downloads.hook.bind(downloads))
        lists.loader.reset()
        await crashlog.send().catch(err => console.error(err))
        await lists.ready()
        console.log('WaitListsReady resolved!')
        
        // Initialize smart recommendations system AFTER lists are ready
        console.log('🚀 Initializing Smart Recommendations...')
        try {
            const initialized = await recommendations.initialize()
            if (initialized) {
                console.log('✅ Smart Recommendations initialized successfully')
            } else {
                console.warn('⚠️ Smart Recommendations initialization failed (Trias may not be available)')
            }
        } catch (error) {
            console.warn('❌ Smart Recommendations initialization error:', error.message)
        }
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
    await storage.cleanup()
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
}
// Electron window initialization is now handled in initializeElectron() function


export {
    channels, cloud, config, Download, downloads, energy, ffmpeg, icons, lang, lists, menu, moment, options, osd, 
    paths, promo, recommendations, renderer, storage, streamer, init
}