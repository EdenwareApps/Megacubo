
const http = require('http'), os = require('os'), StreamerProxy = require('./proxy'), closed = require(global.APPDIR +'/modules/on-closed')

class StreamerNetworkProxy extends StreamerProxy {
	constructor(port){
		super('', {})
		this.type = 'network-proxy'
        this.debug = console.log
        this.sourcePort = port
	}
    proxify(url){
        if(this.opts.port){
            if(typeof(url) == 'string' && url.indexOf('//') != -1){
                return url.replace('http://127.0.0.1:' + this.sourcePort + '/', 'http://'+ this.addr + ':' + this.opts.port + '/')
            } else if(url.charAt(0) == '/') { // path url
                url = 'http://'+ this.addr + ':' + this.opts.port + url
            }
        }
        return url
    }
    unproxify(url){
        if(typeof(url) == 'string' && url.indexOf('//') != -1){
            return url.replace('http://'+ this.addr + ':' + this.opts.port + '/', 'http://127.0.0.1:' + this.sourcePort + '/')
        } else if(url.charAt(0) == '/') { // path url
            url = 'http://127.0.0.1:' + this.sourcePort + url
        }
        return url
    }
	start(){
		return new Promise((resolve, reject) => {
            this.addr = global.networkIP()
            if(!this.addr){
                return reject('no network')
            }
            this.server = http.createServer(this.handleRequest.bind(this)).listen(0, this.addr, (err) => {
                if (err) {
                    if(this.debug){
                        this.debug('unable to listen on port', err)
                    }
                    reject(err)
                } else {
                    this.connectable = true
                    this.opts.port = this.server.address().port
                    resolve(true)
                }
            })
        })
    }
    destroy(){
        this.removeAllListeners()
        if(this.server){
            this.server.close()
            delete this.server
        }
    }
}

module.exports = StreamerNetworkProxy
