/*
Experiment in progress trying to convert a live streaming to a video file that can be served in realtime. By now, FFmpeg don't flush the video to disk in time.
*/

const fs = require('fs'), http = require('http'), path = require('path')
const closed = require('../../on-closed'), decodeEntities = require('decode-entities')
const Any2HLS = require('../utils/any2hls'), Events = require('events')

class PersistentReader extends Events {
    constructor(file){
        super()
        this.file = file
		this.type = 'live-to-video'
        this.readenBytes = 0
        this.readen = this.readCallback.bind(this)
        fs.open(this.file, 'r', (err, fd) => {
            this.fd = fd
            this.interval = 3000
            this.timer = setInterval(() => {
                if(!this.reading){
                    fs.stat(this.file, (err, stat) => {
                        if(err){
                            this.emit('error', err)
                            this.destroy()
                        } else if(stat && stat.size > this.readenBytes) {
                            this.read()
                        }
                    })
                }
            })
            this.read()
        })
    }
    readCallback(err, len, chunk){
        if(err){
            this.emit('error', err)
            this.destroy()
        } else {
            this.readenBytes += len
            this.emit('data', chunk)
            this.reading = false
            this.read()
        }
    }
    read(){
        if(!this.reading){
            this.reading = true
            fs.stat(this.file, (err, stat) => {
                if(err){
                    this.emit('error', err)
                    this.destroy()
                } else {
                    if(stat.size > this.readenBytes){
                        let len = stat.size - this.readenBytes
                        fs.read(this.fd, Buffer.alloc(len), 0, len, this.readenBytes, this.readen)
                    } else {
                        this.reading = false
                    }
                }
            })
        }
    }
    destroy(){
        if(!this.destroyed){
            this.destroyed = true
            if(this.fd){
                fs.close(this.fd, () => {})
            }
            if(this.timer){
                clearInterval(this.timer)
                delete this.timer
            }
            this.removeAllListeners()
        }
    }
}

class StreamerLiveToVideo extends Any2HLS {
	constructor(url){
		super('', {})
        this.url = url
        this.uid = parseInt(Math.random() * 10000000)
        this.opts = {
            timeout: 60,
            videoCodec: 'libx264',
            audioCodec: 'aac',
            debug: true
        }
        this.folder = global.streamer.opts.workDir + '/' + this.uid
        this.basename = 'output.mp4'
        this.file = this.folder + '/'+ this.basename
	}
    verify(file, cb){
        fs.access(file, err => cb(!err))
    }
    handleRequest(req, response){
        const keepalive = this.committed && global.config.get('use-keepalive')
        const file = this.unproxify(req.url.split('#')[0]), fail = err => {
            console.log('FFMPEG SERVE', err, file, this.destroyed)
            const headers = { 
                'access-control-allow-origin': '*',
                'content-length': 0,
                'connection': keepalive ? 'keep-alive' : 'close'
            }
            response.writeHead(404, headers)
            response.end()
        }
        if(this.destroyed){
            fail('destroyed')
        } else {
            this.prepareFile(file).then(stat => {
                let headers = {
                    'access-control-allow-origin': '*',
                    'content-length': stat.size,
                    'connection': keepalive ? 'keep-alive' : 'close',
                    'cache-control': 'private, no-cache, no-store, must-revalidate',
                    'expires': '-1',
                    'pragma': 'no-cache'
                }
                let ctype = this.contentTypeFromExt(global.streamer.ext(file))
                if(ctype){
                    headers['content-type'] =  ctype
                }
                let ended, stream = fs.createReadStream(file)
                response.writeHead(200, headers)
                const end = () => {
                    if(!ended){
                        ended = true
                        response.end()
                        stream && stream.destroy()
                    }
                }
                closed(req, response, () => {
                    if(!ended){
                        end()
                    }
                })
                stream.pipe(response) 
            }).catch(fail)
        }
    }
	start(){
		return new Promise((resolve, reject) => {
            const startTime = global.time()
            this.decoder = global.ffmpeg.create(this.url).
                inputOptions('-re').
                inputOptions('-g', 52).
                outputOptions('-map', '0:a?').
                outputOptions('-map', '0:v?').
                outputOptions('-sn').
                outputOptions('-preset', 'ultrafast').
                format('mp4')
            if(this.opts.audioCodec){
                this.decoder.audioCodec(this.opts.audioCodec)
            }
            if(this.opts.videoCodec === null){
                this.decoder.outputOptions('-vn')
            } else if(this.opts.videoCodec) {
                if(this.opts.videoCodec == 'h264'){
                    this.opts.videoCodec = 'libx264'
                }
                if(this.opts.videoCodec){
                    this.decoder.videoCodec(this.opts.videoCodec)
                }
            }
            if(this.opts.videoCodec == 'libx264') {
                this.decoder.

                /* HTML5 compat start */
                outputOptions('-shortest').
                outputOptions('-profile:v', this.opts.vprofile || 'baseline').
                outputOptions('-pix_fmt', 'yuv420p').
                outputOptions('-preset:v', 'ultrafast').
                outputOptions('-movflags', 'frag_keyframe+empty_moov+faststart').
                /* HTML5 compat end */

                outputOptions('-crf', global.config.get('ffmpeg-crf')) // we are encoding for watching, so avoid to waste too much time and cpu with encoding, at cost of bigger disk space usage

                let resolutionLimit = global.config.get('transcoding')
                switch(resolutionLimit){
                    case '480p':
                        this.decoder.outputOptions('-vf', 'scale=\'min(852,iw)\':min\'(480,ih)\':force_original_aspect_ratio=decrease,pad=852:480:(ow-iw)/2:(oh-ih)/2')
                        break
                    case '720p':
                        this.decoder.outputOptions('-vf', 'scale=\'min(1280,iw)\':min\'(720,ih)\':force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2')
                        break
                    case '1080p':
                        this.decoder.outputOptions('-vf', 'scale=\'min(1920,iw)\':min\'(1080,ih)\':force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2')
                        break
                }
            }
            if(this.opts.audioCodec == 'aac'){
                this.decoder.outputOptions('-profile:a', 'aac_low').
                outputOptions('-preset:a', 'ultrafast').
                outputOptions('-b:a', '128k').
                outputOptions('-ac', 2). // stereo
                outputOptions('-ar', 48000).
                outputOptions('-af', 'aresample=async=1:min_hard_comp=0.100000:first_pts=0')      
            }
            if (this.url.indexOf('http') == 0) { // skip other protocols
                this.decoder.
                    inputOptions('-stream_loop', -1).
                    // inputOptions('-timeout', -1).
                    inputOptions('-reconnect', 1).
                    // inputOptions('-reconnect_at_eof', 1).
                    inputOptions('-reconnect_streamed', 1).
                    inputOptions('-reconnect_delay_max', 20)
                this.decoder.
                    inputOptions('-icy', 0).
                    inputOptions('-seekable', -1).
                    inputOptions('-multiple_requests', 1)
                if(this.agent){
                    this.decoder.inputOptions('-user_agent', this.agent) //  -headers ""
                }
                if (this.url.indexOf('https') == 0) {
                    this.decoder.inputOptions('-tls_verify', 0)
                }
            }
            this.decoder.
            once('end', data => {
                if(!this.destroyed){
                    console.warn('file ended '+ data, traceback())
                    this.destroy()
                }
            }).
            on('error', err => {
                if(!this.destroyed && this.decoder){
                    err = err.message || err || 'ffmpeg fail'
                    console.error('an error happened after '+ (global.time() - startTime) +'s'+ (this.committed ? ' (committed)':'') +': ' + err)
                    let m = err.match(new RegExp('Server returned ([0-9]+)'))
                    if(m && m.length > 1){
                        err = parseInt(m[1])
                    }
                    this.emit('error', err)
                    this.destroy()
                }
            }).
            on('start', (commandLine) => {
                if(this.destroyed){ // already destroyed
                    return
                }
                console.log('Spawned FFmpeg with command: ' + commandLine, 'file:', this.file)
            })
            fs.mkdir(path.dirname(this.file), {
                recursive: true
            }, () => {
                if(this.destroyed) return
                fs.access(path.dirname(this.file), fs.constants.W_OK, (err) => {
                    if(this.destroyed) return
                    if(err){
                        console.error('FFMPEG cannot write', err)
                        reject('playback')
                    } else {
                        console.log('FFMPEG run: '+ this.url, this.file)
                        this.decoder.output(this.file).run()
                        this.emit('decoder', this.decoder)
                        this.waitFile(this.file, this.opts.timeout).then(() => {                            
                            this.serve().then(() => {
                                this.mimetype = 'video/mp4'
                                this.endpoint = 'http://'+ this.addr +':'+ this.opts.port +'/'+ this.basename
                                resolve(true)
                            }).catch(err => {
                                reject(err)
                                this.decoder.kill()                                
                            })
                        }).catch(e => {
                            console.error('waitFile failed', this.opts.timeout, e)
                            if(String(e).indexOf('timeout') != -1){
                                e = 'timeout'
                            }
                            reject(e)
                            this.destroy()
                        })
                    }
                })
            })
        })
    }
    handleRequest(req, response){
        const keepalive = this.committed && global.config.get('use-keepalive')
        const file = this.file, fail = err => {
            console.log('FFMPEG SERVE', err, file, this.destroyed)
            let headers = { 
                'access-control-allow-origin': '*',
                'content-length': 0
            }
            response.writeHead(404, headers)
            response.end()
        }
        if(this.destroyed){
            fail('destroyed')
        } else if(req.url.indexOf(this.basename) == -1){
            fail('not found')
        } else {
            let len = 2 * (1024 * 1024 * 1024)
            let status = 200, headers = {
                'access-control-allow-origin': '*',
                'content-length': len, // 2GB
                'connection': keepalive ? 'keep-alive' : 'close'
            }
			if(this.opts.forceExtraHeaders){
				Object.assign(headers, this.opts.forceExtraHeaders)
			}
            if(typeof(req.headers.range) != 'undefined'){
                status = 216
                headers['content-range'] = 'bytes 0-'+ (len - 1) +'/'+ len
            }
            console.warn('livetovideo headers', headers)
            let ended, stream = new PersistentReader(file)
            this.stream = stream
            response.writeHead(status, headers)
            const end = () => {
                if(!ended){
                    ended = true
                    response.end()
                    stream && stream.destroy()
                }
            }
            closed(req, response, () => {
                if(!ended){
                    end()
                }
            })
            stream.on('data', chunk => response.write(chunk))
            stream.on('error', () => {
                if(!ended){
                    end()
                }
                this.destroy()
            })
        }
    }
	removeHeaders(headers, keys){
		keys.forEach(key => {
			if(['accept-encoding', 'content-encoding'].includes(key)){
				headers[key] = 'identity'
			} else {
				delete headers[key]
			}
		})
		return headers
	}
    destroy(){
        if(!this.destroyed){
            this.destroyed = true
            if(this.decoder){
                this.decoder.kill()
                delete this.decoder
            }
            if(this.server){
                this.server.close()
                delete this.server
            }
            global.rmdir(this.folder)
            this.removeAllListeners()
        }
    }
}

module.exports = StreamerLiveToVideo
