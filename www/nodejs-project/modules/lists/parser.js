
const Events = require('events'), bsplit = require('buffer-split')

class IPTVM3UParser extends Events {
	constructor(stream){
		super()
		this.buffer = []
		this.bufferSize = 256 * 1024
		this.meta = {}
		this.data = {}
		this.nl = "\n"
		this.bnl = Buffer.from(this.nl)
		this.expectingHeader = true
		this.attrMap = {
			'logo': 'icon',
			'm3u-name': 'name',
			'tvg-id': 'gid', 
			'tvg-name': 'name', 
			'tvg-logo': 'icon',
			'tvg-language': 'lang',
			'tvg-country': 'country', 
			'group-title': 'group', 
			'pltv-subgroup': 'sub-group'
		}
		this.headerAttrMap = {
			'url-tvg': 'epg',
			'x-tvg-url': 'epg',
			'iptv-name': 'name',
			'pltv-cover': 'icon', // before pltv-logo
			'pltv-logo': 'icon',
			'pltv-author': 'author',
			'pltv-site': 'site',
			'pltv-email': 'email',
			'pltv-phone': 'phone',
			'pltv-name': 'name',
			'pltv-description': 'description'
		}
		this.attrMapRegex = this.generateAttrMapRegex(this.attrMap)
		this.headerAttrMapRegex = this.generateAttrMapRegex(this.headerAttrMap)
		this.headerRegex = new RegExp('#(extm3u|playlistv)[^\r\n]*', 'gim')
		this.regexes = {
			'notags': new RegExp('\\[[^\\]]*\\]', 'g'),
			'non-alpha': new RegExp('^[^0-9A-Za-zÀ-ÖØ-öø-ÿ!\n]+|[^0-9A-Za-zÀ-ÖØ-öø-ÿ!\n]+$', 'g'), // match non alphanumeric on start or end,
			'between-brackets': new RegExp('\\[[^\\]]*\\]', 'g'), // match data between brackets
			'accents': new RegExp('[\\u0300-\\u036f]', 'g'), // match accents
			'plus-signal': new RegExp('\\+', 'g'), // match plus signal
			'hyphen': new RegExp('\\-', 'g'), // match any hyphen
			'hyphen-not-modifier': new RegExp('(.)\\-', 'g'), // match any hyphen except if it's the first char (exclude modifier)
			'spaces': new RegExp(' +', 'g'),
			'type-playlist': new RegExp('type[\s\'"]*=[\s\'"]*playlist[\s\'"]*')
		}
		if(stream){
			stream.on('data', this.write.bind(this))
			stream.once('error', this.end.bind(this))
			stream.once('end', this.end.bind(this))
		}
	}
	generateAttrMapRegex(attrs){
		return new RegExp('('+ Object.keys(attrs).join('|').replace(new RegExp('-', 'g'), '\\-') +')\\s*=\\s*[\'"]([^\r\n\'"]*)', 'gi')
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
		if (!data) {
			return 0
		}
		if (Array.isArray(data)) {
			return data.reduce((acc, val) => acc + this.len(val), 0)
		}
		return data.byteLength || data.length || 0
	}
	sanitizeName(s){
		if(s.indexOf('[/') != -1){
			s = s.split('[/').join('[|')
		}
		if(s.indexOf('\\') != -1){
			s = global.forwardSlashes(s)
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
		s = global.forwardSlashes(s)
		s = s.replaceAll('|', '/')
		s = s.split('/').map(t => t.trim()).filter(t => t.length).join('/')
		return s
	}
	sanitizeGroup(s){
		return s.
		replace(this.regexes['plus-signal'], 'plus').
		replace(this.regexes['between-brackets'], '').
		normalize('NFD').
		replace(this.regexes['hyphen'], ' '). // replace(this.regexes['accents'], ''). // replace/normalize accents
		replace(this.regexes['non-alpha'], '').
		replace(this.regexes['spaces'], ' ')
	}
	parseBuffer(ended){
		let data, buf = Buffer.concat(this.buffer)
		if(!this.validated){
			if(this.len(buf) >= this.bufferSize || ended){
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
		}
		if(ended){
			data = String(buf)
			this.buffer = []
		} else {
			let lines = bsplit(buf, this.bnl)
			this.buffer = []
			let left = [], n
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
			data = lines.map(s => String(s)).join("\r\n")
		}
		if(data){
			this.extractEntries(data)
		}
	}
	isExtInf(line){
		return String(line).toLowerCase().indexOf('#extinf') != -1
	}
	isExtInfPlaylist(line){
		const l = String(line).toLowerCase()
		return l.indexOf('#extinf') != -1 && l.match(this.regexes['type-playlist'])
	}
	isExtM3U(line){
		let lcline = String(line).toLowerCase()
		return lcline.indexOf('#extm3u') != -1 || lcline.indexOf('#playlistv') != -1
	}
	trimQuotes(text){
		const quotes = ["'", '"']
		if(quotes.includes(text.charAt(0))){
			text = text.substr(1)
		}
		if(quotes.includes(text.charAt(text.length - 1))){
			text = text.substr(0, text.length - 1)
		}
		return text
	}
	nameFromURL(url){
		let name, ourl = url
		if(url.indexOf('?') != -1){
			let qs = {}
			url.split('?')[1].split('&').forEach(s => {
				s = s.split('=')
				if(s.length > 1){
					if(['name', 'dn', 'title'].includes(s[0])){
						if(!name || name.length < s[1].length){
							name = s[1]
						}
					}
				}
			})
		}
		if(name){
			name = global.decodeURIComponentSafe(name)
			if(name.indexOf(' ') == -1 && name.indexOf('+') != -1){
				name = name.replaceAll('+', ' ').replaceAll('<', '').replaceAll('>', '')
			}
			return name
		}
		url = url.replace(new RegExp('^[a-z]*://'), '').split('/').filter(s => s.length)
		if(url.length > 1){
			return (url[0].split('.')[0] + ' ' + url[url.length - 1]).replace(new RegExp('\\?.*$'), '')
		} else {
			return 'Untitled ' + parseInt(Math.random() * 100000)
		}
	}
	extractEntries(txt){
		let attsMap = {
			'http-user-agent': 'user-agent',
			'referrer': 'referer',
			'http-referer': 'referer',
			'http-referrer': 'referer'
		}
		let g = '', a = {}, e = {url: '', icon: ''}
		txt.split("\n").filter(s => s.length > 6).map(s => s.trim()).forEach(line => {
			if(this.isExtM3U(line)) {
				if(this.expectingHeader){
					const matches = line.match(this.headerRegex)
					if(matches){
						matches.forEach(l => {
							for(const t of l.matchAll(this.headerAttrMapRegex)){
								if(this.destroyed) break
								if(t && t[2]){
									if(this.headerAttrMap[t[1]]){
										t[1] = this.headerAttrMap[t[1]]
									}
									if(!this.meta[t[1]]){
										this.meta[t[1]] = t[2]
									}
								}
							}
						})
					}
				}
			} else if(this.isExtInf(line)) {
				if(this.expectingHeader){
					this.expectingHeader = false
					this.emit('meta', this.meta)
				}
				this.expectingPlaylist = this.isExtInfPlaylist(line)
				let n = '', sg = '', pos = line.lastIndexOf(',')
				if(pos != -1){
					n = line.substr(pos + 1).trim()
				}
				for(const t of line.matchAll(this.attrMapRegex)){
					if(t && t[2]){
						if(this.attrMap[t[1]] == 'name') {
							if(!n || n == 'N/A'){
								n = t[2]
							}
						} else if(this.attrMap[t[1]] == 'group') {
							if(!g || g == 'N/A'){
								g = t[2]
							}
						} else if(this.attrMap[t[1]] == 'sub-group') {
							if(!sg || sg == 'N/A'){
								sg = t[2]
							}
						} else if(!e[this.attrMap[t[1]]]) {
							e[this.attrMap[t[1]]] = t[2]
						}
					}
				}
				g = this.trimPath(g)
				if(sg){
					g = this.mergePath(g, sg)
				}
				if(n){
					e.name = this.sanitizeName(n)
				}
			} else if(line.charAt(0) == '#') {
				// parse here extra info like #EXTGRP and #EXTVLCOPT
				let lcline = line.toLowerCase()
				if(lcline.indexOf('#EXTGRP') != -1){
					let i = lcline.indexOf(':')
					if(i != -1){
						let nwg = line.substr(i + 1).trim()
						if(nwg.length && (!g || g.length < nwg.length)){
							g = nwg
						}
					}
				} else if(lcline.indexOf('#EXTVLCOPT') != -1){
					let i = lcline.indexOf(':')
					if(i != -1){
						let nwa = line.substr(i + 1).trim().split('=')
						if(nwa){
							nwa[0] = nwa[0].toLowerCase()
							a[attsMap[nwa[0]] || nwa[0]] = this.trimQuotes(nwa[1] || '')
						}
					}
				}
			} else if(line.charAt(0) == '/' || line.substr(0, 7) == 'magnet:' || line.indexOf('://') != -1) {
				e.url = line
				if(e.url.substr(0, 2) == '//'){
					e.url = 'http:' + e.url
				}
				if(e.url.indexOf('|') != -1 && e.url.match(new RegExp('.*\\|[A-Za-z0-9\\-]*='))){
					let parts = e.url.split('|')
					e.url = parts[0]
					parts = parts[1].split('=')
					parts[0] = parts[0].toLowerCase()
					a[attsMap[parts[0]] || parts[0]] = this.trimQuotes(parts[1] || '')
				}
				if(global.validateURL(e.url)){
					if(!e.name){
						e.name = e.gid || this.nameFromURL(e.url)
					}
					const name = e.name.replace(this.regexes['between-brackets'], '')
					if(name == e.name){
						e.rawname = e.name
						e.name  = name
					}
					g = this.preSanitizeGroup(g)
					e.groupName = g.split('/').pop()
					g = this.sanitizeGroup(g)
					if(Object.keys(a).length){
						e.atts = a
					}
					e.group = g
					e.groups = g.split('/')
					if(this.expectingPlaylist){
						this.emit('playlist', e)
					} else {
						this.emit('entry', e)
					}
				}
				e = {url: '', icon: ''}
				g = ''
			}
		})
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
	destroy(){
		if(!this.destroyed){
			this.destroyed = true
			this.emit('destroy')
		}
		this.removeAllListeners()
	}
}

module.exports = IPTVM3UParser
