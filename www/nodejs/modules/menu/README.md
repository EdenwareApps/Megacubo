# Menu Module

A comprehensive user interface and navigation system that provides a modern, responsive menu interface with advanced features like virtual scrolling, keyboard navigation, and dynamic content rendering.

## Features

- **Virtual Scrolling**: Efficient rendering of large lists with virtual scrolling
- **Keyboard Navigation**: Full keyboard support with customizable shortcuts
- **Responsive Design**: Adaptive layout for different screen sizes
- **Dynamic Rendering**: Real-time content updates and filtering
- **Accessibility**: Full accessibility support with screen readers
- **Customizable Themes**: Theme support with dynamic styling
- **Sound Effects**: Audio feedback for user interactions
- **Performance Optimization**: Optimized rendering and memory usage

## Architecture

### Core Components

#### MenuBase
Base menu functionality:
- Event handling and management
- Clipboard operations
- Cross-platform compatibility
- Basic UI operations

#### MenuIcons
Icon management system:
- Dynamic icon loading
- Icon caching and optimization
- Cover image support
- Icon fallback mechanisms

#### MenuScrolling
Advanced scrolling capabilities:
- Virtual scrolling implementation
- Smooth scrolling animations
- Scroll position management
- Performance optimization

#### MenuBBCode
Rich text rendering:
- BBCode parsing and rendering
- Text formatting and styling
- Color and font support
- Dynamic text effects

#### MenuPlayer
Media player integration:
- Player state management
- Fullscreen support
- Aspect ratio handling
- Player controls integration

## Key Methods

### Navigation
- `navigate(path)`: Navigate to specific path
- `back()`: Navigate back
- `select(index)`: Select item by index
- `focus(element)`: Focus specific element

### Rendering
- `render(entries, path)`: Render menu entries
- `update()`: Update current view
- `refresh()`: Refresh entire menu
- `filter(criteria)`: Filter displayed items

### Interaction
- `action(element)`: Handle user actions
- `open(element)`: Open selected item
- `check(element)`: Toggle checkboxes
- `slider(element)`: Handle slider controls

## Usage

```javascript
import menu from './menu.js';

// Render menu items
menu.render([
    { name: 'Home', type: 'group', path: '/' },
    { name: 'Channels', type: 'group', path: '/channels' },
    { name: 'Settings', type: 'action', path: '/settings' }
], '/');

// Handle navigation
menu.on('navigate', (path) => {
    console.log('Navigated to:', path);
});

// Handle selections
menu.on('select', (item) => {
    console.log('Selected:', item.name);
});

// Handle actions
menu.on('action', (action, data) => {
    console.log('Action:', action, data);
});
```

## UI Features

### Virtual Scrolling
- **Efficient Rendering**: Only render visible items
- **Smooth Scrolling**: 60fps scrolling performance
- **Memory Optimization**: Minimal memory usage
- **Dynamic Loading**: Load content on demand

### Keyboard Navigation
- **Arrow Keys**: Navigate through items
- **Enter**: Select/activate item
- **Escape**: Cancel/back
- **Custom Shortcuts**: Configurable key bindings

### Responsive Design
- **Grid Layout**: Adaptive grid system
- **Portrait/Landscape**: Orientation support
- **Touch Support**: Touch-friendly interface
- **High DPI**: Retina display support

## Performance Features

### Rendering Optimization
- **Virtual Scrolling**: Only render visible items
- **Lazy Loading**: Load content on demand
- **Caching**: Cache rendered elements
- **Debouncing**: Optimize frequent updates

### Memory Management
- **Element Pooling**: Reuse DOM elements
- **Event Delegation**: Efficient event handling
- **Garbage Collection**: Automatic cleanup
- **Memory Monitoring**: Track memory usage

## Accessibility

### Screen Reader Support
- **ARIA Labels**: Proper accessibility labels
- **Focus Management**: Logical focus order
- **Keyboard Navigation**: Full keyboard support
- **High Contrast**: High contrast mode support

### Assistive Technologies
- **Voice Control**: Voice command support
- **Switch Control**: Switch navigation support
- **Magnification**: Zoom and magnification
- **Color Blindness**: Color blind friendly design

## Configuration

### UI Settings
- `view-size`: Grid layout configuration
- `font-size`: Font size setting
- `theme-name`: Active theme
- `ui-sounds`: Enable/disable sound effects

### Navigation Settings
- `fx-nav-intensity`: Navigation animation intensity
- `uppercase-menu`: Menu text case
- `hide-back-button`: Hide back button
- `status-flags-type`: Status flag display type

## Integration

- Integrates with all application modules
- Provides unified UI interface
- Supports custom themes and styling
- Enables advanced user interactions 