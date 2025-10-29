import { EPG_CONFIG } from '../config.js'
import { EPGErrorHandler } from '../EPGErrorHandler.js'

export class MemoryMonitor {
  constructor(options = {}) {
    this.maxHeapSize = options.maxHeapSize || EPG_CONFIG.memory.maxHeapSize
    this.gcThreshold = options.gcThreshold || EPG_CONFIG.memory.gcThreshold
    this.forceGcInterval = options.forceGcInterval || EPG_CONFIG.memory.forceGcInterval
    
    this.isMonitoring = false
    this.monitorInterval = null
    this.callbacks = {
      onHighMemory: [],
      onCriticalMemory: [],
      onMemoryInfo: []
    }
  }

  startMonitoring() {
    if (this.isMonitoring) {
      EPGErrorHandler.warn('Memory monitor is already running')
      return
    }

    EPGErrorHandler.info('Starting memory monitoring...')
    this.isMonitoring = true

    this.monitorInterval = setInterval(() => {
      this.checkMemoryUsage()
    }, this.forceGcInterval)
  }

  stopMonitoring() {
    if (!this.isMonitoring) {
      return
    }

    EPGErrorHandler.info('Stopping memory monitoring...')
    this.isMonitoring = false

    if (this.monitorInterval) {
      clearInterval(this.monitorInterval)
      this.monitorInterval = null
    }
  }

  checkMemoryUsage() {
    if (typeof process === 'undefined' || !process.memoryUsage) {
      return null
    }

    const memUsage = process.memoryUsage()
    const heapUsed = memUsage.heapUsed
    const heapTotal = memUsage.heapTotal
    const heapPercent = (heapUsed / this.maxHeapSize) * 100

    const memInfo = {
      heapUsed,
      heapTotal,
      heapPercent,
      maxHeapSize: this.maxHeapSize,
      rss: memUsage.rss,
      external: memUsage.external,
      arrayBuffers: memUsage.arrayBuffers
    }

    // Emit memory info to registered callbacks
    this._emit('onMemoryInfo', memInfo)

    EPGErrorHandler.debug(
      `Memory usage: ${Math.round(heapUsed / 1024 / 1024)}MB / ${Math.round(this.maxHeapSize / 1024 / 1024)}MB (${heapPercent.toFixed(1)}%)`
    )

    // Check for critical memory usage (90%+)
    if (heapPercent >= 90) {
      EPGErrorHandler.error(`Critical memory usage detected: ${heapPercent.toFixed(1)}%`)
      this._emit('onCriticalMemory', memInfo)
      this.forceGarbageCollection()
    }
    // Check for high memory usage (threshold)
    else if (heapPercent >= (this.gcThreshold * 100)) {
      EPGErrorHandler.warn(`High memory usage detected: ${heapPercent.toFixed(1)}%`)
      this._emit('onHighMemory', memInfo)
      this.forceGarbageCollection()
    }

    return memInfo
  }

  forceGarbageCollection() {
    try {
      // Try to force garbage collection if available
      if (typeof global !== 'undefined' && global.gc) {
        EPGErrorHandler.info('Forcing garbage collection...')
        global.gc()
        
        // Check memory again after GC
        setTimeout(() => {
          const newMemUsage = this.getMemoryUsage()
          if (newMemUsage) {
            const reduction = Math.round((newMemUsage.heapUsed - process.memoryUsage().heapUsed) / 1024 / 1024)
            EPGErrorHandler.info(`Garbage collection completed. Memory freed: ${reduction}MB`)
          }
        }, 100)
      } else {
        EPGErrorHandler.warn('Garbage collection not available (global.gc not found)')
      }
    } catch (err) {
      EPGErrorHandler.error('Error during garbage collection:', err)
    }
  }

  getMemoryUsage() {
    if (typeof process !== 'undefined' && process.memoryUsage) {
      return process.memoryUsage()
    }
    return null
  }

  getMemoryInfo() {
    const memUsage = this.getMemoryUsage()
    if (!memUsage) return null

    const heapPercent = (memUsage.heapUsed / this.maxHeapSize) * 100

    return {
      heapUsed: memUsage.heapUsed,
      heapTotal: memUsage.heapTotal,
      heapPercent,
      maxHeapSize: this.maxHeapSize,
      rss: memUsage.rss,
      external: memUsage.external,
      arrayBuffers: memUsage.arrayBuffers,
      heapUsedMB: Math.round(memUsage.heapUsed / 1024 / 1024),
      heapTotalMB: Math.round(memUsage.heapTotal / 1024 / 1024),
      rssMB: Math.round(memUsage.rss / 1024 / 1024)
    }
  }

  isMemoryHigh() {
    const memUsage = this.getMemoryUsage()
    if (!memUsage) return false

    const heapPercent = (memUsage.heapUsed / this.maxHeapSize) * 100
    return heapPercent >= (this.gcThreshold * 100)
  }

  isMemoryCritical() {
    const memUsage = this.getMemoryUsage()
    if (!memUsage) return false

    const heapPercent = (memUsage.heapUsed / this.maxHeapSize) * 100
    return heapPercent >= 90
  }

  // Event system for memory callbacks
  onHighMemory(callback) {
    this.callbacks.onHighMemory.push(callback)
  }

  onCriticalMemory(callback) {
    this.callbacks.onCriticalMemory.push(callback)
  }

  onMemoryInfo(callback) {
    this.callbacks.onMemoryInfo.push(callback)
  }

  _emit(event, data) {
    const callbacks = this.callbacks[event] || []
    callbacks.forEach(callback => {
      try {
        callback(data)
      } catch (err) {
        EPGErrorHandler.error(`Error in memory monitor callback (${event}):`, err)
      }
    })
  }

  // Configuration methods
  setMaxHeapSize(size) {
    this.maxHeapSize = size
    EPGErrorHandler.info(`Memory monitor max heap size set to: ${Math.round(size / 1024 / 1024)}MB`)
  }

  setGcThreshold(threshold) {
    this.gcThreshold = threshold
    EPGErrorHandler.info(`Memory monitor GC threshold set to: ${(threshold * 100).toFixed(1)}%`)
  }

  setMonitorInterval(interval) {
    this.forceGcInterval = interval
    
    if (this.isMonitoring) {
      // Restart monitoring with new interval
      this.stopMonitoring()
      this.startMonitoring()
    }
    
    EPGErrorHandler.info(`Memory monitor interval set to: ${interval}ms`)
  }

  // Cleanup
  destroy() {
    EPGErrorHandler.info('Destroying memory monitor...')
    
    this.stopMonitoring()
    
    // Clear all callbacks
    this.callbacks.onHighMemory = []
    this.callbacks.onCriticalMemory = []
    this.callbacks.onMemoryInfo = []
  }
}
