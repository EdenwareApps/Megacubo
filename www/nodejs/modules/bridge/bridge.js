import { EventEmitter } from 'node:events'
import http from 'http'
import path from 'path'
import fs from 'fs'
import { isUnderRootAsync, prepareCORS, traceback } from '../utils/utils.js'
import url from 'node:url'
import formidable from 'formidable'
import closed from '../on-closed/on-closed.js'
import paths from '../paths/paths.js'
import { createRequire } from 'node:module'
import { getFilename } from 'cross-dirname'
import { prepare } from '../serialize/serialize.js'
import { randomBytes, createHash } from 'node:crypto'

EventEmitter.defaultMaxListeners = 100

// WebSocket implementation for web mode
class WebSocketServer {
    constructor(httpServer, bridge) {
        this.bridge = bridge
        this.clients = new Set()
        this.setupWebSocketUpgrade(httpServer)
    }

    setupWebSocketUpgrade(httpServer) {
        httpServer.on('upgrade', (request, socket, head) => {
            const pathname = url.parse(request.url).pathname
            if (pathname === '/ws') {
                this.handleUpgrade(request, socket, head)
            } else {
                socket.destroy()
            }
        })
    }

    handleUpgrade(request, socket, head) {
        const key = request.headers['sec-websocket-key']
        if (!key) {
            socket.destroy()
            return
        }

        // Generate accept key
        const acceptKey = createHash('sha1')
            .update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11')
            .digest('base64')

        // Send upgrade response
        const responseHeaders = [
            'HTTP/1.1 101 Switching Protocols',
            'Upgrade: websocket',
            'Connection: Upgrade',
            `Sec-WebSocket-Accept: ${acceptKey}`,
            '',
            ''
        ].join('\r\n')

        socket.write(responseHeaders)

        // Create WebSocket client wrapper
        const client = new WebSocketClient(socket, this)
        this.clients.add(client)

        console.log('[WebSocket] Client connected, total:', this.clients.size)

        socket.on('close', () => {
            this.clients.delete(client)
            console.log('[WebSocket] Client disconnected, total:', this.clients.size)
        })

        socket.on('error', (err) => {
            console.error('[WebSocket] Socket error:', err.message)
            this.clients.delete(client)
        })
    }

    broadcast(data) {
        const message = JSON.stringify(data)
        for (const client of this.clients) {
            try {
                client.send(message)
            } catch (e) {
                console.error('[WebSocket] Broadcast error:', e.message)
            }
        }
    }
}

class WebSocketClient {
    constructor(socket, server) {
        this.socket = socket
        this.server = server
        this.buffer = Buffer.alloc(0)
        this.setupDataHandler()
    }

    setupDataHandler() {
        this.socket.on('data', (data) => {
            this.buffer = Buffer.concat([this.buffer, data])
            this.processBuffer()
        })
    }

    processBuffer() {
        while (this.buffer.length >= 2) {
            const firstByte = this.buffer[0]
            const secondByte = this.buffer[1]

            const opcode = firstByte & 0x0f
            const isMasked = (secondByte & 0x80) !== 0
            let payloadLength = secondByte & 0x7f

            let offset = 2

            // Handle extended payload lengths
            if (payloadLength === 126) {
                if (this.buffer.length < 4) return
                payloadLength = this.buffer.readUInt16BE(2)
                offset = 4
            } else if (payloadLength === 127) {
                if (this.buffer.length < 10) return
                payloadLength = Number(this.buffer.readBigUInt64BE(2))
                offset = 10
            }

            // Get masking key if present
            let maskingKey = null
            if (isMasked) {
                if (this.buffer.length < offset + 4) return
                maskingKey = this.buffer.slice(offset, offset + 4)
                offset += 4
            }

            // Check if we have the full payload
            if (this.buffer.length < offset + payloadLength) return

            // Extract payload
            let payload = this.buffer.slice(offset, offset + payloadLength)

            // Unmask if necessary
            if (maskingKey) {
                for (let i = 0; i < payload.length; i++) {
                    payload[i] ^= maskingKey[i % 4]
                }
            }

            // Remove processed data from buffer
            this.buffer = this.buffer.slice(offset + payloadLength)

            // Handle opcodes
            switch (opcode) {
                case 0x1: // Text frame
                    this.handleTextMessage(payload.toString('utf8'))
                    break
                case 0x8: // Close
                    this.socket.end()
                    break
                case 0x9: // Ping
                    this.sendPong(payload)
                    break
                case 0xa: // Pong
                    break
            }
        }
    }

    handleTextMessage(text) {
        try {
            const data = JSON.parse(text)
            if (data.type === 'message' && Array.isArray(data.args)) {
                // Forward message to bridge
                this.server.bridge.onMessage(data.args)
            }
        } catch (e) {
            console.error('[WebSocket] Parse error:', e.message)
        }
    }

    send(message) {
        const payload = Buffer.from(message, 'utf8')
        let frame

        if (payload.length < 126) {
            frame = Buffer.alloc(2 + payload.length)
            frame[0] = 0x81 // FIN + text opcode
            frame[1] = payload.length
            payload.copy(frame, 2)
        } else if (payload.length < 65536) {
            frame = Buffer.alloc(4 + payload.length)
            frame[0] = 0x81
            frame[1] = 126
            frame.writeUInt16BE(payload.length, 2)
            payload.copy(frame, 4)
        } else {
            frame = Buffer.alloc(10 + payload.length)
            frame[0] = 0x81
            frame[1] = 127
            frame.writeBigUInt64BE(BigInt(payload.length), 2)
            payload.copy(frame, 10)
        }

        this.socket.write(frame)
    }

    sendPong(payload) {
        const frame = Buffer.alloc(2 + payload.length)
        frame[0] = 0x8a // FIN + pong opcode
        frame[1] = payload.length
        payload.copy(frame, 2)
        this.socket.write(frame)
    }
}

class BaseChannel extends EventEmitter {
    constructor() {
        super()
        this.originalEmit = this.emit
        this.emit = this.customEmit
        this.setMaxListeners(20)
    }
    onMessage(args) {
        process.nextTick(() => this.originalEmit.apply(this, args)) // prevent to block renderer
    }
}

class AndroidChannel extends BaseChannel {
    constructor() {
        super()
        this.attach()
    }
    customEmit(...args) {
        this.attach()
        try {
            this.channel.send('message', ...args)
        } catch (err) {
            console.error('CANNOT SEND MESSAGE ' + JSON.stringify(args) + ' ' + err, err)
        }
    }
    attach() {
        if (!this.channel && paths.android.channel) {
            this.channel = paths.android.channel
            this.channel.addListener('message', (...args) => this.onMessage(args))
        }
    }
}

class ElectronChannel extends BaseChannel {
    constructor() {
        super()
        const require = createRequire(getFilename())
        require('electron').ipcMain.on('message', (...args) => this.onMessage(args[1]))
    }
    customEmit(...args) {
        this.window && !this.window.closed && this.window.webContents.send('message', prepare(args))
    }
}

class NodeChannel extends BaseChannel {
    constructor() {
        super();
        this.renderer = new BaseChannel();
        this.renderer.customEmit = (...args) => {
            process.nextTick(() => this.onMessage(args));
        };
    }
    customEmit(...args) {
        process.nextTick(() => this.renderer.onMessage(args));
    }
}

class WebChannel extends BaseChannel {
    constructor(wsServer) {
        super()
        this.wsServer = wsServer
    }
    customEmit(...args) {
        if (this.wsServer) {
            this.wsServer.broadcast({ type: 'message', args: prepare(args) })
        }
    }
}

class BridgeServer extends EventEmitter {
    constructor(opts) {
        super()
        this.ua = 'Megacubo ' + paths.manifest.version
        if (!paths.android) {
            this.ua += ' ' + this.secret(8)
        }
        this.map = {}
        this.opts = {
            addr: '127.0.0.1',
            port: 0,
            webMode: false // Enable web mode to allow external connections
        }
        if (opts) {
            Object.keys(opts).forEach((k) => {
                this.opts[k] = opts[k]
            })
        }
        this.closed = false
        const mimes = {
            '.ico': 'image/x-icon',
            '.html': 'text/html',
            '.js': 'text/javascript',
            '.json': 'application/json',
            '.css': 'text/css',
            '.png': 'image/png',
            '.jpg': 'image/jpeg',
            '.wav': 'audio/wav',
            '.mp3': 'audio/mpeg',
            '.mp4': 'video/mp4',
            '.svg': 'image/svg+xml',
            '.woff': 'font/woff',
            '.woff2': 'font/woff2',
            '.ttf': 'font/ttf',
            '.eot': 'application/vnd.ms-fontobject',
            '.m3u8': 'application/vnd.apple.mpegurl',
            '.ts': 'video/mp2t',
            '.m3u': 'audio/x-mpegurl'
        }
        this.setMaxListeners(20)
        this.server = http.createServer(async (req, response) => {
            const parsedUrl = url.parse(req.url, false)
            // In web mode, skip UA check for web browser clients
            if (!this.opts.webMode && !parsedUrl.pathname.endsWith('.map') && !this.checkUA(req.headers)) {
                response.writeHead(400, prepareCORS({ 'content-type': 'text/plain' }, req))
                return response.end()
            }
            prepareCORS(response, req)
            response.setHeader('Connection', 'close')
            response.setHeader('Feature-Policy', 'clipboard-read; clipboard-write; fullscreen; autoplay;')
            response.setHeader('Permissions-Policy', 'clipboard-read=*, clipboard-write=*, fullscreen=*, autoplay=*')
            if (parsedUrl.pathname == '/upload') {
                const form = formidable({ multiples: true })
                form.parse(req, (err, fields, files) => {
                    response.writeHead(200, prepareCORS({ 'content-type': 'text/plain' }, req))
                    response.end('OK')
                    if (fields && fields.cbid && fields.cbid.length) {
                        this.localEmit(fields.cbid, files)
                    } else {
                        this.localEmit(fields.cbid, null)
                    }
                })
            } else {
                let mapped, pathname = `.${parsedUrl.pathname}`
                // Handle both / and /renderer/ for web mode
                if (pathname == './') {
                    pathname = this.opts.webMode ? './renderer/web.html' : './index.html'
                }
                if (typeof (this.map[pathname]) != 'undefined') {
                    pathname = this.map[pathname]
                    mapped = true
                }
                pathname = path.resolve(paths.cwd, pathname)
                if (!pathname || (!mapped && !await isUnderRootAsync(pathname, paths.cwd))) {
                    response.statusCode = 403;
                    response.end();
                    return;
                }
                let err;
                await fs.promises.access(pathname, fs.constants.R_OK).catch(e => err = e)
                if (err) {
                    response.statusCode = 404
                    response.end(`File ${pathname} not found!`)
                    return
                }
                const ext = path.parse(pathname).ext || ''
                response.setHeader('Content-type', mimes[ext] || 'text/plain')
                response.setHeader('Cache-Control', 'max-age=0, no-cache, no-store')
                let stream = fs.createReadStream(pathname)
                closed(req, response, stream, () => {
                    console.log(`${req.method} ${req.url} CLOSED`)
                    if (stream) {
                        stream.destroy()
                        stream = null
                    }
                    response.end()
                }, { closeOnError: true })
                stream.pipe(response)
            }
        })
        // In web mode, bind to all interfaces; otherwise localhost only
        const bindAddr = this.opts.webMode ? '0.0.0.0' : this.opts.addr
        const bindPort = this.opts.webMode ? (this.opts.port || 8080) : 0
        this.server.listen(bindPort, bindAddr, err => {
            if (!err && !this.serve) {
                err = new Error('Bridge server not started')
            }
            if (err) console.error(err)
            if (this.server) {
                this.opts.port = this.server.address().port
                console.log('Bridge server started on', bindAddr + ':' + this.opts.port, this.opts.webMode ? '(web mode)' : '')
                this.uploadURL = 'http://' + this.opts.addr + ':' + this.opts.port + '/upload'

                // Initialize WebSocket server in web mode
                if (this.opts.webMode) {
                    this.wsServer = new WebSocketServer(this.server, this)
                    console.log('WebSocket server initialized')
                }
            }
            this.emit('connected', err, this.opts.port)
        })
    }
    secret(length) {
        return randomBytes(length).toString('hex')
    }
    checkUA(headers) {
        if (paths.android)
            return true
        return headers && headers['user-agent'] && headers['user-agent'] == this.ua
    }
    serve(file) {
        if (fs.existsSync(file)) {
            let stat = fs.statSync(file)
            if (stat) {
                const ext = file.match(new RegExp('\\.[A-Za-z0-9]{0,5}$'))
                let path = './' + (stat ? stat.size : file.split('/').pop())
                if (ext) {
                    path += ext[0]
                }
                this.map[path] = file
                return 'http://' + this.opts.addr + ':' + this.opts.port + '/' + path.substr(2)
            }
        }
    }
    destroy() {
        if (this.opts.debug) {
            console.log('closing...')
        }
        this.closed = true
        this.removeAllListeners()
    }
}

class BridgeUtils extends BridgeServer {
    constructor(opts) {
        super(opts)
    }
    async clipboard(text, successMessage) {
        if (typeof (text) == 'string') { // write
            this.emit('clipboard-write', text, successMessage)
        } else { // read
            const uid = 'clipboard-read-'+ this.secret(9)
            const promise = new Promise((resolve, reject) => {
                this.once(uid, (err, text) => {
                    if (err) {
                        console.error('Clipboard error', err)
                        return reject(err)
                    }
                    resolve(text)
                })
            })
            this.emit('clipboard-read', uid)
            const ret = await promise
            return ret
        }
    }
    async resolveFileFromClient(data) {
        const check = async (file) => {
            await fs.promises.access(file, fs.constants.R_OK)
            return file
        }
        console.warn('!!! RESOLVE FILE !!!', data)
        if (data) {
            if (Array.isArray(data) && data.length) {
                return check(data[0])
            } else if (data.file && data.file.filepath && data.file.filepath) {
                return check(data.file.filepath)
            } else if (data.filename && data.filename.path) {
                return check(data.filename.path)
            } else {
                throw new Error('invalid file data')
            }
        } else {
            throw new Error('invalid file data')
        }
    }
    async importFileFromClient(data, target) {
        console.warn('!!! IMPORT FILE !!!' + target + ' | ' + JSON.stringify(data))
        const resolveFile = await this.resolveFileFromClient(data).catch(err => {
            console.error('DATA=' + JSON.stringify(data) + ' ' + err)
        })
        if (!resolveFile)
            throw 'Resolve error'
        if (target) {
            await fs.promises.copyFile(resolveFile, target)
            return target
        } else {
            return fs.promises.readFile(resolveFile)
        }
    }
    setElectronWindow(win) {
        this.channel.window = win
    }
}

class Bridge extends BridgeUtils {
    constructor(opts) {
        super(opts)
        if (this.opts.webMode) {
            // Web mode - use WebSocket channel
            this.channel = new WebChannel(this.wsServer)
            // Connect WebSocket server's onMessage to the bridge channel
            this.onMessage = (args) => {
                this.channel.onMessage(args)
            }
        } else if (process.platform == 'android') {
            this.channel = new AndroidChannel()
        } else {
            try {
                const require = createRequire(getFilename())
                const electron = require('electron')
                if(!electron?.BrowserWindow) {
                    throw new Error('Electron is not installed')
                }
                this.channel = new ElectronChannel()
            } catch (e) {
                this.channel = new NodeChannel()
            }
        }
        this.channel.setMaxListeners && this.channel.setMaxListeners(20)
    }
    on(...args) {
        this.channel.on(...args)
    }
    once(...args) {
        this.channel.once(...args)
    }
    emit(...args) {
        return this.channel.emit(...args)
    }
    listenerCount(type) {
        return this.listeners(type).length
    }
    listeners(type) {
        return this.channel.listeners(type)
    }
    removeListener(...args) {
        return this.channel.removeListener(...args)
    }
    removeAllListeners(...args) {
        return this.channel.removeAllListeners(...args)
    }
    localEmit(...args) {
        this.channel.originalEmit(...args)
    }
    destroy() {
        if (this.server) {
            this.server.close()
            this.server = null
        }
        this.removeAllListeners()
    }
}

if (!Array.isArray(global.bridgeInstanceCallbacks)) {
    global.bridgeInstanceCallbacks = []
}

class BridgeController {
    constructor() { }
    bridgeReady(f) {
        if (global.bridgeInstance && global.bridgeInstance.opts.port) {
            f(null, global.bridgeInstance.opts.port)
        } else {
            global.bridgeInstance.once('connected', f)
        }
    }
    ready(f, done) {
        const isReady = !Array.isArray(global.bridgeInstanceCallbacks)
        if (typeof (f) == 'function') {
            if (isReady) {
                f()
            } else {
                global.bridgeInstanceCallbacks.push(f)
            }
            return
        } else if (f === true) { // promisify
            return new Promise(resolve => {
                if (isReady) {
                    resolve()
                } else {
                    global.bridgeInstanceCallbacks.push(resolve)
                }
            })
        }
        if (!isReady && done === true) {
            const cbs = global.bridgeInstanceCallbacks
            global.bridgeInstanceCallbacks = null
            cbs.map(f => {
                try {
                    const p = f()
                    if (p && typeof (p.catch) == 'function') {
                        p.catch(err => console.error(err))
                    }
                }
                catch (e) {
                    console.error(e)
                }
            })
        }
        return isReady
    }
    get ui() {
        if (!global.bridgeInstance) {
            if (paths.inWorker) {
                console.error('!!! Tried to create a Bridge instance from a worker !!!', traceback())
                // Return a dummy EventEmitter-like object for workers
                return {
                    on: () => {},
                    emit: () => {},
                    once: () => {},
                    removeListener: () => {},
                    removeAllListeners: () => {}
                }
            } else {
                global.bridgeInstance = new Bridge()
            }
        }
        return global.bridgeInstance || {
            on: () => {},
            emit: () => {},
            once: () => {},
            removeListener: () => {},
            removeAllListeners: () => {}
        }
    }
}

const instance = new BridgeController
export const ready = instance.ready.bind(instance)
export default instance
