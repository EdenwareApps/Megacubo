// Main entry point for the EPG Worker module
export { default as EPGManager } from './EPGManager.js'
export { EPG } from './EPG.js'
export { EPGUpdater } from './EPGUpdater.js'
export { EPGErrorHandler } from './EPGErrorHandler.js'
export { EPGStateMachine } from './EPGStateMachine.js'
export { DatabaseFactory } from './database/index.js'
export { ParserFactory } from './parser/index.js'
export { CacheManager } from './cache/index.js'
export { MemoryMonitor } from './memory/index.js'
export { EPGValidator, PerformanceMonitor } from './utils/index.js'
export { EPG_CONFIG, PROGRAMME_DB_OPTS, METADATA_DB_OPTS } from './config.js'

// Default export is EPGManager for backwards compatibility
import EPGManager from './EPGManager.js'
export default EPGManager
