const crypto = require('crypto'), swarm = require('@geut/discovery-swarm-webrtc')
const Buffer = require('safe-buffer').Buffer

const P2P_ENC_HEADER_SIZE = 8
const P2P_DEBUG = false

class P2PEncDec extends EventEmitter {
	constructor() {
		super()
	}
	encode(data) {
		if (Buffer.isBuffer(data)) {
			return data
		}
		const payload = Buffer.isBuffer(data.data) ? data.data : Buffer.from(data.data || '')
		const ndata = Object.assign({}, data)
		if (payload) {
			delete ndata.data
		}
		let j = JSON.stringify(ndata)
		let s = String(j.length)
		s = '0'.repeat(P2P_ENC_HEADER_SIZE - s.length) + s
		return Buffer.concat([Buffer.from(s + j), payload])
	}
	decode(buf, msgSize) {
		if (Buffer.isBuffer(buf)) {
			const expectedMsgSize = typeof(msgSize) == 'number' ? msgSize :
				parseInt(buf.slice(0, P2P_ENC_HEADER_SIZE).toString().replace(new RegExp('^0+', 'g'), ''))
			try {
				const data = JSON.parse(buf.slice(P2P_ENC_HEADER_SIZE, P2P_ENC_HEADER_SIZE + expectedMsgSize).toString())
				const payload = buf.slice(P2P_ENC_HEADER_SIZE + expectedMsgSize)
				data.data = payload
				if(payload && payload.length) {
					console.log('P2P payload received fine')
				}
				return data
			} catch (e) {
				if(typeof(msgSize) == 'number') {
					console.error(String(e) +' '+ JSON.stringify({
						expectedMsgSize,
						receivedMsgSize: buf.length - P2P_ENC_HEADER_SIZE
					}), e, buf)
				} else {				
					const receivedMsgSize = buf.length - P2P_ENC_HEADER_SIZE
					return this.decode(buf, receivedMsgSize)
				}
			}
			return null
		} else {
			return buf
		}
	}
}

class P2PSegmentTools {
	constructor() { }
	/*
	resolve() aim to handle when users are on same stream but with a
	unique user identifier in the segments URL. So these segments can be shared
	even with different URLs.
	*/
	resolve(remoteURL, remoteMask, localURLs) {
		if (!remoteURL || !remoteMask || !localURLs) return false
		const similars = this.getSimilarSegmentURLs(remoteURL, localURLs, 2)
		if (similars.length < 2) return false
		const localMask = this.getSegmentURLMask(similars[0], similars[1])
		return localMask.start + remoteMask.sequence + localMask.end
	}
	isSegmentURL(url) {
		return url.match(new RegExp('\\.ts($|\\?|&)'))
	}
	getSegmentURLMask(a, b) {
		if (!a || !b) return false
		let start = '', end = '', l = Math.min(a.length, b.length)
		for (let i = 0; i < l; i++) {
			if (a[i] == b[i]) {
				start += a[i]
			} else {
				break
			}
		}
		for (let i = 1; i < l; i++) {
			if (a[a.length - i] == b[b.length - i]) {
				end = a[a.length - i] + end
			} else {
				break
			}
		}
		start = start.replace(new RegExp('[A-Za-z0-9]+$'), '')
		end = end.replace(new RegExp('^[A-Za-z0-9]+'), '')
		return {
			start,
			end,
			sequence: a.substr(start.length, a.length - start.length - end.length),
			length: start.length + end.length
		}
	}
	getSimilarSegments(a, urls) {
		const data = this.filterSameDomainSegmentURLs(a, urls).map(u => {
			const mask = this.getSegmentURLMask(a, u)
			return mask ? {
				url: u,
				mask,
				length: mask.length
			} : false
		}).filter(s => s)
		return data.sortByProp('length', true)
	}
	getSimilarSegmentURLs(a, urls, len = 1) {
		const data = this.getSimilarSegments(a, urls).map(u => u.url)
		return len <= 1 ? data.shift() : data.slice(0, len)
	}
	getURLBase(a) {
		return a.split('/').slice(0, 3).join('/')
	}
	filterSameDomainSegmentURLs(a, urls) {
		const domain = this.getURLBase(a)
		return urls.filter(u => u != a).filter(u => {
			const m = this.getURLBase(a)
			return m == domain
		})
	}
}

class P2PPeer extends P2PEncDec {
	constructor(peer, id) {
		super()
		this.time = time()
		this.peer = peer
		this.id = id
		this.pendingWrite = []
		this.speeds = []
		this.sockets = []
		this.paused = []
		this.dataListener = data => {
			const nfo = this.decode(data)
			if (nfo) {
				if (P2P_DEBUG) console.log('peerdata decode', nfo)
				this.emit('data', nfo)
			} else {
				console.error('P2P error, cannot decode JSON', data)
			}
		}
		this.drainListener = () => this.drain()
		this.maxInMemoryBuffer = 128 * 1024
		this.lowInMemoryBuffer = 16 * 1024
		this.bind(peer)
	}
	isConnected() {
		return this.isPeerConnected(this.peer)
	}
	isPeerConnected(peer) {
		return peer.connected || (peer.stream && peer.stream.connected)
	}
	bind(peer) {
		this.sockets.push(peer)
		if (this.isPeerConnected(this.peer) && !this.isPeerConnected(peer)) {
			return
		}
		this.unbind()
		this.peer = peer
		this.target = peer.write ? peer : peer.stream
		this.target.on('data', this.dataListener)
		this.target.on('drain', this.drainListener)
		this.drain()
	}
	unbind() {
		if (this.target) {
			this.target.removeListener('data', this.dataListener)
			this.target = null
		}
	}
	drain() {
		if (!this.writing) {
			if (this.pendingWrite.length) {
				if (this.peer.writable) {
					const message = this.pendingWrite.shift()
					this.send(message)
				}
			}
			if (this.paused.length && this.buffered() <= this.lowInMemoryBuffer) {
				this.emit('resume', this.paused)
				console.warn('P2P TRANSFER RESUMED')
				this.paused = []
			}
		}
	}
	buffered() {
		let size = 0
		this.pendingWrite.forEach(b => size += b.length)
		return size
	}
	write(message) {
		if (P2P_DEBUG) console.log('P2P peer write', message)
		this.pendingWrite.push(this.encode(message))
		const buffered = this.buffered()
		if (buffered >= this.maxInMemoryBuffer) {
			this.emit('pause', message.uid)
			this.paused.push(message.uid)
			console.warn('P2P TRANSFER PAUSED', message, buffered)
		}
		if (!this.writing && this.peer.writable) this.drain()
	}
	send(message) {
		let left = this.sockets.length
		const done = () => {
			left--
			if (left <= 0) {
				this.writing = false
				this.drain()
			}
		}
		this.writing = true
		this.sockets.forEach(s => {
			if (s.writable) {
				s.write(message, 'buffer', err => {
					if (err) console.error('!!! P2P SEND FAILURE', err)
					done()
				})
			} else {
				done()
			}
		})
		if (P2P_DEBUG) console.log('P2P peer send', message)
	}
	speed() {
		let t = 0
		this.speeds.forEach(s => t += s)
		return t ? t / this.speeds.length : 0
	}
	reportSpeed(speed) {
		if (this.speeds.length >= 3) {
			this.speeds = this.speeds.slice(0, 2) // keep until 3 entries
		}
		this.speeds.push(speed)
	}
	destroy() {
		this.unbind()
		this.speeds = []
		this.pendingWrite = []
		this.emit('destroy')
	}
}

class P2PListsRequest extends P2PEncDec {
	constructor(clients, app, opts) {
		super()
		if (!opts.uid) {
			throw 'No UID set'
		}
		this.chosen = -1
		this.app = app
		this.opts = opts
		this.clients = clients
		this.states = {} // -1=404, 1=200+
		this.responses = {}
		this.listeners = []
		this.connectStart = time()
		this.timeout = 10000
		if (this.clients.length) {
			const req = this.encode({
				type: 'request-lists',
				uid: this.opts.uid
			})
			this.clients.forEach((target, i) => {
				const listener = data => this.listener(data, i)
				target.on('data', listener)
				target.write(req)
				this.listeners.push({ listener, target, type: 'data' })
			})
		}
		setTimeout(() => this.destroy(), this.timeout)
	}
	listener(message, i) {
		if (message && message.lists && message.uid == this.opts.uid) {
			Array.isArray(message.lists) && 
			message.lists.length && 
			this.app.emit('public-iptv-lists-discovery', message.lists) // from peer
		}
	}
	destroy() {
		this.destroyed = true
		this.emit('destroy')
		this.timers && this.timers.forEach(t => clearTimeout(t))
		this.listeners.forEach(r => {
			r.target.removeListener(r.type, r.listener)
		})
		this.listeners = []
		this.clients = []
		this.app = null
	}
}

class P2PRequest extends P2PEncDec {
	constructor(clients, app, opts) {
		super()
		if (!opts.uid) {
			throw 'No UID set'
		}
		this.chosen = -1
		this.app = app
		this.opts = opts
		this.clients = clients
		this.states = {} // -1=404, 1=200+
		this.responses = {}
		this.listeners = []
		this.connectStart = time()
		if (this.clients.length) {
			const req = this.encode({
				type: 'request',
				url: this.opts.url,
				uid: this.opts.uid
			})
			this.clients.forEach((target, i) => {
				const listener = data => this.listener(data, i)
				target.on('data', listener)
				target.write(req)
				this.listeners.push({ listener, target, type: 'data' })
			})
			this.timers = [setTimeout(() => this.pump(true), 5000)]
		} else {
			setTimeout(() => this.fail('No peers.'), 0)
		}
	}
	listener(message, i) {
		if (message && message.type == 'response' && message.uid == this.opts.uid) {
			if (message.status == 404) {
				if (P2P_DEBUG) console.log('P2P 404 from remote ' + this.opts.uid, message)
				this.states[i] = -1
			} else if (message.status == 200 && this.chosen === -1) {
				if (P2P_DEBUG) console.warn('P2P 200 from remote ' + this.opts.uid, message)
				this.responses[i] = message
				this.states[i] = 1
			} else {
				if (message.error) {
					this.app.emit('download-p2p-response-fail-' + this.opts.uid, message)
				} else if (message.data) {
					this.dataReceived += message.data.length
					this.speed = parseInt(this.dataReceived / (time() - this.acceptTime))
					this.app.emit('download-p2p-response-data-' + this.opts.uid, message)
				}
				if (message.ended) {
					console.warn('P2P download', message.url, message)
					if (P2P_DEBUG) console.log('P2P 200 finish from remote ' + this.opts.uid, this.dataReceived)
					this.app.emit('download-p2p-response-end-' + this.opts.uid)
					if (this.speed) {
						this.clients[this.chosen].reportSpeed(this.speed)
					}
					return this.destroy()
				}
			}
			this.pump()
		}
	}
	pump(timeouted) {
		if (this.destroyed || this.chosen !== -1) return
		const validate = i => {
			return this.states[i] == 1 && this.responses[i].ttl >= (now + 10) && this.clients[i].isConnected()
		}
		const now = time(), ks = Object.keys(this.states), vs = Object.values(this.states)
		const finished = timeouted || vs.length >= this.clients.length
		const failed = finished && vs.every(s => s == -1)
		const candidates = ks.filter(i => validate(i))
		if (finished && failed) { // no peer has the file
			this.fail('No peer has the file. '+ [this.opts.url, this.opts.uid].join('-'))
		} else {
			if (candidates.length) {
				const i = candidates[Math.floor(Math.random() * candidates.length)] // randomly
				this.choose(i)
			} else if (timeouted) {
				this.fail('Timeouted.')
			}
		}
	}
	fail(reason) {
		if (P2P_DEBUG) console.log('P2P request failed.', reason)
		this.timers && this.timers.forEach(t => clearTimeout(t))
		this.app && this.app.emit('download-p2p-response-fail-' + this.opts.uid, reason)
		this.destroy()
	}
	choose(n) { // choose active client and unbind others
		if (P2P_DEBUG) console.log('Receiving P2P response from #' + n)
		this.timers && this.timers.forEach(t => clearTimeout(t))
		this.listeners.forEach((r, i) => {
			if (i != n) r.target.removeListener(r.type, r.listener)
		})
		this.clients[n].write({
			type: 'accept',
			url: this.opts.url,
			uid: this.opts.uid
		})
		this.app.emit('download-p2p-response-start-' + this.opts.uid, this.responses[n])
		this.chosen = n
		this.acceptTime = time()
		this.dataReceived = 0
	}
	destroy() {
		this.destroyed = true
		this.emit('destroy')
		this.timers && this.timers.forEach(t => clearTimeout(t))
		this.listeners.forEach(r => {
			r.target.removeListener(r.type, r.listener)
		})
		this.listeners = []
		this.clients = []
		this.app = null
	}
}

class P2PManager extends P2PSegmentTools {
	constructor(sock, addr, maxPeers, stunServers) {
		super()
		this.addr = addr
		this.maxPeers = maxPeers
		this.stunServers = stunServers
		this.activeRequests = {}
		this.peerListeners = {}
		this.index = {}
		this.peers = {}
		this.unbinders = {}
		this.lists = []
		this.compatibleStreamerEngines = ['hls', 'vodhls']
		this.app = sock
		this.app.on('download-p2p-response', message => {
			if (message.pid) {
				const fine = Object.values(this.peers).some(peer => {
					if (peer.id == message.pid) {
						peer.write(message)
						return true
					}
				})
				if (!fine) {
					console.error('Peer ' + message.pid + ' not found to send response')
				}
			} else {
				console.error('Message without PID')
			}
		})
		this.app.on('download-p2p-request', r => {
			if (r.url && !r.mask) {
				r.mask = this.mask(r.url)
			}
			if (P2P_DEBUG) console.log('Doing P2P request', r)
			if (typeof (this.activeRequests[r.uid]) == 'undefined') {
				const req = new P2PRequest(Object.values(this.peers).filter(p => p.isConnected()), this.app, r)
				this.activeRequests[r.uid] = req
				req.once('destroy', () => {
					Object.keys(this.activeRequests).forEach(uid => {
						if (uid == r.uid || this.activeRequests[uid].destroyed) {
							delete this.activeRequests[uid]
						}
					})
				})
			}
		})
		this.app.on('download-p2p-cancel-request', ruid => {
			Object.keys(this.activeRequests).forEach(uid => {
				if (uid == ruid) {
					this.activeRequests[uid].destroy()
					delete this.activeRequests[uid]
				}
			})
		})
		this.app.on('streamer-connect', (src, mime, ck, type, data) => {
			const topic = this.compatibleStreamerEngines.includes(data.engine) ? data.url : 'default'
			this.join(topic).catch(console.error)
		})
		this.app.on('streamer-disconnect', () => {
			this.join('default').catch(console.error)
		})
		this.app.on('download-p2p-index-update', index => {
			if(index) this.index = index
		})
		this.app.on('public-iptv-lists-discovery', lists => {
			if(Array.isArray(lists) && lists.length){
				this.lists = lists
			}
		})
		this.app.emit('public-iptv-lists-discovery') // request
		this.app.emit('download-p2p-index-update')
		this.join('default').catch(console.error)
	}
	activeRequestsCount() {
		return Object.values(this.activeRequests).filter(r => !r.destroyed).length
	}
	activeRequestsUplinkLimit() {
		if (!navigator.connection || !navigator.connection.downlink) {
			return 1
		}
		if (!window.streamer || !streamer.bitrate) {
			return 1
		}
		const bitrate = streamer.bitrate / (1024 * 1024), uplink = navigator.connection.downlink / 3
		return Math.max(Math.floor(uplink / bitrate), 1)
	}
	join(topic) { // SyntaxError: Unexpected identifier | better avoid async / await on client side to help users of older TV boxes
		return new Promise(resolve => {
			if (!this.sw) {
                const servers = this.stunServers.map(urls => ({urls}))
				this.sw = swarm({
					bootstrap: [this.addr],
					maxPeers: this.maxPeers, // max connections by peer
					simplePeer: {
						config: {
                            iceServers: servers
                        },
                        maxInMemoryBuffer: 2 * (1024 * 1024)
					}
				})
				this.sw.on('error', err => {
					P2P_DEBUG && console.error('SWARM error: ' + err, err)
				})
				this.sw.on('connection', (peer, id) => {
					if (P2P_DEBUG) {
						console.log('connected to a new peer:', id, 'total peers:', this.sw.getPeers().length) // with this.sw it throwed TypeError: Cannot read property 'peers' of undefined
					}
					this.bind(peer, id)
				})
				this.sw.on('connection-closed', (peer, id) => {
					const keep = this.sw.getPeers().some(p => peer.id == id.id)
					if (!keep) {
						if (P2P_DEBUG) {
							console.log('disconnected from a peer:', id, 'total peers:', this.sw.getPeers().length)
						}
						this.unbind(peer, id)
					}
				})
			}
			const hash = crypto.createHash('sha256').update(topic).digest()
			if (hash != this.topic) {
				console.log('P2P topic: ' + topic)
				if (this.topic) {
					this.sw.leave(this.topic).catch(console.error)
				}
				this.topic = hash
				this.sw.join(hash)
			}
			resolve(true)
		})
	}
	mask(url) {
		let smurl = this.getSimilarSegmentURLs(url, Object.keys(this.index))
		return this.getSegmentURLMask(url, smurl)
	}
	id(peer, id) {
		if (!id) { // fill peer.id too if needed
			id = peer.id || peer._id
		}
		if (id.id) {
			id = id.id
		}
		if (typeof (id) != 'string' && id.toString) {
			id = id.toString('base64')
		}
		return id
	}
	bind(peer, id) {
		id = this.id(peer, id)
		if (this.unbinders[id]) {
			clearTimeout(this.unbinders[id])
			delete this.unbinders[id]
		}
		if (typeof (this.peers[id]) != 'undefined') {
			return this.peers[id].bind(peer)
		}
		this.peers[id] = new P2PPeer(peer, id)
		if (typeof (this.peerListeners[id]) == 'function') {
			this.peers[id].removeListener('data', this.peerListeners[id])
		}
		this.peerListeners[id] = message => {
			if (!message || !message.type) return
			switch (message.type) {
				case 'request':
					message.pid = id
					let msg
					if (typeof (this.index[message.url]) == 'undefined' && this.isSegmentURL(message.url) && message.mask) { // resolve some token in URL
						const nurl = this.resolve(message.url, message.mask, Object.keys(this.index))
						if (P2P_DEBUG) console.warn('P2P RESOLVED ' + message.url + ' TO ' + nurl)
						if (nurl && typeof (this.index[nurl]) != 'undefined') {
							message.url = nurl
						}
					}
					const fail = this.activeRequestsCount() >= this.activeRequestsUplinkLimit()
					const found = typeof (this.index[message.url]) != 'undefined'
					if (fail || !found) { // uplink overloaded
						msg = {
							type: 'response',
							status: 404,
							uid: message.uid,
							pid: message.pid
						}
					} else {
						msg = Object.assign(Object.assign({}, this.index[message.url]), {
							type: 'response',
							status: 200,
							uid: message.uid,
							pid: message.pid
						})
					}
					if (P2P_DEBUG) {
						const f = msg.status == 200 ? 'warn' : 'log'
						console[f]('P2P request received', fail, found, message.url)
					}
					this.peers[id].write(msg)
					break
				case 'accept':
					message.pid = id
					this.app.emit('download-p2p-serve-request', message)
					console.warn('P2P upload', message.url, message)
					break
				case 'request-lists':
					this.peers[id].write({
						type: 'lists',
						uid: message.uid,
						lists: this.lists
					})
					break
				case 'lists':
					message.pid = id
					this.app.emit('public-iptv-lists-discovery', message.lists) // from peer
					break
			}
		}
		this.peers[id].on('data', this.peerListeners[id])
		this.peers[id].on('pause', uid => {
			this.app.emit('download-p2p-serve-request', { uid, type: 'pause' })
		})
		this.peers[id].on('resume', uid => {
			this.app.emit('download-p2p-serve-request', { uid, type: 'resume' })
		})
		this.reportPeersCount()		
		new P2PListsRequest([this.peers[id]], this.app, {uid: parseInt(Math.random() * 1000000)})
	}
	unbind(peer, id, force) {
		id = this.id(peer, id)
		if (this.unbinders[id]) {
			clearTimeout(this.unbinders[id])
			delete this.unbinders[id]
		}
		if (force === true) {
			if (this.peerListeners[id]) {
				peer.removeListener('data', this.peerListeners[id])
				delete this.peerListeners[id]
			}
			if (this.peers[id]) {
				this.peers[id].destroy()
				delete this.peers[id]
				this.reportPeersCount()
			}
			Object.keys(this.activeRequests).forEach(uid => {
				const r = this.activeRequests[uid]
				if (r.chosen == -1 || r.clients[r.chosen].id != id) {
					return true
				}
				return r.destroy()
			})
		} else {
			this.unbinders[id] = setTimeout(() => {
				if (this.peers[id] && !this.peers[id].isConnected()) {
					this.unbind(peer, id, true)
				}
			}, 30000)
		}
	}
	syncPeers() {
		this.sw.getPeers().forEach(p => this.bind(peer, peer.id))
	}
	reportPeersCount() {
		const nfo = {}
		Object.keys(this.peers).forEach(k => {
			nfo[k] = {}
		})
		this.app.emit('download-p2p-peers', nfo)
	}
}
window.P2PManager = P2PManager // ensure it to be accessible on the right scope