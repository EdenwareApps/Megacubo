const { EventEmitter } = require('events'), fs = require('fs')
const readline = require('readline')

class PersistentFileReader extends EventEmitter {
	constructor(opts={}) {
		super()
		this.opts = opts
		this.minBufferSize = 8192 // avoid opening files too frequently
		this.readOffset = 0
		this.readStream = null
		this.lineReader = null
		this.watcher = null
		this.isWatching = false
		this.isReading = false
		this.isEnding = false
		this.startWatch()
	}
	watch(path, callback) {
		const minSize = this.readOffset + this.minBufferSize
		const close = () => {
			callback = () => {}
			watcher.close()
		}
		const statCallback = (err, stats) => {
			if (!err && stats.size >= minSize) {
				callback()
				close()
			}
		}
		const watcher = fs.watch(path, eventType => {
			if (eventType === 'change') {
				fs.stat(path, statCallback)
			}
		})
		fs.stat(path, statCallback)
		return { close }
	}
	startWatch() {
		if (!this.isWatching) {
			this.isWatching = true
			this.watcher = this.watch(this.opts.file, () => {
				this.stopWatch()
				this.startReading()
			})
		}
	}
	stopWatch() {
		if (this.isWatching) {
			this.isWatching = false
			if(this.watcher) {
				this.watcher.close()
				this.watcher = null
			}
		}
	}
	async hasChanges(){
		const stat = await fs.promises.stat(this.opts.file)
		return stat.size > this.readOffset
	}
	startReading() {
		if (!this.isReading) {
			this.hasChanges().then(has => {
				if(has) {
					this.isReading || this.read()
				} else if(this.isEnding) {
					this.emit('close')
					return this.stopWatch()
				}
			}).catch(err => {
				console.error(err)				
				this.emit('close')
				this.stopWatch()
			})
		}
	}
	read() {
		if (!this.isReading) {
			this.stopWatch()
			this.isReading = true
			this.readStream = fs.createReadStream(this.opts.file, {
				start: this.readOffset,
				encoding: 'utf8'
			})
			this.lineReader = readline.createInterface({
				input: this.readStream,
				terminal: false,
				historySize: 0,
				removeHistoryDuplicates: false,
				crlfDelay: Infinity			
			})
			this.lineReader.on('line', line => this.emit('line', line))
			this.lineReader.on('close', () => {
				this.readOffset += this.readStream.bytesRead
				if (!this.opts.persistent || this.isEnding) {
					this.emit('close')
					this.stopWatch()
				} else {
					this.startWatch()
				}
			})
			this.readStream.on('error', err => {
				console.error(err)
				this.emit('error', err)
				this.readStream.close()
				this.isReading = false
			})
			this.readStream.on('end', () => {
				this.readStream.close()
				this.isReading = false
			})
		}
	}
	end() {
		this.isEnding = true
		if (this.isReading) {
			this.isReading = false
		}
		this.startReading()
	}
}

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
		this.headerRegex = new RegExp('^#(extm3u|playlistv)[^\r\n]*', 'gim')
		this.readen = 0 // no precision required, just for progress stats
		this.lastProgress = -1
		if(this.opts.file){
			this.reader = new PersistentFileReader(this.opts)
			this.parse().catch(console.error)
		}
	}
	generateAttrMapRegex(attrs) {
		return new RegExp('(' +
			Object.keys(attrs).join('|').replace(new RegExp('-', 'g'), '\\-') +
			')\\s*=\\s*[\'"]([^\r\n\'"]*)[\'"]',
			'g')
	}
	parse() {
		return new Promise((resolve, reject) => {
			let g = '', a = {}, e = {url: '', icon: ''}, attsMap = {
				'http-user-agent': 'user-agent',
				'referrer': 'referer',
				'http-referer': 'referer',
				'http-referrer': 'referer'
			}
			this.reader.on('line', line => {
				this.readen += (line.length + 1)
				if(line.length < 6) return
				const hashed = line.charAt(0) === '#'
				if (hashed && this.isExtM3U(line)) {
					if (this.expectingHeader) {
						for (const t of line.matchAll(this.headerAttrMapRegex)) {
							if (this.destroyed) break
							if (t && t[2]) {
								if (this.headerAttrMap[t[1]]) {
									t[1] = this.headerAttrMap[t[1]]
								}
								if (!this.meta[t[1]]) {
									this.meta[t[1]] = t[2]
								}
							}
						}
					}
				} else if (hashed && this.isExtInf(line)) {
					if (this.expectingHeader) {
						this.expectingHeader = false
						this.emit('meta', this.meta)
					}
					this.expectingPlaylist = this.isExtInfPlaylist(line)
					let n = '', sg = ''
					for (const t of line.matchAll(this.attrMapRegex)) {
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
					let ucline = line.toUpperCase()
					if (ucline.startsWith('#EXTGRP')) {
						let i = ucline.indexOf(':')
						if (i !== -1) {
							let nwg = line.substr(i + 1).trim()
							if (nwg.length && (!g || g.length < nwg.length)) {
								g = nwg
							}
						}
					} else if (ucline.startsWith('#EXTVLCOPT')) {
						let i = ucline.indexOf(':')
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
					if (global.validateURL(e.url)) {
						if (!e.name) {
							e.name = e.gid || this.nameFromURL(e.url)
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
				}
				this.emit('progress', this.readen)
			})
			this.reader.on('close', () => {
				this.emit('finish')
				resolve(true)
			})
		})
	}
	end() {
		if (!this.ended && !this.destroyed) {
			this.ended = true
			this.reader.end()
		}
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
	isExtInf(line) {
		return line.charAt(0) == '#' && line.substr(0, 7).toUpperCase() == '#EXTINF'
	}
	isExtInfPlaylist(line) {
		return line.indexOf('playlist') != -1 && line.match(Parser.regexes['type-playlist'])
	}
	isExtM3U(line) {
		let ucline = line.substr(0, 7).toUpperCase()
		return ucline == '#EXTM3U' || ucline == '#PLAYLI' // #playlistv
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
	nameFromURL(url) {
		let name
		if (url.indexOf('?') !== -1) {
			url.split('?')[1].split('&').forEach(s => {
				s = s.split('=')
				if (s.length > 1) {
					if (['name', 'dn', 'title'].includes(s[0])) {
						if (!name || name.length < s[1].length) {
							name = s[1]
						}
					}
				}
			})
		}
		if (name) {
			name = global.decodeURIComponentSafe(name)
			if (name.indexOf(' ') === -1 && name.indexOf('+') !== -1) {
				name = name.replaceAll('+', ' ').replaceAll('<', '').replaceAll('>', '')
			}
			return name
		}
		url = url.replace(Parser.regexes['strip-proto'], '').split('/').filter(s => s.length)
		if (url.length > 1) {
			return (url[0].split('.')[0] + ' ' + url[url.length - 1]).replace(Parser.regexes['strip-query-string'], '')
		} else {
			return 'Untitled ' + parseInt(Math.random() * 100000)
		}
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
			a = [a, b].join('/')
		}
		return a
	}
	destroy() {
		if (!this.destroyed) {
			this.destroyed = true
			this.emit('destroy')
			this.end()
		}
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
