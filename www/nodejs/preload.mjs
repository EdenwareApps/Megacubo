import electron from "electron";
import { EventEmitter } from 'events';
import path from "path";
import fs from "fs";
import { spawn } from "child_process";
import ExecFinder from 'exec-finder';
import { getFilename } from "cross-dirname";
import { createRequire } from 'node:module';
import Download from "./modules/download/download.js";
import { prepare } from "./modules/serialize/serialize.js";

function getElectron() {
    const ret = {}, keys = ['contextBridge', 'webFrame', 'webUtils', 'ipcRenderer', 'getGlobal', 'screen', 'app', 'shell', 'Tray', 'Menu'];
    const extract = electron => {
        keys.forEach(k => {
            if (electron[k])
                ret[k] = electron[k];
        });
    };
    extract(electron);
    if (electron.remote) {
        extract(electron.remote);
    }
    const require = createRequire(getFilename())
    try {
        const remote = require('@electron/remote')
        extract(remote)
    } catch (e) { }
    keys.forEach(k => {
        if (!ret[k])
            ret[k] = null;
    });
    return ret;
}

const { contextBridge, webFrame, webUtils, ipcRenderer, getGlobal, screen, app, shell, Tray, Menu } = getElectron();
const paths = getGlobal('paths'), config = getGlobal('config');
const download = Download.get.bind(Download);
const window = getGlobal('window')
class FFmpeg {
    constructor() {
        this.childs = {};
        this.executable = 'ffmpeg';
        if (process.platform == 'win32') {
            this.executable += '.exe'
        }
        this.executableDir = process.resourcesPath || path.resolve('ffmpeg');
        this.executableDir = this.executableDir.replace(new RegExp('\\\\', 'g'), '/');
        if (this.executableDir.includes('resources/app')) {
            this.executableDir = this.executableDir.split('resources/app').shift() + 'resources';
        }
        this.executable = path.basename(this.executable)
        this.tmpdir = paths.temp;
        ['exec', 'cleanup', 'abort', 'setExecutable'].forEach(k => {
            this[k] = this[k].bind(this) // allow export on contextBridge
        })
    }
    setExecutable(executable) {
        this.executableDir = path.dirname(executable)
        this.executable = path.basename(executable)
        if (this.executableDir.includes('resources/app')) {
            this.executableDir = this.executableDir.split('resources/app').shift() + 'resources';
        }
    }
    isMetadata(s) {
        return s.includes('Stream mapping:');
    }
    exec(cmd, success, error, outputListener) {
        let exe, gotMetadata, output = '';
        if (process.platform == 'linux' || process.platform == 'darwin') { // cwd was not being honored on Linux/macOS
            exe = this.executableDir + '/' + this.executable;
        } else {
            exe = this.executable;
        }
        const child = spawn(exe, cmd, {
            cwd: this.executableDir,
            killSignal: 'SIGINT'
        });
        const maxLogLength = 1 * (1024 * 1024), log = s => {
            s = String(s);
            output += s;
            if (output.length > maxLogLength) {
                output = output.substr(-maxLogLength);
            }
            if (!gotMetadata && this.isMetadata(s)) {
                gotMetadata = true;
                success('metadata-' + output);
            }
            outputListener && outputListener(s);
        };
        child.stdout.on('data', log);
        child.stderr.on('data', log);
        child.on('error', err => {
            console.log('FFEXEC ERR', cmd, child, err, output);
            error && error(err);
        });
        child.once('close', () => {
            delete this.childs[child.pid];
            console.log('FFEXEC DONE', cmd.join(' '), child, output);
            success('return-' + output);
            child.removeAllListeners();
        });
        console.log('FFEXEC ' + this.executable, cmd, child);
        this.childs[child.pid] = child;
        success('start-' + child.pid);
    }
    abort(pid) {
        if (typeof (this.childs[pid]) != 'undefined') {
            const child = this.childs[pid];
            delete this.childs[pid];
            child.kill('SIGINT');
        } else {
            console.log('CANTKILL', pid);
        }
    }
    cleanup(keepIds) {
        Object.keys(this.childs).forEach(pid => {
            if (keepIds.includes(pid)) {
                console.log("Cleanup keeping " + pid);
            } else {
                console.log("Cleanup kill " + pid);
                this.abort(pid);
            }
        });
    }
}
class ExternalPlayer {
    constructor() {
        this.players = [
            { processName: 'vlc', playerName: 'VLC Media Player' },
            { processName: 'smplayer', playerName: 'SMPlayer' },
            { processName: 'mpv', playerName: 'MPV' },
            { processName: 'mplayer', playerName: 'MPlayer' },
            { processName: 'xine', playerName: 'Xine' },
            { processName: 'wmplayer', playerName: 'Windows Media Player' },
            { processName: 'mpc-hc64', playerName: 'Media Player Classic - Home Cinema (64-bit)' },
            { processName: 'mpc-hc', playerName: 'Media Player Classic - Home Cinema (32-bit)' },
            { processName: 'mpc-be64', playerName: 'MPC-BE (64-bit)' },
            { processName: 'mpc-be', playerName: 'MPC-BE (32-bit)' },
            { processName: 'GOM', playerName: 'GOM Player' }
        ];
        this.play = async (url, chosen) => {
            const availables = await this.available();
            const player = spawn(availables[chosen], [url], { detached: true, stdio: 'ignore' });
            player.unref();
            return true;
        };
        this.available = async () => {
            const results = {};
            if (!this.finder) {
                this.finder = new ExecFinder({ recursion: 3 });
            }
            const available = await this.finder.find(this.players.map(p => p.processName));
            Object.keys(available).filter(name => available[name].length).forEach(p => {
                const name = this.players.filter(r => r.processName == p).shift().playerName;
                results[name] = available[p].sort((a, b) => a.length - b.length).shift();
            });
            const c = config.get('external-player');
            if (Array.isArray(c)) {
                results[c[1]] = c[0];
            }
            return results;
        };
    }
}
class TrayProxy {
    constructor() {
        ;
        ['removeFromTray', 'goToTray', 'restoreFromTray', 'setShowInTaskbar'].forEach(k => {
            this[k] = this[k].bind(this); // allow export on contextBridge
        });
    }
    prepareTray() {
        if (!this.active) {
            const lang = getGlobal('lang');
            const icon = process.resourcesPath + '/app/default_icon.png';
            const title = 'Megacubo';
            this.active = new Tray(icon);
            this.active.setToolTip(title);
            const contextMenu = Menu.buildFromTemplate([
                {
                    label: title,
                    click: () => {
                        window.show();
                        this.active.destroy();
                        this.active = null;
                    }
                },
                {
                    label: lang.CLOSE,
                    click: () => {
                        this.active.destroy();
                        this.active = null;
                        window.close();
                    }
                }
            ]);
            this.active.setContextMenu(contextMenu);
            this.active.on('click', () => {
                window.show();
                this.active.destroy();
                this.active = null;
            });
        }
    }
    removeFromTray() {
        console.error('leaveMiniPlayer');
        if (this.active) {
            this.active.destroy();
            this.active = false;
            this.setShowInTaskbar(true);
        }
    }
    goToTray() {
        this.prepareTray();
        window.hide();
        this.setShowInTaskbar(false);
    }
    restoreFromTray() {
        console.error('leaveMiniPlayer');
        window.show();
        this.removeFromTray();
    }
    setShowInTaskbar(enable) {
        if (enable) {
            window.setAlwaysOnTop(false);
        } else {
            window.setAlwaysOnTop(true, 'screen-saver');
        }
    }
}
class WindowProxy extends EventEmitter {
    constructor() {
        super()
        this.ipc = ipcRenderer
        this.on = super.on.bind(this)
        this.localEmit = super.emit.bind(this)
        this.removeAllListeners = super.removeAllListeners.bind(this)
        this.emit = (...args) => {
            this.ipc.send('message', prepare(args))
        }
        ipcRenderer.on('message', (_, args) => {
            try {
                this.localEmit('message', args)
            } catch (e) {
                console.error(e, args)
            }
        });
        ['focus', 'blur', 'show', 'hide', 'minimize', 'maximize', 'restore', 'close', 'isMaximized', 'getPosition', 'getSize', 'setSize', 'setAlwaysOnTop', 'setFullScreen', 'setPosition'].forEach(k => {
            this[k] = (...args) => window[k](...args);
        });
        ['maximize', 'enter-fullscreen', 'leave-fullscreen', 'restore', 'minimize', 'close'].forEach(k => {
            window.on(k, (...args) => this.localEmit(k, ...args));
        })
    }
}
const windowProxy = new WindowProxy();
const externalPlayer = new ExternalPlayer();
const ffmpeg = new FFmpeg();
const tray = new TrayProxy();
const screenScaleFactor = screen.getPrimaryDisplay().scaleFactor || 1;
const getScreen = () => {
    const primaryDisplay = screen.getPrimaryDisplay();
    const scaleFactor = primaryDisplay.scaleFactor;
    const bounds = primaryDisplay.bounds;
    const workArea = primaryDisplay.workArea;
    const screenData = {
        width: bounds.width,
        height: bounds.height,
        availWidth: workArea.width,
        availHeight: workArea.height,
        screenScaleFactor: scaleFactor
    };
    return screenData;
};
const restart = () => {
    setTimeout(() => {
        app.relaunch()
        app.quit()
        setTimeout(() => {
            app.relaunch()
            app.exit()
        }, 1000) // some deadline
    }, 0)
}
const getResourceUsage = () => {
    return webFrame.getResourceUsage()
}
const clearCache = () => {
    webFrame.clearCache()
}
const showFilePath = file => {
    return webUtils?.getPathForFile ? webUtils.getPathForFile(file) : file.path
}
if (parseFloat(process.versions.electron) < 22) {
    global.api = {
        platform: process.platform,
        window: windowProxy,
        openExternal: f => shell.openExternal(f),
        screenScaleFactor, externalPlayer, getScreen,
        download, restart, ffmpeg, paths, tray,
        getResourceUsage, clearCache, showFilePath
    };
} else {
    // On older Electron version (9.1.1) exposing 'require' doesn't works as expected.
    contextBridge.exposeInMainWorld('api', {
        platform: process.platform,
        openExternal: f => shell.openExternal(f),
        window: windowProxy,
        screenScaleFactor,
        externalPlayer: {
            play: externalPlayer.play,
            available: externalPlayer.available,
            setContext: externalPlayer.setContext
        },
        getResourceUsage,
        clearCache,
        getScreen,
        download,
        restart,
        ffmpeg,
        paths,
        tray,
        showFilePath
    });
}
