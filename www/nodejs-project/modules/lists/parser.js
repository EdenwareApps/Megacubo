const { EventEmitter } = require('events')
const LineReader = require('../line-reader')

class Parser extends EventEmitter {
	constructor(opts) {
		super()
		this.opts = opts
		this.meta = {}
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
		this.readen = 0 // no precision required, just for progress stats
		this.lastProgress = -1
	}
	generateAttrMapRegex(attrs) {
		return new RegExp('(' +
			Object.keys(attrs).join('|').replace(new RegExp('-', 'g'), '\\-') +
			')\\s*=\\s*[\'"]([^\r\n\'"]*)[\'"]',
			'g')
	}
	async start() {
		if(!this.opts.stream) throw 'Parser instance started with no stream set!'
		this.liner = new LineReader(this.opts)
		let g = '', a = {}, e = {url: '', icon: ''}, attsMap = {
			'http-user-agent': 'user-agent',
			'referrer': 'referer',
			'http-referer': 'referer',
			'http-referrer': 'referer'
		}
		this.liner.on('line', line => {
			this.readen += (line.length + 1)
			const hashed = line.startsWith('#')
			const sig = hashed ? line.substr(0, 7).toUpperCase() : ''
			const isExtM3U = hashed && this.isExtM3U(sig)
			const isExtInf = hashed && !isExtM3U && this.isExtInf(sig)
			if (!hashed && line.length < 6) return
			if (isExtM3U) {
				if (this.expectingHeader) {
					const matches = [...line.matchAll(this.headerAttrMapRegex)];
					for (const t of matches) {
						if (t && t[2]) {
							t[1] = this.headerAttrMap[t[1]] || t[1];
							this.meta[t[1]] = t[2];
						}
					}
				}
			} else if (isExtInf) {
				if (this.expectingHeader) {
					this.expectingHeader = false
					this.emit('meta', this.meta)
				}
				this.expectingPlaylist = this.isExtInfPlaylist(line)
				let n = '', sg = ''
				const matches = [...line.matchAll(this.attrMapRegex)]
				for (const t of matches) {
					if (t && t[2]) {
						const tag = this.attrMap[t[1]] || t[1]
						switch (tag)  {
							case 'name':
								n = t[2]
								break
							case 'group':
								if (!g || g === 'N/A') {
									g = t[2]
								}
								break
							case 'sub-group':
								if (!sg || sg === 'N/A') {
									sg = t[2]
								}
								break
							default:
								if (!e[this.attrMap[t[1]]]) {
									e[this.attrMap[t[1]]] = t[2]
								}
						}
					}
				}
				g = this.trimPath(g)
				if (sg) {
					g = this.mergePath(g, this.trimPath(sg))
				}
				if(!n) {
					const pos = line.lastIndexOf(',')
					if (pos != -1) {
						n = line.substr(pos + 1).trim()
					}
				}
				e.name = Parser.sanitizeName(n)
			} else if (hashed) {
				// parse here extra info like #EXTGRP and #EXTVLCOPT
				if (sig == '#EXTGRP') {
					let i = line.indexOf(':')
					if (i !== -1) {
						let nwg = line.substr(i + 1).trim()
						if (nwg.length && (!g || g.length < nwg.length)) {
							g = nwg
						}
					}
				} else if (sig == '#EXTVLC') { // #EXTVLCOPT
					let i = line.indexOf(':')
					if (i !== -1) {
						let nwa = line.substr(i + 1).trim().split('=')
						if (nwa) {
							nwa[0] = nwa[0].toLowerCase()
							a[attsMap[nwa[0]] || nwa[0]] = this.trimQuotes(nwa[1] || '')
						}
					}
				}
			} else { // not hashed so, length already checked
				e.url = line
				if (e.url.startsWith('//')) {
					e.url = 'http:' + e.url
				}
				if (e.url.indexOf('|') !== -1 && e.url.match(Parser.regexes['m3u-url-params'])) {
					let parts = e.url.split('|')
					e.url = parts[0]
					parts = parts[1].split('=')
					parts[0] = parts[0].toLowerCase()
					a[attsMap[parts[0]] || parts[0]] = this.trimQuotes(parts[1] || '')
				}
				// removed url validation for performance
				if (!e.name) {
					e.name = e.gid || global.listNameFromURL(e.url)
				}
				const name = e.name.replace(Parser.regexes['between-brackets'], '')
				if (name === e.name) {
					e.rawname = e.name
					e.name = name
				}
				if (Object.keys(a).length) {
					e.atts = a
				}
				g = this.sanitizeGroup(g)
				e.group = g
				e.groups = g.split('/')
				e.groupName = e.groups[e.groups.length - 1]
				if (this.expectingPlaylist) {
					this.emit('playlist', e)
				} else {
					this.emit('entry', e)
				}
				e = { url: '', icon: '' }
				g = ''
			}
			this.emit('progress', this.readen)
		})
		return await new Promise(resolve => {
			const close = () => {
				this.close()
				resolve(true)
			}
			if(this.liner.destroyed) {
				return close()
			}
			this.liner.once('error', err => {
				console.error('PARSER READ ERROR', err)
				close()
			})
			this.liner.once('close', close)
		})
	}
	sanitizeGroup(s) {
		if (s.length == 3 && s.toLowerCase().trim() === 'n/a') {
			return ''
		}
		if(s.match(Parser.regexes['group-separators'])) { // if there are few cases, is better not replace directly
			s = s.replace(Parser.regexes['group-separators'], '/')
		}
		if(s.indexOf('[') != -1) {
			s = s.replace(Parser.regexes['between-brackets'], '')
		}
		// s = s.normalize('NFD') // is it really needed?
		return s
	}
	isExtInf(sig) {
		return sig == '#EXTINF'
	}
	isExtInfPlaylist(line) {
		return line.indexOf('playlist') != -1 && line.match(Parser.regexes['type-playlist'])
	}
	isExtM3U(sig) {
		return sig == '#EXTM3U' || sig == '#PLAYLI' // #playlistv
	}
	trimQuotes(text) {
		const f = text.charAt(0), l = text.charAt(text.length - 1)
		if (f == '"' || f == "'") {
			text = text.substr(1)
		}
		if (l == '"' || l == "'") {
			text = text.substr(0, text.length - 1)
		}
		return text
	}
	trimPath(b) {
		if (b) {
			const chr = b.charAt(b.length - 1)
			if (chr === '/' || chr === ' ') {
				b = b.substr(0, b.length - 1)
			}
		}
		if (b) {
			const chr = b.charAt(0)
			if (chr === '/' || chr === ' ') {
				b = b.substr(1)
			}
		}
		return b
	}
	mergePath(a, b) {
		if (b) {
			a = a +'/'+ b
		}
		return a
	}
	end() {
		if (!this.ended && !this.destroyed) {
			this.ended = true
			this.liner && this.liner.end()
		}
	}
	close() {
		this.emit('finish')
	}
	destroy() {
		if (!this.destroyed) {
			this.destroyed = true
			this.emit('destroy')
			this.end()
		}
		this.liner && this.liner.destroy()
		this.removeAllListeners()
	}
}

Parser.regexes = {
	'group-separators': new RegExp('( ?[\\\\|;] ?| /|/ )', 'g'),
	'notags': new RegExp('\\[[^\\]]*\\]', 'g'),
	'between-brackets': new RegExp('\\[[^\\]]*\\]', 'g'), // match data between brackets
	'accents': new RegExp('[\\u0300-\\u036f]', 'g'), // match accents
	'plus-signal': new RegExp('\\+', 'g'), // match plus signal
	'hyphen': new RegExp('\\-', 'g'), // match any hyphen
	'hyphen-not-modifier': new RegExp('(.)\\-', 'g'), // match any hyphen except if it's the first char (exclude modifier)
	'spaces': new RegExp(' {2,}', 'g'),
	'type-playlist': new RegExp('type[\s\'"]*=[\s\'"]*playlist[\s\'"]*'),
	'strip-query-string': new RegExp('\\?.*$'),
	'strip-proto': new RegExp('^[a-z]*://'),
	'm3u-url-params': new RegExp('.*\\|[A-Za-z0-9\\-]*=')
}

Parser.sanitizeName = s => {
	if(typeof(n) != 'string' || !n) {
		n = 'Untitled '+ parseInt(Math.random() * 10000)
	} else if (s.indexOf('/') !== -1) {
		if (s.indexOf('[/') !== -1) {
			s = s.split('[/').join('[|')
		}
		if (s.indexOf('/') !== -1) {
			s = s.replaceAll('/', ' ')
		}
	}
	/* needed on too specific cases, but bad for performance
	if (s.indexOf('\\') !== -1) {
		s = global.replaceAll('\\', ' ')
	}
	*/
	return s
}

module.exports = Parser
