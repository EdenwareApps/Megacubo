# Language Module

A comprehensive internationalization (i18n) system that provides multi-language support, locale detection, and text translation capabilities.

## Features

- **Multi-Language Support**: Support for 20+ languages
- **Automatic Detection**: Detect user's preferred language
- **Dynamic Loading**: Load language files on demand
- **Country Support**: Country-specific language variants
- **Fallback System**: Graceful fallback to default language

## Usage

```javascript
import lang from './lang.js';

// Load language
await lang.load('en');

// Get translated text
const text = lang.getText('CHANNELS');
console.log(text); // "Channels"

// Get available languages
const languages = await lang.availableLocalesMap();

// Detect user language
const detected = await lang.findCountryCode();
``` 