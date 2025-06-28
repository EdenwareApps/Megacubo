# Line Reader Module

A high-performance line-by-line file reading system that efficiently processes large text files with minimal memory usage.

## Features

- **Streaming**: Process files as streams
- **Memory Efficient**: Low memory footprint
- **Line Events**: Emit events for each line
- **Encoding Support**: Multiple text encodings
- **Error Handling**: Robust error recovery

## Usage

```javascript
import LineReader from './line-reader.js';

const reader = new LineReader({
    file: 'large-file.txt',
    encoding: 'utf8'
});

reader.on('line', (line) => {
    console.log('Processing line:', line);
});

reader.on('end', () => {
    console.log('File processing complete');
});

reader.start();
``` 