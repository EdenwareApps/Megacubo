# Discovery Module

A content discovery system that finds and manages public and community playlists, channels, and content sources with health monitoring and quality assessment.

## Features

- **Content Discovery**: Find public and community content
- **Health Monitoring**: Monitor content source health
- **Quality Assessment**: Assess content quality and reliability
- **Provider System**: Extensible provider architecture
- **Community Lists**: Community-curated content lists

## Usage

```javascript
import discovery from './discovery.js';

// Discover content
const lists = await discovery.get(20, ['public', 'community']);

// Get provider details
const provider = discovery.getProvider('public', 'iptv-org');

// Update discovery
await discovery.update(provider, 'public');
``` 