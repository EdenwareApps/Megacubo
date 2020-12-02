
const http = require('http'), path = require('path'), fs = require('fs')
const StreamerAdapterBase = require('../adapters/base.js'), decodeEntities = require('decode-entities'), m3u8Parser = require('m3u8-parser')

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
		if(path.substr(0, 2) == '//'){
			path = 'http:' + path
		}
        if(['http://', 'https:/'].includes(path.substr(0, 7))){
            return path
		}
		let uri = new URL(path, url)
        return uri.href
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
}

module.exports = StreamerProxyBase
