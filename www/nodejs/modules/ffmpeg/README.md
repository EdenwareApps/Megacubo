# FFmpeg Module

A comprehensive FFmpeg integration module that provides video/audio processing, transcoding, and media analysis capabilities.

## Features

- **Video Transcoding**: Convert between video formats
- **Audio Processing**: Audio format conversion and processing
- **Media Analysis**: Extract media information and metadata
- **Thumbnail Generation**: Create video thumbnails
- **Hardware Acceleration**: GPU-accelerated processing
- **Cross-Platform**: Works on Windows, macOS, and Linux

## Usage

```javascript
import ffmpeg from './ffmpeg.js';

// Get media information
const info = await ffmpeg.info('video.mp4');
console.log('Duration:', info.duration);
console.log('Resolution:', info.dimensions);

// Transcode video
await ffmpeg.create('input.mp4', {
    output: 'output.mkv',
    videoCodec: 'h264',
    audioCodec: 'aac',
    resolution: '720p'
});

// Generate thumbnail
await ffmpeg.thumbnail('video.mp4', 'thumb.jpg', {
    time: '00:01:30',
    size: '320x240'
});
``` 