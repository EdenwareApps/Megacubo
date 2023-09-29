module.exports = function closed(req, response, cb, opts){
	let socket
	const socketCloseListener = () => setTimeout(callback, 2000)
	const callback = () => {
		process.nextTick(() => {
			if(socket){
				socket.removeListener('close', socketCloseListener)
				socket = null
			}
			if(cb) { // && !response.ended && global.isWritable(response)){
				cb()	
				cb = null	
			}	
		})
	}
	const onSocket = () => {
		socket = response.socket
		socket.once('close', socketCloseListener)
	}
	/* Prevent never-ending responses bug on v10.5.0. Is it needed yet? */
	if(response.socket){
		onSocket()
	} else {
		response.once('socket', onSocket)
	}	
	req.once('close', () => callback()) // req disconnected
	if(response.ended){
		callback()
	} else {
		response.once('end', () => callback()) // req disconnected
	}
}