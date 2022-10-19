
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
    save(message, file, line, column, errorObj){
        console.warn('IDX', message, file, line, column, errorObj)
        let stack = errorObj !== undefined && errorObj !== null ? errorObj.stack : traceback()
        if(this.maxAlerts){
            this.maxAlerts--
            alert(message +' '+ file +':'+ line +' '+ stack)
            console.error(errorObj || message)
        }
        app && app.emit('crash', message +' '+ file +':'+ line +' '+ stack)
    }
}

var crashlog = new Crashlog()
window.onerror = (...args) => {
    crashlog.save(...args)
    return true
}
