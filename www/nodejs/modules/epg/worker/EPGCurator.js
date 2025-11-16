import { EPGErrorHandler } from './EPGErrorHandler.js'
import fs from 'fs'
import path from 'path'

/**
 * EPG Data Curator - Handles data curation for EPG programmes
 * - Detects and merges duplicate programmes
 * - Cleans up bad categories
 */
export class EPGCurator {
  constructor(tempDir = 'temp') {
    this.programmeCache = new Map() // For detecting duplicates by title
  }
  
  // badCategoryPatterns and shouldExcludeCategory() removed - not needed without training


  /**
   * Detect and merge duplicate programmes (same title)
   * Only merges categories and icons, keeps separate time slots
   * @param {Database} db - JexiDB database instance
   * @returns {number} Number of duplicate programmes removed
   */
  async detectAndMergeDuplicateProgrammes(db) {
    // CRITICAL: Check if database is still valid before processing
    if (!db || db.destroyed || !db.initialized) {
      console.warn('Skipping duplicate detection - database destroyed or not initialized')
      return 0
    }

    const titleMap = new Map() // normalizedTitle -> [programmes]
    let duplicatesRemoved = 0
    const batchSize = 50 // Process duplicates in batches
    let duplicateBatches = []
    
    try {
      // Starting batch duplicate detection...
      
      // First pass: group programmes by normalized title
      for await (const programme of db.walk()) {
        // CRITICAL: Check database state during processing
        if (!db || db.destroyed || !db.initialized) {
          console.warn('Database became invalid during duplicate detection, stopping...')
          break
        }
        const normalizedTitle = this.normalizeTitle(programme.title)
        
        if (!titleMap.has(normalizedTitle)) {
          titleMap.set(normalizedTitle, [])
        }
        titleMap.get(normalizedTitle).push(programme)
      }
      
      // Second pass: collect duplicates into batches
      for (const [title, programmes] of titleMap.entries()) {
        if (programmes.length > 1) {
          duplicateBatches.push({ title, programmes })
          
          // Process batch when it reaches batchSize
          if (duplicateBatches.length >= batchSize) {
            const batchRemoved = await this.processDuplicateBatch(db, duplicateBatches)
            duplicatesRemoved += batchRemoved
            duplicateBatches = []
            
            // Processed duplicate batch
          }
        }
      }
      
      // Process remaining duplicates in the last batch
      if (duplicateBatches.length > 0) {
        const batchRemoved = await this.processDuplicateBatch(db, duplicateBatches)
        duplicatesRemoved += batchRemoved
      }
      
      console.log(`🔄 DUPLICATES: ${duplicatesRemoved} duplicate programmes removed`)
      return duplicatesRemoved
    } catch (err) {
      console.error('Error in batch duplicate detection:', err)
      return 0
    }
  }

  async processDuplicateBatch(db, duplicateBatches) {
    // CRITICAL: Check if database is still valid before processing
    if (!db || db.destroyed || !db.initialized) {
      console.warn('Skipping duplicate batch processing - database destroyed or not initialized')
      return 0
    }

    let batchRemoved = 0
    
    try {
      for (const { title, programmes } of duplicateBatches) {
        // CRITICAL: Check database state before each batch
        if (!db || db.destroyed || !db.initialized) {
          console.warn('Database became invalid during batch processing, stopping...')
          break
        }
        // Found duplicates for title
        
        // Keep the first programme, merge data from others
        const firstProgramme = programmes[0]
        const mergedCategories = [...new Set(programmes.flatMap(p => p.categories || []))]
        const mergedIcons = [...new Set(programmes.map(p => p.icon).filter(Boolean))]
        
        // Update first programme with merged data
        const updateData = {}
        if (mergedCategories.length > 0) {
          updateData.categories = mergedCategories
        }
        if (mergedIcons.length > 0) {
          updateData.icon = mergedIcons[0] // Use first available icon
        }
        
        if (Object.keys(updateData).length > 0) {
          // CRITICAL: Check database state before update
          if (!db || db.destroyed || !db.initialized) {
            console.warn('Database became invalid before update, skipping...')
            break
          }
          await db.update(
            { title: firstProgramme.title, channel: firstProgramme.channel, start: firstProgramme.start },
            updateData
          )
          // Updated programme with merged data
        }
        
        // Delete duplicate programmes (all except the first one)
        for (let i = 1; i < programmes.length; i++) {
          // CRITICAL: Check database state before each delete
          if (!db || db.destroyed || !db.initialized) {
            console.warn('Database became invalid during delete operations, stopping...')
            break
          }
          const duplicateProgramme = programmes[i]
          await db.delete({ 
            title: duplicateProgramme.title, 
            channel: duplicateProgramme.channel, 
            start: duplicateProgramme.start 
          })
          batchRemoved++
        }
      }
      
      // Save batch updates
      // CRITICAL: Check database state before save
      if (!db || db.destroyed || !db.initialized) {
        console.warn('Database became invalid before save, skipping...')
        return batchRemoved
      }
      await db.save()
      // Processed duplicate batch
    } catch (err) {
      console.error('Error processing duplicate batch:', err)
    }
    
    return batchRemoved
  }

  /**
   * Normalize programme title for duplicate detection
   * @param {string} title - Programme title
   * @returns {string} Normalized title
   */
  normalizeTitle(title) {
    if (!title || typeof title !== 'string') return ''
    
    return title
      .toLowerCase()
      .trim()
      .replace(/[^\w\s]/g, '') // Remove special characters
      .replace(/\s+/g, ' ')    // Normalize whitespace
      .trim()
  }

  /**
   * Perform complete data curation process
   * @param {Database} db - JexiDB database instance
   * @returns {Object} Curation results
   */
  async performCuration(db) {
    // Icons-only fallback curation
    if (!db || db.destroyed || !db.initialized) {
      console.warn('Skipping curation - database destroyed or not initialized')
      return { iconsFilled: 0 }
    }

    console.log('🎨 Starting EPG data curation (icons only)...')
    const localIndex = new Map()

    try {
      // Build local index (title -> icons) as fallback
      for await (const p of db.walk()) {
        const key = this.normalizeTitle(p.title)
        if (!key) continue
        if (!localIndex.has(key)) localIndex.set(key, new Set())
        if (p?.icon) localIndex.get(key).add(p.icon)
      }

      const iconsFilled = await this.fillMissingIcons(db, localIndex)
      return { iconsFilled }
    } catch (err) {
      console.error('❌ Error during icons-only curation:', err)
      throw err
    }
  }

  async fillMissingIcons(db, crossIconIndex, filePath = null) {
    if (!db || db.destroyed || !db.initialized) return 0
    
    // CRITICAL: Log initial state
    const initialFilePath = db.normalizedFile || filePath || undefined
    const initialLength = db.length
    console.log(`🔍 fillMissingIcons START: length=${initialLength}, filePath=${initialFilePath || 'undefined'}, initialized=${db.initialized}`)
    
    let iconsFilled = 0
    let processedCount = 0
    try {
      // CRITICAL: Check database state before iterate
      if (!db || db.destroyed || !db.initialized) {
        console.error('🚨 FLAG: Database invalid before iterate()')
        return 0
      }
      
      // Use iterate() instead of walk() + update() for better performance
      for await (const p of db.iterate({ icon: '' })) {
        // CRITICAL: Check database state during iteration
        if (!db || db.destroyed || !db.initialized) {
          console.error('🚨 FLAG: Database became invalid during iterate() iteration')
          break
        }
        
        processedCount++
        
        // CRITICAL: Check if length changed during iteration
        const currentLength = db.length
        if (currentLength !== initialLength) {
          console.error(`🚨 FLAG: Database length changed during iterate()! ${initialLength} → ${currentLength}`)
          const currentFilePath = db.normalizedFile || filePath
          console.error(`🚨 FLAG: filePath=${currentFilePath}, expected=${initialFilePath}`)
          if (currentFilePath !== initialFilePath) {
            console.error('🚨 FLAG: Database file path changed during iterate()!')
          }
        }
        
        const key = this.normalizeTitle(p.title)
        if (!key) continue
        
        const set = crossIconIndex?.get(key)
        const icon = set && set.size ? [...set][0] : ''
        
        if (icon) {
          // Direct modification with iterate() - no db.update() call needed
          p.icon = icon
          iconsFilled++
        }
      }

      // CRITICAL: Only save if we actually made changes AND database has valid file path
      const currentFilePath = filePath || db.normalizedFile
      if (iconsFilled > 0 && currentFilePath) {
        const beforeSaveLength = db.length
        if (!db || db.destroyed || !db.initialized) {
          console.error('🚨 FLAG: Database invalid before save()')
          return iconsFilled
        }
        
        console.log(`🔍 fillMissingIcons BEFORE save: length=${beforeSaveLength} (was ${initialLength}), iconsFilled=${iconsFilled}`)
        
        try {
          await db.save()
          
          // CRITICAL: Check database state after save
          const afterSaveLength = db.length
          const afterSaveFilePath = filePath || db.normalizedFile || undefined
          console.log(`🔍 fillMissingIcons AFTER save: length=${afterSaveLength} (was ${initialLength}), filePath=${afterSaveFilePath || 'undefined'}`)
          
          if (afterSaveLength !== initialLength) {
            console.error(`🚨 FLAG: Database length changed after save()! ${initialLength} → ${afterSaveLength}`)
            console.error(`🚨 FLAG: filePath changed? ${initialFilePath} → ${afterSaveFilePath}`)
          }
          
          if (afterSaveFilePath && afterSaveFilePath !== initialFilePath) {
            console.error(`🚨 FLAG: Database filePath changed after save()! ${initialFilePath} → ${afterSaveFilePath}`)
          }
        } catch (saveErr) {
          console.error('🚨 FLAG: Error during db.save():', saveErr.message)
          // Don't throw - icons were already updated in memory
        }
      } else {
        if (!currentFilePath) {
          console.warn(`⚠️ Skipping db.save() - database has no filePath (may be finalized database)`)
        } else if (iconsFilled === 0) {
          console.log(`ℹ️ No icons filled, skipping db.save()`)
        }
      }
      
    } catch (err) {
      console.error('🚨 FLAG: Error filling missing icons:', err)
      console.error(`🚨 FLAG: Database state at error: initialized=${db?.initialized}, destroyed=${db?.destroyed || false}, length=${db?.length}`)
    }
    return iconsFilled
  }
}
