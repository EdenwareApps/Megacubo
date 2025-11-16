import { Database } from 'jexidb'
import { PROGRAMME_DB_OPTS, METADATA_DB_OPTS } from '../config.js'

export class DatabaseFactory {
  static createProgrammeDB(path, opts = {}, clear = false) {
    const finalOpts = {
      ...PROGRAMME_DB_OPTS,
      ...opts,
      clear
    }
    return new Database(path, finalOpts)
  }

  static createMetadataDB(path, opts = {}, clear = false) {
    const finalOpts = {
      ...METADATA_DB_OPTS,
      ...opts,
      clear
    }
    return new Database(path, finalOpts)
  }

  static async initializeDB(dbInstance) {
    if (!dbInstance.initialized) {
      await dbInstance.init()
      
      // CRITICAL: Verify if JexiDB exposes normalizedFile after init()
      if (!dbInstance.normalizedFile) {
        console.warn('⚠️ JexiDB Database does not expose normalizedFile property after init()')
        console.warn(`⚠️ This may cause issues if save() is called without valid file path`)
      }
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
