import fs from 'fs'
import path from 'path'
import { findSyncBytePosition } from '../../utils/utils.js'

/**
 * FileWarmCache - Stores warmCache data 100% on disk to save memory
 * 
 * This implementation avoids keeping large buffers in memory, instead
 * writing all data directly to a temporary file. This prevents OOM issues
 * when multiple streams are active simultaneously.
 */
export default class FileWarmCache {
    constructor(opts = {}) {
        this.tempDir = opts.tempDir || opts.temp
        this.maxSize = opts.warmCacheMaxMaxSize || 6 * (8192 * 1024) // 48MB default
        this.maxSizeNormal = opts.warmCacheMaxSize || 6 * (4096 * 1024) // 24MB default
        this.filePath = null
        this.writeStream = null
        this.fileSize = 0
        this.rotating = false
        this.committed = false
        this.bitrateChecker = opts.bitrateChecker
        this.minimalWarmCacheBitrateCheck = false
        this.onDestroy = opts.onDestroy
        
        // Ensure temp directory exists
        try {
            if (!fs.existsSync(this.tempDir)) {
                fs.mkdirSync(this.tempDir, { recursive: true })
            }
        } catch (err) {
            console.error('FileWarmCache: Failed to create temp directory:', err.message)
        }
        
        // Create unique file name
        this.filePath = path.join(this.tempDir, `warmcache-${Date.now()}-${Math.random().toString(36).substr(2, 9)}.ts`)
        
        // Initialize write stream
        try {
            this.writeStream = fs.createWriteStream(this.filePath)
            this.writeStream.on('error', (err) => {
                console.error('FileWarmCache write error:', err.message)
            })
        } catch (err) {
            console.error('FileWarmCache: Failed to create write stream:', err.message)
        }
    }
    
    /**
     * Get current length (file size)
     */
    get length() {
        return this.fileSize
    }
    
    /**
     * Append data to the cache file
     */
    append(data) {
        if (!this.writeStream || !this.filePath) {
            return
        }
        
        if (!Buffer.isBuffer(data)) {
            data = Buffer.from(data)
        }
        
        if (data.length === 0) {
            return
        }
        
        try {
            this.writeStream.write(data)
            this.fileSize += data.length
            
            // Check if bitrate sample is needed
            if (!this.minimalWarmCacheBitrateCheck && this.committed && this.bitrateChecker && this.bitrateChecker.acceptingSamples(this.fileSize)) {
                this.minimalWarmCacheBitrateCheck = true
                this._saveBitrateSample()
            }
            
            // Rotate if needed
            if (this.fileSize > this.maxSizeNormal && !this.rotating) {
                this.rotate()
            }
        } catch (err) {
            console.error('FileWarmCache append error:', err.message)
        }
    }
    
    /**
     * Rotate cache - keep only the most recent 75% of data
     */
    rotate() {
        if (this.rotating || this.fileSize < this.maxSizeNormal) {
            return
        }
        
        this.rotating = true
        
        const desiredSize = this.maxSizeNormal * 0.75 // Keep 75% to avoid running too frequently
        const startPosition = this.fileSize - desiredSize
        
        // Close write stream first to ensure all data is written
        if (this.writeStream) {
            const oldWriteStream = this.writeStream
            this.writeStream = null
            
            oldWriteStream.end(() => {
                // Read file after write stream is closed
                fs.readFile(this.filePath, (err, data) => {
                    if (err) {
                        console.error('FileWarmCache rotate read error:', err.message)
                        this.rotating = false
                        // Recreate write stream even on error
                        try {
                            this.writeStream = fs.createWriteStream(this.filePath, { flags: 'a' })
                            this.writeStream.on('error', (err) => {
                                console.error('FileWarmCache write stream error:', err.message)
                            })
                        } catch (err) {
                            console.error('FileWarmCache: Failed to recreate write stream:', err.message)
                        }
                        return
                    }
                    
                    if (data.length < startPosition) {
                        this.rotating = false
                        // Recreate write stream
                        try {
                            this.writeStream = fs.createWriteStream(this.filePath, { flags: 'a' })
                            this.writeStream.on('error', (err) => {
                                console.error('FileWarmCache write stream error:', err.message)
                            })
                        } catch (err) {
                            console.error('FileWarmCache: Failed to recreate write stream:', err.message)
                        }
                        return
                    }
                    
                    // Find sync byte position from start position
                    const syncBytePosition = findSyncBytePosition(data, startPosition)
                    
                    if (syncBytePosition === -1) {
                        console.warn('FileWarmCache: SYNC_BYTE not found during rotation, clearing cache')
                        this.clear()
                        this.rotating = false
                        return
                    }
                    
                    // Keep only data from sync byte position onwards
                    const newData = data.slice(syncBytePosition)
                    
                    // Write back to file
                    const tempFilePath = this.filePath + '.tmp'
                    fs.writeFile(tempFilePath, newData, (writeErr) => {
                        if (writeErr) {
                            console.error('FileWarmCache rotate write error:', writeErr.message)
                            this.rotating = false
                            // Recreate write stream even on error
                            this.writeStream = fs.createWriteStream(this.filePath, { flags: 'a' })
                            this.writeStream.on('error', (err) => {
                                console.error('FileWarmCache write stream error:', err.message)
                            })
                            return
                        }
                        
                        // Replace original file
                        fs.rename(tempFilePath, this.filePath, (renameErr) => {
                            if (renameErr) {
                                console.error('FileWarmCache rotate rename error:', renameErr.message)
                                fs.unlink(tempFilePath, () => {}) // Clean up temp file
                                this.rotating = false
                                // Recreate write stream even on error
                                this.writeStream = fs.createWriteStream(this.filePath, { flags: 'a' })
                                this.writeStream.on('error', (err) => {
                                    console.error('FileWarmCache write stream error:', err.message)
                                })
                                return
                            }
                            
                            // Recreate write stream to append to the rotated file
                            try {
                                this.writeStream = fs.createWriteStream(this.filePath, { flags: 'a' })
                                this.writeStream.on('error', (err) => {
                                    console.error('FileWarmCache write stream error after rotate:', err.message)
                                })
                            } catch (err) {
                                console.error('FileWarmCache: Failed to recreate write stream after rotate:', err.message)
                            }
                            this.fileSize = newData.length
                            this.rotating = false
                            
                            // Verify sync byte is at position 0
                            const verifySync = findSyncBytePosition(newData, 0)
                            if (verifySync !== 0) {
                                console.warn('FileWarmCache: SYNC_BYTE not at position 0 after rotation, this may indicate an error')
                            }
                        })
                    })
                })
            })
        } else {
            this.rotating = false
        }
    }
    
    /**
     * Save bitrate sample (for bitrate checking)
     */
    _saveBitrateSample() {
        if (!this.filePath || !fs.existsSync(this.filePath)) {
            return
        }
        
        fs.readFile(this.filePath, (err, data) => {
            if (err || !data || data.length === 0) {
                return
            }
            
            const sampleFile = path.join(this.tempDir, `${Date.now()}-${Math.random().toString(36).substr(2, 9)}.ts`)
            fs.writeFile(sampleFile, data, (writeErr) => {
                if (writeErr) {
                    return
                }
                
                if (this.bitrateChecker) {
                    this.bitrateChecker.addSample(sampleFile, this.fileSize, true)
                }
            })
        })
    }
    
    /**
     * Get cache data as Buffer (reads from file)
     * Returns a promise that resolves with the buffer
     */
    async getSlice() {
        if (!this.filePath || !fs.existsSync(this.filePath)) {
            return Buffer.alloc(0)
        }
        
        try {
            const data = await fs.promises.readFile(this.filePath)
            return data
        } catch (err) {
            console.error('FileWarmCache getSlice error:', err.message)
            return Buffer.alloc(0)
        }
    }
    
    /**
     * Get cache data synchronously (for compatibility)
     * WARNING: This blocks the event loop for large files
     */
    slice() {
        if (!this.filePath || !fs.existsSync(this.filePath)) {
            return Buffer.alloc(0)
        }
        
        try {
            return fs.readFileSync(this.filePath)
        } catch (err) {
            console.error('FileWarmCache slice error:', err.message)
            return Buffer.alloc(0)
        }
    }
    
    /**
     * Clear cache
     */
    clear() {
        if (this.writeStream) {
            this.writeStream.destroy()
            this.writeStream = null
        }
        
        if (this.filePath && fs.existsSync(this.filePath)) {
            try {
                fs.unlinkSync(this.filePath)
            } catch (err) {
                // Ignore errors if file doesn't exist
            }
        }
        
        // Ensure temp directory exists
        try {
            if (!fs.existsSync(this.tempDir)) {
                fs.mkdirSync(this.tempDir, { recursive: true })
            }
        } catch (err) {
            console.error('FileWarmCache: Failed to create temp directory:', err.message)
        }
        
        // Recreate file and stream for continued use
        this.filePath = path.join(this.tempDir, `warmcache-${Date.now()}-${Math.random().toString(36).substr(2, 9)}.ts`)
        try {
            this.writeStream = fs.createWriteStream(this.filePath)
            this.writeStream.on('error', (err) => {
                console.error('FileWarmCache write stream error:', err.message)
            })
        } catch (err) {
            console.error('FileWarmCache: Failed to create write stream:', err.message)
        }
        
        this.fileSize = 0
        this.minimalWarmCacheBitrateCheck = false
    }
    
    /**
     * Destroy cache and cleanup
     */
    destroy() {
        this.clear()
        
        if (this.onDestroy) {
            this.onDestroy()
        }
    }
    
    /**
     * Set committed flag (stream is committed/active)
     */
    setCommitted(committed) {
        this.committed = committed
    }
    
    /**
     * Update max size based on bitrate
     */
    updateMaxSize(bitrate, warmCacheSeconds, warmCacheMinSize, warmCacheMaxMaxSize) {
        const newMaxSize = Math.min(
            Math.max(warmCacheMinSize, bitrate * warmCacheSeconds),
            warmCacheMaxMaxSize
        )
        
        if (typeof newMaxSize === 'number' && !isNaN(newMaxSize)) {
            this.maxSizeNormal = newMaxSize
        }
    }
}

