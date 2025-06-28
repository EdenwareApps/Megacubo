# Search Module

A powerful search engine that provides advanced search capabilities across channels, content, and metadata with fuzzy matching and intelligent ranking.

## Features

- **Multi-Source Search**: Search across channels, EPG, and content
- **Fuzzy Matching**: Intelligent approximate matching
- **Search History**: Track and suggest search terms
- **Advanced Filters**: Filter by type, category, and quality
- **Real-time Results**: Instant search results with live updates

## Usage

```javascript
import search from './search.js';

// Search channels
const results = await search.search('sports', {
    type: 'live',
    limit: 20
});

// Search EPG
const epgResults = await search.searchEPG('news', {
    liveNow: true
});

// Get search suggestions
const suggestions = await search.getSuggestions('spo');
``` 