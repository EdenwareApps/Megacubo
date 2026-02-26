import { EventEmitter } from 'events';

/* A class that limits access to a function to once every X seconds */
class Limiter extends EventEmitter {
    // constructor takes a function and an options object
    constructor(func, options = {}) {
        super();
        const { intervalMs = 5000, async = true, debug = false, initialDelay = 0 } = options
        this.debug = debug
        this.async = async
        this.func = func;
        this.intervalMs = intervalMs;
        this.timeoutId = null; // Timeout ID of the scheduled function call
        this.isPaused = false; // Flag indicating if the limiter is paused
        this.pendingArgs = null; // Always keep the LATEST call pending
        this.initialDelay = initialDelay; // Initial delay before the first call

        // Internal promise to allow multiple callers to await the same pending execution
        this._pendingCallPromise = null;
        this._pendingCallResolve = null;

        const lastCalled = Date.now() - this.intervalMs + this.initialDelay;
        this.lastCalled = lastCalled; // Timestamp of the last time the function was called
    }

    async run(...args) {
        if (this.debug) {
            console.log('Limiter.run called with args:', args);
        }
        this.lastCalled = Date.now()
        if(this.async) {
            await this.func(...args)
            this.lastCalled = Date.now()
        } else {
            this.func(...args)
        }
        this.fromNow()
    }

    // Call the function with arguments, but only if the time interval has elapsed    
    async call(...args) {
        if (this.debug) {
            console.log('Limiter.call called with args:', args, 'isPaused:', this.isPaused, 'lastCalled:', this.lastCalled, 'timeoutId:', !!this.timeoutId);
        }
        // Always update with the latest call
        this.pendingArgs = args;

        if (this.isPaused) {
            if (this.debug) {
                console.log('Limiter.call: paused, setting isPending');
            }
            this.isPending = true;
            return;
        }

        const now = Date.now();
        const timeSinceLastCall = now - this.lastCalled;
        if (this.debug) {
            console.log('Limiter.call: timeSinceLastCall:', timeSinceLastCall, 'intervalMs:', this.intervalMs);
        }

        if (timeSinceLastCall >= this.intervalMs) {
            // Execute immediately if enough time has passed
            if (this.debug) {
                console.log('Limiter.call: executing immediately');
            }
            clearTimeout(this.timeoutId);
            this.timeoutId = null;
            await this.executePending();
            return;
        }
        if (this.timeoutId) {
            if (this.debug) {
                console.log('Limiter.call: timeout already exists, updating pendingArgs only');
            }
        } else {
            // Schedule execution of the latest pending call
            if (this.debug) {
                console.log('Limiter.call: scheduling');
            }
            const timeToWait = this.intervalMs - timeSinceLastCall;
            this.timeoutId = setTimeout(() => {
                if (this.debug) {
                    console.log('Limiter.call timeout fired');
                }
                this.timeoutId = null;
                this.executePending();
            }, timeToWait);
        }
        // Multiple concurrent callers should await the same pending execution
        if (!this._pendingCallPromise) {
            this._pendingCallPromise = new Promise(resolve => { this._pendingCallResolve = resolve })
        }
        await this._pendingCallPromise
        // If timeout already exists, just update pendingArgs (latest call wins)
    }

    async executePending() {
        if (this.debug) {
            console.log('Limiter.executePending called, pendingArgs:', this.pendingArgs);
        }
        if (!this.pendingArgs) {
            if (this.debug) {
                console.log('Limiter.executePending: no pendingArgs');
            }
            return;
        }

        try {
            const args = this.pendingArgs;
            this.pendingArgs = null;
            this.isPending = false;
            if (this.debug) {
                console.log('Limiter.executePending: executing with args:', args);
            }

            await this.run(...args);
            this.emit('called', ...args);
            // Resolve shared pending promise so all awaiters continue
            try {
                if (this._pendingCallResolve) this._pendingCallResolve()
            } finally {
                this._pendingCallResolve = null
                this._pendingCallPromise = null
            }
        } catch (error) {
            console.error('Limiter executePending failed:', error);
            // Even on error, clear pending state to prevent getting stuck
            this.pendingArgs = null;
            this.isPending = false;
        }
    }

    // Pause the limiter, cancel any scheduled function call
    pause() {
        clearTimeout(this.timeoutId);
        this.timeoutId = null;
        this.isPaused = true;
    }
    // Resume the limiter, check if a function call is pending
    resume() {
        this.isPaused = false;
        this.checkQueue();
    }
    // Check if a function call is pending, call immediately if enough time has passed
    checkQueue() {
        if (!this.pendingArgs)
            return;
        if (this.isPaused)
            return;
        const now = Date.now();
        const timeSinceLastCall = now - this.lastCalled;
        if (timeSinceLastCall >= this.intervalMs) {
            this.executePending();
        } else {
            const timeToWait = this.intervalMs - timeSinceLastCall;
            this.timeoutId = setTimeout(async () => {
                this.timeoutId = null
                this.executePending();
            }, timeToWait);
        }
    }
    // Use current time as last called timestamp
    fromNow() {
        clearTimeout(this.timeoutId);
        this.lastCalled = Date.now();
    }
    // Call the function immediately and use current time as last called timestamp
    skip(...args) {
        if (this.debug) {
            console.log('Limiter.skip called with args:', args);
        }
        this.lastCalled = 0;
        this.pendingArgs = args;
        this.executePending();
    }
    // Destroy the limiter, cancel any scheduled function call
    destroy() {
        clearTimeout(this.timeoutId);
        this.timeoutId = null;
    }
}
export default Limiter;
