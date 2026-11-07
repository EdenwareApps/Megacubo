import { main } from '../bridge/renderer'

/**
 * Renderer side of the Android in-app updater.
 *
 * It asks the native AppUpdater plugin (see AppUpdaterPlugin.java) whether a
 * newer APK is available, then hands the decision to the Node.js main process
 * which owns the dialogs, and finally drives download/install back through the
 * plugin.
 */

// How much of the download must advance before the OSD is refreshed again.
const PROGRESS_STEP = 5

const state = {
    started: false,
    awaitingPermission: false,
    listenerAttached: false,
    reportedPercent: -PROGRESS_STEP
}

const nativeUpdater = () => {
    const capacitor = window.capacitor
    return capacitor && capacitor.AppUpdater ? capacitor.AppUpdater : null
}

const emit = (event, data) => {
    try {
        main.emit(event, data)
    } catch (err) {
        console.error('updater: cannot emit ' + event, err)
    }
}

const attachProgress = (plugin) => {
    if (state.listenerAttached) return
    state.listenerAttached = true
    plugin.addListener('progress', (data) => {
        if (!data || !data.state) return
        if (data.state === 'error') {
            emit('android-update-error', { message: data.message || 'download_failed' })
        } else if (data.state === 'downloading') {
            const percent = typeof data.percent == 'number' ? data.percent : -1
            if (percent >= 0 && percent < 100 && (percent - state.reportedPercent) >= PROGRESS_STEP) {
                state.reportedPercent = percent
                emit('android-update-progress', { percent })
            }
        } else if (data.state === 'downloaded') {
            installPending(plugin)
        }
    })
}

const installPending = async (plugin) => {
    try {
        const result = await plugin.installPending()
        if (result && result.status === 'permission') {
            state.awaitingPermission = true
            emit('android-update-permission')
        } else if (result && result.status === 'rejected') {
            emit('android-update-error', { message: result.reason || 'rejected' })
        } else if (result && result.status === 'failed') {
            emit('android-update-error', { message: 'install_failed' })
        }
    } catch (err) {
        emit('android-update-error', { message: err && err.message ? err.message : 'install_failed' })
    }
}

const download = async (info) => {
    const plugin = nativeUpdater()
    if (!plugin || !info || !info.url) return
    attachProgress(plugin)
    state.reportedPercent = -PROGRESS_STEP
    try {
        await plugin.downloadAndInstall({
            url: info.url,
            versionName: info.versionName || '',
            versionCode: info.versionCode || 0,
            sha256: info.sha256 || ''
        })
    } catch (err) {
        emit('android-update-error', { message: err && err.message ? err.message : 'download_failed' })
    }
}

const openInstallSettings = async () => {
    const plugin = nativeUpdater()
    if (!plugin) return
    try {
        await plugin.openInstallSettings()
    } catch (err) {
        console.error('updater: cannot open install settings', err)
    }
}

const resumePending = async (plugin) => {
    try {
        const pending = await plugin.getPending()
        if (pending && pending.available) {
            await installPending(plugin)
        }
    } catch (err) {
        console.error('updater: pending check failed', err)
    }
}

const check = async (plugin) => {
    let result
    try {
        result = await plugin.check({ allowGithub: true })
    } catch (err) {
        console.error('updater: check failed', err)
        return
    }
    if (!result) return
    if (result.available) {
        emit('android-update-available', result)
    } else {
        await resumePending(plugin)
    }
}

const start = () => {
    if (state.started) return
    state.started = true
    const plugin = nativeUpdater()
    if (!plugin) return
    if (main.config['hide-updates']) return

    attachProgress(plugin)

    const capacitor = window.capacitor
    if (capacitor.App && capacitor.App.addListener) {
        capacitor.App.addListener('appStateChange', ({ isActive }) => {
            if (isActive && state.awaitingPermission) {
                state.awaitingPermission = false
                installPending(plugin)
            }
        })
    }

    check(plugin)
}

main.on('android-update-install', (info) => {
    download(info)
})

main.on('android-update-open-settings', () => {
    openInstallSettings()
})

if (main.isReady && main.isReady.main) {
    start()
} else {
    main.once('main-ready', start)
}
