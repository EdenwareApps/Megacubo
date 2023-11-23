const fs = require('fs'), http = require('http'), path = require('path')
const Events = require('events'), stoppable = require('stoppable')
const Downloader = require('./downloader'), Reader = require('../../reader')
const closed = require('../../on-closed'), decodeEntities = require('decode-entities')

class StreamerFFmpeg extends Events {
    constructor(source, opts){
        super()
        let outputFormat = global.config.get('preferred-livestream-fmt')
        if(!['mpegts', 'hls'].includes(outputFormat)){
            outputFormat = 'hls' // compat
        }
        this.timeout = Math.max(60, global.config.get('connect-timeout') * 6)
        this.started = false
        this.source = source 
        this.type = 'ffmpeg'
        this.opts = {
            debug: false,
            workDir: global.streamer.opts.workDir,
            addr: '127.0.0.1',
            port: 0,
            videoCodec: 'copy',
            audioCodec: global.cordova ? 'copy' : 'aac', // force aac transcode for HTML
            outputFormat,
            isLive: true,
            vprofile: 'baseline'
        };
        this.setOpts(opts)
        this.OUTDATED = 'outdated file'
    }
    isTranscoding(){
        return this.opts.videoCodec == 'libx264' || this.opts.audioCodec == 'aac'
    }
    setOpts(opts){
        if(opts && typeof(opts) == 'object'){     
            Object.keys(opts).forEach((k) => {
                if(['debug'].indexOf(k) == -1 && typeof(opts[k]) == 'function'){
                    this.on(k, opts[k])
                } else {
                    this.opts[k] = opts[k]
                }
            })
        }
    }
    async genUID(){
        if(!this.uid){
            this.uid = parseInt(Math.random() * 10000000)
            let err
            await fs.promises.mkdir(path.dirname(this.opts.workDir), {recursive: true}).catch(() => {})
            const files = await fs.promises.readdir(this.opts.workDir).catch(e => err = e)
            if(err){
                return this.uid
            } 
            while(files.includes(String(this.uid))) {
                this.uid++
            }
        }
        return this.uid
    }
    verify(file, cb){
        if(!file) return cb(false)
        fs.readFile(file, (err, content) => {
            if(err){
                cb(false)
            } else {
                let sample = String(content)
                if(sample.split('.ts').length < 4 && sample.split('.m3u8').length < 2){
                    cb(false)
                } else {
                    cb(true)
                }
            }
        })
    }
    waitFile(file, timeout, m3u8Verify) {
        return new Promise((resolve, reject) => {
            if(!file){
                return reject('no file specified')
            }
            let finished, watcher, timer = 0
            const s = global.time()
            const dir = path.dirname(file), basename = path.basename(file)
            const finish = oerr => {
                clearTimeout(timer)
                if(watcher){
                    watcher.close()
                    watcher = null
                }
                if(!finished){
                    finished = true
                    if(this.destroyed){
                        reject('destroyed')
                    } else {
                        const elapsed = global.time() - s
                        const timeouted = elapsed >= timeout
                        const t = timeouted ? ', timeout' : ' after '+ elapsed +'/'+ timeout +'s'
                        fs.access(dir, aerr => {
                            if (aerr) {
                                reject('dir not exists anymore'+ t)
                            } else {
                                fs.stat(file, (err, stat) => {
                                    if(stat && stat.size){
                                        resolve(stat)
                                    } else {
                                        if(timeouted){
                                            if(err){
                                                reject('file not found'+ t)
                                            } else {
                                                reject('file empty'+ t)
                                            }
                                        } else {
                                            reject(oerr || aerr || '')
                                        }
                                    }
                                })
                            }
                        })
                    }
                }
            }
            try {
                watcher = fs.watch(dir, (type, filename) => {
                    if(this.destroyed){
                        finish('destroyed')
                    } else if (filename === basename) {
                        fs.stat(file, (err, stat) => {
                            if(stat && stat.size){
                                this.verify(file, fine => fine && finish())
                            }
                        })
                    }
                })
                watcher.on('error', finish)
            } catch(e) {
                finish(String(e))
            }
            fs.access(file, fs.constants.R_OK, err => {
                if(!err){
                    this.verify(file, fine => fine && finish())
                }
            })
            clearTimeout(timer)
            timer = setTimeout(() => {
                if(!finished){
                    if(this.destroyed){
                        finish('destroyed')
                    } else {
                        fs.access(file, fs.constants.R_OK, err => {
                            if(this.destroyed){
                                return finish('destroyed')
                            }
                            if (err) {
                                return finish('timeout')
                            }
                            this.verify(file, fine => finish(fine ? undefined : 'timeout'))
                        })
                    }
                }
            }, timeout * 1000)
        })
    }
    proxify(file){
        if(typeof(file) == 'string'){
            if(!this.opts.port){
				console.error('proxify() before server is ready', file, global.traceback())
                return file // srv not ready
            }
            let host = 'http://'+ this.opts.addr +':'+ this.opts.port +'/'
            if(file.indexOf(host) != -1){
                return file
            }
			console.log('proxify before', file)
            let uid = '/'+ this.uid +'/', pos = file.indexOf(uid)
            if(pos != -1){
                file = '/'+ file.substr(pos + uid.length)
            }
            uid = '\\'+ this.uid +'\\', pos = file.indexOf(uid)
            if(pos != -1){
                file = '/'+ file.substr(pos + uid.length)
            }
            file = 'http://127.0.0.1:' + this.opts.port + global.forwardSlashes(file)
			console.log('proxify before', file)
        }
        return file
    }
    unproxify(url){
        if(typeof(url)=='string'){
            if(url.charAt(0) == '/'){
                url = url.slice(1)
            }
            url = url.replace(new RegExp('^.*:[0-9]+/+'), '')
            if(url.indexOf('&') != -1 && url.indexOf(';') != -1){
                url = decodeEntities(url)
            }
            url = url.split('?')[0].split('#')[0]
            url = path.resolve(this.opts.workDir + path.sep + this.uid + path.sep + url)
        }
        return url
    }
    prepareFile(file){ // not outdated
        return new Promise((resolve, reject) => {
            fs.stat(file, (err, stat) => {
                if(stat && stat.size){
                    resolve(stat)
                } else {
                    // is outdated file?
                    fs.readdir(this.opts.workDir + path.sep + this.uid, (err, files) => {
                        if(Array.isArray(files)){
                            let basename = path.basename(file)
                            let firstFile = files.sort().filter(f => f.indexOf('m3u8') == -1).shift()
                            if(basename < firstFile){
                                console.warn('Outdated file', basename, firstFile, files)
                                reject(this.OUTDATED)
                            } else {
                                console.warn('File not ready??', basename, firstFile, files)
                                this.waitFile(file, 10).then(() => {
                                    console.warn('File now ready', basename, firstFile, files)
                                    resolve()
                                }).catch(err => {
                                    console.error(err)
                                    reject(err)
                                })
                            }
                        } else {
                            reject('readdir failed')
                        }
                    })
                }
            })
        })
    }
    contentTypeFromExt(ext){
        let ct = ''
        switch(ext){
            case 'm3u8':
                ct =  'application/x-mpegURL'
                break
            case 'mp4':
            case 'm4v':
                ct =  'video/mp4'
                break
            case 'm4s':
                ct = 'video/iso.segment'
                break
            case 'ts':
            case 'mpegts':
            case 'mts':
                ct =  'video/MP2T'
                break
        }
        return ct
    }
    serve(){
        return new Promise((resolve, reject) => {
            if(this.server){
                return resolve()
            }
            this.server = http.createServer(this.handleRequest.bind(this))
            this.serverStopper = stoppable(this.server)
            this.server.listen(0, this.opts.addr, (err) => {
                if (err) {
                    return reject('unable to listen on any port')
                }
                if(this.destroyed){
                    if(this.server){
                        this.server.close()
                        this.server = null
                    }
                    return reject('destroyed')
                }
                this.opts.port = this.server.address().port
                this.verify(this.decoder.file, fine => {
                    if(this.destroyed){
                        return reject('destroyed')
                    }
                    this.endpoint = this.proxify(fine ? this.decoder.file : this.decoder.playlist) // happened with a plutotv stream that the master playlist got empty while playlist was functional
                    console.log('FFMPEG SERVE', this.decoder.file)
                    this.emit('ready')
                    resolve()
                })
            })
        })
    }
    handleRequest(req, response){
        const file = this.unproxify(req.url.split('#')[0]), fail = err => {
            console.log('FFMPEG SERVE', err, file, this.destroyed)
            const headers = { 
                'content-length': 0,
                'connection': 'close'
            }
            response.writeHead(404, global.prepareCORS(headers, req))
            response.end()
            String(err) == this.OUTDATED && this.emit('outside-of-live-window')
        }
        if(this.destroyed){
            fail('destroyed')
        } else {
            this.prepareFile(file).then(stat => {
                let headers = global.prepareCORS({
                    'content-length': stat.size,
                    'connection': 'close',
                    'cache-control': 'private, no-cache, no-store, must-revalidate',
                    'expires': '-1',
                    'pragma': 'no-cache'
                }, req)
                let ctype = this.contentTypeFromExt(global.streamer.ext(file))
                if(ctype){
                    headers['content-type'] =  ctype
                }
                let ended, stream = new Reader(file)
                response.writeHead(200, headers)
                const end = () => {
                    if(!ended){
                        ended = true
                        response.end()
                        stream && stream.destroy()
                    }
                }
                closed(req, response, stream, () => (ended||end()))
                stream.on('data', chunk => response.write(chunk))
            }).catch(fail)
        }
    }
	addCodecData(codecData){
		let changed
		if(!this.codecData){
			this.codecData = {audio: '', video: ''}
		};
		['audio', 'video'].forEach(type => {
			if(codecData[type] && codecData[type] != this.codecData[type]){
				changed = true
				this.codecData[type] = codecData[type]
			}
		})
		if(changed){
			this.emit('codecData', this.codecData)
		}
		return this.codecData
	}
    async setupDecoder(restarting){
        await this.genUID()
        if(restarting){                    
            if(this.lastRestart && this.lastRestart >= (global.time() - 10)){
                if(this.opts.isLive){
                    this.fail(global.lang.PLAYBACK_CORRUPTED_STREAM)
                } else {
                    return
                }
            }
            this.lastRestart = global.time()
        }
        if(this.destroyed){
            throw 'destroyed'
        }
        // cores = Math.min(require('os').cpus().length, 2), 
        this.emit('wait') // If the intent took a while to start another component, make sure to allow time for FFmpeg to start.
        this.decoder = global.ffmpeg.create(this.source, { live: this.opts.isLive }).
            
            /* cast fix try
            inputOptions('-use_wallclock_as_timestamps', 1). // using it the hls fragments on a hls got #EXT-X-TARGETDURATION:0 and the m3u8 wont load
            inputOptions('-fflags +genpts').
            outputOptions('-vsync', 1).
            inputOptions('-r').
            inputOptions('-ss', 1). // https://trac.ffmpeg.org/ticket/2220
            inputOptions('-fflags +genpts').
            //outputOptions('-vf', 'setpts=PTS').
            outputOptions('-vsync', 1).
            // outputOptions('-vsync', 0).
            // outputOptions('-async', -1).
            outputOptions('-async', 2).
            outputOptions('-flags:a', '+global_header').
            // outputOptions('-packetsize', 188).
            outputOptions('-level', '4.1').
            outputOptions('-x264opts', 'vbv-bufsize=50000:vbv-maxrate=50000:nal-hrd=vbr').
            cast fix try end */

            //inputOptions('-fflags', '+genpts+igndts').
            inputOptions('-fflags', '+igndts'). // genpts was messing the duration of s hls adding "fake hours" on hls.js #wtf
            
            /* lhls, seems not enabled in our ffmpeg yet
            outputOptions('-hls_playlist', 1).
            outputOptions('-seg_duration', 3).
            outputOptions('-streaming', 1).
            outputOptions('-strict', 'experimental').
            outputOptions('-lhls', 1).
            */

            format(this.opts.outputFormat)
        if(this.opts.outputFormat == 'hls'){
            // fragTime=2 to start playing asap, it will generate 3 segments before create m3u8
            // fragTime=1 may cause manifestParsingError "invalid target duration" on hls.js
            let fragTime = 2, lwt = global.config.get('live-window-time')
            if(typeof(lwt) != 'number'){
                lwt = 120
            } else if(lwt < 30) { // too low will cause isBehindLiveWindowError
                lwt = 30
            }
            let hlsListSize = Math.ceil(lwt / fragTime), hlsFlags = 'delete_segments'
            if(this.opts.isLive){
                hlsFlags += '+omit_endlist'
                this.decoder.outputOptions('-hls_flags', -5)
            } else {
                this.decoder.outputOptions('-hls_flags', 0)
            }
            if(restarting){
                hlsFlags += '+append_list'
            }
            this.decoder.
                outputOptions('-hls_flags', hlsFlags). // ?? https://www.reddit.com/r/ffmpeg/comments/e9n7nb/ffmpeg_not_deleting_hls_segments/
                outputOptions('-hls_init_time', fragTime).
                outputOptions('-hls_time', fragTime).
                outputOptions('-hls_list_size', hlsListSize).
                outputOptions('-master_pl_name', 'master.m3u8')
        } else if(this.opts.outputFormat == 'mpegts') { // mpegts
            this.decoder.
                outputOptions('-movflags', 'frag_keyframe+empty_moov').
                outputOptions('-listen', 1) // 2 wont work
        }
        if(this.opts.audioCodec){
            this.decoder.audioCodec(this.opts.audioCodec)
        }
        if(this.opts.videoCodec === null){
            this.decoder.outputOptions('-vn')
        } else if(this.opts.videoCodec) {
            if(this.opts.videoCodec == 'h264'){
                this.opts.videoCodec = 'libx264'
            }
            this.decoder.videoCodec(this.opts.videoCodec)
        }
        if(this.opts.videoCodec == 'libx264') {
            this.decoder.outputOptions('-profile:v', this.opts.vprofile || 'baseline')
            //this.decoder.outputOptions('-filter_complex', 'scale=iw*min(1\,min(640/iw\,360/ih)):-1')
        }
        if (typeof(this.source) == 'string' && this.source.indexOf('http') == 0) { // skip other protocols
            this.decoder.
                inputOptions('-stream_loop', -1).
                inputOptions('-reconnect', 1).
                inputOptions('-reconnect_at_eof', 1).
                inputOptions('-reconnect_streamed', 1).
                inputOptions('-reconnect_delay_max', 30)
            this.decoder.
                inputOptions('-icy', 0)                
                // inputOptions('-multiple_requests', 1) // will connect to 127.0.0.1 internal proxy
            if(this.agent){
                this.decoder.inputOptions('-user_agent', this.agent) //  -headers ""
            }
            if (this.source.indexOf('https') == 0) {
                this.decoder.inputOptions('-tls_verify', 0)
            }
        }
        return this.decoder
    }
    fail(err){
        this.emit('fail', err)
        this.destroy()
    }
    setTimeout(secs){
        if(this.committed) return
        if(this.timeout != secs){
            this.timeout = secs
        }
        this.clearTimeout()
        this.timeoutStart = global.time()
        this.timeoutTimer = setTimeout(() => {
            if(this && !this.failed && !this.destroyed && !this.committed){
                console.log('Timeouted engine after '+ (global.time() - this.timeoutStart), this.committed)
                this.fail('timeout')
                this.destroy()
            }
        }, secs * 1000)
    }    
    clearTimeout(){
        clearTimeout(this.timeoutTimer)
        this.timeoutTimer = 0
    }
    resetTimeout(){
        this.setTimeout(this.timeout)
    }
    start(restarting){
        return new Promise((res, rej) => {
            let responded
            const resolve = (...args) => {
                if(!responded) {
                    res(...args)
                    responded = true
                }
            }
            const reject = (...args) => {
                if(!responded) {
                    rej(...args)
                    responded = true
                }
            }
            this.on('fail', reject)
            this.setupDecoder(restarting).then(() => {
                const startTime = global.time()
                const endListener = data => {
                    if(!this.destroyed){
                        console.warn('file ended '+ data, traceback())
                        if(this.opts.isLive) {
                            if(this.committed) {
                                this.start(true).catch(console.error)
                            } else {
                                this.fail('media error')
                            }
                        }
                    }
                }
                this.resetTimeout()
                this.decoder.
                once('end', endListener).
                on('error', err => {
                    if(!this.destroyed && this.decoder){
                        err = err.message || err || 'ffmpeg fail'
                        console.error('an error happened after '+ (global.time() - startTime) +'s'+ (this.committed ? ' (committed)':'') +': ' + err)
                        let m = err.match(new RegExp('Server returned ([0-9]+)'))
                        if(m && m.length > 1){
                            err = parseInt(m[1])
                        }
                        if([404].includes(err) || !this.opts.isLive || !this.committed){
                            this.fail(err)
                        } else {
                            this.start(true).then(resolve).catch(reject)
                        }
                    }
                }).
                on('start', (commandLine) => {
                    if(this.destroyed) return // already destroyed
                    console.log('Spawned FFmpeg with command: ' + commandLine, 'file:', this.decoder.file, 'workDir:', this.opts.workDir, 'cwd:', process.cwd(), 'PATHs', global.paths, 'cordova:', !!global.cordova)
                    if(this.opts.outputFormat == 'mpegts'){
                        this.resetTimeout()
                        this.wrapper = new Downloader(this.decoder.target, Object.assign(this.opts, {
                            debug: false,
                            debugHTTP: false,
                            warmCache: true,
                            persistent: true
                        }))
                        this.wrapper.on('destroy', () => {
                            if(this.committed){
                                this.fail('FFmpeg wrapper destroyed')
                            }
                        })
                        this.wrapper.start().then(() => {
                            /* Exoplayer was having difficulty to connect directly to FFmpeg, as it just allow one conn and was giving conn refused error, so we'll wrap FFmpeg response */
                            this.endpoint = this.wrapper.endpoint
                            resolve()
                        }).catch(err => {
                            console.error(err)
                            reject(err)
                        })
                    }
                }).
                on('bitrate', bitrate => {
                    this.bitrate = bitrate
                    this.emit('bitrate', bitrate)
                }).
                on('codecData', codecData => {
                    this.emit('wait')
                    this.addCodecData(codecData)
                    let transcode
                    console.log('RECEIVED TRANSCODE DATA', codecData)
                    if(!global.cordova){
                        if(this.codecData.video && this.codecData.video.match(new RegExp('(mpeg2video|mpeg4)')) && this.opts.videoCodec != 'libx264'){
                            transcode = true
                            this.opts.videoCodec = 'libx264'
                        }
                        if(this.codecData.audio && this.codecData.audio.match(new RegExp('(ac3|mp2)')) && this.opts.audioCodec != 'aac'){
                            transcode = true
                            if(this.codecData.video.indexOf('h264 (High)') != -1) { // may be problematic
                                this.opts.videoCodec = 'libx264'
                            }
                            this.opts.audioCodec = 'aac'
                        }
                    }
                    if(this.decoder){
                        if(transcode){
                            this.decoder.removeListener('end', endListener)
                            this.decoder.abort()
                            if(global.config.get('transcoding')){
                                this.start().then(resolve).catch(reject)
                            } else {
                                this.fail('transcoding disabled')
                            }
                        } else {
                            if(['hls', 'mp4'].includes(this.opts.outputFormat)) {
                                this.waitFile(this.decoder.playlist || this.decoder.file, this.timeout, true).then(() => {
                                    this.serve().then(resolve).catch(err => {
                                        this.fail(err)
                                    })
                                }).catch(e => {
                                    console.error('waitFile failed', this.timeout, e)
                                    if(String(e).indexOf('timeout') != -1){
                                        e = 'timeout'
                                    }
                                    reject(e)
                                    this.destroy()
                                })
                            }
                        }
                    } else {
                        reject('destroyed')
                        this.destroy()
                    }
                }).
                on('dimensions', dimensions => this.emit('dimensions', dimensions))
                if(this.opts.outputFormat == 'hls'){
                    this.decoder.file = path.resolve(this.opts.workDir + path.sep + this.uid + path.sep + 'master.m3u8')
                    this.decoder.playlist = path.resolve(this.opts.workDir + path.sep + this.uid + path.sep + 'output.m3u8')
                    fs.mkdir(path.dirname(this.decoder.file), {
                        recursive: true
                    }, () => {
                        if(this.destroyed) return
                        fs.access(path.dirname(this.decoder.file), fs.constants.W_OK, (err) => {
                            if(this.destroyed) return
                            if(err){
                                console.error('FFMPEG cannot write', err)
                                reject('playback')
                            } else {
                                console.log('FFMPEG run: '+ this.source, this.decoder.file)
                                this.decoder.output(this.decoder.playlist).run()
                            }
                        })
                    })
                } else if(this.opts.outputFormat == 'mpegts') { // mpegts
                    const port = 10000 + parseInt(Math.random() * 50000)
                    this.decoder.target = 'http://127.0.0.1:'+ port +'/'
                    console.log('FFMPEG run: '+ this.source, this.decoder.file)
                    this.decoder.output('http://127.0.0.1:'+ port +'?listen').run()
                    // should be ip:port?listen without right slash before question mark
                } else { // mp4
                    this.decoder.file = this.opts.outputFile
                    console.log('FFMPEG run: '+ this.source, this.decoder.file)
                    this.decoder.output(this.decoder.file).run()
                    // should be ip:port?listen without right slash before question mark
                }
            }).catch(this.fail.bind(this))
        })
    }
    destroy(){
        this.destroyed = true
        if(this.server){
            this.server.close()
            this.server = null
        }
        this.emit('destroy')
        if(this.decoder){
            const file = this.decoder.file
            console.log('ffmpeg destroy: '+ file, global.traceback())
            this.decoder.abort()
            this.decoder = null
            if(file){
                global.rmdir(path.dirname(file), true)
            }
        }
        this.removeAllListeners()
    }
}

module.exports = StreamerFFmpeg

