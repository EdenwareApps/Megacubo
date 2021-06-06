module.exports = function closed(req, response, cb){
	let socket
	const socketCloseListener = () => {
		setTimeout(() => {
			if(global.isWritable(response)){
				callback()
			}
		}, 2000)
	}
	const callback = () => {
		process.nextTick(() => {
			if(cb && !response.ended && global.isWritable(response)){
				if(socket){
					socket.removeListener('close', socketCloseListener)
					socket = null
				}
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
	req.once('close', () => { // req disconnected
		callback()
	})
	response.once('end', () => { // req disconnected
		callback()
	})
}