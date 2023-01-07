const DownloadStream = require('./stream-base')

class DownloadStreamP2P extends DownloadStream {
	constructor(opts){
		super(opts)
        this.setMaxListeners(99)
        this.type = 'p2p'
        this.lmap = {}
        this.on('destroy', () => this.unbind())
	}
    unbind(){
        global.ui.emit('download-p2p-cancel-request', this.opts.uid)
        Object.keys(this.lmap).forEach(n => {
            global.ui.removeListener(n, this.lmap[n])
        })
    }
    async start(){
        if(this.started || this.ended || this.destroyed){
            throw 'Already initialized'
        }
        if(!Object.keys(global.Download.p2p.peers).length){
            process.nextTick(() => this.destroy())
            throw 'No peers'
        }
        this.started = true
        this.setTimeout(10000)
        let range
        if(this.opts.headers.range){
            range = this.parseRange(this.opts.headers.range)
        }
        let sent = 0
        this.lmap['download-p2p-response-fail-'+ this.opts.uid] = reason => {
            this.emitError('P2P download failed: '+ reason, true)
            this.unbind()
        }
        this.lmap['download-p2p-response-start-'+ this.opts.uid] = data => {
            this.setTimeout(10000) // reset it
            if(!this.response){
                const headers = {}
                if(data.headers){
                    Object.assign(headers, data.headers)
                }
                if(!headers['content-length'] && data.size) {
                    headers['content-length'] = data.size
                }
                if(!headers['content-range'] && range) {
                    headers['content-range'] = 'bytes '+ range.start +'-'
                    headers['content-range'] += range.end || data.size
                    headers['content-range'] += '/*'
                }
                if(data.ttl){
                    headers['x-cache-ttl'] = data.ttl
                }
                headers['x-source'] = 'p2p'
                this.response = new DownloadStream.Response(200, headers)
                this.emit('response', this.response)
            }
        }
        this.lmap['download-p2p-response-data-'+ this.opts.uid] = data => {
            if(!this.response){                
                return this.emitError('Bad P2P response order', true)
            }
            this.setTimeout(10000) // reset it
            if(!data || !data.data || !data.data.length) return
            if(data.range){
                if(sent != data.range.start){
                    console.error('P2P ranging error.', sent, data.range)
                    return this.emitError('P2P ranging error.', true)
                }
                const expectedChunkSize = data.range.end - data.range.start
                if(data.data.length != expectedChunkSize){
                    console.error('P2P expecting {0} but received {1}.'.format(expectedChunkSize, data.data.length), sent, data.range, data)
                    return this.emitError('P2P ranging error.', true)
                }
            } else {
                console.error('Missing range info', data)
                return this.emitError('Missing range info.', true)
            }
            sent += data.data.length
            this.response.write(data.data)
        }
        this.lmap['download-p2p-response-end-'+ this.opts.uid] = () => {
            this.end()
            this.unbind()
        }
        Object.keys(this.lmap).forEach(n => global.ui.on(n, this.lmap[n]))
        global.ui.emit('download-p2p-fetch-request', {
            type: 'request',
            url: this.opts.url,
            uid: this.opts.uid,
            range
        })
    }
}

module.exports = DownloadStreamP2P
