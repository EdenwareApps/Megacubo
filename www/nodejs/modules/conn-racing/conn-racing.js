import Download from '../download/download.js'
import { EventEmitter } from 'events'
import pLimit from 'p-limit'

class ConnRacing extends EventEmitter {
    constructor(urls, opts = {}) {
        super()
        this.urls = [...urls]
        this.opts = opts
        this.results = []
        this.callbacks = []
        this.downloads = []
        this.ended = false
        this.racingEnded = false
        this.processedCount = 0
        this.triggerInterval = opts.triggerInterval || 0
        this.uid = Math.floor(Math.random() * 1e11)
        this.exitListener = () => this.destroy()
        process.on('exit', this.exitListener)
        this.start().catch(err => console.error(err))
        process.removeListener('exit', this.exitListener)
    }

    wait(ms) {
        return new Promise(resolve => setTimeout(resolve, ms))
    }

    async start() {
        if (this.urls.length === 0) {
            return this.end()
        }

        const limit = pLimit(20)
        const succeeded = new Set()
        const tasks = this.createDownloadTasks(limit, succeeded)

        await Promise.allSettled(tasks)
        this.racingEnded = true
        this.end()
    }

    createDownloadTasks(limit, succeeded) {
        const tasks = []
        for (let attempt = 1; attempt <= this.opts.retries; attempt++) {
            tasks.push(
                ...this.urls.map((url, index) => limit(async () => this.validateUrl(url, index, attempt, succeeded)))
            )
        }
        return tasks
    }

    async validateUrl(url, index, attempt, succeeded) {
        if (this.ended || succeeded.has(url)) return this.markAsProcessed(url, 200)
        if (!/^https?:\/\//.test(url)) throw new Error('URL não testável')
        if (this.triggerInterval && index > 0) await this.wait(index * this.triggerInterval)

        const start = Date.now() / 1000
        const download = Download.head({
            url,
            followRedirect: true,
            acceptRanges: false,
            keepalive: false,
            retries: 1,
            timeout: attempt * this.opts.timeout,
        })

        this.downloads.push(download)
        const response = await download.catch(() => null) // Suprime erros de download

        this.processedCount++
        return response ? this.handleDownloadResponse(url, response, start, succeeded) : false
    }

    handleDownloadResponse(url, response, start, succeeded) {
        const isValid = response.statusCode >= 200 && response.statusCode < 300
        const result = {
            time: Date.now() / 1000 - start,
            url,
            valid: isValid,
            status: response.statusCode,
            headers: response.headers,
        }

        this.results.push(result)
        if (isValid) succeeded.add(url)

        this.pump()
        return response.statusCode
    }

    markAsProcessed(url, statusCode) {
        this.processedCount++
        this.pump()
        return statusCode
    }

    pump() {
        if (this.destroyed) return

        while (this.results.length && this.callbacks.length) {
            const callback = this.callbacks.shift()
            const result = this.results.shift()
            callback(result)
        }

        if (this.ended || (this.racingEnded && this.results.length === 0)) {
            this.ended = true
            this.callbacks.forEach(callback => callback(false))
            this.callbacks = []
        }
    }

    next() {
        return new Promise(resolve => {
            if (this.results.length > 0) {
                return resolve(this.results.shift())
            }

            this.callbacks.push(resolve)
            this.pump()

            if (this.ended) resolve(false)
        })
    }

    end() {
        if (!this.ended) {
            this.ended = true
            this.pump()
            this.emit('end')
            this.destroy()
        }
    }

    progress() {
        return (this.processedCount / this.urls.length) * 100
    }

    destroy() {
        if (!this.destroyed) {
            this.ended = true
            this.destroyed = true
            this.results = []
            this.callbacks = []
            this.downloads.forEach(download => download.cancel())
            this.downloads = []
            this.removeAllListeners()
        }
    }
}

export default ConnRacing