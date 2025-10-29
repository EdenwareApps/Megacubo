// Centralized error handling and logging
import { stringify } from '../serialize/serialize.js'

export class EPGErrorHandler {
  static debugMode = false
  static errorCount = 0
  static warningCount = 0
  static maxErrors = 100
  static logHistory = []
  
  static setDebugMode(enabled) {
    this.debugMode = enabled
  }
  
  static debug(message, data = null) {
    if (this.debugMode) {
      console.log(`🔍 EPG: ${message}`)
      if (data !== null) {
        try {
          console.log(stringify(data))
        } catch (err) {
          console.log('[Data serialization failed]')
        }
      }
      this._addToHistory('debug', message, data)
    }
  }
  
  static info(message, data = null) {
    console.log(`ℹ️ EPG: ${message}`)
    if (data && this.debugMode) {
      try {
        console.log(stringify(data))
      } catch (err) {
        console.log('[Data serialization failed]')
      }
    }
    this._addToHistory('info', message, data)
  }
  
  static warn(message, data = null) {
    this.warningCount++
    console.warn(`⚠️ EPG: ${message}`)
    if (data) {
      try {
        console.warn(stringify(data))
      } catch (err) {
        console.warn('[Data serialization failed]')
      }
    }
    this._addToHistory('warn', message, data)
  }
  
  static error(message, error = null) {
    this.errorCount++
    console.error(`❌ EPG: ${message}`)
    if (error) {
      // CRITICAL: Use safe stringify that handles circular references and instances
      // This prevents "Cannot read properties of null (reading 'enqueue')" errors
      // when JSON.stringify in worker.mjs tries to serialize destroyed queue references
      try {
        console.error(stringify(error))
      } catch (err) {
        // Fallback to basic string conversion if stringify fails
        console.error(String(error))
      }
    }
    this._addToHistory('error', message, error)
  }
  
  static async safeExecute(operation, context = '') {
    try {
      return await operation()
    } catch (err) {
      this.error(`Error in ${context}:`, err)
      throw err
    }
  }
  
  static async safeExecuteWithFallback(operation, fallback, context = '') {
    try {
      return await operation()
    } catch (err) {
      this.warn(`Error in ${context}, using fallback:`, err.message)
      return fallback
    }
  }
  
  static async safeExecuteWithRetry(operation, context = '', maxRetries = 3, delay = 1000) {
    let lastError
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        return await operation()
      } catch (err) {
        lastError = err
        
        if (attempt < maxRetries) {
          this.warn(`Attempt ${attempt}/${maxRetries} failed in ${context}, retrying in ${delay}ms:`, err.message)
          await new Promise(resolve => setTimeout(resolve, delay))
          delay *= 2 // Exponential backoff
        }
      }
    }
    
    this.error(`All ${maxRetries} attempts failed in ${context}:`, lastError)
    throw lastError
  }
  
  static _addToHistory(level, message, data) {
    const entry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      data: data ? (typeof data === 'object' ? JSON.stringify(data) : data) : null
    }
    
    this.logHistory.push(entry)
    
    // Keep only recent entries to prevent memory leaks
    if (this.logHistory.length > this.maxErrors) {
      this.logHistory.shift()
    }
  }
  
  static getStats() {
    return {
      errorCount: this.errorCount,
      warningCount: this.warningCount,
      debugMode: this.debugMode,
      historyLength: this.logHistory.length
    }
  }
  
  static getLogHistory(level = null, limit = 50) {
    let history = this.logHistory
    
    if (level) {
      history = history.filter(entry => entry.level === level)
    }
    
    return history.slice(-limit)
  }
  
  static clearStats() {
    this.errorCount = 0
    this.warningCount = 0
    this.logHistory = []
  }
  
  static isHealthy() {
    return this.errorCount < 10 && this.warningCount < 50
  }
}
