
const Events = require('events'), fs = require('fs'), ParentalControl = require(global.APPDIR + '/modules/lists/parental-control')
const M3UParser = require(global.APPDIR + '/modules/lists/parser'), M3UTools = require(global.APPDIR + '/modules/lists/tools'), MediaStreamInfo = require(global.APPDIR + '/modules/lists/media-info')
const Parser = require(global.APPDIR + '/modules/lists/parser')
const List = require(global.APPDIR + '/modules/lists/list')
const UpdateListIndex = require(global.APPDIR + '/modules/lists/update-list-index')

LIST_DATA_KEY_MASK = 'list-data-1-{0}'

class Fetcher extends Events {
	constructor(url, atts, master){
		super()
		this.progress = 0
		this.atts = atts
        this.url = url
		this.playlists = []
		this.master = master
		this.file = global.storage.raw.resolve(global.LIST_DATA_KEY_MASK.format(url))
		process.nextTick(() => {
			this.start().catch(console.error).finally(() => {
				this.isReady = true
				this.emit('ready')
			})
		})
	}
	ready(){
		return new Promise((resolve, reject) => {
			if(this.isReady){
				resolve()
			} else {
				this.once('ready', resolve)
			}
		})
	}
	start(){
		return new Promise((resolve, reject) => {
			this.list = new List(this.url, this.master, [])
			this.list.skipValidating = true
			this.list.start().then(resolve).catch(err => {
				this.updater = new UpdateListIndex(this.url, this.url, this.file, this.master, {})
				if(typeof(this.atts.progress) == 'function'){
					this.updater.on('progress', p => this.atts.progress(p))
				}
				this.updater.start().then(() => {
					this.list.start().then(resolve).catch(err => {
						this.list.destroy()
						this.updater.destroy()
						reject(err)
					})
				}).catch(err => {
					this.list.destroy()
					this.updater.destroy()
					reject(err)
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
			if(file.length >= 2 && file.charAt(0) == '/' && file.charAt(1) != '/'){ // unix path
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

class Common extends Events {
	constructor(opts){
		super()
		this.Fetcher = Fetcher
		this.searchRedirects = []
		this.stopWords = ['sd', 'hd', 'h264', 'h.264', 'fhd'] // common words to ignore on searching
		this.listMetaKeyPrefix = 'meta-cache-'
		this.opts = {
			folderSizeLimitTolerance: 12,
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
	loadSearchRedirects(){
		if(!this.searchRedirects.length){
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
			replace(this.parser.regexes['between-brackets'], '').
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
		let haserr, meta = await global.storage.promises.get(this.listMetaKey(url)).catch(err => {
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
				await global.storage.promises.set(this.listMetaKey(url), meta)
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
	trimListMeta(cb){
		global.storage.deleteAnyStartsWithOlder(this.listMetaKeyPrefix, 30 * (24 * 3600), cb)
	}
}

module.exports = Common
