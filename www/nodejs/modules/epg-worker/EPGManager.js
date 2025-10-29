import { EventEmitter } from 'node:events'
import PQueue from 'p-queue'
import { EPG } from './EPG.js'
import { EPGCurator } from './EPGCurator.js'
import { EPG_CONFIG } from './config.js'
import { DatabaseFactory } from './database/DatabaseFactory.js'
import config from '../config/config.js'
import ConnRacing from '../conn-racing/conn-racing.js'
import { parseCommaDelimitedURIs, ucWords } from '../utils/utils.js'
import setupUtils from '../multi-worker/utils.js'
import { getFilename } from 'cross-dirname'
import { terms, match, resolveListDatabaseFile } from '../lists/tools.js'
import lang from '../lang/lang.js'
import fs from 'fs'
import { temp } from '../paths/paths.js'

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
    this.minEPGsToLoad = 2 // Load multiple EPGs, prioritizing user config over suggestions

    // ConnRacing management
    this.activeConnRacing = null // Reference to active ConnRacing instance
        
    // Failed EPGs metadata (URL, error, timestamp) - no instances in memory
    this.failedEPGs = new Map() // Map<url, {error, timestamp, suggested}>

    // Track previously loaded EPGs for update notifications
    this.previousLoadedEPGs = []

    // Log initialization
    console.log('EPGManager constructor called - instance created')

    // Ensure config is always an array
    if (!this.config || !Array.isArray(this.config)) {
      this.config = []
    }

    console.log('EPGManager initialized with concurrency limit of 2')
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
      console.log('EPG suggestions disabled, returning only configured EPGs:', configuredEPGs)
      return configuredEPGs
    }
    
    // Se epg-suggestions está habilitado, incluir EPGs sugeridos também
    const suggestedEPGs = Object.keys(this.epgs).filter(url => this.epgs[url]?.suggested)
    const allActiveEPGs = [...new Set([...configuredEPGs, ...suggestedEPGs])]
    
    console.log('EPG suggestions enabled, returning all EPGs:', allActiveEPGs)
    return allActiveEPGs
  }

  /**
   * Gerencia EPGs sugeridos baseado no estado de destino explícito
   * @param {boolean} enable - true para habilitar, false para desabilitar
   */
  async toggleSuggestedEPGs(enable) {
    const currentSuggestedEPGs = Object.keys(this.epgs).filter(url => this.epgs[url]?.suggested)
    
    console.log(`🔄 Toggling EPG suggestions: enable=${enable}, current suggested EPGs=${currentSuggestedEPGs.length}`)
    
    if (!enable && currentSuggestedEPGs.length > 0) {
      console.log('🔄 Disabling EPG suggestions, removing suggested EPGs...')
      
      // Cancelar ConnRacing ativo se existir
      if (this.activeConnRacing && !this.activeConnRacing.destroyed) {
        console.log('🛑 Canceling active ConnRacing...')
        this.activeConnRacing.destroy()
        this.activeConnRacing = null
      }
      
      // Resetar flag suggesting
      this.suggesting = false
      
      // Remover todos os EPGs sugeridos
      for (const url of currentSuggestedEPGs) {
        try {
          await this.remove(url)
          console.log(`✅ Removed suggested EPG: ${url}`)
        } catch (err) {
          console.error(`❌ Error removing suggested EPG ${url}:`, err)
        }
      }
      
      await this.updateState()
      console.log('✅ All suggested EPGs removed')
      
    } else if (enable && currentSuggestedEPGs.length === 0) {
      console.log('🔄 Enabling EPG suggestions, triggering suggestion process...')
      
      // Notificar o manager para recarregar sugestões
      utils.emit('reload-suggestions')
    } else {
      console.log('🔄 No action needed for EPG suggestions toggle')
    }
  }


  async waitForEPGsLoaded() {
    const maxWait = 300000 // 5 minutes maximum
    const startTime = Date.now()

    console.log('Waiting for EPGs to load...')

    while (Date.now() - startTime < maxWait) {
      const loadedEPGs = Object.values(this.epgs).filter(epg => this.isLoaded(epg.url))

      if (loadedEPGs.length > 0) {
        console.log(`Found ${loadedEPGs.length} loaded EPGs`)
        return true
      }

      await new Promise(resolve => setTimeout(resolve, 1000))
    }

    console.warn('Timeout waiting for EPGs to load, proceeding anyway')
    return false
  }

  async performDataCuration() {
    console.log('🎨 Starting EPG data curation process...')

    if (!this.curator) {
      console.warn('No curator available, skipping data curation')
      return
    }

    // First, clean old data from all EPGs
    await this.cleanOldData()

    for (const url in this.epgs) {
      const epg = this.epgs[url]

      // Check if EPG is really 'loaded' before processing
      if (epg.readyState !== 'loaded') {
        console.warn(`Skipping ${url} - not loaded (${epg.readyState})`)
        continue
      }

      const db = epg.db
      if (!db || !db.initialized) {
        console.warn(`Skipping ${url} - database not ready`)
        continue
      }

      try {
        // CRITICAL: Check if database is still valid before curation
        if (!db || db.destroyed || !db.initialized) {
          console.warn(`Skipping ${url} - database destroyed or not initialized`)
          continue
        }

        console.log(`🎨 Starting curation for ${url}...`)

        // Perform complete data curation with safety checks
        const results = await this.curator.performCuration(db)

        console.log(`✅ Curation completed for ${url}:`, results)

        // CRITICAL FIX: Recalculate _programmeCounts after curation
        // Curation removes data but _programmeCounts still has old values
        if (epg && epg._calculateProgrammeCounts) {
          try {
            await epg._calculateProgrammeCounts()
            console.log(`📊 Recalculated _programmeCounts after curation for ${url}:`, epg._programmeCounts)
          } catch (err) {
            console.warn(`Failed to recalculate _programmeCounts after curation for ${url}:`, err)
          }
        }

        // Validate suggested EPGs after curation - only log status, don't mark as error
        // Only validate if EPG has finished processing (ready or loaded state is stable)
        if (epg.suggested && this.isLoaded(epg.url)) {
          // CRITICAL: Check if database is still valid before counting
          if (!db || db.destroyed || !db.initialized) {
            console.warn(`Skipping validation for ${url} - database destroyed or not initialized`)
            continue
          }
          
          const now = Date.now() / 1000
          const totalCount = await db.count().catch(() => 0)
          const futureCount = await db.count({ e: { '>': now } }).catch(() => 0)
          
          console.log(`📊 EPG ${url} after curation: total=${totalCount}, future=${futureCount}`)
          
          // Only log status - don't mark as error after curation
          // Curation may temporarily reduce future programmes, but EPG is still valid
          if (totalCount > 0 && futureCount === 0) {
            console.log(`📋 Suggested EPG ${url} has ${totalCount} programmes but 0 future programmes after curation - keeping for now`)
          } else if (totalCount === 0) {
            console.log(`📋 Suggested EPG ${url} has no programmes yet, will wait for parsing to complete`)
          } else {
            console.log(`✅ Suggested EPG ${url} has ${futureCount} future programmes after curation`)
          }
        }

      } catch (err) {
        console.error(`❌ Error during curation for ${url}:`, err)
      }
    }

    console.log('🎨 EPG data curation process completed')
  }

  /**
   * Clean old data from all EPGs to prevent stale information
   */
  async cleanOldData() {
    console.log('🧹 Starting old data cleanup process...')
    
    const now = Date.now() / 1000 // Current Unix timestamp
    const maxAge = 7 * 24 * 3600 // 7 days in seconds
    
    for (const url in this.epgs) {
      const epg = this.epgs[url]
      
      if (!epg.db || !epg.db.initialized) {
        console.log(`Skipping ${url} - database not initialized`)
        continue
      }
      
      try {
        console.log(`🧹 Cleaning old data from ${url}...`)
        
        // Count old programmes before cleanup
        const oldCount = await epg.db.count({ e: { '<': now - maxAge } }).catch(() => 0)
        const totalCount = epg.db.length || 0
        
        if (oldCount > 0) {
          console.log(`📊 ${url}: Found ${oldCount} old programmes out of ${totalCount} total`)
          
          // Remove old programmes
          const deletedCount = await epg.db.delete({ e: { '<': now - maxAge } }).catch(() => 0)
          
          console.log(`✅ ${url}: Removed ${deletedCount} old programmes`)
          
          // CRITICAL FIX: Recalculate _programmeCounts after cleanup
          if (epg && epg._calculateProgrammeCounts) {
            try {
              await epg._calculateProgrammeCounts()
              console.log(`📊 Recalculated _programmeCounts after old data cleanup for ${url}:`, epg._programmeCounts)
            } catch (err) {
              console.warn(`Failed to recalculate _programmeCounts after cleanup for ${url}:`, err)
            }
          }
          
          // Update EPG state after cleanup
          await this.updateState()
        } else {
          console.log(`✅ ${url}: No old data found`)
        }
        
      } catch (err) {
        console.error(`❌ Error cleaning old data from ${url}:`, err.message)
      }
    }
    
    console.log('🧹 Old data cleanup process completed')
  }

  async start(config) {
    console.log('EPGManager.start() called with config:', config)

    // Initialize curator for duplicate detection and data cleanup
    this.curator = new EPGCurator(temp)
    console.log('EPG Curator initialized for data curation')

    console.log('Calling sync with config:', config)
    await this.sync(config)
    console.log('sync completed')
    
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
            console.log(`Found ${epgsWithData.length} EPG(s) with data, starting cleanup and curation...`)
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
        console.log('🎨 Curation enabled - starting data curation process')
    }, 5000) // Initial 5 second delay before starting to check
  }

  async sync(config) {
    console.log('EPGManager.sync() called with config:', config)

    // Ensure config is always an array
    this.config = Array.isArray(config) ? config : []

    const activeEPGs = this.activeEPGs()
    const currentEPGs = Object.keys(this.epgs)

    // Remove inactive EPGs FIRST (sequentially to avoid conflicts)
    const toRemove = currentEPGs.filter(url => !activeEPGs.includes(url))

    for (const url of toRemove) {
      if (!this.epgs[url]?.suggested) {
        console.log('Removing EPG:', url)
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
      console.log('Adding configured EPG:', url)
      try {
        // Add timeout to prevent hanging
        await this.add(url, false) // false = not suggested
        console.log('Successfully added configured EPG:', url)
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
          console.log(`✅ Saved failed configured EPG metadata for ${url} (add timeout) - failedEPGs size: ${this.failedEPGs.size}`)
        }
      }
    }

    // Check if we need more EPGs to reach minEPGsToLoad
    const currentWorkingEPGs = Object.values(this.epgs).filter(epg =>
      this.isLoaded(epg.url) || epg.readyState === 'loading'
    ).length

    const epgsNeeded = Math.max(0, this.minEPGsToLoad - currentWorkingEPGs)
    console.log(`After config EPGs: ${currentWorkingEPGs} working, need ${epgsNeeded} more to reach minEPGsToLoad=${this.minEPGsToLoad}`)

    if (epgsNeeded > 0) {
      console.log('Will attempt to load suggested EPGs to reach minimum requirement')
      // The suggest() method will be called later by the manager to fill remaining slots
    }

    console.log('EPG sync completed')
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
    console.log('Suggesting EPGs:', urls)

    if (!Array.isArray(urls) || urls.length === 0) {
      this.suggesting = false
      return 0
    }

    if (this.suggesting) {
      console.log('Already suggesting EPGs, skipping')
      return 0
    }

    this.suggesting = true
    
    try {
      // Save suggested URLs in this.config for use in fallback
      // Add URLs that are not in this.config
      const existingURLs = this.config.map(c => c.url || c)
      const newURLs = urls.filter(url => !existingURLs.includes(url))
      
      if (newURLs.length > 0) {
        this.config = [...this.config, ...newURLs.map(url => ({ url, suggested: true }))]
        console.log(`Added ${newURLs.length} new suggested URLs to config for fallback`)
      }

      // Count current working EPGs (excluding errors)
      const currentWorkingEPGs = Object.values(this.epgs).filter(epg =>
        this.isLoaded(epg.url) || epg.readyState === 'loading'
      ).length

      const epgsNeeded = Math.max(0, this.minEPGsToLoad - currentWorkingEPGs)
      console.log(`Current working EPGs: ${currentWorkingEPGs}, need ${epgsNeeded} more to reach minEPGsToLoad=${this.minEPGsToLoad}`)

      if (epgsNeeded <= 0) {
        console.log('Already have enough working EPGs, skipping suggestions')
        return 0
      }

      // CATEGORIZAR URLs por cache persistente e mtime
      const validCachedURLs = []  // Cache < 3 horas - carregam ASAP
      const cachedURLs = []       // Cache > 3 horas - testados primeiro
      const untestedURLs = []     // Sem cache - testados normalmente
      
      for (const url of urls) {
        // Se EPG já está carregado em memória, ignorar completamente
        if (this.epgs[url] && this.isLoaded(url)) {
          console.log(`✅ EPG already loaded in memory: ${url} - skipping`)
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
              console.log(`⚡ Valid cached EPG (< 3h): ${url} (${hoursSinceModified.toFixed(1)}h ago)`)
            } else {
              cachedURLs.push(url)
              console.log(`🔄 Cached EPG (> 3h): ${url} (${hoursSinceModified.toFixed(1)}h ago)`)
            }
          } else {
            cachedURLs.push(url)
            console.log(`🔄 Cached EPG (no mtime): ${url}`)
          }
        } else {
          untestedURLs.push(url)
          console.log(`❓ Untested EPG: ${url}`)
        }
      }
      
      console.log(`📊 URL Categorization:
        - Valid cached (< 3h): ${validCachedURLs.length}
        - Cached (> 3h): ${cachedURLs.length}  
        - Untested: ${untestedURLs.length}`)

      // Cancelar ConnRacing anterior se existir
      if (this.activeConnRacing && !this.activeConnRacing.destroyed) {
        console.log('🛑 Canceling previous ConnRacing...')
        this.activeConnRacing.destroy()
      }

      // 1. CARREGAR validCachedURLs IMEDIATAMENTE (ignorar ConnRacing)
      let loadedCount = 0
      const startTime = Date.now()
      
      for (const url of validCachedURLs) {
        if (loadedCount >= epgsNeeded) break
        
        console.log(`⚡ Loading valid cached EPG ASAP: ${url}`)
        try {
          await this.add(url, true) // true = suggested
          loadedCount++
          console.log(`✅ Loaded valid cached EPG: ${url}`)
        } catch (error) {
          console.warn(`Failed to load valid cached EPG ${url}:`, error.message)
        }
      }
      
      // 2. PREPARAR URLs para ConnRacing (cachedURLs primeiro)
      const urlsForConnRacing = [...cachedURLs, ...untestedURLs]
      
      if (urlsForConnRacing.length > 0 && loadedCount < epgsNeeded) {
        const epgsToLoad = Math.min(urlsForConnRacing.length, epgsNeeded - loadedCount)
        console.log(`🚀 Testing ${urlsForConnRacing.length} URLs with ConnRacing (cached first)...`)
        
        this.activeConnRacing = new ConnRacing(urlsForConnRacing, { 
          retries: 2, 
          timeout: 60
        })
        
        // Process results as they come in using next() method
        while (loadedCount < epgsToLoad) {
          const result = await this.activeConnRacing.next()
          
          if (!result) {
            console.log('No more results from ConnRacing')
            break
          }
          
          if (result.valid && result.status >= 200 && result.status < 300) {
            console.log(`🎯 Fast EPG found: ${result.url} (${result.time.toFixed(2)}s)`)
            
            try {
              // Load the fast EPG immediately
              await this.add(result.url, true) // true = suggested
              
              // Wait for EPG to complete loading (parser + database operations)
              console.log(`⏳ Waiting for EPG ${result.url} to complete loading...`)
              const loadSuccess = await this.waitForEPGLoad(result.url, 30000) // Reduced to 30 second timeout
              
              if (!loadSuccess) {
                console.log(`❌ EPG ${result.url} failed to load within timeout, trying next EPG...`)
                // Don't throw error, just continue to next EPG
                continue
              }
              
              const epg = this.epgs[result.url]
              const programmesCount = await epg.db.count()
              
              // Log debug info for the loaded EPG
              console.log(`EPG Debug Info for ${result.url}: ${JSON.stringify({
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
              console.log(`✅ Successfully loaded fast EPG: ${result.url}`)
            } catch (error) {
              console.warn(`Failed to load fast EPG ${result.url}:`, error.message)
              this.failedEPGs.set(result.url, {
                error: error.message,
                timestamp: Date.now(),
                suggested: true
              })
            }
          } else {
            console.log(`❌ EPG failed: ${result.url} (${result.status})`)
          }
        }
      }

      const duration = Date.now() - startTime
      console.log(`✅ Suggest completed in ${duration}ms, loaded ${loadedCount} EPGs`)
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
  setChannelTermsIndex(channelTermsIndex) {
    this.channelTermsIndex = channelTermsIndex
    
    if (channelTermsIndex) {
      console.log(`Channel filtering updated with ${Object.keys(channelTermsIndex).length} known channels`)
    } else {
      console.log('Channel filtering disabled - no channel terms provided')
    }
    
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
    console.log('EPGManager.add() called with url:', url, 'suggested:', suggested)

    // CRITICAL: Check if manager is being destroyed
    if (this._destroying) {
      console.warn('EPGManager is being destroyed, cannot add new EPG:', url)
      return
    }

    if (this.epgs[url]) {
      console.log('EPG already exists for:', url)
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
      console.log('🔵 BEFORE epgQueue.add() in add():')
      console.log(`  - URL: ${url}`)
      console.log(`  - Priority: ${priority}`)
      console.log(`  - epgQueue exists: ${!!this.epgQueue}`)
      console.log(`  - epgQueue.add exists: ${typeof this.epgQueue.add === 'function'}`)
      console.log(`  - epgQueue.size: ${this.epgQueue?.size || 0}`)
      console.log(`  - epgQueue.pending: ${this.epgQueue?.pending || 0}`)
      console.log(`  - _destroying flag: ${this._destroying}`)
      
      return this.epgQueue.add(async () => {
        console.log(`Processing EPG addition from queue: ${url} (priority: ${priority}, queue size: ${this.epgQueue?.size || 0})`)
        await this._addEPGInternal(url, suggested)
      }, { priority })
      
      console.log('🟢 AFTER epgQueue.add() in add(): Operation added successfully')
    } catch (err) {
      console.error('🔴 ERROR adding to epgQueue, falling back to direct execution:', err.message)
      console.error('Error stack:', err.stack)
      return this._addEPGInternal(url, suggested)
    }
  }

  async _addEPGInternal(url, suggested = false) {
    // Double-check in case EPG was added while waiting in queue
    if (this.epgs[url]) {
      console.log('EPG already exists (checked in queue):', url)
      return
    }

    console.log('Proceeding with EPG addition for:', url)

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
      console.log('Creating EPG instance for:', url)
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
      console.log('EPG instance created, starting...')

      // Update state immediately after adding EPG
      await this.updateState()
      await epg.start()
      
      console.log('EPG added successfully:', url, 'state:', epg.readyState, 'length:', epg.length)
      console.log('EPG programme counts: ' + JSON.stringify(epg._programmeCounts))

      // CORRECTED: Check EPG limit ONLY AFTER the EPG is successfully loaded
      // Only consider EPGs that are actually loaded (readyState === 'loaded' and have data)
      const allLoadedEPGs = Object.keys(this.epgs).filter(epgUrl => {
        const epgInstance = this.epgs[epgUrl]
        return this.isLoaded(epgUrl) && epgInstance.readyState === 'loaded' && 
               epgInstance.db && epgInstance.db.initialized && epgInstance.db.length > 0
      })
      
      console.log(`🔍 Current loaded EPGs count after loading ${url}: ${allLoadedEPGs.length} (quota: 2)`)
      
      if (allLoadedEPGs.length > 2) {
        console.log(`🔧 EPG limit exceeded (${allLoadedEPGs.length} > 2), keeping only the 2 largest EPGs`)
        
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
          
          epgSizes.push({ url: epgUrl, size, suggested: epgInstance.suggested })
        }
        
        // Sort by size (largest first)
        epgSizes.sort((a, b) => b.size - a.size)
        
        // Keep the 2 largest EPGs, remove the rest
        const epgsToKeep = epgSizes.slice(0, 2)
        const epgsToRemove = epgSizes.slice(2)
        
        console.log(`📊 EPG sizes:`, epgSizes.map(e => `${e.url}: ${e.size} programmes`))
        console.log(`✅ Keeping EPGs:`, epgsToKeep.map(e => `${e.url} (${e.size} programmes)`))
        console.log(`🗑️ Removing EPGs:`, epgsToRemove.map(e => `${e.url} (${e.size} programmes)`))
        
        // Remove smaller EPGs
        for (const epgToRemove of epgsToRemove) {
          console.log(`🗑️ Removing smaller EPG: ${epgToRemove.url} (${epgToRemove.size} programmes)`)
          await this.remove(epgToRemove.url)
        }
      }

      // Emit update event to notify lists.js
      utils.emit('update', url)
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
        console.log(`✅ Saved failed EPG metadata for ${url} (start timeout) - failedEPGs size: ${this.failedEPGs.size}`)
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
    
    console.log(`⏳ Waiting for EPG ${url} to complete loading...`)
    console.log(`Initial state: readyState=${epg.readyState}, db.initialized=${epg.db?.initialized}`)

    // Check if already loaded
    if (this.isLoaded(url)) {
      console.log(`✅ EPG ${url} already loaded`)
      return true
    }

    // Check if already in error state
    if (epg.readyState === 'error') {
      console.log(`❌ EPG ${url} already failed with error: ${epg.error}`)
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
          console.log(`✅ EPG ${url} loaded successfully after ${elapsed}ms`)
          console.log(`Final state: readyState=${epg.readyState}, db.length=${epg.db?.length || 0}`)
        } else {
          console.log(`❌ EPG ${url} ${reason} after ${elapsed}ms`)
        }
        resolve(success)
      }

      const onStateChange = (stateInfo) => {
        console.log(`🔄 EPG ${url} state changed: ${stateInfo.from} → ${stateInfo.to}`)
        
        if (stateInfo.to === 'loaded' || stateInfo.to === 'ready') {
          resolveOnce(true, 'state change to loaded/ready')
        }
      }

      const onError = (error) => {
        console.log(`❌ EPG ${url} error event:`, error.message)
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
      console.log(`🔴 Removing EPG ${url} as requested...`)
      
      // If there's a commit in progress, wait for it to complete before destroying
      if (e._state?.commitInProgress) {
        console.log(`🟡 EPG ${url} has commit in progress, waiting for completion before removal...`)
        
        try {
          // Wait for all database operations to complete
          if (e.udb && typeof e.udb.waitForOperations === 'function') {
            console.log(`🟡 Waiting for database operations to complete for ${url}...`)
            await e.udb.waitForOperations()
            console.log(`✅ Database operations completed for ${url}`)
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
        
        console.log(`Saving failed EPG metadata for ${url}, removing instance from memory`)

        // Remove instance from memory but keep metadata
        delete this.epgs[url]
        utils.emit('update', url)

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

      try {
        await e.destroy()
      } catch (err) {
        console.error('Error destroying EPG:', err)
      }
    }
  }

  async clear() {
    console.log('Clearing all EPGs...')
    
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
    
    console.log(`Cleared ${urls.length} EPG(s)`)
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
    
    const hash = JSON.stringify(status.epgs)
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
        console.log(`📡 EPG ${epg.url} finished loading, emitting update event`)
        utils.emit('update', epg.url)
      })
      
      // Atualizar lista de EPGs carregados para próxima comparação
      this.previousLoadedEPGs = status.epgs
        .filter(epg => epg.readyState === 'loaded')
        .map(epg => epg.url)
      
      return status
    }
    
    return null
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
        console.log(`🔍 _searchInEPG: EPG ${epg.url} not ready (db: ${!!epg.db}, initialized: ${epg.db?.initialized})`)
        return []
      }

      console.log(`🔍 _searchInEPG: Searching for terms [${terms.slice(0, 3).join(', ')}${terms.length > 3 ? '...' : ''}] in EPG ${epg.url}`)

      const query = nowLive ?
        { terms: { $in: terms }, start: { '<=': Math.floor(Date.now() / 1000) }, e: { '>': Math.floor(Date.now() / 1000) } } :
        { terms: { $in: terms } }

      console.log(`🔍 _searchInEPG: Query: ${JSON.stringify(query)}`)

      const programmes = await epg.db.find(query, { limit: 50 })
      console.log(`🔍 _searchInEPG: Found ${programmes.length} programmes for terms [${terms.slice(0, 3).join(', ')}]`)
      
      return programmes.map(programme => ({
        ...programme,
        epgUrl: epg.url
      }))
    } catch (err) {
      console.error('🔍 _searchInEPG: Error searching in EPG:', epg.url, err)
      return []
    }
  }

  async findChannel(data) {
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
        if (score) data.push({ name, url, score })
      }
    }

    data = data.sortByProp('score', true).slice(0, 24)

    for (const r of data) {
      if (this.epgs[r.url] && this.epgs[r.url].db) {
        results[r.name] = await this.epgs[r.url].db.find({ ch: r.name, e: { '>': Math.floor(Date.now() / 1000) } }, { limit })
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
      const category = programme.c && programme.c.length > 0 ? programme.c[0] : 'Other'

      if (!categories[category]) {
        categories[category] = {}
      }

      if (!categories[category][cleanChannelName]) {
        categories[category][cleanChannelName] = {
          name: cleanChannelName,
          programme: programme,
          icon: programme.i || ''
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
          e: { '>': now }
        }, { limit: 1000 })


        for (const programme of programmes) {
          // Try to get real channel name from ID, fallback to prepared name
          let channelName
          try {
            const epgInstance = this.epgs[url]
            if (epgInstance && typeof epgInstance.getChannelById === 'function') {
              const channelInfo = await epgInstance.getChannelById(programme.ch)
              channelName = channelInfo.name || programme.ch
            } else {
              console.warn(`EPG instance not available or getChannelById not found for ${url}`)
              channelName = programme.ch
            }
          } catch (err) {
            console.warn(`Could not get channel name for ${programme.ch}:`, err)
            channelName = programme.ch
          }

          // Clean up the channel name
          const cleanName = this.prepareChannelName(channelName)

          // Filter out channels that are only numbers and couldn't be translated
          const isOnlyNumbers = /^\d+$/.test(cleanName)
          const isOriginalId = cleanName === programme.ch

          if (isOnlyNumbers && isOriginalId) {
            continue
          }

          // Only log if we got a real name, not just an ID
          if (channelName !== programme.ch) {
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

  // ===== Utility Methods =====

  get length() {
    return Object.values(this.epgs).reduce((total, epg) => total + (epg.length || 0), 0)
  }

  async status() {
    console.log('EPGManager.status() called')

    // Add timeout to prevent hanging
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error('EPG status timeout after 30 seconds')), 30000);
    });

    const statusPromise = this._getStatus();

    try {
      const result = await Promise.race([statusPromise, timeoutPromise]);
      console.log('EPGManager.status() completed successfully')
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
      
      // DEBUG: Log the conditions for loadedEPGs counter
      console.log(`🔍 DEBUG loadedEPGs for ${url}:`)
      console.log(`  - isReady: ${isReady}`)
      console.log(`  - hasData: ${hasData}`)
      console.log(`  - hasDataInError: ${hasDataInError}`)
      console.log(`  - epg.readyState: ${epg.readyState}`)
      console.log(`  - epg.db?.initialized: ${epg.db?.initialized}`)
      console.log(`  - epg.db?.length: ${epg.db?.length}`)
      console.log(`  - epg._programmeCounts: ${JSON.stringify(epg._programmeCounts)}`)
              
      if (isReady || hasDataInError || hasData) {
          // Use pre-calculated programme counts from EPG.start() if available
          if (epg._programmeCounts && 'future' in epg._programmeCounts) {
            epgStatus.totalProgrammes = epg._programmeCounts.total
            epgStatus.futureProgrammes = epg._programmeCounts.future
            epgStatus.pastProgrammes = epg._programmeCounts.past
            epgStatus.currentProgrammes = epg._programmeCounts.current
            epgStatus.databaseSize = epg._programmeCounts.total
            
            console.log(`Using pre-calculated counts for ${url}: total=${epgStatus.totalProgrammes}, future=${epgStatus.futureProgrammes}`)
          } else {
            // Fallback to database stats if _programmeCounts not available
            if (epg.db) {
              if (!epg.db.initialized) {
                await epg.db.init()
              }
              // Database is already initialized, use length property directly
              epgStatus.databaseSize = epg.db.length || 0
              epgStatus.totalProgrammes = epgStatus.databaseSize
              
              console.log(`EPG ${url}: db.length=${epgStatus.databaseSize}, initialized=${epg.db.initialized}`)
            }
          }
          
          // REMOVED: Duplicate logic that was overwriting pre-calculated counts
          // The counts are already set above from _programmeCounts or fallback

          // Add validation flag to prevent infinite loops
          if (!epg._validationAttempted) {
            epg._validationAttempted = true
            
            // Now decide if we should count this EPG as loaded
            // For suggested EPGs, only count as loaded if it has future programmes
            // For configured EPGs, be more lenient - accept if it has any programmes
            const shouldCountAsLoaded = !epg.suggested || (epgStatus.futureProgrammes > 0)

          if (hasDataInError) {
            if (shouldCountAsLoaded) {
              epgStatus.readyState = 'loaded' // Override error state if we have data
              epg.readyState = 'loaded'
              epg.error = null
              status.loadedEPGs++
            } else {
              // EPG has data but insufficient future programmes for suggested EPGs
              console.log(`EPG ${url} has data but insufficient future programmes: ${epgStatus.futureProgrammes} (suggested: ${epg.suggested})`)
            }
          } else if (hasData && epg.readyState === 'error') {
            // Additional check: EPG has data but is marked as error (shouldn't happen, but fix it)
            if (shouldCountAsLoaded) {
              epgStatus.readyState = 'loaded'
              epg.readyState = 'loaded'
              epg.error = null
              status.loadedEPGs++
            }
          } else {
            // EPG has data and is valid - no additional validation needed
            
            if (epgStatus.totalProgrammes === 0) {
              // EPG has no programmes - mark as error
              console.warn(`EPG ${url} has no programmes (total: ${epgStatus.totalProgrammes}), marking as error`)
              epgStatus.readyState = 'error'
              epgStatus.state = 'error'
              epgStatus.error = 'EPG_NO_PROGRAMMES'
              epg.readyState = 'error'
              epg.error = 'EPG_NO_PROGRAMMES'
              status.errorEPGs++
              
              // Add to failed EPGs
              this.failedEPGs.set(url, {
                error: 'EPG_NO_PROGRAMMES',
                timestamp: Date.now(),
                suggested: epg.suggested || false
              })
            } else {
              // EPG has data and programmes - validate if sufficient future programmes
              // Use pre-calculated counts if available, otherwise use validation method
              let futureCount = 0
              let hasSufficient = false
              
              if (epg._programmeCounts && 'future' in epg._programmeCounts) {
                // Use pre-calculated counts for consistency
                futureCount = epg._programmeCounts.future
                hasSufficient = futureCount >= 36
                console.log(`📊 Using pre-calculated counts for validation: future=${futureCount}, sufficient=${hasSufficient}`)
              } else {
                // Fallback to validation method if _programmeCounts not available
                const validation = await epg.validateSufficientFutureProgrammes()
                futureCount = validation.futureCount
                hasSufficient = validation.hasSufficient
                console.log(`📊 Using validation method: future=${futureCount}, sufficient=${hasSufficient}`)
              }
              
              if (hasSufficient) {
                console.log(`EPG ${url} has sufficient future programmes (${futureCount} >= 36), treating as loaded`)
                epgStatus.readyState = 'loaded'
                epgStatus.state = 'loaded'
                // CRITICAL FIX: Don't set epg.readyState here to avoid infinite loop
                // epg.readyState = 'loaded'  // REMOVED - causes infinite loop
                epg.error = null
                status.loadedEPGs++
              } else {
                // For suggested EPGs with no future programmes, be more tolerant
                if (epg.suggested && futureCount === 0) {
                  console.log(`📋 Suggested EPG ${url} has ${epgStatus.totalProgrammes} programmes but 0 future programmes - keeping for now (may be timestamp issue)`)
                  
                  // Don't mark as error - just log warning and keep EPG
                  // The EPG has data, just no future programmes (could be timestamp issue)
                  epgStatus.readyState = 'loaded'  // Keep as loaded since it has data
                  epgStatus.state = 'loaded'
                  epgStatus.error = null
                  epg.readyState = 'loaded'
                  epg.error = null
                  status.loadedEPGs++
                  
                  // Keep EPG active - no removal needed
                  
                } else {
                  // For configured EPGs or EPGs with some future programmes, clean old data
                  console.log(`EPG ${url} has insufficient future programmes (${futureCount} < 36), cleaning old data`)
                  
                  // Clean only programmes that have already finished (not based on loading time)
                  const now = Date.now() / 1000
                  try {
                    // Count expired programmes first
                    const expiredCount = await epg.db.count({ e: { '<': now } }).catch(() => 0)
                    
                    // Only delete if there are more than 128 expired programmes
                    if (expiredCount > 128) {
                      const deletedCount = await epg.db.delete({ e: { '<': now } }).catch(() => 0)
                      console.log(`🧹 Cleaned ${deletedCount} expired programmes from ${url} (${expiredCount} found)`)
                      
                      // CRITICAL FIX: Recalculate _programmeCounts after cleanup
                      if (epg && epg._calculateProgrammeCounts) {
                        try {
                          await epg._calculateProgrammeCounts()
                          console.log(`📊 Recalculated _programmeCounts after expired cleanup for ${url}:`, epg._programmeCounts)
                        } catch (err) {
                          console.warn(`Failed to recalculate _programmeCounts after cleanup for ${url}:`, err)
                        }
                      }
                    } else {
                      console.log(`🧹 Skipping cleanup for ${url} - only ${expiredCount} expired programmes (threshold: 128)`)
                    }
                  } catch (cleanErr) {
                    console.warn(`Error cleaning expired data from ${url}:`, cleanErr.message)
                  }
                  
                  epgStatus.readyState = 'error'
                  epgStatus.state = 'error'
                  epgStatus.error = 'EPG_INSUFFICIENT_FUTURE_PROGRAMMES'
                  epg.readyState = 'error'
                  epg.error = 'EPG_INSUFFICIENT_FUTURE_PROGRAMMES'
                  status.errorEPGs++
                  
                  // Add to failed EPGs
                  this.failedEPGs.set(url, {
                    error: 'EPG_INSUFFICIENT_FUTURE_PROGRAMMES',
                    timestamp: Date.now(),
                    suggested: epg.suggested || false
                  })
                }
              }
            }
          } // End of validation flag check
        } // Fechar o bloco if (!epg._validationAttempted)
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
    
    console.log(`🔍 EPGManager: Adding EPG ${url}: future=${epgStatus.futureProgrammes}, total future so far=${status.futureProgrammes}`)
    }

    // Add failed EPGs metadata to status (only if not already in epgs list)
    console.log(`🔍 Checking ${this.failedEPGs.size} failed EPGs for status inclusion`)
    for (const [url, metadata] of this.failedEPGs) {
      // Check if this URL is already in the epgs list
      const alreadyInList = status.epgs.some(epg => epg.url === url)
      
      console.log(`🔍 Failed EPG ${url}: alreadyInList=${alreadyInList}, error=${metadata.error}`)
      
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
        console.log(`✅ Added failed EPG ${url} to status with error: ${metadata.error}`)
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
    const now = Date.now() / 1000 // Convert to Unix timestamp

    // Handle different channel input formats
    let channelObj = ch
    if (typeof ch === 'string') {
      channelObj = { name: ch, searchName: ch }
    } else if (ch && ch.name && !ch.searchName) {
      channelObj = { ...ch, searchName: ch.name }
    }

    const data = await this.get(channelObj, 1)
    if (data && data.length) {
      const p = data[0]
      if (p.e > now && parseInt(p.start) <= now) {
        return p
      }
    }
    return false
  }

  async get(channel, limit) {
    if (channel.searchName == '-') return []
    const now = Date.now() / 1000, query = { e: { '>': now } }
    if (limit <= 1) query.start = { '<=': now }

    if (channel.searchName || channel.name) {
      const searchTerm = channel.searchName || channel.name
      for (const url in this.epgs) {
        if (this.epgs[url].readyState !== 'loaded') {
          continue
        }
        const db = this.epgs[url].db
        if (!db) {
          continue
        }
        try {
          const availables = db.indexManager.readColumnIndex('ch')
          // Ensure availables is a Set or convert it to one
          const availablesSet = availables instanceof Set ? availables : new Set(Array.isArray(availables) ? availables : [])

          // First try exact match
          if (availablesSet.has(searchTerm)) {
            query.ch = searchTerm
            const result = await db.find(query, { sort: { start: 1 }, limit })
            return result
          }

          // If no exact match, try substring search with preference for channels with programmes
          const searchTermLower = searchTerm.toLowerCase()
          const matchingChannels = []

          // First, collect all matching channels
          for (const availableChannel of availablesSet) {
            if (availableChannel.toLowerCase().includes(searchTermLower)) {
              matchingChannels.push(availableChannel)
            }
          }

          // If we have matches, prioritize channels with programmes
          if (matchingChannels.length > 0) {
            // Test each channel to see which has programmes
            for (const testChannel of matchingChannels) {
              query.ch = testChannel
              const testResult = await db.find(query, { sort: { start: 1 }, limit })
              if (testResult.length > 0) {
                return testResult
              }
            }

            // If no channel has programmes, return the first match anyway
            const firstMatch = matchingChannels[0]
            query.ch = firstMatch
            const result = await db.find(query, { sort: { start: 1 }, limit })
            return result
          }
        } catch (err) {
          console.error('Error reading column index for channel:', err)
          continue
        }
      }
    }

    // Fallback to findChannel if no direct match found
    const n = await this.findChannel(terms(channel.name || channel.searchName || ''))
    if (n) {
      for (const url in this.epgs) {
        if (this.epgs[url].readyState !== 'loaded') continue
        const db = this.epgs[url].db
        if (!db) continue
        try {
          const availables = db.indexManager.readColumnIndex('ch')
          const availablesSet = availables instanceof Set ? availables : new Set(Array.isArray(availables) ? availables : [])
          if (availablesSet.has(n)) {
            query.ch = n
            const result = await db.find(query, { sort: { start: 1 }, limit })
            return result
          }
        } catch (err) {
          console.error('Error in fallback search:', err)
          continue
        }
      }
    }

    return []
  }

  async getMulti(channelsList, limit) {

    let results = {}
    for (const ch of channelsList) {
      try {
        results[ch.name] = await this.get(ch, limit)
      } catch (err) {
        console.error(`Error in getMulti for channel ${ch.name}:`, err.message)
        results[ch.name] = []
      }
    }

    return results
  }

  async validateChannels(data) {
    const processed = {}
    for (const channel in data) {
      let err
      const cid = await this.findChannel(data[channel].terms || terms(channel.toString()))
      const live = await this.liveNow(cid).catch(e => console.error(err = e))
      if (!err && live) {
        for (const candidate of data[channel].candidates) {
          if (live.t == candidate.t) { processed[channel] = candidate.ch; break }
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
          const hasCategories = sampleProgrammes.some(p => p.c && Array.isArray(p.c) && p.c.length > 0)
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
        const query = { e: { '>': now }, start: { '<=': now + 3600 } } // Next hour
        const programmes = await db.find(query, { sort: { start: 1 } })


        for (const programme of programmes) {
          // Try to get real channel name from ID, fallback to prepared name
          let channelName
          try {
            const epgInstance = this.epgs[url]
            if (epgInstance && typeof epgInstance.getChannelById === 'function') {
              const channelInfo = await epgInstance.getChannelById(programme.ch)
              channelName = channelInfo.name || programme.ch
            } else {
              console.warn(`EPG instance not available or getChannelById not found for ${url}`)
              channelName = programme.ch
            }
          } catch (err) {
            console.warn(`Could not get channel name for ${programme.ch}:`, err)
            channelName = programme.ch
          }

          // Clean up the channel name
          const cleanName = this.prepareChannelName(channelName)

          // Filter out channels that are only numbers and couldn't be translated
          const isOnlyNumbers = /^\d+$/.test(cleanName)
          const isOriginalId = cleanName === programme.ch

          if (isOnlyNumbers && isOriginalId) {
            continue
          }

          // Only log if we got a real name, not just an ID
          if (channelName !== programme.ch) {
          }

          if (programme.c && Array.isArray(programme.c) && programme.c.length > 0) {
            this.liveNowChannelsListFilterCategories(programme.c).forEach(category => {
              category = ucWords(category).replaceAll('/', ' ')
              if (!categories[category] || !(categories[category] instanceof Set)) {
                categories[category] = new Set()
              }
              categories[category].add(cleanName)
            })
          } else {
            uncategorized.add(cleanName)
          }
          updateAfter = Math.min(updateAfter, Math.max(programme.e - now, 10))
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
    console.log('Destroying EPGManager...')

    // CRITICAL: Set destroying flag FIRST to prevent new operations
    this._destroying = true
    console.log('_destroying flag set to true - no new operations will be accepted')
    
    // Remove error listeners from all EPG instances BEFORE waiting for queue
    // This prevents new fallback triggers during destruction
    console.log('Removing error listeners from all EPG instances...')
    for (const url in this.epgs) {
      const epg = this.epgs[url]
      if (epg && typeof epg.removeAllListeners === 'function') {
        epg.removeAllListeners('error')
        console.log(`Removed error listeners from EPG: ${url}`)
      }
    }

    // Wait for any pending queue operations to complete
    if (this.epgQueue) {
      try {
        const queueSize = this.epgQueue.size
        const queuePending = this.epgQueue.pending
        console.log(`Waiting for queue to idle (size: ${queueSize}, pending: ${queuePending})...`)
        
        // Add a timeout to prevent hanging indefinitely
        await Promise.race([
          this.epgQueue.onIdle(),
          new Promise((_, reject) => setTimeout(() => reject(new Error('Queue idle timeout')), 30000))
        ])
        
        console.log('All queue operations completed')
        
        // Clear the queue
        this.epgQueue.clear()
        console.log('Queue cleared')
        
        // Set to null to prevent new operations
        this.epgQueue = null
        console.log('epgQueue set to null')
      } catch (queueErr) {
        console.warn('Error while waiting for queue to idle:', queueErr.message)
        // Force clear anyway
        if (this.epgQueue) {
          try {
            this.epgQueue.clear()
            console.log('Queue force cleared')
          } catch (clearErr) {
            console.warn('Error clearing queue:', clearErr.message)
          }
          this.epgQueue = null
        }
      }
    }

    // Destroy all EPG instances
    console.log('Destroying all EPG instances...')
    const destroyPromises = Object.values(this.epgs).map(epg => epg.destroy().catch(err => {
      console.error('Error destroying EPG:', err)
    }))

    await Promise.allSettled(destroyPromises)
    console.log('All EPG instances destroyed')

    // Clear references
    this.epgs = {}
    this.config = []
    // Trias removed - using AI client instead
    this.curator = null

    console.log('EPGManager destroyed successfully')
  }


  // Multi-worker compatibility method
  async terminate() {
    console.log('Terminating EPGManager...')
    await this.destroy()
  }

  async liveNow(ch) {
    const now = Date.now() / 1000 // Convert to Unix timestamp

    // Handle different channel input formats
    let channelObj = ch
    if (typeof ch === 'string') {
      channelObj = { name: ch, searchName: ch }
    } else if (ch && ch.name && !ch.searchName) {
      channelObj = { ...ch, searchName: ch.name }
    }

    const data = await this.get(channelObj, 1)
    if (data && data.length) {
      const p = data[0]
      return {
        channel: p.ch,
        title: p.t,
        start: p.start,
        end: p.e,
        description: p.desc,
        icon: p.i,
        categories: p.c
      }
    }
    return null
  }

  async get(channel, limit) {
    const now = Date.now() / 1000
    let query = { e: { '>': now } }

    if (limit <= 1) query.start = { '<=': now }

    if (channel.searchName || channel.name) {
      const searchTerm = channel.searchName || channel.name
      for (const url in this.epgs) {
        if (this.epgs[url].readyState !== 'loaded') {
          continue
        }
        const db = this.epgs[url].db
        if (!db) {
          continue
        }
        try {
          const availables = db.indexManager.readColumnIndex('ch')
          // Ensure availables is a Set or convert it to one
          const availablesSet = availables instanceof Set ? availables : new Set(Array.isArray(availables) ? availables : [])

          if (availablesSet.has(searchTerm)) {
            query.ch = searchTerm
            const result = await db.find(query, { sort: { start: 1 }, limit })
            return result
          }
        } catch (err) {
          console.error(`Error checking channel ${searchTerm} in ${url}:`, err)
          continue
        }
      }
    }

    // Fallback to findChannel if no direct match found
    const n = await this.findChannel(terms(channel.name || channel.searchName || ''))
    if (n) {
      for (const url in this.epgs) {
        if (this.epgs[url].readyState !== 'loaded') continue
        const db = this.epgs[url].db
        if (!db) continue
        try {
          const availables = db.indexManager.readColumnIndex('ch')
          const availablesSet = availables instanceof Set ? availables : new Set(Array.isArray(availables) ? availables : [])
          if (availablesSet.has(n)) {
            query.ch = n
            const result = await db.find(query, { sort: { start: 1 }, limit })
            return result
          }
        } catch (err) {
          console.error(`Error in fallback for ${n} in ${url}:`, err)
          continue
        }
      }
    }

    return []
  }

  async getMulti(channelsList, limit) {
    const results = {}
    for (const channel of channelsList) {
      results[channel.name] = await this.get(channel, limit)
    }
    return results
  }

  async validateChannels(data) {
    const processed = {}
    for (const channel in data) {
      let err
      const cid = await this.findChannel(data[channel].terms || terms(channel.toString()))
      const live = await this.liveNow(cid).catch(e => console.error(err = e))
      if (!err && live) {
        for (const candidate of data[channel].candidates) {
          const liveCandidate = await this.liveNow(candidate).catch(e => console.error(err = e))
          if (!err && liveCandidate) {
            processed[channel] = { ...data[channel], live: liveCandidate }
            break
          }
        }
      }
    }
    return processed
  }

  async getRecommendations(categories, until, limit = 24, chList = null) {
    // Debug logs melhorados
    console.log(`🎯 getRecommendations called with categories type: ${typeof categories}`)
    console.log(`🎯 categories is null/undefined: ${categories == null}`)
    console.log(`🎯 categories keys: ${Object.keys(categories || {}).length}`)
    console.log(`🎯 categories sample: ${Object.keys(categories || {}).slice(0, 5).join(',')}`)
    console.log(`🎯 chList provided: ${chList != null}`)
    console.log(`🎯 chList length: ${chList?.length || 0}`)
    console.log(`🎯 getRecommendations processing ${Object.keys(categories || {}).length} categories, limit: ${limit}`)

    if (!categories || typeof categories !== 'object') {
      console.log(`🎯 Invalid categories parameter:`, categories)
      return []
    }

    const now = Date.now() / 1000
    const untilTime = until || (now + 6 * 3600) // Default to 6 hours in the future if until is null
    let results = []
    const processedCategories = new Set()

    console.log(`🎯 Time filtering: now=${now}, until=${untilTime}, untilParam=${until}`)

    // Use optimized score() method for better performance
    try {
      // Collect all categories with their scores
      const categoryScores = {}
      for (const category of Object.keys(categories)) {
        if (processedCategories.has(category)) continue
        processedCategories.add(category)
        categoryScores[category] = categories[category]
      }

      console.log(`🎯 Using score() method for ${Object.keys(categoryScores).length} categories`)

      // Debug: verificar dados nos EPGs antes de usar score()
      for (const url in this.epgs) {
        const epg = this.epgs[url]
        if (!epg.db || !epg.db.initialized) {
          console.log(`🎯 EPG ${epg.url}: Database not ready`)
          continue
        }

        // Debug: verificar estrutura dos dados salvos
        try {
          const maxResultSetSize = limit * 10 // wider range for filtering
          // Usar score() com categoryScores reais
          const scoredProgrammes = await epg.db.score('terms', categoryScores, {
            limit: maxResultSetSize, // Get more results for better selection
            sort: 'desc',
            includeScore: true // Include relevance scores in results
          })

          console.log(`🎯 EPG ${epg.url}: Found ${scoredProgrammes.length} scored programmes`)

          for (const programme of scoredProgrammes) {
            if (programme.start <= untilTime && programme.e > now) {
              results.push({
                ...programme,
                epgUrl: epg.url,
                relevance: programme.score || 1.0 // Use score from JexiDB or default
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

    console.log(`🎯 Processed ${processedCategories.size} categories`)

    // Apply channel filtering using channelTermsIndex if available
    if (this.channelTermsIndex && Object.keys(this.channelTermsIndex).length > 0) {
      const relevantChannelNames = Object.keys(this.channelTermsIndex)
      
      const filteredResults = []
      for (const programme of results) {
        const channelName = programme.ch
        let isRelevantChannel = false
        
        // Check if channel name matches any relevant channel
        if (relevantChannelNames.includes(channelName)) {
          isRelevantChannel = true
        } else {
          // Try to translate numeric ID to real channel name
          try {
            const epgUrl = programme.epgUrl
            const epgInstance = this.epgs[epgUrl]
            
            if (epgInstance && typeof epgInstance.getChannelById === 'function') {
              const channelInfo = await epgInstance.getChannelById(channelName)
              if (channelInfo && channelInfo.name && relevantChannelNames.includes(channelInfo.name)) {
                isRelevantChannel = true
                programme.ch = channelInfo.name // Update to real name
              }
            }
          } catch (err) {
            // Ignore translation errors
          }
        }
        
        if (isRelevantChannel) {
          filteredResults.push(programme)
        } else {
          console.log(`🎯 Filtering out irrelevant channel: ${channelName} for programme: ${programme.t}`)
        }
      }
      
      console.log(`🎯 After channel relevance filter: ${filteredResults.length} programmes (removed ${results.length - filteredResults.length} irrelevant channels)`)
      results = filteredResults
    } else {
      // Fallback: filter out numeric-only channels when no channelTermsIndex
      const filteredResults = results.filter(programme => {
        const channelName = programme.ch
        const isNumericOnly = /^\d+$/.test(channelName)
        
        if (isNumericOnly) {
          console.log(`🎯 Filtering out numeric channel: ${channelName} for programme: ${programme.t}`)
          return false
        }
        return true
      })
      
      console.log(`🎯 After numeric filter: ${filteredResults.length} programmes (removed ${results.length - filteredResults.length} numeric channels)`)
      results = filteredResults
    }
    
    // Remove duplicates by title only, preferring non-numeric channel names
    const programmeMap = new Map()
    
    for (const programme of results) {
      const title = programme.t
      const channelName = programme.ch
      
      // Check if we already have this title
      if (programmeMap.has(title)) {
        const existing = programmeMap.get(title)
        const existingChannel = existing.ch
        
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
          // Both are same type (numeric or non-numeric) - keep higher relevance
          if ((programme.relevance || 0) > (existing.relevance || 0)) {
            programmeMap.set(title, programme)
          }
        }
      } else {
        // First occurrence of this title
        programmeMap.set(title, programme)
      }
    }
    
    const uniqueResults = Array.from(programmeMap.values())
    
    // Sort by relevance score (highest first)
    uniqueResults.sort((a, b) => (b.relevance || 0) - (a.relevance || 0))

    console.log(`🎯 Found ${uniqueResults.length} unique programmes, returning top ${limit}`)
    return uniqueResults.slice(0, limit)
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
          const hasCategories = sampleProgrammes.some(p => p.c && Array.isArray(p.c) && p.c.length > 0)
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
        const query = { e: { '>': now }, start: { '<=': now + 3600 } } // Next hour
        const programmes = await db.find(query, { sort: { start: 1 } })

        for (const programme of programmes) {
          // Try to get real channel name from ID, fallback to prepared name
          let channelName
          try {
            const epgInstance = this.epgs[url]
            if (epgInstance && typeof epgInstance.getChannelById === 'function') {
              const channelInfo = await epgInstance.getChannelById(programme.ch)
              channelName = channelInfo.name || programme.ch
            } else {
              console.warn(`EPG instance not available or getChannelById not found for ${url}`)
              channelName = programme.ch
            }
          } catch (err) {
            console.warn(`Error getting channel name for ${programme.ch}:`, err.message)
            channelName = programme.ch
          }

          // Clean channel name for display
          const cleanChannelName = channelName.replace(/[^\w\s-]/g, '').trim()

          // Process categories
          if (programme.c && Array.isArray(programme.c) && programme.c.length > 0) {
            for (const category of programme.c) {
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
    console.log('🎯 getAllCurrentProgrammes() called')

    const now = Date.now() / 1000
    const allProgrammes = []

    console.log(`🎯 Checking ${Object.keys(this.epgs).length} EPGs for current programmes (now: ${now})`)

    for (const url in this.epgs) {
      const epg = this.epgs[url]
      
      // Skip EPGs that are not loaded
      if (epg.readyState !== 'loaded') {
        console.log(`🎯 Skipping EPG ${url}: not loaded (readyState: ${epg.readyState})`)
        continue
      }
      
      const db = epg.db
      if (!db) {
        console.log(`🎯 Skipping EPG ${url}: no database`)
        continue
      }
      
      try {
        // Ensure database is initialized
        if (!db.initialized) {
          console.log(`🎯 Initializing database for EPG ${url}`)
          await db.init().catch(err => {
            console.error(`Failed to init db for getAllCurrentProgrammes (${url}):`, err)
            return
          })
        }

        console.log(`🎯 Processing EPG ${url}: readyState=${epg.readyState}, length=${db.length}`)

        // Get all programmes that are currently live using JexiDB syntax
        const query = { start: { '<=': now }, e: { '>': now } }
        const programmes = await db.find(query, { sort: { start: 1 } })
        
        console.log(`🎯 EPG ${url}: found ${programmes.length} current programmes`)

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

    console.log(`🎯 Total current programmes found: ${allProgrammes.length}`)
    return allProgrammes
  }

}

// Export EPG class as well for backwards compatibility
// EPGManager.EPG = EPG  // Commented out - EPG not imported

// EPGManager is already exported as default class above
