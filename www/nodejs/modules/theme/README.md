# Theme Module

A comprehensive theming system that provides dynamic UI theming, color management, and visual customization capabilities.

## Features

- **Dynamic Theming**: Real-time theme switching
- **Color Management**: Advanced color manipulation and blending
- **Background Support**: Image and video backgrounds
- **Font Management**: Dynamic font size and family control
- **Animation Support**: Smooth theme transitions

## Usage

```javascript
import theme from './theme.js';

// Apply theme
await theme.load('dark-theme.json');

// Update colors
theme.update({
    backgroundColor: '#1a1a1a',
    fontColor: '#ffffff',
    animate: true
});

// Get available themes
const themes = await theme.localThemes();
``` 