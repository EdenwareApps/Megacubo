const StreamerBaseIntent = require('./base.js'), StreamerProxy = require('../utils/proxy.js'), StreamerHLSProxy = require('../utils/proxy-hls.js')
const StreamerFFmpeg = require('../utils/ffmpeg'), async = require('async'), m3u8Parser = require('m3u8-parser')

class HLSTrackSelector {
    constructor(){
        this.tracks = {}
    }
    async getPlaylistTracks(masterUrl){
        if(typeof(this.tracks[masterUrl]) != 'undefined'){
            return this.tracks[masterUrl]
        }
        const body = await global.Download.get({
            url: masterUrl,
            keepalive: false,
            retries: 2,
            followRedirect: true
        })
        let results, parser = new m3u8Parser.Parser()
        parser.push(String(body))
        parser.end()
        //console.log('M3U8 PARSED', baseUrl, url, parser)
        if(parser.manifest && parser.manifest.playlists && parser.manifest.playlists.length){
            results = parser.manifest.playlists.map(playlist => {
                let bandwidth = 0, resolution = '', url = global.absolutize(playlist.uri, masterUrl)
                if(playlist.attributes){
                    if(playlist.attributes['AVERAGE-BANDWIDTH'] && parseInt(playlist.attributes['AVERAGE-BANDWIDTH']) > 128){
                        bandwidth = parseInt(playlist.attributes['AVERAGE-BANDWIDTH'])
                    } else if(playlist.attributes['BANDWIDTH'] && parseInt(playlist.attributes['BANDWIDTH']) > 128){
                        bandwidth = parseInt(playlist.attributes['BANDWIDTH'])
                    }
                    if(playlist.attributes['RESOLUTION']){
                        resolution = playlist.attributes['RESOLUTION'].width +'x'+ playlist.attributes['RESOLUTION'].height
                    }
                }
                return {url, bandwidth, resolution}
            })
        } else {
            results = [{url: masterUrl, bandwidth: 0, resolution: ''}]
        }
        this.tracks[masterUrl] = results
        parser.dispose()
        parser = null
        return results
    }
    async selectTrackQualityByBandwidth(tracks, bandwidth){
        let chosen, chosenBandwidth
        tracks.sortByProp('bandwidth').some((track, i) => {
            if(!chosen){
                chosen = track.url
                chosenBandwidth = track.bandwidth
            } else {
                if(!bandwidth || track.bandwidth <= bandwidth){
                    chosen = track.url
                    chosenBandwidth = track.bandwidth
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
    async select(masterUrl){
        let tracks = await this.getPlaylistTracks(masterUrl)
        if(tracks.length != 1){
            const track = await this.selectTrackQualityByBandwidth(tracks, global.streamer.downlink)
            tracks = [track]
        }
        if(tracks.length) return tracks[0]
    }    
}

class StreamerHLSIntent extends StreamerBaseIntent {    
    constructor(data, opts, info){
        super(data, opts, info)
        this.type = 'hls'
        this.mimetype = this.mimeTypes.hls
        this.mediaType = 'live'
        this.trackUrl = this.data.url
        this.trackSelector = new HLSTrackSelector()
    }
	async getQualityTracks(includeBW){
        let info = {}, tracks = {}
        if(this.prx.playlists){
            if(includeBW) {
                const ptracks = await this.trackSelector.getPlaylistTracks(this.data.url).catch(console.error)
                if(Array.isArray(ptracks)) {
                    ptracks.forEach(track => info[track.url] = track)
                }
            }
            Object.keys(this.prx.playlists).forEach(masterUrl => {
                Object.keys(this.prx.playlists[masterUrl]).forEach(uri => {
                    tracks[this.prx.playlists[masterUrl][uri].name] = {
                        url: uri,
                        bandwidth: info[uri] ? info[uri].bandwidth : undefined,
                        resolution: info[uri] ? info[uri].resolution : undefined
                    }
                })
            })
        }
		return tracks
	}
	getActiveQualityTrack(){
		return this.prx.activeManifest
	}
	setActiveQualityTrack(chosen, chosenBandwidth){
        chosenBandwidth && this.prx.resetBitrate(chosenBandwidth)
	}
    async transcode(){
        this.resetTimeout()
        this.transcoderStarting = true
        this.disconnectAdapter(this.prx)
        this.prx.destroy()
        let err
        const ret = await this.trackSelector.select(this.data.url).catch(e => err = e)
        if (err) {
            this.transcoderStarting = false
            this.emit('transcode-failed', err)
            console.warn('COMMITERR', this.endpoint, err)
            throw err || 'hls adapter failed'
        }
        this.resetTimeout()
        let opts = this.getTranscodingOpts()
        this.trackUrl = ret.url
        this.setActiveQualityTrack(ret.url, ret.bandwidth)
        this.prx = new StreamerProxy(Object.assign({
            authURL: this.data.authURL || this.data.source
        }, this.opts))
        this.connectAdapter(this.prx)
        await this.prx.start().catch(e => err = e)
        if (err) { 
            this.transcoderStarting = false
            this.emit('transcode-failed', err)
            throw err
        }
        if(this.ff) {
            this.disconnectAdapter(this.ff)
            this.ff.destroy()
            this.ff = null
        }
        if(this.transcoder) {
            this.disconnectAdapter(this.transcoder)
            this.transcoder.destroy()
        }
        this.setFF(this.trackUrl, opts).catch(e => err = e)
        if (err) { 
            this.transcoderStarting = false
            this.emit('transcode-failed', err)
            throw err
        }
        this.transcoderStarting = false
        this.mimetype = this.mimeTypes[this.transcoder.opts.outputFormat]
        this.endpoint = this.transcoder.endpoint
        this.emit('transcode-started')           
        if(ret.bandwidth){ // do it after resolve for right emit order on global.streamer
            this.bitrate = ret.bandwidth
            this.emit('bitrate', ret.bandwidth)
        }
        return {endpoint: this.endpoint, mimetype: this.mimetype}
    }
    async useFF(){
        const choice = global.config.get('ffmpeg-broadcast-pre-processing')
        return choice == 'yes'
    }
    async setFF(url, transcodingOpts) {
        const type = (transcodingOpts || this.transcoder) ? 'transcoder' : 'ff'
        if(this.ff) {
            this.disconnectAdapter(this.ff)
            this.ff.destroy()
            this.ff = null
        }
        if(this.transcoder) {
            this.disconnectAdapter(this.transcoder)
            this.transcoder.destroy()
        }
        const defaultOpts = {
            videoCodec: 'copy',
            audioCodec: 'copy'
        }
        this[type] = new StreamerFFmpeg(this.prx.proxify(url), transcodingOpts || defaultOpts)
        this.connectAdapter(this[type])
        await this[type].start()
        this.mimetype = this.mimeTypes[this[type].opts.outputFormat]
        this.endpoint = this[type].endpoint
    }
    async _start(){ 
        const prefetch = global.config.get('hls-prefetching')
        const useff = await this.useFF()
        this.prx = new (prefetch ? StreamerHLSProxy : StreamerProxy)(Object.assign({
            authURL: this.data.authURL || this.data.source
        }, this.opts))
        this.connectAdapter(this.prx)
        await this.prx.start()
        if(useff){
            const ret = await this.trackSelector.select(this.data.url).catch(console.error)
            if(ret && ret.url){
                this.trackUrl = ret.url     
                console.log('Track selected', this.trackUrl, ret, this.trackSelector.tracks)                    
                await this.setFF(this.trackUrl)
                this.setActiveQualityTrack(ret.url, ret.bandwidth)
                return {endpoint: this.endpoint, mimetype: this.mimetype}
            }
        }
        this.endpoint = this.prx.proxify(this.data.url)
        return {endpoint: this.endpoint, mimetype: this.mimetype}
    }
}

StreamerHLSIntent.mediaType = 'live'
StreamerHLSIntent.supports = info => {
    if(info.sample){
        if(String(info.sample).match(new RegExp('#ext(m3u|inf)', 'i'))){
            if(global.isVODM3U8(info.sample, info.contentLength)){
                return false // is vodhls
            } else {
                return true
            }
        }
    }
    if(info.contentType){
        if(info.contentType.indexOf('mpegurl') != -1){
            return true
        } else {
            return false // other video content type
        }
    }
    if(info.ext && info.ext == 'm3u8'){
        return true
    }
    return false
}

module.exports = StreamerHLSIntent
