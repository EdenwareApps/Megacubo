//let parsing = parser.parseStream(dwStream).then(es => {}).catch(err => {})

const Events = require('events'), bsplit = require('buffer-split')

class IPTVPlaylistStreamParser extends Events {
	constructor(stream){
		super()
		this.buffer = []
		this.bufferSize = 4096
		this.meta = {}
		this.data = {}
		this.nl = "\n"
		this.bnl = Buffer.from(this.nl)
		this.expectingHeader = true
		this.headerRegex = new RegExp('#(extm3u|playlistv)[^\r\n]*', 'gim')
		this.headerAttrMap = {
			'x-tvg-url': 'epg',
			'pltv-cover': 'icon', // before pltv-logo
			'pltv-logo': 'icon',
			'pltv-author': 'author',
			'pltv-site': 'site',
			'pltv-email': 'email',
			'pltv-phone': 'phone',
			'pltv-name': 'name',
			'pltv-description': 'description'
		}
		this.headerAttrMapRegex = new RegExp('('+ Object.keys(this.headerAttrMap).join('|').replace('-', '\-') +')\s*=\s*[\'"]([^\r\n\'"]+)', 'g')
		this.attrMap = {
			'tvg-id': 'gid', 
			'tvg-name': 'name', 
			'tvg-logo': 'icon',
			'tvg-language': 'lang',
			'tvg-country': 'country', 
			'group-title': 'group', 
			'pltv-subgroup': 'sub-group'
		}
		this.attrMapRegex = new RegExp('('+ Object.keys(this.attrMap).join('|').replace('-', '\-') +')\s*=\s*[\'"]([^\r\n\'"]+)', 'g')
		this.entriesRegex = new RegExp('(^(#[^\r\n]+),\s*([^\r\n]*)\s*[\r\n]+\s*([^#\r\n ]*)$)', 'gim')
		this.regexes = {
			'notags': new RegExp('\\[[^\\]]*\\]', 'g'),
			'nullgroup': new RegExp('(^[^A-Za-z0-9])N/A([^A-Za-z0-9]$)', 'i'),
			'non-alpha': new RegExp('^[^0-9A-Za-zÀ-ÖØ-öø-ÿ!\n]+|[^0-9A-Za-zÀ-ÖØ-öø-ÿ!\n]+$', 'g'), // match non alphanumeric on start or end,
			'between-brackets': new RegExp('[\(\\[].*[\)\\]]'), // match data between brackets
			'accents': new RegExp('[\\u0300-\\u036f]', 'g'), // match accents
			'plus-signal': new RegExp('\\+', 'g'), // match plus signal
			'hyphen': new RegExp('\\-', 'g'), // match any hyphen
			'hyphen-not-modifier': new RegExp('(.)\\-', 'g'), // match any hyphen except if it's the first char (exclude modifier)
			'spaces': new RegExp(' +', 'g')
		}
		if(stream){
			stream.on('data', this.write.bind(this))
			stream.on('end', this.end.bind(this))
		}
	}
	write(chunk){
		if(!Buffer.isBuffer(chunk)){
			chunk = Buffer.from(chunk)
		}
		this.buffer.push(chunk)
		if(this.len(this.buffer) >= this.bufferSize){
			this.parseBuffer(false)
		}
	}
	end(){
		if(!this.ended && !this.destroyed){
			this.ended = true
			this.parseBuffer(true)
			this.emit('end')
		}
	}
	len(data){
		if(!data){
			return 0
		} else if(Array.isArray(data)) {
			let len = 0
			data.forEach(d => {
				len += this.len(d)
			})
			return len
		} else if(typeof(data.byteLength) != 'undefined') {
			return data.byteLength
		} else {
			return data.length
		}
	}
	sanitizeName(s){
		if(s.indexOf('[') != -1){
			s = s.replace(this.regexes['notags'], '')
		}
		if(s.indexOf('\\') != -1){
			s = s.replaceAll('\\', ' ')
		}
		if(s.indexOf('/') != -1){
			s = s.replaceAll('/', ' ')
		}
		if(s.charAt(0) == ' ' || s.charAt(s.length - 1) == ' '){
			s = s.trim()
		}
		if(s.indexOf('  ') != -1){
			s = s.replace(new RegExp(' +', 'g'), ' ')
		}
		return s
	}
	preSanitizeGroup(s){
		if(s.toLowerCase().trim() == 'n/a'){
			return ''
		}
		s = s.replaceAll('\\', '/')
		s = s.replaceAll('|', '/')
		s = s.split('/').map(t => t.trim()).filter(t => t.length).join('/')
		return s
	}
	sanitizeGroup(s){
		return s.
		replace(this.regexes['plus-signal'], 'plus').
		replace(this.regexes['between-brackets'], ' ').
		normalize('NFD').
		replace(this.regexes['hyphen'], ' '). // replace(this.regexes['accents'], ''). // replace/normalize accents
		replace(this.regexes['non-alpha'], '').
		replace(this.regexes['spaces'], ' ')
	}
	parseBuffer(ended){
		let buf = Buffer.concat(this.buffer)
		if(!this.validated){
			this.validated = true
			if(String(buf).toLowerCase().indexOf('#ext') == -1){
				this.buffer = []
				if(this.stream){
					this.stream.destroy()
				}
				this.end()
				return
			}
		}
		let lines = bsplit(buf, this.bnl)
		this.buffer = []
		if(!ended){
			let left = [], n
			lines = lines.map(l => Buffer.concat([l, this.bnl]))
			for(let i=lines.length - 1; i >= 0; i--){
				if(this.isExtInf(lines[i])){
					n = i
					break
				}
			}
			if(typeof(n) == 'undefined'){
				left = lines
				lines = []
			} else {
				left = lines.slice(n)
				lines = lines.slice(0, n) // ?!				
			}
			this.buffer.unshift(Buffer.concat(left))
		}
		if(lines.length){
			let data = lines.map(s => String(s)).join('')
			this.extractEntries(data)
		}
	}
	isExtInf(line){
		return String(line).toLowerCase().indexOf('#extinf') != -1
	}
	extractEntries(txt){
		if(this.expectingHeader){
			const matches = txt.match(this.headerRegex)
			if(matches){
				matches.forEach(line => {
					for(const t of line.matchAll(this.headerAttrMapRegex)){
						if(this.destroyed) break
						if(t && t[2]){
							if(this.headerAttrMap[t[1]]){
								this.meta[this.headerAttrMap[t[1]]] = t[2]
							} else {
								this.meta[t[1]] = t[2]
							}
						}
					}
				})
			}
		}
		const matches = txt.matchAll(this.entriesRegex)
		for(const match of matches){
			if(this.destroyed) break
			if(match[4].indexOf('/') != -1){
				if(this.expectingHeader){
					this.expectingHeader = false
					this.emit('meta', this.meta)
				}
				let e = {url: match[4].trim(), icon: ''}
				if(e.url.substr(0, 2) == '//'){
					e.url = 'http:' + e.url
				}
				if(this.validateURL(e.url)){
					let g = '', n = match[3], sg = ''
					for(const t of match[2].matchAll(this.attrMapRegex)){
						if(t && t[2]){
							if(this.attrMap[t[1]] == 'name'){
								if(!n || n == 'N/A'){
									n = t[2]
								}
							} else if(this.attrMap[t[1]] == 'group'){
								if(!g || g == 'N/A'){
									g = t[2]
								}
							} else if(this.attrMap[t[1]] == 'sub-group'){
								if(!sg || sg == 'N/A'){
									sg = t[2]
								}
							} else if(!e[this.attrMap[t[1]]]){
								e[this.attrMap[t[1]]] = t[2]
							}
						}
					}
					g = this.trimPath(g)
					if(sg){
						g = this.mergePath(g, sg)
					}
					e.name = this.sanitizeName(n)
					g = this.preSanitizeGroup(g)
					e.groupName = g.split('/').pop()
					g = this.sanitizeGroup(g)
					e.group = g
					e.groups = g.split('/')
					this.emit('entry', e)
				}
			}
		}
	}
	trimPath(b){
		if(b){
			if(b.charAt(b.length - 1) == '/'){
				b = b.substr(0, b.length - 1)
			}
		}
		if(b){
			if(b.charAt(0) == '/'){
				b = b.substr(1)
			}
		}
		return b
	}
	mergePath(a, b){
		if(b){
			b = this.trimPath(b)
			if(b){
				a = [a, b].join('/')
			}
		}
		return a
	}
	validateURL(url){
		if(url){
			let u = url.toLowerCase()
			if(u.substr(0, 7) == 'magnet:'){
				return true
			}
			if(['http', 'rtmp', 'rtsp'].includes(u.substr(0, 4)) && u.indexOf('://') != -1){
				return true
			}
		}
	}
	destroy(){
		if(!this.destroyed){
			this.destroyed = true
			this.emit('destroy')
		}
	}
}

module.exports = IPTVPlaylistStreamParser
