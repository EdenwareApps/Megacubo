import path from 'path'
import { getDirname } from 'cross-dirname'
import MultiWorker from '../multi-worker/multi-worker.js'

let instance

export function getEPGInstance() {
    if (!instance) {        
        const worker = new MultiWorker()
        const epg = worker.load(path.join(getDirname(), 'worker', 'EPGManager.js'))
        instance = { worker, epg }
    }
    return instance
}

export function getEPG() {
    return getEPGInstance().epg
}

export function getEPGWorker() {
    return getEPGInstance().worker
}

export default getEPG
