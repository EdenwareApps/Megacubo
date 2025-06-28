# History Module

A comprehensive history tracking system that manages user viewing history, EPG history, and provides recommendations based on viewing patterns.

## Features

- **Viewing History**: Track watched channels and content
- **EPG History**: Track program viewing history
- **Session Management**: Manage viewing sessions
- **Recommendations**: Provide content recommendations
- **Analytics**: Viewing statistics and analytics

## Usage

```javascript
import history from './history.js';

// Add to history
await history.add({
    name: 'Sports Channel',
    url: 'stream_url',
    duration: 3600
});

// Get viewing history
const entries = await history.entries();

// Get recommendations
const recommendations = await history.getRecommendations();
``` 