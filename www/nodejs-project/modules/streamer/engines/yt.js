const StreamerHLSIntent = require('./hls.js'), fs = require('fs'), ytdl = require('ytdl-core')
const StreamerProxy = require('../utils/proxy.js'), StreamerHLSProxy = require('../utils/proxy-hls.js')
const YTRegex = new RegExp('(youtube\.com|youtu\.be).*(v=|v/)([A-Za-z0-9\-_]+)', 'i')

class StreamerYTHLSIntent extends StreamerHLSIntent {    
    constructor(data, opts, info){
        super(data, opts, info)
        this.type = 'yt'
        this.mimetype = this.mimeTypes.hls
        this.mediaType = 'live'
    }
    getTranscodingOpts(){
        return Object.assign({
            workDir: this.opts.workDir, 
            authURL: this.data.source,
            debug: this.opts.debug,
            isLive: this.mediaType == 'live'
        }, this.getTranscodingCodecs())
    }
    generateMasterPlaylist(tracks){
        let resolutionMap = {
            '144p': '256x144',
            '240p': '426x240',
            '360p': '640x360',
            '480p': '854x480',
            '720p': '1280x720',
            '1080p': '1920x1080',
            '1440p': '2560x1440'
        }
        let body = `#EXTM3U
#EXT-X-VERSION:3
#EXT-X-INDEPENDENT-SEGMENTS
`
        tracks.map(track => {
            body += '#EXT-X-STREAM-INF:BANDWIDTH='+ track.bitrate +',AVERAGE-BANDWIDTH='+ track.bitrate
            if(resolutionMap[track.qualityLabel]){
                +',RESOLUTION='+ resolutionMap[track.qualityLabel]
            }
            body += "\r\n"+ track.url +"\r\n"
        })
        console.warn(body, tracks)
        return body
    }
    async getYTInfo(id){
        let info, err, retries = 5, url = 'https://www.youtube.com/watch?v='+ id
        while((!info || !info.formats) && retries){
            retries--
            console.warn('TRY', global.time())
            info = await ytdl.getInfo(url, {     
                requestOptions: {
                    rejectUnauthorized: false,
                    transform: (parsed) => {
                        return Object.assign(parsed, {
                            rejectUnauthorized: false
                        })
                    }
                }
            }).catch(e => {
                console.error(err)
                if(String(err).match(new RegExp('Status code: 4'))){ // permanent error, like 410
                    retries = 0
                }
                err = e
            })
        }
        if(!info) throw err
        return info
    }
    selectTrackBW(tracks, bandwidth){
        let chosen, chosenBandwidth
        tracks.sortByProp('bitrate').some((track, i) => {
            if(!chosen){
                chosen = track.url
                chosenBandwidth = track.bitrate
            } else {
                if(!bandwidth || track.bitrate <= bandwidth){
                    chosen = track.url
                    chosenBandwidth = track.bitrate
                    if(!bandwidth && i == 1){ // if we don't know the connection speed yet, use the #1 to skip a possible audio track
                        return true
                    }
                } else {
                    return true // to break
                }
            }
        })
        return {url: chosen, bandwidth: chosenBandwidth}
    }
    async _startVideo(info){
        this.mimetype = this.mimeTypes.video
        this.mediaType = 'video'
        let ret = this.selectTrackBW(info.formats, global.streamer.downlink)
        this.prx = new StreamerProxy(Object.assign({}, this.opts))
        this.connectAdapter(this.prx)
        await this.prx.start()
        this.endpoint = this.prx.proxify(ret.url)
        console.warn('START', ret, this.endpoint)
        return {endpoint: this.endpoint, mimetype: this.mimetype}
    }
    async _start(){ 
        const matches = this.data.url.match(YTRegex)
        if(!matches || !matches.length) throw 'Bad yt url'
        let info = await this.getYTInfo(matches[3])
        this.data.name = info.videoDetails.title
        let tracks = info.formats.filter(s => s.isHLS).filter(s => s.hasVideo || s.hasAudio)
        if(!tracks.length){
            return this._startVideo(info)
        }        
        const mw = global.config.get('hls-prefetch')
        this.prx = new (mw ? StreamerHLSProxy : StreamerProxy)(Object.assign({}, this.opts))
        this.connectAdapter(this.prx)
        await this.prx.start()
        tracks = tracks.map(s => {
            s.url = this.prx.proxify(s.url)
            return s
        })
        let file = global.paths.temp +'/master.m3u8'
        await fs.promises.writeFile(file, this.generateMasterPlaylist(tracks))
        let url = await global.downloads.serve(file)
        this.endpoint = this.prx.proxify(url) // proxify again to get tracks on super()
        console.warn('START', url, this.endpoint)
        return {endpoint: this.endpoint, mimetype: this.mimetype}
    }
}

StreamerYTHLSIntent.mediaType = 'live'
StreamerYTHLSIntent.supports = info => {
    if(info.url && info.url.match(YTRegex)){
        return true
    }
    return false
}

module.exports = StreamerYTHLSIntent