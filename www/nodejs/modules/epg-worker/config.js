// Centralized EPG configuration
export const EPG_CONFIG = {
  cache: {
    ttl: 3600,
    minExpectedEntries: 72,
    dataLiveWindow: 72 * 3600,
    maxCacheSize: 5000, // Limit cache size to prevent memory issues
    cleanupInterval: 300000 // 5 minutes
  },
  network: {
    timeout: 30,
    retries: 2,
    errorCountLimit: 128
  },
  update: {
    autoUpdateIntervalSecs: 1800,
    maxSuggestedEPGs: 5, // Increased to allow more fallback attempts
    maxManualEPGs: Infinity
  },
  memory: {
    maxHeapSize: 512 * 1024 * 1024, // 512MB limit
    gcThreshold: 0.8, // Trigger GC at 80% heap usage
    forceGcInterval: 60000 // Force GC every minute
  }
}

// Database configuration options - OPTIMIZED with InsertSession
export const PROGRAMME_DB_OPTS = {
  create: true,
  integrityCheck: 'none',    // skip integrity check on init for speed
  maxWriteBufferSize: 64 * 1024, // DRASTICALLY reduced to 64KB
  indexedQueryMode: 'loose', // Use loose mode to allow non-indexed field queries
  debugMode: false,          // Disable debug mode for production
  fields: {
    ch: 'string',           // Channel name
    start: 'number',         // Start timestamp
    e: 'number',            // End timestamp
    t: 'string',            // Title
    i: 'string',            // Icon/Image URL
    desc: 'string',         // Description
    c: 'array:string',      // Categories
    terms: 'array:string', // Search terms (includes programme title, channel name, and categories)
    // EPG-specific metadata fields
    age: 'number',          // Age rating (0 = default, no restriction)
    lang: 'string',         // Language (ISO 639-1)
    country: 'string',      // Country (ISO 3166-1)
    rating: 'string',       // Rating system (BR, MPAA, TVPG)
    parental: 'string',     // Parental control (yes/no)
    genre: 'string',        // Genre/category
    contentType: 'string',  // Content type (adult, kids, etc.)
    parentalLock: 'string', // Parental lock (true/false)
    geo: 'string',          // Geographic region
    ageRestriction: 'string' // Age restriction
  },
  indexes: ['ch', 'start', 'e', 'terms'] // Only the fields we want to index
  // compression: true and persistentIndexes: true are now JexiDB defaults
}

export const METADATA_DB_OPTS = {
  create: true,
  integrityCheck: 'none',    // skip integrity check on init for speed
  maxWriteBufferSize: 32 * 1024, // DRASTICALLY reduced to 32KB for metadata
  indexedQueryMode: 'loose', // Use loose mode to allow non-indexed field queries
  debugMode: false,          // Disable debug mode for production
  caseSensitive: false,
  batchSize: 32,
  indexing: 'async',
  compression: true,
  fields: {
    _type: 'string',        // Type: 'channel', 'terms', 'index', etc.
    id: 'string',           // Channel/term ID
    name: 'string',         // Channel/term name
    icon: 'string',         // Channel icon URL
    terms: 'array:string',  // Search terms array
    _created: 'number',      // Creation timestamp
    key: 'string',          // Control key name
    value: 'string',        // Control key value
    timestamp: 'number'      // Control key timestamp
  },
  indexes: ['_type', 'id', 'name'] // Only the fields we want to index
  // compression: true and persistentIndexes: true are now JexiDB defaults
}
