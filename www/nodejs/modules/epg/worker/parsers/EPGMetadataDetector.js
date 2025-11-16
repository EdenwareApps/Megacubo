/**
 * EPG Metadata Detector
 * Enhanced detection of metadata from XMLTV EPG files
 * Works with JavaScript objects (not DOM elements)
 */

import { EPGErrorHandler } from '../EPGErrorHandler.js'

export class EPGMetadataDetector {
  constructor() {
    // Default values
    this.defaults = {
      age: 0,           // No restriction
      lang: '',         // No language detected
      country: '',      // No country detected
      rating: '',       // No rating
      parental: 'no',   // No parental control (yes/no/true/false unified)
      contentType: ''   // No content type
    }
  }

  /**
   * Process programme metadata from JavaScript object
   * @param {Object} programme - Programme object from EPG parser
   * @returns {Object} Processed programme metadata
   */
  processProgrammeMetadata(programme) {
    const metadata = { ...this.defaults }
    
    // Age rating detection
    metadata.age = this.detectAgeFromProgramme(programme)
    
    // Language detection
    metadata.lang = this.detectLanguageFromProgramme(programme)
    
    // Country detection
    metadata.country = this.detectCountryFromProgramme(programme)
    
    // Parental control detection (handles both parental and parentalLock)
    metadata.parental = this.detectParentalControl(programme, metadata.age)
    
    // Content type detection
    metadata.contentType = this.detectContentType(metadata.age)

    return metadata
  }

  /**
   * Detect age rating from programme
   */
  detectAgeFromProgramme(programme) {
    // Priority 1: Direct age restriction attribute
    if (programme.ageRestriction) {
      const age = parseInt(programme.ageRestriction)
      if (!isNaN(age)) return age
    }

    // Priority 2: Rating attribute (18+, PG-13, etc.)
    if (programme.rating) {
      const rating = programme.rating.toLowerCase()
      if (rating.includes('18+') || rating.includes('adult')) return 18
      if (rating.includes('16+')) return 16
      if (rating.includes('13+') || rating.includes('pg-13')) return 13
      if (rating.includes('12+')) return 12
      if (rating.includes('7+')) return 7
      if (rating.includes('0+') || rating.includes('all')) return 0
    }

    // Priority 3: Parental control attributes (handles both parental and parentalLock)
    if (programme.parental === 'yes' || programme.parental === '1' || programme.parental === 'true' || 
        (programme.parentalLock && programme.parentalLock === 'true')) {
      return 18 // Assume adult content if parental control is enabled
    }

    // Priority 4: Category detection
    if (programme.category) {
      let category = ''
      if (Array.isArray(programme.category)) {
        category = programme.category.join(' ').toLowerCase()
      } else if (typeof programme.category === 'string') {
        category = programme.category.toLowerCase()
      }
      
      if (category.includes('adult') || category.includes('18+') || category.includes('xxx')) return 18
      if (category.includes('teen') || category.includes('16+')) return 16
      if (category.includes('kids') || category.includes('children')) return 0
    }

    // Priority 5: Title/Description detection
    const text = `${programme.title || ''} ${programme.desc || ''}`.toLowerCase()
    const ageMatch = text.match(/\[\s*(\d+)\+\]|\[\s*(pg-\d+)\s*\]|\[\s*(adult)\s*\]/i)
    if (ageMatch) {
      if (ageMatch[1]) return parseInt(ageMatch[1])
      if (ageMatch[2] === 'pg-13') return 13
      if (ageMatch[3] === 'adult') return 18
    }
    if (text.includes('18+') || text.includes('adult') || text.includes('xxx')) return 18
    if (text.includes('16+') || text.includes('teen')) return 16
    if (text.includes('13+') || text.includes('pg-13')) return 13
    if (text.includes('kids') || text.includes('children')) return 0

    return 0 // Default: no restriction
  }

  /**
   * Detect language from programme
   */
  detectLanguageFromProgramme(programme) {
    // Priority 1: Direct language attribute
    if (programme.lang) {
      return programme.lang.toLowerCase()
    }

    // Priority 2: Title/Description language attribute
    if (programme.title && programme.title.lang) {
      return programme.title.lang.toLowerCase()
    }
    if (programme.desc && programme.desc.lang) {
      return programme.desc.lang.toLowerCase()
    }

    // Priority 3: Title/Description text detection
    const text = `${programme.title || ''} ${programme.desc || ''}`
    const langMatch = text.match(/\[(\w{2}(-\w{2})?)\]/i)
    if (langMatch) {
      return langMatch[1].toLowerCase()
    }
    const textLower = text.toLowerCase()
    if (textLower.includes('português') || textLower.includes('brasil')) return 'pt'
    if (textLower.includes('español') || textLower.includes('espanha')) return 'es'
    if (textLower.includes('english') || textLower.includes('usa')) return 'en'
    if (textLower.includes('français') || textLower.includes('france')) return 'fr'

    return '' // Default: no language detected
  }

  /**
   * Detect country from programme
   */
  detectCountryFromProgramme(programme) {
    // Priority 1: Direct country attribute
    if (programme.country) {
      return programme.country.toUpperCase()
    }

    // Priority 2: Geo attribute
    if (programme.geo) {
      const geo = programme.geo.toLowerCase()
      if (geo.includes('brazil') || geo.includes('brasil')) return 'BR'
      if (geo.includes('spain') || geo.includes('espanha')) return 'ES'
      if (geo.includes('usa') || geo.includes('united states')) return 'US'
      if (geo.includes('france')) return 'FR'
      if (geo.includes('germany') || geo.includes('deutschland')) return 'DE'
    }

    // Priority 3: Channel name/Title detection
    const text = `${programme.channel || ''} ${programme.title || ''}`.toLowerCase()
    const countryMatch = text.match(/\[(\w{2})\]/i)
    if (countryMatch) {
      return countryMatch[1].toUpperCase()
    }
    if (text.includes('brasil') || text.includes('brazil')) return 'BR'
    if (text.includes('espanha') || text.includes('spain')) return 'ES'
    if (text.includes('usa') || text.includes('america')) return 'US'
    if (text.includes('france')) return 'FR'
    if (text.includes('germany') || text.includes('deutschland')) return 'DE'
    if (text.includes('portugal')) return 'PT'
    if (text.includes('italia') || text.includes('italy')) return 'IT'
    if (text.includes('méxico') || text.includes('mexico')) return 'MX'
    if (text.includes('argentina')) return 'AR'
    if (text.includes('colombia')) return 'CO'
    if (text.includes('chile')) return 'CL'
    if (text.includes('peru') || text.includes('perú')) return 'PE'

    return '' // Default: no country detected
  }

  /**
   * Detect parental control (handles both parental and parentalLock)
   */
  detectParentalControl(programme, age) {
    // Check explicit parental control from input
    if (programme.parental === 'yes' || programme.parental === '1' || programme.parental === 'true') return 'yes'
    if (programme.parentalLock === 'true' || programme.parentalLock === '1') return 'yes'
    
    // Infer from age rating
    if (age >= 18) return 'yes'
    
    return 'no'
  }

  /**
   * Detect content type
   */
  detectContentType(age) {
    if (age >= 18) return 'adult'
    if (age === 0) return 'kids'
    if (age >= 13) return 'teen'
    return ''
  }
}