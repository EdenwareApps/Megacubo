/**
 * Lazy Loading Utility for Performance Optimization
 * 
 * This module provides utilities for lazy loading heavy dependencies
 * and features to improve initial load performance.
 */

class LazyLoader {
  constructor() {
    this.cache = new Map();
    this.loading = new Map();
  }

  /**
   * Lazy load a module with caching
   * @param {string} moduleId - Module identifier
   * @param {Function} importFn - Dynamic import function
   * @returns {Promise} Module promise
   */
  async load(moduleId, importFn) {
    // Return cached module if available
    if (this.cache.has(moduleId)) {
      return this.cache.get(moduleId);
    }

    // Return existing loading promise if in progress
    if (this.loading.has(moduleId)) {
      return this.loading.get(moduleId);
    }

    // Start loading
    const loadingPromise = this._loadModule(moduleId, importFn);
    this.loading.set(moduleId, loadingPromise);

    try {
      const module = await loadingPromise;
      this.cache.set(moduleId, module);
      this.loading.delete(moduleId);
      return module;
    } catch (error) {
      this.loading.delete(moduleId);
      throw error;
    }
  }

  async _loadModule(moduleId, importFn) {
    try {
      console.log(`🚀 Lazy loading: ${moduleId}`);
      const startTime = performance.now();
      
      const module = await importFn();
      
      const loadTime = performance.now() - startTime;
      console.log(`✅ Loaded ${moduleId} in ${loadTime.toFixed(2)}ms`);
      
      return module;
    } catch (error) {
      console.error(`❌ Failed to load ${moduleId}:`, error);
      throw error;
    }
  }

  /**
   * Preload a module without waiting for it
   * @param {string} moduleId - Module identifier
   * @param {Function} importFn - Dynamic import function
   */
  preload(moduleId, importFn) {
    if (!this.cache.has(moduleId) && !this.loading.has(moduleId)) {
      this.load(moduleId, importFn).catch(() => {
        // Ignore preload errors
      });
    }
  }

  /**
   * Check if a module is already loaded
   * @param {string} moduleId - Module identifier
   * @returns {boolean} True if loaded
   */
  isLoaded(moduleId) {
    return this.cache.has(moduleId);
  }

  /**
   * Clear cache for a specific module
   * @param {string} moduleId - Module identifier
   */
  clearCache(moduleId) {
    this.cache.delete(moduleId);
    this.loading.delete(moduleId);
  }

  /**
   * Clear all cached modules
   */
  clearAllCache() {
    this.cache.clear();
    this.loading.clear();
  }
}

// Feature-specific lazy loaders
export const lazyLoader = new LazyLoader();

/**
 * Lazy load video processing modules
 */
export const videoLazyLoader = {
  async loadHLS() {
    return lazyLoader.load('hls', () => import('hls.js'));
  },

  async loadMpegts() {
    return lazyLoader.load('mpegts', () => import('mpegts.js'));
  },

  async loadDash() {
    return lazyLoader.load('dash', () => import('dashjs'));
  },

  preloadVideoLibraries() {
    lazyLoader.preload('hls', () => import('hls.js'));
    lazyLoader.preload('mpegts', () => import('mpegts.js'));
    // Only preload dash if user shows preference for DASH content
  }
};

/**
 * Lazy load locale modules
 */
export const localeLazyLoader = {
  async loadLocale(localeCode) {
    return lazyLoader.load(
      `locale-${localeCode}`,
      () => import(`dayjs/locale/${localeCode}.js`)
    );
  },

  async loadRequiredLocales(localeCodes) {
    const promises = localeCodes.map(code => this.loadLocale(code));
    return Promise.allSettled(promises);
  }
};

/**
 * Lazy load heavy feature modules
 */
export const featureLazyLoader = {
  async loadStreamer() {
    return lazyLoader.load('streamer', () => import('../streamer/main.js'));
  },

  async loadEPGProcessor() {
    return lazyLoader.load('epg', () => import('../lists/lists.js'));
  },

  async loadDownloader() {
    return lazyLoader.load('downloader', () => import('../downloads/downloads.js'));
  },

  async loadAnalytics() {
    return lazyLoader.load('analytics', () => import('../analytics/analytics.js'));
  },

  // Preload critical features based on user behavior
  preloadCriticalFeatures() {
    // Load streamer immediately as it's likely to be used soon
    this.loadStreamer();
    
    // Preload EPG in the background
    lazyLoader.preload('epg', () => import('../lists/lists.js'));
  }
};

/**
 * Performance monitoring utilities
 */
export const performanceMonitor = {
  measureLoadTime(label, fn) {
    return async (...args) => {
      const startTime = performance.now();
      try {
        const result = await fn(...args);
        const endTime = performance.now();
        console.log(`⏱️ ${label} took ${(endTime - startTime).toFixed(2)}ms`);
        return result;
      } catch (error) {
        const endTime = performance.now();
        console.error(`❌ ${label} failed after ${(endTime - startTime).toFixed(2)}ms:`, error);
        throw error;
      }
    };
  },

  measureBundleSize() {
    if (typeof navigator !== 'undefined' && 'connection' in navigator) {
      const connection = navigator.connection;
      console.log('📊 Network info:', {
        effectiveType: connection.effectiveType,
        downlink: connection.downlink,
        rtt: connection.rtt
      });
    }
  }
};

export default lazyLoader;