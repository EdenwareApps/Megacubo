# Lists Module

A comprehensive playlist and channel list management system that handles M3U/M3U8 playlists, EPG data, and channel organization with advanced indexing and search capabilities.

## Features

- **Playlist Management**: Load, parse, and manage M3U/M3U8 playlists
- **EPG Integration**: Full Electronic Program Guide support with XMLTV
- **Advanced Indexing**: Fast search and filtering with indexed data
- **Multi-Format Support**: M3U, M3U8, JSON, and custom formats
- **Real-time Updates**: Automatic playlist updates and synchronization
- **Search & Discovery**: Advanced search with fuzzy matching
- **Parental Controls**: Built-in content filtering
- **Performance Optimization**: Efficient memory usage and caching

## Architecture

### Core Components

#### Lists
Main list manager that orchestrates all playlist operations:
- Playlist loading and parsing
- EPG data management
- Search and filtering
- Real-time updates

#### Index
Advanced indexing system for fast search:
- Term-based indexing
- Fuzzy search capabilities
- Category organization
- Performance optimization

#### Loader
Background playlist loader with concurrency control:
- Parallel playlist loading
- Automatic retry mechanisms
- Progress tracking
- Resource management

#### Manager
High-level list management interface:
- User-friendly operations
- Import/export capabilities
- List validation
- Error handling

## Key Methods

### List Operations
- `load(url)`: Load playlist from URL
- `add(url, name)`: Add new playlist
- `remove(url)`: Remove playlist
- `update(url)`: Update existing playlist
- `validate(content)`: Validate playlist content

### Search & Filtering
- `search(terms, options)`: Search channels
- `filter(type, criteria)`: Filter by type/criteria
- `getCategories()`: Get available categories
- `getByCategory(category)`: Get channels by category

### EPG Operations
- `loadEPG(url)`: Load EPG data
- `getEPG(channel)`: Get EPG for channel
- `searchEPG(terms)`: Search EPG data
- `getLiveNow()`: Get currently live channels

## Usage

```javascript
import lists from './lists.js';

// Load playlist
await lists.load('https://example.com/playlist.m3u8');

// Search channels
const results = await lists.search('sports', {
    type: 'live',
    limit: 50
});

// Get categories
const categories = await lists.getCategories();

// Get channels by category
const sportsChannels = await lists.getByCategory('Sports');

// Load EPG
await lists.loadEPG('https://example.com/epg.xml');

// Get live channels
const liveChannels = await lists.getLiveNow();
```

## Supported Formats

### Playlist Formats
- **M3U**: Basic playlist format
- **M3U8**: Extended M3U with metadata
- **JSON**: Structured playlist format
- **Custom**: Proprietary formats

### EPG Formats
- **XMLTV**: Standard EPG format
- **JSON**: Structured EPG data
- **Custom**: Proprietary EPG formats

### Metadata Support
- Channel logos and icons
- Program descriptions
- Category information
- Quality indicators

## Performance Features

### Indexing
- **Term Indexing**: Fast text-based search
- **Category Indexing**: Organized channel categories
- **Type Indexing**: Live/VOD/Audio classification
- **Metadata Indexing**: Logo, quality, and other metadata

### Caching
- **Memory Cache**: Fast access to frequently used data
- **Disk Cache**: Persistent storage for large datasets
- **Network Cache**: Cached playlist downloads
- **EPG Cache**: Cached program guide data

### Optimization
- **Lazy Loading**: Load data on demand
- **Background Updates**: Update playlists in background
- **Concurrency Control**: Parallel processing with limits
- **Memory Management**: Efficient memory usage

## Search Capabilities

### Search Types
- **Exact Match**: Precise term matching
- **Fuzzy Search**: Approximate matching
- **Partial Search**: Partial term matching
- **Category Search**: Search within categories

### Search Options
- **Type Filtering**: Live/VOD/Audio only
- **Category Filtering**: Specific categories
- **Quality Filtering**: Quality-based filtering
- **Language Filtering**: Language-specific content

## Configuration

### Loading Settings
- `lists-loader-concurrency`: Parallel loading limit
- `lists-update-interval`: Automatic update interval
- `lists-cache-size`: Cache size limit
- `lists-validation`: Enable content validation

### Search Settings
- `lists-search-limit`: Default search result limit
- `lists-fuzzy-search`: Enable fuzzy search
- `lists-category-search`: Enable category search
- `lists-metadata-search`: Enable metadata search

## Integration

- Integrates with channels module
- Works with EPG systems
- Supports parental controls
- Compatible with search and discovery
- Enables bookmark integration 