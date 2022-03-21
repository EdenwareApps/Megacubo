
const http = require('http'), StreamerProxy = require('./proxy')

class StreamerNetworkProxy extends StreamerProxy {
	constructor(port){
		super('', {})
		this.type = 'network-proxy'
        this.opts.debug = false
        this.sourcePort = port
        this.connectionsServed = 0
	}
    proxify(url){
        if(this.opts.port){
            if(typeof(url) == 'string' && url.indexOf('//') != -1){
                return url.replace('http://127.0.0.1:' + this.sourcePort + '/', 'http://'+ this.addr + ':' + this.opts.port + '/')
            } else if(url.charAt(0) == '/') { // path url
                return 'http://'+ this.addr + ':' + this.opts.port + url
            }
        } else {
            console.error('proxify() accessed before server is ready', url)
        }
        return url
    }
    unproxify(url){
        if(typeof(url) == 'string' && url.indexOf('//') != -1){
            return url.replace('http://'+ this.addr + ':' + this.opts.port + '/', 'http://127.0.0.1:' + this.sourcePort + '/')
        } else if(url.charAt(0) == '/') { // path url
            return 'http://127.0.0.1:' + this.sourcePort + url
        }
        return url
    }
	start(){
		return new Promise((resolve, reject) => {
            this.addr = global.networkIP()
            if(!this.addr || this.addr == '127.0.0.1'){
                return reject('no network: '+ this.addr)
            }
            this.server = http.createServer(this.handleRequest.bind(this)).listen(0, this.addr, (err) => {
                if (err) {
                    if(this.opts.debug){
                        console.log('unable to listen on port', err)
                    }
                    reject(err)
                } else {
                    this.connectable = true
                    this.opts.port = this.server.address().port
                    resolve(true)
                }
            })
            this.server.on('error', console.error)
        })
    }
}

module.exports = StreamerNetworkProxy
