# Icon Server Module

A high-performance icon and image management system that handles channel logos, thumbnails, and image processing with caching and optimization.

## Features

- **Icon Management**: Handle channel logos and icons
- **Image Processing**: Resize, crop, and optimize images
- **Caching**: Intelligent image caching with expiration
- **Search**: Search for icons by channel name
- **Fallback System**: Automatic fallback to default icons

## Usage

```javascript
import iconServer from './icon-server.js';

// Get channel icon
const icon = await iconServer.get(channelEntry);

// Search for icons
const results = await iconServer.search('sports');

// Process image
await iconServer.processImage('input.png', 'output.png', {
    width: 100,
    height: 100,
    quality: 80
});
``` 