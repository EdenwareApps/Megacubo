import { traceback } from '../../renderer/src/scripts/utils'

class Crashlog {
    constructor(){
        this.maxAlerts = 8
    }
    replaceCircular(val, cache) {
        cache = cache || new WeakSet()
        if (val && typeof(val) == 'object') {
            if (cache.has(val)) return '[Circular]'
            if(val instanceof Error) {
                var error = {}
                Object.getOwnPropertyNames(value).forEach(propName => {
                    error[propName] = value[propName]
                })
                val = error
            }
            cache.add(val)
            var obj = (Array.isArray(val) ? [] : {})
            for(var idx in val) {
                console.error('IDX '+ idx)
                obj[idx] = this.replaceCircular(val[idx], cache)
            }
            if(val['stack']){
                obj['stack'] = this.replaceCircular(val['stack'])
            }
            cache.delete(val)
            return obj
        }
        return val
    }
    save(message, file, line, error) {
        const stack = (error && error.stack) ? error.stack : traceback()
        main.emit('crash', message +' '+ file +':'+ line +' '+ stack)
    }
}

export const setupCrashlog = ctx => {
    const crashlog = new Crashlog()
    ctx.addEventListener('error', event => {
        crashlog.save(event.message || String(event), event.filename, event.lineno, event.error)
        return true
    })
}