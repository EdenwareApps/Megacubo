const ready = () => {
    let done = false
    let callback = null
    const listeners = []
    const instance = () => {
        if (done) {
            if (done.err) {
                return Promise.reject(done.err)
            }
            return Promise.resolve(true)
        }
        if (callback) {
            const finish = callback.finish
            const promise = callback.fn()
            if (promise && typeof promise.then === 'function') {
                promise.then(() => {
                    if (finish === true) {
                        instance.done()
                    }
                }).catch(err => {
                    instance.done(err)
                })
            } else if (finish === true) {
                instance.done()
            }
            callback = null
            return promise
        }
        return new Promise((resolve, reject) => {
            if (!Array.isArray(listeners)) {
                listeners = []
            }
            listeners.push({ resolve, reject })
        })
    }
    instance.done = err => {
        done = {err}
        if (err) {
            listeners.forEach(listener => listener.reject(err))
        } else {
            listeners.forEach(listener => listener.resolve(true))
        }
        listeners.length = 0
        callback = null
    }
    instance.starter = (fn, finish = false) => {
        if (done) return
        callback = {fn, finish}
    }
    instance.is = () => {
        return !!done
    }
    return instance
}

export default ready