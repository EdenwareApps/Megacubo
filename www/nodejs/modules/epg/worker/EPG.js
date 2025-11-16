import { EPGUpdater } from './EPGUpdater.js'
import { EPGMetadataDetector } from './parsers/EPGMetadataDetector.js'
import storage from '../../storage/storage.js'
import { terms, resolveListDatabaseFile, match } from '../../lists/tools.js'

const EPG_LOOKUP_CACHE_SIZE = 386
const CACHE_MISS_ENTRY = Object.freeze({ miss: true, programmes: [] })

class LRUCache {
  constructor(limit) {
    this.limit = limit
    this.map = new Map()
  }

  get(key) {
    if (!this.map.has(key)) return undefined
    const value = this.map.get(key)
    this.map.delete(key)
    this.map.set(key, value)
    return value
  }

  set(key, value) {
    if (this.map.has(key)) {
      this.map.delete(key)
    }
    this.map.set(key, value)
    if (this.map.size > this.limit) {
      const oldestKey = this.map.keys().next().value
      this.map.delete(oldestKey)
    }
  }

  clear() {
    this.map.clear()
  }
}

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
    this.lookupCache = new LRUCache(EPG_LOOKUP_CACHE_SIZE)

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
    // CRITICAL: Don't recreate databases if they already exist and have correct file path
    // This prevents losing database references after finalizeUpdate()
    const dbFilePath = this.db?.normalizedFile
    if (this.db && dbFilePath === this.file && this.db.initialized) {
      this.debug && console.log('Database already initialized with correct file path, skipping recreation')
      return
    }
    
    const mdbFilePath = this.mdb?.normalizedFile
    if (this.mdb && mdbFilePath === this.metaFile && this.mdb.initialized) {
      this.debug && console.log('Metadata database already initialized with correct file path, skipping recreation')
      // Only recreate programme DB if needed
      if (!this.db || dbFilePath !== this.file || !this.db.initialized) {
        try {
          this.db = this.createProgrammeDatabase(false)
        } catch (err) {
          console.error('Failed to create programme database instance:', err)
          this.db = this.createProgrammeDatabase(true)
        }
      }
      return
    }
    
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

  async setReadyState(state) {
    if (this.readyState !== state) {
      const oldState = this.readyState
      this.readyState = state
      
      // Track error timestamp for cleanup
      if (state === 'error') {
        this.errorTimestamp = Date.now()
      } else if (state !== 'error') {
        // Clear error timestamp when recovering from error
        this.errorTimestamp = undefined
      }
      
      // Calculate _programmeCounts when transitioning to 'loaded' state
      if (state === 'loaded') {
        if (!this.db || !this.db.initialized) {
          throw new Error('Database loaded but not initialized?!')
        }
        await this._calculateProgrammeCounts()
        
        // Update parent state after counts are calculated
        if (this.parent && this.parent.updateState) {
          await this.parent.updateState()
        }
      }

      if (state === 'loaded' || state === 'error') {
        this.clearLookupCache()
      }
      
      await this.updateState()
      console.debug(`State changed from ${oldState} to ${state} for ${this.url}`)
      this.emit('stateChange', { from: oldState, to: state })
    }
  }

  async _calculateProgrammeCounts() {
    try {
      // Check if db is available before proceeding
      if (!this.db || !this.db.initialized) {
        console.warn(`Cannot calculate programme counts for ${this.url}: database not available or not initialized`)
        this._programmeCounts = {
          total: 0,
          future: 0,
          past: 0,
          current: 0
        }
        return
      }

      // Verificar se db.count existe e é uma função
      if (!this.db.count || typeof this.db.count !== 'function') {
        console.warn(`Cannot calculate programme counts for ${this.url}: db.count is not available`)
        this._programmeCounts = {
          total: (this.db && typeof this.db.length === 'number') ? this.db.length : 0,
          future: 0,
          past: 0,
          current: 0
        }
        return
      }

      // Verificar se db foi destruído ou fechado
      if (this.db.destroyed || this.db.closed) {
        console.warn(`Cannot calculate programme counts for ${this.url}: database is destroyed or closed`)
        this._programmeCounts = {
          total: 0,
          future: 0,
          past: 0,
          current: 0
        }
        return
      }

      const now = Date.now() / 1000
      const futureCount = await this.db.count({ end: { '>': now } }).catch(() => 0)
      const pastCount = await this.db.count({ end: { '<': now } }).catch(() => 0)
      const currentCount = await this.db.count({ 
        start: { '<=': now },
        end: { '>': now } 
      }).catch(() => 0)

      this._programmeCounts = {
        total: (this.db && this.db.length) ? this.db.length : 0,
        future: futureCount,
        past: pastCount,
        current: currentCount
      }
      
      this.debug && console.log(`📊 EPG ${this.url}: Calculated counts - total=${this._programmeCounts.total}, future=${this._programmeCounts.future}, past=${this._programmeCounts.past}, current=${this._programmeCounts.current}`)
      
      // Validate counts make sense
      if (this._programmeCounts.future > this._programmeCounts.total) {
        console.warn(`⚠️ EPG ${this.url}: Future count (${this._programmeCounts.future}) > total count (${this._programmeCounts.total}), this seems incorrect`)
      }
      
    } catch (err) {
      console.warn(`Failed to calculate programme counts for ${this.url}:`, err)
      this._programmeCounts = {
        total: (this.db && this.db.length) ? this.db.length : 0,
        future: 0,
        past: 0,
        current: 0
      }
    }
  }

  // ===== Lookup & Caching Helpers =====

  clearLookupCache() {
    this.lookupCache = new LRUCache(EPG_LOOKUP_CACHE_SIZE)
  }

  _prepareLookupDescriptor(channelDescriptor) {
    if (!channelDescriptor) return null

    if (typeof channelDescriptor === 'string') {
      const normalizedTerms = terms(channelDescriptor)
      return {
        name: channelDescriptor,
        searchName: channelDescriptor,
        terms: normalizedTerms
      }
    }

    const prepared = { ...channelDescriptor }

    if (!prepared.name && prepared.searchName) {
      prepared.name = prepared.searchName
    } else if (!prepared.searchName && prepared.name) {
      prepared.searchName = prepared.name
    }

    if (!Array.isArray(prepared.terms) || prepared.terms.length === 0) {
      const base = prepared.searchName || prepared.name || ''
      prepared.terms = terms(base)
    }

    return prepared
  }

  _normalizeLookupTerms(input) {
    let collected = []

    if (!input) {
      return ''
    }

    if (Array.isArray(input)) {
      collected = input
    } else if (input?.terms && Array.isArray(input.terms)) {
      collected = input.terms
    } else if (typeof input === 'string') {
      collected = terms(input)
    }

    if (!Array.isArray(collected)) {
      collected = []
    }

    return collected
      .map(term => (typeof term === 'string' ? term.trim().toLowerCase() : ''))
      .filter(Boolean)
      .sort()
      .join('|')
  }

  _getCachedLookupEntry(termsKey) {
    if (!termsKey || !this.lookupCache) return undefined
    return this.lookupCache.get(termsKey)
  }

  _setCachedLookupEntry(termsKey, value) {
    if (!termsKey || !this.lookupCache) return
    this.lookupCache.set(termsKey, value)
  }

  _cacheLookupMiss(termsKey) {
    if (!termsKey || !this.lookupCache) return
    this.lookupCache.set(termsKey, CACHE_MISS_ENTRY)
  }

  async resolveLiveNowAndNext(channelDescriptor, options = {}) {
    const prepared = options.prepared
      ? channelDescriptor
      : this._prepareLookupDescriptor(channelDescriptor)

    if (!prepared || prepared.searchName === '-') {
      return CACHE_MISS_ENTRY
    }

    const searchTerms = Array.isArray(prepared.terms)
      ? prepared.terms
      : terms(prepared.searchName || prepared.name || '')

    if (!searchTerms.length) {
      return CACHE_MISS_ENTRY
    }

    const termsKey = this._normalizeLookupTerms(searchTerms)
    if (!termsKey) {
      return CACHE_MISS_ENTRY
    }

    if (
      this.readyState !== 'loaded' ||
      !this.db ||
      !this.db.initialized ||
      this.db.destroyed ||
      this.db.closed
    ) {
      this._cacheLookupMiss(termsKey)
      return CACHE_MISS_ENTRY
    }

    const cached = this._getCachedLookupEntry(termsKey)
    if (cached) {
      return cached
    }

    let termMap
    try {
      termMap = await this.getAllTerms()
    } catch (err) {
      console.error(`Error retrieving term map for ${this.url}:`, err)
      this._cacheLookupMiss(termsKey)
      return CACHE_MISS_ENTRY
    }

    if (!termMap || typeof termMap.entries !== 'function' || termMap.size === 0) {
      this._cacheLookupMiss(termsKey)
      return CACHE_MISS_ENTRY
    }

    let bestScore = 0
    const candidateIds = []

    for (const [name, nameTerms] of termMap.entries()) {
      if (!Array.isArray(nameTerms) || nameTerms.length === 0) continue
      const score = match(searchTerms, nameTerms, false)
      if (!score) continue

      if (score > bestScore) {
        bestScore = score
        candidateIds.length = 0
      }

      if (score === bestScore) {
        candidateIds.push(name)
      }
    }

    if (candidateIds.length === 0) {
      this._cacheLookupMiss(termsKey)
      return CACHE_MISS_ENTRY
    }

    const now = typeof options.now === 'number' ? options.now : (Date.now() / 1000)
    const fetchLimit = Math.max(2, options.limit || 2)
    const queryBase = { end: { '>': now } }

    let bestCandidate = null

    for (const candidateId of candidateIds) {
      const query = { ...queryBase, channel: candidateId }
      let programmes = []

      try {
        programmes = await this.db.find(query, { limit: fetchLimit, sort: { start: 1 } })
      } catch (err) {
        console.error(`Error fetching programmes for ${candidateId} in ${this.url}:`, err)
        continue
      }

      if (!Array.isArray(programmes) || programmes.length === 0) {
        continue
      }

      const trimmed = programmes.slice(0, fetchLimit)
      const candidateStart = trimmed[0]?.start ?? Number.MAX_SAFE_INTEGER

      if (
        !bestCandidate ||
        trimmed.length > bestCandidate.programmes.length ||
        (
          trimmed.length === bestCandidate.programmes.length &&
          candidateStart < (bestCandidate.programmes[0]?.start ?? Number.MAX_SAFE_INTEGER)
        )
      ) {
        bestCandidate = {
          channel: candidateId,
          programmes: trimmed
        }
      }
    }

    if (!bestCandidate) {
      this._cacheLookupMiss(termsKey)
      return CACHE_MISS_ENTRY
    }

    let icon = ''
    let displayName = ''

    if (typeof this.getChannelById === 'function') {
      try {
        const info = await this.getChannelById(bestCandidate.channel)
        if (info && typeof info === 'object') {
          displayName = info.name || ''
          icon = info.icon || ''
        }
      } catch (err) {
        console.warn(`Failed to get channel metadata for ${bestCandidate.channel} in ${this.url}:`, err.message)
      }
    }

    if (!displayName) {
      displayName = String(bestCandidate.channel)
    }

    const entry = {
      channel: bestCandidate.channel,
      name: displayName,
      icon: icon || bestCandidate.programmes[0]?.icon || '',
      programmes: bestCandidate.programmes.slice(0, 2)
    }

    this._setCachedLookupEntry(termsKey, entry)
    return entry
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

    // Calculate integer progress percentage
    const currentIntProgress = Math.floor(state.progress)
    const previousIntProgress = this.state?.progress ? Math.floor(this.state.progress) : -1
    const intProgressChanged = currentIntProgress !== previousIntProgress

    if (state.progress !== this.state.progress || state.state !== this.state.state || state.error !== this.state.error || intProgressChanged) {
      this.emit('state', state)
      this.state = state

      // Always emit update event via parent when state changes (including errors or integer progress change)
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
      // Only log non-expected errors to reduce log noise
      // "Metadata DB not initialized" is expected in some scenarios and handled gracefully
      if (err.message && !err.message.includes('Metadata DB not initialized')) {
        console.error(`Error getting channel ${id}:`, err)
      }
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
      this.debug && console.log(`⏭️ Skipping past programme: ${t} (ended at ${new Date(endTimestamp * 1000).toLocaleString()})`)
      return
    }

    // Extract categories from title if no categories provided
    let categories = programme.category || programme.categories || []

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
      end: endTimestamp,
      title: t,
      icon: i,
      desc,
      channel: cleanChannelName,
      categories: categories,
      // Initialize EPG metadata fields with defaults
      age: 0,
      lang: '',
      country: '',
      rating: '',
      parental: 'no',
      contentType: ''
    }

    // Categories already come from EPG data (programme.category from XMLTV parser)
    // No need for AI extraction - EPG data is already categorized

    // Add comprehensive search terms (programme title + channel name + categories)
    const programmeTerms = terms(row.title)
    const channelTerms = terms(cleanChannelName)
    const categoryTerms = Array.isArray(row.categories) ? row.categories.flatMap(cat => terms(cat)) : []

    // Create flat array with all terms for better content discovery
    row.terms = [...new Set([...programmeTerms, ...channelTerms, ...categoryTerms])]

    // Enhanced metadata detection from EPG
    try {
      // Create a programme object for the detector (using short field names for legacy detector compatibility)
      const programmeForDetection = {
        title: row.title,
        desc: row.desc,
        channel: cleanChannelName,
        categories: categories,
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
      row.parental = enhancedProgramme.parental
      row.contentType = enhancedProgramme.contentType

      // console.debug(`Enhanced metadata for "${row.title}": age=${row.age}, lang=${row.lang}, country=${row.country}`)
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
      this.debug && console.log('First valid programme received, marking EPG as valid')
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

      const rawIdValue = channel.id ?? channel.channelId ?? channel.cid ?? channel.name
      const displayValue = channel.displayName ?? channel.fullName ?? null

      const normalizedId = rawIdValue ? this.fixSlashes(String(rawIdValue)) : null
      const normalizedDisplay = displayValue ? this.fixSlashes(String(displayValue)) : null

      const looksLikeIdentifier = (value) => {
        if (!value) return true
        const trimmed = value.trim()
        if (!trimmed) return true
        if (/^[0-9]+$/.test(trimmed)) return true
        if (!/[a-z]/i.test(trimmed)) return true
        return false
      }

      let channelId = normalizedId || normalizedDisplay
      let name = normalizedDisplay || normalizedId

      if (!name) {
        name = channelId
      }
      if (!channelId) {
        channelId = name
      }

      // If the name still looks like a raw identifier but we have a display value, prefer the display
      if (looksLikeIdentifier(name) && normalizedDisplay && !looksLikeIdentifier(normalizedDisplay)) {
        name = normalizedDisplay
      }

      // Ensure both are cleaned
      channelId = channelId ? channelId.trim() : ''
      name = name ? name.trim() : ''

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
      const incomingName = String(name || '').trim()
      const cachedChannel = this.cacheManager.getChannel(channelId)

      if (cachedChannel && cachedChannel.name) {
        const cachedName = String(cachedChannel.name).trim()
        const isIncomingBetter =
          incomingName &&
          incomingName !== cachedName &&
          incomingName.length >= 2 &&
          /[a-z]/i.test(incomingName) && 
          !cachedName.match(/^[a-z]/i)
        if (isIncomingBetter) {
          await this.upsertChannel(channelId, incomingName, channel.icon)
        }
      } else {
        await this.upsertChannel(channelId, incomingName, channel.icon)
      }

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
        return {
          hasSufficient: this._programmeCounts.future >= 36,
          futureCount: this._programmeCounts.future,
          totalCount: this._programmeCounts.total,
          error: null
        }
      }
      
      // Fallback to database query if _programmeCounts not available
      if (!this.db || !this.db.initialized) {
        return {
          hasSufficient: false,
          futureCount: 0,
          totalCount: 0,
          error: 'Database not available or not initialized'
        }
      }
      
      const now = Date.now() / 1000
      const futureCount = await this.db.count({ end: { '>': now } }).catch(() => 0)
      
      return {
        hasSufficient: futureCount >= 36,
        futureCount: futureCount,
        totalCount: (this.db && this.db.length) ? this.db.length : 0,
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
    this.debug && console.log('EPG.update() called for:', this.url)

    if (this.isUpdating) {
      this.debug && console.log('Already updating, skipping')
      return
    }

    this.debug && console.log('Starting update process...')

    try {
      await this.doUpdate()
      this.debug && console.log('Update process completed')
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
            this.debug && console.log('Recreated databases initialized and saved successfully')
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
    this.debug && console.log('EPG.start() called for URL:', this.url)

    if (this.destroyed) {
      this.debug && console.log('Already destroyed, skipping start')
      return Promise.resolve()
    }

    this.setReadyState('loading')

    try {
      // CRITICAL: Only recreate databases if they don't exist or have wrong file path
      // After finalizeUpdate(), databases should already exist with correct file path
      const dbFilePath = this.db?.normalizedFile
      const mdbFilePath = this.mdb?.normalizedFile
      const needsRecreation = !this.db || !this.mdb || 
                              !dbFilePath || !mdbFilePath ||
                              dbFilePath !== this.file || mdbFilePath !== this.metaFile
      
      if (needsRecreation) {
        this.debug && console.log('Recreating database instances...')
        this.debug && console.log(`  Current db: ${this.db ? `normalizedFile=${this.db.normalizedFile || 'undefined'}, filePath=${dbFilePath}, expected=${this.file}` : 'null'}`)
        this.debug && console.log(`  Current mdb: ${this.mdb ? `normalizedFile=${this.mdb.normalizedFile || 'undefined'}, filePath=${mdbFilePath}, expected=${this.metaFile}` : 'null'}`)
        this._initializeDatabases()
      } else {
        this.debug && console.log('Databases already exist with correct file path, skipping recreation')
      }

      // Initialize databases if not already initialized
      if (!this.db.initialized) {
        this.debug && console.log('Initializing programme database...')
        await this.databaseFactory.initializeDB(this.db)
      }

      if (!this.mdb.initialized) {
        this.debug && console.log('Initializing metadata database...')
        await this.databaseFactory.initializeDB(this.mdb)
      }

      try {
        await this._calculateProgrammeCounts()
        this.debug && console.log(`📊 Recalculated _programmeCounts after start databases for ${this.url}:`, this._programmeCounts)
        
        // Update parent state after counts are calculated
        if (this.parent && this.parent.updateState) {
          await this.parent.updateState()
        }
      } catch (err) {
        console.warn(`Failed to recalculate _programmeCounts after start databases for ${this.url}:`, err)
      }

      this.debug && console.log('Databases initialized, proceeding with update...')

      // Check if we already have valid data before updating
      if (this.db && this.db.length > 0) {
        this.debug && console.log('Database already has data, checking if update is needed...')
        const now = Date.now() / 1000
        const futureCount = await this.db.count({ end: { '>': now } }).catch(() => 0)
        this.debug && console.log(`Found ${futureCount} future programmes in existing database`)
        
        if (futureCount >= 36) {
          this.debug && console.log('Valid data found with sufficient future programmes, marking as loaded')
          await this.setReadyState('loaded')
          this.error = null
        } else {
          this.debug && console.log(`Insufficient future programmes (${futureCount} < 36), forcing update`)
        }
      }

      await this.update()
      this.debug && console.log('Update completed')

      // CRITICAL FIX: init() already guarantees database is ready when it returns

      // Check database status after update
      console.debug('Checking database status after update...')
      console.debug('Database exists:', !!this.db)
      console.debug('Database initialized:', this.db?.initialized)

      if (this.db && !this.db.initialized) {
        this.debug && console.log('Database not initialized, attempting initialization...')
        try {
          await this.databaseFactory.initializeDB(this.db)
          this.debug && console.log('Database initialized successfully after update')
        } catch (initError) {
          console.error('Failed to initialize database after update:', initError)
        }
      }

      // CRITICAL: Wait for parser to complete before returning
      // This ensures the EPG is fully processed when add() returns
      this.debug && console.log('Update process completed - waiting for parser to finish before validation')
      
      // Wait for parser to complete if it exists
      if (this.parser) {
        this.debug && console.log('Waiting for parser to complete...')
        try {
          // Check if parser is already finished
          if (this.parser.destroyed || this.parser.writableEnded) {
            this.debug && console.log('✅ Parser already finished (destroyed or writableEnded)')
          } else {
            this.debug && console.log('Parser still active, waiting for end event...')
            
            // Wait for parser end event (xmltv-stream emits 'end' when done)
            await new Promise((resolve) => {
              const onEnd = () => {
                this.debug && console.log('✅ Parser end event received')
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
        this.debug && console.log('✅ No parser to wait for')
      }
      

      this.debug && console.log('✅ Parser completed, EPG is ready')
      if (this.insertSession) {
        this.debug && console.log('🔍 Debug: insertSession exists, waiting for operations...')
        await this.insertSession.commit()
      }
      await this.db.waitForOperations()
      await this.mdb.waitForOperations()
      
      // CRITICAL FIX: Calculate future programmes to prevent false EPG_OUTDATED errors
      if (!this.db || !this.db.initialized) {
        this.debug && console.log('🔍 Debug: Database not available or not initialized')
        return
      }
      
      this.debug && console.log('🔍 Debug: db.initialized=', this.db.initialized, 'db.length=', this.db?.length || 0)
      if (this.db.initialized && this.db.length > 0) {
        try {
          // Verificar se db.count existe e é uma função
          if (!this.db.count || typeof this.db.count !== 'function') {
            console.warn(`Cannot calculate programme counts for ${this.url}: db.count is not available`)
            this.debug && console.log(`📊 EPG ${this.url}: Counts will be calculated when state changes to 'loaded'`)
            return Promise.resolve()
          }

          // Verificar se db foi destruído ou fechado
          if (this.db.destroyed || this.db.closed) {
            console.warn(`Cannot calculate programme counts for ${this.url}: database is destroyed or closed`)
            this.debug && console.log(`📊 EPG ${this.url}: Counts will be calculated when state changes to 'loaded'`)
            return Promise.resolve()
          }

          const now = Date.now() / 1000
          const futureCount = await this.db.count({ end: { '>': now } }).catch(() => 0)
          const pastCount = await this.db.count({ end: { '<': now } }).catch(() => 0)
          const currentCount = await this.db.count({ 
            start: { '<=': now }, 
            end: { '>': now } 
          }).catch(() => 0)
          
          this.debug && console.log(`📊 EPG ${this.url}: total=${this.db.length}, future=${futureCount}, past=${pastCount}, current=${currentCount}`)
          this.debug && console.log(`🔍 Debug: now=${now} (${new Date(now * 1000).toLocaleString()})`)
          this.debug && console.log(`🔍 Debug: future query = { end: { '>': ${now} } }`)
          
          // Debug: Test a few records to see their structure
          if (this.db.length > 0) {
            try {
              const sampleRecords = await this.db.find({}, { limit: 3 })
              this.debug && console.log(`🔍 Debug: Sample records structure:`)
              sampleRecords.forEach((record, index) => {
                this.debug && console.log(`   Record ${index + 1}: keys=${Object.keys(record).join(', ')}`)
                if (record.start) this.debug && console.log(`     start: ${record.start} (${new Date(record.start * 1000).toLocaleString()})`)
                if (record.end) this.debug && console.log(`     end: ${record.end} (${new Date(record.end * 1000).toLocaleString()})`)
                if (record.title) this.debug && console.log(`     title: ${record.title}`)
              })
            } catch (debugErr) {
              this.debug && console.log(`🔍 Debug: Error getting sample records: ${debugErr.message}`)
            }
          }
          
          // Debug: Let's check a few sample records to understand the data structure
          try {
            const sampleRecords = await this.db.find({}, { limit: 3 })
            this.debug && console.log(`🔍 Debug: Sample records structure:`)
            sampleRecords.forEach((record, index) => {
                this.debug && console.log(`  Record ${index + 1}: start=${record.start}, end=${record.end}, title=${record.title}`)
              if (record.start) this.debug && console.log(`    start date: ${new Date(record.start * 1000).toLocaleString()}`)
              if (record.end) this.debug && console.log(`    end date: ${new Date(record.end * 1000).toLocaleString()}`)
            })
          } catch (debugErr) {
            this.debug && console.log(`🔍 Debug: Error getting sample records: ${debugErr.message}`)
          }
          
          // Note: _programmeCounts will be calculated automatically in setReadyState('loaded')
          this.debug && console.log(`📊 EPG ${this.url}: Counts will be calculated when state changes to 'loaded'`)
        } catch (err) {
          console.warn(`Failed to calculate programme counts for ${this.url}:`, err)
          // Note: _programmeCounts will be calculated automatically in setReadyState('loaded')
        }
      } else {
        // Database is empty or not initialized
        this.debug && console.log(`📊 EPG ${this.url}: Database empty, counts will be calculated when state changes to 'loaded'`)
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

    if (Array.isArray(data.categories)) {
      data.categories = data.categories.map(c => {
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
        this._pendingTerms.add(data.channel)
      } else {
        console.error('_pendingTerms is still null or invalid after reinitialization, skipping add operation')
        console.error('_pendingTerms type:', typeof this._pendingTerms, 'value:', this._pendingTerms)
      }

      // Update progress state every 1000 records (without logging)
      if (afterLength % 1000 === 0) {
        // Update progress state - this will check for integer progress changes and update parent
        await this.updateState().catch(() => {}) // Don't block on state updates
      }

      // Log first few insertions for debugging
      if (afterLength <= 5) {
        console.debug(`Inserted programme ${afterLength}: ${data.title} on ${data.channel} (length: ${beforeLength} -> ${afterLength})`)
      }
    } catch (error) {
      console.error('Error in indexate:', error)
    }
  }

  async destroy() {
    this.debug && console.log('Destroying EPG instance for:', this.url)

    this.destroyed = true
    this.readyState = 'destroyed'

    // CRITICAL: Wait for any pending commit to complete before destroying
    if (this._state.commitInProgress) {
      this.debug && console.log('🟡 Waiting for commit to complete before destroying EPG...')

      try {
        // Use JexiDB native waitForOperations instead of polling
        if (this.udb) {
          this.debug && console.log('🟡 Waiting for database operations to complete...')
          await this.udb.waitForOperations()
          this.debug && console.log('✅ Database operations completed')
        }
        
        // Clear commit flag after operations complete
        this._state.commitInProgress = false
        this.debug && console.log('✅ Commit completed, proceeding with destruction')
        
      } catch (waitErr) {
        console.warn(`⚠️ Wait timeout for database operations: ${waitErr.message}`)
        // Force clear the flag to prevent infinite waiting
        this._state.commitInProgress = false
        this.debug && console.log('✅ Forcing destruction after timeout')
      }
    }

    // Stop memory monitoring
    this.memoryMonitor.stopMonitoring()
    this.clearLookupCache()

    // Call parent cleanup
    await this.cleanup()

    this.debug && console.log('EPG instance destroyed for:', this.url)
  }

}
