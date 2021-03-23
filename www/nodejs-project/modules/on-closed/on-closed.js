module.exports = function closed(req, response, cb){
	let callback = () => {
		process.nextTick(() => {
			if(cb && !response.ended && response.writable){
				cb()		
			}
			cb = null	
		})
	}
	let onSocket = () => {
		response.socket.once('close', () => {
			setTimeout(() => {
				if(response.writable){
					callback()
				}
			}, 2000)
		})
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