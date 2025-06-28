# <span style="color: #2e86de;">Internal Modules</span>

This directory contains all the internal modules that power **Megacubo**. Each module is self-contained and follows a consistent structure with its own documentation.

## Core Modules

- [Analytics](./analytics/README.md): Handles anonymous usage analytics and event tracking for app improvement.

- [Bookmarks](./bookmarks/README.md): Manages favorite channels, shortcuts, and desktop icon synchronization.

- [Bridge](./bridge/README.md): Provides communication layer between main process and renderer processes.

- [Channels](./channels/README.md): Core channel management, EPG integration, and channel operations.

- [Cloud](./cloud/README.md): Handles cloud-based configuration and remote data fetching.

- [Config](./config/README.md): Application configuration management and settings persistence.

- [Conn-Racing](./conn-racing/README.md): Connection racing for optimal stream selection and failover.

- [Countries](./countries/README.md): Geographic data and country code management.

- [Crashlog](./crashlog/README.md): Error logging and crash reporting functionality.

- [Diagnostics](./diagnostics/README.md): System diagnostics and performance monitoring tools.

- [Discovery](./discovery/README.md): Automatic discovery of IPTV lists and content sources.

- [Download](./download/README.md): HTTP client and file downloading with caching support.

- [Downloads](./downloads/README.md): Download management and file handling utilities.

- [Energy](./energy/README.md): Power management and system restart functionality.

- [Entries-Group](./entries-group/README.md): Base class for managing grouped entries and collections.

- [FFmpeg](./ffmpeg/README.md): FFmpeg integration for video processing and transcoding.

- [History](./history/README.md): Viewing history tracking and session management.

- [Icon-Server](./icon-server/README.md): Channel icon fetching, processing, and serving.

- [Lang](./lang/README.md): Internationalization and language management.

- [Limiter](./limiter/README.md): Rate limiting and throttling utilities.

- [Line-Reader](./line-reader/README.md): Stream-based line reading and parsing.

- [Lists](./lists/README.md): IPTV list parsing, management, and EPG integration.

- [Mega](./mega/README.md): MEGA cloud storage integration.

- [Menu](./menu/README.md): User interface menu system and navigation.

- [Multi-Worker](./multi-worker/README.md): Multi-threaded worker management for background tasks.

- [Network-IP](./network-ip/README.md): Network interface detection and IP address management.

- [Omni](./omni/README.md): Omnibox search and URL handling.

- [On-Closed](./on-closed/README.md): Connection cleanup and resource management.

- [Options](./options/README.md): Application settings and configuration UI.

- [OSD](./osd/README.md): On-screen display and notification system.

- [Paths](./paths/README.md): File path utilities and directory management.

- [Premium-Helper](./premium-helper/README.md): Premium feature management and activation.

- [Profiles](./profiles/README.md): User profile management and authentication.

- [Promoter](./promoter/README.md): Premium feature promotion and upgrade dialogs.

- [Reader](./reader/README.md): File reading and streaming utilities.

- [Ready](./ready/README.md): Application initialization and ready state management.

- [Recommendations](./recommendations/README.md): Content recommendation engine and algorithm.

- [Search](./search/README.md): Search functionality across channels and content.

- [Serialize](./serialize/README.md): Data serialization and deserialization utilities.

- [Storage](./storage/README.md): Data persistence and storage management.

- [Stream-State](./stream-state/README.md): Stream state tracking and management.

- [Streamer](./streamer/README.md): Core streaming engine and video playback.

- [Subtitles](./subtitles/README.md): Subtitle handling and external subtitle support.

- [Theme](./theme/README.md): UI theming and appearance customization.

- [Trending](./trending/README.md): Trending content detection and ranking.

- [Tuner](./tuner/README.md): Automatic channel tuning and stream testing.

- [Utils](./utils/README.md): General utility functions and helpers.

- [Wizard](./wizard/README.md): Setup wizard and first-time user experience.

- [Writer](./writer/README.md): File writing and data persistence utilities.

- [Zap](./zap/README.md): Channel zapping and quick navigation.

## Module Architecture

Each module follows a consistent structure:

- **Main Module File**: Primary implementation (e.g., `module.js`)
- **Package Configuration**: `package.json` with module metadata
- **Documentation**: `README.md` with detailed module information
- **Renderer Support**: `renderer.js` for UI integration (where applicable)

## Module Dependencies

Modules are designed to be loosely coupled with clear interfaces. Dependencies are managed through:

- **Event-based communication** using Node.js EventEmitter
- **Shared configuration** through the config module
- **Common utilities** provided by the utils module
- **Storage abstraction** through the storage module

## Development Guidelines

When working with these modules:

1. **Follow existing patterns** for consistency
2. **Use EventEmitter** for inter-module communication
3. **Implement proper cleanup** in destroy() methods
4. **Add comprehensive documentation** in README.md files
5. **Test thoroughly** before making changes

## Module Categories

### **Core Infrastructure**
- Bridge, Config, Storage, Utils

### **Content Management**
- Lists, Channels, Discovery, History

### **Media Processing**
- Streamer, FFmpeg, Download, Writer

### **User Interface**
- Menu, Theme, OSD, Options

### **Features**
- Bookmarks, Search, Recommendations, Trending

### **System Services**
- Analytics, Diagnostics, Crashlog, Energy

---

*This modular architecture ensures maintainability, testability, and extensibility of the Megacubo application.* 