import { EventEmitter } from 'node:events'
import { time } from '../utils/utils.js'
import fs from 'node:fs/promises'

// Use the safe wrapper instead of log directly
import { DatabaseFactory } from './database/DatabaseFactory.js'
import { ParserFactory } from './parser/ParserFactory.js'
import { CacheManager } from './cache/CacheManager.js'
import { MemoryMonitor } from './memory/MemoryMonitor.js'
import { EPG_CONFIG } from './config.js'

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

    // Configuration properties
    this.debug = false
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
    const db = this.databaseFactory.createProgrammeDB(tempPath, {}, true)

    // CRITICAL: Initialize database before any operations
    try {
      await db.init()
      // Temporary programme database initialized
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
    console.log(`Creating temporary metadata database at: ${tempPath}`)
    const db = this.databaseFactory.createMetadataDB(tempPath, {}, true)
    console.log(`Temporary metadata database created: ${!!db}`)

    // CRITICAL: Initialize database before any operations
    try {
      await db.init()
      console.log('Temporary metadata database initialized')
    } catch (initErr) {
      console.error('Failed to initialize temporary metadata database:', initErr.message)
      throw initErr
    }

    return db
  }

  async ensureMDB() {
    if (!this.mdb) {
      console.error('Metadata DB not initialized')
      throw new Error('Metadata DB not initialized')
    }

    // FIXED: Add protection against multiple concurrent initializations
    if (this._state.mdbInit) {
      return // Already initialized, skip
    }

    // FIXED: Add mutex to prevent concurrent initialization
    if (this._state.mdbInitializing) {
      console.log('Metadata DB initialization already in progress, waiting...')
      // Wait for ongoing initialization to complete
      while (this._state.mdbInitializing && !this._state.mdbInit) {
        await new Promise(resolve => setTimeout(resolve, 10))
      }
      return
    }

    this._state.mdbInitializing = true

    try {
      console.log('Initializing metadata DB...')
      await this.databaseFactory.initializeDB(this.mdb)

      // Validate database after initialization
      const dbLength = this.mdb.length
      if (typeof dbLength !== 'number' || dbLength < 0 || dbLength > 10000000) {
        console.error(`Corrupted metadata DB detected after init, length: ${dbLength}`)
        throw new Error(`Corrupted database length: ${dbLength}`)
      }

      this._state.mdbInit = true
      console.log('Metadata DB initialized successfully')
      console.log(`Metadata DB length: ${this.mdb.length}`)
    } catch (err) {
        console.error('Error initializing metadata DB:', err)

        // If initialization fails due to corruption, try to recover
        if (err.message.includes('Corrupted database') || err.message.includes('out of range')) {
          console.log('Attempting database recovery...')
          try {
            await this.recoverMetadataDB()
            // Try initialization again after recovery
            await this.databaseFactory.initializeDB(this.mdb)
            this._state.mdbInit = true
            console.log('Metadata DB recovered and initialized successfully')
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
    console.log('Starting metadata DB recovery...')

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

      console.log('Recreating metadata DB at:', this.metaFile)
      this.mdb = this.createMetadataDatabase(true) // clear: true

      console.log('Metadata DB recovery completed')

    } catch (err) {
      console.error('Metadata DB recovery failed:', err.message)
      throw err
    }
  }

  async reinitializeMetadataDB() {
    console.log('Reinitializing metadata database...')

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

      console.log('Metadata database reinitialized successfully')

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
      console.log(`EPG destroyed or finalization started during channel processing, skipping upsert for: ${id} (destroyed: ${this._state.destroyed}, finalizing: ${this._state.finalizationInProgress})`)
      return
    }

    try {
      // Check cache first to avoid processing already processed channels
      if (this.cacheManager.hasChannel(id)) {
        return // Already processed this channel
      }

      // Store channel in memory map instead of immediate DB operation
      const channelData = { _type: 'channel', id, name, _created: time() }
      if (icon) channelData.icon = icon

      this._channelMap.set(id, channelData)

      // Update cache
      this.cacheManager.setChannel(id, { name, icon })

      // Debug logging disabled to reduce verbosity
      // if (this._channelMap.size % 500 === 0) {
      //   console.log(`Added channel ${id} to memory map (total: ${this._channelMap.size})`)
      // }

    } catch (err) {
      console.error(`Error processing channel ${id}:`, err.message)
    }
  }

  async upsertTerms(id, terms, retryCount = 0) {
    if (!id) return

    // Check if EPG is being destroyed or finalization is in progress
    if (this._state.destroyed || this._state.finalizationInProgress) {
      console.log(`EPG destroyed or finalization started during terms processing, skipping upsert for: ${id} (destroyed: ${this._state.destroyed}, finalizing: ${this._state.finalizationInProgress})`)
      return
    }

    try {
      const norm = (terms || []).map(String)

      // Store terms in memory map instead of immediate DB operation
      const termsData = { _type: 'terms', id, terms: norm, _created: time() }

      this._termsMap.set(id, termsData)

      // Update cache
      this.cacheManager.setTerms(id, norm)

      // Debug logging disabled to reduce verbosity
      // if (this._termsMap.size % 500 === 0) {
      //   console.log(`Added terms for ${id} to memory map (total: ${this._termsMap.size})`)
      // }

    } catch (err) {
      console.error(`Error processing terms for ${id}:`, err.message)
    }
  }

  async getAllTerms() {
    if (this.cacheManager.isAllTermsLoaded()) {
      return this.cacheManager.getAllTerms()
    }

    console.log('getAllTerms() called, ensuring metadata DB...')
    await this.ensureMDB()

    console.log('Querying terms from metadata DB...')

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

      console.log(`Found ${terms.length} terms in metadata DB`)

      // Populate cache
      for (const term of terms) {
        if (term.id && Array.isArray(term.terms)) {
          this.cacheManager.setTerms(term.id, term.terms)
        }
      }

      this.cacheManager.setAllTermsLoaded(true)
      console.log(`Terms cache populated with ${this.cacheManager.getAllTerms().size} entries`)

      return this.cacheManager.getAllTerms()

    } catch (err) {
      console.error('Error in getAllTerms:', err.message)

      // If query fails, try to recover by clearing the database
      try {
        console.log('Attempting database recovery...')
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

        console.log('Database recovery completed, returning empty terms cache')
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
    console.log('Using MAG parser for:', this.url)

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

    // Start the parser
    this.parserInstance.start()
  }

  async setupXMLParser(onErr, now) {
    console.log('Setting up XML parser for:', this.url)

    // Get last modified date for conditional request
    const { lastModifiedAt } = await this.getControlKeys()

    const callbacks = {
      onProgramme: (programme) => this.programme(programme),
      onChannel: (ch) => this.channel(ch),
      onError: onErr,
      onProgress: (received) => {
        this.received = received
        this.bytesDownloaded = received
      },
      onStatus: (statusCode) => {
        this.statusCode = statusCode
      },
      lastModified: lastModifiedAt, // Pass last modified for conditional request
      onEnd: () => {
        console.log('🟣 Parser.onEnd() CALLED - Start of callback execution')
        console.log(`🟣 onEnd: udb state AT ENTRY: exists=${!!this.udb}, destroyed=${this.udb?.destroyed}, length=${this.udb?.length || 0}`)
        console.log('Parser ended, finalizing insert session and calling finalizeUpdate')

        // Capture the update ID at the time onEnd is called
        const updateId = this._currentUpdateId
        console.log(`🟣 onEnd called for update session: ${updateId}`)

        // Wait for any pending channel processing to complete before finalizing
        const waitForPendingOperations = async () => {
          // Verify this is still the same update session
          if (this._currentUpdateId !== updateId) {
            console.warn(`Update session changed (was ${updateId}, now ${this._currentUpdateId}), skipping finalization`)
            return
          }

          // Wait for parser to completely stop processing
          console.log('Waiting for parser to completely stop processing...')
          if (this.parser) {
            if (this.parser.destroyed || this.parser.writableEnded) {
              console.log('✅ Parser already ended (destroyed or writableEnded)')
            } else {
              console.log('Parser still active, waiting for end event...')
              await new Promise((resolve) => {
                const onEnd = () => {
                  console.log('✅ Parser end event received')
                  this.parser.removeListener('end', onEnd)
                  resolve()
                }
                this.parser.once('end', onEnd)
              })
            }
          } else {
            console.log('✅ No parser to wait for')
          }

          // Wait for ALL database operations (udb, umdb, db, mdb)
          console.log('Waiting for all database operations to complete...')
          
          if (this.udb && typeof this.udb.waitForOperations === 'function') {
            console.log('Waiting for udb operations...')
            await this.udb.waitForOperations()
            console.log('✅ udb operations completed')
          }
          
          if (this.umdb && typeof this.umdb.waitForOperations === 'function') {
            console.log('Waiting for umdb operations...')
            await this.umdb.waitForOperations()
            console.log('✅ umdb operations completed')
          }
          
          if (this.db && typeof this.db.waitForOperations === 'function') {
            console.log('Waiting for db operations...')
            await this.db.waitForOperations()
            console.log('✅ db operations completed')
          }
          
          if (this.mdb && typeof this.mdb.waitForOperations === 'function') {
            console.log('Waiting for mdb operations...')
            await this.mdb.waitForOperations()
            console.log('✅ mdb operations completed')
          }

          // Wait for insertSession operations
          if (this.insertSession && typeof this.insertSession.waitForOperations === 'function') {
            console.log('Waiting for insertSession operations...')
            await this.insertSession.waitForOperations()
            console.log('✅ InsertSession operations completed')
          }

          // Finalize the insert session before finalizing the update
          if (this.insertSession && typeof this.insertSession.commit === 'function') {
            try {
              console.log('🔵 onEnd: About to commit insertSession')
              console.log(`🔵 onEnd: Update ID check - current: ${this._currentUpdateId}, onEnd: ${updateId}`)
              console.log(`🔵 onEnd: udb state BEFORE checks: exists=${!!this.udb}, destroyed=${this.udb?.destroyed}, length=${this.udb?.length || 0}`)

              // CRITICAL: Verify this is still the same update session
              if (this._currentUpdateId !== updateId) {
                console.warn(`Update session changed during commit, cannot proceed (was ${updateId}, now ${this._currentUpdateId})`)
                onErr(new Error('Update session changed before commit'))
                return
              }

              // CRITICAL: Set commit flag to prevent udb destruction
              this._state.commitInProgress = true
              this._state.commitStartTime = Date.now() // Track when commit started
              console.log('🔵 Commit flag set - udb is now protected from destruction')
              
              // CRITICAL: Only create InsertSession if we have data to commit
              if (!this.insertSession && this.udb && this.udb.length > 0) {
                console.log('🔵 Creating InsertSession for commit - data available')
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

              console.log(`Before commit: udb.length=${this.udb?.length || 0}, insertSession.totalInserted=${this.insertSession.totalInserted || 0}`)
              console.log(`Database state: exists=${!!this.udb}, destroyed=${this.udb?.destroyed}, initialized=${this.udb?.initialized}`)

              // Commit the insert session using JexiDB native methods
              console.log('🔵 Starting commit process...')
              
              try {                
                // Now commit the session
                await this.insertSession.commit()
                console.log('✅ Commit completed successfully')
                
                // Clear commit flag after successful commit
                this._state.commitInProgress = false
                console.log('Commit flag cleared - finalization can now proceed')
                
              } catch (commitErr) {
                console.error('❌ Commit failed:', commitErr.message)
                this._state.commitInProgress = false
                throw commitErr
              }

              console.log(`After commit: udb.length=${this.udb?.length || 0}, insertSession.totalInserted=${this.insertSession.totalInserted || 0}`)
              console.log('Insert session committed successfully')

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
        const fetchControl = await this.mdb.find({ key: 'fetchCtrlKey' }, { limit: 1 })
        const modifiedControl = await this.mdb.find({ key: 'lastmCtrlKey' }, { limit: 1 })

        const lastFetchedAt = fetchControl.length > 0 ? parseInt(fetchControl[0].value) : 0
        const lastModifiedAt = modifiedControl.length > 0 ? modifiedControl[0].value : null

        console.log(`Control keys retrieved: lastFetchedAt=${lastFetchedAt}, lastModifiedAt=${lastModifiedAt}`)
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
      console.log('Should update: No data exists')
      return true
    }

    // Update if enough time has passed
    const shouldUpdateByTime = timeSinceLastUpdate > this.autoUpdateIntervalSecs
    // console.log(`Update check: timeSinceLastUpdate=${timeSinceLastUpdate}s, autoUpdateIntervalSecs=${this.autoUpdateIntervalSecs}s, shouldUpdateByTime=${shouldUpdateByTime}`)

    return shouldUpdateByTime
  }

  async setupUpdateEnvironment() {
    console.log('Setting up update environment')
    console.log(`Starting EPG update for: ${this.url}`)
    console.log(`Current state: validEPG=${this.validEPG}, errorCount=${this.errorCount}`)

    // Create unique identifier for this update session
    this._currentUpdateId = Date.now() + Math.random()
    console.log(`Update session ID: ${this._currentUpdateId}`)

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
      console.log('Temporary programme database initialized successfully')
    } catch (udbErr) {
      console.error('Failed to initialize temporary programme database:', udbErr.message)
      throw udbErr
    }

    try {
      await this.databaseFactory.initializeDB(this.umdb)
      console.log('Temporary metadata database initialized successfully')
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
      console.log('InsertSession initialized successfully')
    } catch (err) {
      console.error('Failed to initialize InsertSession:', err.message)
      this.insertSession = null
    }

    // Reset update state
    this.validEPG = false
    this.received = 0
    this.errorCount = 0

    console.log('Update environment setup complete')
  }

  async cleanCorruptedControls() {
    // Clean up any corrupted control data
    console.log('Cleaning corrupted controls')
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

      console.log(`Control keys saved: fetchCtrlKey=${now}, lastmCtrlKey=${lastModifiedAt}`)
    } catch (err) {
      console.error('CRITICAL: Error saving control keys:', err.message)
      throw err // Don't silence the error - let it propagate to detect flow issues
    }
  }

  async doUpdate() {
    console.log(`Starting update for: ${this.url}`)

    if (!(await this.validatePreConditions())) return

    this.isUpdating = true

    try {
      await this.ensureDatabasesInitialized()

      const { lastFetchedAt, lastModifiedAt } = await this.getControlKeys()

      if (!this.shouldUpdate(lastFetchedAt)) {
        console.log('Update not needed, skipping')

        // Check if we have valid data with sufficient future programmes
        if (this.db && this.db.length > 0) {
          const now = Date.now() / 1000
          const futureCount = await this.db.count({ e: { '>': now } }).catch(() => 0)
          console.log(`EPG has ${futureCount} future programmes`)
          
          if (futureCount >= 36) {
            console.log('Sufficient future programmes, marking as loaded')
            this.setReadyState('loaded')
            this.error = null
            return
          } else {
            console.log(`Insufficient future programmes (${futureCount} < 36), forcing update anyway`)
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

            console.log(`${errorType} Debug Info:`)
            console.log(`  - URL: ${this.url}`)
            console.log(`  - DB exists: ${!!this.db}`)
            console.log(`  - DB length: ${this.db?.length || 0}`)
            console.log(`  - Received bytes: ${this.received}`)
            console.log(`  - Error count: ${this.errorCount}`)
            console.log(`  - Error count limit: ${this.errorCountLimit}`)
            console.log(`  - Valid EPG: ${this.validEPG}`)
            console.log(`  - Is Network Error: ${!!err?.isNetworkError}`)
            console.log(`  - Is HTTP Error: ${!!err?.isHttpError}`)
            console.log(`  - Status Code: ${err?.statusCode || 'N/A'}`)

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
    console.log('Starting EPG update process')

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
    console.log('Waiting for commit to complete...')
    const startTime = Date.now();
    while (Date.now() - startTime < timeoutMs) {
      if (!this._state.commitInProgress) {
        console.log('Commit completed, proceeding with finalize')
        return true;
      }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    console.error('Timeout waiting for commit to complete!');
    return false;
  }

  async finalizeUpdate(newLastModified) {
    console.log('🔵 finalizeUpdate() ENTRY POINT')
    const caller = new Error().stack.split('\n')[2]?.trim() || 'unknown'
    console.log(`🔵 Starting finalizeUpdate... (called from: ${caller})`)
    console.log(`🔵 Update session ID at finalizeUpdate: ${this._currentUpdateId}`)
    console.log(`🔵 commitInProgress flag: ${this._state.commitInProgress}`)
    console.log(`🔵 udb state: exists=${!!this.udb}, destroyed=${this.udb?.destroyed}, initialized=${this.udb?.initialized}, length=${this.udb?.length || 0}`)

    try {
      // CRITICAL: If commit is in progress, wait for it to complete
      await this.waitCommitToComplete();

      // Check if we have new data in temporary databases
      const hasNewData = this.udb && this.udb.length > 0

      console.log(`Finalization check: udb exists=${!!this.udb}, udb.length=${this.udb?.length || 0}, hasNewData=${hasNewData}`)

      if (hasNewData) {
        console.log(`New EPG data available: ${this.udb.length} programmes`)

        // Mark finalization as in progress BEFORE waiting to prevent new operations
        this._state.finalizationInProgress = true
        console.log('Finalization marked as in progress, preventing new operations')

        // Wait for database operations to complete
        console.log('Waiting for all database operations to complete...')
        if (this.udb && typeof this.udb.waitForOperations === 'function') {
          await this.udb.waitForOperations()
          console.log('✅ Database operations completed')
        }

        if (this.insertSession && typeof this.insertSession.waitForOperations === 'function') {
          await this.insertSession.waitForOperations()
          console.log('✅ InsertSession operations completed')
        }

        // Store old databases for later cleanup
        const oldDb = this.db
        const oldMdb = this.mdb

        // CRITICAL: Get file paths BEFORE moving databases
        // Use the actual file paths from the database instances
        const baseDbPath = this.file.endsWith('.jdb') ? this.file.slice(0, -4) : this.file
        const baseMdbPath = this.metaFile.endsWith('.jdb') ? this.metaFile.slice(0, -4) : this.metaFile
        const tempDbPath = this.udb?.filePath || (baseDbPath + '.tmp.jdb')
        const tempMdbPath = this.umdb?.filePath || (baseMdbPath + '.tmp.jdb')
        const tempIdxDbPath = this.udb?.filePath?.replace('.jdb', '.idx.jdb') || (baseDbPath + '.tmp.idx.jdb')
        const tempIdxMdbPath = this.umdb?.filePath?.replace('.jdb', '.idx.jdb') || (baseMdbPath + '.tmp.idx.jdb')
        const targetIdxDbPath = this.file.replace('.jdb', '.idx.jdb')
        const targetIdxMdbPath = this.metaFile.replace('.jdb', '.idx.jdb')

        console.log(`BEFORE MOVE - Temp DB path: ${tempDbPath}`)
        console.log(`BEFORE MOVE - Temp MDB path: ${tempMdbPath}`)
        console.log(`BEFORE MOVE - Temp IDX DB path: ${tempIdxDbPath}`)
        console.log(`BEFORE MOVE - Temp IDX MDB path: ${tempIdxMdbPath}`)

        // CRITICAL FIX: Save temporary databases BEFORE moving to ensure files exist
        if (this.udb && this.udb.length > 0) {
          try {
            await this.udb.save()
          } catch (saveErr) {
            console.warn('Failed to save temporary programme database:', saveErr.message)
          }
        }

        if (this.umdb && this.umdb.length > 0) {
          try {
            await this.umdb.save()
          } catch (saveErr) {
            console.warn('Failed to save temporary metadata database:', saveErr.message)
          }
        }

        // Files should be created by save() operations above

        // Move temporary databases to main locations
        this.db = this.udb
        this.mdb = this.umdb
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

        // Recreate database instances to point to final files
        try {
          // Close old database instances
          if (this.db && typeof this.db.close === 'function') {
            await this.db.close()
          }
          if (this.mdb && typeof this.mdb.close === 'function') {
            await this.mdb.close()
          }

          // Create new database instances pointing to final files
          this.db = this.databaseFactory.createProgrammeDB(this.file, {}, false)
          this.mdb = this.databaseFactory.createMetadataDB(this.metaFile, {}, false)

          // Initialize the new databases
          await this.databaseFactory.initializeDB(this.db)
          await this.databaseFactory.initializeDB(this.mdb)

          console.log('Database instances recreated and pointing to final files')
        } catch (recreateErr) {
          console.error('Error recreating database instances:', recreateErr.message)
          // Continue with the process even if recreation fails
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
        console.log('Update complete, keeping databases open for queries')

        // JexiDB databases remain open and ready for immediate queries

        // CRITICAL: Validate database AFTER all finalization is complete
        // This ensures the database points to the final file, not the temporary one
        console.log('🔍 Validating database after all finalization is complete...')
        const isValid = await this._validateDatabaseAfterParserComplete()
        
        if (isValid) {
          this.setReadyState('loaded')
          this.error = null
        } else {
          this.setReadyState('error')
          this.error = 'EPG_NO_PROGRAMMES'
        }

        // Reset finalization flag to allow new operations
        this._state.finalizationInProgress = false

        console.log('Update completed successfully');

        // Clean up old databases after new ones are ready
        (async () => {
          try {
            // Wait much longer to ensure any pending save operations complete
            console.log('Waiting before destroying old databases...')
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
            console.log('Keeping old databases available for query operations')

            // Use JexiDB native waitForOperations instead of manual writeBuffer checks
            if (oldDb) {
              console.log('Waiting for old main database operations to complete...')
              try {
                await oldDb.waitForOperations()
                console.log('Old main database operations completed')
              } catch (err) {
                console.warn('Error waiting for old main database operations:', err.message)
              }
            }

            if (oldMdb) {
              console.log('Waiting for old metadata database operations to complete...')
              try {
                await oldMdb.waitForOperations()
                console.log('Old metadata database operations completed')
              } catch (err) {
                console.warn('Error waiting for old metadata database operations:', err.message)
              }
            }

            // Only destroy old databases if they are truly unused and safe
            const canDestroyOldDb = !oldDb || (!oldDb.isSaving && oldDb.writeBuffer.length === 0)
            const canDestroyOldMdb = !oldMdb || (!oldMdb.isSaving && oldMdb.writeBuffer.length === 0)

            // CRITICAL: Don't destroy databases immediately - keep them for queries
            if (canDestroyOldDb && oldDb && typeof oldDb.destroy === 'function') {
              console.log('Skipping old main database destruction - keeping for queries')
              // Don't destroy - keep available for queries
            } else if (oldDb) {
              console.warn(`Skipping old main database destruction - isSaving: ${oldDb.isSaving}, writeBuffer: ${oldDb.writeBuffer.length}`)
            }

            if (canDestroyOldMdb && oldMdb && typeof oldMdb.destroy === 'function') {
              console.log('Skipping old metadata database destruction - keeping for queries')
              // Don't destroy - keep available for queries
            } else if (oldMdb) {
              console.warn(`Skipping old metadata database destruction - isSaving: ${oldMdb.isSaving}, writeBuffer: ${oldMdb.writeBuffer.length}`)
            }

            console.log('Old databases kept available for query operations')
          } catch (cleanupErr) {
            console.warn('Error cleaning up old databases:', cleanupErr.message)
          }
        })(); // Execute immediately

        // Delayed destruction of old databases to allow queries to work
        (async () => {
          try {
            console.log('Starting delayed destruction of old databases...')

            // Use JexiDB native waitForOperations instead of manual writeBuffer checks
            if (oldDb) {
              console.log('Waiting for old main database operations to complete before delayed destruction...')
              try {
                await oldDb.waitForOperations()
                console.log('Old main database operations completed before delayed destruction')
              } catch (err) {
                console.warn('Error waiting for old main database operations before delayed destruction:', err.message)
              }
            }

            if (oldMdb) {
              console.log('Waiting for old metadata database operations to complete before delayed destruction...')
              try {
                await oldMdb.waitForOperations()
                console.log('Old metadata database operations completed before delayed destruction')
              } catch (err) {
                console.warn('Error waiting for old metadata database operations before delayed destruction:', err.message)
              }
            }

            // Check if old databases are safe to destroy
            const canDestroyOldDb = !oldDb || (!oldDb.isSaving && oldDb.writeBuffer.length === 0)
            const canDestroyOldMdb = !oldMdb || (!oldMdb.isSaving && oldMdb.writeBuffer.length === 0)

            if (canDestroyOldDb && oldDb && typeof oldDb.destroy === 'function') {
              console.log('Destroying old main database after delay...')
              await oldDb.destroy()
              console.log('Old main database destroyed successfully after delay')
            } else if (oldDb) {
              console.warn(`Skipping delayed old main database destruction - isSaving: ${oldDb.isSaving}, writeBuffer: ${oldDb.writeBuffer.length}`)
            }

            if (canDestroyOldMdb && oldMdb && typeof oldMdb.destroy === 'function') {
              console.log('Destroying old metadata database after delay...')
              await oldMdb.destroy()
              console.log('Old metadata database destroyed successfully after delay')
            } else if (oldMdb) {
              console.warn(`Skipping delayed old metadata database destruction - isSaving: ${oldMdb.isSaving}, writeBuffer: ${oldMdb.writeBuffer.length}`)
            }

            console.log('Delayed old databases cleanup completed')
          } catch (delayedCleanupErr) {
            console.warn('Error in delayed cleanup of old databases:', delayedCleanupErr.message)
          }
        })(); // Execute immediately

      } else {
        // No new data downloaded - check if we have existing valid data
        console.log(`Checking existing data: db exists=${!!this.db}, db.length=${this.db?.length || 0}`)

        if (this.db && this.db.length > 0) {
          console.log('No new EPG data downloaded, but existing database has valid entries')
          this.setReadyState('loaded')
          this.error = null
        } else {
          console.warn('No EPG data available (new or existing)')
          console.log(`Setting error state: validEPG=${this.validEPG}`)
          console.log(`EPG Debug Info:`)
          console.log(`  - URL: ${this.url}`)
          console.log(`  - DB exists: ${!!this.db}`)
          console.log(`  - DB length: ${this.db?.length || 0}`)
          console.log(`  - Received bytes: ${this.received}`)
          console.log(`  - Error count: ${this.errorCount}`)
          console.log(`  - Last error: ${this.error || 'none'}`)

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
          console.log(`🟡 Will destroy udb after 10 seconds to give onEnd() time to execute`)
          // Delay destruction to give onEnd() callback time to execute
          setTimeout(async () => {
            if (this.udb && !this._state.commitInProgress) {
              console.log('🔴 Delayed: Destroying udb in finalizeUpdate (NO NEW DATA PATH)')
              try {
                await this.udb.destroy()
                this.udb = null
              } catch (err) {
                console.warn('Error destroying udb in delayed cleanup:', err.message)
              }
            }
            if (this.umdb && !this._state.commitInProgress) {
              console.log('🔴 Delayed: Destroying umdb in finalizeUpdate (NO NEW DATA PATH)')
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
            console.log('🔴 Destroying udb in finalizeUpdate (NO NEW DATA PATH - no insertSession)')
            console.log(`🔴 Update ID: ${this._currentUpdateId}, commitInProgress: ${this._state.commitInProgress}`)
            await this.udb.destroy()
            this.udb = null
          }
          if (this.umdb) {
            console.log('🔴 Destroying umdb in finalizeUpdate (NO NEW DATA PATH - no insertSession)')
            await this.umdb.destroy()
            this.umdb = null
          }
        }
      }

      // Update last modified timestamp if provided
      if (newLastModified) {
        // Store this in database or storage for future reference
        // console.log('Updating last modified timestamp:', newLastModified)
      }

    } catch (err) {
      console.error('Error in finalizeUpdate:', err.message || err)
      console.error(err.stack, typeof(console), typeof(console.error))
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
            console.log('🔴 Destroying udb in finalizeUpdate ERROR HANDLER')
            console.log(`🔴 Update ID: ${this._currentUpdateId}, commitInProgress: ${this._state.commitInProgress}`)
            // Wait a bit to ensure any pending save operations complete
            await new Promise(resolve => setTimeout(resolve, 1000))
            await this.udb.destroy()
            this.udb = null
          }
          if (this.umdb) {
            console.log('🔴 Destroying umdb in finalizeUpdate ERROR HANDLER')
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

  async _saveChannelsAndTermsInBatch() {
    // CRITICAL: Ensure we're using the final database, not the temporary one
    let targetDb = this.mdb // Use main metadata database

    if (!targetDb) {
      throw new Error('CRITICAL: No metadata database available for batch save')
    }

    // CRITICAL: Validate database state before operations
    if (targetDb.destroyed) {
      console.error('CRITICAL: Metadata database is destroyed in _saveChannelsAndTermsInBatch')
      console.error('Attempting to recreate metadata database...')

      try {
        // Recreate the metadata database
        this.mdb = this.databaseFactory.createMetadataDB(this.metaFile, {}, false)
        await this.databaseFactory.initializeDB(this.mdb)
        targetDb = this.mdb
        console.log('Metadata database recreated successfully')
      } catch (recreateErr) {
        throw new Error(`CRITICAL: Failed to recreate metadata database: ${recreateErr.message}`)
      }
    }

    if (!targetDb.initialized) {
      throw new Error('CRITICAL: Metadata database is not initialized in _saveChannelsAndTermsInBatch')
    }

    // CRITICAL: Always check and update filePath to point to final file
    console.log(`Current database filePath: ${targetDb.filePath}`)
    console.log(`Expected final file: ${this.metaFile}`)

    // CRITICAL: Always ensure database is properly connected to final file
    if (targetDb.filePath !== this.metaFile) {
      console.log(`Updating database filePath from ${targetDb.filePath} to ${this.metaFile}`)
      targetDb.filePath = this.metaFile
    }

    // CRITICAL: Always recreate database to ensure it's properly connected
    try {
      console.log('Recreating database to ensure proper connection...')
      await targetDb.close()

      // Create new database instance
      const newDb = this.databaseFactory.createMetadataDB(this.metaFile, {}, false)
      await this.databaseFactory.initializeDB(newDb)
      this.mdb = newDb

      // CRITICAL: Update targetDb reference to use the new database
      targetDb = this.mdb

      console.log('Database recreated successfully')
    } catch (recreateErr) {
      console.warn('Failed to recreate database:', recreateErr.message)
    }

    try {
      console.log(`Saving ${this._channelMap.size} channels and ${this._termsMap.size} terms to database in batch...`)

      // CRITICAL: Ensure database is properly initialized and accessible
      if (!targetDb.initialized) {
        console.warn('Target database not initialized, initializing...')
        try {
          await this.databaseFactory.initializeDB(targetDb)
        } catch (initErr) {
          console.error('Failed to initialize target database:', initErr.message)
          return
        }
      }

      // CRITICAL: Additional validation to ensure database is ready
      if (!targetDb || typeof targetDb.insertBatch !== 'function') {
        console.error('Target database is not properly initialized or insertBatch method is missing')
        return
      }

      // CRITICAL: Check if database has the required methods
      if (!targetDb.insert || typeof targetDb.insert !== 'function') {
        console.error('Target database does not have insert method')
        return
      }

      // CRITICAL: Validate database state
      if (!targetDb.initialized) {
        console.error('Target database is not initialized after initialization attempt')
        return
      }

      // CRITICAL: Test database functionality before proceeding
      try {
        await targetDb.count()
        console.log('Database functionality test passed')
      } catch (testErr) {
        console.error('Database functionality test failed:', testErr.message)
        console.warn('Attempting to recreate database...')

        try {
          // Recreate the database
          const newDb = this.databaseFactory.createMetadataDB(this.metaFile, {}, true)
          await this.databaseFactory.initializeDB(newDb)
          this.mdb = newDb
          console.log('Database recreated successfully')
        } catch (recreateErr) {
          console.error('Failed to recreate database:', recreateErr.message)
          return
        }
      }

      // Process channels in batch
      if (this._channelMap.size > 0) {
        const channelsToProcess = Array.from(this._channelMap.values())
        console.log(`Processing ${channelsToProcess.length} channels in batch...`)

        // CRITICAL: Use the current targetDb (may have been recreated)
        const currentTargetDb = this.mdb

        if (!currentTargetDb || !currentTargetDb.initialized) {
          console.error('Target database is not available or not initialized for channel processing')
          return
        }

        try {
          // CRITICAL: Verify database is still valid before insertBatch
          if (currentTargetDb.destroyed) {
            throw new Error('Database is destroyed, cannot insert channels')
          }
          if (!currentTargetDb.initialized) {
            throw new Error('Database is not initialized, cannot insert channels')
          }

          console.log(`Database state before insertBatch: destroyed=${currentTargetDb.destroyed}, initialized=${currentTargetDb.initialized}`)

          // Use batch insert for better performance
          await currentTargetDb.insertBatch(channelsToProcess)
          console.log(`Batch inserted ${channelsToProcess.length} channels`)
        } catch (channelErr) {
          console.error('Error inserting channels in batch:', channelErr.message)
          // Try individual inserts as fallback
          try {
            for (const channel of channelsToProcess) {
              // Check database state before each insert
              if (currentTargetDb.destroyed || !currentTargetDb.initialized) {
                console.warn('Database became invalid during individual inserts, stopping')
                break
              }
              await currentTargetDb.insert(channel)
            }
            console.log(`Fallback: Inserted ${channelsToProcess.length} channels individually`)
          } catch (fallbackErr) {
            console.error('Fallback channel insert also failed:', fallbackErr.message)
            throw fallbackErr
          }
        }
      }

      // Process terms in batch
      if (this._termsMap.size > 0) {
        const termsToProcess = Array.from(this._termsMap.values())
        console.log(`Processing ${termsToProcess.length} terms in batch...`)

        // CRITICAL: Use the current targetDb (may have been recreated)
        const currentTargetDb = this.mdb

        if (!currentTargetDb || !currentTargetDb.initialized) {
          console.error('Target database is not available or not initialized for terms processing')
          return
        }

        try {
          // CRITICAL: Verify database is still valid before insertBatch
          if (currentTargetDb.destroyed) {
            throw new Error('Database is destroyed, cannot insert terms')
          }
          if (!currentTargetDb.initialized) {
            throw new Error('Database is not initialized, cannot insert terms')
          }

          console.log(`Database state before insertBatch: destroyed=${currentTargetDb.destroyed}, initialized=${currentTargetDb.initialized}`)

          // Use batch insert for better performance
          await currentTargetDb.insertBatch(termsToProcess)
          console.log(`Batch inserted ${termsToProcess.length} terms`)
        } catch (termsErr) {
          console.error('Error inserting terms in batch:', termsErr.message)
          // Try individual inserts as fallback
          try {
            for (const term of termsToProcess) {
              // Check database state before each insert
              if (currentTargetDb.destroyed || !currentTargetDb.initialized) {
                console.warn('Database became invalid during individual inserts, stopping')
                break
              }
              await currentTargetDb.insert(term)
            }
            console.log(`Fallback: Inserted ${termsToProcess.length} terms individually`)
          } catch (fallbackErr) {
            console.error('Fallback terms insert also failed:', fallbackErr.message)
            throw fallbackErr
          }
        }
      }

      // Clear memory maps after successful batch save
      this._channelMap.clear()
      this._termsMap.clear()

      console.log('Batch save completed successfully')

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
      console.log(`State changed from ${oldState} to ${state}`)
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
    console.log('Cleaning up EPG resources...')

    // Mark as destroyed to prevent new operations
    this._state.destroyed = true

    // CRITICAL: Stop parser and request FIRST to prevent new data insertion
    console.log('🛑 Stopping parser and request to prevent new data insertion...')
    if (this.parser && typeof this.parser.destroy === 'function') {
      console.log('🛑 Destroying parser...')
      this.parser.destroy()
    }
    if (this.request && typeof this.request.destroy === 'function') {
      console.log('🛑 Destroying request...')
      this.request.destroy()
    }

    // Wait for any pending operations to complete
    if (this._state.updating) {
      console.log('Waiting for ongoing update to complete...')
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

    // Clear memory maps
    this._channelMap.clear()
    this._termsMap.clear()

    // Stop memory monitoring
    this.memoryMonitor.destroy()

    // CRITICAL: Save databases before destroying to prevent writeBuffer bugs
    const databases = [this.db, this.mdb, this.udb, this.umdb]
    for (const db of databases) {
      if (db && typeof db.save === 'function') {
        // Use JexiDB native waitForOperations instead of manual writeBuffer checks
        console.log('Waiting for database operations to complete before cleanup...')
        try {
          await db.waitForOperations()
          console.log('Database operations completed before cleanup')
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

    console.log('EPG cleanup completed')
  }

  async _validateDatabaseAfterParserComplete() {
    console.log('🔍 Validating database after parser completion...')
    
    try {
      const now = Math.floor(Date.now() / 1000)
      console.debug('Checking database validity after parser complete, current timestamp:', now)

      // Ensure database is initialized before querying
      if (!this.db.initialized) {
        console.log('Database not initialized, initializing now...')
        await this.databaseFactory.initializeDB(this.db)
      }

      // Query for current and future programmes (not just future)
      // Accept programmes that end within the last 24 hours or in the future
      const validCount = await this.db.count({ e: { '>': now } })
      console.debug(`Found ${validCount} valid programmes (current and future) after parser complete`)

      // CRITICAL: Require minimum number of programmes to prevent premature finalization
      const minProgrammes = 36 // Minimum programmes required for valid EPG
      
      if (validCount >= minProgrammes) {
        console.log(`✅ Found ${validCount} valid programmes (>= ${minProgrammes}), EPG is valid`)
        return true
      } else if (validCount > 0) {
        console.log(`❌ Found only ${validCount} valid programmes (< ${minProgrammes}), EPG is insufficient`)
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
          console.log(`✅ Found ${totalCount} programmes (including past, >= ${minProgrammes}), EPG is valid`)
          return true
        } else if (totalCount > 0) {
          console.log(`❌ Found only ${totalCount} programmes (< ${minProgrammes}), EPG is insufficient`)
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
