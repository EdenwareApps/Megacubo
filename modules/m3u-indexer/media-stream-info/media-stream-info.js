class MediaStreamInfo {
	constructor(){
		// ...
	}
	ext(url){
		return url.split('?')[0].split('#')[0].split('.').pop().toLowerCase()  
	}
	proto(url, len){
		var ret = '', res = url.match(new RegExp('^([A-Za-z0-9]{2,6}):'))
		if(res){
			ret = res[1]
		} else if(url.match(new RegExp('^//[^/]+\\.'))){
			ret = 'http'
		}
		if(ret && typeof(len) == 'number'){
			ret = ret.substr(0, len)
		}
		return ret
	}
	domain(u){
		if(u && u.indexOf('//')!=-1){
			var domain = u.split('//')[1].split('/')[0];
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
		const name = entry.name + ' ' + (entry.group || ''), url = String(entry.url)
		if(this.isRadio(name) || this.isAudio(url)){
			return 'audio'
		} else if(entry.url) {
			if(this.isLive(url) || this.isMega(url)) {
				return 'live'
			} if(this.isVideo(url) || this.isYT(url)) {
				return 'video'
			} else if(url.match(new RegExp('(video)', 'i'))) {
				return 'video'
			} else if(url.match(new RegExp('(live|m3u|rtmp)', 'i'))){
				return 'live'
			}
		}
		return 'live' // "live" by default
	}
	isRadio(name){
		if(name.match(new RegExp('r(aá|&aacute;)dio', 'i'))){
			return true;
		}
		if(name.match(new RegExp('\\b[FA]M( |$)'))){
			return true;
		}
		return false;
	}
	isM3U8(url){
		return ['m3u8', 'm3u'].indexOf(this.ext(url)) != -1          
	}
	isLocalTS(url){
		return !this.isHTTP(url) && this.ext(url) == 'ts'           
	}
	isRemoteTS(url){
		if(typeof(url)!='string') return false;
		return this.isHTTP(url) && this.ext(url) == 'ts'           
	}
	isHTTP(url){
		return this.proto(url, 4) == 'http'
	}
	isMega(url){
		return this.proto(url, 4) == 'mega'  
	}
	isYT(url){
		var y = 'youtube.com'
		url = String(url)
		if(url.indexOf(y)==-1){
			return false
		}
		var d = this.domain(url);
		if(d.substr(d.length - y.length) == y){
			return true
		}
	}
	isRTP(url){ // any real time protocol supported only via FFmpeg
		return 'mms|mmsh|mmst|rtp|rtsp|rtmp'.split('|').indexOf(this.proto(url, 4)) != -1      
	}
	isVideo(url){
		const e = this.ext(url)
		if(e == 'ts'){
			return this.isLocalTS(url)
		} else {
			return 'wmv|avi|mp4|mkv|m4v|mov|flv|webm|ogv'.split('|').indexOf(e) != -1            
		}
	}
	isAudio(url){
		return 'wma|mp3|mka|m4a|flac|aac|ogg|pls|nsv'.split('|').indexOf(this.ext(url)) != -1          
	}
	isLive(url){
		return this.isM3U8(url)||this.isRTP(url)||this.isRemoteTS(url)
	}
}
module.exports = MediaStreamInfo
