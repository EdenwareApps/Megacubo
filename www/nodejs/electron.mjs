import electron from 'electron'
import remote from '@electron/remote/main'

const ret = electron
const keys = ['clipboard', 'contextBridge', 'webContents', 'webFrame', 'webUtils', 'ipcRenderer', 'getGlobal', 'screen', 'app', 'shell', 'Tray', 'Menu'];

ret.remote = remote

keys.forEach(k => {
    if (remote[k]) {
        ret[k] = remote[k];
    } else if(!ret[k]) {
        if(electron?.remote?.[k]) {
            ret[k] = electron.remote[k];
        } else {
            ret[k] = null;
        }
    }
});

export default ret
