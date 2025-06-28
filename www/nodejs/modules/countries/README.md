# Countries Module

A comprehensive country and geographic data management system that provides country information, language support, and geographic calculations.

## Features

- **Country Database**: Complete country information database
- **Language Support**: Multi-language country names
- **Geographic Calculations**: Distance and location calculations
- **Timezone Support**: Country timezone information
- **Search & Filter**: Advanced country search capabilities

## Usage

```javascript
import countries from './countries.js';

// Get country information
const country = countries.getCountry('US');
console.log(country.name); // United States

// Get country name in different language
const name = countries.getCountryName('US', 'es');
console.log(name); // Estados Unidos

// Calculate distance between countries
const distance = countries.getDistance('US', 'CA');
console.log(distance); // Distance in km

// Find nearest countries
const nearest = countries.getNearest('US', ['CA', 'MX', 'BR'], 2);
``` 