
const StreamerAdapterBase = require('../adapters/base.js')

class StreamerProxyBase extends StreamerAdapterBase {
	constructor(opts){
		super('', opts)
		this.connectable = false
	}
    basename(path){
        let i = path.lastIndexOf('/')
        if(i == 0){
            return path.substr(1)
        } else if(i == -1) {
            return path
        } else {
            return path.substr(i + 1)
        }
    }
    dirname(path){
        let i = path.lastIndexOf('/')
        if(i <= 0){
            return ''
        } else {
            return path.substr(0, i)
        }
	}
	getURLRoot(url){
		let pos = url.indexOf('//')
		if(pos != -1){
			let offset, pos2 = url.indexOf('/', pos + 2)
			if(pos2 != -1){
				offset = pos2 + 1
			} else {
				offset = pos + 2
			}
			pos = url.indexOf('/', offset)
			if(pos == -1){
				return url.substr(0, offset + 1)
			} else {
				return url.substr(0, pos + 1)
			}
		} else {
			if(url.charAt(0) == '/'){
				pos = url.indexOf('/', 1)
				if(pos == -1){
					return '/'
				} else {
					return url.substr(0, pos + 1)
				}
			} else {
				pos = url.indexOf('/')
				if(pos == -1){
					return ''
				} else {
					return url.substr(0, pos + 1)
				}
			}
		}
	}
	uid(){
		let _uid = 1
		while(typeof(this.connections[_uid]) != 'undefined'){
			_uid++
		}
		this.connections[_uid] = false
		return _uid
	}
    absolutize(path, url){
		if(!path) return url
		if(!url) return path
		if(path.substr(0, 2) == '//'){
			path = 'http:' + path
		}
        if(['http://', 'https:/'].includes(path.substr(0, 7))){
            return path
		}
		try{
			let uri = new URL(path, url)
        	return uri.href
		} catch(e) {
			console.error(e)
			return path
		}
	}
	getDomain(u){
		if(u && u.indexOf('//') != -1){
			let d = u.split('//')[1].split('/')[0]
			if(d == 'localhost' || d.indexOf('.') != -1){
				return d
			}
		}
		return ''
	}
	getMediaType(headers, url){
		let type = '', minSegmentSize = 96 * 1024
		if(typeof(headers['content-length']) != 'undefined' && parseInt(headers['content-length']) >= minSegmentSize && this.ext(url) == 'ts') { // a ts was being sent with m3u8 content-type
			type = 'video'
		} else if(typeof(headers['content-type']) != 'undefined' && (headers['content-type'].indexOf('video/') != -1 || headers['content-type'].indexOf('audio/') != -1)){
			type = 'video'
		} else if(typeof(headers['content-type']) != 'undefined' && headers['content-type'].toLowerCase().indexOf('linguist') != -1){ // .ts bad mimetype "text/vnd.trolltech.linguist"
			type = 'video'
		}  else if(typeof(headers['content-type']) != 'undefined' && (headers['content-type'].toLowerCase().indexOf('mpegurl') != -1 || headers['content-type'].indexOf('text/') != -1)){
			type = 'meta'
		} else if(typeof(headers['content-type']) == 'undefined' && this.ext(url) == 'm3u8') {
			type = 'meta'
		} else if(typeof(headers['content-length']) != 'undefined' && parseInt(headers['content-length']) >= minSegmentSize){
			type = 'video'
		} else if(typeof(headers['content-type']) != 'undefined' && headers['content-type'] == 'application/octet-stream') { // force download video header
			type = 'video'
		}
		//console.warn('MEDIATYPE', type, headers, url)
		return type
	}
	isSegmentURL(url){
		return ['ts', 'mts', 'm2ts', 'm4s'].includes(this.ext(url))
	}
	addCachingHeaders(headers, secs){		
		return Object.assign(headers, {
			'cache-control': 'max-age=' + secs + ', public',
			'expires': (new Date(Date.now() + secs)).toUTCString()
		})
	}
    destroy(){
		if(!this.destroyed){
			this.destroyed = true
			this.emit('destroy')
			this.removeAllListeners()
			if(this.server){
				this.server.close()
				delete this.server
			}
		}
    }
}

module.exports = StreamerProxyBase
