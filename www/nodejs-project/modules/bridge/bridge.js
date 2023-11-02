const path = require('path'), http = require('http'), Events = require('events')
const fs = require('fs'), url = require('url')
const formidable = require('formidable'), closed = require('../on-closed')

class BaseCustomEmitter extends Events {
    constructor (){
        super()
        this.originalEmit = this.emit
        this.emit = this.customEmit
        this.setMaxListeners(20)
    }
    onMessage(args){
        setTimeout(() => this.originalEmit.apply(this, args), 0) // async to prevent blocking renderer
    }
}

class CordovaCustomEmitter extends BaseCustomEmitter {
    constructor (){
        super()
        this.attach()
    }
    customEmit(...args){
        this.attach()
        global.cordova.channel.post('message', args)
    }
    attach(){
        if(!this.channel && global.cordova.channel){
            this.channel = global.cordova.channel
            this.channel.on('message', args => this.onMessage(args))
        }
    }
}

class ElectronCustomEmitter extends BaseCustomEmitter {
    constructor (){
        super()
        const { ipcMain } = require('electron')
        this.outChannel = ipcMain
        this.inChannel = new Events()
        this.inChannel.on('message', args => this.onMessage(args)) // will be called from main through getGlobal, as ipcRenderer was not defined at renderer (?!)
    }
    customEmit(...args){
        this.outChannel.emit('message', args)
    }
}

class BridgeServer extends Events {
    constructor(opts){
        super()
        this.ua = 'Megacubo '+ global.MANIFEST.version
        if(!global.cordova) {
            this.ua += ' '+ this.secret(8)
        }
        this.map = {}
        this.opts = {
            addr: '127.0.0.1',
            port: 0
        }
        if(opts){
            Object.keys(opts).forEach((k) => {
                this.opts[k] = opts[k]
            })
        }
        this.closed = false
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
          '.svg': 'image/svg+xml'
        }
        this.setMaxListeners(20)
        this.server = http.createServer((req, response) => {
            if(!this.checkUA(req.headers)) {
                return response.end()
            }
            const parsedUrl = url.parse(req.url, false)
            global.prepareCORS(response, req)
            response.setHeader('Connection', 'close')
            response.setHeader('Feature-Policy', 'clipboard-read; fullscreen; autoplay;')
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
                } else {
                    pathname = path.join(global.APPDIR, pathname)
                }
                const ext = path.parse(pathname).ext
                fs.access(pathname, err => {
                    if(err) { 
                        response.statusCode = 404
                        response.end(`File ${pathname} not found!`)
                        return
                    }
                    response.setHeader('Content-type', mimes[ext] || 'text/plain' )
                    response.setHeader('Cache-Control', 'max-age=0, no-cache, no-store')
                    let stream = fs.createReadStream(pathname)
                    closed(req, response, () => {
                        console.log(`${req.method} ${req.url} CLOSED`)
                        if(stream){
                            stream.destroy()
                            stream = null
                        }
                        response.end()
                    }, {closeOnError: true})
                    stream.pipe(response)
                })
            }
        })
        this.server.listen(0, this.opts.addr, err => {
            this.opts.port = this.server.address().port
            console.log('Bridge server started', err)
            this.uploadURL = 'http://' + this.opts.addr + ':' + this.opts.port + '/upload'
        })  
    }
    secret(length) {
        const charset = 'abcdefghijklmnopqrstuvwxyz0123456789'
        let result = ''
        for (let i = 0; i < length; i++) {
          const randomIndex = Math.floor(Math.random() * charset.length)
          result += charset.charAt(randomIndex)
        }
        return result
    }      
    checkUA(headers){
        return headers && headers['user-agent'] && headers['user-agent'] == this.ua
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

class BridgeUtils extends BridgeServer {
    constructor(opts){
        super(opts)
    }
    async resolveFileFromClient(data) {
        const check = async file => {
            await fs.promises.access(file, fs.constants.R_OK)
            return file
        }
        console.warn('!!! RESOLVE FILE !!!', data)
        if(data) {
            if(Array.isArray(data) && data.length){
                return await check(data[0])
            } else if(data.file && data.file.filepath && data.file.filepath) {
                return await check(data.file.filepath)
            } else if(data.filename && data.filename.path) {
                return await check(data.filename.path)
            } else {
                throw new Error('invalid file data')
            }
        } else {
            throw new Error('invalid file data')
        }
    }
    async importFileFromClient(data, target) {
        console.warn('!!! IMPORT FILE !!!'+ target +' | '+ JSON.stringify(data))
        const resolveFile = await this.resolveFileFromClient(data).catch(err => {
            console.error('DATA='+ JSON.stringify(data) +' '+ err)
        })
        if(!resolveFile) throw 'Resolve error'
        if(target){
            await fs.promises.copyFile(resolveFile, target)
            return target
        } else {
            return await fs.promises.readFile(resolveFile)
        }
    }
}

class Bridge extends BridgeUtils {
    constructor(opts){
        super(opts)
        if(global.cordova){
            this.setClient(new CordovaCustomEmitter())
        } else {
            this.setClient(new ElectronCustomEmitter())
        }
    }
    setClient(socket){
        this.client = socket  
        this.client.setMaxListeners && this.client.setMaxListeners(20)
    }
    on(...args){
        this.client.on(...args)
    }
    once(...args){
        this.client.once(...args)
    }
    emit(...args){
        return this.client.emit(...args)
    }
    listenerCount(type){
        return this.listeners(type).length
    }
    listeners(type){
        return this.client.listeners(type)
    }
    removeListener(...args){
        return this.client.removeListener(...args)
    }
    removeAllListeners(...args){
        return this.client.removeAllListeners(...args)
    }
    localEmit(...args){
        this.client.originalEmit(...args)
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

