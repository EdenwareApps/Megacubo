# Multi-Worker Module

A multi-threaded worker system that provides parallel processing capabilities for CPU-intensive tasks like playlist parsing, EPG processing, and content indexing.

## Features

- **Parallel Processing**: Multi-threaded task execution
- **Worker Pool**: Manage worker thread pools
- **Task Distribution**: Distribute tasks across workers
- **Resource Management**: Efficient resource allocation
- **Error Handling**: Robust error recovery

## Usage

```javascript
import workers from './multi-worker.js';

// Load worker
const worker = workers.load('parser-worker.js');

// Execute task
const result = await worker.execute({
    type: 'parse-playlist',
    data: playlistContent
});

// Terminate worker
worker.terminate();
``` 