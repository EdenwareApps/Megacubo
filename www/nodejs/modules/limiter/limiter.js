/* A class that limits access to a function to once every X seconds */
class Limiter {
    // constructor takes a function and a time interval in seconds
    constructor(func, intervalMs = 5000) {
        this.func = func;
        this.intervalMs = intervalMs;
        this.lastCalled = 0; // Timestamp of the last time the function was called
        this.timeoutId = null; // Timeout ID of the scheduled function call
        this.isPaused = false; // Flag indicating if the limiter is paused
        this.isPending = false; // Flag indicating if the function call is pending
    }
    // Call the function with arguments, but only if the time interval has elapsed
    async call(...args) {
        // Do not call if paused
        if (this.isPaused) {
            this.isPending = true;
            return;
        }
        const now = Date.now();
        const timeSinceLastCall = now - this.lastCalled;
        // Call immediately if enough time has passed since last call
        if (timeSinceLastCall >= this.intervalMs) {
            this.lastCalled = now;
            this.isPending = false;
            this.timeoutId = null;
            await this.func(...args);
            this.fromNow();
        } else if (!this.timeoutId) {
            // Otherwise, schedule a call for when the time interval has elapsed
            const timeToWait = this.intervalMs - timeSinceLastCall;
            this.timeoutId = setTimeout(() => {
                this.lastCalled = Date.now();
                this.isPending = false;
                this.timeoutId = null;
                this.func(...args);
                this.fromNow();
            }, timeToWait);
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
        if (!this.isPending)
            return;
        if (this.isPaused)
            return;
        const now = Date.now();
        const timeSinceLastCall = now - this.lastCalled;
        if (timeSinceLastCall >= this.intervalMs) {
            this.call().catch(console.error);
        } else {
            const timeToWait = this.intervalMs - timeSinceLastCall;
            this.timeoutId = setTimeout(async () => {
                this.lastCalled = Date.now();
                this.isPending = false;
                this.timeoutId = null;
                await this.func();
                this.fromNow();
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
        this.fromNow();
        this.call(...args).catch(console.error);
    }
    // Destroy the limiter, cancel any scheduled function call
    destroy() {
        clearTimeout(this.timeoutId);
        this.timeoutId = null;
    }
}
export default Limiter;
