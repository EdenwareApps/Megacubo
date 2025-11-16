import { EventEmitter } from 'node:events'
import PQueue from 'p-queue'
import { EPG } from './EPG.js'
import { EPGCurator } from './EPGCurator.js'
import { EPG_CONFIG } from './config.js'
import { DatabaseFactory } from './database/DatabaseFactory.js'
import config from '../../config/config.js'
import ConnRacing from '../../conn-racing/conn-racing.js'
import { parseCommaDelimitedURIs, ucWords } from '../../utils/utils.js'
import setupUtils from '../../multi-worker/utils.js'
import { getFilename } from 'cross-dirname'
import { terms, match, resolveListDatabaseFile } from '../../lists/tools.js'
import lang from '../../lang/lang.js'
import fs from 'fs'
import { temp } from '../../paths/paths.js'

const utils = setupUtils(getFilename())

// Base class for EPG pagination and channel list management
class EPGPaginateChannelsList extends EventEmitter {
  constructor() {
    super()
    this.badTerms = new Set(['H.265', 'H.264', 'H265', 'H264', 'FHD', 'HD', 'SD', '2K', '4K', '8K'])
  }

  prepareChannelName(name) {
    return ucWords(name.split('[')[0].split(' ').filter(s => s && !this.badTerms.has(s.toUpperCase())).join(' '))
  }

  isASCIIChar(chr) {
    let c = chr.charCodeAt(0)
    return ((c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122))
  }

  getNameDiff(a, b) {
    let c = ''
    for (let i = 0; i < a.length; i++) {
      if (a[i] && b && b[i] && a[i] === b[i]) {
        c += a[i]
      } else {
        c += a[i]
        if (this.isASCIIChar(a[i])) {
          break
        }
      }
    }
    return c
  }

  getRangeName(names, lastName, nextName) {
    var l, start = '0', end = 'Z', r = new RegExp('[a-z\\d]', 'i'), r2 = new RegExp('[^a-z\\d]+$', 'i')
    for (var i = 0; i < names.length; i++) {
      if (lastName) {
        l = this.getNameDiff(names[i], lastName)
      } else {
        l = names[i].charAt(0)
      }
      if (l.match(r)) {
        start = l.toLowerCase().replace(r2, '')
        break
      }
    }
    for (var i = (names.length - 1); i >= 0; i--) {
      if (nextName) {
        l = this.getNameDiff(names[i], nextName)
      } else {
        l = names[i].charAt(0)
      }
      if (l.match(r)) {
        end = l.toLowerCase().replace(r2, '')
        break
      }
    }
    return start === end ? ucWords(start) : lang.X_TO_Y.format(start.toUpperCase(), end.toUpperCase())
  }
}

export default class EPGManager extends EPGPaginateChannelsList {
  constructor() {
    super()
    this.debug = false
    this.scoreMode = 'max'
    this.epgs = {}
    this.config = []
    
    // Unified queue for ALL EPG operations with priority support
    // Priority: 1 = high (manual/user additions), 0 = normal (suggested), -1 = low (fallbacks)
    this.epgQueue = new PQueue({ concurrency: 2 }) // Process one EPG operation at a time
    
    // Trias removed - using AI client instead
    this.curator = null // EPG data curator
    this._destroying = false // Flag to prevent new operations during destruction

    // EPG limits
    this.maxSuggestedEPGs = EPG_CONFIG.update.maxSuggestedEPGs
    this.maxManualEPGs = EPG_CONFIG.update.maxManualEPGs
    this.minProgrammesToLoad = EPG_CONFIG.update.minProgrammesToLoad || 4096 // Load EPGs until sum of programmes >= this value
    // Legacy: kept for backwards compatibility but not used for suggested EPGs
    this.minEPGsToLoad = 2 // Only used for non-suggested EPG counting

    // ConnRacing management
    this.activeConnRacing = null // Reference to active ConnRacing instance
        
    // Failed EPGs metadata (URL, error, timestamp) - no instances in memory
    this.failedEPGs = new Map() // Map<url, {error, timestamp, suggested}>

    // Track previously loaded EPGs for update notifications
    this.previousLoadedEPGs = []

    // Cache last suggested URLs for fallback
    this.lastSuggestedURLs = []
    
    // Auto-cleanup interval for error EPGs (prevent memory accumulation)
    this.cleanupInterval = null
    this.startAutoCleanup()

    // Log initialization
    this.debug && console.log('EPGManager constructor called - instance created')

    // Ensure config is always an array
    if (!this.config || !Array.isArray(this.config)) {
      this.config = []
    }

    this.debug && console.log('EPGManager initialized with concurrency limit of 2')
  }

  /**
   * Start auto-cleanup interval to remove error EPGs and prevent memory accumulation
   */
  startAutoCleanup() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval)
    }
    
    // Cleanup every 5 minutes
    this.cleanupInterval = setInterval(() => {
      this.cleanupErrorEPGs()
    }, 5 * 60 * 1000)
  }

  /**
   * Cleanup error EPGs that have been in error state for more than 10 minutes
   * Also cleanup if total EPGs exceed safe limit
   */
  async cleanupErrorEPGs() {
    const now = Date.now()
    const ERROR_EPG_MAX_AGE = 10 * 60 * 1000 // 10 minutes
    const MAX_EPGS_SAFE = 15 // Safe limit before aggressive cleanup
    
    const totalEPGs = Object.keys(this.epgs).length
    const errorEPGs = Object.entries(this.epgs).filter(([url, epg]) => 
      epg.readyState === 'error'
    )
    
    // Aggressive cleanup if too many EPGs
    if (totalEPGs > MAX_EPGS_SAFE) {
      this.debug && console.log(`🧹 [Cleanup] Too many EPGs (${totalEPGs}), cleaning up error EPGs...`)
      
      // Remove all error EPGs if over limit
      for (const [url, epg] of errorEPGs) {
        try {
          await this.remove(url, true) // keepErrorState = true to save metadata
          this.debug && console.log(`🧹 [Cleanup] Removed error EPG: ${url}`)
        } catch (err) {
          console.warn(`⚠️ Error removing EPG ${url} during cleanup:`, err.message)
        }
      }
      return
    }
    
    // Normal cleanup: remove error EPGs older than 10 minutes
    for (const [url, epg] of errorEPGs) {
      const errorAge = epg.errorTimestamp ? (now - epg.errorTimestamp) : Infinity
      
      if (errorAge > ERROR_EPG_MAX_AGE) {
        try {
          await this.remove(url, true) // keepErrorState = true to save metadata
          this.debug && console.log(`🧹 [Cleanup] Removed old error EPG (${Math.round(errorAge / 60000)}min old): ${url}`)
        } catch (err) {
          console.warn(`⚠️ Error removing old EPG ${url} during cleanup:`, err.message)
        }
      }
    }
  }

  // ===== Configuration Management =====

  EPGs() {
    const activeEPG = this.config
    if (activeEPG && activeEPG !== 'disabled') {
      if (Array.isArray(activeEPG)) {
        return activeEPG
      } else {
        return parseCommaDelimitedURIs(activeEPG).map(url => ({ url, active: true }))
      }
    }
    return []
  }

  activeEPGs() {
    const configuredEPGs = this.EPGs().filter(r => r.active).map(r => r.url)
    
    // Se epg-suggestions está desabilitado, retornar apenas EPGs configurados
    if (config.get('epg-suggestions') === false) {
      this.debug && console.log('EPG suggestions disabled, returning only configured EPGs:', configuredEPGs)
      return configuredEPGs
    }
    
    // Se epg-suggestions está habilitado, incluir EPGs sugeridos também
    const suggestedEPGs = Object.keys(this.epgs).filter(url => this.epgs[url]?.suggested)
    const allActiveEPGs = [...new Set([...configuredEPGs, ...suggestedEPGs])]
    
    this.debug && console.log('EPG suggestions enabled, returning all EPGs:', allActiveEPGs)
    return allActiveEPGs
  }

  /**
   * Gerencia EPGs sugeridos baseado no estado de destino explícito
   * @param {boolean} enable - true para habilitar, false para desabilitar
   */
  async toggleSuggestedEPGs(enable) {
    const currentSuggestedEPGs = Object.keys(this.epgs).filter(url => this.epgs[url]?.suggested)
    
    this.debug && console.log(`🔄 Toggling EPG suggestions: enable=${enable}, current suggested EPGs=${currentSuggestedEPGs.length}`)
    
    if (!enable && currentSuggestedEPGs.length > 0) {
      this.debug && console.log('🔄 Disabling EPG suggestions, removing suggested EPGs...')
      
      // Cancelar ConnRacing ativo se existir
      if (this.activeConnRacing && !this.activeConnRacing.destroyed) {
        this.debug && console.log('🛑 Canceling active ConnRacing...')
        this.activeConnRacing.destroy()
        this.activeConnRacing = null
      }
      
      // Resetar flag suggesting
      this.suggesting = false
      
      // Remover todos os EPGs sugeridos
      for (const url of currentSuggestedEPGs) {
        try {
          await this.remove(url)
          this.debug && console.log(`✅ Removed suggested EPG: ${url}`)
        } catch (err) {
          console.error(`❌ Error removing suggested EPG ${url}:`, err)
        }
      }
      
      await this.updateState()
      this.debug && console.log('✅ All suggested EPGs removed')
      
    } else if (enable && currentSuggestedEPGs.length === 0) {
      this.debug && console.log('🔄 Enabling EPG suggestions, triggering suggestion process...')
      
      // Notificar o manager para recarregar sugestões
      utils.emit('reload-suggestions')
    } else {
      this.debug && console.log('🔄 No action needed for EPG suggestions toggle')
    }
  }

  /**
   * Calculate total programmes count across all loaded suggested EPGs
   * @returns {number} Total number of programmes in all loaded suggested EPGs
   */
  _getTotalProgrammesCount() {
    return Object.values(this.epgs)
      .filter(epg => epg.suggested && epg.readyState === 'loaded')
      .reduce((sum, epg) => {
        // Try to get count from database first, then fallback to _programmeCounts
        // This handles cases where EPG is loaded but database is still initializing after finalizeUpdate()
        let count = 0
        if (epg.db && epg.db.initialized && !epg.db.destroyed) {
          count = (epg.db && typeof epg.db.length === 'number') ? epg.db.length : 0
        } else if (epg._programmeCounts && epg._programmeCounts.total) {
          // Use _programmeCounts if database not initialized yet (e.g., during finalizeUpdate)
          count = epg._programmeCounts.total || 0
        }
        return sum + count
      }, 0)
  }

  async waitForEPGsLoaded() {
    const maxWait = 300000 // 5 minutes maximum
    const startTime = Date.now()

    this.debug && console.log('Waiting for EPGs to load...')

    while (Date.now() - startTime < maxWait) {
      const loadedEPGs = Object.values(this.epgs).filter(epg => this.isLoaded(epg.url))

      if (loadedEPGs.length > 0) {
        this.debug && console.log(`Found ${loadedEPGs.length} loaded EPGs`)
        return true
      }

      await new Promise(resolve => setTimeout(resolve, 1000))
    }

    console.warn('Timeout waiting for EPGs to load, proceeding anyway')
    return false
  }

  async performDataCuration() {
    this.debug && console.log('🎨 Starting EPG data curation (icons only, cross-EPG)...')

    if (!this.curator) {
      console.warn('No curator available, skipping data curation')
      return
    }

    // First, clean old data from all EPGs (optional but kept)
    await this.cleanOldData()

    // 1) Build crossIconIndex across all EPGs
    const crossIconIndex = new Map()
    for (const url in this.epgs) {
      const epg = this.epgs[url]

      if (epg?.readyState !== 'loaded') {
        // EPG still loading - expected during initialization, skip silently
        continue
      }

      const db = epg.db
      if (!db || !db.initialized) {
        // Database not ready yet - expected during initialization, skip silently
        continue
      }

      try {
        const initialLength = (db && typeof db.length === 'number') ? db.length : 0
        this.debug && console.log(`🔍 Building icon index for ${url}: starting with db.length=${initialLength}`)
        
        for await (const p of db.walk()) {
          if (p?.icon) {
            const key = this.curator.normalizeTitle(p.title)
            if (!key) continue
            if (!crossIconIndex.has(key)) crossIconIndex.set(key, new Set())
            crossIconIndex.get(key).add(p.icon)
          }
        }
        
        const afterWalkLength = (db && typeof db.length === 'number') ? db.length : 0
        this.debug && console.log(`🔍 Icon index built for ${url}: db.length=${afterWalkLength} (was ${initialLength})`)
        
        if (afterWalkLength !== initialLength) {
          console.error(`🚨 FLAG: Database length changed during walk()! ${initialLength} → ${afterWalkLength}`)
        }
        
        if (!db.initialized || db.destroyed) {
          console.error(`🚨 FLAG: Database state changed during walk()! initialized=${db.initialized}, destroyed=${db.destroyed || false}`)
        }
      } catch (err) {
        console.warn(`Icon index build failed for ${url}:`, err.message)
        console.error(`🚨 FLAG: Error during walk() for ${url}:`, err)
      }
    }

    // 2) Apply icons to each EPG in a single pass for missing icons
    for (const url in this.epgs) {
      const epg = this.epgs[url]

      if (epg?.readyState !== 'loaded') {
        // EPG still loading - expected during initialization, skip silently
        continue
      }

      const db = epg.db
      if (!db || !db.initialized) {
        // Database not ready yet - expected during initialization, skip silently
        continue
      }

      try {
        const beforeCurationLength = (db && typeof db.length === 'number') ? db.length : 0
        // CRITICAL: Pass epg.file to fillMissingIcons as fallback
        const epgFilePath = epg.file
        const dbFilePath = db.normalizedFile
        this.debug && console.log(`🔍 Starting fillMissingIcons for ${url}: db.length=${beforeCurationLength}, normalizedFile=${db.normalizedFile || 'undefined'}, filePath=${epgFilePath}`)
        
        const results = await this.curator.fillMissingIcons(db, crossIconIndex, epgFilePath)
        this.debug && console.log(`✅ Icons-only curation for ${url}:`, results)
        
        const afterCurationLength = (db && typeof db.length === 'number') ? db.length : 0
        this.debug && console.log(`🔍 After fillMissingIcons for ${url}: db.length=${afterCurationLength} (was ${beforeCurationLength})`)
        
        if (afterCurationLength !== beforeCurationLength) {
          console.error(`🚨 FLAG: Database length changed during fillMissingIcons()! ${beforeCurationLength} → ${afterCurationLength}`)
        }
        
        if (!db.initialized || db.destroyed) {
          console.error(`🚨 FLAG: Database state changed during fillMissingIcons()! initialized=${db.initialized}, destroyed=${db.destroyed || false}`)
        }
      } catch (err) {
        console.error(`❌ Icons-only curation failed for ${url}:`, err)
        console.error(`🚨 FLAG: Error during fillMissingIcons() for ${url}:`, err)
      }
    }
    
    // CRITICAL: Verify database state after curation is complete
    this.debug && console.log(`🔍 Final database state check after curation:`)
    for (const url in this.epgs) {
      const epg = this.epgs[url]
      if (epg?.readyState === 'loaded' && epg.db) {
        const dbLength = (epg.db && typeof epg.db.length === 'number') ? epg.db.length : 0
        this.debug && console.log(`🔍 ${url}: initialized=${epg.db.initialized}, destroyed=${epg.db.destroyed || false}, length=${dbLength}`)
        
        if (dbLength === 0 && epg.db.initialized && !epg.db.destroyed) {
          console.error(`🚨 FLAG: Database has length=0 after curation for ${url}!`)
        }
      }
    }
  }

  /**
   * Clean old data from all EPGs to prevent stale information
   */
  async cleanOldData() {
    this.debug && console.log('🧹 Starting old data cleanup process...')
    
    const now = Date.now() / 1000 // Current Unix timestamp
    const maxAge = 7 * 24 * 3600 // 7 days in seconds
    
    for (const url in this.epgs) {
      const epg = this.epgs[url]
      
      if (!epg.db || !epg.db.initialized) {
        this.debug && console.log(`Skipping ${url} - database not initialized`)
        continue
      }
      
      try {
        this.debug && console.log(`🧹 Cleaning old data from ${url}...`)
        
        // Count old programmes before cleanup
        // Verificar se db.count existe antes de chamar
        let oldCount = 0
        if (epg.db && epg.db.count && typeof epg.db.count === 'function' && !epg.db.destroyed && !epg.db.closed) {
          oldCount = await epg.db.count({ end: { '<': now - maxAge } }).catch(() => 0)
        }
        const totalCount = (epg.db && typeof epg.db.length === 'number') ? epg.db.length : 0
        
        if (oldCount > 0) {
          this.debug && console.log(`📊 ${url}: Found ${oldCount} old programmes out of ${totalCount} total`)
          
          // Remove old programmes
          const deletedCount = await epg.db.delete({ end: { '<': now - maxAge } }).catch(() => 0)
          
          this.debug && console.log(`✅ ${url}: Removed ${deletedCount} old programmes`)
          
          // CRITICAL FIX: Recalculate _programmeCounts after cleanup
          if (epg && epg._calculateProgrammeCounts) {
            try {
              await epg._calculateProgrammeCounts()
              this.debug && console.log(`📊 Recalculated _programmeCounts after old data cleanup for ${url}:`, epg._programmeCounts)
              // Update state after counts change
              await this.updateState()
            } catch (err) {
              console.warn(`Failed to recalculate _programmeCounts after cleanup for ${url}:`, err)
            }
          }
          
          // Update EPG state after cleanup
          await this.updateState()
        } else {
          this.debug && console.log(`✅ ${url}: No old data found`)
        }
        
      } catch (err) {
        console.error(`❌ Error cleaning old data from ${url}:`, err.message)
      }
    }
    
    this.debug && console.log('🧹 Old data cleanup process completed')
  }

  async start(config) {
    this.debug && console.log('EPGManager.start() called with config:', config)

    // Initialize curator for duplicate detection and data cleanup
    this.curator = new EPGCurator(temp)
    this.debug && console.log('EPG Curator initialized for data curation')

    this.debug && console.log('Calling sync with config:', config)
    await this.sync(config)
    this.debug && console.log('sync completed')
    
    // Wait for EPGs to load completely before starting curation
    await this.waitForEPGsLoaded()

    // Start data curation AFTER EPGs are loaded and saved
    setTimeout(async () => {
        // Wait for at least one EPG to have data
        let attempts = 0
        const maxAttempts = 60 // 60 seconds max wait
        
        while (attempts < maxAttempts) {
          const epgsWithData = Object.values(this.epgs).filter(epg => 
            epg.db && epg.db.initialized && epg.db.length > 0
          )
          
          if (epgsWithData.length > 0) {
            this.debug && console.log(`Found ${epgsWithData.length} EPG(s) with data, starting cleanup and curation...`)
            break
          }
          
          await new Promise(resolve => setTimeout(resolve, 1000))
          attempts++
        }
        
        if (attempts >= maxAttempts) {
          console.warn('Timeout waiting for EPG data, skipping cleanup and curation')
          return
        }
        
        // First clean old data, then perform curation
        this.performDataCuration().catch(err => {
          console.error('Data curation failed:', err)
        })
        this.debug && console.log('🎨 Curation enabled - starting data curation process')
    }, 5000) // Initial 5 second delay before starting to check
  }

  async sync(config) {
    this.debug && console.log('EPGManager.sync() called with config:', config)

    // Ensure config is always an array
    this.config = Array.isArray(config) ? config : []

    const activeEPGs = this.activeEPGs()
    const currentEPGs = Object.keys(this.epgs)

    // Remove inactive EPGs FIRST (sequentially to avoid conflicts)
    const toRemove = currentEPGs.filter(url => !activeEPGs.includes(url))

    for (const url of toRemove) {
      if (!this.epgs[url]?.suggested) {
        this.debug && console.log('Removing EPG:', url)
        try {
          await this.remove(url)
          // Wait a bit between removals to ensure cleanup
          await new Promise(resolve => setTimeout(resolve, 100))
        } catch (err) {
          console.error('Error removing EPG:', url, err)
        }
      }
    }

    // Add new EPGs AFTER removals are complete
    const toAdd = activeEPGs.filter(url => !currentEPGs.includes(url))

    // Add configured EPGs first (priority)
    for (const url of toAdd) {
      this.debug && console.log('Adding configured EPG:', url)
      try {
        // Add timeout to prevent hanging
        await this.add(url, false) // false = not suggested
        this.debug && console.log('Successfully added configured EPG:', url)
        // Wait a bit between additions to ensure proper initialization
        await new Promise(resolve => setTimeout(resolve, 100))
      } catch (err) {
        console.error('Error adding configured EPG:', url, err)
        
        // If it's a timeout, save the failure metadata
        if (err.message === 'EPG add timeout') {
          this.failedEPGs.set(url, {
            error: 'EPG_ADD_TIMEOUT',
            timestamp: Date.now(),
            suggested: false // configured EPGs are not suggested
          })
          this.debug && console.log(`✅ Saved failed configured EPG metadata for ${url} (add timeout) - failedEPGs size: ${this.failedEPGs.size}`)
        }
      }
    }

    // Check if we need more EPGs to reach minEPGsToLoad
    const currentWorkingEPGs = Object.values(this.epgs).filter(epg =>
      this.isLoaded(epg.url) || epg.readyState === 'loading'
    ).length

    const epgsNeeded = Math.max(0, this.minEPGsToLoad - currentWorkingEPGs)
    this.debug && console.log(`After config EPGs: ${currentWorkingEPGs} working, need ${epgsNeeded} more to reach minEPGsToLoad=${this.minEPGsToLoad}`)

    if (epgsNeeded > 0) {
      this.debug && console.log('Will attempt to load suggested EPGs to reach minimum requirement')
      // The suggest() method will be called later by the manager to fill remaining slots
    }

    this.debug && console.log('EPG sync completed')
  }

  // ===== EPG Management =====

  // Método helper para verificar se existe cache persistente no disco
  async _hasPersistentCache(url) {
    try {
      // Resolver caminhos dos arquivos de cache
      const programmesFile = resolveListDatabaseFile('epg-programmes-' + url)
      const metadataFile = resolveListDatabaseFile('epg-metadata-' + url)
      
      // Verificar se ambos os arquivos existem usando fs.existsSync (síncrono)
      const programmesExists = fs.existsSync(programmesFile)
      const metadataExists = fs.existsSync(metadataFile)
      
      return programmesExists && metadataExists
    } catch (err) {
      console.warn(`Error checking persistent cache for ${url}:`, err.message)
      return false
    }
  }

  // Método helper para obter mtime do cache persistente
  async _getPersistentCacheMtime(url) {
    try {
      const metadataFile = resolveListDatabaseFile('epg-metadata-' + url)
      
      // Criar instância temporária do database para ler mtime
      const tempMdb = DatabaseFactory.createMetadataDB(metadataFile)
      await DatabaseFactory.initializeDB(tempMdb)
      
      // Buscar control key com timestamp
      const controlKey = tempMdb.findOne({ _type: 'control', key: 'lastmCtrlKey' })
      
      // Limpar instância temporária
      await tempMdb.destroy()
      
      return controlKey?.timestamp || null
    } catch (err) {
      console.warn(`Error getting mtime for ${url}:`, err.message)
      return null
    }
  }

  async suggest(urls) {
    const providedUrls = Array.isArray(urls) ? urls.filter(Boolean) : []
    const candidateUrls = providedUrls.length ? [...providedUrls] : [...(this.lastSuggestedURLs || [])]

    this.debug && console.log('Suggesting EPGs:', candidateUrls)

    if (!candidateUrls.length) {
      this.suggesting = false
      return 0
    }

    if (providedUrls.length) {
      this.lastSuggestedURLs = [...candidateUrls]
    } else {
      this.debug && console.log('Using cached suggested URLs')
    }

    if (this.suggesting) {
      this.debug && console.log('Already suggesting EPGs, skipping')
      return 0
    }

    this.suggesting = true
    
    try {
      // Save suggested URLs in this.config for use in fallback
      // Add URLs that are not in this.config
      const existingURLs = this.config.map(c => c.url || c)
      const newURLs = candidateUrls.filter(url => !existingURLs.includes(url))
      
      if (newURLs.length > 0) {
        this.config = [...this.config, ...newURLs.map(url => ({ url, suggested: true }))]
        this.debug && console.log(`Added ${newURLs.length} new suggested URLs to config for fallback`)
      }

      // NEW: Check total programmes count instead of EPG count for suggested EPGs
      const currentProgrammes = this._getTotalProgrammesCount()
      const programmesNeeded = Math.max(0, this.minProgrammesToLoad - currentProgrammes)
      this.debug && console.log(`📊 Current total programmes in suggested EPGs: ${currentProgrammes}, need ${programmesNeeded} more to reach minProgrammesToLoad=${this.minProgrammesToLoad}`)

      if (programmesNeeded <= 0) {
        this.debug && console.log('✅ Already have enough programmes in suggested EPGs, skipping suggestions')
        return 0
      }

      // Count current working suggested EPGs for reference
      const currentWorkingEPGs = Object.values(this.epgs).filter(epg =>
        epg.suggested && (this.isLoaded(epg.url) || epg.readyState === 'loading')
      ).length
      this.debug && console.log(`📋 Currently have ${currentWorkingEPGs} working suggested EPG(s) with ${currentProgrammes} total programmes`)

      // CATEGORIZAR URLs por cache persistente e mtime
      const validCachedURLs = []  // Cache < 3 horas - carregam ASAP
      const cachedURLs = []       // Cache > 3 horas - testados primeiro
      const untestedURLs = []     // Sem cache - testados normalmente
      
      for (const url of candidateUrls) {
        // Se EPG já está carregado em memória, ignorar completamente
        if (this.epgs[url] && this.isLoaded(url)) {
          this.debug && console.log(`✅ EPG already loaded in memory: ${url} - skipping`)
          continue
        }
        
        // Verificar se existe cache persistente
        const hasCache = await this._hasPersistentCache(url)
        
        if (hasCache) {
          // Obter mtime do cache persistente
          const mtime = await this._getPersistentCacheMtime(url)
          
          if (mtime) {
            const hoursSinceModified = (Date.now() - mtime) / (1000 * 60 * 60)
            
            if (hoursSinceModified < 3) {
              validCachedURLs.push(url)
              this.debug && console.log(`⚡ Valid cached EPG (< 3h): ${url} (${hoursSinceModified.toFixed(1)}h ago)`)
            } else {
              cachedURLs.push(url)
              this.debug && console.log(`🔄 Cached EPG (> 3h): ${url} (${hoursSinceModified.toFixed(1)}h ago)`)
            }
          } else {
            cachedURLs.push(url)
            this.debug && console.log(`🔄 Cached EPG (no mtime): ${url}`)
          }
        } else {
          untestedURLs.push(url)
          this.debug && console.log(`❓ Untested EPG: ${url}`)
        }
      }
      
      this.debug && console.log(`📊 URL Categorization:
        - Valid cached (< 3h): ${validCachedURLs.length}
        - Cached (> 3h): ${cachedURLs.length}  
        - Untested: ${untestedURLs.length}`)

      // Cancelar ConnRacing anterior se existir
      if (this.activeConnRacing && !this.activeConnRacing.destroyed) {
        this.debug && console.log('🛑 Canceling previous ConnRacing...')
        this.activeConnRacing.destroy()
      }

      // 1. CARREGAR validCachedURLs IMEDIATAMENTE (ignorar ConnRacing)
      let loadedCount = 0
      const startTime = Date.now()
      
      for (const url of validCachedURLs) {
        // Recalculate current total to include all loaded EPGs
        let currentTotalProgrammes = this._getTotalProgrammesCount()
        
        // Check if we've reached the programmes quota
        if (currentTotalProgrammes >= this.minProgrammesToLoad) {
          this.debug && console.log(`✅ Reached programmes quota (${currentTotalProgrammes} >= ${this.minProgrammesToLoad}), stopping load`)
          break
        }
        
        this.debug && console.log(`⚡ Loading valid cached EPG ASAP: ${url}`)
        try {
          await this.add(url, true) // true = suggested
          await this.waitForEPGLoad(url, 30000) // Wait for load to complete
          
          // Recalculate after loading to get accurate count
          currentTotalProgrammes = this._getTotalProgrammesCount()
          const epg = this.epgs[url]
          
          if (epg && this.isLoaded(url) && epg.readyState === 'loaded') {
            const programmesCount = epg.db?.length || epg._programmeCounts?.total || 0
            this.debug && console.log(`✅ Loaded valid cached EPG: ${url} (${programmesCount} programmes, total now: ${currentTotalProgrammes}/${this.minProgrammesToLoad})`)
          }
          loadedCount++
        } catch (error) {
          console.warn(`Failed to load valid cached EPG ${url}:`, error.message)
        }
      }
      
      // 2. PREPARAR URLs para ConnRacing (cachedURLs primeiro)
      const urlsForConnRacing = [...cachedURLs, ...untestedURLs]
      
      // Recalculate total programmes after loading validCachedURLs
      let currentTotalProgrammes = this._getTotalProgrammesCount()
      
      // Continue loading if we haven't reached the programmes quota
      if (urlsForConnRacing.length > 0 && currentTotalProgrammes < this.minProgrammesToLoad) {
        this.debug && console.log(`🚀 Testing ${urlsForConnRacing.length} URLs with ConnRacing (cached first)...`)
        
        this.activeConnRacing = new ConnRacing(urlsForConnRacing, { 
          retries: 2, 
          timeout: 60
        })
        
        // Process results as they come in using next() method
        // Continue until we reach programmes quota or run out of URLs
        // currentTotalProgrammes already calculated above
        
        while (currentTotalProgrammes < this.minProgrammesToLoad) {
          const result = await this.activeConnRacing.next()
          
          if (!result) {
            this.debug && console.log('No more results from ConnRacing')
            break
          }
          
          if (result.valid && result.status >= 200 && result.status < 300) {
            this.debug && console.log(`🎯 Fast EPG found: ${result.url} (${result.time.toFixed(2)}s)`)
            
            try {
              // Load the fast EPG immediately
              await this.add(result.url, true) // true = suggested
              
              // Wait for EPG to complete loading (parser + database operations)
              this.debug && console.log(`⏳ Waiting for EPG ${result.url} to complete loading...`)
              const loadSuccess = await this.waitForEPGLoad(result.url, 30000) // Reduced to 30 second timeout
              
              // Recalculate total programmes using the helper (includes all loaded EPGs)
              currentTotalProgrammes = this._getTotalProgrammesCount()
              const epg = this.epgs[result.url]
              
              if (!loadSuccess) {
                // Even if timeout, check if EPG has data - it might be partially loaded
                if (epg && epg.readyState === 'loaded' && this.isLoaded(result.url)) {
                  const programmesCount = epg.db?.length || epg._programmeCounts?.total || 0
                  if (programmesCount > 0) {
                    this.debug && console.log(`⚠️ EPG ${result.url} loaded partially (timeout) but has ${programmesCount} programmes, counting it`)
                    loadedCount++
                    // currentTotalProgrammes already updated by _getTotalProgrammesCount()
                  } else {
                    this.debug && console.log(`❌ EPG ${result.url} failed to load within timeout and has no data, trying next EPG...`)
                  }
                } else {
                  this.debug && console.log(`❌ EPG ${result.url} failed to load within timeout, trying next EPG...`)
                }
                // Check quota after timeout case
                if (currentTotalProgrammes >= this.minProgrammesToLoad) {
                  this.debug && console.log(`✅ Reached programmes quota after timeout handling (${currentTotalProgrammes} >= ${this.minProgrammesToLoad}), stopping load`)
                  break
                }
                continue
              }
              
              if (!epg || !this.isLoaded(result.url) || epg.readyState !== 'loaded') {
                this.debug && console.log(`❌ EPG ${result.url} not properly loaded, skipping`)
                // Still check quota
                if (currentTotalProgrammes >= this.minProgrammesToLoad) {
                  this.debug && console.log(`✅ Reached programmes quota (${currentTotalProgrammes} >= ${this.minProgrammesToLoad}), stopping load`)
                  break
                }
                continue
              }
              
              const programmesCount = epg.db?.length || epg._programmeCounts?.total || 0
              
              // Log debug info for the loaded EPG
              this.debug && console.log(`EPG Debug Info for ${result.url}: ${JSON.stringify({
                bytesDownloaded: epg.bytesDownloaded,
                statusCode: epg.statusCode,
                parsedEntriesCount: epg.parsedEntriesCount,
                readyState: epg.readyState,
                programmesCount
              })}`)
              
              if (programmesCount == 0 || epg.readyState === 'error') {
                throw new Error(`No programmes in EPG ${result.url} - readyState: ${epg.readyState}, programmesCount: ${programmesCount}`)
              }
              
              loadedCount++
              this.debug && console.log(`✅ Successfully loaded fast EPG: ${result.url} (${programmesCount} programmes, total now: ${currentTotalProgrammes}/${this.minProgrammesToLoad})`)
              
              // Check if we've reached the quota (currentTotalProgrammes already updated by _getTotalProgrammesCount())
              if (currentTotalProgrammes >= this.minProgrammesToLoad) {
                this.debug && console.log(`✅ Reached programmes quota (${currentTotalProgrammes} >= ${this.minProgrammesToLoad}), stopping load`)
                break
              }
            } catch (error) {
              console.warn(`Failed to load fast EPG ${result.url}:`, error.message)
              this.failedEPGs.set(result.url, {
                error: error.message,
                timestamp: Date.now(),
                suggested: true
              })
              // Recalculate after error
              currentTotalProgrammes = this._getTotalProgrammesCount()
            }
          } else {
            this.debug && console.log(`❌ EPG failed: ${result.url} (${result.status})`)
            const errorCode = typeof result.status === 'number'
              ? `HTTP_${result.status}`
              : (result.error || 'REQUEST_FAILED')
            this.failedEPGs.set(result.url, {
              error: errorCode,
              timestamp: Date.now(),
              suggested: true
            })
            this.updateState().catch(err => this.debug && console.log('Failed to update state after EPG failure:', err?.message || err))
          }
        }
      }

      const duration = Date.now() - startTime
      this.debug && console.log(`✅ Suggest completed in ${duration}ms, loaded ${loadedCount} EPGs`)
      return loadedCount
      
    } finally {
      // Sempre resetar a flag e limpar referência do ConnRacing
      this.suggesting = false
      this.activeConnRacing = null
    }
  }

  /**
   * Get channel terms index for debugging purposes
   * @returns {Promise<Object|null>} Channel terms index or null if not set
   */
  async setChannelTermsIndex(channelTermsIndex) {
    this.channelTermsIndex = channelTermsIndex
    
    // Notify all EPG instances about the updated channel terms
    for (const url in this.epgs) {
      const epg = this.epgs[url]
      if (epg) {
        epg.channelTermsIndex = this.channelTermsIndex
      }
    }
  }

  async getChannelTermsIndex() {
    if (!this.channelTermsIndex) {
      return null
    }
    
    // Convert to serializable format (avoid Set/Map)
    const serializable = {}
    for (const [channelName, channelTerms] of Object.entries(this.channelTermsIndex)) {
      serializable[channelName] = Array.isArray(channelTerms) ? channelTerms : []
    }
    
    return serializable
  }

  async add(url, suggested = false) {
    this.debug && console.log('EPGManager.add() called with url:', url, 'suggested:', suggested)

    // CRITICAL: Check if manager is being destroyed
    if (this._destroying) {
      console.warn('EPGManager is being destroyed, cannot add new EPG:', url)
      return
    }

    if (this.epgs[url]) {
      this.debug && console.log('EPG already exists for:', url)
      return
    }

    // Determine priority: HIGH for manual, NORMAL for suggested
    const priority = suggested ? 0 : 1

    // Add to unified queue with appropriate priority
    if (!this.epgQueue || typeof this.epgQueue.add !== 'function') {
      console.warn('epgQueue not available or invalid, falling back to direct execution')
      return this._addEPGInternal(url, suggested)
    }
    
    try {
      // CRITICAL: Log before adding to queue
      this.debug && console.log('🔵 BEFORE epgQueue.add() in add():')
      this.debug && console.log(`  - URL: ${url}`)
      this.debug && console.log(`  - Priority: ${priority}`)
      this.debug && console.log(`  - epgQueue exists: ${!!this.epgQueue}`)
      this.debug && console.log(`  - epgQueue.add exists: ${typeof this.epgQueue.add === 'function'}`)
      this.debug && console.log(`  - epgQueue.size: ${this.epgQueue?.size || 0}`)
      this.debug && console.log(`  - epgQueue.pending: ${this.epgQueue?.pending || 0}`)
      this.debug && console.log(`  - _destroying flag: ${this._destroying}`)
      
      return this.epgQueue.add(async () => {
        this.debug && console.log(`Processing EPG addition from queue: ${url} (priority: ${priority}, queue size: ${this.epgQueue?.size || 0})`)
        await this._addEPGInternal(url, suggested)
      }, { priority })
      
      this.debug && console.log('🟢 AFTER epgQueue.add() in add(): Operation added successfully')
    } catch (err) {
      console.error('🔴 ERROR adding to epgQueue, falling back to direct execution:', err.message)
      console.error('Error stack:', err.stack)
      return this._addEPGInternal(url, suggested)
    }
  }

  async _addEPGInternal(url, suggested = false) {
    // Double-check in case EPG was added while waiting in queue
    if (this.epgs[url]) {
      this.debug && console.log('EPG already exists (checked in queue):', url)
      return
    }

    this.debug && console.log('Proceeding with EPG addition for:', url)

    // REMOVED: All logic that removes existing EPGs before loading the new one
    // This was causing legitimate EPGs to be removed for unknown EPGs

    const loadedEPGs = Object.values(this.epgs).filter(epg => this.isLoaded(epg.url)).map(epg => ({ url: epg.url, suggested: epg.suggested, length: epg.length }))

    // Ensure this.config is an array before calling .find()
    if (!this.config || !Array.isArray(this.config)) {
      console.warn('EPG config is not properly initialized, using empty config for:', url)
      this.config = []
    }

    const config = this.config.find(c => c.url === url)

    try {
      this.debug && console.log('Creating EPG instance for:', url)
      const epg = new EPG(url, { 
        suggested,
        channelTermsIndex: this.channelTermsIndex
      })
      if (!epg) {
        console.error('Failed to create EPG instance for:', url)
        return
      }

      // Set properties only if EPG was created successfully
      epg.suggested = suggested
      epg.url = url
      epg.parent = this // Set reference to EPGManager

      // Listen for EPG errors that happen after start() completes
      epg.on('error', (err) => {
        console.warn(`EPG error event received for ${url}:`, err)
      })

      this.epgs[url] = epg
      
      // Warn if too many EPGs are accumulated in memory (potential OOM risk)
      const totalEPGs = Object.keys(this.epgs).length
      const MAX_EPGS_WARN = 20
      const errorEPGs = Object.values(this.epgs).filter(e => e.readyState === 'error').length
      const loadingEPGs = Object.values(this.epgs).filter(e => e.readyState === 'loading' || e.readyState === 'downloading' || e.readyState === 'parsing' || e.readyState === 'processing').length
      
      if (totalEPGs >= MAX_EPGS_WARN) {
        console.warn(`⚠️ [OOM Risk] Too many EPGs in memory: ${totalEPGs} total (error: ${errorEPGs}, loading: ${loadingEPGs}, loaded: ${totalEPGs - errorEPGs - loadingEPGs}). EPG: ${url}, suggested: ${suggested}`)
      } else if (totalEPGs >= MAX_EPGS_WARN * 0.8) {
        console.warn(`⚠️ [Memory Warning] High number of EPGs in memory: ${totalEPGs} total (error: ${errorEPGs}, loading: ${loadingEPGs}, loaded: ${totalEPGs - errorEPGs - loadingEPGs}). EPG: ${url}`)
      }
      
      // Warn about accumulated error/loading EPGs specifically
      if (errorEPGs >= 5) {
        console.warn(`⚠️ [Memory Warning] Many error EPGs accumulated: ${errorEPGs}/${totalEPGs} EPGs in error state (may need cleanup)`)
      }
      if (loadingEPGs >= 5) {
        console.warn(`⚠️ [Memory Warning] Many loading EPGs accumulated: ${loadingEPGs}/${totalEPGs} EPGs still loading (may be stuck)`)
      }
      this.debug && console.log('EPG instance created, starting...')

      this.failedEPGs.delete(url)

      // Update state immediately after adding EPG
      await this.updateState()
      await epg.start()
      
      this.debug && console.log('EPG added successfully:', url, 'state:', epg.readyState, 'length:', epg.length)
      this.debug && console.log('EPG programme counts: ' + JSON.stringify(epg._programmeCounts))

      // Check EPG limit ONLY AFTER the EPG is successfully loaded
      // For suggested EPGs: check total programmes count instead of EPG count
      // For non-suggested EPGs: use legacy EPG count logic
      if (suggested) {
        // NEW: For suggested EPGs, check total programmes quota
        // Wait for database to be initialized after finalizeUpdate() completes
        // The database is recreated during finalizeUpdate() and needs time to initialize
        let attempts = 0
        while (attempts < 10 && (!epg.db || !epg.db.initialized)) {
          await new Promise(resolve => setTimeout(resolve, 100))
          attempts++
        }
        
        // Get current programmes count - use db.length if available, otherwise _programmeCounts
        const currentTotalProgrammes = this._getTotalProgrammesCount()
        this.debug && console.log(`🔍 Current total programmes in suggested EPGs after loading ${url}: ${currentTotalProgrammes}/${this.minProgrammesToLoad}`)
        this.debug && console.log(`🔍 EPG ${url} state: readyState=${epg.readyState}, db.initialized=${epg.db?.initialized}, db.length=${epg.db?.length || 0}, _programmeCounts.total=${epg._programmeCounts?.total || 0}`)
        
        if (currentTotalProgrammes > this.minProgrammesToLoad) {
          this.debug && console.log(`🔧 Suggested EPGs programmes quota exceeded (${currentTotalProgrammes} > ${this.minProgrammesToLoad}), removing smaller EPGs until under limit`)
          
          // Get all loaded suggested EPGs with their sizes
          const allLoadedSuggestedEPGs = Object.keys(this.epgs).filter(epgUrl => {
            const epgInstance = this.epgs[epgUrl]
            return epgInstance.suggested && this.isLoaded(epgUrl) && epgInstance.readyState === 'loaded' && 
                   epgInstance.db && epgInstance.db.initialized && epgInstance.db.length > 0
          })
          
          const epgSizes = []
          for (const epgUrl of allLoadedSuggestedEPGs) {
            const epgInstance = this.epgs[epgUrl]
            let size = 0
            
            if (epgInstance.db && epgInstance.db.initialized) {
              size = epgInstance.db.length || 0
            } else if (epgInstance._programmeCounts && epgInstance._programmeCounts.total) {
              size = epgInstance._programmeCounts.total
            }
            
            epgSizes.push({ url: epgUrl, size, suggested: true })
          }
          
          // Sort by size (largest first) - keep largest EPGs
          epgSizes.sort((a, b) => b.size - a.size)
          
          // Remove smaller EPGs until total is under quota
          let totalAfterRemoval = epgSizes.reduce((sum, e) => sum + e.size, 0)
          const epgsToRemove = []
          
          for (let i = epgSizes.length - 1; i >= 0 && totalAfterRemoval > this.minProgrammesToLoad; i--) {
            const epg = epgSizes[i]
            
            // Stop if we would remove the last EPG - always keep at least one
            if (epgsToRemove.length >= epgSizes.length - 1) {
              break
            }
            
            totalAfterRemoval -= epg.size
            epgsToRemove.push(epg)
          }
          
          const epgsToKeep = epgSizes.filter(e => !epgsToRemove.includes(e))
          
          this.debug && console.log(`📊 Suggested EPG sizes:`, epgSizes.map(e => `${e.url}: ${e.size} programmes`))
          this.debug && console.log(`✅ Keeping EPGs:`, epgsToKeep.map(e => `${e.url} (${e.size} programmes)`))
          this.debug && console.log(`🗑️ Removing EPGs:`, epgsToRemove.map(e => `${e.url} (${e.size} programmes)`))
          this.debug && console.log(`📊 Total after removal: ${totalAfterRemoval}/${this.minProgrammesToLoad}`)
          
          // Remove smaller EPGs
          for (const epgToRemove of epgsToRemove) {
            this.debug && console.log(`🗑️ Removing smaller suggested EPG: ${epgToRemove.url} (${epgToRemove.size} programmes)`)
            await this.remove(epgToRemove.url)
          }
          
          // Final state update after removals
          await this.updateState()
        }
      } else {
        // Legacy: For non-suggested EPGs, use old EPG count logic
        const allLoadedEPGs = Object.keys(this.epgs).filter(epgUrl => {
          const epgInstance = this.epgs[epgUrl]
          return !epgInstance.suggested && this.isLoaded(epgUrl) && epgInstance.readyState === 'loaded' && 
                 epgInstance.db && epgInstance.db.initialized && epgInstance.db.length > 0
        })
        
        this.debug && console.log(`🔍 Current loaded non-suggested EPGs count after loading ${url}: ${allLoadedEPGs.length} (legacy quota: ${this.minEPGsToLoad})`)
        
        if (allLoadedEPGs.length > this.minEPGsToLoad) {
          this.debug && console.log(`🔧 Non-suggested EPG limit exceeded (${allLoadedEPGs.length} > ${this.minEPGsToLoad}), keeping only the ${this.minEPGsToLoad} largest EPGs`)
          
          // Get EPG sizes and sort by size (largest first)
          const epgSizes = []
          for (const epgUrl of allLoadedEPGs) {
            const epgInstance = this.epgs[epgUrl]
            let size = 0
            
            if (epgInstance.db && epgInstance.db.initialized) {
              size = epgInstance.db.length || 0
            } else if (epgInstance._programmeCounts && epgInstance._programmeCounts.total) {
              size = epgInstance._programmeCounts.total
            }
            
            epgSizes.push({ url: epgUrl, size, suggested: false })
          }
          
          // Sort by size (largest first)
          epgSizes.sort((a, b) => b.size - a.size)
          
          // Keep the N largest EPGs, remove the rest
          const epgsToKeep = epgSizes.slice(0, this.minEPGsToLoad)
          const epgsToRemove = epgSizes.slice(this.minEPGsToLoad)
          
          this.debug && console.log(`📊 Non-suggested EPG sizes:`, epgSizes.map(e => `${e.url}: ${e.size} programmes`))
          this.debug && console.log(`✅ Keeping EPGs:`, epgsToKeep.map(e => `${e.url} (${e.size} programmes)`))
          this.debug && console.log(`🗑️ Removing EPGs:`, epgsToRemove.map(e => `${e.url} (${e.size} programmes)`))
          
          // Remove smaller EPGs
          for (const epgToRemove of epgsToRemove) {
            this.debug && console.log(`🗑️ Removing smaller non-suggested EPG: ${epgToRemove.url} (${epgToRemove.size} programmes)`)
            await this.remove(epgToRemove.url)
          }
          
          // Final state update after removals
          await this.updateState()
        }
      }

      // Emit update event to notify lists.js
      utils.emit('update', url)
      
      // Final state update after EPG is added and started
      await this.updateState()
    } catch (err) {
      console.error('Failed to add EPG:', url, err)
      // Keep the EPG instance with error state for status reporting
      if (this.epgs[url]) {
        this.epgs[url].readyState = 'error'
        this.epgs[url].error = err
        // Update state to reflect error
        await this.updateState()
      }
      
      // If it's a timeout, save the failure metadata
      if (err.message === 'EPG start timeout') {
        this.failedEPGs.set(url, {
          error: 'EPG_START_TIMEOUT',
          timestamp: Date.now(),
          suggested: suggested
        })
        this.debug && console.log(`✅ Saved failed EPG metadata for ${url} (start timeout) - failedEPGs size: ${this.failedEPGs.size}`)
      }
    }
  }

  isLoaded(url) {
    return this.epgs[url] && this.epgs[url].db && this.epgs[url].db.initialized && 
      this.epgs[url].readyState === 'loaded'
  }

  /**
   * Wait for EPG to complete loading (parser + database operations) using events
   * @param {string} url - EPG URL to wait for
   * @param {number} timeout - Maximum time to wait in milliseconds (default: 120000 = 2 minutes)
   * @returns {Promise<boolean>} - true if loaded successfully, false if timeout or error
   */
  async waitForEPGLoad(url, timeout = 120000) {
    if (!this.epgs[url]) {
      console.warn(`EPG ${url} not found in manager`)
      return false
    }

    const epg = this.epgs[url]
    const startTime = Date.now()
    
    this.debug && console.log(`⏳ Waiting for EPG ${url} to complete loading...`)
    this.debug && console.log(`Initial state: readyState=${epg.readyState}, db.initialized=${epg.db?.initialized}`)

    // Check if already loaded
    if (this.isLoaded(url)) {
      this.debug && console.log(`✅ EPG ${url} already loaded`)
      return true
    }

    // Check if already in error state
    if (epg.readyState === 'error') {
      this.debug && console.log(`❌ EPG ${url} already failed with error: ${epg.error}`)
      return false
    }

    return new Promise((resolve) => {
      let timeoutId = null
      let resolved = false

      const cleanup = () => {
        if (timeoutId) {
          clearTimeout(timeoutId)
          timeoutId = null
        }
        // Remove event listeners
        epg.removeListener('stateChange', onStateChange)
        epg.removeListener('error', onError)
        epg.removeListener('stateChange', onLoadedState)
      }

      const resolveOnce = (success, reason) => {
        if (resolved) return
        resolved = true
        cleanup()
        
        const elapsed = Date.now() - startTime
        if (success) {
          this.debug && console.log(`✅ EPG ${url} loaded successfully after ${elapsed}ms`)
          this.debug && console.log(`Final state: readyState=${epg.readyState}, db.length=${epg.db?.length || 0}`)
        } else {
          this.debug && console.log(`❌ EPG ${url} ${reason} after ${elapsed}ms`)
        }
        resolve(success)
      }

      const onStateChange = (stateInfo) => {
        this.debug && console.log(`🔄 EPG ${url} state changed: ${stateInfo.from} → ${stateInfo.to}`)
        
        if (stateInfo.to === 'loaded' || stateInfo.to === 'ready') {
          resolveOnce(true, 'state change to loaded/ready')
        }
      }

      const onError = (error) => {
        this.debug && console.log(`❌ EPG ${url} error event:`, error.message)
        resolveOnce(false, 'error event')
      }

      // Set up timeout if specified
      if (timeout > 0) {
        timeoutId = setTimeout(() => {
          resolveOnce(false, 'timeout')
        }, timeout)
      }

      // Listen for state changes and errors
      epg.on('stateChange', onStateChange)
      epg.on('error', onError)

      // Listen for state changes to 'loaded' or 'ready'
      const onLoadedState = (stateInfo) => {
        if (stateInfo.to === 'loaded' || stateInfo.to === 'ready') {
          resolveOnce(true, 'loaded state reached')
        }
      }
      
      epg.on('stateChange', onLoadedState)
    })
  }

  async remove(url, keepErrorState = false) {
    if (this.epgs[url]) {
      const e = this.epgs[url]

      // If remove() was called, it means the EPG should be removed regardless of state
      this.debug && console.log(`🔴 Removing EPG ${url} as requested...`)
      
      // If there's a commit in progress, wait for it to complete before destroying
      if (e._state?.commitInProgress) {
        this.debug && console.log(`🟡 EPG ${url} has commit in progress, waiting for completion before removal...`)
        
        try {
          // Wait for all database operations to complete
          if (e.udb && typeof e.udb.waitForOperations === 'function') {
            this.debug && console.log(`🟡 Waiting for database operations to complete for ${url}...`)
            await e.udb.waitForOperations()
            this.debug && console.log(`✅ Database operations completed for ${url}`)
          }
          
          // Clear commit flag
          e._state.commitInProgress = false
        } catch (waitErr) {
          console.warn(`⚠️ Error waiting for commit completion for ${url}:`, waitErr.message)
          // Continue with removal even if wait fails
        }
      }

      if (keepErrorState && e.readyState === 'error') {
        // Save metadata for failed EPG before removing instance
        this.failedEPGs.set(url, {
          error: e.error,
          timestamp: Date.now(),
          suggested: e.suggested || false
        })
        
        this.debug && console.log(`Saving failed EPG metadata for ${url}, removing instance from memory`)

        // Remove instance from memory but keep metadata
        delete this.epgs[url]
        utils.emit('update', url)
        
        // Update state after removal
        await this.updateState()

        try {
          await e.destroy()
        } catch (err) {
          console.error('Error destroying failed EPG:', err)
        }
        return
      }

      // Normal removal - delete from memory
      delete this.epgs[url]
      utils.emit('update', url)
      
      // Update state after removal
      await this.updateState()

      try {
        await e.destroy()
      } catch (err) {
        console.error('Error destroying EPG:', err)
      }
    }
  }

  async clear() {
    this.debug && console.log('Clearing all EPGs...')
    
    // Get all EPG URLs
    const urls = Object.keys(this.epgs)
    
    // Clear failed EPGs metadata
    this.failedEPGs.clear()
    
    // Remove all EPGs
    for (const url of urls) {
      try {
        await this.remove(url)
      } catch (err) {
        console.error(`Error removing EPG ${url}:`, err)
      }
    }
    
    // Clear config
    this.config = []
    
    this.debug && console.log(`Cleared ${urls.length} EPG(s)`)
    utils.emit('update')
  }

  // ===== Status and Information Methods =====

  async ready() {
    const loadedEPGs = Object.values(this.epgs).filter(epg => this.isLoaded(epg.url))

    if (loadedEPGs.length === 0) {
      // No EPGs loaded, try to wait for at least one
      if (Object.keys(this.epgs).length === 0) {
        throw new Error('No EPGs configured')
      }

      // Wait for at least one EPG to load
      const promises = Object.values(this.epgs).map(epg => epg.ready().catch(() => null))
      await Promise.race(promises)
    }

    return true
  }

  async updateState(force = false) {
    // Usar _getStatus como base para manter consistência
    const status = await this._getStatus()
    
    // Create a more comprehensive hash that includes all relevant status fields
    const statusKey = {
      loadedEPGs: status.loadedEPGs,
      errorEPGs: status.errorEPGs,
      totalEPGs: status.totalEPGs,
      totalProgrammes: status.totalProgrammes,
      futureProgrammes: status.futureProgrammes,
      epgs: status.epgs.map(epg => ({
        url: epg.url,
        readyState: epg.readyState,
        state: epg.state,
        totalProgrammes: epg.totalProgrammes,
        futureProgrammes: epg.futureProgrammes,
        error: epg.error
      }))
    }
    
    const hash = JSON.stringify(statusKey)
    if (force || hash !== this.lastHash) {
      this.lastHash = hash
      
      // Emitir o formato completo do _getStatus
      utils.emit('state', status)
      
      // Emitir update para EPGs que acabaram de carregar
      const newlyLoaded = status.epgs.filter(epg => 
        epg.readyState === 'loaded' && 
        !this.previousLoadedEPGs?.includes(epg.url)
      )
      
      newlyLoaded.forEach(epg => {
        this.debug && console.log(`📡 EPG ${epg.url} finished loading, emitting update event`)
        utils.emit('update', epg.url)
      })

      // CRITICAL: Check if we need more EPGs after one finishes loading
      if (newlyLoaded.length > 0) {
        const currentProgrammes = this._getTotalProgrammesCount()
        const programmesNeeded = Math.max(0, this.minProgrammesToLoad - currentProgrammes)
        
        if (programmesNeeded > 0) {
          this.debug && console.log(`🔔 Need ${programmesNeeded} more programmes to reach minProgrammesToLoad=${this.minProgrammesToLoad} (current: ${currentProgrammes})`)
          this.debug && console.log(`🔔 Emitting 'needMoreEPGs' event with programmesNeeded: ${programmesNeeded}`)
          // Emit event that lists.js can listen to
          this.emit('needMoreEPGs', { needed: programmesNeeded, current: currentProgrammes })
          utils.emit('needMoreEPGs', { needed: programmesNeeded, current: currentProgrammes })
        }
      }
      
      // Emitir update também para EPGs que mudaram de erro para loaded
      const recoveredEPGs = status.epgs.filter(epg => 
        epg.readyState === 'loaded' && 
        this.previousErrorEPGs?.includes(epg.url)
      )
      
      recoveredEPGs.forEach(epg => {
        this.debug && console.log(`🔄 EPG ${epg.url} recovered from error, emitting update event`)
        utils.emit('update', epg.url)
      })
      
      // Atualizar listas de EPGs para próxima comparação
      this.previousLoadedEPGs = status.epgs
        .filter(epg => epg.readyState === 'loaded')
        .map(epg => epg.url)
      
      this.previousErrorEPGs = status.epgs
        .filter(epg => epg.readyState === 'error')
        .map(epg => epg.url)
      
      return status
    }
    
    return null
  }

  // ===== Lookup Cache Helpers =====
  _prepareChannelDescriptor(channelDescriptor) {
    if (!channelDescriptor) {
      return null
    }

    if (typeof channelDescriptor === 'string') {
      const normalizedTerms = terms(channelDescriptor)
      const canonicalName = channelDescriptor
      return {
        name: canonicalName,
        searchName: canonicalName,
        terms: normalizedTerms
      }
    }

    const prepared = { ...channelDescriptor }
    if (!prepared.name && prepared.searchName) {
      prepared.name = prepared.searchName
    } else if (!prepared.searchName && prepared.name) {
      prepared.searchName = prepared.name
    }

    if (!Array.isArray(prepared.terms)) {
      const base = prepared.searchName || prepared.name || ''
      prepared.terms = terms(base)
    }

    return prepared
  }

  async _resolveChannelProgrammes(channelDescriptor, limit = 2, options = {}) {
    const preparedDescriptor = options.prepared
      ? channelDescriptor
      : this._prepareChannelDescriptor(channelDescriptor)
    if (!preparedDescriptor || preparedDescriptor.searchName === '-') {
      return null
    }

    const now = typeof options.now === 'number' ? options.now : (Date.now() / 1000)
    const fetchLimit = Math.max(1, Number(limit) || 2)

    let bestResolution = null

    for (const url in this.epgs) {
      const epg = this.epgs[url]
      if (!epg || epg.readyState !== 'loaded') continue

      let entry
      try {
        entry = await epg.resolveLiveNowAndNext(preparedDescriptor, {
          prepared: true,
          limit: Math.max(2, fetchLimit),
          now
        })
      } catch (err) {
        console.error(`Error resolving live/next for ${url}:`, err)
        continue
      }

      if (!entry || entry.miss) {
        continue
      }

      const candidate = {
        epgUrl: url,
        channel: entry.channel,
        name: entry.name,
        icon: entry.icon,
        programmes: Array.isArray(entry.programmes) ? entry.programmes.slice(0, fetchLimit) : []
      }

      if (fetchLimit > candidate.programmes.length && epg.db && epg.db.initialized && !epg.db.destroyed && !epg.db.closed) {
        try {
          const extraProgrammes = await epg.db.find({
            channel: candidate.channel,
            end: { '>': now }
          }, { limit: fetchLimit, sort: { start: 1 } })

          if (Array.isArray(extraProgrammes) && extraProgrammes.length) {
            candidate.programmes = extraProgrammes.slice(0, fetchLimit)
          }
        } catch (err) {
          console.error(`Error fetching extended programmes for ${candidate.channel} in ${url}:`, err)
        }
      }

      if (!Array.isArray(candidate.programmes) || candidate.programmes.length === 0) {
        continue
      }

      if (
        !bestResolution ||
        candidate.programmes.length > bestResolution.programmes.length ||
        (
          candidate.programmes.length === bestResolution.programmes.length &&
          (candidate.programmes[0]?.start ?? Number.MAX_SAFE_INTEGER) <
            (bestResolution.programmes[0]?.start ?? Number.MAX_SAFE_INTEGER)
        )
      ) {
        bestResolution = candidate

        if (bestResolution.programmes.length >= fetchLimit) {
          break
        }
      }
    }

    return bestResolution
  }

  // ===== Search and Query Methods =====

  async search(terms, nowLive = false) {
    // Ensure config is valid
    if (!this.config || !Array.isArray(this.config)) {
      this.config = []
    }

    const results = []
    const searchPromises = []

    for (const url in this.epgs) {
      const epg = this.epgs[url]
      if (epg.readyState !== 'loaded') continue

      searchPromises.push(this._searchInEPG(epg, terms, nowLive))
    }

    const epgResults = await Promise.allSettled(searchPromises)

    for (const result of epgResults) {
      if (result.status === 'fulfilled' && Array.isArray(result.value)) {
        results.push(...result.value)
      }
    }

    return results
  }

  async _searchInEPG(epg, terms, nowLive) {
    try {
      if (!epg.db || !epg.db.initialized) {
        this.debug && console.log(`🔍 _searchInEPG: EPG ${epg.url} not ready (db: ${!!epg.db}, initialized: ${epg.db?.initialized})`)
        return []
      }

      this.debug && console.log(`🔍 _searchInEPG: Searching for terms [${terms.slice(0, 3).join(', ')}${terms.length > 3 ? '...' : ''}] in EPG ${epg.url}`)

      const query = nowLive ?
        { terms: { $in: terms }, start: { '<=': Math.floor(Date.now() / 1000) }, end: { '>': Math.floor(Date.now() / 1000) } } :
        { terms: { $in: terms } }

      this.debug && console.log(`🔍 _searchInEPG: Query: ${JSON.stringify(query)}`)

      const programmes = await epg.db.find(query, { limit: 50 })
      this.debug && console.log(`🔍 _searchInEPG: Found ${programmes.length} programmes for terms [${terms.slice(0, 3).join(', ')}]`)
      
      return programmes.map(programme => ({
        ...programme,
        epgUrl: epg.url
      }))
    } catch (err) {
      console.error('🔍 _searchInEPG: Error searching in EPG:', epg.url, err)
      return []
    }
  }

  async findChannel(data, returnAll = false) {
    try {
      let score, candidates = [], maxScore = 0, tms = data.terms || data

      // Validate input
      if (!tms || (Array.isArray(tms) && tms.length === 0)) {
        return false
      }

      for (const url in this.epgs) {
        if (this.epgs[url].readyState !== 'loaded') continue

        try {
          const termMap = await this.epgs[url].getAllTerms()

          // Validate termMap
          if (!termMap || typeof termMap.size !== 'number' || termMap.size < 0) {
            console.warn(`Invalid termMap for ${url}, size: ${termMap?.size}`)
            continue
          }


          for (const [name, nameTerms] of termMap.entries()) {
            if (!Array.isArray(nameTerms)) continue
            score = match(tms, nameTerms, false)
            if (score && score >= maxScore) {
              maxScore = score
              candidates.push({ name, score })
            }
          }
        } catch (err) {
          console.error('Error in findChannel for', url, ':', err.message)
          // Continue with other EPGs instead of failing completely
          continue
        }
      }

      candidates = candidates.filter(c => c.score === maxScore)
      
      if (returnAll) {
        return candidates // Return all candidates with max score
      }
      return candidates.length ? candidates[0].name : false

    } catch (err) {
      console.error('Error in findChannel:', err)
      return false
    }
  }

  async getAllTerms() {
    const results = {}
    for (const url in this.epgs) {
      if (this.epgs[url].readyState !== 'loaded') continue
      results[url] = await this.epgs[url].getAllTerms()
    }
    return results
  }

  async searchChannel(tms, limit = 2) {
    let results = {}, data = []

    for (const url in this.epgs) {
      if (this.epgs[url].readyState !== 'loaded') continue

      const termMap = await this.epgs[url].getAllTerms()
      for (const [name, nameTerms] of termMap.entries()) {
        if (!Array.isArray(nameTerms)) continue
        const score = match(tms, nameTerms, true)
        if (score) {
          data.push({ name, url, score })
        } else {
          // Greedy match: check if at least one term matches (for partial matching)
          const nTerms = Array.isArray(tms) ? tms : (tms.terms || [])
          const sTerms = nameTerms
          const weakTerms = new Set(['sd', '4k', 'hd', 'h264', 'h.264', 'fhd', 'uhd', 'null', 'undefined'])
          let greedyScore = 0
          
          for (const term of nTerms) {
            if (!term.startsWith('-') && !weakTerms.has(term)) {
              if (sTerms.some(sTerm => sTerm.startsWith(term) || sTerm.includes(term))) {
                greedyScore++
              }
            }
          }
          
          if (greedyScore > 0) {
            data.push({ name, url, score: greedyScore * 0.1 }) // Lower score for greedy matches
          }
        }
      }
    }

    data = data.sortByProp('score', true).slice(0, 24)

    for (const r of data) {
      if (this.epgs[r.url] && this.epgs[r.url].db && this.epgs[r.url].db.initialized) {
        results[r.name] = await this.epgs[r.url].db.find({ channel: r.name, end: { '>': Math.floor(Date.now() / 1000) } }, { limit })
      }
    }

    return results
  }

  async searchChannelIcon(tms) {
    let results = []

    for (const url in this.epgs) {
      if (this.epgs[url].readyState !== 'loaded') continue

      const channels = await this.epgs[url].mdb.find({ _type: 'channel' })
      const termMap = await this.epgs[url].getAllTerms()

      for (const ch of channels) {
        const chTerms = termMap.get(ch.id) || []
        const score = match(tms, chTerms, true)
        if (score && ch.icon) results.push(ch.icon)
      }
    }

    return results.unique()
  }

  // ===== Live Channels Methods =====

  async liveNowChannelsList() {
    let updateAfter = 600
    const categories = {}
    const now = Math.floor(Date.now() / 1000)

    const processProgramme = (programme, cleanChannelName) => {
      const category = programme.categories && programme.categories.length > 0 ? programme.categories[0] : 'Other'

      if (!categories[category]) {
        categories[category] = {}
      }

      if (!categories[category][cleanChannelName]) {
        categories[category][cleanChannelName] = {
          name: cleanChannelName,
          programme: programme,
          icon: programme.icon || ''
        }
      }
    }

    for (const url in this.epgs) {
      if (this.epgs[url].readyState !== 'loaded') continue

      try {
        const db = this.epgs[url].db
        if (!db || !db.initialized) continue

        // Query for current programmes
        const programmes = await db.find({
          start: { '<=': now },
          end: { '>': now }
        }, { limit: 1000 })


        for (const programme of programmes) {
          // Try to get real channel name from ID, fallback to prepared name
          let channelName
          try {
            const epgInstance = this.epgs[url]
            if (epgInstance && typeof epgInstance.getChannelById === 'function') {
              const channelInfo = await epgInstance.getChannelById(programme.channel)
              channelName = channelInfo.name || programme.channel
            } else {
              console.warn(`EPG instance not available or getChannelById not found for ${url}`)
              channelName = programme.channel
            }
          } catch (err) {
            // Only log non-expected errors to reduce log noise
            // "Metadata DB not initialized" is expected in some scenarios and handled gracefully
            if (err.message && !err.message.includes('Metadata DB not initialized')) {
              console.warn(`Could not get channel name for ${programme.channel}:`, err)
            }
            channelName = programme.channel
          }

          // Clean up the channel name
          const cleanName = this.prepareChannelName(channelName)

          // Filter out channels that are only numbers and couldn't be translated
          const isOnlyNumbers = /^\d+$/.test(cleanName)
          const isOriginalId = cleanName === programme.channel

          if (isOnlyNumbers && isOriginalId) {
            continue
          }

          processProgramme(programme, cleanName)
        }
      } catch (err) {
        console.error('Error in liveNowChannelsList for', url, ':', err)
        continue
      }
    }

    if (Object.keys(categories).length === 0 && Object.keys(this.epgs).length > 0) {
      console.warn('No live programmes found, but EPGs are available')
    }

    return { categories, updateAfter }
  }

  async mapToValidChannelName(rawName) {
    if (!rawName) return null
    const idx = this.channelTermsIndex
    if (!idx || typeof idx !== 'object') return null

    // exact key match
    if (rawName in idx) return rawName

    // case-insensitive key match
    const lower = String(rawName).toLowerCase()
    const exactKey = Object.keys(idx).find(k => k.toLowerCase() === lower)
    if (exactKey) return exactKey

    // semantic match using terms + match
    const t = terms(rawName)
    let bestKey = null, bestScore = 0
    for (const k of Object.keys(idx)) {
      const s1 = match(idx[k], t)
      const s2 = s1 ? s1 : match(idx[k], t, true)
      const score = s2 || 0
      if (score > bestScore) {
        bestScore = score
        bestKey = k
        if (score >= 2) break
      }
    }
    if (bestKey && bestScore > 0) return bestKey

    // numeric EPG id -> translate via EPG getChannelById and retry
    if (/^\d+$/.test(String(rawName))) {
      for (const url in this.epgs) {
        const epg = this.epgs[url]
        try {
          if (epg && typeof epg.getChannelById === 'function') {
            const info = await epg.getChannelById(rawName)
            if (info?.name) {
              if (info.name in idx) return info.name
              const lowerInfo = String(info.name).toLowerCase()
              const exKey = Object.keys(idx).find(k => k.toLowerCase() === lowerInfo)
              if (exKey) return exKey
              const it = terms(info.name)
              let bKey = null, bScore = 0
              for (const k of Object.keys(idx)) {
                const r1 = match(idx[k], it)
                const r2 = r1 ? r1 : match(idx[k], it, true)
                const score = r2 || 0
                if (score > bScore) { bScore = score; bKey = k; if (score >= 2) break }
              }
              if (bKey && bScore > 0) return bKey
            }
          }
        } catch {}
      }
    }
    return null
  }

  // ===== Utility Methods =====

  get length() {
    return Object.values(this.epgs).reduce((total, epg) => total + (epg.length || 0), 0)
  }

  async status() {
    this.debug && console.log('EPGManager.status() called')

    // Add timeout to prevent hanging
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error('EPG status timeout after 30 seconds')), 30000);
    });

    const statusPromise = this._getStatus();

    try {
      const result = await Promise.race([statusPromise, timeoutPromise]);
      this.debug && console.log('EPGManager.status() completed successfully')
      return result
    } catch (error) {
      console.error('EPG status error:', error.message);
      return {
        totalEPGs: Object.keys(this.epgs).length,
        loadedEPGs: 0,
        errorEPGs: 0,
        totalProgrammes: 0,
        pastProgrammes: 0,
        currentProgrammes: 0,
        futureProgrammes: 0,
        epgs: [],
        error: error.message,
        summary: {
          activeEPGs: 0,
          errorEPGs: 0,
          inactiveEPGs: Object.keys(this.epgs).length,
          programmesDistribution: {
            past: 0,
            current: 0,
            future: 0,
            total: 0
          }
        }
      };
    }
  }

  calculateOverallProgress() {
    const epgs = Object.values(this.epgs)
    if (epgs.length === 0) return 0

    const totalProgress = epgs.reduce((sum, epg) => {
      const progress = epg.state?.progress || 0
      return sum + progress
    }, 0)

    return Math.round(totalProgress / epgs.length)
  }

  calculateOverallState(epgStates) {
    if (epgStates.length === 0) {
      return { progress: 0, state: 'uninitialized', error: null }
    }

    // Check if any EPG has errors
    const errorEPGs = epgStates.filter(epg => epg.state === 'error')
    const loadingEPGs = epgStates.filter(epg => epg.state === 'loading' || epg.state === 'downloading' || epg.state === 'parsing' || epg.state === 'processing')
    const loadedEPGs = epgStates.filter(epg => epg.state === 'loaded' || epg.state === 'ready')

    // Calculate overall progress
    const totalProgress = epgStates.reduce((sum, epg) => sum + (epg.progress || 0), 0)
    const avgProgress = Math.round(totalProgress / epgStates.length)

    // Warn about accumulated EPGs in updateState (periodic check)
    const totalEPGs = Object.keys(this.epgs).length
    const MAX_EPGS_WARN = 20
    if (totalEPGs >= MAX_EPGS_WARN) {
      const errorCount = errorEPGs.length
      const loadingCount = loadingEPGs.length
      const loadedCount = loadedEPGs.length
      console.warn(`⚠️ [OOM Risk] EPGManager has too many EPGs in memory: ${totalEPGs} total (loaded: ${loadedCount}, error: ${errorCount}, loading: ${loadingCount})`)
    }
    
    // Determine overall state
    let overallState = 'uninitialized'
    let error = null

    if (loadedEPGs.length > 0) {
      overallState = 'loaded'
    } else if (loadingEPGs.length > 0) {
      overallState = 'loading'
    } else if (errorEPGs.length > 0) {
      overallState = 'error'
      error = `Failed EPGs: ${errorEPGs.length}/${epgStates.length}`
    }

    return { progress: avgProgress, state: overallState, error }
  }

  async _getStatus() {
    const status = {
      totalEPGs: Object.keys(this.epgs).length + this.failedEPGs.size,
      loadedEPGs: 0,
      errorEPGs: 0,
      totalProgrammes: 0,
      pastProgrammes: 0,
      currentProgrammes: 0,
      futureProgrammes: 0,
      overallProgress: this.calculateOverallProgress(),
      epgs: []
    }

    for (const url in this.epgs) {
      const epg = this.epgs[url]
      const epgStatus = {
        url: url,
        readyState: epg.readyState,
        suggested: epg.suggested || false,
        progress: epg.state?.progress || 0,
        state: epg.state?.state || epg.readyState,
        totalProgrammes: 0,
        pastProgrammes: 0,
        currentProgrammes: 0,
        futureProgrammes: 0,
        error: null,
        lastUpdate: null,
        databaseSize: 0
      }

      // Check if EPG is ready or if it's in error state but has data
      const isReady = this.isLoaded(epg.url)
      // Use _programmeCounts if available, otherwise use db.length
      const hasData = epg._programmeCounts && epg._programmeCounts.total > 0 ? 
        epg._programmeCounts.total > 0 : 
        (epg.db && epg.db.initialized && epg.db.length > 0)
      const hasDataInError = epg.readyState === 'error' && hasData        
      
      if (isReady || hasDataInError || hasData) {
          // Use pre-calculated programme counts from EPG.start() if available
          if (epg._programmeCounts && 'future' in epg._programmeCounts) {
            epgStatus.totalProgrammes = epg._programmeCounts.total
            epgStatus.futureProgrammes = epg._programmeCounts.future
            epgStatus.pastProgrammes = epg._programmeCounts.past
            epgStatus.currentProgrammes = epg._programmeCounts.current
            epgStatus.databaseSize = epg._programmeCounts.total
          } else {
            // Fallback to database stats if _programmeCounts not available
            if (epg.db) {
              if (!epg.db.initialized) {
                await epg.db.init()
              }
              // Database is already initialized, use length property directly
              epgStatus.databaseSize = epg.db.length || 0
              epgStatus.totalProgrammes = epgStatus.databaseSize
            }
          }
          
          // REMOVED: Duplicate logic that was overwriting pre-calculated counts
          // The counts are already set above from _programmeCounts or fallback

          // Decide if we should count this EPG as loaded on every status call
          // For suggested EPGs, only count as loaded if it has future programmes
          // For configured EPGs, be more lenient - accept if it has any programmes
          const shouldCountAsLoaded = !epg.suggested || (epgStatus.futureProgrammes > 0)

          if (hasDataInError || (hasData && epg.readyState === 'error')) {
            if (shouldCountAsLoaded) {
              // Only reflect in status; do not mutate epg object here
              epgStatus.readyState = 'loaded'
              epgStatus.state = 'loaded'
              epgStatus.error = null
              status.loadedEPGs++
            }
          } else {
            // EPG has data and is valid - evaluate sufficiency
            if (epgStatus.totalProgrammes === 0) {
              // EPG has no programmes - mark as error
              epgStatus.readyState = 'error'
              epgStatus.state = 'error'
              epgStatus.error = 'EPG_NO_PROGRAMMES'
              status.errorEPGs++
            } else {
              // Validate if sufficient future programmes
              let futureCount = 0
              let hasSufficient = false

              if (epg._programmeCounts && 'future' in epg._programmeCounts) {
                // Use pre-calculated counts for consistency
                futureCount = epg._programmeCounts.future
                hasSufficient = futureCount >= 36
              } else {
                // Fallback to validation method if _programmeCounts not available
                const validation = await epg.validateSufficientFutureProgrammes()
                futureCount = validation.futureCount
                hasSufficient = validation.hasSufficient
              }

              if (hasSufficient) {
                epgStatus.readyState = 'loaded'
                epgStatus.state = 'loaded'
                epg.error = null
                status.loadedEPGs++
              } else if (epg.suggested && futureCount === 0) {
                epgStatus.readyState = 'loaded'
                epgStatus.state = 'loaded'
                epgStatus.error = null
                status.loadedEPGs++
              } else {
                // For configured EPGs or EPGs with some future programmes, optional cleanup

                const now = Date.now() / 1000
                try {
                  // Verificar se db.count existe antes de chamar
                  let expiredCount = 0
                  if (epg.db && epg.db.count && typeof epg.db.count === 'function' && !epg.db.destroyed && !epg.db.closed) {
                    expiredCount = await epg.db.count({ end: { '<': now } }).catch(() => 0)
                  }
                  if (expiredCount > 128) {
                    const deletedCount = await epg.db.delete({ end: { '<': now } }).catch(() => 0)
                    this.debug && console.log(`🧹 Cleaned ${deletedCount} expired programmes from ${url} (${expiredCount} found)`) 
                    if (epg && epg._calculateProgrammeCounts) {
                      try {
                        await epg._calculateProgrammeCounts()
                        // Update state after counts change
                        await this.updateState()
                      } catch (err) {
                        console.warn(`Failed to recalculate _programmeCounts after cleanup for ${url}:`, err)
                      }
                    }
                  }
                } catch (cleanErr) {
                  console.warn(`Error cleaning expired data from ${url}:`, cleanErr.message)
                }

                epgStatus.readyState = 'error'
                epgStatus.state = 'error'
                epgStatus.error = 'EPG_INSUFFICIENT_FUTURE_PROGRAMMES'
                status.errorEPGs++
              }
            }
          }
      } else if (epg.readyState === 'error') {
        status.errorEPGs++
        epgStatus.error = epg.error || 'Unknown error'
        // Ensure state is consistent with readyState
        epgStatus.state = 'error'
      }

    // Add to status
    status.epgs.push(epgStatus)
    status.totalProgrammes += epgStatus.totalProgrammes
    status.pastProgrammes += epgStatus.pastProgrammes
    status.currentProgrammes += epgStatus.currentProgrammes
    status.futureProgrammes += epgStatus.futureProgrammes
    }

    // Add failed EPGs metadata to status (only if not already in epgs list)
    for (const [url, metadata] of this.failedEPGs) {
      // Check if this URL is already in the epgs list
      const alreadyInList = status.epgs.some(epg => epg.url === url)
      
      if (!alreadyInList) {
        const epgStatus = {
          url: url,
          readyState: 'error',
          suggested: metadata.suggested || false,
          progress: 0,
          state: 'error',
          totalProgrammes: 0,
          pastProgrammes: 0,
          currentProgrammes: 0,
          futureProgrammes: 0,
          error: metadata.error,
          lastUpdate: new Date(metadata.timestamp).toISOString(),
          databaseSize: 0
        }
        
        status.epgs.push(epgStatus)
        status.errorEPGs++
      }
    }

    // Add EPGs currently being loaded (from loader processes)
    if (this.loader && this.loader.processes) {
      for (const process of this.loader.processes) {
        if (process && process.url) {
          // Check if this URL is already in the epgs list
          const alreadyInList = status.epgs.some(epg => epg.url === process.url)
          
          if (!alreadyInList) {
            const epgStatus = {
              url: process.url,
              readyState: 'loading',
              suggested: process.suggested || false,
              progress: process.progress || 0,
              state: process.state || 'loading',
              totalProgrammes: 0,
              pastProgrammes: 0,
              currentProgrammes: 0,
              futureProgrammes: 0,
              error: null,
              lastUpdate: process.startTime ? new Date(process.startTime).toISOString() : null,
              databaseSize: 0
            }
            
            status.epgs.push(epgStatus)
          }
        }
      }
    }

    // Update totalEPGs to reflect actual count
    status.totalEPGs = status.epgs.length

    // Add summary
    status.summary = {
      activeEPGs: status.loadedEPGs,
      errorEPGs: status.errorEPGs,
      inactiveEPGs: status.totalEPGs - status.loadedEPGs - status.errorEPGs,
      programmesDistribution: {
        past: status.pastProgrammes,
        current: status.currentProgrammes,
        future: status.futureProgrammes,
        total: status.totalProgrammes
      }
    }

    return status
  }

  async liveNow(ch) {
    const resolution = await this.getLiveNowAndNext(ch, { limit: 2 })
    if (!resolution || !Array.isArray(resolution.programmes) || resolution.programmes.length === 0) {
      return false
    }

    const now = Date.now() / 1000
    const current = resolution.programmes.find(p => p && p.start <= now && p.end > now) || resolution.programmes[0]
    if (current && current.end > now) {
      return current
    }
    return false
  }

  async get(channel, limit = 2) {
    const desiredLimit = Math.max(1, Number(limit) || 2)
    const resolution = await this._resolveChannelProgrammes(channel, desiredLimit)
    if (!resolution || !Array.isArray(resolution.programmes)) {
      return []
    }
    return resolution.programmes.slice(0, desiredLimit)
  }

  async getMulti(channelsList, limit = 2) {
    const list = Array.isArray(channelsList) ? channelsList : [channelsList]
    const desiredLimit = Math.max(1, Number(limit) || 2)
    const results = {}

    await Promise.allSettled(list.map(async (item, index) => {
      const prepared = this._prepareChannelDescriptor(item)
      const key =
        prepared?.name ||
        prepared?.searchName ||
        (typeof item === 'string' ? item : `channel-${index}`)

      if (!prepared || prepared.searchName === '-') {
        results[key] = []
        return
      }

      try {
        const resolution = await this._resolveChannelProgrammes(prepared, desiredLimit, { prepared: true })
        results[key] = resolution?.programmes
          ? resolution.programmes.slice(0, desiredLimit)
          : []
      } catch (err) {
        console.error(`Error in getMulti for channel ${key}:`, err)
        results[key] = []
      }
    }))

    return results
  }

  async getLiveNowAndNext(channelOrList, options = {}) {
    const desiredLimit = Math.max(1, Number(options.limit) || 2)
    const nowOption = options.now

    if (Array.isArray(channelOrList)) {
      const results = {}
      await Promise.allSettled(channelOrList.map(async (item, index) => {
        const prepared = this._prepareChannelDescriptor(item)
        const key =
          prepared?.name ||
          prepared?.searchName ||
          (typeof item === 'string' ? item : `channel-${index}`)

        if (!prepared || prepared.searchName === '-') {
          results[key] = null
          return
        }

        try {
          const resolution = await this._resolveChannelProgrammes(prepared, desiredLimit, {
            prepared: true,
            now: nowOption
          })
          results[key] = resolution || null
        } catch (err) {
          console.error(`Error resolving live/next for ${key}:`, err)
          results[key] = null
        }
      }))
      return results
    }

    return this._resolveChannelProgrammes(channelOrList, desiredLimit, { now: nowOption })
  }

  async validateChannels(data) {
    const processed = {}
    for (const channel in data) {
      let err
      const cid = await this.findChannel(data[channel].terms || terms(channel.toString()))
      const live = await this.liveNow(cid).catch(e => console.error(err = e))
      if (!err && live) {
        for (const candidate of data[channel].candidates) {
          if (live.title == candidate.title) { processed[channel] = candidate.channel; break }
        }
      }
    }
    return processed
  }

  prepareRegex(arr) {
    if (!this._prepareRegex) this._prepareRegex = new RegExp('[.*+?^${}()[\\]\\\\]', 'g')
    let ret = arr.map(c => c.toLowerCase().trim()).filter(c => c).join('|').replace(this._prepareRegex, '\\$&').replace(new RegExp('\\|+', 'g'), '|')
    if (ret.startsWith('|')) ret = ret.slice(1)
    if (ret.endsWith('|')) ret = ret.slice(0, -1)
    return new RegExp(ret, 'i')
  }


  /**
   * Helper method to check if a channel matches any in the channel list
   * @param {string} channelName - Name of the channel to check
   * @param {Array} chList - Array of channel term arrays
   * @returns {boolean} - True if channel matches any in the list
   */
  hasChannelMatch(channelName, chList) {
    if (chList.length === 0) return true
    return chList.some(ctms => match(ctms, terms(channelName), true))
  }

  liveNowChannelsListFilterCategories(cs) {
    cs = cs.filter(c => c.split(' ').length <= 3)
    if (cs.length > 1) {
      let ncs = cs.filter(c => c.match(new RegExp('[A-Za-z]')))
      if (ncs.length) cs = ncs
      if (cs.length > 1) {
        ncs = cs.filter(c => c.split(' ').length <= 2)
        if (ncs.length) cs = ncs
      }
    }
    return cs
  }

  async liveNowChannelsList() {
    let updateAfter = 600
    const categories = {}, uncategorized = new Set(), now = Date.now() / 1000
    let needsReprocessing = false

    // Check if we need to reprocess existing programmes with categories
    for (const url in this.epgs) {
      const epg = this.epgs[url]
      if (this.isLoaded(epg.url)) {
        try {
          // Check if any programmes have categories
          const sampleProgrammes = await epg.db.find({}, { limit: 10 })
          const hasCategories = sampleProgrammes.some(p => p.categories && Array.isArray(p.categories) && p.categories.length > 0)
          if (!hasCategories) {
            needsReprocessing = true
            break
          }
        } catch (err) {
          console.warn(`Error checking categories for ${url}:`, err.message)
        }
      }
    }

    for (const url in this.epgs) {
      const epg = this.epgs[url]
      if (epg.readyState !== 'loaded') continue
      const db = epg.db
      if (!db) continue
      try {
        // Ensure database is initialized
        if (!db.initialized) {
          await db.init().catch(err => {
            console.error('Failed to init db for liveNowChannelsList:', err)
            return
          })
        }

        // Check database state after initialization

        // Get all programmes that are currently live or will be live soon
        const query = { end: { '>': now }, start: { '<=': now + 3600 } } // Next hour
        const programmes = await db.find(query, { sort: { start: 1 } })


        for (const programme of programmes) {
          // Try to get real channel name from ID, fallback to prepared name
          let channelName
          try {
            const epgInstance = this.epgs[url]
            if (epgInstance && typeof epgInstance.getChannelById === 'function') {
              const channelInfo = await epgInstance.getChannelById(programme.channel)
              channelName = channelInfo.name || programme.channel
            } else {
              console.warn(`EPG instance not available or getChannelById not found for ${url}`)
              channelName = programme.channel
            }
          } catch (err) {
            // Only log non-expected errors to reduce log noise
            // "Metadata DB not initialized" is expected in some scenarios and handled gracefully
            if (err.message && !err.message.includes('Metadata DB not initialized')) {
              console.warn(`Could not get channel name for ${programme.channel}:`, err.message)
            }
            channelName = programme.channel
          }

          // Clean up the channel name
          const cleanName = this.prepareChannelName(channelName)

          // Filter out channels that are only numbers and couldn't be translated
          const isOnlyNumbers = /^\d+$/.test(cleanName)
          const isOriginalId = cleanName === programme.channel

          if (isOnlyNumbers && isOriginalId) {
            continue
          }

          // Only log if we got a real name, not just an ID
          if (channelName !== programme.channel) {
          }

          if (programme.categories && Array.isArray(programme.categories) && programme.categories.length > 0) {
            this.liveNowChannelsListFilterCategories(programme.categories).forEach(category => {
              category = ucWords(category).replaceAll('/', ' ')
              if (!categories[category] || !(categories[category] instanceof Set)) {
                categories[category] = new Set()
              }
              categories[category].add(cleanName)
            })
          } else {
            uncategorized.add(cleanName)
          }
          updateAfter = Math.min(updateAfter, Math.max(programme.end - now, 10))
        }
      } catch (err) {
        console.error('Error in liveNowChannelsList for', url, ':', err)
        continue
      }
    }
    if (Object.keys(categories).length === 0 && uncategorized.size > 0) {
      categories['ALL'] = [...uncategorized].sort()
    }
    // Convert Sets to Arrays for proper serialization
    for (const c in categories) {
      if (categories[c] instanceof Set) {
        categories[c] = [...categories[c]].sort()
      }
    }
    return { categories, updateAfter }
  }

  async destroy() {
    this.debug && console.log('Destroying EPGManager...')

    // Stop auto-cleanup interval
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval)
      this.cleanupInterval = null
    }

    // CRITICAL: Set destroying flag FIRST to prevent new operations
    this._destroying = true
    this.debug && console.log('_destroying flag set to true - no new operations will be accepted')
    
    // Remove error listeners from all EPG instances BEFORE waiting for queue
    // This prevents new fallback triggers during destruction
    this.debug && console.log('Removing error listeners from all EPG instances...')
    for (const url in this.epgs) {
      const epg = this.epgs[url]
      if (epg && typeof epg.removeAllListeners === 'function') {
        epg.removeAllListeners('error')
        this.debug && console.log(`Removed error listeners from EPG: ${url}`)
      }
    }

    // Wait for any pending queue operations to complete
    if (this.epgQueue) {
      try {
        const queueSize = this.epgQueue.size
        const queuePending = this.epgQueue.pending
        this.debug && console.log(`Waiting for queue to idle (size: ${queueSize}, pending: ${queuePending})...`)
        
        // Add a timeout to prevent hanging indefinitely
        await Promise.race([
          this.epgQueue.onIdle(),
          new Promise((_, reject) => setTimeout(() => reject(new Error('Queue idle timeout')), 30000))
        ])
        
        this.debug && console.log('All queue operations completed')
        
        // Clear the queue
        this.epgQueue.clear()
        this.debug && console.log('Queue cleared')
        
        // Set to null to prevent new operations
        this.epgQueue = null
        this.debug && console.log('epgQueue set to null')
      } catch (queueErr) {
        console.warn('Error while waiting for queue to idle:', queueErr.message)
        // Force clear anyway
        if (this.epgQueue) {
          try {
            this.epgQueue.clear()
            this.debug && console.log('Queue force cleared')
          } catch (clearErr) {
            console.warn('Error clearing queue:', clearErr.message)
          }
          this.epgQueue = null
        }
      }
    }

    // Destroy all EPG instances
    this.debug && console.log('Destroying all EPG instances...')
    const destroyPromises = Object.values(this.epgs).map(epg => epg.destroy().catch(err => {
      console.error('Error destroying EPG:', err)
    }))

    await Promise.allSettled(destroyPromises)
    this.debug && console.log('All EPG instances destroyed')

    // Clear references
    this.epgs = {}
    this.config = []
    // Trias removed - using AI client instead
    this.curator = null

    this.debug && console.log('EPGManager destroyed successfully')
  }


  // Multi-worker compatibility method
  async terminate() {
    this.debug && console.log('Terminating EPGManager...')
    await this.destroy()
  }

  async setScoreMode(mode) {
    this.scoreMode = mode
  }

  async getRecommendations(categories, until, limit = 24) {
    // Debug logs melhorados
    this.debug && console.log(`🎯 getRecommendations called with categories type: ${typeof categories}`)
    this.debug && console.log(`🎯 categories is null/undefined: ${categories == null}`)
    this.debug && console.log(`🎯 categories keys: ${Object.keys(categories || {}).length}`)
    this.debug && console.log(`🎯 categories sample: ${Object.keys(categories || {}).slice(0, 5).join(',')}`)
    this.debug && console.log(`🎯 getRecommendations processing ${Object.keys(categories || {}).length} categories, limit: ${limit}`)

    if (!categories || typeof categories !== 'object') {
      this.debug && console.log(`🎯 Invalid categories parameter:`, categories)
      return []
    }

    const now = Date.now() / 1000
    const untilTime = until || (now + 6 * 3600) // Default to 6 hours in the future if until is null
    let results = []
    const processedCategories = new Set()

    this.debug && console.log(`🎯 Time filtering: now=${now}, until=${untilTime}, untilParam=${until}`)

    // Use optimized score() method for better performance
    try {
      // Collect all categories with their scores
      const categoryScores = {}
      for (const category of Object.keys(categories)) {
        if (processedCategories.has(category)) continue
        processedCategories.add(category)
        categoryScores[category] = categories[category]
      }

      this.debug && console.log(`🎯 Using score() method for ${Object.keys(categoryScores).length} categories`)

      // Debug: verificar dados nos EPGs antes de usar score()
      for (const url in this.epgs) {
        const epg = this.epgs[url]
        if (!epg.db || !epg.db.initialized) {
          this.debug && console.log(`🎯 EPG ${epg.url}: Database not ready`)
          continue
        }

        // Debug: verificar estrutura dos dados salvos
        try {
          const maxResultSetSize = limit * 10 // wider range for filtering
          // Usar score() com categoryScores reais
          const scoredProgrammes = await epg.db.score('terms', categoryScores, {
            limit: maxResultSetSize, // Get more results for better selection
            sort: 'desc',
            mode: this.scoreMode,
            includeScore: true // Include relevance scores in results
          })

          this.debug && console.log(`🎯 EPG ${epg.url}: Found ${scoredProgrammes.length} scored programmes`)

          for (const programme of scoredProgrammes) {
            if (programme.start <= untilTime && programme.end > now) {
              results.push({
                ...programme,
                epgUrl: epg.url
              })
            }
          }
        } catch (err) {
          console.error(`🎯 Error processing EPG ${epg.url}:`, err)
        }
      }
    } catch (err) {
      console.error(`🎯 Error in score() method:`, err)
    }

    this.debug && console.log(`🎯 Processed ${processedCategories.size} categories`)

    // Apply channel filtering using channelTermsIndex if available
    if (this.channelTermsIndex && Object.keys(this.channelTermsIndex).length > 0) {
      const filteredResults = []
      for (const programme of results) {
        const mapped = await this.mapToValidChannelName(programme.channel)
        if (mapped) {
          programme.channel = mapped
          filteredResults.push(programme)
        } else {
          //this.debug && console.log(`🎯 Filtering out irrelevant channel: ${programme.channel} for programme: ${programme.title}`)
        }
      }
      this.debug && console.log(`🎯 After channel relevance filter: ${filteredResults.length} programmes (removed ${results.length - filteredResults.length} irrelevant channels)`)
      results = filteredResults
    } else {
      // Fallback: filter out numeric-only channels when no channelTermsIndex
      const filteredResults = results.filter(programme => {
        const channelName = programme.channel
        const isNumericOnly = /^\d+$/.test(channelName)
        
        if (isNumericOnly) {
          // this.debug && console.log(`🎯 Filtering out numeric channel: ${channelName} for programme: ${programme.title}`)
          return false
        }
        return true
      })
      
      this.debug && console.log(`🎯 After numeric filter: ${filteredResults.length} programmes (removed ${results.length - filteredResults.length} numeric channels)`)
      results = filteredResults
    }
    
    // Remove duplicates by title only, preferring non-numeric channel names
    const programmeMap = new Map()
    
    for (const programme of results) {
      const title = programme.title
      const channelName = programme.channel
      
      // Check if we already have this title
      if (programmeMap.has(title)) {
        const existing = programmeMap.get(title)
        const existingChannel = existing.channel
        
        // Prefer non-numeric channel names over numeric ones
        const isCurrentNumeric = /^\d+$/.test(channelName)
        const isExistingNumeric = /^\d+$/.test(existingChannel)
        
        if (isCurrentNumeric && !isExistingNumeric) {
          // Current is numeric, existing is not - keep existing
          continue
        } else if (!isCurrentNumeric && isExistingNumeric) {
          // Current is not numeric, existing is - replace with current
          programmeMap.set(title, programme)
        } else {
          // Both are same type (numeric or non-numeric) - keep higher score
          const currentScore = typeof programme.score === 'number' ? programme.score : 0
          const existingScore = typeof existing.score === 'number' ? existing.score : 0
          if (currentScore > existingScore) {
            programmeMap.set(title, programme)
          }
        }
      } else {
        // First occurrence of this title
        programmeMap.set(title, programme)
      }
    }
    
    const uniqueResults = Array.from(programmeMap.values())
    
    // Sort by score (highest first)
    uniqueResults.sort((a, b) => {
      const scoreA = typeof a.score === 'number' ? a.score : 0
      const scoreB = typeof b.score === 'number' ? b.score : 0
      return scoreB - scoreA
    })

    // Map to valid channel names in channelsIndex and filter invalid
    const mapped = []
    for (const programme of uniqueResults) {
      const mappedName = await this.mapToValidChannelName(programme.channel)
      if (mappedName) {
        programme.channel = mappedName
        mapped.push(programme)
      }
    }
    this.debug && console.log(`🎯 After channel mapping: ${mapped.length} valid programmes (removed ${uniqueResults.length - mapped.length})`)
    return mapped.slice(0, limit)
  }

  async liveNowChannelsList() {
    let updateAfter = 600
    const categories = {}, uncategorized = new Set(), now = Date.now() / 1000
    let needsReprocessing = false

    // Check if we need to reprocess existing programmes with categories
    for (const url in this.epgs) {
      const epg = this.epgs[url]
      if (this.isLoaded(epg.url)) {
        try {
          // Check if any programmes have categories
          const sampleProgrammes = await epg.db.find({}, { limit: 10 })
          const hasCategories = sampleProgrammes.some(p => p.categories && Array.isArray(p.categories) && p.categories.length > 0)
          if (!hasCategories) {
            needsReprocessing = true
            break
          }
        } catch (err) {
          console.warn(`Error checking categories for ${url}:`, err.message)
        }
      }
    }

    for (const url in this.epgs) {
      const epg = this.epgs[url]
      if (epg.readyState !== 'loaded') continue
      const db = epg.db
      if (!db) continue
      try {
        // Ensure database is initialized
        if (!db.initialized) {
          await db.init().catch(err => {
            console.error('Failed to init db for liveNowChannelsList:', err)
            return
          })
        }

        // Get all programmes that are currently live or will be live soon
        const query = { end: { '>': now }, start: { '<=': now + 3600 } } // Next hour
        const programmes = await db.find(query, { sort: { start: 1 } })

        for (const programme of programmes) {
          // Try to get real channel name from ID, fallback to prepared name
          let channelName
          try {
            const epgInstance = this.epgs[url]
            if (epgInstance && typeof epgInstance.getChannelById === 'function') {
              const channelInfo = await epgInstance.getChannelById(programme.channel)
              channelName = channelInfo.name || programme.channel
            } else {
              console.warn(`EPG instance not available or getChannelById not found for ${url}`)
              channelName = programme.channel
            }
          } catch (err) {
            // Only log non-expected errors to reduce log noise
            // "Metadata DB not initialized" is expected in some scenarios and handled gracefully
            if (err.message && !err.message.includes('Metadata DB not initialized')) {
              console.warn(`Error getting channel name for ${programme.channel}:`, err.message)
            }
            channelName = programme.channel
          }

          // Clean channel name for display
          const cleanChannelName = channelName.replace(/[^\w\s-]/g, '').trim()

          // Process categories
          if (programme.categories && Array.isArray(programme.categories) && programme.categories.length > 0) {
            for (const category of programme.categories) {
              if (!categories[category]) {
                categories[category] = new Set()
              }
              categories[category].add(cleanChannelName)
            }
          } else {
            uncategorized.add(cleanChannelName)
          }
        }
      } catch (err) {
        console.error(`Error processing programmes for ${url}:`, err)
      }
    }

    // Add uncategorized channels to ALL category
    if (uncategorized.size > 0) {
      if (!categories['ALL']) {
        categories['ALL'] = new Set()
      }
      categories['ALL'] = [...uncategorized].sort()
    }
    // Convert Sets to Arrays for proper serialization
    for (const c in categories) {
      if (categories[c] instanceof Set) {
        categories[c] = [...categories[c]].sort()
      }
    }
    return { categories, updateAfter }
  }

  /**
   * Get all programmes that are currently airing across all EPGs
   * @returns {Promise<Array>} Array of all current programmes
   */
  async getAllCurrentProgrammes() {
    this.debug && console.log('🎯 getAllCurrentProgrammes() called')

    const now = Date.now() / 1000
    const allProgrammes = []

    this.debug && console.log(`🎯 Checking ${Object.keys(this.epgs).length} EPGs for current programmes (now: ${now})`)

    for (const url in this.epgs) {
      const epg = this.epgs[url]
      
      // Skip EPGs that are not loaded (expected during initialization)
      if (epg.readyState !== 'loaded') {
        continue
      }
      
      const db = epg.db
      if (!db) {
        // No database available - expected during initialization or cleanup
        continue
      }
      
      try {
        // Ensure database is initialized
        if (!db.initialized) {
          this.debug && console.log(`🎯 Initializing database for EPG ${url}`)
          await db.init().catch(err => {
            console.error(`Failed to init db for getAllCurrentProgrammes (${url}):`, err)
            return
          })
        }

        // CRITICAL: Debug database state before query
        this.debug && console.log(`🎯 Processing EPG ${url}: readyState=${epg.readyState}`)
        // JexiDB uses normalizedFile as the public property (confirmed by dev)
        const dbFilePath = db.normalizedFile
        this.debug && console.log(`🎯 Database state: initialized=${db.initialized}, destroyed=${db.destroyed || false}, length=${db.length}, normalizedFile=${db.normalizedFile || 'undefined'}, filePath=${dbFilePath || 'undefined'}`)
        
        if (db.length === 0 && db.initialized && !db.destroyed) {
          console.error(`🚨 FLAG: Database has length=0 but is initialized and not destroyed for ${url}`)
          console.error(`🚨 This indicates the database may be pointing to wrong file or was cleared`)
          
          // Check if file exists on disk
          if (dbFilePath) {
            try {
              const fs = require('fs').promises
              const fileExists = await fs.access(dbFilePath).then(() => true).catch(() => false)
              const fileSize = fileExists ? (await fs.stat(dbFilePath)).size : 0
              console.error(`🚨 File exists: ${fileExists}, size: ${fileSize} bytes`)
              
              if (fileExists && fileSize > 0) {
                console.error(`🚨 File exists with data but db.length=0 - database may not be loaded correctly`)
              } else if (!fileExists) {
                console.error(`🚨 File does not exist - database may be pointing to wrong path`)
              }
            } catch (err) {
              console.error(`🚨 Error checking file:`, err.message)
            }
          }
        }

        // Get all programmes that are currently live using JexiDB syntax
        const query = { start: { '<=': now }, end: { '>': now } }
        const programmes = await db.find(query, { sort: { start: 1 } })
        
        this.debug && console.log(`🎯 EPG ${url}: found ${programmes.length} current programmes`)

        // Add EPG source info to each programme
        for (const programme of programmes) {
          allProgrammes.push({
            ...programme,
            epgUrl: url,
            epgSource: url,
            epgReady: true
          })
        }
      } catch (err) {
        console.error(`Error processing programmes for ${url}:`, err)
      }
    }

    this.debug && console.log(`🎯 Total current programmes found: ${allProgrammes.length}`)
    return allProgrammes
  }

}

