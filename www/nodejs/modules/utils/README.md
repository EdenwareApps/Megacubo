# Utils Module

A comprehensive utility library that provides common helper functions, data manipulation tools, and system utilities used throughout the application.

## Features

- **Data Manipulation**: Array, object, and string utilities
- **System Utilities**: Platform detection and system information
- **Validation**: Data validation and sanitization
- **Formatting**: Text and data formatting utilities
- **Performance**: Performance monitoring and optimization tools

## Usage

```javascript
import utils from './utils.js';

// Array utilities
const unique = utils.unique([1, 2, 2, 3]);
const sorted = utils.sortByProp(array, 'name');

// String utilities
const terms = utils.terms('Hello World');
const clean = utils.cleanString('dirty string');

// System utilities
const platform = utils.platform();
const isMobile = utils.isMobile();
``` 