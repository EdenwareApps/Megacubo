# EPG Worker - Refactored Architecture

This directory contains the refactored EPG (Electronic Program Guide) worker module, now organized using modern software architecture principles.

## Architecture Overview

The EPG worker has been refactored from a monolithic structure into a modular, maintainable architecture following these principles:

- **Separation of Concerns (SoC)**: Each component has a single, well-defined responsibility
- **Dependency Injection (DI)**: Dependencies are injected rather than hard-coded
- **Factory Pattern**: Specialized factories for creating complex objects
- **State Management**: Centralized state management with clear interfaces
- **Error Handling**: Centralized error handling and logging

## Directory Structure

```
epg-worker/
├── index.js                     # Main entry point
├── config.js                    # Centralized configuration
├── EPGManager.js                 # Main EPG manager (orchestrator)
├── EPG.js                       # Individual EPG instance
├── EPGUpdater.js                 # Core EPG update logic with DI
├── EPGErrorHandler.js            # Centralized error handling
├── EPGStateMachine.js            # State machine for EPG states
├── database/
│   ├── index.js                 # Database exports
│   └── DatabaseFactory.js       # Database creation and management
├── parser/
│   ├── index.js                 # Parser exports
│   └── ParserFactory.js         # XML/MAG parser creation
├── cache/
│   ├── index.js                 # Cache exports
│   └── CacheManager.js          # Cache management
├── memory/
│   ├── index.js                 # Memory exports
│   └── MemoryMonitor.js         # Memory monitoring and GC
├── utils/
│   ├── index.js                 # Utility exports
│   ├── EPGValidator.js          # Data validation utilities
│   └── PerformanceMonitor.js    # Performance monitoring and benchmarking
└── README.md                    # This file
```

## Component Overview

### EPGManager
The main orchestrator that manages multiple EPG instances. Handles:
- EPG lifecycle (add/remove/sync)
- Search across multiple EPGs
- Live channel listings
- State management

### EPG
Individual EPG instance that extends EPGUpdater. Handles:
- File path resolution
- Database initialization
- Programme and channel processing
- Lifecycle management (start/ready/destroy)

### EPGUpdater
Core update logic with dependency injection. Handles:
- Update orchestration
- Parser management
- Database operations
- Error handling

### DatabaseFactory
Specialized factory for database creation. Provides:
- Programme database creation
- Metadata database creation
- Database initialization and recovery
- Validation and repair

### ParserFactory
Factory for XML/MAG parser creation. Provides:
- XML parser setup with gzip support
- MAG parser setup
- Event handler configuration
- Error handling

### CacheManager
Manages in-memory caches. Provides:
- Channel cache management
- Terms cache management
- Memory-aware cache cleanup
- Cache statistics

### MemoryMonitor
Monitors and manages memory usage. Provides:
- Real-time memory monitoring
- Automatic garbage collection
- Memory threshold alerts
- Configurable limits

### EPGErrorHandler
Centralized error handling and logging. Provides:
- Consistent error formatting
- Debug mode support
- Safe execution wrappers
- Fallback mechanisms

### EPGStateMachine
State machine for EPG ready states. Provides:
- Valid state transitions
- State validation
- Event emission on state changes

### EPGValidator
Data validation utilities for EPG content. Provides:
- Programme data validation
- Channel data validation
- URL validation and sanitization
- Quality scoring and statistics
- Data sanitization and cleanup

### PerformanceMonitor
Performance monitoring and benchmarking tools. Provides:
- Execution time measurement
- Memory usage tracking
- Performance metrics collection
- Benchmarking capabilities
- Performance report generation

## Usage

### Basic Usage (Backwards Compatible)
```javascript
import EPGManager from './epg-worker/index.js'

const epgManager = new EPGManager()
await epgManager.start(config, true) // true for Trias support
```

### Advanced Usage with Dependency Injection
```javascript
import { EPG, CacheManager, MemoryMonitor } from './epg-worker/index.js'

// Custom dependencies
const customCache = new CacheManager({ maxCacheSize: 10000 })
const customMemory = new MemoryMonitor({ maxHeapSize: 1024 * 1024 * 1024 })

const epg = new EPG('http://example.com/epg.xml', null, {
  cacheManager: customCache,
  memoryMonitor: customMemory
})
```

### Using Individual Components
```javascript
import { DatabaseFactory, ParserFactory, EPGValidator, PerformanceMonitor } from './epg-worker/index.js'

// Create specialized databases
const db = DatabaseFactory.createProgrammeDB('/path/to/db')
await DatabaseFactory.initializeDB(db)

// Create parsers
const parser = ParserFactory.createXMLParser(url, callbacks, options)

// Validate EPG data
const validation = EPGValidator.validateProgramme(programme)
if (!validation.isValid) {
  console.error('Invalid programme:', validation.errors)
}

// Monitor performance
const perfMonitor = new PerformanceMonitor()
const result = await perfMonitor.measureAsync('epg-update', async () => {
  // Your EPG update logic here
})
```

## 🧪 Testing

The modular architecture makes unit testing much easier:

```javascript
// Example test with mocked dependencies
import { EPGUpdater } from './epg-worker/EPGUpdater.js'

const mockDatabase = {
  createProgrammeDB: jest.fn(),
  initializeDB: jest.fn()
}

const epgUpdater = new EPGUpdater(url, trias, {
  databaseFactory: mockDatabase
})
```

## 🚀 Benefits

1. **Maintainability**: Each component has a single responsibility
2. **Testability**: Easy to mock dependencies for unit tests
3. **Reusability**: Components can be used independently
4. **Scalability**: Easy to add new features without affecting existing code
5. **Debugging**: Clear separation makes issues easier to trace
6. **Performance**: Better memory management and monitoring

## 🔄 Migration Guide

The refactored version is designed to be backwards compatible. However, for new code, prefer using the modular imports:

### Old Way
```javascript
import EPGManager from '../lists/epg-worker.js'
```

### New Way
```javascript
import EPGManager from './epg-worker/index.js'
// or
import { EPGManager, EPG, CacheManager } from './epg-worker/index.js'
```

## 📊 Configuration

All configuration is centralized in `config.js`:

```javascript
export const EPG_CONFIG = {
  cache: {
    ttl: 3600,
    maxCacheSize: 5000,
    cleanupInterval: 300000
  },
  network: {
    timeout: 30000,
    retries: 3,
    errorCountLimit: 128
  },
  memory: {
    maxHeapSize: 512 * 1024 * 1024,
    gcThreshold: 0.8,
    forceGcInterval: 60000
  }
}
```

## 🐛 Error Handling

All errors are handled consistently through `EPGErrorHandler`:

```javascript
import { EPGErrorHandler } from './epg-worker/EPGErrorHandler.js'

EPGErrorHandler.setDebugMode(true)
EPGErrorHandler.info('Operation started')
EPGErrorHandler.error('Operation failed', error)

// Safe execution with automatic error handling
const result = await EPGErrorHandler.safeExecute(async () => {
  // Potentially failing operation
}, 'operation context')
```

## 🔍 Monitoring

Memory and performance monitoring is built-in:

```javascript
import { MemoryMonitor } from './epg-worker/memory/MemoryMonitor.js'

const monitor = new MemoryMonitor()
monitor.onHighMemory((memInfo) => {
  console.log('High memory usage:', memInfo.heapPercent)
})
monitor.startMonitoring()
```

This refactored architecture provides a solid foundation for future development while maintaining backwards compatibility with existing code.
