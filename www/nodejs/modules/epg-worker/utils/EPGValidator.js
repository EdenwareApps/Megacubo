import { EPGErrorHandler } from '../EPGErrorHandler.js'

export class EPGValidator {
  static validateProgramme(programme) {
    const errors = []
    const warnings = []

    // Required fields
    if (!programme.channel) {
      errors.push('Programme missing channel')
    }

    if (!programme.title || !programme.title.length) {
      errors.push('Programme missing title')
    }

    if (!programme.start) {
      errors.push('Programme missing start time')
    }

    if (!programme.end) {
      errors.push('Programme missing end time')
    }

    // Validation of data types and ranges
    if (programme.start && programme.end) {
      const start = typeof programme.start === 'string' ? parseInt(programme.start) : programme.start
      const end = typeof programme.end === 'string' ? parseInt(programme.end) : programme.end

      if (isNaN(start) || isNaN(end)) {
        errors.push('Invalid timestamp format')
      } else {
        if (start >= end) {
          errors.push('Start time must be before end time')
        }

        const now = Math.floor(Date.now() / 1000)
        const oneYearFromNow = now + (365 * 24 * 60 * 60)

        if (start < (now - (7 * 24 * 60 * 60))) {
          warnings.push('Programme is more than 7 days old')
        }

        if (end > oneYearFromNow) {
          warnings.push('Programme is more than 1 year in the future')
        }
      }
    }

    // Title validation
    if (programme.title && Array.isArray(programme.title)) {
      const title = programme.title[0] || ''
      if (title.length > 200) {
        warnings.push('Programme title is very long')
      }
      if (title.length < 2) {
        warnings.push('Programme title is very short')
      }
    }

    // Category validation
    if (programme.category) {
      if (Array.isArray(programme.category) && programme.category.length > 10) {
        warnings.push('Programme has too many categories')
      }
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings
    }
  }

  static validateChannel(channel) {
    const errors = []
    const warnings = []

    // Required fields
    if (!channel.id && !channel.name) {
      errors.push('Channel missing both id and name')
    }

    if (!channel.displayName && !channel.name) {
      errors.push('Channel missing display name')
    }

    // Name validation
    const name = channel.displayName || channel.name
    if (name) {
      if (name.length > 100) {
        warnings.push('Channel name is very long')
      }
      if (name.length < 2) {
        warnings.push('Channel name is very short')
      }
      if (/^\d+$/.test(name)) {
        warnings.push('Channel name is only numeric')
      }
    }

    // Icon validation
    if (channel.icon) {
      if (!channel.icon.startsWith('http')) {
        warnings.push('Channel icon is not a valid URL')
      }
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings
    }
  }

  static validateEPGData(programmes, channels) {
    const stats = {
      programmes: {
        total: programmes.length,
        valid: 0,
        invalid: 0,
        warnings: 0
      },
      channels: {
        total: channels.length,
        valid: 0,
        invalid: 0,
        warnings: 0
      },
      errors: [],
      warnings: []
    }

    // Validate programmes
    for (const programme of programmes) {
      const validation = this.validateProgramme(programme)
      
      if (validation.isValid) {
        stats.programmes.valid++
      } else {
        stats.programmes.invalid++
        stats.errors.push(...validation.errors.map(err => `Programme: ${err}`))
      }

      if (validation.warnings.length > 0) {
        stats.programmes.warnings++
        stats.warnings.push(...validation.warnings.map(warn => `Programme: ${warn}`))
      }
    }

    // Validate channels
    for (const channel of channels) {
      const validation = this.validateChannel(channel)
      
      if (validation.isValid) {
        stats.channels.valid++
      } else {
        stats.channels.invalid++
        stats.errors.push(...validation.errors.map(err => `Channel: ${err}`))
      }

      if (validation.warnings.length > 0) {
        stats.channels.warnings++
        stats.warnings.push(...validation.warnings.map(warn => `Channel: ${warn}`))
      }
    }

    // Calculate quality score
    const totalItems = stats.programmes.total + stats.channels.total
    const validItems = stats.programmes.valid + stats.channels.valid
    stats.qualityScore = totalItems > 0 ? Math.round((validItems / totalItems) * 100) : 0

    return stats
  }

  static validateURL(url) {
    const errors = []
    const warnings = []

    if (!url) {
      errors.push('URL is empty')
      return { isValid: false, errors, warnings }
    }

    try {
      const parsedUrl = new URL(url)
      
      // Protocol validation
      if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
        errors.push('URL must use HTTP or HTTPS protocol')
      }

      // File extension validation
      const pathname = parsedUrl.pathname.toLowerCase()
      if (!pathname.endsWith('.xml') && !pathname.endsWith('.xml.gz')) {
        warnings.push('URL does not appear to be an XML EPG file')
      }

      // Domain validation
      if (parsedUrl.hostname === 'localhost' || parsedUrl.hostname === '127.0.0.1') {
        warnings.push('Using localhost URL')
      }

    } catch (error) {
      errors.push(`Invalid URL format: ${error.message}`)
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings
    }
  }

  static sanitizeString(str, maxLength = 200) {
    if (!str || typeof str !== 'string') {
      return ''
    }

    // Remove control characters and trim
    let sanitized = str.replace(/[\x00-\x1F\x7F]/g, '').trim()
    
    // Limit length
    if (sanitized.length > maxLength) {
      sanitized = sanitized.substring(0, maxLength).trim()
    }

    return sanitized
  }

  static sanitizeProgramme(programme) {
    if (!programme || typeof programme !== 'object') {
      return null
    }

    const sanitized = { ...programme }

    // Sanitize title
    if (Array.isArray(sanitized.title) && sanitized.title.length > 0) {
      sanitized.title = [this.sanitizeString(sanitized.title[0], 200)]
    }

    // Sanitize description
    if (sanitized.desc) {
      if (Array.isArray(sanitized.desc) && sanitized.desc.length > 0) {
        sanitized.desc = [this.sanitizeString(sanitized.desc[0], 1000)]
      } else if (typeof sanitized.desc === 'string') {
        sanitized.desc = this.sanitizeString(sanitized.desc, 1000)
      }
    }

    // Sanitize categories
    if (Array.isArray(sanitized.category)) {
      sanitized.category = sanitized.category
        .map(cat => this.sanitizeString(cat, 50))
        .filter(cat => cat.length > 0)
        .slice(0, 10) // Limit to 10 categories
    }

    // Validate and convert timestamps
    if (sanitized.start) {
      const start = typeof sanitized.start === 'string' ? parseInt(sanitized.start) : sanitized.start
      sanitized.start = isNaN(start) ? null : start
    }

    if (sanitized.end) {
      const end = typeof sanitized.end === 'string' ? parseInt(sanitized.end) : sanitized.end
      sanitized.end = isNaN(end) ? null : end
    }

    return sanitized
  }
}
