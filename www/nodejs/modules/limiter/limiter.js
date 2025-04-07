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
        this.isPending = false; // Flag indicating if the function call is pending
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
        // Do not call if paused
        if (this.isPaused) {
            this.isPending = true
            return
        }
        const now = Date.now();
        const timeSinceLastCall = now - this.lastCalled;
        // Call immediately if enough time has passed since last call
        if (timeSinceLastCall >= this.intervalMs) {
            clearTimeout(this.timeoutId);
            this.lastCalled = now;
            this.isPending = false;
            this.timeoutId = null;
            await this.run(...args).catch(err => console.error(err))
            this.lastCalled = Date.now()
        } else if (!this.timeoutId) {
            // Otherwise, schedule a call for when the time interval has elapsed
            const timeToWait = this.intervalMs - timeSinceLastCall;
            this.timeoutId = setTimeout(() => {
                this.lastCalled = now;
                this.isPending = false;
                this.timeoutId = null;
                this.run(...args).catch(err => console.error(err)).finally(() => {
                    this.lastCalled = Date.now()
                })
            }, timeToWait)
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
            this.call().catch(err => console.error(err))
        } else {
            const timeToWait = this.intervalMs - timeSinceLastCall;
            this.timeoutId = setTimeout(async () => {
                this.timeoutId = null
                this.call().catch(err => console.error(err))
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
        this.call(...args).catch(err => console.error(err));
    }
    // Destroy the limiter, cancel any scheduled function call
    destroy() {
        clearTimeout(this.timeoutId);
        this.timeoutId = null;
    }
}
export default Limiter;
