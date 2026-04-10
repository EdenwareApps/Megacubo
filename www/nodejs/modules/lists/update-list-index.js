import { dirname, joinPath } from '../utils/utils.js';
import Download from '../download/download.js'
import fs from 'fs'
import path from 'path'
import { tmpdir } from 'os'
import paths from '../paths/paths.js'
import MediaURLInfo from '../streamer/utils/media-url-info.js'
import Xtr from './xtr.js'
import Mag from './mag.js'
import { Parser } from './parser.js'
import config from '../config/config.js'
import { Database } from 'jexidb';
import storage from '../storage/storage.js';
import { terms, match } from './tools.js'
import { getListMeta, setListMeta, writeMetaToFile, resolveListMetaPath } from "./list-meta.js";
import { EventEmitter } from "events";
import { sniffStreamType, inferTypeFromGroupName } from './stream-classifier.js'
import dbConfig from "./db-config.js";
import Reader from '../reader/reader.js';
import DownloadSafety from '../utils/download-safety.js';

const LIST_STORAGE_TTL = 24 * 3600

// Extensions that strongly indicate VOD (file) vs live (stream); used for per-group URL heuristic
const VOD_EXTENSIONS = new Set(['mp4', 'mkv', 'mpeg', 'mov', 'm4v', 'webm', 'ogv', 'hevc', 'divx', 'm4s', 'asf', 'avi', 'flv', 'wmv'])
const LIVE_EXTENSIONS = new Set(['m3u8', 'ts'])
const MAX_EXTENSION_SAMPLES_PER_GROUP = 50

class UpdateListIndex extends EventEmitter {
    constructor(opts = {}) {
        super()
        this.url = opts.url
        this.file = opts.file
        this.playlists = []
        this.master = opts.master
        this.invalidEntriesCount = 0
        this.lastProgress = -1
        this.directURL = opts.directURL || this.url
        this.updateMeta = opts.updateMeta
        this.forceDownload = opts.forceDownload === true
        this.indexFile = this.file.replace(/\.jdb$/i, '.idx.jdb')
        this.metaFile = this.file.replace(/\.jdb$/i, '.meta.jdb')
        this.timeout = opts.timeout || config.get('read-timeout')
        this.indexMeta = {}
        // Default to false to avoid excessive logging in production
        this.debug = opts.debug === true
        this.insertPromises = []
        this._index = { meta: {}, gids: {}, groupsTypes: {}, length: 0 }
        this.groups = {} // Initialize groups object
        this.cancelled = false // Flag to cancel all operations
        this.abortController = new AbortController() // For cancelling operations
        this.insertsDisabled = false // Flag to completely disable inserts

        // OPTIMIZATION: Initialize InsertSession properties for batch operations
        this.insertSession = null

        // Cache only the last processed entry to merge consecutive duplicates
        this.lastCachedEntry = null
        this.lastURL = null
        // Cache groupTerms only (groups repeat sequentially; discard when group changes)
        this._lastCachedGroupKey = ''
        this._cachedGroupTerms = []
        
        // Temporary file management for streaming download to prevent OOM
        this.tempFiles = []
        this.writeStreams = []
        this.readStreams = []
        
        this.reset()
    }

    // Helper method to detect if text is sequential using multilingual terms matching
    isSequentialText(existing, newText) {
        // Extract terms from both texts
        const ptms = terms(existing)
        const tms = terms(newText)

        // Filter out numeric terms to focus on semantic content
        const ptmsFiltered = ptms.filter(term => !/^\d+$/.test(term))
        const tmsFiltered = tms.filter(term => !/^\d+$/.test(term))

        // If no meaningful terms after filtering, consider as sequential
        if (ptmsFiltered.length === 0 || tmsFiltered.length === 0) {
            return true
        }

        // Use the match function to check if terms don't match (indicating sequential text)
        const matchScore = match(ptmsFiltered, tmsFiltered)

        // If match score is low, it's likely sequential text
        return matchScore < 0.3
    }


    async registerStorageArtifacts(ttlSeconds) {
        const metaIndexFile = this.metaFile.replace(/\.jdb$/i, '.idx.jdb')
        const listMetaPath = resolveListMetaPath(this.url)
        const listMetaIndexPath = listMetaPath.replace(/\.jdb$/i, '.idx.jdb')
        const filesToRegister = [
            this.file,
            this.indexFile,
            this.metaFile,
            metaIndexFile,
            listMetaPath,
            listMetaIndexPath
        ]

        // Add temporary files if they exist (.updating)
        // Note: .backup files are always removed after success and don't need to be registered
        const baseFile = this.file.replace(/\.jdb$/i, '')
        const metaFileBase = this.metaFile.replace(/\.jdb$/i, '')
        const temporaryFiles = [
            baseFile + '.updating.jdb',
            baseFile + '.updating.idx.jdb',
            metaFileBase + '.updating.jdb',
            metaFileBase + '.updating.idx.jdb'
        ]
        filesToRegister.push(...temporaryFiles)

        let registeredAny = false
        for (const filePath of filesToRegister) {
            if (!filePath) {
                continue
            }

            try {
                await fs.promises.access(filePath)
                try {
                    await storage.registerFile(filePath, {
                        ttl: ttlSeconds,
                        size: 'auto',
                        raw: true
                    })
                    registeredAny = true
                } catch (err) {
                    console.warn('Storage registration failed for file:', filePath, err?.message || err)
                }
            } catch {
                continue
            }

        }

        // If we registered any file, ensure the storage index is persisted promptly.
        // Prefer the storage save limiter when available to avoid too-frequent disk writes.
        try {
            if (registeredAny) {
                storage.save().catch(err => {
                    console.warn('Storage save failed:', err?.message || err)
                })                    
            }
        } catch (e) {
            // Non-fatal: continue
        }
    }


    ext(file) {
        let basename = String(file).split('?')[0].split('#')[0].split('/').pop()
        basename = basename.split('.')
        if (basename.length > 1) {
            return basename.pop().toLowerCase()
        } else {
            return ''
        }
    }

    // All training methods removed - AI is already trained
    parseHeadersMeta(headers) {
        const prefix = 'x-m3u-meta-'
        Object.keys(headers).filter(k => k.startsWith(prefix)).forEach(k => {
            const name = k.substr(prefix.length)
            this.indexMeta[name] = headers[k]
        })
    }


    connect(path) {
        return new Promise((resolve, reject) => {
            // Check if path is a local file (not a URL)
            const isLocalFile = async () => {
                // Check for Windows drive letter or absolute Unix path
                if (path.match(/^[A-Z]:\\/i) || path.startsWith('/')) {
                    try {
                        await fs.promises.access(path)
                        return true
                    } catch {
                        return false
                    }
                }
                // Check if it exists (relative path)
                try {
                    await fs.promises.access(path)
                    return true
                } catch {
                    return false
                }
            }
            
            // Check if it's a local file
            isLocalFile().then(isLocal => {
                if (isLocal) {
                    // Local file - create read stream directly
                    try {
                        const readStream = fs.createReadStream(path, { 
                            highWaterMark: 64 * 1024,
                            encoding: 'utf8'
                        })
                        this.readStreams.push(readStream)
                        
                        let dataReceived = false
                        let bytesReceived = 0
                        
                        // Monitor stream data events
                        readStream.on('data', (chunk) => {
                            if (!dataReceived) {
                                dataReceived = true
                                if (this.debug) {
                                    console.log(`[UpdateListIndex] Stream started receiving data from ${path}`)
                                }
                            }
                            bytesReceived += chunk.length
                        })
                        
                        // Handle stream errors
                        readStream.on('error', (err) => {
                            console.error('UpdateListIndex local file readStream error:', err)
                            reject(err)
                        })
                        
                        // Ensure stream reads completely
                        readStream.on('end', () => {
                            if (this.debug) {
                                console.log(`[UpdateListIndex] Stream ended. Total bytes received: ${bytesReceived}`)
                            }
                        })
                        
                        // Ensure stream is in flowing mode (not paused)
                        if (readStream.isPaused && readStream.isPaused()) {
                            if (this.debug) {
                                console.log(`[UpdateListIndex] Stream was paused, resuming...`)
                            }
                            readStream.resume()
                        }
                        
                        resolve({
                            stream: readStream,
                            url: this.directURL || this.url || path,
                            tempFile: path
                        })
                        return
                    } catch (err) {
                        reject(err)
                        return
                    }
                }
                
                // Continue with URL handling below
                this.connectURL(path, resolve, reject)
            }).catch(() => {
                // If check fails, assume it's a URL
                this.connectURL(path, resolve, reject)
            })
        })
    }
    
    connectURL(path, resolve, reject) {

        if (path.match(new RegExp('^//[^/]+\\.'))) {
            path = 'http:' + path
        }
        if (path.match(new RegExp('^https?:'))) {
                let resolved
                const opts = {
                    url: path,
                    followRedirect: true,
                    keepalive: false,
                    retries: 3,
                    headers: { 'accept-charset': 'utf-8, *;q=0.1' },
                    encoding: 'utf8',
                    timeout: this.timeout, // some servers will take too long to send the initial response
                    maxContentLength: 200 * (1024 * 1024), // 200Mb
                    encoding: 'utf8'
                }
                this.stream = new Download(opts)
                this.stream.on('redirect', (url, headers) => this.parseHeadersMeta(headers))
                this.stream.on('response', async (statusCode, headers) => {
                    resolved = true
                    this.parseHeadersMeta(headers)
                    if (statusCode >= 200 && statusCode < 300) {
                        if (DownloadSafety.isHtmlContentType(headers)) {
                            this.stream.destroy()
                            reject(new Error(`Rejected suspicious HTML response: ${DownloadSafety.getContentType(headers)}`))
                            return
                        }
                        if (this.stream.totalContentLength) {
                            this.contentLength = this.stream.totalContentLength
                        }
                        if (this.stream.totalContentLength > 0 && (this.stream.totalContentLength == this.updateMeta.contentLength)) {
                            this.stream.destroy()
                            resolve(false) // no need to update
                        } else {
                            // Create temporary file for streaming download to prevent OOM
                            const tempDir = paths.temp || tmpdir()
                            fs.promises.mkdir(tempDir, { recursive: true }).catch(() => {}).then(() => {
                                const tempFile = joinPath(tempDir, `list-${Date.now()}-${Math.random().toString(36).substr(2, 9)}.tmp`)
                                this.tempFiles.push(tempFile)
                                
                                // Create write stream to file
                                const writeStream = fs.createWriteStream(tempFile)
                                this.writeStreams.push(writeStream)
                                
                                // Create read stream from file (paused initially) - only after file exists
                                // Delay read stream creation until we have some data written
                                let readStream = null
                                const createReadStream = () => {
                                    if (!readStream) {
                                        try {
                                            // Use Reader with persistent=true to continue reading even after EOF
                                            // This allows reading while writeStream is still writing
                                            readStream = new Reader(tempFile, { 
                                                persistent: true, // Keep reading even after EOF
                                                highWaterMark: 64 * 1024 // 64KB buffer
                                            })
                                            readStream.pause() // Start paused until we have some data
                                            this.readStreams.push(readStream)
                                            
                                            // When writeStream finishes, close the readStream properly
                                            writeStream.once('finish', () => {
                                                // Give it a moment to read any remaining data, then close
                                                setTimeout(() => {
                                                    if (readStream && !readStream.isClosed) {
                                                        readStream.close()
                                                    }
                                                }, 1000)
                                            })
                                        } catch (err) {
                                            console.error('UpdateListIndex: Failed to create read stream:', err)
                                            // Fallback: use write stream directly if read stream fails
                                            readStream = null
                                        }
                                    }
                                    return readStream
                                }
                                
                                let bytesWritten = 0
                                const MIN_BYTES_TO_START = 64 * 1024 // Start reading after 64KB
                                let readStreamResolved = false
                                let writeStreamError = null
                                
                                // Handle write stream events
                                writeStream.on('error', (err) => {
                                    writeStreamError = err
                                    console.error('UpdateListIndex writeStream error:', err)
                                    if (readStream) {
                                        readStream.destroy()
                                    }
                                    if (!readStreamResolved) {
                                        readStreamResolved = true
                                        reject(err)
                                    }
                                })
                                
                                writeStream.on('finish', () => {
                                    // Resume read stream if it was paused
                                    const rs = createReadStream()
                                    if (rs && rs.isPaused()) {
                                        rs.resume()
                                    }
                                })
                                
                                // Pipe download data to write stream
                                this.stream.on('data', (chunk) => {
                                    if (writeStreamError || readStreamResolved) return
                                    
                                    const canWrite = writeStream.write(chunk)
                                    bytesWritten += chunk.length
                                    
                                    // Create read stream once we have enough data to start parsing
                                    // This allows parsing to start while download is still in progress
                                    if (!readStreamResolved && bytesWritten >= MIN_BYTES_TO_START) {
                                        const rs = createReadStream()
                                        if (rs) {
                                            readStreamResolved = true
                                            rs.resume()
                                            
                                            // Handle read stream events
                                            rs.on('error', (err) => {
                                                console.error('UpdateListIndex readStream error:', err)
                                                writeStream.destroy()
                                                if (!readStreamResolved) {
                                                    readStreamResolved = true
                                                    reject(err)
                                                }
                                            })
                                            
                                            resolve({
                                                stream: rs,
                                                url: this.stream.currentURL,
                                                tempFile: tempFile
                                            })
                                        }
                                    }
                                    
                                    // Handle backpressure - writeStream automatically manages backpressure
                                    // When canWrite is false, writeStream buffers internally and will emit 'drain' when ready
                                    // The Download stream is event-based, so we don't need to pause/resume it
                                    // If writeStream.write() returns false, it means the internal buffer is full
                                    // but the data has already been queued, so no action needed here
                                })
                                
                                this.stream.once('end', () => {
                                    writeStream.end()
                                    // If we haven't resolved yet (small file), resolve now
                                    if (!readStreamResolved) {
                                        // For small files, wait briefly for write stream to finish
                                        const finishHandler = () => {
                                            if (!readStreamResolved) {
                                                const rs = createReadStream()
                                                if (rs) {
                                                    readStreamResolved = true
                                                    rs.resume()
                                                    
                                                    // Handle read stream events
                                                    rs.on('error', (err) => {
                                                        console.error('UpdateListIndex readStream error:', err)
                                                    })
                                                    
                                                    resolve({
                                                        stream: rs,
                                                        url: this.stream.currentURL,
                                                        tempFile: tempFile
                                                    })
                                                } else {
                                                    // Fallback: use write stream if read stream creation fails
                                                    readStreamResolved = true
                                                    resolve({
                                                        stream: this.stream,
                                                        url: this.stream.currentURL
                                                    })
                                                }
                                            }
                                        }
                                        
                                        // Check if already finished
                                        if (writeStream.writableEnded || writeStream.destroyed) {
                                            finishHandler()
                                        } else {
                                            // Wait for finish with short timeout
                                            writeStream.once('finish', finishHandler)
                                            writeStream.once('error', finishHandler)
                                            setTimeout(finishHandler, 5000) // 5 second timeout for small files
                                        }
                                    }
                                })
                                
                                this.stream.on('error', (err) => {
                                    writeStream.destroy()
                                    if (readStream) {
                                        readStream.destroy()
                                    }
                                    if (!readStreamResolved) {
                                        readStreamResolved = true
                                        reject(err)
                                    }
                                })
                                
                            }).catch((err) => {
                                console.error('UpdateListIndex temp file creation error:', err)
                                // Fallback to direct stream if temp file fails
                                resolve({
                                    stream: this.stream,
                                    url: this.stream.currentURL
                                })
                            })
                        }
                    } else {
                        this.stream.destroy()
                        // Handle 404 errors gracefully
                        if (statusCode === 404) {
                            console.warn(`List not found (404): ${path}`)
                            reject('List not found (404)')
                        } else {
                            reject('http error ' + statusCode)
                        }
                    }
                })
                this.stream.on('error', e => {
                    console.error('UpdateListIndex fetch err', e)
                    if (!resolved) {
                        resolved = true
                        reject(e)
                    }
                })
                this.stream.start()
            } else {
                const file = path
                fs.stat(file, (err, stat) => {
                    if (stat && stat.size) {
                        this.contentLength = stat.size
                        if (stat.size > 0 && stat.size == this.updateMeta.contentLength) {
                            resolve(false) // no need to update
                        } else {
                            this.stream = fs.createReadStream(file)
                            resolve({
                                stream: this.stream,
                                url: file
                            })
                        }
                    } else {
                        reject('file not found or empty*')
                    }
                })
            }
    }

    async insert(e, db) {
        // Check if cancelled or inserts disabled
        if (this.cancelled || this.insertsDisabled) {

            return
        }

        // Check if database is still valid
        if (!db || db.destroyed) {
            console.error('Database is destroyed, disabling inserts')
            this.cancelled = true
            this.insertsDisabled = true
            return
        }

        // Basic validation - parser should have already filtered invalid entries
        if (!e || !e.url || !e.name) {
            this.invalidEntriesCount++
            return
        }

        // URL MERGING LOGIC: only compare against the last cached entry
        if (this.lastCachedEntry && this.lastCachedEntry.url !== e.url) {
            this.lastCachedEntry = null
        }

        const existingEntry = this.lastCachedEntry && this.lastCachedEntry.url === e.url ? this.lastCachedEntry : null
        if (existingEntry) {
            // Merge names if they are different and not sequential
            const existingName = existingEntry.name.trim()
            const newName = e.name.trim()

            // Check if names are different and not sequential
            if (newName !== existingName && !this.isSequentialText(existingName, newName)) {
                // Merge the names using the intelligent mergeNames function
                existingEntry.name = this.master.tools.mergeNames(existingName, newName)
            }
            /*
            else if (newName === existingName) {
                // Same text - keep only one entry (already have it)
            } else {
                // Sequential text - keep only the first one
            }
            */
            return // Don't insert duplicate URL
        }

        // Cache current entry for potential merge with the next item
        const entryToInsert = { ...e }
        this.lastCachedEntry = entryToInsert
        this.lastURL = e.url

        // CRITICAL FIX: Increment foundStreams BEFORE using it as index
        // This ensures each entry gets a unique index
        this.foundStreams++
        const i = this.foundStreams - 1 // Use 0-based index

        // Cache groupTerms (groups repeat sequentially; overwrite when group changes)
        const groupKey = (entryToInsert.group && entryToInsert.group !== 'undefined') ? entryToInsert.group : ''
        if (groupKey !== this._lastCachedGroupKey) {
            this._lastCachedGroupKey = groupKey
            this._cachedGroupTerms = this.master.tools.terms(groupKey)
        }
        entryToInsert.groupTerms = this._cachedGroupTerms
        this.master.prepareEntry(entryToInsert)

        // Normalize parser/attribute country hints to ISO-2.
        if (typeof entryToInsert.country === 'string') {
            entryToInsert.country = entryToInsert.country.trim().toUpperCase()
            if (entryToInsert.country.length > 2) {
                entryToInsert.country = entryToInsert.country.substring(0, 2)
            }
            if (!/^[A-Z]{2}$/.test(entryToInsert.country)) {
                entryToInsert.country = ''
            }
        }

        // Sanitize entry to prevent JSON serialization issues
        this.sanitizeEntryForJSON(entryToInsert)

        const rawStreamType = sniffStreamType(entryToInsert)
        if (rawStreamType === 'vod' || rawStreamType === 'series') {
            entryToInsert.mediaType = 'video'
        } else if (rawStreamType === 'live') {
            entryToInsert.mediaType = 'live'
        } else {
            entryToInsert.mediaType = 'unknown'
        }

        // Cap gids per gid to prevent OOM on lists with many channels in same group (e.g. 50k "Live TV")
        // Reduced from 2000 to 500 to save memory
        const MAX_GID_NAMES = 500
        const MAX_TOTAL_GIDS = 1000 // Limit total unique gids to prevent memory explosion
        if (entryToInsert.name && entryToInsert.gid) {
            const totalGids = Object.keys(this._index.gids).length
            if (typeof (this._index.gids[entryToInsert.gid]) == 'undefined') {
                // Only add new gid if we haven't exceeded the limit
                if (totalGids < MAX_TOTAL_GIDS) {
                    this._index.gids[entryToInsert.gid] = []
                }
            }
            if (this._index.gids[entryToInsert.gid]) {
                const arr = this._index.gids[entryToInsert.gid]
                if (arr.length < MAX_GID_NAMES && !arr.includes(entryToInsert.name)) {
                    arr.push(entryToInsert.name)
                }
            }
        }
        // Process groups - limit total groups to prevent memory issues
        const MAX_TOTAL_GROUPS = 500
        const totalGroups = Object.keys(this.groups).length
        if (typeof this.groups[groupKey] === 'undefined') {
            // Only add new group if under limit
            if (totalGroups < MAX_TOTAL_GROUPS) {
                this.groups[groupKey] = {
                    names: [],
                    icon: null,
                    typeCounts: { live: 0, vod: 0, series: 0 },
                    extensionCounts: { vodLike: 0, liveLike: 0, sampled: 0 }
                }
            }
        }

        // Only process group data if the group exists (wasn't skipped due to limit)
        if (this.groups[groupKey]) {
            if (Array.isArray(this.groups[groupKey])) {
                this.groups[groupKey] = {
                    names: this.groups[groupKey]
                        .map(entry => (typeof entry === 'string' ? entry : entry?.name))
                        .filter(name => typeof name === 'string')
                        .slice(0, 20),
                    icon: null,
                    typeCounts: { live: 0, vod: 0, series: 0 },
                    extensionCounts: { vodLike: 0, liveLike: 0, sampled: 0 }
                }
            }

            const groupData = this.groups[groupKey]

            if (entryToInsert.name && groupData.names.length < 20) {
                groupData.names.push(entryToInsert.name)
            }

            if (!groupData.icon && typeof entryToInsert.icon === 'string' && entryToInsert.icon.length > 12) {
                groupData.icon = entryToInsert.icon
            }

            // Per-group URL extension heuristic (isGroupVOD): sample extensions to detect VOD-heavy groups
            if (groupData.extensionCounts && groupData.extensionCounts.sampled < MAX_EXTENSION_SAMPLES_PER_GROUP && entryToInsert.url) {
                const ext = String(entryToInsert.url).split('?')[0].split('#')[0].split('.').pop().toLowerCase()
                if (ext) {
                    groupData.extensionCounts.sampled++
                    if (VOD_EXTENSIONS.has(ext)) groupData.extensionCounts.vodLike++
                    else if (LIVE_EXTENSIONS.has(ext)) groupData.extensionCounts.liveLike++
                }
            }

            // Prefer group name when it clearly indicates vod/series (e.g. "VOD", "Movies", "Series");
            // otherwise many IPTV lists would be all 'live' because URLs are .m3u8/live-shaped
            const groupType = inferTypeFromGroupName(entryToInsert.group)
            let groupStreamType = (groupType === 'vod' || groupType === 'series') ? groupType : (rawStreamType || groupType || 'live')
            if (groupStreamType && Object.prototype.hasOwnProperty.call(groupData.typeCounts, groupStreamType)) {
                groupData.typeCounts[groupStreamType] += 1
            }
        }

        // Aggregate country evidence per list for post-index ranking.
        if (entryToInsert.country) {
            this.countryStats.total += 1
            this.countryStats.counts[entryToInsert.country] = (this.countryStats.counts[entryToInsert.country] || 0) + 1
            if (groupKey) {
                if (!this.countryStats.groups[entryToInsert.country]) {
                    this.countryStats.groups[entryToInsert.country] = new Set()
                }
                this.countryStats.groups[entryToInsert.country].add(groupKey)
            }
        }

        // OPTIMIZATION: Initialize InsertSession if not already done
        if (!this.insertSession) {
            this.insertSession = db.beginInsertSession({
                batchSize: 1000,
                enableAutoSave: true
            })

        }

        // OPTIMIZATION: Add to InsertSession instead of batch processing
        try {
            await this.insertSession.add(entryToInsert)
        } catch (error) {
            console.error('Error adding to InsertSession:', error)
            // Fallback to original batch processing if InsertSession fails
        }
    }
    async flushInsertSession(db) {
        if (!this.insertSession) {
            return
        }

        try {
            // NOTE: InsertSession with enableAutoSave: true already auto-flushes at batchSize (1000)
            // This final commit ensures any remaining entries (< 500) are saved
            await this.insertSession.commit()
            
            // CRITICAL: Wait for all operations to complete before continuing
            if (db && !db.destroyed && typeof db.waitForOperations === 'function') {
                console.log(`⏳ Waiting for operations to complete...`)
                await db.waitForOperations()
                console.log(`✅ Operations completed, db.length after: ${db.length}`)
            }
            
            this._index.length = db.length
            this.insertSession = null
        } catch (commitErr) {
            this.insertsDisabled = true
            console.error('❌ CRITICAL: Failed to commit InsertSession batch:', commitErr)
            this.insertSession = null
            throw commitErr
        }
    }

    // Sanitize entry data to prevent JSON serialization issues that cause db.walk() failures
    sanitizeEntryForJSON(entry) {
        if (!entry || typeof entry !== 'object') return entry;

        // Function to sanitize a string value
        const sanitizeString = (str) => {
            if (typeof str !== 'string') return str;

            return str
                // Remove or replace problematic characters that break JSON parsing
                .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x9F]/g, '') // Remove control characters
                .replace(/\\/g, '\\\\') // Escape backslashes first
                .replace(/"/g, '\\"')   // Escape quotes
                .replace(/\n/g, '\\n')  // Escape newlines
                .replace(/\r/g, '\\r')  // Escape carriage returns
                .replace(/\t/g, '\\t')  // Escape tabs
                // Limit maximum length to prevent huge strings
                .substring(0, 10000);
        };

        // Sanitize all string properties
        const stringFields = ['url', 'name', 'icon', 'gid', 'group', 'groupName', 'lang', 'country'];
        for (const field of stringFields) {
            if (entry[field]) {
                entry[field] = sanitizeString(entry[field]);
            }
        }

        // Sanitize array fields (groups, nameTerms, groupTerms, etc.)
        const arrayFields = ['groups', 'nameTerms', 'groupTerms'];
        for (const field of arrayFields) {
            if (Array.isArray(entry[field])) {
                entry[field] = entry[field]
                    .filter(item => item != null) // Remove null/undefined
                    .map(item => typeof item === 'string' ? sanitizeString(item) : item)
                    .filter(item => item !== ''); // Remove empty strings
            }
        }

        return entry;
    }

    /**
     * Download only - saves to temporary file and returns path
     * Used for separated download/parse queues
     */
    async download() {
        let alturl, urls = [this.directURL], fmt = config.get('live-stream-fmt')
        if (['hls', 'mpegts'].includes(fmt)) {
            if (!this.mi) {
                this.mi = new MediaURLInfo()
            }
            alturl = this.mi.setURLFmt(this.directURL, fmt)
            if (alturl) {
                urls.unshift(alturl)
            }
        }

        // Create temporary file for download
        const tempDir = paths.temp || tmpdir()
        await fs.promises.mkdir(tempDir, { recursive: true }).catch(() => {})
        const tempFile = joinPath(tempDir, `list-${Date.now()}-${Math.random().toString(36).substr(2, 9)}.tmp`)
        this.tempFiles.push(tempFile)

        for (let url of urls) {
            const hasCredentials = url.includes('@')
            if (hasCredentials && (url.includes('#xtream') || url.includes('#mag'))) {
                // For xtream/mag, we can't easily separate download/parse
                // Return null to signal fallback to full start()
                // Clean up temp file if created
                if (this.tempFiles.includes(tempFile)) {
                    fs.promises.unlink(tempFile).catch(() => {})
                    this.tempFiles = this.tempFiles.filter(f => f !== tempFile)
                }
                return null // Signal to use fallback
            }

            try {
                const downloaded = await this.downloadToFile(url, tempFile)
                if (downloaded) {
                    return tempFile
                }
            } catch (err) {
                if (url === urls[urls.length - 1]) {
                    // Clean up temp file on final error
                    if (this.tempFiles.includes(tempFile)) {
                        fs.promises.unlink(tempFile).catch(() => {})
                        this.tempFiles = this.tempFiles.filter(f => f !== tempFile)
                    }
                    throw err
                }
                // Try next URL
            }
        }

        // Clean up temp file if we get here
        if (this.tempFiles.includes(tempFile)) {
            fs.promises.unlink(tempFile).catch(() => {})
            this.tempFiles = this.tempFiles.filter(f => f !== tempFile)
        }
        throw new Error('Failed to download from all URLs')
    }

    /**
     * Download a URL to a file
     */
    downloadToFile(url, tempFile) {
        return new Promise((resolve, reject) => {
            if (url.match(new RegExp('^//[^/]+\\.'))) {
                url = 'http:' + url
            }
            if (!url.match(new RegExp('^https?:'))) {
                reject(new Error('Invalid URL format'))
                return
            }

            const opts = {
                url: url,
                followRedirect: true,
                keepalive: false,
                retries: 3,
                headers: { 'accept-charset': 'utf-8, *;q=0.1' },
                encoding: 'utf8',
                timeout: this.timeout,
                maxContentLength: 200 * (1024 * 1024), // 200Mb
            }

            this.stream = new Download(opts)
            let finishTimeout = null // Declare in outer scope
            let writeStream = null
            let sniffedHtml = false
            
            this.stream.on('redirect', (url, headers) => this.parseHeadersMeta(headers))
            this.stream.on('response', async (statusCode, headers) => {
                this.parseHeadersMeta(headers)
                if (statusCode >= 200 && statusCode < 300) {
                    if (DownloadSafety.isHtmlContentType(headers)) {
                        this.stream.destroy()
                        reject(new Error(`Rejected suspicious HTML response: ${DownloadSafety.getContentType(headers)}`))
                        return
                    }
                    if (this.stream.totalContentLength) {
                        this.contentLength = this.stream.totalContentLength
                    }
                    if (this.stream.totalContentLength > 0 && (this.stream.totalContentLength == this.updateMeta.contentLength)) {
                        this.stream.destroy()
                        // Clean up temp file if no update needed
                        fs.promises.unlink(tempFile).catch(() => {})
                        this.tempFiles = this.tempFiles.filter(f => f !== tempFile)
                        resolve(false) // no need to update
                        return
                    }

                    writeStream = fs.createWriteStream(tempFile)
                    this.writeStreams.push(writeStream)

                    writeStream.on('error', (err) => {
                        console.error('UpdateListIndex download writeStream error:', err)
                        reject(err)
                    })

                    // Handle backpressure - Download doesn't have pause/resume methods
                    // So we'll buffer chunks if writeStream can't accept them
                    let dataBuffer = []
                    let isDraining = false
                    
                    const processBufferedData = () => {
                        isDraining = false
                        // Process buffered chunks
                        while (dataBuffer.length > 0 && !isDraining) {
                            const bufferedChunk = dataBuffer.shift()
                            const canWriteBuffered = writeStream.write(bufferedChunk)
                            if (!canWriteBuffered) {
                                isDraining = true
                                writeStream.once('drain', processBufferedData)
                                return
                            }
                        }
                    }
                    
                    const processData = (chunk) => {
                        if (isDraining) {
                            // Buffer chunks while draining
                            dataBuffer.push(chunk)
                            return
                        }

                        if (!sniffedHtml) {
                            sniffedHtml = true
                            const sample = typeof chunk === 'string' ? chunk : chunk.toString('utf8')
                            if (DownloadSafety.isHtmlBodySample(sample)) {
                                writeStream.destroy()
                                fs.promises.unlink(tempFile).catch(() => {})
                                this.tempFiles = this.tempFiles.filter(f => f !== tempFile)
                                reject(new Error('Rejected suspicious HTML body response'))
                                return
                            }
                        }
                        
                        const canWrite = writeStream.write(chunk)
                        if (!canWrite) {
                            // WriteStream is full, start buffering
                            isDraining = true
                            writeStream.once('drain', processBufferedData)
                        }
                    }
                    
                    this.stream.on('data', processData)

                    let streamEnded = false
                    let writeStreamFinished = false
                    
                    this.stream.once('end', () => {
                        streamEnded = true
                        writeStream.end()
                    })
                    
                    this.stream.on('error', (err) => {
                        writeStream.destroy()
                        reject(err)
                    })

                    let bytesWritten = 0
                    writeStream.on('drain', () => {
                        // Track when backpressure is released
                    })
                    
                    // Track bytes written
                    const originalWrite = writeStream.write.bind(writeStream)
                    writeStream.write = function(chunk, encoding, callback) {
                        bytesWritten += chunk ? chunk.length : 0
                        return originalWrite(chunk, encoding, callback)
                    }
                    
                    // CRITICAL: Wait for writeStream to finish completely before resolving
                    // This ensures the file is fully written before parseFromFile starts reading
                    writeStream.once('finish', () => {
                        writeStreamFinished = true
                        if (this.debug) {
                            console.log(`[UpdateListIndex] WriteStream finished. Bytes written: ${bytesWritten}`)
                        }
                        // Verify file was actually written
                        fs.promises.stat(tempFile).then(stats => {
                            if (this.debug) {
                                console.log(`[UpdateListIndex] File stats after write: size=${stats.size} bytes`)
                            }
                            if (stats.size === 0) {
                                console.error(`[UpdateListIndex] ERROR: Downloaded file is empty! Bytes written: ${bytesWritten}`)
                                reject(new Error('Downloaded file is empty'))
                            } else {
                                // Give a small delay to ensure file system has flushed
                                setTimeout(() => {
                                    if (this.debug) {
                                        console.log(`[UpdateListIndex] Download completed successfully: ${tempFile} (${stats.size} bytes)`)
                                    }
                                    resolve(true)
                                }, 100)
                            }
                        }).catch(err => {
                            console.error(`[UpdateListIndex] Failed to verify downloaded file:`, err)
                            reject(new Error('Failed to verify downloaded file: ' + err.message))
                        })
                    })
                    
                    // Add timeout to prevent hanging if stream never finishes
                    finishTimeout = setTimeout(() => {
                        if (!writeStreamFinished) {
                            console.warn(`[UpdateListIndex] WriteStream finish timeout after 30s. Bytes written: ${bytesWritten}`)
                            fs.promises.stat(tempFile).then(stats => {
                                if (stats.size > 0) {
                                    if (this.debug) {
                                        console.log(`[UpdateListIndex] File has content (${stats.size} bytes), resolving despite timeout`)
                                    }
                                    writeStreamFinished = true
                                    resolve(true)
                                } else {
                                    reject(new Error('Download timeout - file is empty'))
                                }
                            }).catch(() => {
                                reject(new Error('Download timeout - file verification failed'))
                            })
                        }
                    }, 30000) // 30 second timeout
                    
                    writeStream.once('finish', () => {
                        clearTimeout(finishTimeout)
                    })
                    
                    // Also handle error case
                    writeStream.once('error', (err) => {
                        clearTimeout(finishTimeout)
                        reject(err)
                    })

                    this.stream.on('error', (err) => {
                        writeStream.destroy()
                        reject(err)
                    })
                } else {
                    reject(new Error(`HTTP ${statusCode}`))
                }
            })

            this.stream.on('error', (err) => {
                if (finishTimeout) clearTimeout(finishTimeout)
                if (writeStream) {
                    writeStream.destroy()
                }
                // Clean up empty file on error
                fs.promises.unlink(tempFile).catch(() => {})
                this.tempFiles = this.tempFiles.filter(f => f !== tempFile)
                reject(err)
            })
            
            // Start the download stream
            this.stream.start()
        })
    }

    /**
     * Parse from a downloaded file
     */
    async parseFromFile(tempFilePath) {
        if (!tempFilePath || !await fs.promises.access(tempFilePath).then(() => true).catch(() => false)) {
            throw new Error('Temp file not found: ' + tempFilePath)
        }
        
        // Verify file size before parsing
        const stats = await fs.promises.stat(tempFilePath).catch(() => null);
        if (!stats) {
            throw new Error('Temp file stats not available: ' + tempFilePath)
        }
        
        if (stats.size === 0) {
            throw new Error('Temp file is empty: ' + tempFilePath)
        }
        
        // Only log file info in debug mode
        if (this.debug) {
            console.log(`[UpdateListIndex] Parsing file: ${tempFilePath}, size: ${stats.size} bytes`);
        }

        await fs.promises.mkdir(dirname(this.file), { recursive: true }).catch(err => console.error(err))

        const targetFile = this.file
        const targetIndexFile = this.indexFile
        const targetMetaFile = this.metaFile
        const targetMetaIndexFile = this.metaFile.replace(/\.jdb$/i, '.idx.jdb')

        const workingFile = targetFile.replace(/\.jdb$/i, '.updating.jdb')
        const workingIndexFile = workingFile.replace(/\.jdb$/i, '.idx.jdb')
        const workingMetaFile = targetMetaFile.replace(/\.jdb$/i, '.updating.jdb')
        const workingMetaIndexFile = workingMetaFile.replace(/\.jdb$/i, '.idx.jdb')

        const exists = async path => {
            if (!path) return false
            try {
                await fs.promises.access(path)
                return true
            } catch {
                return false
            }
        }

        const removeIfExists = async path => {
            if (!path) return
            await fs.promises.unlink(path).catch(() => { })
        }

        const cleanupArtifacts = async () => {
            await Promise.all([
                removeIfExists(workingFile),
                removeIfExists(workingIndexFile),
                removeIfExists(workingMetaFile),
                removeIfExists(workingMetaIndexFile)
            ])
        }

        const replaceTargetWithWorking = async (workingPath, targetPath) => {
            if (!(await exists(workingPath))) {
                return
            }

            const backupPath = `${targetPath}.backup`
            const targetExists = await exists(targetPath)

            if (await exists(backupPath)) {
                await removeIfExists(backupPath)
            }

            if (targetExists) {
                await fs.promises.rename(targetPath, backupPath)
            }

            try {
                await fs.promises.rename(workingPath, targetPath)
                await removeIfExists(backupPath)
            } catch (renameErr) {
                if (targetExists) {
                    await fs.promises.rename(backupPath, targetPath).catch(() => { })
                }
                throw renameErr
            }
        }

        await Promise.all([
            removeIfExists(workingFile),
            removeIfExists(workingIndexFile),
            removeIfExists(workingMetaFile),
            removeIfExists(workingMetaIndexFile)
        ])

        const db = new Database(workingFile, {...dbConfig, clear: true, create: true})
        const metaFilename = this.metaFile.split('/').pop().split('\\').pop()
        const metaKey = storage.unresolve(metaFilename)
        const metaHold = storage.hold(metaKey)

        const mdb = new Database(workingMetaFile, {
            clear: false,
            create: true,
            allowIndexRebuild: true,
            integrityCheck: 'none',
            indexedQueryMode: 'permissive',
            fields: {
                name: 'string',
                value: 'string'
            },
            indexes: ['name']
        })

        await Promise.all([
            db.init(), mdb.init()
        ])

        this._index = { meta: {}, gids: {}, groupsTypes: {}, length: 0 }

        let err
        try {
            // Parse from file
            if (this.debug) {
                console.log(`[UpdateListIndex] Connecting to file: ${tempFilePath}`);
            }
            const ret = await this.connect(tempFilePath).catch(e => {
                console.error(`[UpdateListIndex] Connect error for ${tempFilePath}:`, e);
                err = e;
                return null;
            });
            if (!err && ret) {
                if (this.debug) {
                    console.log(`[UpdateListIndex] Starting parse for file: ${tempFilePath}`);
                }
                if (!ret.stream) {
                    console.error(`[UpdateListIndex] ERROR: No stream in connect result!`);
                    err = new Error('No stream returned from connect');
                } else if (!ret.url) {
                    console.error(`[UpdateListIndex] ERROR: No URL in connect result!`);
                    err = new Error('No URL returned from connect');
                } else {
                    await this.parse(ret, db).catch(e => {
                        console.error(`[UpdateListIndex] Parse error for ${tempFilePath}:`, e);
                        err = e;
                    });
                    if (this.debug) {
                        console.log(`[UpdateListIndex] Parse completed for file: ${tempFilePath}, foundStreams: ${this.foundStreams}`);
                    }
                }
            } else {
                console.error(`[UpdateListIndex] Failed to connect to file: ${tempFilePath}, err:`, err);
            }

            // Process playlists if any
            let i = 0
            while (i < this.playlists.length) {
                const playlist = this.playlists[i]
                i++
                const ret = await this.connect(playlist.url).catch(e => err = e)
                if (!err && ret) {
                    await this.parse(ret, db, playlist).catch(err => console.error(err))
                }
            }

            await this.flushInsertSession(db)

            if (this.indexMeta && Object.keys(this.indexMeta).length > 0) {
                this._index.meta = { ...this._index.meta, ...this.indexMeta }
            }

            const detectedCountriesTop = this.computeDetectedCountriesTop(8)
            if (detectedCountriesTop.length) {
                this._index.meta.detectedCountries = detectedCountriesTop.map(c => c.code)
                this._index.meta.detectedCountry = detectedCountriesTop[0].code
                this._index.meta.detectedCountriesStats = detectedCountriesTop
            }

            this._index.groupsTypes = this.sniffGroupsTypes(this.groups)

            // CRITICAL: Wait for all pending write operations before closing
            // This ensures data is persisted to disk
            try {
                if (db && !db.destroyed && typeof db.waitForOperations === 'function') {
                    await db.waitForOperations()
                }
                if (mdb && !mdb.destroyed && typeof mdb.waitForOperations === 'function') {
                    await mdb.waitForOperations()
                }
            } catch (waitErr) {
                console.error('Database wait operations error:', waitErr)
                // Continue - attempt close anyway
            }

            try {
                await db.close()
            } catch (saveErr) {
                console.error('Database save/close error:', saveErr)
                err = saveErr
            }

            try {
                await mdb.close()
            } catch (metaCloseErr) {
                console.error('Metadata save/close error:', metaCloseErr)
                if (!err) {
                    err = metaCloseErr
                }
            }

            if (this._index.length > 0) {
                try {
                    const existingMeta = await getListMeta(this.url)
                    const indexData = {
                        lastUpdate: Date.now(),
                        updateCount: (existingMeta.updateCount || 0) + 1
                    }

                    // Always write full structure so .list-meta.jdb has meta/gids/groupsTypes (main process reads them)
                    indexData.meta = { ...(existingMeta.meta || {}), ...(this._index.meta || {}) }
                    indexData.gids = this._index.gids && Object.keys(this._index.gids).length > 0 ? this._index.gids : (existingMeta.gids || {})
                    indexData.groupsTypes = this._index.groupsTypes != null ? this._index.groupsTypes : (existingMeta.groupsTypes || { live: [], vod: [], series: [] })
                    indexData.length = this._index.length

                    const detectedCountries = Array.isArray(this._index.meta?.detectedCountries) ? this._index.meta.detectedCountries : []
                    const detectedCountriesStats = Array.isArray(this._index.meta?.detectedCountriesStats) ? this._index.meta.detectedCountriesStats : []
                    if (detectedCountries.length) {
                        indexData.detectedCountries = detectedCountries
                        indexData.detectedCountry = this._index.meta.detectedCountry
                        indexData.detectedCountriesStats = detectedCountriesStats
                    }

                    const saveSuccess = await setListMeta(this.url, indexData)
                    if (!saveSuccess) {
                        console.error(`❌ Metadata database save failed for ${this.url}`)
                        err = new Error('Meta file save failed')
                    }
                    await writeMetaToFile(this.url, indexData).catch(e => console.error('Write .meta.jdb failed:', this.url, e?.message || e))
                } catch (metaErr) {
                    console.error('Metadata database error:', metaErr)
                    err = metaErr
                }
            }

            try {
                await replaceTargetWithWorking(workingFile, targetFile)
                await replaceTargetWithWorking(workingIndexFile, targetIndexFile)
                await replaceTargetWithWorking(workingMetaFile, targetMetaFile)
                await replaceTargetWithWorking(workingMetaIndexFile, targetMetaIndexFile)
            } catch (swapErr) {
                console.error('Database swap error:', swapErr)
                err = swapErr
                throw swapErr
            }

            await this.registerStorageArtifacts(LIST_STORAGE_TTL)

            if (this.invalidEntriesCount > 0) {
                console.error('List ' + this.url + ' has ' + this.invalidEntriesCount + ' invalid entries')
            }
            if (!this.foundStreams && err) {
                console.error('UpdateListIndex: No streams found and error occurred:', err)
                throw err
            }

            this.reset()

            return true
        } finally {
            await cleanupArtifacts()
            if (metaHold) {
                try {
                    metaHold.release()
                } catch (releaseErr) {
                    console.error('Failed to release meta hold:', releaseErr)
                }
            }
        }
    }

    async start() {
        //console.log(`DEBUG: start() called for URL: ${this.directURL}`)
        let alturl, urls = [this.directURL], fmt = config.get('live-stream-fmt')
        if (['hls', 'mpegts'].includes(fmt)) {
            if (!this.mi) {
                this.mi = new MediaURLInfo()
            }
            alturl = this.mi.setURLFmt(this.directURL, fmt)
            if (alturl) {
                urls.unshift(alturl)
            }
        }
        await fs.promises.mkdir(dirname(this.file), { recursive: true }).catch(err => console.error(err))

        const targetFile = this.file
        const targetIndexFile = this.indexFile
        const targetMetaFile = this.metaFile
        const targetMetaIndexFile = this.metaFile.replace(/\.jdb$/i, '.idx.jdb')

        const workingFile = targetFile.replace(/\.jdb$/i, '.updating.jdb')
        const workingIndexFile = workingFile.replace(/\.jdb$/i, '.idx.jdb')
        const workingMetaFile = targetMetaFile.replace(/\.jdb$/i, '.updating.jdb')
        const workingMetaIndexFile = workingMetaFile.replace(/\.jdb$/i, '.idx.jdb')

        const exists = async path => {
            if (!path) return false
            try {
                await fs.promises.access(path)
                return true
            } catch {
                return false
            }
        }

        const removeIfExists = async path => {
            if (!path) return
            await fs.promises.unlink(path).catch(() => { })
        }

        const cleanupArtifacts = async () => {
            await Promise.all([
                removeIfExists(workingFile),
                removeIfExists(workingIndexFile),
                removeIfExists(workingMetaFile),
                removeIfExists(workingMetaIndexFile)
            ])
        }

        const replaceTargetWithWorking = async (workingPath, targetPath) => {
            if (!(await exists(workingPath))) {
                return
            }

            const backupPath = `${targetPath}.backup`
            const targetExists = await exists(targetPath)

            if (await exists(backupPath)) {
                await removeIfExists(backupPath)
            }

            if (targetExists) {
                await fs.promises.rename(targetPath, backupPath)
            }

            try {
                await fs.promises.rename(workingPath, targetPath)
                await removeIfExists(backupPath)
            } catch (renameErr) {
                if (targetExists) {
                    await fs.promises.rename(backupPath, targetPath).catch(() => { })
                }
                throw renameErr
            }
        }

        await Promise.all([
            removeIfExists(workingFile),
            removeIfExists(workingIndexFile),
            removeIfExists(workingMetaFile),
            removeIfExists(workingMetaIndexFile)
        ])

        const db = new Database(workingFile, {...dbConfig, clear: true, create: true});
        // FIXED: Do NOT delete existing metadata file - preserve existing data
        // The metadata database will be updated with new data, preserving existing entries


        // Create storage hold for meta file to prevent cleanup during indexing
        const metaFilename = this.metaFile.split('/').pop().split('\\').pop();
        const metaKey = storage.unresolve(metaFilename);
        const metaHold = storage.hold(metaKey);

        const mdb = new Database(workingMetaFile, {
            clear: false, // Do not clear existing meta data
            create: true,
            allowIndexRebuild: true,
            integrityCheck: 'none', // Disable integrity check for performance
            indexedQueryMode: 'permissive', //permissive mode to allow queries on non-indexed fields
            fields: {
                name: 'string',
                value: 'string'
            },
            indexes: ['name'] // Index by name for key-value lookups
        })

        await Promise.all([
            db.init(), mdb.init()
        ])

        // console.log(`DEBUG: Database initialized successfully - db.destroyed = ${db.destroyed}, mdb.destroyed = ${mdb.destroyed}`)

        // initialize in-memory index container
        this._index = { meta: {}, gids: {}, groupsTypes: {}, length: 0 }

        let err
        try {
            for (let url of urls) {
                // console.log(`DEBUG: Processing URL: ${url}`)
                const hasCredentials = url.includes('@')
                if (hasCredentials && url.includes('#xtream')) {
                    // console.log(`DEBUG: Using xparse for URL: ${url}`)
                    await this.xparse(url, db).catch(e => err = e)
                    if (this.foundStreams) break
                } else if (hasCredentials && url.includes('#mag')) {
                    // console.log(`DEBUG: Using mparse for URL: ${url}`)
                    await this.mparse(url, db).catch(e => err = e)
                    if (this.foundStreams) break
                } else {
                    // console.log(`DEBUG: Using connect+parse for URL: ${url}`)
                    const ret = await this.connect(url).catch(e => err = e)
                    if (!err && ret) {
                        // console.log(`DEBUG: Connected successfully, parsing...`)
                        await this.parse(ret, db).catch(e => err = e)
                        if (this.foundStreams) break
                    } else {
                        // console.log(`DEBUG: Connection failed for URL: ${url}, error: ${err}`)
                    }
                }
            }

            // Clear cache after main URL processing
            this.lastCachedEntry = null
            this.lastURL = null

            let i = 0
            while (i < this.playlists.length) { // new playlists can be live added in the loop connect() call
                let err
                const playlist = this.playlists[i]
                i++
                const ret = await this.connect(playlist.url).catch(e => err = e)
                if (!err && ret) {
                    await this.parse(ret, db, playlist).catch(err => console.error(err))
                    // Clear cache after each playlist
                    this.lastCachedEntry = null
                    this.lastURL = null
                }
            }


            // Commit any remaining entries (< batchSize) to disk
            // InsertSession.commit() already waits for all auto-flushes
            await this.flushInsertSession(db)

            // Fill index metadata and persist to metadata DB
            // Merge with existing metadata to preserve important data (no overwrite)
            if (this.indexMeta && Object.keys(this.indexMeta).length > 0) {
                this._index.meta = { ...this._index.meta, ...this.indexMeta };
            }

            const detectedCountriesTop = this.computeDetectedCountriesTop(8)
            if (detectedCountriesTop.length) {
                this._index.meta.detectedCountries = detectedCountriesTop.map(c => c.code)
                this._index.meta.detectedCountry = detectedCountriesTop[0].code
                this._index.meta.detectedCountriesStats = detectedCountriesTop
            }

            this._index.groupsTypes = this.sniffGroupsTypes(this.groups)

            // CRITICAL: Wait for all pending write operations before closing
            // This ensures data is persisted to disk
            try {
                if (db && !db.destroyed && typeof db.waitForOperations === 'function') {
                    await db.waitForOperations()
                }
                if (mdb && !mdb.destroyed && typeof mdb.waitForOperations === 'function') {
                    await mdb.waitForOperations()
                }
            } catch (waitErr) {
                console.error('Database wait operations error:', waitErr)
                // Continue - attempt close anyway
            }

            // Save and close main database
            try {
                await db.close()
            } catch (saveErr) {
                console.error('Database save/close error:', saveErr)
                err = saveErr
            }

            try {
                await mdb.close()
            } catch (metaCloseErr) {
                console.error('Metadata save/close error:', metaCloseErr)
                if (!err) {
                    err = metaCloseErr
                }
            }

            // Only save meta file if we actually found unique streams and have valid index data
            if (this._index.length > 0) {
                try {
                    // Get existing metadata to preserve important data
                    const existingMeta = await getListMeta(this.url);

                    // Always write full structure so .list-meta.jdb has meta/gids/groupsTypes (main process reads them)
                    const indexData = {
                        lastUpdate: Date.now(),
                        updateCount: (existingMeta.updateCount || 0) + 1
                    };
                    indexData.meta = { ...(existingMeta.meta || {}), ...(this._index.meta || {}) };
                    indexData.gids = this._index.gids && Object.keys(this._index.gids).length > 0 ? this._index.gids : (existingMeta.gids || {});
                    indexData.groupsTypes = this._index.groupsTypes != null ? this._index.groupsTypes : (existingMeta.groupsTypes || { live: [], vod: [], series: [] });
                    indexData.length = this._index.length;

                    const detectedCountries = Array.isArray(this._index.meta?.detectedCountries) ? this._index.meta.detectedCountries : []
                    const detectedCountriesStats = Array.isArray(this._index.meta?.detectedCountriesStats) ? this._index.meta.detectedCountriesStats : []
                    if (detectedCountries.length) {
                        indexData.detectedCountries = detectedCountries
                        indexData.detectedCountry = this._index.meta.detectedCountry
                        indexData.detectedCountriesStats = detectedCountriesStats
                    }

                    // Save with key-value structure (preserves existing data automatically)
                    const saveSuccess = await setListMeta(this.url, indexData);

                    if (!saveSuccess) {
                        console.error(`❌ Metadata database save failed for ${this.url}`);
                        err = new Error('Meta file save failed');
                    }
                    await writeMetaToFile(this.url, indexData).catch(e => console.error('Write .meta.jdb failed:', this.url, e?.message || e));
                } catch (metaErr) {
                    console.error('Metadata database error:', metaErr)
                    err = metaErr
                }
            } else {
                // FIXED: Do NOT delete existing meta file - preserve existing data even if no new streams found
                // The existing metadata might contain important information from previous updates
            }

            try {
                await replaceTargetWithWorking(workingFile, targetFile)
                await replaceTargetWithWorking(workingIndexFile, targetIndexFile)
                await replaceTargetWithWorking(workingMetaFile, targetMetaFile)
                await replaceTargetWithWorking(workingMetaIndexFile, targetMetaIndexFile)
            } catch (swapErr) {
                console.error('Database swap error:', swapErr)
                err = swapErr
                throw swapErr
            }

            // Log debug information to a relative path instead of hardcoded absolute path
            const logPath = joinPath(dirname(this.file), 'debug.log')
            const dataFileSize = fs.statSync(targetFile).size
            await fs.promises.appendFile(logPath, `${new Date().toISOString()} - ${db.length} - ${dataFileSize} - ${this.insertPromises.length} - ${err || 'success'}\n`).catch(() => { })
            await fs.promises.appendFile(logPath, JSON.stringify(db.indexManager.index) + '\n').catch(() => { })

            await this.registerStorageArtifacts(LIST_STORAGE_TTL)

            // NOTE: Do NOT destroy databases here!
            // Both main and metadata databases are persistent and used by ListIndex in main process
            // The database instances will be garbage collected automatically

            // Database references will be cleared by garbage collection
            // Note: db and mdb are const variables, cannot be reassigned

            // No need to move files since we're using the real files directly
            if (this.invalidEntriesCount > 0) {
                console.error('List ' + this.url + ' has ' + this.invalidEntriesCount + ' invalid entries')
            }
            if (!this.foundStreams && err) {
                console.error('UpdateListIndex: No streams found and error occurred:', err)
                throw err
            }

            // Reset after all operations are complete to prepare for next use
            this.reset()

            return true
        } finally {
            await cleanupArtifacts()
            if (metaHold) {
                try {
                    metaHold.release()
                } catch (releaseErr) {
                    console.error('Failed to release meta hold:', releaseErr)
                }
            }
        }
    }
    async xparse(url, db) {
        let err
        const xtr = new Xtr(url)
        xtr.on('progress', p => this.emit('progress', p, this.url))
        xtr.on('meta', meta => {
            Object.assign(this.indexMeta, meta)
        })
        xtr.on('entry', async entry => {
            await this.insert(entry, db)
        })

        // Add timeout wrapper for xparse operations
        const timeoutPromise = new Promise((_, reject) => {
            setTimeout(() => reject(new Error('XPARSE Timeout at traceback')), 120000) // 2 minutes timeout
        })

        try {
            await Promise.race([xtr.run(), timeoutPromise])
        } catch (e) {
            err = e
        }

        xtr.destroy()
        if (err) {
            console.error('XPARSE ' + err)
            throw err
        }
    }
    async mparse(url, db) {
        let err
        const mag = new Mag(url)
        mag.on('progress', p => this.emit('progress', p, this.url))
        mag.on('meta', meta => {
            Object.assign(this.indexMeta, meta)
        })
        mag.on('entry', async entry => {
            await this.insert(entry, db)
        })

        // Add timeout wrapper for mparse operations
        try {
            await mag.run()
        } catch (e) {
            err = e
            // If we got some streams before the error, log warning instead of throwing
            if (this.foundStreams > 0 && String(err).includes('JSON')) {
                console.warn('MPARSE: JSON parsing error occurred but some streams were already processed:', err.message || err)
                // Don't throw - allow partial success
                err = null
            }
        }

        mag.destroy()
        if (err) {
            // Only throw if no streams were found or it's a critical error
            if (this.foundStreams === 0 || !String(err).includes('JSON')) {
                console.error('MPARSE Error:', err)
                throw err
            } else {
                // Log warning but don't throw for JSON parsing errors if we got some data
                console.warn('MPARSE: JSON parsing error but some streams processed:', err.message || err)
            }
        }
    }
    async parse(opts, db, playlist) {
        let resolved
        const endListener = () => {
            this.parser && this.parser.end()
        }
        this.parser && this.parser.destroy()
        if (this.debug) {
            console.log(`[UpdateListIndex] Creating parser with opts: stream=${!!opts.stream}, url=${opts.url || 'missing'}, tempFile=${opts.tempFile || 'none'}`)
        }
        this.parser = new Parser({ ...opts, debug: this.debug })
        this.parser.on('meta', meta => Object.assign(this.indexMeta, meta))
        this.parser.on('playlist', e => this.playlists.push(e))
        this.parser.on('progress', readen => {
            const pp = this.contentLength / 100
            let progress = Math.max(0, parseInt(readen / pp))
            if (progress > 99) progress = 99
            if (this.playlists.length > 0) {
                let i = -1
                this.playlists.some((p, n) => {
                    if (!playlist || playlist.url == p.url) {
                        i = n
                        return true
                    }
                })
                if (i != -1) {
                    const lr = 100 / (this.playlists.length + 1)
                    const pr = (i * lr) + (progress * (lr / 100))
                    progress = parseInt(pr)
                }
            }
            if (progress != this.lastProgress) {
                this.lastProgress = progress
                this.emit('progress', progress, this.url)
            }
        })
        // Use opts.stream if available (from parseFromFile), otherwise use this.stream
        const stream = opts.stream || this.stream
        if (stream) {
            stream.once('end', endListener)
        }

        // Use walk() method for memory-efficient processing
        const destroyListener = () => {
            if (!resolved) {
                resolved = true
                throw new Error('destroyed')
            }
        }
        this.once('destroy', destroyListener)

        try {
            // Process entries using walk() method
            let processedCount = 0
            let itemCount = 0
            for await (const item of this.parser.walk()) {
                itemCount++
                // Check if instance was destroyed, cancelled, or inserts disabled during processing
                if (resolved || this.destroyed || this.cancelled || this.insertsDisabled) {
                    console.warn(`⚠️ Parsing interrupted. Processed ${processedCount} entries before interruption.`)
                    break;
                }

                if (item.type === 'entry') {
                    let entry = item.entry;
                    if (playlist) {
                        // FIXED: Prevent recursive concatenation by checking if the group path is already complete
                        // Only join if the entry.group doesn't already contain the playlist path
                        if (!entry.group) {
                            // If entry has no group, use the playlist group
                            entry.group = joinPath(playlist.group, playlist.name)
                        } else if (!entry.group.startsWith(playlist.group)) {

                            entry.group = joinPath(joinPath(playlist.group, playlist.name), entry.group)
                        }
                        // If entry.group already starts with playlist.group or is too deep, don't modify it
                    }
                    await this.insert(entry, db)
                    processedCount++
                }
            }

            if (!resolved) {
                resolved = true
                
                // Verify if all entries were processed before closing
                if (this.cancelled || this.insertsDisabled) {
                    console.warn(`⚠️ WARNING: Processing was cancelled/disabled. Processed ${processedCount} entries but may have missed some.`)
                } else {
                    if (this.debug) {
                        console.log(`✅ Parsing completed. Processed ${processedCount} entries (${itemCount} total items) from ${opts.tempFile || opts.url || 'stream'}`)
                    }
                    if (processedCount === 0 && itemCount > 0) {
                        console.warn(`⚠️ WARNING: Parser found ${itemCount} items but none were entries. This may indicate a parsing issue.`)
                    }
                }
                
                // CRITICAL: Wait for write streams to finish if using temp files
                // The parser.walk() may finish when readStream reaches EOF, but writeStream
                // might still be writing more data. We need to ensure writeStream finishes
                // before considering parsing complete.
                // NOTE: When parsing from a file already downloaded (parseFromFile), there are no writeStreams,
                // so we don't need to wait. The file is already complete.
                if (opts.tempFile && this.writeStreams.length > 0) {
                    try {
                        await Promise.race([
                            Promise.all(
                                this.writeStreams.map(ws => 
                                    new Promise((resolve) => {
                                        if (ws.destroyed || ws.writableEnded) {
                                            resolve()
                                        } else {
                                            let resolved = false
                                            const doResolve = () => {
                                                if (!resolved) {
                                                    resolved = true
                                                    resolve()
                                                }
                                            }
                                            ws.once('finish', doResolve)
                                            ws.once('error', doResolve) // Resolve on error too
                                        }
                                    })
                                )
                            ),
                            // Timeout after 30 seconds - if writeStream hasn't finished by now, continue anyway
                            // This prevents hanging on slow downloads
                            new Promise(resolve => setTimeout(resolve, 30000))
                        ])
                        
                        // After writeStream finishes, close the readStream to signal EOF
                        // This ensures parser.walk() can finish properly
                        // The persistent Reader will have already read all available data
                        for (const rs of this.readStreams) {
                            if (rs && !rs.isClosed && typeof rs.close === 'function') {
                                rs.close()
                            }
                        }
                    } catch (waitErr) {
                        console.warn('Error waiting for write streams to finish:', waitErr)
                        // Continue anyway - parsing may have already completed
                    }
                } else if (opts.tempFile && this.writeStreams.length === 0) {
                    // File already downloaded - ensure readStream has finished reading
                    // Wait a bit to ensure all data is read from the file
                    await new Promise(resolve => setTimeout(resolve, 100))
                    
                    // Close any persistent readers if they exist
                    for (const rs of this.readStreams) {
                        if (rs && !rs.isClosed && typeof rs.close === 'function') {
                            rs.close()
                        }
                    }
                }
                
                if (this.foundStreams) {
                    if (this.contentLength == this.defaultContentLength && this.stream && this.stream.received) {
                        this.contentLength = this.stream.received
                    }
                    this.parser.destroy()
                    this.parser.removeAllListeners()
                    this.stream && this.stream.destroy()
                    if (this.stream) {
                        this.stream.removeAllListeners()
                        this.stream = null
                    }
                    this.parser = null
                    return true
                } else {
                    this.parser.destroy()
                    this.parser.removeAllListeners()
                    this.stream && this.stream.destroy()
                    if (this.stream) {
                        this.stream.removeAllListeners()
                        this.stream = null
                    }
                    this.parser = null
                    throw new Error('empty list')
                }
            }
        } catch (err) {
            if (!resolved) {
                resolved = true
                throw err
            }
        } finally {
            // Clean up event listeners to prevent memory leaks
            if (this.stream) {
                this.stream.removeListener('end', endListener)
            }
            this.removeListener('destroy', destroyListener)
        }
    }
    sniffGroupsTypes(groups) {
        const ret = { live: [], vod: [], series: [] }
        // Strategy (aligned with isGroupSeried): 1) content heuristic (isGroupSeried), 2) typeCounts (per-entry + group name in insertEntry), 3) group name fallback, 4) default live

        Object.keys(groups).forEach(g => {
            const groupData = groups[g] || {}
            const names = Array.isArray(groupData.names)
                ? groupData.names
                : Array.isArray(groupData)
                    ? groupData.map(entry => (typeof entry === 'string' ? entry : entry?.name)).filter(Boolean)
                    : []

            const iconCandidate = typeof groupData.icon === 'string' && groupData.icon.length > 12 ? groupData.icon : null
            const isSeried = this.isGroupSeried(names)

            let type = null
            if (isSeried) {
                type = 'series'
            } else if (groupData.typeCounts && typeof groupData.typeCounts === 'object') {
                const tc = groupData.typeCounts
                const liveCount = typeof tc.live === 'number' ? tc.live : 0
                const vodCount = typeof tc.vod === 'number' ? tc.vod : 0
                const seriesCount = typeof tc.series === 'number' ? tc.series : 0
                const ranked = [
                    { key: 'live', count: liveCount },
                    { key: 'vod', count: vodCount },
                    { key: 'series', count: seriesCount }
                ]
                const winner = ranked.reduce((acc, curr) => (curr.count > acc.count ? curr : acc), { key: null, count: 0 })
                if (winner.count > 0) {
                    type = winner.key
                    // Tie-breaker: when live wins by small margin, prefer group name if it suggests vod/series
                    const groupType = inferTypeFromGroupName(g)
                    if (type === 'live' && (groupType === 'vod' || groupType === 'series')) {
                        const otherCount = groupType === 'vod' ? vodCount : seriesCount
                        if (otherCount > 0 && (liveCount - otherCount <= 2 || otherCount >= liveCount * 0.25)) {
                            type = groupType
                        }
                    }
                }
            }

            // Fallback: use group name (same strategy as insertEntry) when we would default to live
            if ((!type || type === 'live') && names.length > 0) {
                const groupType = inferTypeFromGroupName(g)
                if (groupType === 'vod' || groupType === 'series') type = groupType
            }
            // URL-extension heuristic (isGroupVOD): if most sampled URLs are file extensions (mp4/mkv), treat as VOD
            const extCounts = groupData.extensionCounts
            if ((!type || type === 'live') && extCounts && extCounts.sampled >= 3 && extCounts.vodLike > extCounts.liveLike) {
                type = 'vod'
            }
            if (!type && names.length > 0) {
                type = 'live'
            }
            if (!type) {
                return
            }

            const groupParts = g.split('/').filter(part => part && part.trim() !== '')
            const cleanGroupName = groupParts.length > 0 ? groupParts[groupParts.length - 1] : g

            ret[type].push({
                name: cleanGroupName,
                icon: iconCandidate || undefined
            })
        })

        return ret
    }
    computeDetectedCountriesTop(limit = 8) {
        const results = []
        const counts = this.countryStats.counts || {}
        const groupsMap = this.countryStats.groups || {}

        for (const [code, streams] of Object.entries(counts)) {
            if (!/^[A-Z]{2}$/.test(code) || streams <= 0) {
                continue
            }
            const groupsCount = groupsMap[code] ? groupsMap[code].size : 0
            // Sublinear stream weight + group diversity to reduce raw-volume bias.
            const score = Math.sqrt(streams) + (groupsCount * 0.6)
            results.push({ code, streams, groupsCount, score })
        }

        results.sort((a, b) => b.score - a.score || b.streams - a.streams || a.code.localeCompare(b.code))
        return results.slice(0, limit)
    }
    isGroupSeried(entries) {
        if (!Array.isArray(entries)) return false
        const names = entries
            .map(entry => (typeof entry === 'string' ? entry : entry?.name))
            .filter(name => typeof name === 'string' && name.trim() !== '')

        if (names.length < 5) return false
        const masks = {}
        const mask = n => n.replace(new RegExp('[0-9]+', 'g'), '*')
        names.forEach(name => {
            const m = mask(name)
            if (typeof (masks[m]) == 'undefined') masks[m] = 0
            masks[m]++
        })
        return Object.values(masks).some(n => n >= (names.length * 0.7))
    }
    mode(a) { // https://stackoverflow.com/a/65821663
        let obj = {}
        let maxNum
        let maxVal
        for (let v of a) {
            obj[v] = ++obj[v] || 1
            if (maxVal === undefined || obj[v] > maxVal) {
                maxNum = v
                maxVal = obj[v]
            }
        }
        return maxNum
    }
    reset() {
        // Clear large objects first to help GC
        if (this.groups && typeof this.groups === 'object') {
            Object.keys(this.groups).forEach(key => {
                const data = this.groups[key]
                if (data && typeof data === 'object') {
                    if (Array.isArray(data.names)) {
                        data.names.length = 0
                    } else if (Array.isArray(data)) {
                        data.length = 0
                    }
                    if (data.typeCounts && typeof data.typeCounts === 'object') {
                        Object.keys(data.typeCounts).forEach(type => {
                            data.typeCounts[type] = 0
                        })
                    }
                }
                delete this.groups[key]
            })
            this.groups = {}
        }

        // Clear Set completely
        // Clear URL cache for merging
        this.lastCachedEntry = null

        // Clear index object
        if (this._index && typeof this._index === 'object') {
            Object.keys(this._index).forEach(key => {
                if (this._index[key] && typeof this._index[key] === 'object') {
                    if (Array.isArray(this._index[key])) {
                        this._index[key].length = 0
                    } else {
                        Object.keys(this._index[key]).forEach(subKey => {
                            if (Array.isArray(this._index[key][subKey])) {
                                this._index[key][subKey].length = 0
                            }
                            delete this._index[key][subKey]
                        })
                    }
                }
                delete this._index[key]
            })
            this._index = { groups: {}, meta: {}, gids: {}, groupsTypes: {}, length: 0 }
        }

        // Clear playlists array
        if (this.playlists) {
            this.playlists.length = 0
            this.playlists = []
        }

        this.foundStreams = 0
        this.defaultContentLength = 62 * (1024 * 1024) // estimate it if we don't know
        this.contentLength = this.defaultContentLength // estimate it if we don't know
        this.invalidEntriesCount = 0
        this.cancelled = false
        this.insertsDisabled = false
        this.abortController = new AbortController()

        // OPTIMIZATION: Reset InsertSession
        this.insertSession = null
        this.lastCachedEntry = null
        this.lastURL = null
        this._lastCachedGroupKey = ''
        this._cachedGroupTerms = []

        this.countryStats = {
            total: 0,
            counts: {},
            groups: {}
        }
        
        // Clean up temp files and streams
        this.tempFiles = []
        this.writeStreams = []
        this.readStreams = []
    }
    async destroy() {
        if (!this.destroyed) {
            // Cancel all operations immediately
            this.cancelled = true
            this.insertsDisabled = true
            this.abortController.abort()

            // OPTIMIZATION: Clean up InsertSession if active (commit waits for all flushes)
            if (this.insertSession) {
                try {
                    await this.insertSession.commit()
                    this.insertSession = null
                } catch (err) {
                    console.error('🔍 UpdateListIndex: Error committing InsertSession during destroy:', err)
                    this.insertSession = null
                }
            }

            // Close all write streams
            for (const writeStream of this.writeStreams) {
                try {
                    if (writeStream && !writeStream.destroyed) {
                        writeStream.end()
                        writeStream.destroy()
                    }
                } catch (err) {
                    // Ignore errors during cleanup
                }
            }
            this.writeStreams = []
            
            // Close all read streams
            for (const readStream of this.readStreams) {
                try {
                    if (readStream && !readStream.destroyed) {
                        readStream.destroy()
                    }
                } catch (err) {
                    // Ignore errors during cleanup
                }
            }
            this.readStreams = []
            
            // Delete temporary files
            for (const tempFile of this.tempFiles) {
                try {
                    await fs.promises.unlink(tempFile).catch(() => {})
                } catch (err) {
                    // Ignore errors during cleanup
                }
            }
            this.tempFiles = []
            
            if (this.stream) {
                this.stream.destroy()
                this.stream = null
            }
            if (this.parser) {
                this.parser.destroy()
                delete this.parser
            }

            // Clear large objects to help garbage collection
            if (this._index && typeof this._index === 'object') {
                Object.keys(this._index).forEach(key => {
                    if (this._index[key] && typeof this._index[key] === 'object') {
                        if (Array.isArray(this._index[key])) {
                            this._index[key].length = 0
                        } else {
                            Object.keys(this._index[key]).forEach(subKey => {
                                if (Array.isArray(this._index[key][subKey])) {
                                    this._index[key][subKey].length = 0
                                }
                                delete this._index[key][subKey]
                            })
                        }
                    }
                    delete this._index[key]
                })
                this._index = null
            }

            if (this.groups && typeof this.groups === 'object') {
                Object.keys(this.groups).forEach(key => {
                    const data = this.groups[key]
                    if (data && typeof data === 'object') {
                        if (Array.isArray(data.names)) {
                            data.names.length = 0
                        } else if (Array.isArray(data)) {
                            data.length = 0
                        }
                        if (data.typeCounts && typeof data.typeCounts === 'object') {
                            Object.keys(data.typeCounts).forEach(type => {
                                data.typeCounts[type] = 0
                            })
                        }
                    }
                    delete this.groups[key]
                })
                this.groups = null
            }

            if (this.indexMeta && typeof this.indexMeta === 'object') {
                Object.keys(this.indexMeta).forEach(key => {
                    delete this.indexMeta[key]
                })
                this.indexMeta = null
            }

            if (this.playlists) {
                this.playlists.length = 0
                this.playlists = null
            }

            if (this.insertPromises) {
                this.insertPromises.length = 0
                this.insertPromises = null
            }

            // Clear all references to prevent memory leaks
            this.url = null
            this.file = null
            this.metaFile = null
            this.indexFile = null
            this.directURL = null
            this.master = null
            this.mi = null
            this.abortController = null

            this.destroyed = true
            this.emit('destroy')
            this.removeAllListeners()
            this._log = []
        }
    }
}

export default UpdateListIndex
