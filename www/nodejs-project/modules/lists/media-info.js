class MediaStreamInfo {
	constructor(){
		this.radioRegexA = new RegExp('r(aá|&aacute;)dio', 'i')
		this.radioRegexB = new RegExp('\\b[FA]M( |$)')
		this.protoRegexA = new RegExp('^([A-Za-z0-9]{2,6}):')
		this.protoRegexB = new RegExp('^//[^/]+\\.')
		this.seemsLiveRegex = new RegExp('(live|m3u)', 'i')
	}
	ext(url){
		return url.split('?')[0].split('#')[0].split('.').pop().toLowerCase()  
	}
	proto(url, len){
		var ret = ''
		if(url){
			let res = url.match(this.protoRegexA)
			if(res){
				ret = res[1]
			} else if(url.match(this.protoRegexB)){
				ret = 'http'
			}
			if(ret && typeof(len) == 'number'){
				ret = ret.substr(0, len)
			}
		}
		return ret
	}
	domain(u){
		if(u && u.indexOf('//')!=-1){
			var domain = u.split('//')[1].split('/')[0]
			if(domain == 'localhost' || domain.indexOf('.') != -1){
				return domain
			}
		}
		return ''
	}
	mediaType(entry){
		if(!entry || typeof(entry) != 'object'){
			entry = {
				url: String(entry)
			}
		}
		if(entry.mediaType && entry.mediaType != -1){
			return entry.mediaType
		}
		const ext = this.ext(url), proto = this.proto(url)
		if(this.isLive(url, ext, proto)) {
			return 'live'
		} if(this.isVideo(url, ext, proto) || this.isAudio(url, ext) || this.isYT(url)) {
			return 'video'
		} else if(url.indexOf('video') != -1) {
			return 'video'
		} else if(url.match(this.seemsLiveRegex)){
			return 'live'
		} else {
			const name = entry.name + ' ' + (entry.group || ''), url = String(entry.url)
			if(this.isRadio(name)){
				return 'live'
			}
		}
		return 'live' // "live" by default
	}
	isM3U8(url, ext){
		if(!ext){
			ext = this.ext(url)
		}
		return ['m3u8', 'm3u'].indexOf(ext) != -1          
	}
	isLocalTS(url, ext, proto){
		if(!ext){
			ext = this.ext(url)
		}
		if(!proto){
			proto = this.proto(url)
		}
		return ext == 'ts' && !this.isHTTP(url, proto)
	}
	isRemoteTS(url, ext, proto){
		if(!ext){
			ext = this.ext(url)
		}
		return ext == 'ts' && this.isHTTP(url, proto)      
	}
	isHTTP(url, proto){
		if(!proto){
			proto = this.proto(url)
		}
		return ['https', 'http'].includes(proto)
	}
	isYT(url){
		if(url.indexOf('youtube.com') != -1 || url.indexOf('youtu.be') != -1){
			var d = this.domain(url)
			if(d.indexOf('youtu')){
				return true
			}
		}
	}
	isRTP(url, proto){ // any real time protocol supported only via FFmpeg
		return ['mms', 'mmsh', 'mmst', 'rtp', 'rtsp', 'rtmp'].indexOf(this.proto(url, 4)) != -1      
	}
	isVideo(url, ext, proto){
		if(!url){
			return false
		}
		if(!ext){
			ext = this.ext(url)
		}
		if(ext == 'ts'){
			if(!proto){
				proto = this.proto(url)
			}
			return this.isLocalTS(url, ext, proto)
		} else {
			return ['wmv', 'avi', 'mp4', 'mkv', 'm4v', 'mov', 'flv', 'webm', 'ogv'].indexOf(ext) != -1            
		}
	}
	isAudio(url, ext){
		if(!ext){
			ext = this.ext(url)
		}
		return ['wma', 'mp3', 'mka', 'm4a', 'flac', 'aac', 'ogg', 'pls', 'nsv'].indexOf(ext) != -1          
	}
	isRadio(name){
		if(name.match(this.radioRegexA) || name.match(this.radioRegexB)) {
			return true
		} else {
			return false
		}
	}
	isLive(url, ext, proto){
		if(!ext){
			ext = this.ext(url)
		}
		if(!proto){
			proto = this.proto(url)
		}
		return this.isM3U8(url, ext) || this.isRTP(url, proto) || this.isRemoteTS(url, ext, proto)
	}
}
module.exports = MediaStreamInfo
