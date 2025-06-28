# Bridge Module

A cross-platform communication bridge system that enables seamless communication between different processes, platforms, and environments (Node.js, Electron, Android, Web).

## Features

- **Multi-Platform Support**: Works across Node.js, Electron, Android, and Web browsers
- **Process Communication**: Enables communication between main and renderer processes
- **Event System**: Full event emitter functionality across platforms
- **File Operations**: Cross-platform file handling and clipboard operations
- **Authentication**: Secure communication with secret-based authentication
- **Fallback Support**: Automatic fallback mechanisms for different environments

## Classes

### BridgeServer
Core server implementation for handling communication:
- Event routing and dispatching
- Authentication and security
- File serving capabilities
- Platform detection

### BridgeUtils
Utility functions extending BridgeServer:
- Clipboard operations
- File resolution and import
- Electron window management
- Cross-platform compatibility

### Bridge
Main bridge controller combining all functionality:
- Unified API for all platforms
- Event management
- Lifecycle management

### BridgeController
High-level controller for bridge operations:
- Ready state management
- Event binding
- UI integration

## Platform Support

### Node.js
- Direct event emitter communication
- File system operations
- Process management

### Electron
- IPC (Inter-Process Communication) between main and renderer
- Window management
- Native dialog integration

### Android (Capacitor)
- Capacitor bridge integration
- Native Android API access
- Clipboard and file operations

### Web Browser
- WebSocket fallback
- Local storage integration
- Browser API compatibility

## Usage

```javascript
import bridge from './bridge.js';

// Listen for events
bridge.on('data-received', (data) => {
    console.log('Received:', data);
});

// Emit events
bridge.emit('send-data', { message: 'Hello from renderer' });

// Wait for bridge to be ready
bridge.ready(() => {
    console.log('Bridge is ready');
});

// Platform-specific operations
await bridge.clipboard('Text to copy');
const file = await bridge.resolveFileFromClient(fileData);
```

## Configuration

- `bridge-secret`: Secret key for authentication
- `bridge-timeout`: Communication timeout in milliseconds
- `bridge-retries`: Number of retry attempts for failed operations
- `bridge-debug`: Enable debug logging

## Security

- Secret-based authentication
- Input validation and sanitization
- Secure file operations
- Platform-specific security measures

## Integration

- Integrates with all major application modules
- Provides unified communication layer
- Supports custom event handlers
- Enables cross-platform feature parity 