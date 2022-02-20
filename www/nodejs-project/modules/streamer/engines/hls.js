const StreamerBaseIntent = require('./base.js'), StreamerProxy = require('../utils/proxy.js'), StreamerHLSProxy = require('../utils/proxy-hls.js')
const fs = require('fs'), Any2HLS = require('../utils/any2hls'), async = require('async'), m3u8Parser = require('m3u8-parser')

class HLSTrackSelector {
    constructor(){

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
    getPlaylistTracks(masterUrl){
        return new Promise((resolve, reject) => {
            this.fetch(masterUrl).then(body => {
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
                resolve(results)
            }).catch(reject)
        })
    }
    /*
    testBandwidth(segmentUrl){
        resolve(with the speed)
    }
    */
    selectTrack(tracks, bandwidth){
        let chosen, chosenBandwidth
        tracks.sortByProp('bandwidth').some(track => {
            if(!chosen){
                chosen = track.url
                chosenBandwidth = track.bandwidth
            } else {
                if(track.bandwidth <= bandwidth){
                    chosen = track.url
                    chosenBandwidth = track.bandwidth
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
                this.tracks = tracks
                if(tracks.length == 1){
                    resolve(tracks[0])
                } else {
                    resolve(this.selectTrack(tracks, global.streamer.downlink))
                }
            })
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
    transcode(){
        return new Promise((resolve, reject) => {
            if(this.ff){
                this.disconnectAdapter(this.ff)
                this.ff.destroy()
                this.ff = null
            }
            let resolved, opts = {
                audioCodec: 'aac',
                videoCodec: 'libx264',
                workDir: this.opts.workDir, 
                debug: this.opts.debug
            }
            this.resetTimeout()
            this.transcoderStarting = true
            this.transcoder = new Any2HLS(this.prx.proxify(this.trackUrl), opts)
            this.connectAdapter(this.transcoder)
            this.transcoder.on('destroy', () => {
                if(!resolved){
                    resolved = true
                    reject('destroyed')
                }
            })
            this.transcoder.start().then(() => {        
                if(!resolved){
                    resolved = true
                    this.transcoderStarting = false
                    this.endpoint = this.transcoder.endpoint
                    resolve({endpoint: this.endpoint, mimetype: this.mimetype})
                    this.emit('transcode-started')
                }
            }).catch(e => {                
                if(!resolved){
                    resolved = true
                    this.transcoderStarting = false
                    this.emit('transcode-failed', e)
                    reject(e)
                }
            })
        })
    }
    _start(){ 
        return new Promise((resolve, reject) => {
            let useFF = global.config.get('ffmpeg-hls')
            // useFF = useFF == 'always' || (useFF == 'desktop-only' && !global.cordova)            
            // this.prx = new (useFF ? StreamerProxy : StreamerHLSProxy)(Object.assign({authURL: this.data.source}, this.opts))
            this.prx = new StreamerHLSProxy(Object.assign({authURL: this.data.source}, this.opts))
            this.connectAdapter(this.prx)
            this.prx.start().then(() => {
                if(useFF){
                    this.trackSelector.select(this.data.url).then(ret => {
                        this.trackUrl = ret.url     
                        console.log('TRACKS', this.trackUrl, ret, this.trackSelector.tracks)
                        this.ff = new Any2HLS(this.prx.proxify(this.trackUrl), this.opts)
                        this.connectAdapter(this.ff)
                        this.ff.opts.audioCodec = global.config.get('ffmpeg-audio-repair') ? 
                            'aac' : // force audio recode for TS to prevent playback hangs
                            'copy' // aac disabled for performance
                        this.ff.start().then(() => {
                            this.endpoint = this.ff.endpoint
                            resolve({endpoint: this.endpoint, mimetype: this.mimetype})                   
                            if(ret.bandwidth){ // do it after resolve for right emit order on global.streamer
                                this.bitrate = ret.bandwidth
                                this.emit('bitrate', ret.bandwidth)
                            }
                        }).catch(reject)
                    }).catch(e => {
                        console.warn('COMMITERR', this.endpoint, e)
                        reject(e || 'hls adapter failed')
                    })
                } else {
                    this.endpoint = this.prx.proxify(this.data.url)
                    resolve({endpoint: this.endpoint, mimetype: this.mimetype}) 
                }
            }).catch(reject)
        })
    }
}

StreamerHLSIntent.mediaType = 'live'
StreamerHLSIntent.supports = info => {
    if(info.sample){
        if(String(info.sample).match(new RegExp('#ext(m3u|inf)', 'i'))){
            if(global.isVODM3U8(info.sample)){
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
