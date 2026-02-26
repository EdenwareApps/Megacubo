# Limiter Module

A rate limiting system that controls the frequency of operations to prevent resource exhaustion and ensure proper usage.

## Overview

The Limiter is a class that ensures a function is executed at most once per specified time interval. When multiple calls are made, only the most recent call is kept pending and executed after the required interval.

## Features

- **Rate Limiting**: Controls the execution frequency of operations
- **Last Call Wins**: Only the most recent call is kept in the queue
- **Async Support**: Full async/await support
- **Pause/Resume**: Manual control over execution
- **Events**: Emits events after each execution
- **Debug Mode**: Debug mode for detailed tracing

## Installation

```javascript
import Limiter from './limiter.js';
```

## Constructor

### `new Limiter(func, options)`

Creates a new Limiter instance.

**Parameters:**

- `func` (Function): The function to be executed with rate limiting
- `options` (Object): Optional configuration
  - `intervalMs` (Number): Minimum interval between executions in milliseconds (default: 5000)
  - `async` (Boolean): If true, waits for function completion before updating lastCalled (default: true)
  - `debug` (Boolean): Enables detailed debug logs (default: false)
  - `initialDelay` (Number): Initial delay before the first call in milliseconds (default: 0)

**Example:**

```javascript
const limiter = new Limiter(
    async (url) => {
        return await fetch(url);
    },
    {
        intervalMs: 2000,
        async: true,
        debug: false,
        initialDelay: 1000
    }
);
```

## Methods

### `call(...args)`

Calls the function with rate limiting. If the minimum interval hasn't passed, schedules execution. Only the most recent call is kept pending.

**Parameters:**
- `...args`: Arguments to be passed to the function

**Returns:** Promise that resolves when the function is executed

**Example:**

```javascript
// Multiple calls - only the last will be executed
await limiter.call('https://api.example.com/data1');
await limiter.call('https://api.example.com/data2');
await limiter.call('https://api.example.com/data3'); // This one will be executed
```

### `run(...args)`

Executes the function immediately, bypassing the rate limit. Updates the last called timestamp.

**Parameters:**
- `...args`: Arguments to be passed to the function

**Returns:** Promise (if async is true)

**Example:**

```javascript
// Execute immediately
await limiter.run('https://api.example.com/urgent');
```

### `skip(...args)`

Executes the function immediately without considering the interval, resetting the last called timestamp.

**Parameters:**
- `...args`: Arguments to be passed to the function

**Example:**

```javascript
// Force immediate execution
limiter.skip('https://api.example.com/priority');
```

### `pause()`

Pauses the limiter, canceling any scheduled execution.

**Example:**

```javascript
limiter.pause();
```

### `resume()`

Resumes the limiter and checks for pending calls in the queue.

**Example:**

```javascript
limiter.resume();
```

### `checkQueue()`

Checks for pending calls and executes them if the required interval has passed.

**Example:**

```javascript
limiter.checkQueue();
```

### `fromNow()`

Resets the last called timestamp to the current moment, effectively restarting the interval.

**Example:**

```javascript
limiter.fromNow();
```

### `destroy()`

Destroys the limiter, canceling any scheduled execution and freeing resources.

**Example:**

```javascript
limiter.destroy();
```

## Events

The Limiter extends EventEmitter and emits the following events:

### `called`

Emitted after each successful function execution.

**Example:**

```javascript
limiter.on('called', (...args) => {
    console.log('Function executed with arguments:', args);
});
```

## Usage Examples

### API Rate Limiting

```javascript
import Limiter from './limiter.js';

// Limit requests to 1 every 2 seconds
const apiLimiter = new Limiter(
    async (endpoint) => {
        const response = await fetch(endpoint);
        return await response.json();
    },
    { intervalMs: 2000 }
);

// Usage
await apiLimiter.call('https://api.example.com/users');
await apiLimiter.call('https://api.example.com/posts'); // Will execute after 2s
```

### Auto-save with Debounce

```javascript
const autoSaveLimiter = new Limiter(
    async (data) => {
        await saveToDatabase(data);
        console.log('Data saved!');
    },
    { intervalMs: 3000 }
);

// Multiple edits - only the last will be saved
document.addEventListener('input', (e) => {
    const data = e.target.value;
    autoSaveLimiter.call(data); // Automatic debounce
});
```

### UI Update Control

```javascript
const uiUpdateLimiter = new Limiter(
    (state) => {
        updateUI(state);
    },
    { 
        intervalMs: 100,
        async: false // Synchronous function
    }
);

// Multiple state updates
uiUpdateLimiter.call(newState1);
uiUpdateLimiter.call(newState2);
uiUpdateLimiter.call(newState3); // This one will be applied
```

### Pause and Resume

```javascript
const taskLimiter = new Limiter(
    async (task) => {
        console.log('Executing task:', task);
    },
    { intervalMs: 1000 }
);

// Pause during critical operation
taskLimiter.pause();
await criticalOperation();
taskLimiter.resume(); // Continue processing
```

### Debug Mode

```javascript
const debugLimiter = new Limiter(
    async (data) => {
        return await processData(data);
    },
    { 
        intervalMs: 1000,
        debug: true // Enable detailed logs
    }
);

await debugLimiter.call('test');
// Console: "Limiter.call called with args: ['test'] isPaused: false..."
```

## Queue Behavior

The Limiter uses a "last call wins" strategy:

1. When `call()` is invoked, arguments replace any previous pending call
2. Only the most recent call is kept in the queue
3. Multiple callers can await the same pending execution
4. After execution, all callers are notified

**Example:**

```javascript
// All calls below will await the same execution
const promise1 = limiter.call('arg1'); // Replaced
const promise2 = limiter.call('arg2'); // Replaced
const promise3 = limiter.call('arg3'); // This one will be executed

await Promise.all([promise1, promise2, promise3]);
// Only 'arg3' is passed to the function
```

## Important Notes

- **Async vs Sync**: If `async: true`, the Limiter waits for the function to complete before updating `lastCalled`. If `async: false`, updates immediately.
- **Memory Management**: Always call `destroy()` when you no longer need the limiter to free resources.
- **Error Handling**: Errors in the executed function are caught and logged, but do not interrupt the limiter's operation.
- **Timezone**: Uses `Date.now()` for timestamps, independent of timezone.

## Use Cases

- HTTP request rate limiting
- User input debouncing
- UI update throttling
- Auto-save control
- I/O operation limiting
- Resource exhaustion prevention

## License

This module is part of the Megacubo project. 