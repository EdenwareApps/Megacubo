/* A class that limits access to a function to once every X seconds */
class Limiter {
    // constructor takes a function and a time interval in seconds
    constructor(func, intervalMs = 5000, _async=true) {
        this.async = _async
        this.func = func;
        this.intervalMs = intervalMs;
        this.lastCalled = 0; // Timestamp of the last time the function was called
        this.timeoutId = null; // Timeout ID of the scheduled function call
        this.isPaused = false; // Flag indicating if the limiter is paused
        this.pendingArgs = null; // Always keep the LATEST call pending
    }

    async run(...args) {
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
        // Always update with the latest call
        this.pendingArgs = args;

        if (this.isPaused) {
            this.isPending = true;
            return;
        }

        const now = Date.now();
        const timeSinceLastCall = now - this.lastCalled;

        if (timeSinceLastCall >= this.intervalMs) {
            // Execute immediately if enough time has passed
            clearTimeout(this.timeoutId);
            this.timeoutId = null;
            this.pendingArgs = null;
            await this.executePending();
        } else if (!this.timeoutId) {
            // Schedule execution of the latest pending call
            const timeToWait = this.intervalMs - timeSinceLastCall;
            this.timeoutId = setTimeout(() => {
                this.timeoutId = null;
                this.executePending();
            }, timeToWait);
        }
        // If timeout already exists, just update pendingArgs (latest call wins)
    }

    async executePending() {
        if (!this.pendingArgs) return;

        try {
            const args = this.pendingArgs;
            this.pendingArgs = null;
            this.isPending = false;

            await this.run(...args);
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
