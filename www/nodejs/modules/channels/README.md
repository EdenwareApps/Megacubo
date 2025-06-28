# Channels Module

A comprehensive channel management system for organizing, searching, and managing TV channels, streams, and EPG (Electronic Program Guide) data.

## Features

- **Channel Management**: Add, edit, and organize channels
- **EPG Integration**: Full Electronic Program Guide support
- **Search & Discovery**: Advanced search and filtering capabilities
- **Categories**: Organize channels into categories and groups
- **Live Data**: Real-time channel status and information
- **Parental Controls**: Built-in content filtering
- **Multi-Format Support**: M3U, M3U8, and custom playlist formats

## Classes

### ChannelsData
Base class for channel data management:
- Channel loading and caching
- Data validation and processing
- Storage operations

### ChannelsEPG
Extends ChannelsData with EPG functionality:
- Program guide data processing
- Live now information
- EPG search capabilities
- Time-based filtering

### ChannelsEditing
Extends ChannelsEPG with editing features:
- Channel entry editing
- Category management
- Channel sharing
- Metadata editing

### ChannelsAutoWatchNow
Extends ChannelsEditing with auto-play features:
- Automatic channel switching
- Watch now functionality
- Stream auto-detection

### ChannelsKids
Extends ChannelsAutoWatchNow with kids features:
- Child-friendly content filtering
- Parental control integration
- Safe search options

### Channels
Main channels controller combining all functionality:
- Unified channel management
- Advanced search and filtering
- EPG integration
- Export/import capabilities

## Key Methods

### Channel Operations
- `get(terms)`: Get channels by search terms
- `searchChannels(terms, partial)`: Search channels with partial matching
- `getAllChannels()`: Get all available channels
- `getChannelCategory(name)`: Get channels by category

### EPG Operations
- `epgSearch(terms, liveNow)`: Search EPG data
- `epgChannel(entry, limit)`: Get EPG for specific channel
- `epgChannelsLiveNow(entries)`: Get live now information
- `epgChannelLiveNowAndNext(entry)`: Get current and next programs

### Editing Operations
- `editChannelEntry(entry, category, atts)`: Edit channel properties
- `addChannelEntry(category, inline)`: Add new channel
- `editCategoriesEntry()`: Manage channel categories
- `shareChannelEntry(entry)`: Share channel information

## Usage

```javascript
import channels from './channels.js';

// Search for channels
const results = await channels.search('sports');

// Get EPG data
const epgData = await channels.epgChannel(channelEntry, 10);

// Get live now channels
const liveChannels = await channels.epgChannelsLiveNow(channelList);

// Edit channel
await channels.editChannelEntry(channel, 'Sports', {
    name: 'Updated Channel Name',
    logo: 'new_logo.png'
});
```

## Configuration

- `epg`: EPG source URL
- `epg-map`: EPG channel mapping
- `epg-suggestions`: Enable EPG suggestions
- `channels-list-smart-sorting`: Enable smart sorting
- `parental-control`: Parental control settings

## File Formats

Supports multiple playlist formats:
- **M3U/M3U8**: Standard playlist format
- **Custom**: Proprietary formats with metadata
- **EPG**: XMLTV and other EPG formats
- **JSON**: Structured data format

## Integration

- Integrates with streamer for playback
- Works with bookmarks and favorites
- Supports parental controls
- Compatible with search and discovery
- EPG data integration 