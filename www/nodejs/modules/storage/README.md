# Storage Module

A high-performance storage and caching system that provides persistent data storage, intelligent caching, and efficient data management with support for compression, encryption, and automatic cleanup.

## Features

- **Persistent Storage**: Reliable disk-based storage with atomic operations
- **Intelligent Caching**: Multi-level caching with LRU eviction
- **Data Compression**: Automatic compression for large datasets
- **Automatic Cleanup**: Smart cache eviction and disk space management
- **Atomic Operations**: Safe concurrent access with file locking
- **Performance Optimization**: Efficient I/O operations and memory usage
- **Cross-Platform**: Works on all major operating systems

## Architecture

### Core Components

#### StorageTools
Base storage utilities:
- File operations and management
- Compression and decompression
- Data validation and integrity checks
- Error handling and recovery

#### StorageHolding
Resource management:
- File handle management
- Memory allocation control
- Resource cleanup
- Performance monitoring

#### StorageIndex
Indexing and metadata:
- File indexing and metadata storage
- Cache key management
- Expiration tracking
- Search and retrieval optimization

#### StorageIO
Input/Output operations:
- Read/write operations
- Atomic file operations
- Concurrent access control
- Performance optimization

## Key Methods

### Storage Operations
- `set(key, data, options)`: Store data with options
- `get(key, options)`: Retrieve data with options
- `delete(key)`: Delete stored data
- `exists(key)`: Check if data exists
- `has(key)`: Check if key is in cache

### Cache Management
- `touch(key, options)`: Update cache metadata
- `align()`: Align cache with disk usage limits
- `clear()`: Clear all cached data
- `cleanup()`: Perform cache cleanup

### Advanced Operations
- `lock(key, operation)`: Lock file for atomic operations
- `resolve(key)`: Get file path for key
- `compress(data)`: Compress data
- `decompress(data)`: Decompress data

## Usage

```javascript
import storage from './storage.js';

// Store data
await storage.set('user-preferences', {
    theme: 'dark',
    volume: 75,
    language: 'en'
}, {
    expiration: 86400, // 24 hours
    compression: true
});

// Retrieve data
const prefs = await storage.get('user-preferences');

// Check if exists
if (await storage.exists('user-preferences')) {
    console.log('Preferences found');
}

// Atomic operation
await storage.lock('critical-data', async () => {
    const data = await storage.get('critical-data');
    data.updated = Date.now();
    await storage.set('critical-data', data);
});

// Cache management
await storage.touch('frequently-accessed', {
    size: true,
    expiration: true
});
```

## Storage Features

### Data Persistence
- **Atomic Writes**: Safe concurrent access
- **File Locking**: Prevent data corruption
- **Backup Support**: Automatic backup creation
- **Recovery**: Data recovery mechanisms

### Compression
- **Automatic Compression**: Compress large data
- **Multiple Algorithms**: Gzip, Deflate, LZ4
- **Compression Ratio**: Configurable compression levels
- **Performance**: Fast compression/decompression

### Encryption
- **Key Management**: Secure key handling
- **Selective Encryption**: Encrypt sensitive data only
- **Performance**: Minimal encryption overhead

## Performance Features

### Caching Strategy
- **Multi-Level Cache**: Memory and disk caching
- **LRU Eviction**: Least Recently Used eviction
- **Size-Based Eviction**: Evict by data size
- **Time-Based Eviction**: Evict by expiration time

### I/O Optimization
- **Batch Operations**: Batch multiple operations
- **Async I/O**: Non-blocking operations
- **Buffer Management**: Efficient buffer usage
- **File Pooling**: Reuse file handles

### Memory Management
- **Memory Limits**: Configurable memory usage
- **Garbage Collection**: Automatic cleanup
- **Memory Monitoring**: Track memory usage
- **Optimization**: Minimize memory footprint

## Configuration

### Storage Settings
- `storage-path`: Storage directory path
- `storage-size-limit`: Maximum storage size
- `storage-compression`: Enable compression
- `storage-encryption`: Enable encryption

### Cache Settings
- `cache-size-limit`: Maximum cache size
- `cache-ttl`: Default time-to-live
- `cache-eviction-policy`: Eviction policy
- `cache-compression-threshold`: Compression threshold

## Security

### Data Protection
- **File Permissions**: Secure file permissions
- **Access Control**: Control access to data
- **Encryption**: Optional data encryption
- **Integrity Checks**: Data integrity validation

### Privacy
- **Data Isolation**: Isolate user data
- **Secure Deletion**: Secure data deletion
- **Audit Trail**: Track data access
- **Compliance**: GDPR compliance support

## Integration

- Used by all modules requiring persistent storage
- Provides unified storage interface
- Supports custom storage backends
- Enables advanced caching strategies 