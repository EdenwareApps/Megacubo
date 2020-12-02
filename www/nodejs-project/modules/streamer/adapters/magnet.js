
const fs = require('fs'), http = require('http'), StreamerAdapterBase = require('./base.js'), Trackers = require('../utils/trackers.js'), torrentStream = require('torrent-stream')
const finished = require('on-finished'), parseRange = require('range-parser')
		
class StreamerAdapterMagnet extends StreamerAdapterBase {
	constructor(url, opts, cb){
		super(url, opts)
		this.bitrate = false
		this.bitrates = []
		this.clients = []
        this.port = 0
        this.stream = false
        this.listening = false
        this.trackers = new Trackers()
        this.connections = []
        this.on('destroy', () => {
            if(this.engine){
                this.engine.destroy()
                this.engine = false
            }
            this.removeAllListeners('selected')
        })
	}
	start(){
		return new Promise((resolve, reject) => {
			this.setCallback(success => {
				if(success){
					resolve()
				} else {
					reject()
				}
			})
            console.warn('MAGNET', this.url, this.opts)
            this.prepareTorrentStream().then(p => {
                if(typeof(p) == 'string' && p.substr(0, 7) == 'magnet:'){
                    this.url = p = this.trackers.fill(p, 10)
                }
                this.engine = torrentStream(p)
                this.engine.on('ready', this.select.bind(this))
            }).catch(err => {
                console.error(err)
                this.fail(err)
            })
            this.serve().catch(err => {
                console.error(err)
                this.fail(err)
            })
		})
    }
    prepareTorrentStream(){
		return new Promise((resolve, reject) => {
            if(global.streamer.ext(this.url) == 'torrent'){
                if(global.streamer.proto(this.url, 4) == 'http'){
                    global.Download.promise({
                        url: this.url,
                        responseType: 'buffer',
                        resolveBodyOnly: true
                    }).then(resolve).catch(err => {
                        reject(err)
                    })
                } else {
                    fs.readFile(this.url, (err, content) => {
                        if(err){
                            reject(err)
                        } else {
                            resolve(content)
                        }
                    })
                }
            } else {
                resolve(this.url)
            }
        })
    }
    select(){
        let selected
        this.engine.files.forEach(file => {
            file.deselect()
            if(!selected){
                selected = file
            } else if(selected.length < file.length) {
                selected = file
            }
        })
        if(selected){
            this.selected = selected
            this.selected.select()
            console.log('filename:', selected.name)
        } else {
            this.emit('fail', 'torrent is empty')
        }
        this.emit('selected')
    }
    serve(){
        return new Promise((resolve, reject) => {
            this.server = http.createServer((req, response) => {
                if(req.url.indexOf('/video') == -1){
                    response.writeHead(404, { 
                        'Content-Type': 'text/plain',
                        'Access-Control-Allow-Origin': '*'
                    })
                    response.end('404 Not Found')
                } else {
                    if(this.selected){
                        this.handleReq(req, response)
                    } else {
                        this.on('selected', () => {
                            this.handleReq(req, response)
                        })
                    }
                }
            }).listen(0, this.opts.addr, err => {
                if (err || !this.server || !this.server.address) {
                    return reject('unable to listen on any port')
                }
                this.opts.port = this.server.address().port
                this.endpoint = 'http://127.0.0.1:' + this.opts.port + '/video'
                this.emit('ready')
                resolve()
            })
        })
    }
    contentRange (type, size, range) {
      return type + ' ' + (range ? range.start + '-' + range.end : '*') + '/' + size
    }
    handleReq(req, res){
        let stream, file = this.selected
        let offset = 0, len = file.length
        res.setHeader('Content-Type', 'video/mp4')
        res.setHeader('Content-Length', len)
        res.setHeader('Accept-Ranges', 'bytes')
        if (req.headers.range) {
          const ranges = parseRange(len, req.headers.range, { combine: true })
          if (ranges === -1) {
            res.setHeader('Content-Length', 0)
            res.setHeader('Content-Range', this.contentRange('bytes', len))
            res.statusCode = 416
            return res.end()
          }
          if (Array.isArray(ranges)) {
            offset = parseInt(ranges[0].start)
            res.statusCode = 206
            res.setHeader('Content-Range', this.contentRange('bytes', len, ranges[0]))
            len = ranges[0].end - ranges[0].start + 1
            res.setHeader('Content-Length', len)
            if (req.method === 'HEAD') return res.end()
            stream = file.createReadStream({start: ranges[0].start, end: ranges[0].end})
          }
        } else {
          if (req.method === 'HEAD') return res.end()
          stream = file.createReadStream()
        }
        finished(res, () => stream && stream.destroy())
        stream.pipe(res)
        stream.on('data', chunk => {
            let ln = this.len(chunk)
            offset += ln
            if(this.opts.debug){
                this.opts.debug('data', ln)
            }
            if(this.listenerCount('data')){
                this.emit('data', this.data.url, chunk, ln, offset)
            }
            this.collectBitrateSample(chunk, ln)
        })
        return stream
    }
}

module.exports = StreamerAdapterMagnet
