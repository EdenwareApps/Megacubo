import { EPGUpdater } from './EPGUpdater.js'
import { EPGMetadataDetector } from './parsers/EPGMetadataDetector.js'
import storage from '../storage/storage.js'
import { terms, resolveListDatabaseFile, match } from '../lists/tools.js'

export class EPG extends EPGUpdater {
  constructor(url, dependencies = {}) {
    super(url, dependencies)
    this.url = url
    this._pendingTerms = new Set()
    
    // Store channel terms index for filtering
    this.channelTermsIndex = dependencies.channelTermsIndex || null
    this.suggested = dependencies.suggested || false

    // Resolve file paths with fallback
    this._resolvePaths()

    // Initialize additional EPG-specific properties
    this.readyState = 'uninitialized'
    this.state = { progress: 0, state: this.readyState, error: null }
    this.error = null
    this.destroyed = false

    // Debug properties for diagnostics
    this.bytesDownloaded = 0
    this.statusCode = null
    this.parsedEntriesCount = 0

    // Initialize log flags to prevent spam
    this._lengthInitAttempted = false
    this._lengthInitErrorLogged = false

    // Initialize databases with error handling
    this._initializeDatabases()

    // Initialize EPG metadata detector
    this.metadataDetector = new EPGMetadataDetector()

    // Start memory monitoring
    this.memoryMonitor.startMonitoring()

    // EPG instance created
  }
  
  _resolvePaths() {
    // Ensure storage is available and resolve paths with fallback
    if (!storage || typeof storage.resolve !== 'function') {
      console.error('Storage module not available, using fallback paths')
    }

    this.file = resolveListDatabaseFile('epg-programmes-' + this.url) // programmes DB
    this.metaFile = resolveListDatabaseFile('epg-metadata-' + this.url) // metadata DB

    // Validate that paths were resolved correctly
    if (!this.file || !this.metaFile) {
      console.error('Failed to resolve file paths:', { file: this.file, metaFile: this.metaFile })
      throw new Error('Failed to resolve EPG file paths')
    }

    // File paths resolved
  }

  _initializeDatabases() {
    try {
      this.db = this.createProgrammeDatabase(false)
      this.mdb = this.createMetadataDatabase(false)
    } catch (err) {
      console.error('Failed to create database instances:', err)
      // Create with fallback options - clear: true to reset any corrupted data
      this.db = this.createProgrammeDatabase(true)
      this.mdb = this.createMetadataDatabase(true)
    }
  }

  // Sanitize URL for use in file paths
  sanitizeUrl(url) {
    return url.replace(/[^a-zA-Z0-9.-]/g, '_')
  }

  // ===== State Management =====

  setReadyState(state) {
    if (this.readyState !== state) {
      const oldState = this.readyState
      this.readyState = state
      
      // Calculate _programmeCounts when transitioning to 'loaded' state
      if (state === 'loaded') {
        if (!this.db || !this.db.initialized) {
          throw new Error('Database loaded but not initialized?!')
        }
        this._calculateProgrammeCounts()
      }
      
      this.updateState()
      console.debug(`State changed from ${oldState} to ${state} for ${this.url}`)
      this.emit('stateChange', { from: oldState, to: state })
    }
  }

  async _calculateProgrammeCounts() {
    try {
      const now = Date.now() / 1000
      const futureCount = await this.db.count({ e: { '>': now } }).catch(() => 0)
      const pastCount = await this.db.count({ e: { '<': now } }).catch(() => 0)
      const currentCount = await this.db.count({ 
        start: { '<=': now },  // Fixed: use 'start' instead of 's'
        e: { '>': now } 
      }).catch(() => 0)

      this._programmeCounts = {
        total: this.db.length,
        future: futureCount,
        past: pastCount,
        current: currentCount
      }
      
      console.log(`📊 EPG ${this.url}: Calculated counts - total=${this._programmeCounts.total}, future=${this._programmeCounts.future}, past=${this._programmeCounts.past}, current=${this._programmeCounts.current}`)
      
      // Validate counts make sense
      if (this._programmeCounts.future > this._programmeCounts.total) {
        console.warn(`⚠️ EPG ${this.url}: Future count (${this._programmeCounts.future}) > total count (${this._programmeCounts.total}), this seems incorrect`)
      }
      
    } catch (err) {
      console.warn(`Failed to calculate programme counts for ${this.url}:`, err)
      this._programmeCounts = {
        total: this.db.length || 0,
        future: 0,
        past: 0,
        current: 0
      }
    }
  }

  calculateProgress() {
    // Progresso mais granular baseado em fases:
    // 0-10%: Inicializando
    // 10-70%: Baixando dados  
    // 70-90%: Processando/parsing
    // 90-100%: Indexando/finalizando

    if (this.readyState === 'loaded') {
      return 100
    }

    if (this.readyState === 'error') {
      return 0
    }

    if (this.readyState === 'uninitialized') {
      return 0
    }

    if (this.readyState === 'initializing') {
      return 5 // 0-10%: Inicializando
    }

    if (this.readyState === 'downloading') {
      // 10-70%: Baixando dados (baseado no progresso do request)
      const requestProgress = this?.request?.progress || 0
      return Math.min(10 + (requestProgress * 0.6), 70) // Escala de 10% a 70%
    }

    if (this.readyState === 'parsing' || this.readyState === 'processing') {
      // 70-90%: Processando/parsing
      const requestProgress = this?.request?.progress || 100 // Se chegou aqui, download terminou
      const dataProgress = this.db?.length ? Math.min((this.db.length / 1000) * 5, 20) : 0 // Baseado em dados processados
      return Math.min(70 + (requestProgress * 0.2) + dataProgress, 90)
    }

    if (this.readyState === 'indexing' || this.readyState === 'finalizing') {
      // 90-100%: Indexando/finalizando
      const dataProgress = this.db?.length ? Math.min((this.db.length / 500) * 10, 10) : 0
      return Math.min(90 + dataProgress, 100)
    }

    // Fallback para outros estados
    const requestProgress = this?.request?.progress || 0
    return Math.min(requestProgress, 100)
  }

  async updateState() {
    const state = {
      progress: this.calculateProgress(),
      state: this.readyState,
      error: this.error
    }

    if (state.progress !== this.state.progress || state.state !== this.state.state || state.error !== this.state.error) {
      this.emit('state', state)
      this.state = state

      // Always emit update event via parent when state changes (including errors)
      if (this.parent && this.parent.updateState) {
        await this.parent.updateState()
      }
    }
  }

  // ===== Channel Management =====

  async getChannelById(id) {
    // console.debug(`getChannelById called for ID: ${id}`)

    // Validate input
    if (!id || typeof id !== 'string') {
      console.warn(`Invalid channel ID: ${id}`)
      return { name: String(id || 'unknown'), icon: '' }
    }

    // Check cache first
    if (this.cacheManager.hasChannel(id)) {
      const cached = this.cacheManager.getChannel(id)
      // Ensure cached data is a valid object
      if (cached && typeof cached === 'object' && cached.name) {
        // Only log if it's a real name, not just an ID
        if (cached.name !== id) {
          // console.debug(`Found cached channel for ${id}:`, cached)
        }
        return cached
      } else {
        console.warn(`Invalid cached data for channel ${id}, removing from cache`)
        this.cacheManager.channelsCache?.delete(id)
      }
    }

    // CRITICAL FIX: Check in-memory channel map during parsing (before database save)
    if (this._channelMap && this._channelMap.has(id)) {
      const channelData = this._channelMap.get(id)
      if (channelData && channelData.name) {
        const result = {
          name: channelData.name,
          icon: channelData.icon || ''
        }
        // Cache for faster subsequent lookups
        this.cacheManager.setChannel(id, result)
        return result
      }
    }

    // Query database if not in memory map or cache
    try {
      await this.ensureMDB()
      const channel = await this.mdb.findOne({ _type: 'channel', id })

      if (channel && typeof channel === 'object') {
        // Ensure channel data is valid
        const result = {
          name: channel.name || id,
          icon: channel.icon || ''
        }
        // console.debug(`Found channel in database for ${id}:`, channel)
        // console.debug(`Returning result for ${id}:`, result)
        this.cacheManager.setChannel(id, result)
        return result
      } else {
        // Return default with ID as name
        const result = { name: id, icon: '' }
        // console.debug(`No channel found in database for ${id}, returning default:`, result)
        this.cacheManager.setChannel(id, result)
        return result
      }
    } catch (err) {
      console.error(`Error getting channel ${id}:`, err)
      // Always return a valid object, even on error
      const result = { name: id, icon: '' }
      this.cacheManager.setChannel(id, result)
      return result
    }
  }

  async cidToDisplayName(cid) {
    try {
      const info = await this.getChannelById(cid)
      // Ensure we always return a string
      if (info && typeof info === 'object' && info.name) {
        return String(info.name)
      }
      return String(cid || 'unknown')
    } catch (err) {
      console.error(`Error in cidToDisplayName for ${cid}:`, err)
      return String(cid || 'unknown')
    }
  }

  // ===== Programme and Channel Processing =====

  fixSlashes(txt) {
    if (!txt || typeof txt !== 'string') return txt
    return txt.replaceAll('/', '|')
  }

  extractCategoriesFromTitle(title) {
    if (!title || typeof title !== 'string') return []

    const categories = []
    const titleLower = title.toLowerCase()

    // News and Information
    if (titleLower.includes('news') || titleLower.includes('notícias') ||
      titleLower.includes('jornal') || titleLower.includes('telejornal') ||
      titleLower.includes('informação') || titleLower.includes('reportagem')) {
      categories.push('News')
    }

    // Sports
    if (titleLower.includes('esporte') || titleLower.includes('sport') ||
      titleLower.includes('futebol') || titleLower.includes('football') ||
      titleLower.includes('basquete') || titleLower.includes('basketball') ||
      titleLower.includes('vôlei') || titleLower.includes('volleyball')) {
      categories.push('Sports')
    }

    // Entertainment
    if (titleLower.includes('show') || titleLower.includes('entretenimento') ||
      titleLower.includes('variedades') || titleLower.includes('talk show')) {
      categories.push('Entertainment')
    }

    // Movies
    if (titleLower.includes('filme') || titleLower.includes('movie') ||
      titleLower.includes('cinema') || titleLower.includes('sessão')) {
      categories.push('Movie')
    }

    // Series/Drama
    if (titleLower.includes('série') || titleLower.includes('series') ||
      titleLower.includes('novela') || titleLower.includes('drama')) {
      categories.push('Series')
    }

    // Kids
    if (titleLower.includes('infantil') || titleLower.includes('criança') ||
      titleLower.includes('kids') || titleLower.includes('desenho')) {
      categories.push('Kids')
    }

    // Documentary
    if (titleLower.includes('documentário') || titleLower.includes('documentary') ||
      titleLower.includes('discovery') || titleLower.includes('national geographic')) {
      categories.push('Documentary')
    }

    return categories
  }

  async programme(programme) {
    // Safety checks to prevent race conditions
    if (this.destroyed || this._state.destroyed || 
        this._state.finalizationInProgress || this._state.commitInProgress ||
        !this.udb || this.udb.destroyed) {
      return
    }

    // console.debug(`Programme called with data: ${JSON.stringify(programme).substring(0, 100)}...`)

    // Increment parsed entries count
    this.parsedEntriesCount++

    const ch = await this.cidToDisplayName(programme.channel)
    let t = programme.title.shift() || 'Untitled'
    if (t.includes('/')) t = this.fixSlashes(t)

    // Also fix slashes in channel name
    const cleanChannelName = this.fixSlashes(ch)

    let i = ''
    if (programme.icon) {
      i = programme.icon
    } else if (programme.images?.length) {
      const weight = { medium: 0, large: 1, small: 2 }
      programme.images.sort((a, b) => weight[a.size] - weight[b.size]).some(a => { i = a.url; return true })
    }

    // Process categories
    if (programme.category) {
      if (typeof programme.category === 'string') {
        programme.category = programme.category.split(',').map(c => c.trim())
      } else if (Array.isArray(programme.category) && programme.category.length === 1 && programme.category[0]) {
        programme.category = programme.category[0].split(',').map(c => c.trim())
      }
    }

    // Ensure timestamps are numbers
    const startTimestamp = typeof programme.start === 'string' ? parseInt(programme.start) : programme.start
    const endTimestamp = typeof programme.end === 'string' ? parseInt(programme.end) : programme.end
    
    // FILTER: Only insert current and future programmes (skip past programmes)
    const now = Date.now() / 1000
    if (endTimestamp < now) {
      // Programme has already ended, skip it
      console.log(`⏭️ Skipping past programme: ${t} (ended at ${new Date(endTimestamp * 1000).toLocaleString()})`)
      return
    }

    // Extract categories from title if no categories provided
    let categories = programme.c || programme.category || programme.categories || []

    // If no categories, try to extract from title
    if (!categories || categories.length === 0) {
      categories = this.extractCategoriesFromTitle(t)
    }

    // Handle desc field
    let desc = ''
    if (programme.desc && Array.isArray(programme.desc) && programme.desc.length > 0) {
      desc = programme.desc[0] // Take first element if array has content
    } else if (programme.description && Array.isArray(programme.description) && programme.description.length > 0) {
      desc = programme.description[0] // Take first element if array has content
    } else if (typeof programme.desc === 'string') {
      desc = programme.desc
    } else if (typeof programme.description === 'string') {
      desc = programme.description
    }

    const row = {
      start: startTimestamp,
      e: endTimestamp,
      t,
      i,
      desc,
      ch: cleanChannelName,
      c: categories,
      // Initialize EPG metadata fields with defaults
      age: 0,
      lang: '',
      country: '',
      rating: '',
      parental: 'no',
      genre: '',
      contentType: '',
      parentalLock: 'false',
      geo: '',
      ageRestriction: ''
    }

    // Categories already come from EPG data (programme.c and programme.category)
    // No need for AI extraction - EPG data is already categorized

    // Add comprehensive search terms (programme title + channel name + categories)
    const programmeTerms = terms(row.t)
    const channelTerms = terms(cleanChannelName)
    const categoryTerms = Array.isArray(row.c) ? row.c.flatMap(cat => terms(cat)) : []

    // Create flat array with all terms for better content discovery
    row.terms = [...new Set([...programmeTerms, ...channelTerms, ...categoryTerms])]

    // Enhanced metadata detection from EPG
    try {
      // Create a programme object for the detector
      const programmeForDetection = {
        t: row.t,
        desc: row.desc,
        ch: cleanChannelName,
        c: categories,
        ageRestriction: '',
        rating: '',
        parental: '',
        parentalLock: '',
        category: categories
      }

      // Use the metadata detector to process the programme
      const enhancedProgramme = this.metadataDetector.processProgrammeMetadata(programmeForDetection)

      // Update row with detected metadata
      row.age = enhancedProgramme.age
      row.lang = enhancedProgramme.lang
      row.country = enhancedProgramme.country
      row.genre = enhancedProgramme.genre
      row.parental = enhancedProgramme.parental
      row.contentType = enhancedProgramme.contentType

      // console.debug(`Enhanced metadata for "${row.t}": age=${row.age}, lang=${row.lang}, country=${row.country}`)
    } catch (err) {
      console.error('Error in metadata detection:', err.message)
    }

    // Channel filtering: only save programmes from known channels (for suggested EPGs only)
    if (this.channelTermsIndex && Object.keys(this.channelTermsIndex).length && this.suggested) {
      // Use proper semantic matching with match() function
      let hasMatch = false
      let matchedTerms = []
      
      for (const [channelName, channelTerms] of Object.entries(this.channelTermsIndex)) {
        const matchScore = match(channelTerms, row.terms, true)
        if (matchScore > 0) {
          hasMatch = true
          matchedTerms.push(channelName)
        }
      }
      
      if (!hasMatch) {
        // Skip this programme - not relevant to any known channel
        return
      }
    }

    // Insert into database using indexate method
    await this.indexate(row)

    // Mark as having valid EPG data
    if (!this.validEPG) {
      this.validEPG = true
      console.log('First valid programme received, marking EPG as valid')
    }
  }

  async channel(channel) {
    if (!channel) return

    // Safety checks to prevent race conditions
    if (this._state.destroyed || this.destroyed || 
        this._state.finalizationInProgress || this._state.commitInProgress ||
        !this.udb || this.udb.destroyed) {
      return
    }

    // Increment pending operations counter
    this._state.pendingChannelOperations++

    try {
      // Smart ID vs Name detection: prioritize values with spaces as names
      const hasSpaces = (str) => str && typeof str === 'string' && str.includes(' ')
      const hasDots = (str) => str && typeof str === 'string' && str.includes('.')

      let channelId, name

      // If both id and name exist, prefer the one with spaces as name
      if (channel.id && channel.name) {
        const idHasSpaces = hasSpaces(channel.id)
        const nameHasSpaces = hasSpaces(channel.name)

        if (idHasSpaces && !nameHasSpaces) {
          // ID has spaces (likely a name), name doesn't (likely an ID)
          name = this.fixSlashes(channel.id)
          channelId = this.fixSlashes(channel.name)
        } else if (!idHasSpaces && nameHasSpaces) {
          // ID doesn't have spaces (likely real ID), name has spaces (likely real name)
          channelId = this.fixSlashes(channel.id)
          name = this.fixSlashes(channel.name)
        } else {
          // Both or neither have spaces - use dots as tiebreaker
          const idHasDots = hasDots(channel.id)
          const nameHasDots = hasDots(channel.name)

          if (idHasDots && !nameHasDots) {
            // ID has dots (likely a CID like "ESPN.br"), name doesn't (likely a real name)
            channelId = this.fixSlashes(channel.id)
            name = this.fixSlashes(channel.name)
          } else if (!idHasDots && nameHasDots) {
            // ID doesn't have dots (likely a real name), name has dots (likely a CID)
            name = this.fixSlashes(channel.id)
            channelId = this.fixSlashes(channel.name)
          } else {
            // Both or neither have dots - use original mapping
            channelId = this.fixSlashes(channel.id)
            name = this.fixSlashes(channel.name)
          }
        }
      } else if (channel.displayName || channel.name) {
        // Only name/displayName available
        const candidateName = this.fixSlashes(channel.displayName || channel.name)
        if (hasSpaces(candidateName)) {
          // Has spaces - treat as name, use as ID too
          name = candidateName
          channelId = candidateName
        } else if (hasDots(candidateName)) {
          // Has dots (likely a CID like "ESPN.br") - treat as ID, use as name too
          channelId = candidateName
          name = candidateName
        } else {
          // No spaces or dots - treat as name (more likely to be a real name)
          name = candidateName
          channelId = candidateName
        }
      } else if (channel.id) {
        // Only ID available
        const candidateId = this.fixSlashes(channel.id)
        if (hasSpaces(candidateId)) {
          // ID has spaces - treat as name
          name = candidateId
          channelId = candidateId
        } else if (hasDots(candidateId)) {
          // ID has dots (likely a CID like "ESPN.br") - treat as real ID
          channelId = candidateId
          name = candidateId
        } else {
          // No spaces or dots - treat as name (more likely to be a real name)
          name = candidateId
          channelId = candidateId
        }
      }

      if (!name || !channelId) {
        return
      }

      // Only insert once with the proper ID and name mapping
      // Double-check before each operation
      if (this._state.destroyed || this.destroyed || this._state.finalizationInProgress) {
        console.debug('EPG destroyed or finalization started during channel processing, skipping upsert for:', channelId)
        return
      }

      // Insert with proper ID -> name mapping
      await this.upsertChannel(channelId, name, channel.icon)

      // Add pending terms for this channel
      this.cacheManager.addPendingTerm(name)

      // Also insert terms into metadata database for search functionality
      // Double-check before processing terms
      if (this._state.destroyed || this.destroyed || this._state.finalizationInProgress) {
        console.debug('EPG destroyed or finalization started during channel processing, skipping terms for:', name)
        return
      }

      const termList = terms(name)
      if (termList && termList.length > 0) {
        await this.upsertTerms(name, termList)
      }
    } finally {
      // Decrement pending operations counter
      this._state.pendingChannelOperations--
    }
  }

  // ===== Validation Methods =====

  async validateSufficientFutureProgrammes() {
    if (!this.db || !this.db.initialized) {
      return {
        hasSufficient: false,
        futureCount: 0,
        totalCount: 0,
        error: 'Database not initialized'
      }
    }
    
    try {
      // Use pre-calculated counts if available, otherwise calculate
      if (this._programmeCounts && 'future' in this._programmeCounts) {
        console.log(`📊 Using pre-calculated counts for validation: future=${this._programmeCounts.future}, total=${this._programmeCounts.total}`)
        return {
          hasSufficient: this._programmeCounts.future >= 36,
          futureCount: this._programmeCounts.future,
          totalCount: this._programmeCounts.total,
          error: null
        }
      }
      
      // Fallback to database query if _programmeCounts not available
      console.log(`📊 _programmeCounts not available, calculating from database...`)
      const now = Date.now() / 1000
      const futureCount = await this.db.count({ e: { '>': now } }).catch(() => 0)
      
      return {
        hasSufficient: futureCount >= 36,
        futureCount: futureCount,
        totalCount: this.db.length,
        error: null
      }
    } catch (err) {
      return {
        hasSufficient: false,
        futureCount: 0,
        totalCount: this.db?.length || 0,
        error: err.message
      }
    }
  }

  // ===== Main Update Logic =====

  async update() {
    console.log('EPG.update() called for:', this.url)

    if (this.isUpdating) {
      console.log('Already updating, skipping')
      return
    }

    console.log('Starting update process...')

    try {
      await this.doUpdate()
      console.log('Update process completed')
    } catch (err) {
      console.error('Update process failed:', err)
      this.setReadyState('error')
      this.error = err.message
    }
  }

  // ===== Lifecycle Methods =====

  ready() {
    return new Promise((resolve, reject) => {
      const listener = () => respond()
      const respond = () => {
        if (this.readyState === 'error') {
          reject(this.error || new Error('EPG failed to load'))
        } else {
          resolve(true)
        }
      }

      if (this.readyState === 'loaded') {
        return respond()
      }

      // Ensure databases exist before starting
      if (!this.db || !this.mdb) {
        console.warn('Database instances missing, recreating...')
        try {
          this._initializeDatabases()

          // Initialize and save the recreated databases
          Promise.all([
            this.databaseFactory.initializeDB(this.db),
            this.databaseFactory.initializeDB(this.mdb)
          ]).then(() => {
            console.log('Recreated databases initialized and saved successfully')
          }).catch(err => {
            console.error('Failed to recreate database instances:', err)
            this.error = err
            this.setReadyState('error')
            reject(err)
          })
        } catch (err) {
          console.error('Failed to recreate database instances:', err)
          this.error = err
          this.setReadyState('error')
          reject(err)
          return
        }
      }

      this.start().then(() => {
        // Success case - do nothing, ready state is set in start()
      }).catch(e => {
        console.error('EPG start failed:', e)
        this.error = e
        this.setReadyState('error')
        reject(e)
      }).finally(listener)
    })
  }

  async start() {
    console.log('EPG.start() called for URL:', this.url)

    if (this.destroyed) {
      console.log('Already destroyed, skipping start')
      return Promise.resolve()
    }

    this.setReadyState('loading')

    try {
      // Ensure databases are properly initialized before proceeding
      if (!this.db || !this.mdb) {
        console.log('Recreating database instances...')
        this._initializeDatabases()
      }

      // Initialize databases if not already initialized
      if (!this.db.initialized) {
        console.log('Initializing programme database...')
        await this.databaseFactory.initializeDB(this.db)
      }

      if (!this.mdb.initialized) {
        console.log('Initializing metadata database...')
        await this.databaseFactory.initializeDB(this.mdb)
      }

      try {
        await this._calculateProgrammeCounts()
        console.log(`📊 Recalculated _programmeCounts after start databases for ${this.url}:`, this._programmeCounts)
      } catch (err) {
        console.warn(`Failed to recalculate _programmeCounts after start databases for ${this.url}:`, err)
      }

      console.log('Databases initialized, proceeding with update...')

      // Check if we already have valid data before updating
      if (this.db && this.db.length > 0) {
        console.log('Database already has data, checking if update is needed...')
        const now = Date.now() / 1000
        const futureCount = await this.db.count({ e: { '>': now } }).catch(() => 0)
        console.log(`Found ${futureCount} future programmes in existing database`)
        
        if (futureCount >= 36) {
          console.log('Valid data found with sufficient future programmes, marking as loaded')
          this.setReadyState('loaded')
          this.error = null
        } else {
          console.log(`Insufficient future programmes (${futureCount} < 36), forcing update`)
        }
      }

      await this.update()
      console.log('Update completed')

      // CRITICAL FIX: init() already guarantees database is ready when it returns

      // Check database status after update
      console.debug('Checking database status after update...')
      console.debug('Database exists:', !!this.db)
      console.debug('Database initialized:', this.db?.initialized)

      if (this.db && !this.db.initialized) {
        console.log('Database not initialized, attempting initialization...')
        try {
          await this.databaseFactory.initializeDB(this.db)
          console.log('Database initialized successfully after update')
        } catch (initError) {
          console.error('Failed to initialize database after update:', initError)
        }
      }

      // CRITICAL: Wait for parser to complete before returning
      // This ensures the EPG is fully processed when add() returns
      console.log('Update process completed - waiting for parser to finish before validation')
      
      // Wait for parser to complete if it exists
      if (this.parser) {
        console.log('Waiting for parser to complete...')
        try {
          // Check if parser is already finished
          if (this.parser.destroyed || this.parser.writableEnded) {
            console.log('✅ Parser already finished (destroyed or writableEnded)')
          } else {
            console.log('Parser still active, waiting for end event...')
            
            // Wait for parser end event (xmltv-stream emits 'end' when done)
            await new Promise((resolve) => {
              const onEnd = () => {
                console.log('✅ Parser end event received')
                this.parser.removeListener('end', onEnd)
                this.parser.removeListener('error', onEnd)
                resolve()
              }
              this.parser.once('end', onEnd)
              this.parser.once('error', onEnd)
            })
          }
        } catch (parserErr) {
          console.warn('Error waiting for parser:', parserErr.message)
        }
      } else {
        console.log('✅ No parser to wait for')
      }
      

      console.log('✅ Parser completed, EPG is ready')
      if (this.insertSession) {
        console.log('🔍 Debug: insertSession exists, waiting for operations...')
        await this.insertSession.commit()
      }
      await this.db.waitForOperations()
      await this.mdb.waitForOperations()
      
      // CRITICAL FIX: Calculate future programmes to prevent false EPG_OUTDATED errors
      console.log('🔍 Debug: db.initialized=', this.db.initialized, 'db.length=', this.db.length)
      if (this.db.initialized && this.db.length > 0) {
        try {
          const now = Date.now() / 1000
          const futureCount = await this.db.count({ e: { '>': now } }).catch(() => 0)
          const pastCount = await this.db.count({ e: { '<': now } }).catch(() => 0)
          const currentCount = await this.db.count({ 
            start: { '<=': now }, 
            e: { '>': now } 
          }).catch(() => 0)
          
          console.log(`📊 EPG ${this.url}: total=${this.db.length}, future=${futureCount}, past=${pastCount}, current=${currentCount}`)
          console.log(`🔍 Debug: now=${now} (${new Date(now * 1000).toLocaleString()})`)
          console.log(`🔍 Debug: future query = { e: { '>': ${now} } }`)
          
          // Debug: Test a few records to see their structure
          if (this.db.length > 0) {
            try {
              const sampleRecords = await this.db.find({}, { limit: 3 })
              console.log(`🔍 Debug: Sample records structure:`)
              sampleRecords.forEach((record, index) => {
                console.log(`   Record ${index + 1}: keys=${Object.keys(record).join(', ')}`)
                if (record.start) console.log(`     start: ${record.start} (${new Date(record.start * 1000).toLocaleString()})`)
                if (record.e) console.log(`     e: ${record.e} (${new Date(record.e * 1000).toLocaleString()})`)
                if (record.t) console.log(`     t: ${record.t}`)
              })
            } catch (debugErr) {
              console.log(`🔍 Debug: Error getting sample records: ${debugErr.message}`)
            }
          }
          
          // Debug: Let's check a few sample records to understand the data structure
          try {
            const sampleRecords = await this.db.find({}, { limit: 3 })
            console.log(`🔍 Debug: Sample records structure:`)
            sampleRecords.forEach((record, index) => {
              console.log(`  Record ${index + 1}: start=${record.start}, e=${record.e}, t=${record.t}`)
              if (record.start) console.log(`    start date: ${new Date(record.start * 1000).toLocaleString()}`)
              if (record.e) console.log(`    end date: ${new Date(record.e * 1000).toLocaleString()}`)
            })
          } catch (debugErr) {
            console.log(`🔍 Debug: Error getting sample records: ${debugErr.message}`)
          }
          
          // Note: _programmeCounts will be calculated automatically in setReadyState('loaded')
          console.log(`📊 EPG ${this.url}: Counts will be calculated when state changes to 'loaded'`)
        } catch (err) {
          console.warn(`Failed to calculate programme counts for ${this.url}:`, err)
          // Note: _programmeCounts will be calculated automatically in setReadyState('loaded')
        }
      } else {
        // Database is empty or not initialized
        console.log(`📊 EPG ${this.url}: Database empty, counts will be calculated when state changes to 'loaded'`)
      }
      
      return Promise.resolve()

    } catch (error) {
      console.error('Start failed:', error)
      this.error = error
      this.readyState = 'error'
      this.emit('error', error)
      return Promise.reject(error)
    }
  }

  get length() {
    return this.db ? this.db.length : 0
  }

  async indexate(data) {
    // Safety check: ensure udb exists and is not destroyed
    if (!this.udb || this.destroyed || this._state.destroyed) {
      console.warn('EPG indexate called but udb is null or EPG is destroyed, skipping..')
      return
    }

    if (Array.isArray(data.c)) {
      data.c = data.c.map(c => {
        if (typeof c === 'string') {
          return c.split(' ').map(word =>
            word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
          ).join(' ')
        }
        return c
      })
    }

    try {
      const beforeLength = this.udb.length
      let afterLength = 0

      // OPTIMIZATION: Use InsertSession for batch processing
      if (this.insertSession && typeof this.insertSession.add === 'function') {
        try {
          // console.debug(`Adding data to insertSession: ${JSON.stringify(data).substring(0, 100)}...`)
          await this.insertSession.add(data)
          // When using InsertSession, the length doesn't update immediately, so use session counter
          afterLength = this.insertSession.totalInserted || 0
          // console.debug(`Data added to insertSession, totalInserted: ${afterLength}`)
        } catch (err) {
          console.error('Error adding to insertSession:', err.message)
          // If InsertSession is already committed, create a new one
          if (err.message.includes('Session already committed')) {
            console.warn('InsertSession already committed, creating new session...')
            try {
              this.insertSession = this.udb.beginInsertSession({
                batchSize: 500,
                enableAutoSave: true
              })
              await this.insertSession.add(data)
              afterLength = this.insertSession.totalInserted || 0
              console.debug('Successfully created new InsertSession')
            } catch (createErr) {
              console.error('Failed to create new InsertSession, using direct insert:', createErr.message)
              await this.udb.insert(data)
              afterLength = this.udb.length
            }
          } else {
            throw err
          }
        }
      } else {
        // InsertSession not available, create a new one
        console.warn('insertSession not available, creating new session...')
        try {
          this.insertSession = this.udb.beginInsertSession({
            batchSize: 500,
            enableAutoSave: true
          })
          await this.insertSession.add(data)
          afterLength = this.insertSession.totalInserted || 0
          console.debug('Successfully created new InsertSession')
        } catch (err) {
          console.error('Failed to create InsertSession, using direct insert:', err.message)
          await this.udb.insert(data)
          afterLength = this.udb.length
        }
      }

      if (this.completer && typeof this.completer.learn === 'function') {
        this.completer.learn(data)
      }

      // Double-check before adding to prevent null reference error
      if (this._pendingTerms && typeof this._pendingTerms.add === 'function') {
        this._pendingTerms.add(data.ch)
      } else {
        console.error('_pendingTerms is still null or invalid after reinitialization, skipping add operation')
        console.error('_pendingTerms type:', typeof this._pendingTerms, 'value:', this._pendingTerms)
      }

      // Update progress state every 1000 records (without logging)
      if (afterLength % 1000 === 0) {
        // Update progress state
        if (this.parent) {
          this.parent.updateState()
        }
      }

      // Log first few insertions for debugging
      if (afterLength <= 5) {
        console.debug(`Inserted programme ${afterLength}: ${data.t} on ${data.ch} (length: ${beforeLength} -> ${afterLength})`)
      }
    } catch (error) {
      console.error('Error in indexate:', error)
    }
  }

  async destroy() {
    console.log('Destroying EPG instance for:', this.url)

    this.destroyed = true
    this.readyState = 'destroyed'

    // CRITICAL: Wait for any pending commit to complete before destroying
    if (this._state.commitInProgress) {
      console.log('🟡 Waiting for commit to complete before destroying EPG...')

      try {
        // Use JexiDB native waitForOperations instead of polling
        if (this.udb) {
          console.log('🟡 Waiting for database operations to complete...')
          await this.udb.waitForOperations()
          console.log('✅ Database operations completed')
        }
        
        // Clear commit flag after operations complete
        this._state.commitInProgress = false
        console.log('✅ Commit completed, proceeding with destruction')
        
      } catch (waitErr) {
        console.warn(`⚠️ Wait timeout for database operations: ${waitErr.message}`)
        // Force clear the flag to prevent infinite waiting
        this._state.commitInProgress = false
        console.log('✅ Forcing destruction after timeout')
      }
    }

    // Stop memory monitoring
    this.memoryMonitor.stopMonitoring()

    // Call parent cleanup
    await this.cleanup()

    console.log('EPG instance destroyed for:', this.url)
  }

}
