# Connection Racing Module

A high-performance connection testing and racing system that tests multiple URLs simultaneously to find the fastest and most reliable connection.

## Features

- **Parallel Testing**: Test multiple URLs concurrently
- **Connection Racing**: Race connections to find fastest
- **Automatic Retry**: Retry failed connections
- **Performance Metrics**: Measure response times and reliability
- **Configurable Limits**: Set concurrency and timeout limits

## Usage

```javascript
import ConnRacing from './conn-racing.js';

const racing = new ConnRacing([
    'https://server1.com/stream',
    'https://server2.com/stream',
    'https://server3.com/stream'
], {
    retries: 3,
    timeout: 5000
});

const result = await racing.start();
console.log('Fastest server:', result.url);
``` 