#!/usr/bin/env node
/**
 * Web Server Launcher for Megacubo
 *
 * This script starts Megacubo in web mode, which:
 * 1. Starts the backend server with WebSocket support
 * 2. Serves the web UI to browsers
 * 3. Enables real-time communication between browser and backend
 *
 * Usage:
 *   node scripts/web-server.mjs [port]
 *
 * Environment variables:
 *   MEGACUBO_WEB_PORT - Port to listen on (default: 8080)
 */

import path from 'path'
import { fileURLToPath } from 'url'
import fs from 'fs'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const rootDir = path.resolve(__dirname, '..')

// Set environment to indicate web mode
process.env.MEGACUBO_WEB_MODE = 'true'
process.env.MEGACUBO_AS_LIBRARY = 'true'

// Parse command line arguments
const args = process.argv.slice(2)
const portArg = args.find(arg => !arg.startsWith('-'))
const port = parseInt(portArg || process.env.MEGACUBO_WEB_PORT || '8080', 10)

console.log(`
╔════════════════════════════════════════════════════════════╗
║           Megacubo Web Server                              ║
╠════════════════════════════════════════════════════════════╣
║  Starting web server on port ${String(port).padEnd(5)}                        ║
║  Open http://localhost:${String(port).padEnd(5)} in your browser            ║
╚════════════════════════════════════════════════════════════╝
`)

// Change to project root
process.chdir(path.join(rootDir, 'www', 'nodejs'))

// Import and configure the paths module first
const pathsModule = await import('../www/nodejs/modules/paths/paths.js')
const paths = pathsModule.default

// Configure web mode in bridge
const bridgeModule = await import('../www/nodejs/modules/bridge/bridge.js')
const bridge = bridgeModule.default

// Override the bridge creation to use web mode
const originalUiGetter = Object.getOwnPropertyDescriptor(bridge, 'ui')
Object.defineProperty(bridge, 'ui', {
    get() {
        if (!global.bridgeInstance) {
            if (paths.inWorker) {
                console.error('!!! Tried to create a Bridge instance from a worker !!!')
                return {
                    on: () => {},
                    emit: () => {},
                    once: () => {},
                    removeListener: () => {},
                    removeAllListeners: () => {}
                }
            } else {
                // Create bridge with web mode enabled
                const Bridge = bridgeModule.Bridge || (function() {
                    // Get the Bridge class from the module
                    const moduleContent = bridgeModule
                    for (const key of Object.keys(moduleContent)) {
                        if (typeof moduleContent[key] === 'function' && key !== 'default' && key !== 'ready') {
                            return moduleContent[key]
                        }
                    }
                })()

                // Since we can't easily modify the existing bridge constructor,
                // we'll patch the global instance after creation
                if (originalUiGetter && originalUiGetter.get) {
                    global.bridgeInstance = originalUiGetter.get.call(bridge)
                }
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
})

// Now import main module with web mode configuration
// We need to patch the bridge options before main.mjs imports it

// Patch global to indicate web mode
global.MEGACUBO_WEB_MODE = true
global.MEGACUBO_WEB_PORT = port

// Import the configuration module
const configModule = await import('../www/nodejs/modules/config/config.js')
const config = configModule.default

// Import crashlog for error handling
const crashlogModule = await import('../www/nodejs/modules/crashlog/crashlog.js')
const crashlog = crashlogModule.default

// Set up error handlers
process.on('uncaughtException', (err, origin) => {
    console.error('uncaughtException:', err.message, err.stack)
    crashlog.save('uncaughtException', err)
    return false
})

process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection:', reason)
    crashlog.save('unhandledRejection', reason)
})

// Now import the main application
console.log('Loading main application...')

try {
    // Dynamically import main with web mode
    const mainModule = await import('../www/nodejs/main.mjs')

    console.log(`
╔════════════════════════════════════════════════════════════╗
║  Web server is running!                                    ║
║  Access the app at: http://localhost:${String(port).padEnd(5)}                ║
║                                                            ║
║  Press Ctrl+C to stop the server                           ║
╚════════════════════════════════════════════════════════════╝
`)

} catch (err) {
    console.error('Failed to start web server:', err)
    process.exit(1)
}

// Keep the process running
process.stdin.resume()

// Handle graceful shutdown
process.on('SIGINT', () => {
    console.log('\nShutting down web server...')
    process.exit(0)
})

process.on('SIGTERM', () => {
    console.log('\nShutting down web server...')
    process.exit(0)
})
