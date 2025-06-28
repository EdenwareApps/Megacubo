# Limiter Module

A rate limiting and throttling system that controls the frequency of operations to prevent resource exhaustion and ensure fair usage.

## Features

- **Rate Limiting**: Control operation frequency
- **Throttling**: Limit concurrent operations
- **Queue Management**: Manage operation queues
- **Configurable Limits**: Set custom rate limits
- **Async Support**: Full async/await support

## Usage

```javascript
import Limiter from './limiter.js';

const limiter = new Limiter(async (data) => {
    return await processData(data);
}, 1000); // 1 second interval

// Execute with rate limiting
const result = await limiter.run(data);

// Check queue status
const queueSize = limiter.checkQueue();
``` 