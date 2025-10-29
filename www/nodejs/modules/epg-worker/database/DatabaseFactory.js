import { Database } from 'jexidb'
import { PROGRAMME_DB_OPTS, METADATA_DB_OPTS } from '../config.js'

export class DatabaseFactory {
  static createProgrammeDB(path, opts = {}, clear = false) {
    const finalOpts = {
      ...PROGRAMME_DB_OPTS,
      ...opts,
      clear,
      create: true,
      integrityCheck: 'none',
      maxWriteBufferSize: 64 * 1024,
      indexedQueryMode: 'loose',
      debugMode: false,
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
      indexes: ['ch', 'start', 'e', 'terms']
    }
    return new Database(path, finalOpts)
  }

  static createMetadataDB(path, opts = {}, clear = false) {
    const finalOpts = {
      ...METADATA_DB_OPTS,
      ...opts,
      clear,
      create: true,
      integrityCheck: 'none',
      maxWriteBufferSize: 32 * 1024,
      indexedQueryMode: 'loose',
      debugMode: false,
      fields: {
        _type: 'string',
        id: 'string',
        name: 'string',
        icon: 'string',
        terms: 'array:string',
        _created: 'number',
        key: 'string',
        value: 'string',
        timestamp: 'number'
      },
      indexes: ['_type', 'id', 'name']
    }
    return new Database(path, finalOpts)
  }

  static async initializeDB(dbInstance) {
    if (!dbInstance.initialized) {
      await dbInstance.init()
    }
    return dbInstance
  }

  static async recoverDB(dbInstance, path, opts, isMetadata = false) {
    try {
      if (dbInstance) {
        await dbInstance.destroy()
      }
    } catch (err) {
      console.warn('Could not destroy corrupted database:', err.message)
    }

    // Recreate database with clear flag
    if (isMetadata) {
      return this.createMetadataDB(path, opts, true)
    } else {
      return this.createProgrammeDB(path, opts, true)
    }
  }

  static async validateAndRepairDB(dbInstance, path, opts, isMetadata = false) {
    try {
      // Try to perform a simple operation to check if DB is working
      await dbInstance.count()
      return dbInstance
    } catch (err) {
      console.warn(`Database corruption detected, attempting recovery: ${err.message}`)
      return this.recoverDB(dbInstance, path, opts, isMetadata)
    }
  }
}
