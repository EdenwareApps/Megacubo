

const path = require('path'), http = require('http'), Events = require('events'), fs = require('fs'), url = require('url')
const formidable = require('formidable'), closed = require('../on-closed')

class CordovaCustomEmitter extends Events {
    constructor (){
        super()
        this.originalEmit = this.emit
        this.emit = this.customEmit
        this.attach()
    }
    customEmit(...args){
        this.attach()
        global.cordova.channel.post('message', args)
    }
    attach(){
        if(!this.channel && global.cordova.channel){
            this.channel = global.cordova.channel
            this.channel.on('message', args => {
                this.originalEmit.apply(this, args)
            })
        }
    }
}

class BridgeServer extends Events {
    constructor(opts){
        super()
        this.io = null
        this.opts = {
            addr: '127.0.0.1',
            workDir: global.paths['data'] +'/bridge',
            port: 6342
        }
        this.map = {}
        if(opts){
            Object.keys(opts).forEach((k) => {
                this.opts[k] = opts[k]
            })
        }
        if(!global.cordova){
            this.io = require("socket.io")(this.port)
        }
        this.closed = false
        this.bindings = {on: [], once: []}
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
          '.mp4': 'video/mp4',
          '.svg': 'image/svg+xml',
          '.pdf': 'application/pdf',
          '.doc': 'application/msword'
        }
        this.server = http.createServer((req, response) => {
            console.log(`${req.method} ${req.url}`)
            const parsedUrl = url.parse(req.url, false)
            if(parsedUrl.pathname == '/upload') {
                const form = formidable({ multiples: true })
                form.parse(req, (err, fields, files) => {
                    response.writeHead(200, { 'content-type': 'text/plain' })
                    response.end('OK')
                    if(fields['cbid'] && fields['cbid'].length){
                        this.localEmit(fields['cbid'], files)
                    }
                })
            } else {
                let pathname = `.${parsedUrl.pathname}`
                if(pathname == './'){
                    pathname = './index.html'
                }
                if(typeof(this.map[pathname]) != 'undefined'){
                    pathname = this.map[pathname]
                }
                const ext = path.parse(pathname).ext
                fs.access(pathname, err => {
                    if(err) { 
                        response.statusCode = 404
                        response.end(`File ${pathname} not found!`)
                        return
                    }
                    response.setHeader('Content-type', mimes[ext] || 'text/plain' )
                    response.setHeader('Access-Control-Allow-Origin', '*')
                    response.setHeader('Access-Control-Allow-Methods', 'GET')
                    response.setHeader('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Cache-Control, Accept, Authorization')
                    response.setHeader('Cache-Control', 'max-age=0, no-cache, no-store')
                    response.setHeader('Connection', 'close')
                    let stream = fs.createReadStream(pathname)
                    closed(req, response, () => {
                        if(stream){
                            stream.destroy()
                            stream = null
                        }
                        response.end()
                    })
                    stream.pipe(response)
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
    serve(file){
        if(fs.existsSync(file)){
            let ext = file.match(new RegExp('\.[A-Za-z0-9]{0,5}$'))
            let stat = fs.statSync(file)
            if(stat){
                let path = './'+ (stat ? stat.size : file.split('/').pop())
                if(ext){
                    path += ext[0]
                }
                this.map[path] = file
                return 'http://' + this.opts.addr + ':' + this.opts.port + '/'+ path.substr(2)
            }
        }
    }
    destroy(){
        if(this.opts.debug){
            console.log('closing...')
        }
        this.closed = true
        this.removeAllListeners()
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
            this.bindings.on.forEach(c => {
                this.client.on.apply(this.client, c)
            })
            this.bindings.once.forEach(c => {
                this.client.once.apply(this.client, c)
            })
            this.bindings.once = []
            this.client.on('unbind', () => {
                if(this.client){
                    this.client.removeAllListeners()
                    this.client = null
                }
            })
        }
    }
    on(...args){
        this.bindings.on.push(args)
        if(this.client){
            this.client.on.apply(this.client, args)
        }
    }
    once(...args){
        if(this.client){
            this.client.once.apply(this.client, args)
        } else {
            this.bindings.once.push(args)
        }
    }
    emit(...args){
        if(this.client){
            return this.client.emit.apply(this.client, args)
        } else {
            console.error('Failed to emit.', args)
        }
    }
    listenerCount(type){
        return this.listeners(type).length
    }
    listeners(type){
        let ret = []
        Object.keys(this.bindings).forEach(n => {
            this.bindings[n].forEach(row => {
                if(row[0] == type){
                    ret.push(row[1])
                }
            })
        })
        return ret
    }
    removeListener(...args){
        Object.keys(this.bindings).forEach(type => {
            this.bindings[type] = this.bindings[type].filter(row => {
                return !(row[0] == args[0] && row[1] == args[1])
            })
        })
        if(this.client){
            return this.client.removeListener.apply(this.client, args)
        }
    }
    removeAllListeners(...args){
        Object.keys(this.bindings).forEach(type => {
            this.bindings[type] = this.bindings[type].filter(row => {
                return !(row[0] == args[0])
            })
        })
        if(this.client){
            return this.client.removeAllListeners.apply(this.client, args)
        }
    }
    localEmit(...args){
        let a = Array.from(args), id = a.shift()
        this.bindings.on.forEach(c => {
            if(c[0] == id){
                c[1].apply(null, a)
            }
        })
        this.bindings.once = this.bindings.once.filter(c => {
            if(c[0] == id){
                c[1].apply(null, a)
            } else {
                return true
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
        this.removeAllListeners()
    }
}

module.exports = Bridge

