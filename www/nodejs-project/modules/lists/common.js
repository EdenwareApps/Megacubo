
const Events = require('events'), fs = require('fs'), ParentalControl = require(global.APPDIR + '/modules/lists/parental-control')
const M3UParser = require(global.APPDIR + '/modules/lists/parser'), M3UTools = require(global.APPDIR + '/modules/lists/tools'), MediaStreamInfo = require(global.APPDIR + '/modules/lists/media-info')

LIST_DATA_KEY_MASK = 'list-data-{0}'
LIST_UPDATE_META_KEY_MASK = 'list-time-{0}'

class Common extends Events {
	constructor(opts){
		super()
		this.searchRedirects = []
		this.stopWords = ['sd', 'hd', 'h264', 'h.264', 'fhd'] // common words to ignore on searching
		this.listMetaKeyPrefix = 'meta-cache-'
		this.opts = {
			folderSizeLimit: 96,
			folderSizeLimitTolerance: 12,
			paginateThreshold: 128,
			offloadThreshold: 512
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
	communitaryListsRequiredAmount(n, foundCommunitaryListsCount){
		let satisfyLevel = 0.5
		if(typeof(n) != 'number'){
			n = global.config.get('shared-mode-reach')
		}
		return Math.min(n * satisfyLevel, foundCommunitaryListsCount)
	}
	getUpdateMeta(url, cb){
		const updateMetaKey = LIST_UPDATE_META_KEY_MASK.format(url)
		global.storage.get(updateMetaKey, updateMeta => {
			if(updateMeta){
				const file = global.storage.raw.resolve(LIST_DATA_KEY_MASK.format(url))
				fs.stat(file, (err, stat) => { // it happened of the meta data was cached but the data was not present, prevent it
					if(err || !stat.size){
						cb({updateAfter: 0, contentLength: 0})
					} else {
						cb(updateMeta)
					}
				})

			} else {
				cb({updateAfter: 0, contentLength: 0})
			}
		})
	}
	setUpdateMeta(url, updateMeta){
		const updateMetaKey = LIST_UPDATE_META_KEY_MASK.format(url)
		global.storage.set(updateMetaKey, updateMeta, true)
	}
    joinPath(folder, file){
        let ret = folder
        if(ret.charAt(ret.length - 1) != '/'){
            ret += '/'
        }
        ret += file
        return ret
    }
	loadSearchRedirects(){
		if(!this.searchRedirects.length){
			fs.readFile(this.joinPath(__dirname, 'search-redirects.json'), (err, content) => { // redirects to find right channel names, as sometimes they're commonly refered by shorter names on IPTV lists
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
