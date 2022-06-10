
const Events = require('events'), fs = require('fs'), ParentalControl = require(global.APPDIR + '/modules/lists/parental-control')
const M3UParser = require(global.APPDIR + '/modules/lists/parser'), M3UTools = require(global.APPDIR + '/modules/lists/tools'), MediaStreamInfo = require(global.APPDIR + '/modules/lists/media-info')
const Parser = require(global.APPDIR + '/modules/lists/parser')

LIST_DATA_KEY_MASK = 'list-data-{0}'

class Fetcher extends Events {
	constructor(){		
		super()
		this.cancelables = []
		this.minDataLength = 512
		this.maxDataLength = 32 * (1024 * 1024) // 32Mb
		this.ttl = 24 * 3600
	}
	validateCache(content){
		return typeof(content) == 'string' && content.length >= this.minDataLength
	}
	isLocal(file){
		if(typeof(file) != 'string'){
			return
		}
		let m = file.match(new RegExp('^([a-z]{1,6}):', 'i'))
		if(m && m.length > 1 && (m[1].length == 1 || m[1].toLowerCase() == 'file')){ // drive letter or file protocol
			return true
		} else {
			if(file.length >= 2 && file.charAt(0) == '/' && file.charAt(1) != '/'){ // unix path
				return true
			}
		}
	}
	fetch(path, atts){
		return new Promise((resolve, reject) => {
			if(path.substr(0, 2)=='//'){
				path = 'http:' + path
			}
			if(this.isLocal(path)){
				let stream = fs.createReadStream(path), entries = [], parser = new Parser()
				if(atts){
					if(atts.meta){
						parser.on('meta', meta => atts.meta(meta))
					}
				}
				parser.on('entry', e => entries.push(e))
				parser.once('end',  () => {
					stream.destroy()
					stream = null
					if(entries.length){
						resolve(entries)
					} else {
						reject(global.lang.INVALID_URL_MSG)
					}
					parser.destroy()
				})
				stream.on('data', chunk => {
					parser.write(chunk)
				})
				stream.once('close', () => {
					parser.end()
				})
			} else if(path.match('^https?:')) {
				const dataKey = LIST_DATA_KEY_MASK.format(path)
				global.storage.raw.get(dataKey, data => {
					if(this.validateCache(data)){
						let entries = data.split("\n").filter(s => s.length > 8).map(JSON.parse)
						let last = entries.length - 1
						if(entries[last].length){ // remove index entry
							entries.splice(last, 1)
						}
						resolve(entries)
					} else {
						const opts = {
							url: path,
							keepalive: false,
							retries: 10,
							followRedirect: true,
							headers: {
								'accept-charset': 'utf-8, *;q=0.1'
							},
							downloadLimit: 28 * (1024 * 1024) // 28Mb
						}
						let entries = [], stream = new global.Download(opts)
						stream.once('response', (statusCode, headers) => {
							if(statusCode >= 200 && statusCode < 300) {
								let parser = new Parser(stream)
								if(atts){
									if(atts.meta){
										parser.on('meta', meta => atts.meta(meta))
									}
									if(atts.progress){
										stream.on('progress', p => atts.progress(p))
									}
								}
								parser.on('entry', entry => {
									entries.push(entry)
								})
								parser.once('end', () => {
									stream.destroy()
									stream = null
									if(entries.length){
										global.storage.raw.set(dataKey, entries.map(JSON.stringify).join("\r\n"), true)
										resolve(entries)
									} else {
										reject(global.lang.INVALID_URL_MSG)
									}
									parser.destroy()
								})
							} else {
								stream.destroy()
								stream = null
								reject('http error '+ statusCode)
							}
						})
						stream.start()
					}
				})
			} else {
				reject('bad URL')
			}
		})
	}
	/*
	extract(content){ // extract inline lists from HTMLs
		if(typeof(content) != 'string'){
			content = String(content)
		}
		let pos = content.indexOf('#')
		if(pos == -1){
			return ''
		} else {
			content = content.substr(pos)
			pos = content.substr(0, 80000).toLowerCase().indexOf('<body') // maybe a html page containing list embedded
			if(pos != -1){
				content = content.substr(pos)
				var e = (new RegExp('#(EXTM3U|EXTINF).*', 'mis')).exec(content)
				if(e && e.index){
					content = content.substr(e.index)
					content = content.replace(new RegExp('<[ /]*br[ /]*>', 'gi'), "\r\n")
					e = (new RegExp('</[A-Za-z]+>')).exec(content)
					if(e && e.index){
						content = content.substr(0, e.index)
					}
				} else {
					content = ''
				}
			}
		}
        return content
	}
	*/
}

class Common extends Events {
	constructor(opts){
		super()
		this.Fetcher = Fetcher
		this.searchRedirects = []
		this.stopWords = ['sd', 'hd', 'h264', 'h.264', 'fhd'] // common words to ignore on searching
		this.listMetaKeyPrefix = 'meta-cache-'
		this.opts = {
			folderSizeLimit: 96,
			folderSizeLimitTolerance: 12,
			paginateThreshold: 128,
			offloadThreshold: 512,
			defaultCommunityModeReach: global.cordova ? 18 : 24
		}
        if(opts){
            Object.keys(opts).forEach(k => {
                this[k] = opts[k]
            })
        }
        this.parser = new M3UParser()
        this.tools = new M3UTools(opts)
        this.msi = new MediaStreamInfo()
		this.parentalControl = new ParentalControl()
		this.loadSearchRedirects()
	}
	communityListsRequiredAmount(n, foundCommunityListsCount){
		let satisfyLevel = 0.5
		if(typeof(n) != 'number'){
			n = global.config.get('communitary-mode-lists-amount')
		}
		return Math.min(n * satisfyLevel, foundCommunityListsCount)
	}
	loadSearchRedirects(){
		if(!this.searchRedirects.length){
			fs.readFile(global.joinPath(__dirname, 'search-redirects.json'), (err, content) => { // redirects to find right channel names, as sometimes they're commonly refered by shorter names on IPTV lists
				console.warn('loadSearchRedirects', err, content)
				if(err){
					console.error(err)
				} else {
					let data = JSON.parse(String(content))
					if(data && typeof(data) == 'object'){
						let results = []
						Object.keys(data).forEach(k => {
							results.push({from: this.terms(k), to: this.terms(data[k])})
						})
						this.searchRedirects = results
					}
				}
			})
		}
	}
	applySearchRedirects(terms){
		this.searchRedirects.forEach(redirect => {
			if(redirect.from && redirect.from.length && redirect.from.every(t => terms.includes(t))){
				terms = terms.filter(t => !redirect.from.includes(t)).concat(redirect.to)
			}
		})
		return terms
	}
	applySearchRedirectsOnObject(e){
		if(Array.isArray(e)){
			e = this.applySearchRedirects(e)
		} else if(e.terms) {
			if(typeof(e.terms.name) != 'undefined' && Array.isArray(e.terms.name)){
				e.terms.name = this.applySearchRedirects(e.terms.name)
			} else if(Array.isArray(e.terms)) {
				e.terms = this.applySearchRedirects(e.terms)
			}
		}
		return e
	}
	terms(txt, allowModifier, keepStopWords){
		if(!txt){
			return []
		}
		['"', '/', '=', '.', ','].forEach(c => {
			if(txt.indexOf(c) != -1){
				txt = txt.replaceAll(c, ' ')
			}
		})
		txt = txt.toLowerCase()
		let tms = this.applySearchRedirects(txt.replace(this.parser.regexes['plus-signal'], 'plus').
			replace(this.parser.regexes['between-brackets'], ' $1 ').
			normalize('NFD').toLowerCase().replace(this.parser.regexes['accents'], ''). // replace/normalize accents
			split(' ').
			map(s => {
				if(s.charAt(0) == '-'){
					if(allowModifier){
						s = s.replace(this.parser.regexes['hyphen-not-modifier'], '$1')
						return s.length > 1 ? s : ''
					} else {
						return ''
					}
				} else if(s == '|' && !allowModifier){
					return ''
				}
				return s.replace(this.parser.regexes['hyphen-not-modifier'], '$1')
			}))
		tms = tms.filter(s => s)
		if(!keepStopWords){
			tms = tms.filter(s => !this.stopWords.includes(s))
		}
		return tms
	}
	match(needleTerms, stackTerms, partial){ // partial=true will match "starts with" terms too
		if(needleTerms.includes('|')){
			let needles = needleTerms.join(' ').split('|').map(s => s.trim()).filter(s => s).map(s => s.split(' '))
			let score = 0
			needles.forEach(needle => {
				let s = this.match(needle, stackTerms, partial)
				if(s > score){
					score = s
				}
			})
			return score
		}
		if(needleTerms.length && stackTerms.length){
			let score = 0, sTerms = [], nTerms = []
			let excludeMatch = needleTerms.some(t => {
				if(t.charAt(0) == '-'){
					if(stackTerms.includes(t.substr(1))){
						return true
					}
				} else {
					nTerms.push(t)
				}
			}) || stackTerms.some(t => {
				if(t.charAt(0) == '-'){
					if(needleTerms.includes(t.substr(1))){
						return true
					}
				} else {
					sTerms.push(t)
				}
			})
			if(excludeMatch || !sTerms.length || !nTerms.length){
				return 0
			}
			nTerms.forEach(term => {
				if(partial === true){
					let len = term.length
					sTerms.some(strm => {
						if(len == strm.length){
							if(strm == term){
								score++
								return true
							}
						} else if(strm.length > term.length && term == strm.substr(0, len)){
							score++
							return true
						}
					})
				} else {
					if(sTerms.includes(term)){
						score++
					}
				}
			})
			if(score){
				if(score == nTerms.length) { // all search terms are present
					if(score == sTerms.length){ // terms are equal
						return 3
					} else {
						return 2
					}
				} else if(nTerms.length >= 3 && score == (nTerms.length - 1)){
					return 1
				}
			}
		}
		return 0
	}
	validateType(e, type, strict){
		if(typeof(type) == 'string' && type){
			switch(type){
				case 'live':
					if(strict){
						return this.msi.isLive(e.url)
					} else {
						let ext = this.msi.ext(e.url)
						return !(this.msi.isVideo(e.url, ext) || this.msi.isAudio(e.url, ext))
					}
					break
				case 'video':
					if(strict){
						return this.msi.isVideo(e.url)
					} else {
						let ext = this.msi.ext(e.url)
						return !(this.msi.isLive(e.url, ext) || this.msi.isAudio(e.url, ext))
					}
					break
				case 'audio':
					if(strict){
						return this.msi.isAudio(e.url)
					} else {
						let ext = this.msi.ext(e.url)
						return this.msi.isAudio(e.url, ext) || !(this.msi.isLive(e.url, ext) || this.msi.isVideo(e.url, ext))
					}
					break
			}
		}
		return true
	}
	prepareEntry(e){
		if(typeof(e.terms) == 'undefined'){
			e.terms = {
				name: this.terms(e.name),
				group: this.terms(e.group || '')
			}
		}
		return e
	}
	prepareEntries(es){		
		return es.map(this.prepareEntry.bind(this))
	}
	listMetaKey(url){
		return this.listMetaKeyPrefix + url
	}
	getListMeta(url, cb){
		global.storage.get(this.listMetaKey(url), meta => {
			if(!meta){
				meta = {}
			}
			cb(meta)
		})
	}
	setListMeta(url, newMeta){
		this.getListMeta(url, meta => {
			Object.keys(newMeta).forEach(k => {
				if(newMeta[k]){
					meta[k] = newMeta[k]
				}
			})
			if(Object.keys(meta).length){
				global.storage.set(this.listMetaKey(url), meta, true)
			}
		})
	}
	getListMetaValue(url, key, cb){
		this.getListMeta(url, meta => cb(meta[key] || undefined))
	}
	setListMetaValue(url, key, value){
		this.getListMeta(url, meta => {
			meta[key] = value
			this.setListMeta(url, meta)
		})
	}
	trimListMeta(cb){
		global.storage.deleteAnyStartsWithOlder(this.listMetaKeyPrefix, 30 * (24 * 3600), cb)
	}
}

module.exports = Common
