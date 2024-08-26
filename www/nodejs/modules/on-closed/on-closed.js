export default (function closed(req, response, source, cb, opts) {
    let socket, done, timer = 0;
    const delayedCallback = () => {
        clearTimeout(timer)
        timer = setTimeout(callback, 2000)
    }
    const callback = () => {
        process.nextTick(() => {
            if (done) return
            done = true
            clearTimeout(timer)
            if (socket) {
                source.removeListener('end', delayedCallback);
                socket.removeListener('close', delayedCallback)
                source.close && source.close()
                socket = null                
            }
            req.removeListener('close', callback)
            response.removeListener('socket', onSocket)
            response.removeListener('end', callback)
            response.end && response.end()
            if (cb) {
                cb()
                cb = null
            }
            req.close && req.close()
        })
    };
    const onSocket = () => {
        socket = response.socket;
        socket.once('close', delayedCallback);
    };
    /* Prevent never-ending responses bug on v10.5.0. Is it needed yet? */
    if (response.socket) {
        onSocket()
    } else {
        response.once('socket', onSocket)
    }
    req.once('close', callback) // req disconnected
    if (response.ended) {
        callback()
    } else {
        response.once('end', callback) // req disconnected
    }
    if (source) {
        source.once('end', delayedCallback)
        source.once('close', callback)
    }
});
