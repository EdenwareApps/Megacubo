import path from 'path'
import workers from '../multi-worker/main.js'
import { getDirname } from 'cross-dirname'

export default workers.load(path.join(getDirname(), 'jimp-worker.js'))
