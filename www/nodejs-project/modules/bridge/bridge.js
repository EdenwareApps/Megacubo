

const path = require('path'), http = require('http'), Events = require('events'), fs = require('fs'), url = require('url')
const finished = require('on-finished'), formidable = require('formidable'), decodeEntities = require('decode-entities')

if(typeof(localStorage) != 'undefined' && localStorage.debug){
    localStorage.debug = ''
}

class CordovaCustomEmitter extends Events {
    constructor (){
        super()
        this.originalEmit = this.emit
        this.emit = this.customEmit
        global.cordova.channel.on('message', args => {
            this.originalEmit.apply(this, args)
        })
    }
    customEmit(...args){
        global.cordova.channel.post('message', args)
    }
}

class BridgeServer extends Events {
    constructor(opts){
        super()
        this.io = null
        this.opts = {
            addr: '127.0.0.1',
            workDir: global.paths['data'] +'/bridge',
            port: 5000
        }
        if(opts){
            Object.keys(opts).forEach((k) => {
                this.opts[k] = opts[k]
            })
        }
        if(!global.cordova){
            this.io = require("socket.io")(this.port)
        }
        this.closed = false
        this.bindings = []
        const mimes = {
          '.ico': 'image/x-icon',
          '.html': 'text/html',
          '.js': 'text/javascript',
          '.json': 'application/json',
          '.css': 'text/css',
          '.png': 'image/png',
          '.jpg': 'image/jpeg',
          '.wav': 'audio/wav',
          '.mp3': 'audio/mpeg',
          '.svg': 'image/svg+xml',
          '.pdf': 'application/pdf',
          '.doc': 'application/msword'
        }
        this.server = http.createServer((req, res) => {
            console.log(`${req.method} ${req.url}`)
            const parsedUrl = url.parse(req.url)
            if(parsedUrl.pathname == '/upload') {
                const form = formidable({ multiples: true })
                form.parse(req, (err, fields, files) => {
                    res.writeHead(200, { 'content-type': 'text/plain' })
                    res.end('OK')
                    if(fields['cbid'] && fields['cbid'].length){
                        this.localEmit(fields['cbid'], files)
                    }
                })
            } else {
                let pathname = `.${parsedUrl.pathname}`
                if(pathname == './'){
                    pathname = './index.html'
                }
                const ext = path.parse(pathname).ext
                fs.stat(pathname, (err, stat) => {
                    if(err) { 
                        res.statusCode = 404
                        res.end(`File ${pathname} not found!`)
                        return
                    }
                    res.setHeader('Content-type', mimes[ext] || 'text/plain' )
                    res.setHeader('Access-Control-Allow-Origin', '*')
                    res.setHeader('Access-Control-Allow-Methods', 'GET')
                    res.setHeader('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Cache-Control, Accept, Authorization')
                    res.setHeader('Cache-Control', 'max-age=0, no-cache, no-store')
                    res.setHeader('Connection', 'close')
                    let stream = fs.createReadStream(pathname)
                    finished(res, () => stream && stream.destroy())
                    stream.pipe(res)
                })
            }
        })
        if(!global.cordova){
            this.ui = this.io.listen(this.server, {log: false})
        }
        this.server.listen(this.opts.port, this.opts.addr, err => {
            console.log('Bridge server started', err)
        })  
        this.uploadURL = 'http://' + this.opts.addr + ':' + this.opts.port + '/upload'
    }
    destroy(){
        if(this.opts.debug){
            this.opts.debug('closing...')
        }
        this.closed = true
    }
}

class Bridge extends BridgeServer {
    constructor(opts){
        super(opts)  
        if(global.cordova){
            console.log('NODEJS CORDOVA SETUP')
            this.bind(new CordovaCustomEmitter())
        } else {
            console.log('NODEJS SOCKET.IO SETUP')
            this.ui.sockets.on('connection', this.bind.bind(this))   
        }
    }
    bind(socket){
        if(socket != this.client){
            if(this.client){
                this.client.removeAllListeners()
                if(typeof(this.client.disconnect) == 'function'){
                    this.client.disconnect()
                }
                this.client = null
            }
            console.warn('BINDING')
            this.client = socket  
            this.bindings.forEach(c => {
                if(c[0] == 'connect'){
                    c[1]()
                } else {
                    this.client.on.apply(this.client, c)
                }
            })
            this.client.on('unbind', () => {
                if(this.client){
                    this.client.removeAllListeners()
                    this.client = null
                }
            })
        }
    }
    on(...args){
        this.bindings.push(args)
        if(this.client){
            this.client.on.apply(this.client, args)
        }
    }
    emit(...args){
        if(this.client){
            return this.client.emit.apply(this.client, args)
        } else {
            console.error('Failed to emit.', args)
        }
    }
    localEmit(...args){
        let a = Array.from(args), id = a.shift()
        console.log('localEmit', id, a)
        this.bindings.forEach(c => {
            if(c[0] == id){
                c[1].apply(null, a)
            }
        })
    }
    assign(name, callback){
        const c = 'call-' + name, f = data => {
            console.log(c, !!this.client)
            callback.apply(null, data.args).then(ret => {
                this.client.emit('callback-' + data.id, {error: false, data: ret})
            }).catch(err => {
                this.client.emit('callback-' + data.id, {error: true, data: err})
            })
        }
        this.on(c, f)
    }
    destroy(){
        if(this.server){
            this.server.close()
            this.server = null
        }
    }
}

module.exports = Bridge

