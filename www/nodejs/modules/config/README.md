# Config Module

A robust configuration management system that handles application settings, user preferences, and dynamic configuration updates across the entire application.

## Features

- **Configuration Management**: Centralized configuration storage and retrieval
- **Dynamic Updates**: Real-time configuration changes without restart
- **Validation**: Type checking and validation of configuration values
- **Persistence**: Automatic saving and loading of configuration
- **Defaults**: Comprehensive default configuration values
- **Events**: Event-driven configuration change notifications
- **Migration**: Automatic configuration migration and upgrades

## Classes

### Config
Main configuration manager extending EventEmitter:
- Configuration CRUD operations
- Event emission for changes
- Validation and type checking
- Persistence management

## Key Methods

### Configuration Operations
- `get(key)`: Retrieve configuration value
- `set(key, value)`: Set configuration value
- `setMulti(attributes)`: Set multiple values at once
- `all()`: Get all configuration values
- `keys()`: Get all configuration keys

### Persistence
- `save()`: Save configuration to disk
- `load(txt)`: Load configuration from text
- `reload(txt)`: Reload configuration with validation
- `reset()`: Reset to default values

### Validation
- `equal(a, b)`: Compare configuration values
- Type checking for different data types
- Validation of configuration structure

## Usage

```javascript
import config from './config.js';

// Get configuration value
const volume = config.get('volume');
const theme = config.get('theme-name');

// Set configuration value
config.set('volume', 75);
config.set('theme-name', 'dark');

// Set multiple values
config.setMulti({
    'volume': 80,
    'font-size': 14,
    'background-color': '#000000'
});

// Listen for changes
config.on('change', (keys, data) => {
    console.log('Configuration changed:', keys);
});

// Get all configuration
const allConfig = config.all();
```

## Configuration Structure

### Default Configuration
Located in `defaults.json`, includes:
- **UI Settings**: Theme, font, colors, layout
- **Playback Settings**: Volume, quality, transcoding
- **Network Settings**: Timeouts, retries, connections
- **Feature Flags**: Enable/disable features
- **Platform Settings**: Platform-specific configurations

### Configuration Categories

#### User Interface
- `theme-name`: Active theme
- `font-size`: Font size setting
- `background-color`: Background color
- `view-size`: Grid layout configuration

#### Playback
- `volume`: Audio volume level
- `live-stream-fmt`: Live stream format preference
- `transcoding`: Transcoding settings
- `playback-rate-control`: Playback speed control

#### Network
- `connect-timeout`: Connection timeout
- `read-timeout`: Read timeout
- `use-keepalive`: Keep-alive connections
- `preferred-ip-version`: IP version preference

#### Features
- `epg`: EPG configuration
- `parental-control`: Parental control settings
- `subtitles`: Subtitle settings
- `gpu`: GPU acceleration settings

## Configuration Persistence

### Storage Locations
- **Desktop**: User-specific configuration
- **Application**: Application-wide settings
- **Platform**: Platform-specific settings

### File Formats
- **JSON**: Primary configuration format
- **Environment Variables**: System-level overrides
- **Command Line**: Runtime overrides

## Event System

### Configuration Events
- `change`: Emitted when configuration changes
- `save`: Emitted when configuration is saved
- `load`: Emitted when configuration is loaded
- `reset`: Emitted when configuration is reset

### Event Data
- `keys`: Array of changed configuration keys
- `data`: Object containing new configuration values
- `previous`: Previous configuration values

## Validation and Type Safety

### Type Checking
- Automatic type detection and validation
- Type conversion when possible
- Error handling for invalid types

### Validation Rules
- Range validation for numeric values
- Enum validation for predefined values
- Format validation for strings
- Structure validation for objects

## Integration

- Used by all application modules
- Provides unified configuration access
- Supports hot-reloading of configuration
- Enables dynamic feature toggling 