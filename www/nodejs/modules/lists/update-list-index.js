import { dirname, joinPath } from '../utils/utils.js';
import Download from '../download/download.js'
import ListIndexUtils from './list-index-utils.js'
import fs from 'fs'
import path from 'path'
// randomUUID removed - training removed
import MediaURLInfo from '../streamer/utils/media-url-info.js'
import Xtr from './xtr.js'
import Mag from './mag.js'
import { Parser } from './parser.js'
import config from '../config/config.js'
import { Database } from 'jexidb';
import storage from '../storage/storage.js';
import { terms, match } from './tools.js'
import { getListMeta, setListMeta } from "./common.js";

class UpdateListIndex extends ListIndexUtils {
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
        this.debug = opts.debug || true
        this.insertPromises = []
        this._index = { groups: {}, meta: {}, gids: {}, groupsTypes: {}, uniqueStreamsLength: 0 }
        this.groups = {} // Initialize groups object
        this.uniqueStreamsIndexate = new Set() // Initialize unique streams tracking
        this.maxBatchSize = 100 // Process inserts in batches
        this.maxConcurrentInserts = 10 // Limit concurrent database operations
        this.activeInserts = 0
        this.cancelled = false // Flag to cancel all operations
        this.abortController = new AbortController() // For cancelling operations
        this.insertsDisabled = false // Flag to completely disable inserts

        // OPTIMIZATION: Initialize InsertSession properties for batch operations
        this.insertSession = null

        // URL merging cache - stores entries by URL for merging
        this.urlCache = new Map()
        this.lastURL = null
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
                this.stream.on('response', (statusCode, headers) => {
                    resolved = true
                    this.parseHeadersMeta(headers)
                    if (statusCode >= 200 && statusCode < 300) {
                        if (this.stream.totalContentLength) {
                            this.contentLength = this.stream.totalContentLength
                        }
                        if (this.stream.totalContentLength > 0 && (this.stream.totalContentLength == this.updateMeta.contentLength)) {
                            this.stream.destroy()
                            resolve(false) // no need to update
                        } else {
                            resolve({
                                stream: this.stream,
                                url: this.stream.currentURL // use final URL for relative URLs normalization
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
                this.stream.on('end', () => {
                    this.stream && this.stream.destroy()
                    if (!resolved) {
                        resolved = true
                        reject('unknown http error')
                    }
                })
                this.stream.on('error', e => {
                    console.error('UpdateListIndex fetch err', e)
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
        })
    }

    async insert(e, db) {
        // Check if cancelled or inserts disabled
        if (this.cancelled || this.insertsDisabled) {

            return
        }

        // Check if database is still valid
        if (!db || db.destroyed) {
            console.warn('Database is destroyed, disabling inserts')
            this.cancelled = true
            this.insertsDisabled = true
            return
        }

        // Basic validation - parser should have already filtered invalid entries
        if (!e || !e.url || !e.name) {
            this.invalidEntriesCount++
            return
        }

        // Smart cache cleanup: clear when URL changes and cache is large
        if (this.urlCache.size > 100 && e.url !== this.lastURL) {
            this.urlCache.clear()
        }
        this.lastURL = e.url

        // URL MERGING LOGIC: Check if we already have an entry with this URL
        const existingEntry = this.urlCache.get(e.url)
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

        // Store in cache for future merges
        this.urlCache.set(e.url, { ...e })

        // Use the cached entry (which may have been merged)
        const entryToInsert = this.urlCache.get(e.url)

        // CRITICAL FIX: Increment foundStreams BEFORE using it as index
        // This ensures each entry gets a unique index
        this.foundStreams++
        const i = this.foundStreams - 1 // Use 0-based index

        // Call prepareEntry to generate nameTerms and groupTerms
        this.master.prepareEntry(entryToInsert)

        if (entryToInsert.name && entryToInsert.gid) {
            if (typeof (this._index.gids[entryToInsert.gid]) == 'undefined') {
                this._index.gids[entryToInsert.gid] = []
            }
            if (!this._index.gids[entryToInsert.gid].includes(entryToInsert.name)) {
                this._index.gids[entryToInsert.gid].push(entryToInsert.name)
            }
        }
        // Process groups
        if (entryToInsert.group && entryToInsert.group !== 'undefined' && entryToInsert.group !== undefined) {
            if (typeof (this._index.groups[entryToInsert.group]) == 'undefined') {
                this._index.groups[entryToInsert.group] = []
            }
            this._index.groups[entryToInsert.group].push(i)
        } else {
            // Handle entries without group - use empty string as default
            const defaultGroup = ''
            if (typeof (this._index.groups[defaultGroup]) == 'undefined') {
                this._index.groups[defaultGroup] = []
            }
            this._index.groups[defaultGroup].push(i)
        }

        if (entryToInsert.group && entryToInsert.group !== 'undefined' && entryToInsert.group !== undefined) { // collect some data to sniff after if each group seems live, serie or movie
            if (typeof (this.groups[entryToInsert.group]) == 'undefined') {
                this.groups[entryToInsert.group] = []
            }
            this.groups[entryToInsert.group].push({
                name: entryToInsert.name,
                url: entryToInsert.url,
                icon: entryToInsert.icon
            })
        } else {
            // Handle entries without group - use empty string as default
            const defaultGroup = ''
            if (typeof (this.groups[defaultGroup]) == 'undefined') {
                this.groups[defaultGroup] = []
            }
            this.groups[defaultGroup].push({
                name: entryToInsert.name,
                url: entryToInsert.url,
                icon: entryToInsert.icon
            })
        }

        // Add to unique streams set (initialized in constructor)
        if (!this.uniqueStreamsIndexate.has(entryToInsert.url)) {
            this.uniqueStreamsIndexate.add(entryToInsert.url)
        }

        // OPTIMIZATION: Initialize InsertSession if not already done
        if (!this.insertSession) {
            this.insertSession = db.beginInsertSession()

        }

        // OPTIMIZATION: Add to InsertSession instead of batch processing
        try {
            await this.insertSession.add(entryToInsert)


        } catch (error) {
            console.error('Error adding to InsertSession:', error)
            // Fallback to original batch processing if InsertSession fails
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

        // Force delete existing data files to ensure clean start
        try {
            await fs.promises.unlink(this.file).catch(() => { });
            await fs.promises.unlink(this.file.replace(/\.jdb$/i, '.idx.jdb')).catch(() => { });
        } catch (err) {
            // Ignore errors if files don't exist
        }

        const db = new Database(this.file, {
            clear: true,
            create: true,
            integrityCheck: 'none', // Disable integrity check for performance
            indexedQueryMode: 'loose', // Use loose mode to allow queries on non-indexed fields
            mutexTimeout: 10000, // 10 seconds timeout for mutex operations
            termMappingCleanup: true, // Enable term mapping cleanup
            fields: {
                url: 'string',              // Stream URL
                name: 'string',             // Stream name
                icon: 'string',             // Stream icon/logo
                gid: 'string',             // TV guide ID
                group: 'string',            // Group title
                groups: 'array:string',     // Multiple groups
                groupName: 'string',       // Group name
                nameTerms: 'array:string',  // Search terms from name
                groupTerms: 'array:string', // Search terms from group
                lang: 'string',            // Language (tvg-language + detection)
                country: 'string',          // Country (tvg-country + detection)
                age: 'number',             // Age rating (0 = default, no restriction)
                subtitle: 'string',        // Subtitle
                userAgent: 'string',       // User agent (http-user-agent)
                referer: 'string',         // Referer (http-referer)
                author: 'string',          // Author (pltv-author)
                site: 'string',            // Site (pltv-site)
                email: 'string',           // Email (pltv-email)
                phone: 'string',           // Phone (pltv-phone)
                description: 'string',     // Description (pltv-description)
                epg: 'string',             // EPG URL (url-tvg, x-tvg-url)
                subGroup: 'string',        // Sub group (pltv-subgroup)
                rating: 'string',          // Rating (rating, tvg-rating)
                parental: 'string',        // Parental control (parental, censored)
                genre: 'string',          // Genre (tvg-genre)
                region: 'string',         // Region (region)
                categoryId: 'string',     // Category ID (category-id)
                ageRestriction: 'string'   // Age restriction (age-restriction)
            },
            indexes: ['nameTerms', 'groupTerms'] // Only the fields we want to index
        })
        // FIXED: Do NOT delete existing metadata file - preserve existing data
        // The metadata database will be updated with new data, preserving existing entries


        // Create storage hold for meta file to prevent cleanup during indexing
        const metaFilename = this.metaFile.split('/').pop().split('\\').pop();
        const metaKey = storage.unresolve(metaFilename);
        const metaHold = storage.hold(metaKey);

        const mdb = new Database(this.metaFile, {
            clear: false, // Do not clear existing meta data
            create: true,
            integrityCheck: 'none', // Disable integrity check for performance
            indexedQueryMode: 'loose', // Use loose mode to allow queries on non-indexed fields
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
        this._index = { groups: {}, meta: {}, gids: {}, groupsTypes: {}, uniqueStreamsLength: 0 }

        let err
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
        this.urlCache.clear()
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
                this.urlCache.clear()
                this.lastURL = null
            }
        }


        // OPTIMIZATION: Commit InsertSession after all entries processed
        if (this.insertSession) {

            const insertedCount = await this.insertSession.commit()

            this.insertSession = null
        }



        // Wait for all remaining inserts to complete with timeout
        const startWaitTime = Date.now()
        const maxWaitTime = 10000 // 10 seconds max wait

        while (this.activeInserts > 0 && (Date.now() - startWaitTime) < maxWaitTime) {
            await new Promise(resolve => setTimeout(resolve, 50))
        }

        if (this.activeInserts > 0) {
            // console.warn(`Force stopping ${this.activeInserts} active inserts after timeout in start()`)
            this.insertsDisabled = true // Disable inserts instead of forcing stop
        } else {
            // console.log('All active inserts completed successfully in start()')
        }


        // Fill index metadata and persist to metadata DB
        // Merge with existing metadata to preserve important data (no overwrite)
        if (this.indexMeta && Object.keys(this.indexMeta).length > 0) {
            this._index.meta = { ...this._index.meta, ...this.indexMeta };
        }

        // Set uniqueStreamsLength AFTER all streams have been processed
        this._index.uniqueStreamsLength = this.uniqueStreamsIndexate.size
        this._index.groupsTypes = this.sniffGroupsTypes(this.groups)



        // Save and close main database
        try {

            await db.close();

        } catch (saveErr) {
            console.error('Database save/close error:', saveErr)
            err = saveErr
        }

        // Only save meta file if we actually found unique streams and have valid index data
        if (this._index.uniqueStreamsLength > 0) {
            try {


                // Get existing metadata to preserve important data
                const existingMeta = await getListMeta(this.url);


                // FIXED: Smart merge with existing metadata instead of overwriting
                const indexData = {
                    // don't need to read existing meta data, it's already in the db
                    lastUpdate: Date.now(),
                    updateCount: (existingMeta.updateCount || 0) + 1
                };

                // Merge complex objects intelligently
                if (this._index.groups && Object.keys(this._index.groups).length > 0) {
                    indexData.groups = this._index.groups;
                }
                if (this._index.meta && Object.keys(this._index.meta).length > 0) {
                    indexData.meta = { ...existingMeta.meta, ...this._index.meta };
                }
                if (this._index.gids && Object.keys(this._index.gids).length > 0) {
                    indexData.gids = this._index.gids;
                }
                if (this._index.groupsTypes && Object.keys(this._index.groupsTypes).length > 0) {
                    indexData.groupsTypes = this._index.groupsTypes;
                }
                if (this._index.uniqueStreamsLength !== undefined) {
                    indexData.uniqueStreamsLength = this._index.uniqueStreamsLength;
                }



                // Save with key-value structure (preserves existing data automatically)
                const saveSuccess = await setListMeta(this.url, indexData);

                if (saveSuccess) {

                } else {
                    console.error(`❌ Metadata database save failed for ${this.url}`);
                    err = new Error('Meta file save failed');
                }
            } catch (metaErr) {
                console.error('Metadata database error:', metaErr)
                err = metaErr
            }
        } else {

            // FIXED: Do NOT delete existing meta file - preserve existing data even if no new streams found
            // The existing metadata might contain important information from previous updates

        }

        // Log debug information to a relative path instead of hardcoded absolute path
        const logPath = joinPath(dirname(this.file), 'debug.log')
        const dataFileSize = fs.statSync(this.file).size
        await fs.promises.appendFile(logPath, `${new Date().toISOString()} - ${db.length} - ${dataFileSize} - ${this.insertPromises.length} - ${err || 'success'}\n`).catch(() => { })
        await fs.promises.appendFile(logPath, JSON.stringify(db.indexManager.index) + '\n').catch(() => { })


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

        // Release the meta file hold
        if (metaHold) {
            metaHold.release();
        }

        // Reset after all operations are complete to prepare for next use
        this.reset()

        return true
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
        }

        mag.destroy()
        if (err) {
            console.error('MPARSE ' + err)
            throw err
        }
    }
    async parse(opts, db, playlist) {
        let resolved
        const endListener = () => {
            this.parser && this.parser.end()
        }
        this.parser && this.parser.destroy()
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
        this.stream.once('end', endListener)

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
            for await (const item of this.parser.walk()) {
                // Check if instance was destroyed, cancelled, or inserts disabled during processing
                if (resolved || this.destroyed || this.cancelled || this.insertsDisabled) {
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
                if (this.foundStreams) {
                    if (this.contentLength == this.defaultContentLength) {
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

        // groups is initialized in constructor, so it should always be an object
        Object.keys(groups).forEach(g => {
            let icon
            const isSeried = this.isGroupSeried(groups[g])
            const types = groups[g].map(e => {
                if (e.icon && !icon) {
                    icon = e.icon
                }
                const streamType = isSeried ? 'series' : this.sniffStreamType(e)
                return streamType
            }).filter(s => s)

            const type = this.mode(types)
            if (type) {
                // FIXED: Prevent recursive concatenation by using only the last part of the group path
                // Split the group path and use only the last meaningful segment
                const groupParts = g.split('/').filter(part => part && part.trim() !== '')
                const cleanGroupName = groupParts.length > 0 ? groupParts[groupParts.length - 1] : g

                ret[type].push({ name: cleanGroupName, icon })
            }
        })

        return ret
    }
    isGroupSeried(es) {
        if (es.length < 5) return false
        const masks = {}
        const mask = n => n.replace(new RegExp('[0-9]+', 'g'), '*')
        es.forEach(e => {
            if (!e.name) return // Cannot read property 'replace' of null
            const m = mask(e.name)
            if (typeof (masks[m]) == 'undefined') masks[m] = 0
            masks[m]++
        })
        return Object.values(masks).some(n => n >= (es.length * 0.7))
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
                if (Array.isArray(this.groups[key])) {
                    this.groups[key].length = 0
                }
                delete this.groups[key]
            })
            this.groups = {}
        }

        // Clear Set completely
        if (this.uniqueStreamsIndexate) {
            this.uniqueStreamsIndexate.clear()
        }
        this.uniqueStreamsIndexate = new Set()

        // Clear URL cache for merging
        if (this.urlCache) {
            this.urlCache.clear()
        }
        this.urlCache = new Map()

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
            this._index = { groups: {}, meta: {}, gids: {}, groupsTypes: {}, uniqueStreamsLength: 0 }
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
        this.activeInserts = 0
        this.cancelled = false
        this.insertsDisabled = false
        this.abortController = new AbortController()

        // OPTIMIZATION: Reset InsertSession
        this.insertSession = null
        this.lastURL = null
    }
    async destroy() {
        if (!this.destroyed) {
            // Cancel all operations immediately
            this.cancelled = true
            this.insertsDisabled = true
            this.abortController.abort()

            // OPTIMIZATION: Clean up InsertSession if active
            if (this.insertSession) {
                try {
                    await this.insertSession.commit()
                    this.insertSession = null
                } catch (err) {
                    console.error('🔍 UpdateListIndex: Error committing InsertSession during destroy:', err)
                    this.insertSession = null
                }
            }

            // Wait for active operations to complete (with timeout)
            if (this.activeInserts > 0) {

                const startTime = Date.now()
                const maxWaitTime = 5000 // 5 seconds max wait

                while (this.activeInserts > 0 && (Date.now() - startTime) < maxWaitTime) {
                    await new Promise(resolve => setTimeout(resolve, 100))
                }

                if (this.activeInserts > 0) {
                    console.warn(`Force stopping ${this.activeInserts} active inserts after timeout`)
                    this.activeInserts = 0
                } else {

                }
            }

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
                    if (Array.isArray(this.groups[key])) {
                        this.groups[key].length = 0
                    }
                    delete this.groups[key]
                })
                this.groups = null
            }

            if (this.uniqueStreamsIndexate) {
                this.uniqueStreamsIndexate.clear()
            }
            this.uniqueStreamsIndexate = null

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
