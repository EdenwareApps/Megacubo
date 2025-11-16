import { Parser } from 'xmltv-stream'
import Download from '../../../download/download.js'
import Mag from '../../../lists/mag.js'
import zlib from 'zlib'
import { EPG_CONFIG } from '../config.js'
import { EPGErrorHandler } from '../EPGErrorHandler.js'
import { time } from '../../../utils/utils.js'

export class ParserFactory {
  // Helper function to ensure errors are Error objects
  static _normalizeError(err) {
    if (err instanceof Error) {
      return err
    }
    if (typeof err === 'string') {
      return new Error(err)
    }
    return new Error(String(err))
  }

  static createXMLParser(url, callbacks, options = {}) {
    const { onProgramme, onChannel, onError, onProgress } = callbacks
    const { debug = false, ttl = 3600 } = options

    const parser = new Parser({ timestamps: true })
    
    // Create download request configuration
    const req = {
      debug: true,
      url,
      followRedirect: true,
      keepalive: false,
      retries: EPG_CONFIG.network.retries,
      timeout: EPG_CONFIG.network.timeout, // Timeout in seconds (already configured as seconds)
      headers: { 'accept-charset': 'utf-8, *;q=0.1' },
      encoding: 'utf8',
      cacheTTL: 0, // Cache disabled
      responseType: 'text'
    }

    // Add If-Modified-Since header if lastModified is provided in callbacks
    if (callbacks.lastModified) {
      req.headers['If-Modified-Since'] = callbacks.lastModified
      EPGErrorHandler.debug('Added If-Modified-Since header:', callbacks.lastModified)
    }

    const request = new Download(req)
    let validEPG = false
    let lastModifiedAt = null

    // Setup response handler to capture headers
    request.on('response', (response) => {
      if (response.headers && response.headers['last-modified']) {
        lastModifiedAt = response.headers['last-modified']
        EPGErrorHandler.debug('Last-Modified header received:', lastModifiedAt)
      }
      
      // Set status code for debugging
      if (callbacks.onStatus) {
        callbacks.onStatus(response.statusCode)
      }
      
      // Check if content is not modified (304)
      if (response.statusCode === 304) {
        EPGErrorHandler.info('Content not modified (304), skipping download')
        if (callbacks.onNotModified) {
          callbacks.onNotModified()
        }
        return
      }
    })

    // Add debug logging for parser events
    parser.on('data', (chunk) => {
      EPGErrorHandler.debug('Parser received data chunk:', chunk.length, 'bytes')
    })
    
    parser.on('error', (err) => {
      EPGErrorHandler.error('Parser stream error:', err)
    })
    
    // CRITICAL FIX: Add protection against SAXStream displayName crash
    parser.on('close', () => {
      EPGErrorHandler.debug('Parser stream closed')
    })
    
    // Add protection for SAXStream internal events
    const originalEmit = parser.emit
    parser.emit = function(event, ...args) {
      try {
        return originalEmit.apply(this, arguments)
      } catch (err) {
        if (err.message && err.message.includes('displayName')) {
          EPGErrorHandler.warn('SAXStream displayName error caught and ignored:', err.message)
          return false
        }
        throw err
      }
    }
    
    // Setup parser event handlers
    parser.on('programme', programme => {
      if (programme?.channel && programme?.title?.length) {
        if (!validEPG) {
          validEPG = true
          EPGErrorHandler.info('First valid programme received, EPG is valid')
        }

        // DEBUG: Log raw programme data to check Unicode handling
        if (debug && programme.title && programme.title.some(title => title.includes('u00'))) {
          EPGErrorHandler.debug('UNICODE DEBUG - Raw programme from xmltv-stream:', JSON.stringify(programme, null, 2))
        }

        const now = time()
        const endTimestamp = programme.end // Already converted to Unix timestamp by xmltv-stream
        
        
         // CRITICAL FIX: Accept ONLY current and future programmes (endTimestamp >= now)
         if (endTimestamp < now) {
            return
         }
        
        // Process only current and future programmes
        onProgramme(programme).catch(err => EPGErrorHandler.error('Programme processing error:', err))
      } else {
        EPGErrorHandler.info('Skipping invalid programme - missing channel or title:', programme)
      }
    })
    
    parser.on('channel', ch => {
      // Debug logging disabled to reduce verbosity
      // if (!parser._channelCount) parser._channelCount = 0
      // parser._channelCount++
      // if (parser._channelCount % 200 === 0) {
      //   EPGErrorHandler.debug('Parser received channel:', ch?.name || ch?.id)
      // }
      onChannel(ch).catch(err => EPGErrorHandler.error('Channel processing error:', err))
    })
    parser.on('error', err => {
      EPGErrorHandler.error('Parser error:', err)
      onError(ParserFactory._normalizeError(err))
    })
    
    parser.on('end', () => {
      EPGErrorHandler.info('Parser ended, triggering finalization')
      // Trigger finalization when parser ends
      if (callbacks.onEnd) {
        callbacks.onEnd()
      }
    })

    // Setup download event handlers
    const receivedRef = { value: 0 }
    this._setupDownloadEventHandlers(request, parser, onError, onProgress, receivedRef, url)

    return { 
      parser, 
      request, 
      start: () => {
        EPGErrorHandler.info('Starting XML parser download...')
        request.start()
      },
      isValid: () => validEPG,
      getReceived: () => receivedRef.value,
      getLastModified: () => lastModifiedAt,
      destroy: () => {
        if (request) {
          request.destroy()
        }
        if (parser) {
          parser.end()
        }
      }
    }
  }

  static createMAGParser(url, callbacks, options = {}) {
    const { onProgramme, onChannel, onError } = callbacks
    
    EPGErrorHandler.info('Using MAG parser for:', url)
    const parser = new Mag.EPG(url)
    
    // Setup event handlers
    parser.on('programme', programme => {
      if (programme?.channel && programme?.title?.length) {
        const now = time()
        const endTimestamp = programme.end // Already converted to Unix timestamp by xmltv-stream
        const sevenDaysAgo = now - (7 * 24 * 60 * 60) // 7 days in seconds

        if (endTimestamp < sevenDaysAgo) {
          return // Skip programmes that ended more than 7 days ago
        }

        onProgramme(programme).catch(err => EPGErrorHandler.error('Programme processing error:', err))
      }
    })
    
    parser.on('channel', ch => {
      // Debug logging disabled to reduce verbosity
      // if (!parser._channelCount) parser._channelCount = 0
      // parser._channelCount++
      // if (parser._channelCount % 200 === 0) {
      //   EPGErrorHandler.debug('Parser received channel:', ch?.name || ch?.id)
      // }
      onChannel(ch).catch(err => EPGErrorHandler.error('Channel processing error:', err))
    })
    parser.on('error', err => {
      EPGErrorHandler.error('MAG Parser error:', err)
      onError(ParserFactory._normalizeError(err))
    })

    return {
      parser,
      request: null, // MAG doesn't use HTTP requests
      start: () => {
        EPGErrorHandler.info('Starting MAG parser...')
        // MAG parser starts automatically when created
      },
      isValid: () => true, // MAG is always considered valid if it doesn't error
      getReceived: () => 0, // MAG doesn't track bytes
      destroy: () => {
        if (parser && typeof parser.destroy === 'function') {
          parser.destroy()
        }
      }
    }
  }

  static _setupDownloadEventHandlers(request, parser, onError, onProgress, receivedRef, url) {
    // Setup request error handler
    request.on('error', err => {
      EPGErrorHandler.error('Download error:', err)
      err = ParserFactory._normalizeError(err)
      err.isNetworkError = true
      onError(err)
      return true
    })

    // Setup response handler
    request.once('response', (code, headers) => {
      EPGErrorHandler.info('Download response received:', code, 'Content-Type:', headers?.['content-type'] || headers?.['Content-Type'])
      EPGErrorHandler.debug('Download response:', JSON.stringify({ code, headers }, null, 2))
      
      if (code !== 200) {
        const error = new Error(`HTTP ${code}`)
        error.isHttpError = true
        error.statusCode = code
        onError(error)
        return
      }

      // Check if Download class is already handling decompression
      const downloadHandlesDecompression = request.opts && request.opts.decompress === true
      
      // Determine if content is gzipped - prioritize URL extension over headers
      const isGzippedByUrl = url.includes('.gz')
      const isGzippedByHeaders = headers && (
        headers['content-encoding'] === 'gzip' ||
        headers['Content-Encoding'] === 'gzip' ||
        headers['content-type'] === 'application/gzip' ||
        headers['Content-Type'] === 'application/gzip' ||
        (headers['content-type'] && headers['content-type'].includes('gzip')) ||
        (headers['Content-Type'] && headers['Content-Type'].includes('gzip'))
      )
      
      const isGzipped = isGzippedByUrl || isGzippedByHeaders

      // For .gz files, always do manual decompression since the server might not send proper headers
      // For other gzipped content, only do manual decompression if Download is not handling it
      if (isGzippedByUrl || (isGzippedByHeaders && !downloadHandlesDecompression)) {
        EPGErrorHandler.info(`Setting up manual gzip decompression (URL has .gz: ${isGzippedByUrl}, headers indicate gzip: ${isGzippedByHeaders}, Download handles decompression: ${downloadHandlesDecompression})`)
        this._setupGzipHandlers(request, parser, receivedRef, onProgress)
      } else {
        EPGErrorHandler.info('Using direct handlers (Download handling decompression or not gzipped)')
        this._setupDirectHandlers(request, parser, receivedRef, onProgress)
      }
    })
  }

  static _setupGzipHandlers(request, parser, receivedRef, onProgress) {
    EPGErrorHandler.info('Setting up gzip decompression')
    const gunzip = zlib.createGunzip()
    let gunzipEnded = false
    
    gunzip.on('error', err => {
      EPGErrorHandler.warn('Gunzip error occurred:', err.message, '- continuing with partial data')
      gunzipEnded = true
      // Emit decompression error event for cache cleanup
      request.emit('decompression-error', err)
      // Don't destroy request immediately - let it finish naturally
      // This allows the parser to process whatever data was already received
      EPGErrorHandler.info('Gunzip error occurred, but allowing parser to finish processing existing data')
    })
    
    // CRITICAL FIX: Connect gunzip output to parser (pipe handles data automatically)
    gunzip.pipe(parser)
    
    gunzip.on('end', () => {
      EPGErrorHandler.debug('Gunzip ended')
      gunzipEnded = true
      parser?.end()
    })
    
    request.on('data', chunk => {
      receivedRef.value += chunk.length
      EPGErrorHandler.debug('Received chunk:', chunk.length, 'bytes, total:', receivedRef.value)
      
      // CRITICAL FIX: Call onProgress callback to update EPGManager
      if (onProgress && typeof onProgress === 'function') {
        onProgress(receivedRef.value)
      }
      
      if (!gunzipEnded) {
        try {
          gunzip.write(chunk)
        } catch (e) {
          EPGErrorHandler.error('Error writing to gunzip:', e)
        }
      }
    })
    
    request.once('end', () => {
      EPGErrorHandler.debug('Download ended, ending gunzip')
      if (!gunzipEnded) {
        gunzip.end()
      }
      // Force parser to end after a short delay to ensure all data is processed
      setTimeout(() => {
        if (parser && typeof parser.end === 'function') {
          EPGErrorHandler.debug('Forcing parser to end after download completion')
          parser.end()
        }
      }, 1000) // 1 second delay to allow processing to complete
    })
    
    request.on('error', (err) => {
      EPGErrorHandler.warn('Download error occurred:', err.message, '- ending gunzip gracefully')
      if (!gunzipEnded) {
        try {
          gunzip.end()
        } catch (e) {
          EPGErrorHandler.debug('Error ending gunzip:', e.message)
        }
      }
    })
  }

  static _setupDirectHandlers(request, parser, receivedRef, onProgress) {
    EPGErrorHandler.info('Setting up plain text download')
    request.on('data', chunk => {
      receivedRef.value += chunk.length
      
      // CRITICAL FIX: Call onProgress callback to update EPGManager
      if (onProgress && typeof onProgress === 'function') {
        onProgress(receivedRef.value)
      }
      
      parser?.write(chunk)
    })
    
    request.once('end', () => {
      EPGErrorHandler.debug('Download ended, ending parser')
      request.destroy()
      parser.end()
    })
  }
}
