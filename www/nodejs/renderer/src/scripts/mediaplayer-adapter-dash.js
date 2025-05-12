import {MediaPlayerAdapterHTML5Video} from './mediaplayer-adapter'

class MediaPlayerAdapterHTML5DASH extends MediaPlayerAdapterHTML5Video {
    constructor(container) {
        super(container);
        this.currentSrc = '';
        this.setup('video');
    }

    load(src, mimetype, additionalSubtitles, cookie, mediatype) {
        if (!src) {
            console.error('Bad source', src, mimetype);
            return;
        }

        this.active = true
		this.setVars(src, mimetype, additionalSubtitles, cookie, mediatype)

        if (this.currentSrc !== src) {
            this.currentSrc = src;
            this.currentMimetype = mimetype;
        }

        this.dashPlayer = dashjs.MediaPlayer().create();
        this.dashPlayer.initialize(this.object, this.currentSrc, true);

        this.dashPlayer.on('error', (event) => {
            console.error('DASH ERROR', event);
            this.emit('error', String(event.error), true);
            this.state = '';
            this.emit('state', '');
        });

        this.connect();
    }

    unload() {
        console.log('unload dash');
        if (this.dashPlayer) {
            console.log('unload dash disconnect');
            this.disconnect();
            this.dashPlayer.reset();
            this.dashPlayer = null;
            this.object.src = '';
            console.log('unload dash super.unload');
            super.unload();
            console.log('unload dash OK');
        }
    }

    destroy() {
        console.log('dash destroy');
        this.unload();
        super.destroy();
    }
}

export default MediaPlayerAdapterHTML5DASH
