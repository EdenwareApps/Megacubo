# Streamer Module

A comprehensive media streaming engine that handles video/audio playback, transcoding, and stream management across multiple formats and protocols.

## Features

- **Multi-Format Support**: HLS, DASH, MPEG-TS, AAC, RTMP, and more
- **Transcoding**: Real-time video/audio transcoding with FFmpeg
- **Adaptive Streaming**: Automatic quality switching and buffering
- **Cross-Platform**: Works on desktop, mobile, and web platforms
- **Performance Optimization**: Efficient memory and CPU usage
- **Error Handling**: Robust error recovery and fallback mechanisms
- **Analytics**: Detailed streaming analytics and monitoring

## Architecture

### Core Components

#### Streamer
Main streaming controller that orchestrates all streaming operations:
- Stream lifecycle management
- Format detection and handling
- Error recovery and fallback
- Performance monitoring

#### Engines
Specialized engines for different streaming protocols:
- **HLS Engine**: HTTP Live Streaming support
- **DASH Engine**: Dynamic Adaptive Streaming over HTTP
- **MPEG-TS Engine**: MPEG Transport Stream handling
- **AAC Engine**: Advanced Audio Codec support
- **RTMP Engine**: Real-Time Messaging Protocol
- **YouTube Engine**: YouTube video streaming

#### Adapters
Protocol adapters for different streaming sources:
- **Base Adapter**: Common adapter functionality
- **TS Adapter**: Transport Stream specific handling
- **AAC Adapter**: Audio stream handling

#### Utils
Utility modules for streaming operations:
- **Downloader**: Efficient content downloading
- **Joiner**: Stream segment joining and processing
- **FFmpeg**: FFmpeg integration for transcoding
- **Proxy**: Proxy server for stream manipulation
- **Bitrate Checker**: Real-time bitrate monitoring

## Key Methods

### Stream Management
- `start(url, options)`: Start streaming from URL
- `stop()`: Stop current stream
- `pause()`: Pause/resume streaming
- `seek(time)`: Seek to specific time position

### Quality Control
- `setQuality(quality)`: Set streaming quality
- `getBitrate()`: Get current bitrate
- `getStats()`: Get streaming statistics
- `setBufferSize(size)`: Configure buffer size

### Transcoding
- `enableTranscoding()`: Enable video transcoding
- `setTranscodingProfile(profile)`: Set transcoding settings
- `getTranscodingStats()`: Get transcoding statistics

## Usage

```javascript
import streamer from './streamer.js';

// Start streaming
await streamer.start('https://example.com/stream.m3u8', {
    quality: '720p',
    bufferSize: 10,
    transcoding: true
});

// Control playback
streamer.pause();
streamer.seek(300); // Seek to 5 minutes

// Get statistics
const stats = streamer.getStats();
console.log('Current bitrate:', stats.bitrate);
console.log('Buffer level:', stats.bufferLevel);

// Handle events
streamer.on('quality-change', (quality) => {
    console.log('Quality changed to:', quality);
});

streamer.on('error', (error) => {
    console.error('Streaming error:', error);
});
```

## Supported Formats

### Video Formats
- **H.264/AVC**: Most common video codec
- **H.265/HEVC**: High efficiency video coding
- **VP9**: Google's video codec
- **AV1**: Next-generation video codec

### Audio Formats
- **AAC**: Advanced Audio Codec
- **MP3**: MPEG Audio Layer III
- **Opus**: Modern audio codec
- **AC3**: Dolby Digital

### Container Formats
- **MP4**: MPEG-4 Part 14
- **WebM**: Web Media format
- **MKV**: Matroska Video
- **TS**: MPEG Transport Stream

## Performance Features

### Memory Management
- Efficient buffer management
- Automatic memory cleanup
- Memory usage monitoring
- Garbage collection optimization

### CPU Optimization
- Hardware acceleration support
- Multi-threading for transcoding
- CPU usage monitoring
- Adaptive quality switching

### Network Optimization
- Connection pooling
- Automatic retry mechanisms
- Bandwidth monitoring
- Adaptive bitrate streaming

## Error Handling

### Recovery Mechanisms
- Automatic stream restart
- Quality degradation on errors
- Fallback to alternative sources
- Graceful error reporting

### Error Types
- **Network Errors**: Connection issues
- **Format Errors**: Unsupported formats
- **Transcoding Errors**: Processing failures
- **Hardware Errors**: Device limitations

## Configuration

### Streaming Settings
- `live-stream-fmt`: Preferred live stream format
- `transcoding`: Enable/disable transcoding
- `transcoding-resolution`: Target resolution
- `buffer-size`: Buffer size in seconds

### Performance Settings
- `gpu`: Enable GPU acceleration
- `gpu-flags`: GPU-specific flags
- `tune-concurrency`: Concurrency settings
- `mpegts-use-worker`: Use worker threads

## Integration

- Integrates with all media modules
- Provides unified streaming interface
- Supports custom streaming protocols
- Enables advanced media features 