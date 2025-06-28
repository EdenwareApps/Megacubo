# Analytics Module

A lightweight analytics and event tracking system for collecting usage data and application events.

## Features

- **Event Tracking**: Register and track user actions and application events
- **Data Collection**: Collect anonymous usage statistics and performance metrics
- **Obfuscation**: URL obfuscation for privacy protection
- **Batch Processing**: Efficient batch processing of analytics data
- **Configurable**: Customizable tracking parameters and data retention

## Classes

### AnalyticsBase
Base class providing core analytics functionality:
- Event registration and processing
- Data formatting and obfuscation
- Query string generation for API calls

### AnalyticsEvents
Extends AnalyticsBase with specific event tracking:
- Success/error event logging
- Search query tracking
- Application lifecycle monitoring

### Analytics
Main analytics controller that combines all functionality:
- Unified interface for all analytics operations
- Configuration management
- Data export capabilities

## Usage

```javascript
import analytics from './analytics.js';

// Track user actions
analytics.register('search', { query: 'sports', results: 25 });
analytics.register('stream_start', { url: 'stream_url', duration: 120 });

// Track application events
analytics.success('app_launch');
analytics.error('connection_failed', { error: 'timeout' });
```

## Privacy

- All URLs are obfuscated before transmission
- No personally identifiable information is collected
- Data is aggregated and anonymized
- Configurable data retention policies

## Configuration

- `analytics-enabled`: Enable/disable analytics collection
- `analytics-endpoint`: Custom analytics server endpoint
- `analytics-batch-size`: Number of events to batch before sending
- `analytics-interval`: How often to send batched data 