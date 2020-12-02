
const http = require('http'), os = require('os'), StreamerProxy = require('./proxy')

class StreamerNetworkProxy extends StreamerProxy {
	constructor(port){
		super('', {})
		this.type = 'network-proxy'
        this.debug = console.log
        this.sourcePort = port
	}
    networkIP(){
        var dat = Object.keys(os.networkInterfaces())
            // flatten interfaces to an array
            .reduce((a, key) => [
                ...a,
                ...os.networkInterfaces()[key]
            ], [])
            // non-internal ipv4 addresses only
            .filter(iface => iface.family === 'IPv4' && !iface.internal)
            // project ipv4 address as a 32-bit number (n)
            .map(iface => ({...iface, n: (d => ((((((+d[0])*256)+(+d[1]))*256)+(+d[2]))*256)+(+d[3]))(iface.address.split('.'))}))
            // set a hi-bit on (n) for reserved addresses so they will sort to the bottom
            .map(iface => iface.address.startsWith('10.') || iface.address.startsWith('192.') ? {...iface, n: Math.pow(2,32) + iface.n} : iface)
            // sort ascending on (n)
            .sort((a, b) => a.n - b.n)
        if(dat.length){
            return dat[0].address
        }
    }
    proxify(url){
        if(typeof(url) == 'string' && url.indexOf('//') != -1){
            return url.replace('http://127.0.0.1:' + this.sourcePort + '/', 'http://'+ this.addr + ':' + this.port + '/')
        } else if(url.charAt(0) == '/') { // path url
            url = 'http://'+ this.addr + ':' + this.port + url
        }
        return url
    }
    unproxify(url){
        if(typeof(url) == 'string' && url.indexOf('//') != -1){
            return url.replace('http://'+ this.addr + ':' + this.port + '/', 'http://127.0.0.1:' + this.sourcePort + '/')
        } else if(url.charAt(0) == '/') { // path url
            url = 'http://127.0.0.1:' + this.sourcePort + url
        }
        return url
    }
	start(){
		return new Promise((resolve, reject) => {
            this.addr = this.networkIP()
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
				    this.port = this.server.address().port
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
