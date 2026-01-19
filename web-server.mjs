#!/usr/bin/env node
/**
 * Megacubo Web Server
 *
 * Starts Megacubo in web mode for browser access.
 *
 * Usage:
 *   node web-server.mjs [port]
 *   npm run start:web
 *
 * Default port: 8080
 */

import { createServer } from 'http'
import { EventEmitter } from 'events'
import path from 'path'
import fs from 'fs'
import { fileURLToPath } from 'url'
import { createHash, randomBytes } from 'crypto'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// Parse port from command line or environment
const port = parseInt(process.argv[2] || process.env.MEGACUBO_WEB_PORT || '8080', 10)

console.log(`
╔═══════════════════════════════════════════════════════════════╗
║                  Megacubo Web Server                          ║
╠═══════════════════════════════════════════════════════════════╣
║  Starting in web mode...                                      ║
║  Port: ${String(port).padEnd(54)}║
╚═══════════════════════════════════════════════════════════════╝
`)

// Set environment variables for web mode
process.env.MEGACUBO_WEB_MODE = 'true'
process.env.MEGACUBO_AS_LIBRARY = 'true'

// Change working directory to www/nodejs (where the app expects to run)
const wwwNodejsPath = path.join(__dirname, 'www', 'nodejs')
process.chdir(wwwNodejsPath)

// WebSocket client tracking
const wsClients = new Set()

// MIME types
const mimes = {
    '.ico': 'image/x-icon',
    '.html': 'text/html',
    '.js': 'text/javascript',
    '.mjs': 'text/javascript',
    '.json': 'application/json',
    '.css': 'text/css',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.gif': 'image/gif',
    '.wav': 'audio/wav',
    '.mp3': 'audio/mpeg',
    '.mp4': 'video/mp4',
    '.svg': 'image/svg+xml',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
    '.ttf': 'font/ttf',
    '.m3u8': 'application/vnd.apple.mpegurl',
    '.ts': 'video/mp2t',
    '.m3u': 'audio/x-mpegurl'
}

// Prepare CORS headers
function prepareCORS(response, req) {
    const origin = req.headers.origin || '*'
    response.setHeader('Access-Control-Allow-Origin', origin)
    response.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
    response.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
    response.setHeader('Access-Control-Allow-Credentials', 'true')
    return response
}

// Create HTTP server
const server = createServer(async (req, response) => {
    const url = new URL(req.url, `http://${req.headers.host}`)
    const pathname = url.pathname

    // Handle OPTIONS for CORS
    if (req.method === 'OPTIONS') {
        prepareCORS(response, req)
        response.writeHead(204)
        response.end()
        return
    }

    prepareCORS(response, req)
    response.setHeader('Connection', 'close')
    response.setHeader('Permissions-Policy', 'clipboard-read=*, clipboard-write=*, fullscreen=*, autoplay=*')

    // Serve static files
    let filePath = pathname
    if (filePath === '/' || filePath === '/index.html') {
        filePath = '/renderer/web.html'
    }

    // Resolve file path relative to www/nodejs
    const absolutePath = path.join(wwwNodejsPath, filePath)

    // Security: prevent directory traversal
    if (!absolutePath.startsWith(wwwNodejsPath)) {
        response.writeHead(403)
        response.end('Forbidden')
        return
    }

    try {
        const stat = await fs.promises.stat(absolutePath)
        if (stat.isFile()) {
            const ext = path.extname(absolutePath).toLowerCase()
            response.setHeader('Content-Type', mimes[ext] || 'application/octet-stream')
            response.setHeader('Cache-Control', 'max-age=0, no-cache, no-store')

            const stream = fs.createReadStream(absolutePath)
            stream.pipe(response)
            stream.on('error', (err) => {
                console.error('Stream error:', err)
                response.end()
            })
            return
        }
    } catch (err) {
        // File not found
    }

    response.writeHead(404)
    response.end(`File not found: ${pathname}`)
})

// Handle WebSocket upgrades
server.on('upgrade', (request, socket, head) => {
    const url = new URL(request.url, `http://${request.headers.host}`)
    if (url.pathname === '/ws') {
        handleWebSocketUpgrade(request, socket, head)
    } else {
        socket.destroy()
    }
})

// WebSocket upgrade handler
function handleWebSocketUpgrade(request, socket, head) {
    const key = request.headers['sec-websocket-key']
    if (!key) {
        socket.destroy()
        return
    }

    const acceptKey = createHash('sha1')
        .update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11')
        .digest('base64')

    const responseHeaders = [
        'HTTP/1.1 101 Switching Protocols',
        'Upgrade: websocket',
        'Connection: Upgrade',
        `Sec-WebSocket-Accept: ${acceptKey}`,
        '',
        ''
    ].join('\r\n')

    socket.write(responseHeaders)

    const client = {
        socket,
        buffer: Buffer.alloc(0),
        send: (message) => {
            const payload = Buffer.from(message, 'utf8')
            let frame
            if (payload.length < 126) {
                frame = Buffer.alloc(2 + payload.length)
                frame[0] = 0x81
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
            socket.write(frame)
        }
    }

    wsClients.add(client)
    console.log('[WebSocket] Client connected, total:', wsClients.size)

    socket.on('data', (data) => {
        client.buffer = Buffer.concat([client.buffer, data])
        processWebSocketBuffer(client)
    })

    socket.on('close', () => {
        wsClients.delete(client)
        console.log('[WebSocket] Client disconnected, total:', wsClients.size)
    })

    socket.on('error', (err) => {
        console.error('[WebSocket] Error:', err.message)
        wsClients.delete(client)
    })
}

// Process WebSocket buffer
function processWebSocketBuffer(client) {
    while (client.buffer.length >= 2) {
        const firstByte = client.buffer[0]
        const secondByte = client.buffer[1]

        const opcode = firstByte & 0x0f
        const isMasked = (secondByte & 0x80) !== 0
        let payloadLength = secondByte & 0x7f
        let offset = 2

        if (payloadLength === 126) {
            if (client.buffer.length < 4) return
            payloadLength = client.buffer.readUInt16BE(2)
            offset = 4
        } else if (payloadLength === 127) {
            if (client.buffer.length < 10) return
            payloadLength = Number(client.buffer.readBigUInt64BE(2))
            offset = 10
        }

        let maskingKey = null
        if (isMasked) {
            if (client.buffer.length < offset + 4) return
            maskingKey = client.buffer.slice(offset, offset + 4)
            offset += 4
        }

        if (client.buffer.length < offset + payloadLength) return

        let payload = client.buffer.slice(offset, offset + payloadLength)

        if (maskingKey) {
            for (let i = 0; i < payload.length; i++) {
                payload[i] ^= maskingKey[i % 4]
            }
        }

        client.buffer = client.buffer.slice(offset + payloadLength)

        if (opcode === 0x1) {
            // Text frame - handle message
            try {
                const data = JSON.parse(payload.toString('utf8'))
                if (data.type === 'message' && Array.isArray(data.args)) {
                    handleClientMessage(data.args)
                }
            } catch (e) {
                console.error('[WebSocket] Parse error:', e.message)
            }
        } else if (opcode === 0x8) {
            // Close
            client.socket.end()
        } else if (opcode === 0x9) {
            // Ping - send pong
            const frame = Buffer.alloc(2 + payload.length)
            frame[0] = 0x8a
            frame[1] = payload.length
            payload.copy(frame, 2)
            client.socket.write(frame)
        }
    }
}

// Broadcast to all WebSocket clients
function broadcast(data) {
    const message = JSON.stringify(data)
    for (const client of wsClients) {
        try {
            client.send(message)
        } catch (e) {
            console.error('[WebSocket] Broadcast error:', e.message)
        }
    }
}

// Bridge event emitter for main app communication
class WebBridge extends EventEmitter {
    constructor() {
        super()
        this.setMaxListeners(100)
        this.channel = this
        this.localEmit = this.emit.bind(this)
        this.originalEmit = this.emit.bind(this)
    }

    customEmit(...args) {
        // Send to web clients via WebSocket
        broadcast({ type: 'message', args: this.prepareArgs(args) })
    }

    prepareArgs(args) {
        // Serialize arguments for transmission
        return JSON.parse(JSON.stringify(args, (key, value) => {
            if (typeof value === 'function') return undefined
            if (value instanceof Error) {
                return { error: true, message: value.message, stack: value.stack }
            }
            return value
        }))
    }

    serve(file) {
        // For web mode, serve files through the HTTP server
        if (fs.existsSync(file)) {
            const relativePath = path.relative(wwwNodejsPath, file)
            return `http://localhost:${port}/${relativePath}`
        }
        return null
    }

    secret(length) {
        return randomBytes(length).toString('hex')
    }

    async clipboard(text, successMessage) {
        if (typeof text === 'string') {
            this.customEmit('clipboard-write', text, successMessage)
        } else {
            const uid = 'clipboard-read-' + this.secret(9)
            return new Promise((resolve, reject) => {
                const timeout = setTimeout(() => reject(new Error('Clipboard read timeout')), 5000)
                this.once(uid, (err, text) => {
                    clearTimeout(timeout)
                    if (err) return reject(err)
                    resolve(text)
                })
                this.customEmit('clipboard-read', uid)
            })
        }
    }

    destroy() {
        for (const client of wsClients) {
            client.socket.destroy()
        }
        wsClients.clear()
        this.removeAllListeners()
    }
}

const webBridge = new WebBridge()

// Handle messages from web clients
function handleClientMessage(args) {
    // Forward to bridge
    webBridge.emit(...args)
}

// Start server
server.listen(port, '0.0.0.0', (err) => {
    if (err) {
        console.error('Failed to start server:', err)
        process.exit(1)
    }

    console.log(`
╔═══════════════════════════════════════════════════════════════╗
║  Megacubo Web Server is running!                              ║
╠═══════════════════════════════════════════════════════════════╣
║  Open in browser: http://localhost:${String(port).padEnd(26)}║
║                                                               ║
║  Press Ctrl+C to stop                                         ║
╚═══════════════════════════════════════════════════════════════╝
`)

    // Now load the main application with the web bridge
    loadMainApp()
})

async function loadMainApp() {
    try {
        console.log('Loading main application...')

        // Set up global bridge instance before importing main
        global.bridgeInstance = webBridge
        global.bridgeInstanceCallbacks = null

        // Override the bridge module's UI getter
        const bridgeModulePath = path.join(wwwNodejsPath, 'modules', 'bridge', 'bridge.js')

        // Import and patch the bridge module
        const bridgeModule = await import(`file://${bridgeModulePath}`)

        // Patch the default export (which is the Bridge accessor object)
        if (bridgeModule.default && typeof bridgeModule.default === 'object') {
            // Override ui property to return our web bridge
            Object.defineProperty(bridgeModule.default, 'ui', {
                get: function() {
                    return webBridge
                },
                configurable: true
            })

            // Override channel property
            Object.defineProperty(bridgeModule.default, 'channel', {
                get: function() {
                    return webBridge.channel
                },
                configurable: true
            })
        }

        // Import and run the built main module
        const mainModulePath = path.join(wwwNodejsPath, 'dist', 'main.js')
        if (!fs.existsSync(mainModulePath)) {
            console.error('Built main.js not found. Please run "npm run build" first.')
            process.exit(1)
        }

        await import(`file://${mainModulePath}`)

        console.log('Main application loaded successfully!')

    } catch (err) {
        console.error('Failed to load main application:', err)
        // Keep server running for static files even if main app fails
    }
}

// Keep process running
process.stdin.resume()

// Graceful shutdown
const shutdown = () => {
    console.log('\nShutting down...')
    webBridge.destroy()
    server.close()
    process.exit(0)
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
process.on('uncaughtException', (err) => {
    console.error('Uncaught exception:', err)
})
process.on('unhandledRejection', (err) => {
    console.error('Unhandled rejection:', err)
})
