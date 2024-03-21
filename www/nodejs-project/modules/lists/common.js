const { EventEmitter } = require('events')

global.LIST_DATA_KEY_MASK = 'list-data-1-{0}'

class Fetcher extends EventEmitter {
	constructor(url, atts, master){
		super()
		this.progress = 0
		this.atts = atts
        this.url = url
		this.playlists = []
		this.master = master
		process.nextTick(() => {
			this.start().catch(e => this.error = e).finally(() => {
				this.isReady = true
				this.emit('ready')
			})
		})
	}
	ready(){
		return new Promise(resolve => {
			if(this.isReady){
				resolve()
			} else {
				this.once('ready', resolve)
			}
		})
	}
	start(){
		return new Promise((resolve, reject) => {
			const List = require('./list')
			this.list = new List(this.url, this.master)
			this.list.skipValidating = true
			this.list.start().then(resolve).catch(err => {
				this.error = err
				this.master.loader.addListNow(this.url, this.atts).then(() => {
					this.list.start().then(resolve).catch(err => {
						this.error += ' '+ err
						this.list.destroy()
						reject(err)
					})
				}).catch(err => {
					this.error += ' '+ err
					this.list.destroy()
					reject(this.error)
				})
			})
		})
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
			if(file.length >= 2 && file.startsWith('/') && file.charAt(1) != '/'){ // unix path
				return true
			}
		}
	}
	async fetch(){
		await this.ready()
		return await this.list.fetchAll()
	}
    async getMap(map){
		await this.ready()
		return await this.list.getMap(map)
    }
	async meta(){
		await this.ready()
		return this.list.index.meta || {}
	}
	destroy(){
		this.list && this.list.destroy()
		this.updater && this.list.destroy()
	}
}

class Common extends EventEmitter {
	constructor(opts){
		super()
		
		const { regexes, sanitizeName } = require('./parser')
		this.regexes = regexes
		this.charToSpaceRegex = new RegExp('["/=\\,\\.:]+')
		this.sanitizeName = sanitizeName
		this.Fetcher = Fetcher
		this.searchRedirects = []
		this.stopWords = ['sd', '4k', 'hd', 'h264', 'h.264', 'fhd', 'uhd'] // common words to ignore on searching
		this.listMetaKeyPrefix = 'meta-cache-'
		this.opts = {
			defaultCommunityModeReach: 12,
			folderSizeLimitTolerance: 12,
			offloadThreshold: 256
		}
        if(opts){
            Object.keys(opts).forEach(k => {
                this[k] = opts[k]
            })
        }

		const M3UTools = require('./tools')
        const MediaURLInfo = require('../streamer/utils/media-url-info')
        const ParentalControl = require('./parental-control')
		this.tools = new M3UTools(opts)
		this.mi = new MediaURLInfo()
		this.parentalControl = new ParentalControl()
		this.loadSearchRedirects()
	}
	loadSearchRedirects(){
		if(!this.searchRedirects.length){
			const fs = require('fs')
			fs.readFile(global.joinPath(__dirname, 'search-redirects.json'), (err, content) => { // redirects to find right channel names, as sometimes they're commonly refered by shorter names on IPTV lists
				console.warn('loadSearchRedirects', err, content)
				if(err){
					console.error(err)
				} else {
					let data = global.parseJSON(content)
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
				terms = terms.filter(t => !redirect.from.includes(t))
				terms.push(...redirect.to)
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
	terms(txt, noModifiers, keepStopWords){
		if(!txt){
			return []
		}
		if(Array.isArray(txt)) {
			txt = txt.join(' ')
		}
		txt = txt.toLowerCase()
		if(txt.match(this.charToSpaceRegex)) {
			txt = txt.replace(this.charToSpaceRegex, ' ')
		}
		const tchar = txt.charAt(2)
		if(tchar == ' ') {
			// for channels name formatted like 'US: CNN', 'US - CNN' or 'US | CNN'
			const maybeCountryCode = txt.substr(0, 2)
			if(!Array.isArray(this.countryCodes)) {
				this.countryCodes = require('../countries/countries.json').map(c => c.code)
			}
			if(this.countryCodes.includes(maybeCountryCode)) {
				txt = txt.substr(3).trim()
			}
		}
		let tms = this.applySearchRedirects(txt.replace(this.regexes['plus-signal'], 'plus').
			replace(this.regexes['between-brackets'], '').
			normalize('NFD').toLowerCase().replace(this.regexes['accents'], ''). // replace/normalize accents
			split(' ').
			map(s => {
				if(s.startsWith('-')){
					if(noModifiers){
						return ''
					} else {
						s = s.replace(this.regexes['hyphen-not-modifier'], '$1')
						return s.length > 1 ? s : ''
					}
				} else if(s == '|' && noModifiers){
					return ''
				}
				return s.replace(this.regexes['hyphen-not-modifier'], '$1')
			}))
		tms = tms.filter(s => s)
		if(!keepStopWords){
			tms = tms.filter(s => !this.stopWords.includes(s))
		}
		return tms
	}
	match(needleTerms, stackTerms, partial){ // partial=true will match "starts with" terms too
		if(!Array.isArray(needleTerms)){
			console.error('needleTerms is not an array', needleTerms)
		}
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
				if(t.startsWith('-')){
					if(stackTerms.includes(t.substr(1))){
						return true
					}
				} else {
					nTerms.push(t)
				}
			}) || stackTerms.some(t => {
				if(t.startsWith('-')){
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
						return this.mi.isLive(e.url)
					} else {
						let ext = this.mi.ext(e.url)
						return !(this.mi.isVideo(e.url, ext) || this.mi.isAudio(e.url, ext))
					}
					break
				case 'video':
					if(strict){
						return this.mi.isVideo(e.url)
					} else {
						let ext = this.mi.ext(e.url)
						return !(this.mi.isLive(e.url, ext) || this.mi.isAudio(e.url, ext))
					}
					break
				case 'audio':
					if(strict){
						return this.mi.isAudio(e.url)
					} else {
						let ext = this.mi.ext(e.url)
						return this.mi.isAudio(e.url, ext) || !(this.mi.isLive(e.url, ext) || this.mi.isVideo(e.url, ext))
					}
					break
			}
		}
		return true
	}
	prepareEntry(e){
		if(typeof(e._) == 'undefined' && typeof(e.terms) == 'undefined'){
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
	async getListMeta(url){
		let haserr, meta = await global.storage.get(this.listMetaKey(url)).catch(err => {
			haserr = true
			console.error(err)
		})
		if(haserr || !meta){
			meta = {}
		}
		return meta
	}
	async setListMeta(url, newMeta){
		if(newMeta && typeof(newMeta) == 'object'){
			let changed, meta = await this.getListMeta(url)
			Object.keys(newMeta).forEach(k => {
				if(newMeta[k] && meta[k] !== newMeta[k]){
					meta[k] = newMeta[k]
					if(!changed){
						changed = true
					}
				}
			})
			if(changed){
				await global.storage.set(this.listMetaKey(url), meta, {
					expiration: true
				})
			}
		}
	}
	async getListMetaValue(url, key){
		const meta = await this.getListMeta(url)
		if(meta) return meta[key] || undefined
	}
	async setListMetaValue(url, key, value){
		const meta = await this.getListMeta(url)
		meta[key] = value
		await this.setListMeta(url, meta)
	}
}

module.exports = Common
