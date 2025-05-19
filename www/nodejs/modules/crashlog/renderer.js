import { traceback } from '../../renderer/src/scripts/utils.js'
import { stringify } from '../serialize/serialize.js'
import { main } from '../bridge/renderer.js'

class Crashlog {
    constructor(){}
    save(message, file, line, error) {
        const stack = (error && error.stack) ? error.stack : traceback()
        main.emit('crash', message +' '+ file +':'+ line +' '+ stack)
    }
}

export const setupCrashlog = ctx => {
    const crashlog = new Crashlog()
    ctx.addEventListener('error', event => {
        crashlog.save(event.message || String(event), event.filename, event.lineno, stringify(event.error))
        return true
    })
}