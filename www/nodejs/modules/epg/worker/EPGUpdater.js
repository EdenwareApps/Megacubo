import { EventEmitter } from 'node:events'
import { time } from '../../utils/utils.js'
import fs from 'node:fs/promises'

// Use the safe wrapper instead of log directly
import { DatabaseFactory } from './database/DatabaseFactory.js'
import { ParserFactory } from './parser/ParserFactory.js'
import { CacheManager } from './cache/CacheManager.js'
import { MemoryMonitor } from './memory/MemoryMonitor.js'
import { EPG_CONFIG } from './config.js'
import storage from '../../storage/storage.js'

export class EPGUpdater extends EventEmitter {
  constructor(url, dependencies = {}) {
    super()
    this.url = url

    // Injeção de Dependências (Dependency Injection)
    this.databaseFactory = dependencies.databaseFactory || DatabaseFactory
    this.parserFactory = dependencies.parserFactory || ParserFactory
    this.cacheManager = dependencies.cacheManager || new CacheManager(EPG_CONFIG.cache)
    this.memoryMonitor = dependencies.memoryMonitor || new MemoryMonitor(EPG_CONFIG.memory)

    // Internal state management
    this._state = {
      mdbInit: false,
      mdbInitializing: false, // FIXED: Add mutex flag to prevent concurrent initialization
      updating: false,
      destroyed: false,
      insertSession: null,
      lastMdbLog: 0,
      allTermsLoaded: false,
      validEPG: false,
      received: 0,
      transferred: 0,
      finalizationInProgress: false,
      commitInProgress: false // Flag to prevent udb destruction during commit
    }

    // Initialize in-memory maps for batch processing
    this._channelMap = new Map()
    this._termsMap = new Map()
    
    // Track IDs that have been saved to database to avoid duplicates during periodic flush
    this._savedChannelIds = new Set()
    this._savedTermIds = new Set()
    
    // Configuration for periodic flush
    this._BATCH_FLUSH_THRESHOLD = 10000 // Flush when map reaches this size
    this._BATCH_FLUSH_INTERVAL = 5000   // Or when this many new entries added since last flush
    this._lastBatchFlush = { channels: 0, terms: 0 }

    // Configuration properties
    const envDebugValue = (typeof process !== 'undefined' ? process?.env?.MEGACUBO_EPG_DEBUG : undefined)
    if (dependencies.debug !== undefined) {
      this.debug = Boolean(dependencies.debug)
    } else if (typeof envDebugValue === 'string') {
      const normalized = envDebugValue.trim().toLowerCase()
      this.debug = normalized !== '' && normalized !== '0' && normalized !== 'false' && normalized !== 'off'
    } else {
      this.debug = false
    }
    this.errorCount = 0
    this.errorCountLimit = EPG_CONFIG.network.errorCountLimit
    this.acceptRanges = false
    this.bytesLength = -1
    this.ttl = EPG_CONFIG.cache.ttl
    this.dataLiveWindow = EPG_CONFIG.cache.dataLiveWindow
    this.autoUpdateIntervalSecs = EPG_CONFIG.update.autoUpdateIntervalSecs
    this.minExpectedEntries = EPG_CONFIG.cache.minExpectedEntries

    // Database instances
    this.db = null  // Main programme database
    this.mdb = null // Main metadata database
    this.udb = null // Temporary programme database (during updates)
    this.umdb = null // Temporary metadata database (during updates)

    // Parser and request instances
    this.parser = null
    this.request = null

    // File paths (to be set by subclasses)
    this.file = null
    this.metaFile = null

    // Initialize memory monitoring
    this.memoryMonitor.onHighMemory((memInfo) => {
      console.warn(`High memory usage detected: ${memInfo.heapPercent.toFixed(1)}%`)
      this.cacheManager.clearAllCaches()
    })

    this.memoryMonitor.onCriticalMemory((memInfo) => {
      console.error(`Critical memory usage detected: ${memInfo.heapPercent.toFixed(1)}%`)
      this.cacheManager.clearAllCaches()
      // Force garbage collection if possible
      if (typeof global !== 'undefined' && global.gc) {
        global.gc()
      }
    })

    this.memoryMonitor.startMonitoring()
  }

  setDebug(enabled) {
    this.debug = Boolean(enabled)
  }

  debugLog(...args) {
    if (!this.debug) {
      return
    }

    try {
      if (args.length === 1) {
        globalThis.console.log(args[0])
      } else {
        globalThis.console.log(...args)
      }
    } catch {
      // Ignore logging failures
    }
  }

  async registerStorageArtifacts(ttlSeconds) {
    const files = []

    if (this.file) {
      files.push(this.file, this.file.replace(/\.jdb$/i, '.idx.jdb'))
    }
    if (this.metaFile) {
      files.push(this.metaFile, this.metaFile.replace(/\.jdb$/i, '.idx.jdb'))
    }

    for (const filePath of files) {
      if (!filePath) {
        continue
      }

      try {
        await fs.access(filePath)
      } catch {
        continue
      }

      try {
        await storage.registerFile(filePath, {
          ttl: ttlSeconds,
          size: 'auto',
          raw: true
        })
      } catch (err) {
        console.warn('Failed to register storage artifact:', filePath, err?.message || err)
      }
    }
  }

  // Getters and setters for state management
  get isUpdating() { return this._state.updating }
  set isUpdating(value) { this._state.updating = value }

  get isDestroyed() { return this._state.destroyed }
  set isDestroyed(value) { this._state.destroyed = value }

  get validEPG() { return this._state.validEPG }
  set validEPG(value) { this._state.validEPG = value }

  get received() { return this._state.received }
  set received(value) { this._state.received = value }

  // ===== Database Management Methods =====

  createProgrammeDatabase(clear = false) {
    if (!this.file) {
      throw new Error('Programme database file path not set')
    }
    return this.databaseFactory.createProgrammeDB(this.file, {}, clear)
  }

  createMetadataDatabase(clear = false) {
    if (!this.metaFile) {
      throw new Error('Metadata database file path not set')
    }
    return this.databaseFactory.createMetadataDB(this.metaFile, {}, clear)
  }

  async createTempProgrammeDatabase() {
    // CRITICAL: Remove .jdb extension before adding .tmp.jdb to avoid double .jdb
    const basePath = this.file.endsWith('.jdb') ? this.file.slice(0, -4) : this.file
    const tempPath = basePath + '.tmp.jdb'
    this.debugLog(`Creating temporary programme database at: ${tempPath}`)
    const db = this.databaseFactory.createProgrammeDB(tempPath, {}, true)
    this.debugLog(`Temporary programme database created: ${!!db}`)

    // CRITICAL: Initialize database before any operations
    try {
      await db.init()
      this.debugLog('Temporary programme database initialized successfully')
    } catch (initErr) {
      console.error('Failed to initialize temporary programme database:', initErr.message)
      throw initErr
    }

    return db
  }

  async createTempMetadataDatabase() {
    // CRITICAL: Remove .jdb extension before adding .tmp.jdb to avoid double .jdb
    const basePath = this.metaFile.endsWith('.jdb') ? this.metaFile.slice(0, -4) : this.metaFile
    const tempPath = basePath + '.tmp.jdb'
    this.debugLog(`Creating temporary metadata database at: ${tempPath}`)
    const db = this.databaseFactory.createMetadataDB(tempPath, {}, true)
    this.debugLog(`Temporary metadata database created: ${!!db}`)

    // CRITICAL: Initialize database before any operations
    try {
      await db.init()
      this.debugLog('Temporary metadata database initialized')
    } catch (initErr) {
      console.error('Failed to initialize temporary metadata database:', initErr.message)
      throw initErr
    }

    return db
  }

  async ensureMDB() {
    if (!this.mdb) {
      // Don't log - this error will be handled by callers
      throw new Error('Metadata DB not initialized')
    }

    // Handle cases where the metadata DB was closed after initialization
    // (e.g., due to memory pressure or explicit close operations)
    if (this.mdb.closed) {
      this.debugLog('Metadata DB is closed, resetting init state to allow reopen...')
      this._state.mdbInit = false
    }

    // FIXED: Add protection against multiple concurrent initializations
    if (this._state.mdbInit) {
      return // Already initialized, skip
    }

    // FIXED: Add mutex to prevent concurrent initialization
    if (this._state.mdbInitializing) {
      this.debugLog('Metadata DB initialization already in progress, waiting...')
      // Wait for ongoing initialization to complete
      while (this._state.mdbInitializing && !this._state.mdbInit) {
        await new Promise(resolve => setTimeout(resolve, 10))
      }
      return
    }

    this._state.mdbInitializing = true

    try {
      this.debugLog('Initializing metadata DB...')
      await this.databaseFactory.initializeDB(this.mdb)

      // Validate database after initialization
      const dbLength = this.mdb.length
      if (typeof dbLength !== 'number' || dbLength < 0 || dbLength > 10000000) {
        console.error(`Corrupted metadata DB detected after init, length: ${dbLength}`)
        throw new Error(`Corrupted database length: ${dbLength}`)
      }

      this._state.mdbInit = true
      this.debugLog('Metadata DB initialized successfully')
      this.debugLog(`Metadata DB length: ${this.mdb.length}`)
    } catch (err) {
      console.error('Error initializing metadata DB:', err)

      // If initialization fails due to corruption, try to recover
      if (err.message.includes('Corrupted database') || err.message.includes('out of range')) {
        this.debugLog('Attempting database recovery...')
        try {
          await this.recoverMetadataDB()
          // Try initialization again after recovery
          await this.databaseFactory.initializeDB(this.mdb)
          this._state.mdbInit = true
          this.debugLog('Metadata DB recovered and initialized successfully')
        } catch (recoveryErr) {
          console.error('Database recovery failed:', recoveryErr.message)
          throw err // Re-throw original error if recovery fails
        }
      } else {
        throw err
      }
    } finally {
      // FIXED: Always clear the initialization flag
      this._state.mdbInitializing = false
    }
  }

  async recoverMetadataDB() {
    this.debugLog('Starting metadata DB recovery...')

    try {
      // Destroy the corrupted database
      if (this.mdb) {
        try {
          await this.mdb.destroy()
        } catch (destroyErr) {
          console.warn('Could not destroy corrupted database:', destroyErr.message)
        }
      }

      // Reset state
      this.mdb = null
      this._state.mdbInit = false
      this.cacheManager.clearAllCaches()

      // Recreate the database with fresh configuration
      if (!this.metaFile) {
        throw new Error('No metadata path available for recovery')
      }

      this.debugLog('Recreating metadata DB at:', this.metaFile)
      this.mdb = this.createMetadataDatabase(true) // clear: true

      this.debugLog('Metadata DB recovery completed')

    } catch (err) {
      console.error('Metadata DB recovery failed:', err.message)
      throw err
    }
  }

  async reinitializeMetadataDB() {
    this.debugLog('Reinitializing metadata database...')

    try {
      // Reset state
      this._state.mdbInit = false
      this.cacheManager.clearAllCaches()

      // Destroy old database if it exists
      if (this.mdb && typeof this.mdb.destroy === 'function') {
        try {
          await this.mdb.destroy()
        } catch (destroyErr) {
          console.warn('Error destroying old metadata DB:', destroyErr.message)
        }
      }

      // Create new database instance with clear: true to reset corrupted data
      this.mdb = this.createMetadataDatabase(true)

      // Initialize the new database
      await this.databaseFactory.initializeDB(this.mdb)
      this._state.mdbInit = true

      this.debugLog('Metadata database reinitialized successfully')

    } catch (err) {
      console.error('Failed to reinitialize metadata database:', err.message)
      throw err
    }
  }

  // ===== Cache Management Methods =====

  async upsertChannel(id, name, icon, retryCount = 0) {
    if (!id) return

    // Check if EPG is being destroyed or finalization is in progress
    if (this._state.destroyed || this._state.finalizationInProgress) {
      this.debugLog(`EPG destroyed or finalization started during channel processing, skipping upsert for: ${id} (destroyed: ${this._state.destroyed}, finalizing: ${this._state.finalizationInProgress})`)
      return
    }

    try {
      // Normalize incoming data
      const incomingName = String(name || '').trim()
      const cachedChannel = this.cacheManager.getChannel(id)

      // Determine if we should update existing cache entry
      const shouldUpdateExisting = (() => {
        if (!cachedChannel || !cachedChannel.name) {
          return true
        }

        const cachedName = String(cachedChannel.name).trim()
        if (!incomingName || incomingName === cachedName) {
          return false
        }

        const incomingLooksBetter =
          incomingName.length >= 2 &&
          /[a-z]/i.test(incomingName) &&
          (cachedName === id || !/[a-z]/i.test(cachedName) || incomingName.length > cachedName.length)

        return incomingLooksBetter
      })()

      if (!shouldUpdateExisting) {
        return
      }

      // Store channel in memory map instead of immediate DB operation
      // Always update Map to keep latest version (flush will filter duplicates)
      const channelData = { _type: 'channel', id, name: incomingName, _created: time() }
      if (icon) channelData.icon = icon

      this._channelMap.set(id, channelData)

      // Warn if _channelMap is growing too large (potential OOM risk)
      const MAX_MAP_SIZE_WARN = 10000
      if (this._channelMap.size >= MAX_MAP_SIZE_WARN) {
        console.warn(`⚠️ [OOM Risk] _channelMap size is very large: ${this._channelMap.size} entries (EPG: ${this.url}, batch save may be needed)`)
      } else if (this._channelMap.size >= MAX_MAP_SIZE_WARN * 0.8) {
        console.warn(`⚠️ [Memory Warning] _channelMap size is high: ${this._channelMap.size} entries (EPG: ${this.url}, approaching limit)`)
      }
      
      // Periodic flush to prevent OOM (saves but keeps Map intact)
      const channelCount = this._channelMap.size
      const unsavedChannelCount = channelCount - this._savedChannelIds.size
      const channelsSinceLastFlush = channelCount - this._lastBatchFlush.channels
      
      // Flush if map is too large OR if there are many unsaved items OR if many new items added
      if ((channelCount >= this._BATCH_FLUSH_THRESHOLD || 
           unsavedChannelCount >= this._BATCH_FLUSH_INTERVAL ||
           channelsSinceLastFlush >= this._BATCH_FLUSH_INTERVAL) &&
          this.mdb && this.mdb.initialized && !this.mdb.destroyed &&
          !this._state.destroyed && !this._state.finalizationInProgress) {
        try {
          await this._flushChannelsAndTermsPartial('channels')
          // Track total map size for threshold checks
          this._lastBatchFlush.channels = channelCount
        } catch (err) {
          console.warn('Periodic channel flush failed, will retry at final save:', err.message)
        }
      }

      // Update cache
      this.cacheManager.setChannel(id, { name: incomingName, icon })

      // Debug logging disabled to reduce verbosity
      // if (this._channelMap.size % 500 === 0) {
      //   this.debugLog(`Added channel ${id} to memory map (total: ${this._channelMap.size})`)
      // }

    } catch (err) {
      console.error(`Error processing channel ${id}:`, err.message)
    }
  }

  async upsertTerms(id, terms, retryCount = 0) {
    if (!id) return

    // Check if EPG is being destroyed or finalization is in progress
    if (this._state.destroyed || this._state.finalizationInProgress) {
      this.debugLog(`EPG destroyed or finalization started during terms processing, skipping upsert for: ${id} (destroyed: ${this._state.destroyed}, finalizing: ${this._state.finalizationInProgress})`)
      return
    }

    try {
      const norm = (terms || []).map(String)

      // Store terms in memory map instead of immediate DB operation
      // Always update Map to keep latest version (flush will filter duplicates)
      const termsData = { _type: 'terms', id, terms: norm, _created: time() }

      this._termsMap.set(id, termsData)

      // Warn if _termsMap is growing too large (potential OOM risk)
      const MAX_MAP_SIZE_WARN = 10000
      if (this._termsMap.size >= MAX_MAP_SIZE_WARN) {
        console.warn(`⚠️ [OOM Risk] _termsMap size is very large: ${this._termsMap.size} entries (EPG: ${this.url}, batch save may be needed)`)
      } else if (this._termsMap.size >= MAX_MAP_SIZE_WARN * 0.8) {
        console.warn(`⚠️ [Memory Warning] _termsMap size is high: ${this._termsMap.size} entries (EPG: ${this.url}, approaching limit)`)
      }
      
      // Periodic flush to prevent OOM (saves but keeps Map intact)
      const termsCount = this._termsMap.size
      const unsavedTermsCount = termsCount - this._savedTermIds.size
      const termsSinceLastFlush = termsCount - this._lastBatchFlush.terms
      
      // Flush if map is too large OR if there are many unsaved items OR if many new items added
      if ((termsCount >= this._BATCH_FLUSH_THRESHOLD || 
           unsavedTermsCount >= this._BATCH_FLUSH_INTERVAL ||
           termsSinceLastFlush >= this._BATCH_FLUSH_INTERVAL) &&
          this.mdb && this.mdb.initialized && !this.mdb.destroyed &&
          !this._state.destroyed && !this._state.finalizationInProgress) {
        try {
          await this._flushChannelsAndTermsPartial('terms')
          // Track total map size for threshold checks
          this._lastBatchFlush.terms = termsCount
        } catch (err) {
          console.warn('Periodic terms flush failed, will retry at final save:', err.message)
        }
      }

      // Update cache
      this.cacheManager.setTerms(id, norm)

      // Debug logging disabled to reduce verbosity
      // if (this._termsMap.size % 500 === 0) {
      //   this.debugLog(`Added terms for ${id} to memory map (total: ${this._termsMap.size})`)
      // }

    } catch (err) {
      console.error(`Error processing terms for ${id}:`, err.message)
    }
  }

  async getAllTerms() {
    if (this.cacheManager.isAllTermsLoaded()) {
      return this.cacheManager.getAllTerms()
    }

    this.debugLog('getAllTerms() called, ensuring metadata DB...')
    await this.ensureMDB()

    this.debugLog('Querying terms from metadata DB...')

    try {
      // CRITICAL: Validate database state before operations
      if (!this.mdb) {
        throw new Error('CRITICAL: Metadata database is null in getAllTerms')
      }

      if (this.mdb.destroyed) {
        throw new Error('CRITICAL: Metadata database is destroyed in getAllTerms')
      }

      if (!this.mdb.initialized) {
        console.warn('Metadata DB not initialized, returning empty cache')
        this.cacheManager.setAllTermsLoaded(true)
        return this.cacheManager.getAllTerms()
      }

      const terms = await this.mdb.find({ _type: 'terms' })

      // Validate terms data
      if (!Array.isArray(terms)) {
        console.warn('Invalid terms data from database, returning empty cache')
        this.cacheManager.setAllTermsLoaded(true)
        return this.cacheManager.getAllTerms()
      }

      this.debugLog(`Found ${terms.length} terms in metadata DB`)

      // Populate cache
      for (const term of terms) {
        if (term.id && Array.isArray(term.terms)) {
          this.cacheManager.setTerms(term.id, term.terms)
        }
      }

      this.cacheManager.setAllTermsLoaded(true)
      this.debugLog(`Terms cache populated with ${this.cacheManager.getAllTerms().size} entries`)

      return this.cacheManager.getAllTerms()

    } catch (err) {
      console.error('Error in getAllTerms:', err.message)

      // If query fails, try to recover by clearing the database
      try {
        this.debugLog('Attempting database recovery...')
        if (this.mdb) {
          await this.mdb.destroy()
          this.mdb = null
        }
        this.cacheManager.setAllTermsLoaded(false)
        this.cacheManager.clearTermsCache()

        // Recreate database
        this.mdb = this.createMetadataDatabase(true)
        await this.databaseFactory.initializeDB(this.mdb)
        this._state.mdbInit = true

        this.debugLog('Database recovery completed, returning empty terms cache')
        this.cacheManager.setAllTermsLoaded(true)
        return this.cacheManager.getAllTerms()

      } catch (recoveryErr) {
        console.error('Database recovery also failed:', recoveryErr.message)
        // Return empty cache as fallback
        this.cacheManager.setAllTermsLoaded(true)
        return this.cacheManager.getAllTerms()
      }
    }
  }

  // ===== Parser Management Methods =====

  async setupMAGParser() {
    this.debugLog('Using MAG parser for:', this.url)

    const callbacks = {
      onProgramme: (programme) => this.programme(programme),
      onChannel: (ch) => this.channel(ch),
      onError: (err) => {
        console.error('MAG Parser error:', err)
        this.errorCount++
        return this.errorCount < this.errorCountLimit
      }
    }

    this.parserInstance = this.parserFactory.createMAGParser(this.url, callbacks)
    this.parser = this.parserInstance.parser
    this.request = this.parserInstance.request

    // Listen to Download progress events to update state when integer percentage changes
    if (this.request && typeof this.request.on === 'function') {
      let lastIntProgress = -1
      this.request.on('progress', (progress) => {
        const currentIntProgress = Math.floor(progress)
        if (currentIntProgress !== lastIntProgress) {
          lastIntProgress = currentIntProgress
          // Update state when integer progress percentage changes
          if (this.updateState) {
            this.updateState().catch(() => { }) // Don't block on state updates
          }
        }
      })
    }

    // Start the parser
    this.parserInstance.start()
  }

  async setupXMLParser(onErr, now) {
    this.debugLog('Setting up XML parser for:', this.url)

    // Get last modified date for conditional request
    const { lastModifiedAt } = await this.getControlKeys()

    const callbacks = {
      onProgramme: (programme) => this.programme(programme),
      onChannel: (ch) => this.channel(ch),
      onError: onErr,
      onProgress: (received) => {
        this.received = received
        this.bytesDownloaded = received
        // Note: Download already calculates and emits 'progress' event, 
        // we listen to it separately to update state on integer percentage changes
      },
      onStatus: (statusCode) => {
        this.statusCode = statusCode
      },
      lastModified: lastModifiedAt, // Pass last modified for conditional request
      onEnd: () => {
        this.debugLog('🟣 Parser.onEnd() CALLED - Start of callback execution')
        this.debugLog(`🟣 onEnd: udb state AT ENTRY: exists=${!!this.udb}, destroyed=${this.udb?.destroyed}, length=${this.udb?.length || 0}`)
        this.debugLog('Parser ended, finalizing insert session and calling finalizeUpdate')

        // Capture the update ID at the time onEnd is called
        const updateId = this._currentUpdateId
        this.debugLog(`🟣 onEnd called for update session: ${updateId}`)

        // Wait for any pending channel processing to complete before finalizing
        const waitForPendingOperations = async () => {
          // Verify this is still the same update session
          if (this._currentUpdateId !== updateId) {
            console.warn(`Update session changed (was ${updateId}, now ${this._currentUpdateId}), skipping finalization`)
            return
          }

          // Wait for parser to completely stop processing
          this.debugLog('Waiting for parser to completely stop processing...')
          if (this.parser) {
            if (this.parser.destroyed || this.parser.writableEnded) {
              this.debugLog('✅ Parser already ended (destroyed or writableEnded)')
            } else {
              this.debugLog('Parser still active, waiting for end event...')
              await new Promise((resolve) => {
                const onEnd = () => {
                  this.debugLog('✅ Parser end event received')
                  this.parser.removeListener('end', onEnd)
                  resolve()
                }
                this.parser.once('end', onEnd)
              })
            }
          } else {
            this.debugLog('✅ No parser to wait for')
          }

          // Wait for ALL database operations (udb, umdb, db, mdb)
          this.debugLog('Waiting for all database operations to complete...')

          if (this.udb && typeof this.udb.waitForOperations === 'function') {
            this.debugLog('Waiting for udb operations...')
            await this.udb.waitForOperations()
            this.debugLog('✅ udb operations completed')
          }

          if (this.umdb && typeof this.umdb.waitForOperations === 'function') {
            this.debugLog('Waiting for umdb operations...')
            await this.umdb.waitForOperations()
            this.debugLog('✅ umdb operations completed')
          }

          if (this.db && typeof this.db.waitForOperations === 'function') {
            this.debugLog('Waiting for db operations...')
            await this.db.waitForOperations()
            this.debugLog('✅ db operations completed')
          }

          if (this.mdb && typeof this.mdb.waitForOperations === 'function') {
            this.debugLog('Waiting for mdb operations...')
            await this.mdb.waitForOperations()
            this.debugLog('✅ mdb operations completed')
          }

          // Wait for insertSession operations
          if (this.insertSession && typeof this.insertSession.waitForOperations === 'function') {
            this.debugLog('Waiting for insertSession operations...')
            await this.insertSession.waitForOperations()
            this.debugLog('✅ InsertSession operations completed')
          }

          // Finalize the insert session before finalizing the update
          if (this.insertSession && typeof this.insertSession.commit === 'function') {
            try {
              this.debugLog('🔵 onEnd: About to commit insertSession')
              this.debugLog(`🔵 onEnd: Update ID check - current: ${this._currentUpdateId}, onEnd: ${updateId}`)
              this.debugLog(`🔵 onEnd: udb state BEFORE checks: exists=${!!this.udb}, destroyed=${this.udb?.destroyed}, length=${this.udb?.length || 0}`)

              // CRITICAL: Verify this is still the same update session
              if (this._currentUpdateId !== updateId) {
                console.warn(`Update session changed during commit, cannot proceed (was ${updateId}, now ${this._currentUpdateId})`)
                onErr(new Error('Update session changed before commit'))
                return
              }

              // CRITICAL: Set commit flag to prevent udb destruction
              this._state.commitInProgress = true
              this._state.commitStartTime = Date.now() // Track when commit started
              this.debugLog('🔵 Commit flag set - udb is now protected from destruction')

              // CRITICAL: Only create InsertSession if we have data to commit
              if (!this.insertSession && this.udb && this.udb.length > 0) {
                this.debugLog('🔵 Creating InsertSession for commit - data available')
                this.insertSession = this.databaseFactory.createInsertSession(this.udb, this.umdb)
              }

              // CRITICAL: Verify database is still valid before committing
              if (!this.udb) {
                console.error('🔴 CRITICAL: udb is null before commit, cannot proceed')
                console.error(`🔴 Update ID at error: ${this._currentUpdateId}, onEnd ID: ${updateId}`)
                console.error(`🔴 State: destroyed=${this._state.destroyed}, commitInProgress=${this._state.commitInProgress}`)
                console.error(`🔴 EPG URL: ${this.url}`)
                console.error(`🔴 EPG readyState: ${this.readyState}`)
                this._state.commitInProgress = false
                onErr(new Error('Database destroyed before commit'))
                return
              }

              if (this.udb.destroyed) {
                console.error('CRITICAL: udb is destroyed before commit, cannot proceed')
                this._state.commitInProgress = false
                onErr(new Error('Database destroyed before commit'))
                return
              }

              if (!this.udb.initialized) {
                console.error('CRITICAL: udb is not initialized before commit, cannot proceed')
                this._state.commitInProgress = false
                onErr(new Error('Database not initialized before commit'))
                return
              }

              this.debugLog(`Before commit: udb.length=${this.udb?.length || 0}, insertSession.totalInserted=${this.insertSession.totalInserted || 0}`)
              this.debugLog(`Database state: exists=${!!this.udb}, destroyed=${this.udb?.destroyed}, initialized=${this.udb?.initialized}`)

              // Commit the insert session using JexiDB native methods
              this.debugLog('🔵 Starting commit process...')

              try {
                // Now commit the session
                await this.insertSession.commit()
                this.debugLog('✅ Commit completed successfully')

                // Clear commit flag after successful commit
                this._state.commitInProgress = false
                this.debugLog('Commit flag cleared - finalization can now proceed')

              } catch (commitErr) {
                console.error('❌ Commit failed:', commitErr.message)
                this._state.commitInProgress = false
                throw commitErr
              }

              this.debugLog(`After commit: udb.length=${this.udb?.length || 0}, insertSession.totalInserted=${this.insertSession.totalInserted || 0}`)
              this.debugLog('Insert session committed successfully')

              const newLastModified = this.parserInstance.getLastModified()
              await this.finalizeUpdate(newLastModified)
            } catch (err) {
              this._state.commitInProgress = false // Clear flag on error
              console.error('Error in finalizeUpdate:', err)
              onErr(err)
            }
          } else {
            // No insert session, proceed directly to finalization
            try {
              const newLastModified = this.parserInstance.getLastModified()
              await this.finalizeUpdate(newLastModified)
            } catch (err) {
              console.error('Error in finalizeUpdate:', err)
              onErr(err)
            }
          }
        }

        // Start the finalization process
        waitForPendingOperations()
      }
    }

    const options = {
      debug: this.debug,
      ttl: this.ttl
    }

    const parserInstance = this.parserFactory.createXMLParser(this.url, callbacks, options)
    this.parser = parserInstance.parser
    this.request = parserInstance.request
    this.parserInstance = parserInstance // Store reference to access getLastModified

    // Listen to Download progress events to update state when integer percentage changes
    if (this.request && typeof this.request.on === 'function') {
      let lastIntProgress = -1
      this.request.on('progress', (progress) => {
        const currentIntProgress = Math.floor(progress)
        if (currentIntProgress !== lastIntProgress) {
          lastIntProgress = currentIntProgress
          // Update state when integer progress percentage changes
          if (this.updateState) {
            this.updateState().catch(() => { }) // Don't block on state updates
          }
        }
      })
    }

    // Start the parser
    parserInstance.start()
  }

  // ===== Main Update Methods =====

  async validatePreConditions() {
    if (this.isDestroyed) {
      console.warn('EPG is destroyed, skipping update')
      return false
    }

    if (this.isUpdating) {
      console.warn('Update already in progress, skipping')
      return false
    }

    return true
  }

  async ensureDatabasesInitialized() {
    if (!this.db) {
      this.db = this.createProgrammeDatabase(false)
    }

    if (!this.mdb) {
      this.mdb = this.createMetadataDatabase(false)
    }

    // Initialize databases if not already initialized
    if (!this.db.initialized) {
      await this.databaseFactory.initializeDB(this.db)
    }

    if (!this.mdb.initialized) {
      await this.databaseFactory.initializeDB(this.mdb)
      this._state.mdbInit = true
    }
  }

  async getControlKeys() {
    try {
      // Try to get control keys from metadata database
      if (this.mdb && this.mdb.initialized) {
        // OPTIMIZATION: Use findOne() instead of find() with limit: 1 for better performance
        const fetchControl = await this.mdb.findOne({ key: 'fetchCtrlKey' })
        const modifiedControl = await this.mdb.findOne({ key: 'lastmCtrlKey' })

        const lastFetchedAt = fetchControl ? parseInt(fetchControl.value) : 0
        const lastModifiedAt = modifiedControl ? modifiedControl.value : null

        this.debugLog(`Control keys retrieved: lastFetchedAt=${lastFetchedAt}, lastModifiedAt=${lastModifiedAt}`)
        return { lastFetchedAt, lastModifiedAt }
      }
    } catch (err) {
      console.warn('Error retrieving control keys:', err.message)
    }

    // Fallback to default values
    return {
      lastFetchedAt: 0,
      lastModifiedAt: null
    }
  }

  shouldUpdate(lastFetchedAt) {
    const now = time()
    const timeSinceLastUpdate = now - lastFetchedAt

    // Always update if no data exists
    if (!this.db || this.db.length < 36) {
      this.debugLog('Should update: No data exists')
      return true
    }

    // Update if enough time has passed
    const shouldUpdateByTime = timeSinceLastUpdate > this.autoUpdateIntervalSecs
    // this.debugLog(`Update check: timeSinceLastUpdate=${timeSinceLastUpdate}s, autoUpdateIntervalSecs=${this.autoUpdateIntervalSecs}s, shouldUpdateByTime=${shouldUpdateByTime}`)

    return shouldUpdateByTime
  }

  async setupUpdateEnvironment() {
    this.debugLog('Setting up update environment')
    this.debugLog(`Starting EPG update for: ${this.url}`)
    this.debugLog(`Current state: validEPG=${this.validEPG}, errorCount=${this.errorCount}`)

    // Create unique identifier for this update session
    this._currentUpdateId = Date.now() + Math.random()
    this.debugLog(`Update session ID: ${this._currentUpdateId}`)

    // Create temporary databases for the update
    this.udb = await this.createTempProgrammeDatabase()
    this.umdb = await this.createTempMetadataDatabase()

    // CRITICAL: Validate temporary databases were created
    if (!this.udb) {
      console.error('Failed to create temporary programme database')
      throw new Error('Failed to create temporary programme database')
    }
    if (!this.umdb) {
      console.error('Failed to create temporary metadata database')
      throw new Error('Failed to create temporary metadata database')
    }

    // Initialize temporary databases
    try {
      await this.databaseFactory.initializeDB(this.udb)
      this.debugLog('Temporary programme database initialized successfully')
    } catch (udbErr) {
      console.error('Failed to initialize temporary programme database:', udbErr.message)
      throw udbErr
    }

    try {
      await this.databaseFactory.initializeDB(this.umdb)
      this.debugLog('Temporary metadata database initialized successfully')
    } catch (umdbErr) {
      console.error('Failed to initialize temporary metadata database:', umdbErr.message)
      throw umdbErr
    }

    // CRITICAL FIX: Initialize insertSession for batch processing
    try {
      this.insertSession = this.udb.beginInsertSession({
        batchSize: 500,
        enableAutoSave: true
      })
      this.debugLog('InsertSession initialized successfully')
    } catch (err) {
      console.error('Failed to initialize InsertSession:', err.message)
      this.insertSession = null
    }

    // Reset update state
    this.validEPG = false
    this.received = 0
    this.errorCount = 0

    this.debugLog('Update environment setup complete')
  }

  async cleanCorruptedControls() {
    // Clean up any corrupted control data
    this.debugLog('Cleaning corrupted controls')
    // Implementation would check and clean corrupted database entries
  }

  async saveControlKeys(lastModifiedAt = null) {
    try {
      // CRITICAL: Validate database is not closed before attempting operations
      if (!this.mdb) {
        throw new Error('CRITICAL: Metadata database is null - cannot save control keys')
      }

      if (this.mdb.destroyed) {
        throw new Error('CRITICAL: Metadata database is destroyed - cannot save control keys')
      }

      if (!this.mdb.initialized) {
        throw new Error('CRITICAL: Metadata database is not initialized - cannot save control keys')
      }

      const now = time()

      // Save fetch timestamp
      await this.mdb.insert({
        key: 'fetchCtrlKey',
        value: now.toString(),
        timestamp: now
      })

      // Save last modified if provided
      if (lastModifiedAt) {
        await this.mdb.insert({
          key: 'lastmCtrlKey',
          value: lastModifiedAt,
          timestamp: now
        })
      }

      this.debugLog(`Control keys saved: fetchCtrlKey=${now}, lastmCtrlKey=${lastModifiedAt}`)
    } catch (err) {
      console.error('CRITICAL: Error saving control keys:', err.message)
      throw err // Don't silence the error - let it propagate to detect flow issues
    }
  }

  async doUpdate() {
    this.debugLog(`Starting update for: ${this.url}`)

    if (!(await this.validatePreConditions())) return

    this.isUpdating = true

    try {
      await this.ensureDatabasesInitialized()

      const { lastFetchedAt, lastModifiedAt } = await this.getControlKeys()

      if (!this.shouldUpdate(lastFetchedAt)) {
        this.debugLog('Update not needed, skipping')

        // Check if we have valid data with sufficient future programmes
        if (this.db && this.db.length > 0) {
          const now = Date.now() / 1000
          const futureCount = await this.db.count({ end: { '>': now } }).catch(() => 0)
          this.debugLog(`EPG has ${futureCount} future programmes`)

          if (futureCount >= 36) {
            this.debugLog('Sufficient future programmes, marking as loaded')
            await this.setReadyState('loaded')
            this.error = null
            return
          } else {
            this.debugLog(`Insufficient future programmes (${futureCount} < 36), forcing update anyway`)
          }
        } else {
          // If no update needed but no data, force update anyway
          console.warn('No data available, forcing update anyway')
        }
      }

      await this.setupUpdateEnvironment()
      await this.cleanCorruptedControls()

      const now = time()
      let failed = false

      const onErr = err => {
        if (failed) return true
        this.errorCount++
        console.error('Update error:', err)
        
        // CRITICAL: Check if we have sufficient data in udb before marking as error
        // If we have enough programmes (>= 36), finalize even with download errors
        const minProgrammes = 36
        const hasEnoughData = this.udb && !this.udb.destroyed && this.udb.initialized && this.udb.length >= minProgrammes
        const hasExistingData = this.db && !this.db.destroyed && this.db.initialized && this.db.length >= minProgrammes
        
        if (hasEnoughData || hasExistingData || this.validEPG) {
          this.debugLog(`✅ EPG has sufficient data despite error - udb.length: ${this.udb?.length || 0}, db.length: ${this.db?.length || 0}, validEPG: ${this.validEPG}`)
          this.debugLog(`   Proceeding with finalization even though download error occurred`)
          
          // Force parser to end to trigger finalization
          if (this.parser && typeof this.parser.end === 'function') {
            try {
              this.parser.end()
            } catch (parseEndErr) {
              console.warn('Error ending parser:', parseEndErr.message)
            }
          }
          
          // Trigger finalization manually if onEnd wasn't called
          // This ensures data is saved even when download fails but we have enough programmes
          // Use fire-and-forget to avoid blocking the error handler
          if (hasEnoughData && !this._state.finalizationInProgress) {
            this.debugLog('🔵 Forcing finalizeUpdate due to sufficient data in udb despite download error')
            // Execute finalization asynchronously without blocking
            this.finalizeUpdate(this.parserInstance?.getLastModified?.() || null).catch(finalizeErr => {
              console.error('Error during forced finalizeUpdate:', finalizeErr)
            })
          }
          
          return true
        }
        
        // Only mark as error if we don't have enough data
        if (this.errorCount >= this.errorCountLimit && !this.validEPG) {
          failed = true
          if (this.parser && typeof this.parser.end === 'function') {
            this.parser.end()
          }
          if (!this.db || !this.db.length) {
            // Distinguish between EPG_LOAD_FAILURE (HTTP/network) and EPG_BAD_FORMAT (parsing)
            let errorType = 'EPG_BAD_FORMAT'

            if (err && (err.isNetworkError || err.isHttpError)) {
              errorType = 'EPG_LOAD_FAILURE'
              console.warn(`EPG_LOAD_FAILURE triggered - ${err.isHttpError ? `HTTP ${err.statusCode}` : 'network error'}`)
            } else {
              console.warn('EPG_BAD_FORMAT triggered - no database or empty database')
            }

            this.debugLog(`${errorType} Debug Info:`)
            this.debugLog(`  - URL: ${this.url}`)
            this.debugLog(`  - DB exists: ${!!this.db}`)
            this.debugLog(`  - DB length: ${this.db?.length || 0}`)
            this.debugLog(`  - UDB exists: ${!!this.udb}`)
            this.debugLog(`  - UDB length: ${this.udb?.length || 0}`)
            this.debugLog(`  - Received bytes: ${this.received}`)
            this.debugLog(`  - Error count: ${this.errorCount}`)
            this.debugLog(`  - Error count limit: ${this.errorCountLimit}`)
            this.debugLog(`  - Valid EPG: ${this.validEPG}`)
            this.debugLog(`  - Is Network Error: ${!!err?.isNetworkError}`)
            this.debugLog(`  - Is HTTP Error: ${!!err?.isHttpError}`)
            this.debugLog(`  - Status Code: ${err?.statusCode || 'N/A'}`)

            this.setReadyState('error')
            this.error = errorType
            // Always emit error event, but ensure it's handled
            try {
              if (this.listenerCount('error')) {
                this.emit('error', errorType)
              }
            } catch (emitError) {
              console.error('EPGUpdater: Error emitting error event:', emitError)
            }
          }
        }
        return true
      }

      await this.performEPGUpdate(onErr, now)
    } catch (err) {
      console.error('Error in doUpdate:', err)
      // Don't throw the error to avoid unhandled rejection
      // Instead, emit error event and set error state
      this.setReadyState('error')
      this.error = err.message || String(err)
      if (this.listenerCount('error')) {
        this.emit('error', err)
      }
    } finally {
      this.isUpdating = false
    }
  }

  async performEPGUpdate(onErr, now) {
    this.debugLog('Starting EPG update process')

    try {
      // Determine if this is a MAG or XML/XMLTV source
      if (this.url.includes('mag://') || this.url.includes('stalker://')) {
        await this.setupMAGParser()
      } else {
        await this.setupXMLParser(onErr, now)
      }

      // The parsing happens asynchronously through events
      // The actual finalization will be triggered by parser completion events

    } catch (err) {
      console.error('Error in performEPGUpdate:', err)
      onErr(err)
    }
  }

  async waitCommitToComplete() {
    const timeoutMs = 60000;
    this.debugLog('Waiting for commit to complete...')
    const startTime = Date.now();
    while (Date.now() - startTime < timeoutMs) {
      if (!this._state.commitInProgress) {
        this.debugLog('Commit completed, proceeding with finalize')
        return true;
      }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    console.error('Timeout waiting for commit to complete!');
    return false;
  }

  async finalizeUpdate(newLastModified) {
    this.debugLog('🔵 finalizeUpdate() ENTRY POINT')
    const caller = new Error().stack.split('\n')[2]?.trim() || 'unknown'
    this.debugLog(`🔵 Starting finalizeUpdate... (called from: ${caller})`)
    this.debugLog(`🔵 Update session ID at finalizeUpdate: ${this._currentUpdateId}`)
    this.debugLog(`🔵 commitInProgress flag: ${this._state.commitInProgress}`)
    this.debugLog(`🔵 udb state: exists=${!!this.udb}, destroyed=${this.udb?.destroyed}, initialized=${this.udb?.initialized}, length=${this.udb?.length || 0}`)

    try {
      // CRITICAL: If commit is in progress, wait for it to complete
      await this.waitCommitToComplete();

      // Check if we have new data in temporary databases
      const hasNewData = this.udb && this.udb.length > 0

      this.debugLog(`Finalization check: udb exists=${!!this.udb}, udb.length=${this.udb?.length || 0}, hasNewData=${hasNewData}`)

      if (hasNewData) {
        this.debugLog(`New EPG data available: ${this.udb.length} programmes`)

        // Mark finalization as in progress BEFORE waiting to prevent new operations
        this._state.finalizationInProgress = true
        this.debugLog('Finalization marked as in progress, preventing new operations')

        // Wait for database operations to complete
        this.debugLog('Waiting for all database operations to complete...')
        if (this.udb && typeof this.udb.waitForOperations === 'function') {
          await this.udb.waitForOperations()
          this.debugLog('✅ Database operations completed')
        }

        if (this.insertSession && typeof this.insertSession.waitForOperations === 'function') {
          await this.insertSession.waitForOperations()
          this.debugLog('✅ InsertSession operations completed')
        }

        // Store old databases for later cleanup
        const oldDb = this.db
        const oldMdb = this.mdb

        // CRITICAL: Get file paths BEFORE moving databases
        // Use the actual file paths from the database instances
        const baseDbPath = this.file.endsWith('.jdb') ? this.file.slice(0, -4) : this.file
        const baseMdbPath = this.metaFile.endsWith('.jdb') ? this.metaFile.slice(0, -4) : this.metaFile
        const udbFilePath = this.udb?.normalizedFile
        const umdbFilePath = this.umdb?.normalizedFile
        const tempDbPath = udbFilePath || (baseDbPath + '.tmp.jdb')
        const tempMdbPath = umdbFilePath || (baseMdbPath + '.tmp.jdb')
        const tempIdxDbPath = udbFilePath?.replace('.jdb', '.idx.jdb') || (baseDbPath + '.tmp.idx.jdb')
        const tempIdxMdbPath = umdbFilePath?.replace('.jdb', '.idx.jdb') || (baseMdbPath + '.tmp.idx.jdb')
        const targetIdxDbPath = this.file.replace('.jdb', '.idx.jdb')
        const targetIdxMdbPath = this.metaFile.replace('.jdb', '.idx.jdb')

        this.debugLog(`BEFORE MOVE - Temp DB path: ${tempDbPath}`)
        this.debugLog(`BEFORE MOVE - Temp MDB path: ${tempMdbPath}`)
        this.debugLog(`BEFORE MOVE - Temp IDX DB path: ${tempIdxDbPath}`)
        this.debugLog(`BEFORE MOVE - Temp IDX MDB path: ${tempIdxMdbPath}`)

        // CRITICAL FIX: Save and close ALL 4 databases BEFORE rename to ensure files are fully written and handles released
        // 1. Save and close temporary databases (udb, umdb)
        await Promise.allSettled([
          this.db?.waitForOperations(),
          this.udb?.waitForOperations(),
          this.mdb?.waitForOperations(),
          this.umdb?.waitForOperations()
        ]).catch((err) => {
          console.warn('Failed to wait for operations on temporary databases:', err.message)
        })

        await Promise.allSettled([
          this.db?.close(),
          this.udb?.close(),
          this.mdb?.close(),
          this.umdb?.close()
        ]).catch((err) => {
          console.warn('Failed to close temporary databases:', err.message)
        })

        this.debugLog('✅ All 4 databases closed (auto-saved) and file handles released')

        this.db = null
        this.mdb = null
        this.udb = null
        this.umdb = null

        // Rename temporary files to final files
        try {
          // Use the paths we captured BEFORE moving the databases

          // Check if files exist before renaming
          const tempDbExists = await fs.access(tempDbPath).then(() => true).catch(() => false)
          const tempMdbExists = await fs.access(tempMdbPath).then(() => true).catch(() => false)

          // Rename main database files
          if (tempDbExists && tempDbPath !== this.file) {
            try {
              // Remove existing final files if they exist
              await fs.unlink(this.file).catch(() => { })
              await fs.unlink(targetIdxDbPath).catch(() => { })

              // Rename temporary files to final files
              await fs.rename(tempDbPath, this.file)
              await fs.rename(tempIdxDbPath, targetIdxDbPath)
            } catch (renameErr) {
              console.warn('Failed to rename main database files:', renameErr.message)
              // Try to copy as fallback
              try {
                await fs.copyFile(tempDbPath, this.file)
                await fs.copyFile(tempIdxDbPath, targetIdxDbPath)
                await fs.unlink(tempDbPath).catch(() => { })
                await fs.unlink(tempIdxDbPath).catch(() => { })
              } catch (copyErr) {
                console.error('Failed to copy main database files:', copyErr.message)
              }
            }
          } else if (!tempDbExists) {
            console.warn('Temporary main database file does not exist, skipping rename')
          }

          // Rename metadata database files
          if (tempMdbExists && tempMdbPath !== this.metaFile) {
            try {
              // Remove existing final files if they exist
              await fs.unlink(this.metaFile).catch(() => { })
              await fs.unlink(targetIdxMdbPath).catch(() => { })

              // Rename temporary files to final files
              await fs.rename(tempMdbPath, this.metaFile)
              await fs.rename(tempIdxMdbPath, targetIdxMdbPath)
            } catch (renameErr) {
              console.warn('Failed to rename metadata database files:', renameErr.message)
              // Try to copy as fallback
              try {
                await fs.copyFile(tempMdbPath, this.metaFile)
                await fs.copyFile(tempIdxMdbPath, targetIdxMdbPath)
                await fs.unlink(tempMdbPath).catch(() => { })
                await fs.unlink(tempIdxMdbPath).catch(() => { })
              } catch (copyErr) {
                console.error('Failed to copy metadata database files:', copyErr.message)
              }
            }
          } else if (!tempMdbExists) {
            console.warn('Temporary metadata database file does not exist, skipping rename')
          }

        } catch (fsErr) {
          console.error('Error renaming temporary files:', fsErr.message)
          // Continue with the process even if rename fails
        }

        // CRITICAL: Wait for filesystem to sync after rename operations
        // This ensures the renamed files are fully committed to disk before loading
        this.debugLog('⏳ Waiting 1 second for filesystem sync after rename...')
        await new Promise(resolve => setTimeout(resolve, 1000))

        // Create new database instances pointing to final files
        this.debugLog(`🔄 Creating new database instances for final files:`)
        this.debugLog(`   Programme DB: ${this.file}`)
        this.debugLog(`   Metadata DB: ${this.metaFile}`)

        this.db = this.databaseFactory.createProgrammeDB(this.file, {}, false)
        this.mdb = this.databaseFactory.createMetadataDB(this.metaFile, {}, false)

        // Initialize the new databases
        await this.databaseFactory.initializeDB(this.db)
        await this.databaseFactory.initializeDB(this.mdb)

        // CRITICAL: Verify that databases loaded correctly with data
        const dbLength = this.db?.length || 0
        const mdbLength = this.mdb?.length || 0
        this.debugLog(`✅ Database instances recreated - Programme DB length: ${dbLength}, Metadata DB length: ${mdbLength}`)

        if (dbLength === 0) {
          console.error('⚠️ WARNING: Programme database is empty after recreation!')
          console.error(`   File path: ${this.file}`)
          const fileExists = await fs.access(this.file).then(() => true).catch(() => false)
          console.error(`   File exists: ${fileExists}`)
        }

        // Clean up temporary files after successful rename
        try {

          // Remove temporary files if they still exist
          const tempDbFiles = [
            tempDbPath,
            tempIdxDbPath
          ]
          const tempMdbFiles = [
            tempMdbPath,
            tempIdxMdbPath
          ]

          for (const tempFile of [...tempDbFiles, ...tempMdbFiles]) {
            try {
              await fs.access(tempFile)
              await fs.unlink(tempFile)
              this.debugLog(`✅ Temporary file ${tempFile} removed`)
              // File removed successfully
            } catch (unlinkErr) {
              // File might not exist or already removed
            }
          }

        } catch (cleanupErr) {
          console.warn('Error cleaning up temporary files:', cleanupErr.message)
        }

        // Keep main database instance intact for curation process
        // Keep metadata database instance intact for curation process

        // CRITICAL: Save control keys BEFORE any database operations
        const lastModifiedAt = this.parserInstance?.getLastModified?.() || null
        await this.saveControlKeys(lastModifiedAt)

        // Save channels and terms from memory maps to database in batch
        await this._saveChannelsAndTermsInBatch()

        // NOTE: Do NOT close databases after update - keep them open for queries
        // JexiDB automatically persists data and doesn't need explicit close
        // Closing causes "Database is closed" errors when trying to query later
        this.debugLog('Update complete, keeping databases open for queries')

        // JexiDB databases remain open and ready for immediate queries

        // CRITICAL: Validate database AFTER all finalization is complete
        // This ensures the database points to the final file, not the temporary one
        this.debugLog('🔍 Validating database after all finalization is complete...')
        const isValid = await this._validateDatabaseAfterParserComplete()

        if (isValid) {
          await this.setReadyState('loaded')
          this.error = null
        } else {
          await this.setReadyState('error')
          this.error = 'EPG_NO_PROGRAMMES'
        }

        const ttlSeconds = typeof this.dataLiveWindow === 'number' && this.dataLiveWindow > 0
          ? this.dataLiveWindow
          : 24 * 3600

        await this.registerStorageArtifacts(ttlSeconds)

        // Reset finalization flag to allow new operations
        this._state.finalizationInProgress = false

        this.debugLog('Update completed successfully');

        // Clean up old databases after new ones are ready
        (async () => {
          try {
            // Wait much longer to ensure any pending save operations complete
            this.debugLog('Waiting before destroying old databases...')
            await new Promise(resolve => setTimeout(resolve, 10000)) // 10 second delay

            // Wait for operations before destroying
            if (oldDb && typeof oldDb.waitForOperations === 'function') {
              await oldDb.waitForOperations()
            }
            if (oldMdb && typeof oldMdb.waitForOperations === 'function') {
              await oldMdb.waitForOperations()
            }

            // CRITICAL FIX: Don't destroy old databases immediately
            // Keep them available for query operations
            this.debugLog('Keeping old databases available for query operations')

            // Use JexiDB native waitForOperations instead of manual writeBuffer checks
            if (oldDb) {
              this.debugLog('Waiting for old main database operations to complete...')
              try {
                await oldDb.waitForOperations()
                this.debugLog('Old main database operations completed')
              } catch (err) {
                console.warn('Error waiting for old main database operations:', err.message)
              }
            }

            if (oldMdb) {
              this.debugLog('Waiting for old metadata database operations to complete...')
              try {
                await oldMdb.waitForOperations()
                this.debugLog('Old metadata database operations completed')
              } catch (err) {
                console.warn('Error waiting for old metadata database operations:', err.message)
              }
            }

            // Only destroy old databases if they are truly unused and safe
            const canDestroyOldDb = !oldDb || (!oldDb.isSaving && oldDb.writeBuffer.length === 0)
            const canDestroyOldMdb = !oldMdb || (!oldMdb.isSaving && oldMdb.writeBuffer.length === 0)

            // CRITICAL: Don't destroy databases immediately - keep them for queries
            if (canDestroyOldDb && oldDb && typeof oldDb.destroy === 'function') {
              this.debugLog('Skipping old main database destruction - keeping for queries')
              // Don't destroy - keep available for queries
            } else if (oldDb) {
              console.warn(`Skipping old main database destruction - isSaving: ${oldDb.isSaving}, writeBuffer: ${oldDb.writeBuffer.length}`)
            }

            if (canDestroyOldMdb && oldMdb && typeof oldMdb.destroy === 'function') {
              this.debugLog('Skipping old metadata database destruction - keeping for queries')
              // Don't destroy - keep available for queries
            } else if (oldMdb) {
              console.warn(`Skipping old metadata database destruction - isSaving: ${oldMdb.isSaving}, writeBuffer: ${oldMdb.writeBuffer.length}`)
            }

            this.debugLog('Old databases kept available for query operations')
          } catch (cleanupErr) {
            console.warn('Error cleaning up old databases:', cleanupErr.message)
          }
        })(); // Execute immediately

        // Delayed destruction of old databases to allow queries to work
        (async () => {
          try {
            this.debugLog('Starting delayed destruction of old databases...')

            // Use JexiDB native waitForOperations instead of manual writeBuffer checks
            if (oldDb) {
              this.debugLog('Waiting for old main database operations to complete before delayed destruction...')
              try {
                await oldDb.waitForOperations()
                this.debugLog('Old main database operations completed before delayed destruction')
              } catch (err) {
                console.warn('Error waiting for old main database operations before delayed destruction:', err.message)
              }
            }

            if (oldMdb) {
              this.debugLog('Waiting for old metadata database operations to complete before delayed destruction...')
              try {
                await oldMdb.waitForOperations()
                this.debugLog('Old metadata database operations completed before delayed destruction')
              } catch (err) {
                console.warn('Error waiting for old metadata database operations before delayed destruction:', err.message)
              }
            }

            // Check if old databases are safe to destroy
            const canDestroyOldDb = !oldDb || (!oldDb.isSaving && oldDb.writeBuffer.length === 0)
            const canDestroyOldMdb = !oldMdb || (!oldMdb.isSaving && oldMdb.writeBuffer.length === 0)

            if (canDestroyOldDb && oldDb && typeof oldDb.destroy === 'function') {
              this.debugLog('Destroying old main database after delay...')
              await oldDb.destroy()
              this.debugLog('Old main database destroyed successfully after delay')
            } else if (oldDb) {
              console.warn(`Skipping delayed old main database destruction - isSaving: ${oldDb.isSaving}, writeBuffer: ${oldDb.writeBuffer.length}`)
            }

            if (canDestroyOldMdb && oldMdb && typeof oldMdb.destroy === 'function') {
              this.debugLog('Destroying old metadata database after delay...')
              await oldMdb.destroy()
              this.debugLog('Old metadata database destroyed successfully after delay')
            } else if (oldMdb) {
              console.warn(`Skipping delayed old metadata database destruction - isSaving: ${oldMdb.isSaving}, writeBuffer: ${oldMdb.writeBuffer.length}`)
            }

            this.debugLog('Delayed old databases cleanup completed')
          } catch (delayedCleanupErr) {
            console.warn('Error in delayed cleanup of old databases:', delayedCleanupErr.message)
          }
        })(); // Execute immediately

      } else {
        // No new data downloaded - check if we have existing valid data
        this.debugLog(`Checking existing data: db exists=${!!this.db}, db.length=${this.db?.length || 0}`)

        if (this.db && this.db.length > 0) {
          this.debugLog('No new EPG data downloaded, but existing database has valid entries')
          await this.setReadyState('loaded')
          this.error = null

          const ttlSeconds = typeof this.dataLiveWindow === 'number' && this.dataLiveWindow > 0
            ? this.dataLiveWindow
            : 24 * 3600
          await this.registerStorageArtifacts(ttlSeconds)
        } else {
          console.warn('No EPG data available (new or existing)')
          this.debugLog(`Setting error state: validEPG=${this.validEPG}`)
          this.debugLog(`EPG Debug Info:`)
          this.debugLog(`  - URL: ${this.url}`)
          this.debugLog(`  - DB exists: ${!!this.db}`)
          this.debugLog(`  - DB length: ${this.db?.length || 0}`)
          this.debugLog(`  - Received bytes: ${this.received}`)
          this.debugLog(`  - Error count: ${this.errorCount}`)
          this.debugLog(`  - Last error: ${this.error || 'none'}`)

          this.setReadyState('error')
          this.error = this.validEPG ? 'EPG_OUTDATED' : 'EPG_BAD_FORMAT'
          if (this.listenerCount('error')) this.emit('error', this.error)
        }

        // Clean up temporary databases
        // CRITICAL: Check if commit is in progress OR if insertSession exists
        // If insertSession exists, the parser's onEnd() callback may still execute and try to commit
        if (this._state.commitInProgress) {
          console.warn('🟡 Commit is in progress, skipping temporary database destruction to prevent race condition')
        } else if (this.insertSession) {
          console.warn('🟡 InsertSession exists, delaying udb destruction to allow onEnd() callback to execute')
          this.debugLog(`🟡 Will destroy udb after 10 seconds to give onEnd() time to execute`)
          // Delay destruction to give onEnd() callback time to execute
          setTimeout(async () => {
            if (this.udb && !this._state.commitInProgress) {
              this.debugLog('🔴 Delayed: Destroying udb in finalizeUpdate (NO NEW DATA PATH)')
              try {
                await this.udb.destroy()
                this.udb = null
              } catch (err) {
                console.warn('Error destroying udb in delayed cleanup:', err.message)
              }
            }
            if (this.umdb && !this._state.commitInProgress) {
              this.debugLog('🔴 Delayed: Destroying umdb in finalizeUpdate (NO NEW DATA PATH)')
              try {
                await this.umdb.destroy()
                this.umdb = null
              } catch (err) {
                console.warn('Error destroying umdb in delayed cleanup:', err.message)
              }
            }
          }, 10000) // 10 second delay
        } else {
          if (this.udb) {
            this.debugLog('🔴 Destroying udb in finalizeUpdate (NO NEW DATA PATH - no insertSession)')
            this.debugLog(`🔴 Update ID: ${this._currentUpdateId}, commitInProgress: ${this._state.commitInProgress}`)
            await this.udb.destroy()
            this.udb = null
          }
          if (this.umdb) {
            this.debugLog('🔴 Destroying umdb in finalizeUpdate (NO NEW DATA PATH - no insertSession)')
            await this.umdb.destroy()
            this.umdb = null
          }
        }
      }

      // Update last modified timestamp if provided
      if (newLastModified) {
        // Store this in database or storage for future reference
        // this.debugLog('Updating last modified timestamp:', newLastModified)
      }

    } catch (err) {
      console.error('Error in finalizeUpdate:', err.message || err)
      console.error(err.stack, typeof (console), typeof (console.error))
      console.error(err)

      // Set appropriate error state
      this.setReadyState('error')
      this.error = err.message ? `Update failed: ${err.message}` : 'Update failed'

      // Reset finalization flag even on error to allow new operations
      this._state.finalizationInProgress = false

      // Clean up any remaining temporary databases with longer wait for save operations
      try {
        // CRITICAL: Check if commit is in progress
        if (this._state.commitInProgress) {
          console.warn('🟡 Commit is in progress in ERROR HANDLER, skipping temporary database destruction to prevent race condition')
        } else {
          if (this.udb) {
            this.debugLog('🔴 Destroying udb in finalizeUpdate ERROR HANDLER')
            this.debugLog(`🔴 Update ID: ${this._currentUpdateId}, commitInProgress: ${this._state.commitInProgress}`)
            // Wait a bit to ensure any pending save operations complete
            await new Promise(resolve => setTimeout(resolve, 1000))
            await this.udb.destroy()
            this.udb = null
          }
          if (this.umdb) {
            this.debugLog('🔴 Destroying umdb in finalizeUpdate ERROR HANDLER')
            // Wait a bit to ensure any pending save operations complete
            await new Promise(resolve => setTimeout(resolve, 1000))
            await this.umdb.destroy()
            this.umdb = null
          }
        }
      } catch (cleanupErr) {
        console.warn('Error cleaning up temporary databases:', cleanupErr.message)
      }

      if (this.listenerCount('error')) this.emit('error', this.error)
    }
  }


  // ===== Batch Processing Methods =====

  /**
   * Periodic flush that saves to database but keeps Map intact
   * This prevents OOM while avoiding duplicates by tracking saved IDs
   */
  async _flushChannelsAndTermsPartial(type = 'both') {
    if (!this.mdb || !this.mdb.initialized || this.mdb.destroyed) {
      return // Skip if database not ready
    }
    
    if (this._state.destroyed || this._state.finalizationInProgress) {
      return // Skip if EPG is being destroyed
    }
    
    try {
      const shouldFlushChannels = (type === 'channels' || type === 'both') && this._channelMap.size > 0
      const shouldFlushTerms = (type === 'terms' || type === 'both') && this._termsMap.size > 0
      
      if (shouldFlushChannels) {
        // Only flush channels that haven't been saved yet
        const channelsToFlush = Array.from(this._channelMap.values())
          .filter(ch => !this._savedChannelIds.has(ch.id))
        
        if (channelsToFlush.length > 0) {
          await this.mdb.insertBatch(channelsToFlush)
          
          // Mark as saved only after successful insertion
          for (const channelData of channelsToFlush) {
            this._savedChannelIds.add(channelData.id)
          }
          
          this.debugLog(`Periodic flush: saved ${channelsToFlush.length} channels (${this._channelMap.size - channelsToFlush.length} already saved)`)
        }
      }
      
      if (shouldFlushTerms) {
        // Only flush terms that haven't been saved yet
        const termsToFlush = Array.from(this._termsMap.values())
          .filter(t => !this._savedTermIds.has(t.id))
        
        if (termsToFlush.length > 0) {
          await this.mdb.insertBatch(termsToFlush)
          
          // Mark as saved only after successful insertion
          for (const termData of termsToFlush) {
            this._savedTermIds.add(termData.id)
          }
          
          this.debugLog(`Periodic flush: saved ${termsToFlush.length} terms (${this._termsMap.size - termsToFlush.length} already saved)`)
        }
      }
    } catch (err) {
      console.warn('Periodic flush error:', err.message)
      // Don't throw - allow retry at final save
    }
  }

  async _saveChannelsAndTermsInBatch() {
    // CRITICAL: finalizeUpdate() should have already ensured the database is ready
    // This method only validates and saves, it doesn't fix/recreate anything
    
    const targetDb = this.mdb // Use main metadata database

    // Validate database exists and is ready (should be after finalizeUpdate)
    if (!targetDb) {
      console.error('🚨 FLAG: No metadata database available for batch save')
      console.error('🚨 This should not happen after finalizeUpdate() - database should exist')
      throw new Error('CRITICAL: No metadata database available - finalizeUpdate() should have created it')
    }

    if (targetDb.destroyed) {
      console.error('🚨 FLAG: Metadata database is destroyed in _saveChannelsAndTermsInBatch')
      console.error('🚨 This should not happen after finalizeUpdate() - database should be valid')
      throw new Error('CRITICAL: Metadata database is destroyed - finalizeUpdate() should have ensured valid database')
    }

    if (!targetDb.initialized) {
      console.error('🚨 FLAG: Metadata database is not initialized in _saveChannelsAndTermsInBatch')
      console.error('🚨 This should not happen after finalizeUpdate() - database should be initialized')
      throw new Error('CRITICAL: Metadata database is not initialized - finalizeUpdate() should have initialized it')
    }

    // Verify database is connected to correct file (should be after finalizeUpdate)
    const targetDbFilePath = targetDb.normalizedFile
    if (targetDbFilePath !== this.metaFile) {
      console.warn(`⚠️ FLAG: Database file path mismatch: ${targetDbFilePath} !== ${this.metaFile}`)
      console.warn('⚠️ This should not happen after finalizeUpdate() - database may be pointing to wrong file')
    }

    // Test database functionality (just to flag issues)
    try {
      await targetDb.count()
      this.debugLog('✅ Database functionality test passed')
    } catch (testErr) {
      console.error('🚨 FLAG: Database functionality test failed:', testErr.message)
      console.error('🚨 This should not happen after finalizeUpdate() - database should be functional')
      throw new Error(`CRITICAL: Database functionality test failed - finalizeUpdate() should have ensured valid database: ${testErr.message}`)
    }

    try {
      this.debugLog(`Saving ${this._channelMap.size} channels and ${this._termsMap.size} terms to database in batch...`)

      // Process channels in batch (only those not already saved)
      if (this._channelMap.size > 0) {
        const channelsToProcess = Array.from(this._channelMap.values())
          .filter(ch => !this._savedChannelIds.has(ch.id))
        this.debugLog(`Processing ${channelsToProcess.length} channels in batch (${this._channelMap.size - channelsToProcess.length} already saved)...`)

        if (channelsToProcess.length > 0) {
          try {
            await targetDb.insertBatch(channelsToProcess)
            this.debugLog(`Batch inserted ${channelsToProcess.length} channels`)
            
            // Mark as saved only after successful insertion
            for (const channelData of channelsToProcess) {
              this._savedChannelIds.add(channelData.id)
            }
          } catch (channelErr) {
            console.error('🚨 FLAG: Error inserting channels in batch:', channelErr.message)
            console.error('🚨 This should not happen after finalizeUpdate() - database should be functional')
            // Try individual inserts as fallback (shouldn't be needed, but helps diagnose)
            try {
              const successfullyInserted = []
              for (const channel of channelsToProcess) {
                try {
                  await targetDb.insert(channel)
                  successfullyInserted.push(channel)
                } catch (individualErr) {
                  console.error(`Failed to insert individual channel ${channel.id}:`, individualErr.message)
                  // Continue with others
                }
              }
              // Mark only successfully inserted channels
              for (const channelData of successfullyInserted) {
                this._savedChannelIds.add(channelData.id)
              }
              this.debugLog(`⚠️ Fallback: Inserted ${successfullyInserted.length}/${channelsToProcess.length} channels individually (batch insert failed)`)
              if (successfullyInserted.length < channelsToProcess.length) {
                console.warn(`⚠️ Some channels failed to insert: ${channelsToProcess.length - successfullyInserted.length} failed`)
              }
            } catch (fallbackErr) {
              console.error('🚨 FLAG: Fallback channel insert also failed:', fallbackErr.message)
              throw new Error(`CRITICAL: Failed to insert channels - finalizeUpdate() should have ensured functional database: ${fallbackErr.message}`)
            }
          }
        }
      }

      // Process terms in batch (only those not already saved)
      if (this._termsMap.size > 0) {
        const termsToProcess = Array.from(this._termsMap.values())
          .filter(t => !this._savedTermIds.has(t.id))
        this.debugLog(`Processing ${termsToProcess.length} terms in batch (${this._termsMap.size - termsToProcess.length} already saved)...`)

        if (termsToProcess.length > 0) {
          try {
            await targetDb.insertBatch(termsToProcess)
            this.debugLog(`Batch inserted ${termsToProcess.length} terms`)
            
            // Mark as saved only after successful insertion
            for (const termData of termsToProcess) {
              this._savedTermIds.add(termData.id)
            }
          } catch (termsErr) {
            console.error('🚨 FLAG: Error inserting terms in batch:', termsErr.message)
            console.error('🚨 This should not happen after finalizeUpdate() - database should be functional')
            // Try individual inserts as fallback (shouldn't be needed, but helps diagnose)
            try {
              const successfullyInserted = []
              for (const term of termsToProcess) {
                try {
                  await targetDb.insert(term)
                  successfullyInserted.push(term)
                } catch (individualErr) {
                  console.error(`Failed to insert individual term ${term.id}:`, individualErr.message)
                  // Continue with others
                }
              }
              // Mark only successfully inserted terms
              for (const termData of successfullyInserted) {
                this._savedTermIds.add(termData.id)
              }
              this.debugLog(`⚠️ Fallback: Inserted ${successfullyInserted.length}/${termsToProcess.length} terms individually (batch insert failed)`)
              if (successfullyInserted.length < termsToProcess.length) {
                console.warn(`⚠️ Some terms failed to insert: ${termsToProcess.length - successfullyInserted.length} failed`)
              }
            } catch (fallbackErr) {
              console.error('🚨 FLAG: Fallback terms insert also failed:', fallbackErr.message)
              throw new Error(`CRITICAL: Failed to insert terms - finalizeUpdate() should have ensured functional database: ${fallbackErr.message}`)
            }
          }
        }
      }

      // Clear memory maps and saved IDs tracking after successful batch save
      this._channelMap.clear()
      this._termsMap.clear()
      this._savedChannelIds.clear()
      this._savedTermIds.clear()

      this.debugLog('Batch save completed successfully')

    } catch (err) {
      console.error('Error in batch save:', err.message)
      throw err
    }
  }

  // ===== State Management Methods =====

  setReadyState(state) {
    if (this.readyState !== state) {
      const oldState = this.readyState
      this.readyState = state
      this.debugLog(`State changed from ${oldState} to ${state}`)
      this.emit('stateChange', { from: oldState, to: state })
    }
  }

  // ===== Abstract methods to be implemented by subclasses =====

  async programme(programme) {
    throw new Error('programme method must be implemented by subclass')
  }

  async channel(ch) {
    throw new Error('channel method must be implemented by subclass')
  }

  // ===== Cleanup methods =====

  async cleanup() {
    this.debugLog('Cleaning up EPG resources...')

    // Mark as destroyed to prevent new operations
    this._state.destroyed = true

    // CRITICAL: Stop parser and request FIRST to prevent new data insertion
    this.debugLog('🛑 Stopping parser and request to prevent new data insertion...')
    if (this.parser && typeof this.parser.destroy === 'function') {
      this.debugLog('🛑 Destroying parser...')
      this.parser.destroy()
    }
    if (this.request && typeof this.request.destroy === 'function') {
      this.debugLog('🛑 Destroying request...')
      this.request.destroy()
    }

    // Wait for any pending operations to complete
    if (this._state.updating) {
      this.debugLog('Waiting for ongoing update to complete...')
      // Give a reasonable timeout for operations to complete
      const maxWait = 5000 // 5 seconds
      const start = Date.now()
      while (this._state.updating && (Date.now() - start) < maxWait) {
        await new Promise(resolve => setTimeout(resolve, 100))
      }
      if (this._state.updating) {
        console.warn('Update operation did not complete within timeout, proceeding with cleanup')
      }
    }

    // Clear all caches
    this.cacheManager.destroy()

    // Clear memory maps and saved IDs tracking
    this._channelMap.clear()
    this._termsMap.clear()
    this._savedChannelIds.clear()
    this._savedTermIds.clear()

    // Stop memory monitoring
    this.memoryMonitor.destroy()

    // CRITICAL: Save databases before destroying to prevent writeBuffer bugs
    const databases = [this.db, this.mdb, this.udb, this.umdb]
    for (const db of databases) {
      if (db && typeof db.save === 'function') {
        // Use JexiDB native waitForOperations instead of manual writeBuffer checks
        this.debugLog('Waiting for database operations to complete before cleanup...')
        try {
          await db.waitForOperations()
          this.debugLog('Database operations completed before cleanup')
        } catch (waitErr) {
          console.warn('Error waiting for database operations before cleanup:', waitErr.message)
        }
      }
    }

    // Now destroy databases
    for (const db of databases) {
      if (db && typeof db.destroy === 'function') {
        try {
          await db.destroy()
        } catch (err) {
          console.warn('Error destroying database:', err.message)
        }
      }
    }

    // Reset state
    this.parser = null
    this.request = null
    this.db = null
    this.mdb = null
    this.udb = null
    this.umdb = null

    this.debugLog('EPG cleanup completed')
  }

  async _validateDatabaseAfterParserComplete() {
    this.debugLog('🔍 Validating database after parser completion...')

    try {
      const now = Math.floor(Date.now() / 1000)
      console.debug('Checking database validity after parser complete, current timestamp:', now)

      // Ensure database is initialized before querying
      if (!this.db.initialized) {
        this.debugLog('Database not initialized, initializing now...')
        await this.databaseFactory.initializeDB(this.db)
      }

      // Query for current and future programmes (not just future)
      // Accept programmes that end within the last 24 hours or in the future
      const validCount = await this.db.count({ end: { '>': now } })
      console.debug(`Found ${validCount} valid programmes (current and future) after parser complete`)

      // CRITICAL: Require minimum number of programmes to prevent premature finalization
      const minProgrammes = 36 // Minimum programmes required for valid EPG

      if (validCount >= minProgrammes) {
        this.debugLog(`✅ Found ${validCount} valid programmes (>= ${minProgrammes}), EPG is valid`)
        return true
      } else if (validCount > 0) {
        this.debugLog(`❌ Found only ${validCount} valid programmes (< ${minProgrammes}), EPG is insufficient`)
        // Mark as error due to insufficient data
        this.setReadyState('error')
        this.error = 'EPG_NO_PROGRAMMES'
        this.emit('error', new Error(`Insufficient programmes: ${validCount} < ${minProgrammes}`))
        return false
      } else {
        // Fallback: check for any programmes at all
        const totalCount = await this.db.count()
        console.debug(`Total programmes in database after parser complete: ${totalCount}`)

        if (totalCount >= minProgrammes) {
          this.debugLog(`✅ Found ${totalCount} programmes (including past, >= ${minProgrammes}), EPG is valid`)
          return true
        } else if (totalCount > 0) {
          this.debugLog(`❌ Found only ${totalCount} programmes (< ${minProgrammes}), EPG is insufficient`)
          // Mark as error due to insufficient data
          this.setReadyState('error')
          this.error = 'EPG_NO_PROGRAMMES'
          this.emit('error', new Error(`Insufficient programmes: ${totalCount} < ${minProgrammes}`))
          return false
        } else {
          console.warn('❌ No programmes found in database after parser complete')
          // Mark as error due to no data
          this.setReadyState('error')
          this.error = 'EPG_NO_PROGRAMMES'
          this.emit('error', new Error('No programmes found in database'))
          return false
        }
      }

    } catch (dbError) {
      console.error('Database validation error after parser complete:', dbError)
      // Mark as error due to database issues
      this.setReadyState('error')
      this.error = 'EPG_BAD_FORMAT'
      this.emit('error', dbError)
      return false
    }
  }
}
