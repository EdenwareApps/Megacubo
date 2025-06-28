# Entries Group Module

A data grouping and organization system that manages collections of entries (channels, content, etc.) with filtering, sorting, and persistence capabilities.

## Features

- **Entry Management**: Add, remove, and organize entries
- **Grouping**: Group entries by categories and types
- **Persistence**: Save and load entry groups
- **Filtering**: Filter entries by criteria
- **Search**: Search within entry groups

## Usage

```javascript
import EntriesGroup from './entries-group.js';

const group = new EntriesGroup('favorites', master);

// Add entry
await group.add({
    name: 'Sports Channel',
    url: 'stream_url',
    type: 'live'
});

// Get entries
const entries = await group.entries();

// Filter entries
const filtered = group.filter(entry => entry.type === 'live');
``` 