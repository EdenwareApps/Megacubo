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
        const normalizedTitle = this.normalizeTitle(programme.t)
        
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
        const mergedCategories = [...new Set(programmes.flatMap(p => p.c || []))]
        const mergedIcons = [...new Set(programmes.map(p => p.i).filter(Boolean))]
        
        // Update first programme with merged data
        const updateData = {}
        if (mergedCategories.length > 0) {
          updateData.c = mergedCategories
        }
        if (mergedIcons.length > 0) {
          updateData.i = mergedIcons[0] // Use first available icon
        }
        
        if (Object.keys(updateData).length > 0) {
          // CRITICAL: Check database state before update
          if (!db || db.destroyed || !db.initialized) {
            console.warn('Database became invalid before update, skipping...')
            break
          }
          await db.update(
            { t: firstProgramme.t, ch: firstProgramme.ch, start: firstProgramme.start },
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
            t: duplicateProgramme.t, 
            ch: duplicateProgramme.ch, 
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
    // CRITICAL: Check if database is still valid before curation
    if (!db || db.destroyed || !db.initialized) {
      console.warn('Skipping curation - database destroyed or not initialized')
      return { duplicatesRemoved: 0 }
    }

    console.log('🎨 Starting EPG data curation...')
    
    const results = {
      duplicatesRemoved: 0
    }
    
    try {
      // Detect and merge duplicates
      // Detecting and merging duplicate programmes...
      results.duplicatesRemoved = await this.detectAndMergeDuplicateProgrammes(db)
      
      // 3. Save changes
      // CRITICAL: Check database state before final save
      if (!db || db.destroyed || !db.initialized) {
        console.warn('Database became invalid before final save, skipping...')
        return results
      }
      await db.save()
      
      console.log('✅ EPG data curation completed')
      return results
      
    } catch (err) {
      console.error('❌ Error during data curation:', err)
      throw err
    }
  }
}
