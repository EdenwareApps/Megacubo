function getElectron() {
    const ret = {}, keys = ['contextBridge', 'ipcRenderer', 'getGlobal']
    const extract = electron => {
        keys.forEach(k => {
            if (electron[k]) ret[k] = electron[k]
        })
    }
    const electron = require('electron')
    extract(electron)
    if (electron.remote) {
        extract(electron.remote)
    } else {
        try {
            const remote = require('@electron/remote')
            extract(remote)
        } catch (e) { }
    }
    keys.forEach(k => {
        if (!ret[k]) ret[k] = null
    })
    return ret
}

const { contextBridge, ipcRenderer, getGlobal } = getElectron()
const Events = require('events')

class ElectronWindow extends Events {
    constructor() {
        super()
        this.localEmit = super.emit.bind(this);
        ['focus', 'blur', 'show', 'hide', 'minimize', 'maximize', 'restore', 'close', 'setSize', 'setAlwaysOnTop', 'setFullScreen', 'setPosition'].forEach(k => {
            this[k] = (...args) => this.emit('electron-window-' + k, ...args)
        });
        ['maximize', 'enter-fullscreen', 'leave-fullscreen', 'restore', 'minimize', 'close'].forEach(k => {
            this.on('electron-window-' + k, (...args) => this.localEmit(k, ...args))
        });
        this.getSize = () => {
            return [this.width, this.height]
        }
        this.emit = (...args) => {
            if (!this.main) this.main = getGlobal('ui')
            this.main.channel.originalEmit(...args)
        }
        this.removeAllListeners = super.removeAllListeners.bind(this)
        this.on = super.on.bind(this)
        this.on('electron-window-metrics', metrics => {
            console.error('METRICS ' + JSON.stringify(metrics))
            Object.keys(metrics).forEach(k => this[k] = metrics[k])
        })
        ipcRenderer.on('message', (_, args) => this.localEmit('message', args))
    }
}

if (parseFloat(process.versions.electron) < 22) {
    process.getWindow = () => new ElectronWindow()
} else {
    // On older Electron version (9.1.1) exposing 'require' doesn't works as expected.
    contextBridge.exposeInMainWorld('require', require)
    contextBridge.exposeInMainWorld(
        'process', {
            arch: process.arch,
            platform: process.platform,
            cwd: () => process.cwd(),
            versions: process.versions,
            resourcesPath: process.resourcesPath,
            getWindow: () => new ElectronWindow()
        }
    )
}