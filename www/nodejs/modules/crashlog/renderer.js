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
        // Prefer the stack of the error that was actually thrown: `stringify` keeps
        // name/message/stack for Error objects, so `traceback()` (which points at this very
        // handler) is only the last resort. The column was being dropped as well, which made
        // the player library crashes almost impossible to locate
        // (see BUG_REPORT_17.7.0_17581.md, bug 4).
        const error = event.error
        const detail = (error && error.stack) ? error : stringify(error)
        const position = event.lineno ? (event.lineno + (event.colno ? ':' + event.colno : '')) : 0
        crashlog.save(event.message || String(event), event.filename || '(unknown)', position, detail)
        return true
    })
    // Renderer promise rejections were not reported at all. Only rejections carrying a stack
    // are reported - string/flag rejections are expected control flow and only logged.
    ctx.addEventListener('unhandledrejection', event => {
        const reason = event.reason
        if (!reason || !reason.stack) {
            console.warn('Unhandled rejection (not reported):', reason)
            return
        }
        crashlog.save('Unhandled rejection: ' + (reason.message || String(reason)), (ctx.location && ctx.location.href) || '(renderer)', 0, reason)
    })
}