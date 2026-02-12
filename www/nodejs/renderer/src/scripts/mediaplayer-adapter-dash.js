import {MediaPlayerAdapterHTML5Video} from './mediaplayer-adapter'
import dashjs from 'dashjs'

// Helper function to safely check if dashjs is available
const isDashjsAvailable = () => {
        return typeof dashjs !== 'undefined' && 
               typeof dashjs.MediaPlayer === 'function' &&
               typeof dashjs.MediaPlayer().create === 'function'
}

class MediaPlayerAdapterHTML5DASH extends MediaPlayerAdapterHTML5Video {
    constructor(container) {
        super(container);
        this.currentSrc = '';
        this.dashPlayer = null;
        this.errorListener = null;
        this.setup('video');
    }

    load(src, mimetype, additionalSubtitles, cookie, mediatype) {
        if (!src) {
            console.error('Bad source', src, mimetype);
            this.emit('error', 'Invalid source', true);
            return;
        }

        // Verify dashjs is available
        if (!isDashjsAvailable()) {
            console.error('dashjs library is not loaded');
            this.emit('error', 'DASH library not available', true);
            return;
        }

        if (!this.object) {
            console.error('Cannot load: object is null');
            this.emit('error', 'Media element not available', true);
            return;
        }

        this.active = true
		this.setVars(src, mimetype, additionalSubtitles, cookie, mediatype)

        if (this.currentSrc !== src) {
            this.currentSrc = src;
            this.currentMimetype = mimetype;
        }

        // CRITICAL: Destroy existing dash player before creating a new one to prevent memory leaks
        if (this.dashPlayer) {
            console.warn('DASH player already exists, destroying before creating new one');
            try {
                // Remove error listener before destroying
                if (this.errorListener) {
                    this.dashPlayer.off('error', this.errorListener);
                }
                this.dashPlayer.reset();
                this.dashPlayer.destroy();
            } catch (e) {
                console.error('Error destroying previous DASH player:', e);
            }
            this.dashPlayer = null;
            this.errorListener = null;
        }

        try {
            this.dashPlayer = dashjs.MediaPlayer().create();
            if (!this.dashPlayer) {
                throw new Error('Failed to create DASH player');
            }

            // Create error listener function
            this.errorListener = (event) => {
                if (!this.active || !this.dashPlayer) {
                    return;
                }

                try {
                    // Normalize error data structure
                    const errorInfo = {
                        error: event?.error || event?.message || event,
                        type: event?.type,
                        code: event?.code
                    };
                    
                    console.error('DASH ERROR', errorInfo);
                    
                    const errorMessage = errorInfo.error ? String(errorInfo.error) : 'DASH playback error';
                    this.emit('error', errorMessage, true);
                    this.setState('')
                    this.emit('state', '')
                } catch (e) {
                    console.error('Error in DASH error handler:', e);
                }
            };

            this.dashPlayer.on('error', this.errorListener);
            this.dashPlayer.initialize(this.object, this.currentSrc, true);
        } catch (createError) {
            console.error('Error creating/initializing DASH player:', createError);
            this.emit('error', 'Failed to create DASH player', true);
            this.setState('')
            this.dashPlayer = null;
            this.errorListener = null;
            return;
        }

        try {
            this.connect();
        } catch (connectError) {
            console.error('Error in connect():', connectError);
            // Don't fail completely, player might still work
        }
    }

    unload() {
        console.log('unload dash');
        
        // Clear operation flags
        this.active = false;
        
        if (this.dashPlayer) {
            console.log('unload dash disconnect');
            
            try {
                this.disconnect();
            } catch (e) {
                console.error('Error in disconnect() during unload():', e);
            }
            
            try {
                // Remove error listener before reset/destroy
                if (this.errorListener && typeof this.dashPlayer.off === 'function') {
                    this.dashPlayer.off('error', this.errorListener);
                }
            } catch (e) {
                console.error('Error removing error listener:', e);
            }
            
            try {
                if (typeof this.dashPlayer.reset === 'function') {
                    this.dashPlayer.reset();
                }
            } catch (e) {
                console.error('Error resetting DASH player:', e);
            }
            
            try {
                if (typeof this.dashPlayer.destroy === 'function') {
                    this.dashPlayer.destroy();
                }
            } catch (e) {
                console.error('Error destroying DASH player:', e);
            }
            
            this.dashPlayer = null;
            this.errorListener = null;
            
            if (this.object) {
                try {
                    this.object.src = '';
                } catch (e) {
                    console.warn('Error clearing object src:', e);
                }
            }
            
            console.log('unload dash super.unload');
            try {
                super.unload();
            } catch (e) {
                console.error('Error in super.unload():', e);
            }
            console.log('unload dash OK');
        }
    }

    destroy() {
        console.log('dash destroy');
        try {
            this.unload();
        } catch (e) {
            console.error('Error in unload() during destroy():', e);
        }
        try {
            super.destroy();
        } catch (e) {
            console.error('Error in super.destroy():', e);
        }
    }
}

export default MediaPlayerAdapterHTML5DASH
