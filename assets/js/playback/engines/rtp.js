
class PlaybackRtpIntent extends PlaybackTranscodeIntent {    // RTSP|RTMP
    constructor(entry, options){
        super(entry, options)
        this.type = 'rtp';
    }
}

PlaybackRtpIntent.supports = (entry) => {
    return entry.url.match(new RegExp('^(rtmp|rtsp|rtp|mms)[a-z]?:', 'i'))
}

Playback.registerEngine('rtp', PlaybackRtpIntent, 2)
