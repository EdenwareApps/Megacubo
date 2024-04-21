export default (function closed(req, response, source, cb, opts) {
    let socket, timer = 0;
    const delayedCallback = () => {
        clearTimeout(timer);
        timer = setTimeout(callback, 2000);
    };
    const callback = () => {
        process.nextTick(() => {
            clearTimeout(timer);
            if (socket) {
                socket.removeListener('close', delayedCallback);
                socket = null;
            }
            req.removeListener('close', callback);
            response.removeListener('socket', onSocket);
            response.removeListener('end', callback);
            if (source) {
                source.removeListener('end', delayedCallback);
                source.removeListener('close', callback);
            }
            if (cb) {
                cb();
                cb = null;
            }
        });
    };
    const onSocket = () => {
        socket = response.socket;
        socket.once('close', delayedCallback);
    };
    /* Prevent never-ending responses bug on v10.5.0. Is it needed yet? */
    if (response.socket) {
        onSocket();
    }
    else {
        response.once('socket', onSocket);
    }
    req.once('close', callback); // req disconnected
    if (response.ended) {
        callback();
    }
    else {
        response.once('end', callback); // req disconnected
    }
    if (source) {
        source.once('end', delayedCallback);
        source.once('close', callback);
    }
});
