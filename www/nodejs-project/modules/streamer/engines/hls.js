const StreamerBaseIntent = require('./base.js'), StreamerProxy = require('../utils/proxy.js'), StreamerHLSProxy = require('../utils/proxy-hls.js')
const StreamerFFmpeg = require('../utils/ffmpeg'), async = require('async'), m3u8Parser = require('m3u8-parser')

class HLSTrackSelector {
    constructor(){
        this.tracks = {}
    }
    absolutize(path, url){
		if(path.substr(0, 2) == '//'){
			path = 'http:' + path
		}
        if(['http://', 'https:/'].includes(path.substr(0, 7))){
            return path
		}
		let uri = new URL(path, url)
        return uri.href
	}
    fetch(url){
        return new Promise((resolve, reject) => {
            const download = new global.Download({
                url,
                keepalive: false,
                retries: 2,
                followRedirect: true
            })
            download.once('response', console.warn)
            download.on('error', console.warn)
            download.once('end', ret => {
                resolve(ret)
            })
            download.start()
        })
    }
    async getPlaylistTracks(masterUrl){
        if(typeof(this.tracks[masterUrl]) != 'undefined'){
            return this.tracks[masterUrl]
        }
        const body = await this.fetch(masterUrl)
        let results, parser = new m3u8Parser.Parser()
        parser.push(String(body))
        parser.end()
        //console.log('M3U8 PARSED', baseUrl, url, parser)
        if(parser.manifest && parser.manifest.playlists && parser.manifest.playlists.length){
            results = parser.manifest.playlists.map(playlist => {
                let bandwidth = 0, url = this.absolutize(playlist.uri, masterUrl)
                if(playlist.attributes){
                    if(playlist.attributes['AVERAGE-BANDWIDTH'] && parseInt(playlist.attributes['AVERAGE-BANDWIDTH']) > 128){
                        bandwidth = parseInt(playlist.attributes['AVERAGE-BANDWIDTH'])
                    } else if(playlist.attributes['BANDWIDTH'] && parseInt(playlist.attributes['BANDWIDTH']) > 128){
                        bandwidth = parseInt(playlist.attributes['BANDWIDTH'])
                    }
                }
                return {url, bandwidth}
            })
        } else {
            results = [{url: masterUrl, bandwidth: 0}]
        }
        this.tracks[masterUrl] = results
        parser.dispose()
        parser = null
        return results
    }
    selectTrackBW(tracks, bandwidth){
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
    select(masterUrl){
        return new Promise((resolve, reject) => {
            this.getPlaylistTracks(masterUrl).then(tracks => {
                if(tracks.length == 1){
                    resolve(tracks[0])
                } else {
                    resolve(this.selectTrackBW(tracks, global.streamer.downlink))
                }
            }).catch(console.error)
        })
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
	getQualityTracks(){
		let tracks = {}
        if(this.prx.playlists){
            Object.keys(this.prx.playlists).forEach(masterUrl => {
                Object.keys(this.prx.playlists[masterUrl]).forEach(uri => {
                    tracks[this.prx.playlists[masterUrl][uri].name] = this.prx.proxify(uri)
                })
            })
        }
		return tracks
	}
	getActiveQualityTrack(){
		return this.prx.proxify(this.prx.activeManifest)
	}
	selectTrack(url){
        this.endpoint = this.prx.proxify(url)
		this.emit('streamer-connect')
	}
    transcode(){
        return new Promise((resolve, reject) => {
            this.resetTimeout()
            this.transcoderStarting = true
            this.disconnectAdapter(this.prx)
            this.prx.destroy()
            this.trackSelector.select(this.data.url).then(ret => {
                this.resetTimeout()
                let resolved, opts = this.getTranscodingOpts()
                this.trackUrl = ret.url
                this.prx = new StreamerProxy(Object.assign({authURL: this.data.source}, this.opts))
                this.connectAdapter(this.prx)
                this.prx.start().then(() => {
                    this.transcoder = new StreamerFFmpeg(this.prx.proxify(this.trackUrl), opts)
                    this.connectAdapter(this.transcoder)
                    this.transcoder.once('destroy', () => {
                        if(!resolved){
                            this.transcoderStarting = false
                            this.emit('transcode-failed', 'destroyed')
                            resolved = true
                            reject('destroyed')
                        }
                    })
                    this.transcoder.start().then(() => {
                        if(!resolved){
                            resolved = true
                            this.transcoderStarting = false
                            this.mimetype = this.mimeTypes[this.ff.opts.outputFormat]
                            this.endpoint = this.transcoder.endpoint
                            resolve({endpoint: this.endpoint, mimetype: this.mimetype})
                            this.emit('transcode-started')           
                            if(ret.bandwidth){ // do it after resolve for right emit order on global.streamer
                                this.bitrate = ret.bandwidth
                                this.emit('bitrate', ret.bandwidth)
                            }
                        }       
                    }).catch(err => {
                        if(!resolved){
                            resolved = true
                            this.transcoderStarting = false
                            this.emit('transcode-failed', err)
                            reject(err)
                        }
                    })
                }).catch(err => { 
                    if(!resolved){
                        resolved = true
                        this.transcoderStarting = false
                        this.emit('transcode-failed', err)
                        reject(err)
                    }
                })
            }).catch(err => {
                this.transcoderStarting = false
                this.emit('transcode-failed', err)
                console.warn('COMMITERR', this.endpoint, err)
                reject(err || 'hls adapter failed')
            })
        })
    }
    async useFFmpeg(){
        const f = global.config.get('ffmpeg-broadcast-pre-processing')
        if(f == 'yes'){
            return true
        }
        return false
    }
    async _start(){ 
        const prefetch = global.config.get('hls-prefetching') && this.mediaType == 'live'
        const useff = await this.useFFmpeg()
        this.prx = new (prefetch ? StreamerHLSProxy : StreamerProxy)(Object.assign({authURL: this.data.source}, this.opts))
        this.connectAdapter(this.prx)
        await this.prx.start()
        if(useff){
            const ret = await this.trackSelector.select(this.data.url).catch(console.error)
            if(ret && ret.url){
                this.trackUrl = ret.url     
                console.log('Track selected', this.trackUrl, ret, this.trackSelector.tracks)                    
                this.ff = new StreamerFFmpeg(this.prx.proxify(this.trackUrl), {
                    videoCodec: 'copy',
                    audioCodec: 'copy'
                })
                this.connectAdapter(this.ff)
                await this.ff.start()
                this.mimetype = this.mimeTypes[this.ff.opts.outputFormat]
                this.endpoint = this.ff.endpoint
                if(ret.bandwidth){ // do it after resolve for right emit order on global.streamer
                    this.bitrate = ret.bandwidth
                    this.emit('bitrate', ret.bandwidth)
                }
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
