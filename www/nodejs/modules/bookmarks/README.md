# Bookmarks Module

A comprehensive bookmark management system for saving and organizing favorite channels, streams, and content.

## Features

- **Bookmark Management**: Add, remove, and organize bookmarks
- **Desktop Integration**: Create desktop shortcuts and icons
- **Search & Filter**: Search through bookmarks with various filters
- **Categories**: Organize bookmarks into categories and groups
- **Cross-Platform**: Works on desktop and mobile platforms
- **Sync**: Synchronize bookmarks across devices

## Classes

### Bookmarks
Main bookmark manager extending EntriesGroup:
- Bookmark CRUD operations
- Desktop shortcut creation
- Search and filtering capabilities
- Category management

## Key Methods

### Bookmark Operations
- `add(entry)`: Add a new bookmark
- `remove(entry)`: Remove a bookmark
- `toggle()`: Toggle bookmark status
- `current()`: Get currently bookmarked items

### Search & Filter
- `search(terms)`: Search bookmarks by terms
- `streamFilter(e)`: Filter by stream type
- `groupFilter(e)`: Filter by group/category

### Desktop Integration
- `desktopIconsSync()`: Sync with desktop icons
- `createDesktopShortcut(entry)`: Create desktop shortcut
- `getWindowsDesktop()`: Get Windows desktop path

## Usage

```javascript
import bookmarks from './bookmarks.js';

// Add a bookmark
await bookmarks.add({
    name: 'Sports Channel',
    url: 'stream_url',
    group: 'Sports'
});

// Search bookmarks
const results = await bookmarks.search('sports');

// Get all bookmarks
const allBookmarks = await bookmarks.entries();
```

## Configuration

- `bookmarks-desktop-icons`: Enable desktop icon creation
- `bookmarks-auto-sync`: Enable automatic synchronization
- `bookmarks-max-count`: Maximum number of bookmarks allowed

## File Structure

Bookmarks are stored in:
- **Desktop**: `~/Desktop/` (Windows/Linux) or `~/Desktop/` (macOS)
- **App Data**: Application data directory

## Integration

- Integrates with channel lists and EPG data
- Supports custom bookmark categories
- Works with parental controls
- Compatible with search and discovery features 