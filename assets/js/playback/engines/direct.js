
function createDirectIntent(entry, options){

    var transcode = typeof(entry.transcode) == 'boolean' && entry.transcode || Config.get('transcode-policy') == 'always'
    if(transcode && typeof(createFFmpegIntent) == 'function'){
        return createFFmpegIntent(entry.options)
    }

    var self = createBaseIntent();
    self.type = 'direct';
    self.entry = entry;
    self.streamURL = false;
    self.tester = false;
    self.streamType = getMediaType(self.entry)
        
    self.commit = () => {
        jQuery('#player').removeClass('hide').addClass('show')
        self.playback.connect(self.streamURL, self.mimetype)
        self.getVideo()
        self.attached = true
    }
    
    self.runConfirm = () => {
        self.streamURL = self.entry.url
        if(!isM3U8(self.streamURL)){
            self.mimetype = 'video/mp4; codecs="avc1.4D401E, mp4a.40.2"'
        }
        self.resetTimeout()
        self.test((worked) => {
            if(worked){
                self.started = true
                self.trigger('start', self)
            } else {
                self.error = 'playback'
                self.trigger('error')
            }
        })
    }

    self.run = () => {    
        if(isLocal(self.entry.url)){
            self.runConfirm()
        } else if(isHTTP(self.entry.url)){
            self.ping((result) => {
                if(!self.error && !self.ended){
                    console.log('Content-Type', self.entry.url, result);
                    if(self.validateContentType(result.type) && self.validateStatusCode(result.status)){
                        // OK
                        self.runConfirm()
                    } else if(!self.started) {
                        console.error('Bad HTTP response for '+self.type, result);
                        self.error = status || 'connect';
                        self.trigger('error')
                    }
                }
            })        
        } else {
            console.error('Not HTTP(s)', self.entry.url);
            self.error = 'invalid';
            self.trigger('error')
        }
    }
    
    if(options){
        self.apply(options)
    }

    return self;

}
