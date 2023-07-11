
const Events = require('events')

class ParentalControl extends Events {
	constructor(){
		super()
		this.authTTL = 600
		this.termsRegex = false
		this.on('updated', () => {
			if(global.explorer && global.explorer.path == global.lang.TRENDING){
				global.explorer.refresh()
			}
		})
		global.config.on('change', keys => {
			keys.includes('parental-control-terms') && this.setTerms()
		})
		this.setupTerms()
		global.uiReady && global.uiReady(() => this.update())
	}
	entry(){
		return {
			name: global.lang.PARENTAL_CONTROL, fa: 'fas fa-shield-alt', type: 'group', 
			renderer: async () => {
				let def = global.config.get('parental-control'), blocked = ['block', 'remove'].includes(def)
				let opts = [
					{
						details: global.lang.BLOCK +' | '+ global.lang.ALLOW,
						name: global.lang.ADULT_CONTENT,
						fa: blocked ? 'fas fa-lock' : 'fas fa-lock-open',
						type: 'select',
						safe: true,
						renderer: async () => {
							await this.auth()
							let options = [
								{
									key: 'remove',
									fa: 'fas fa-trash'
								}, 
								{
									key: 'block',
									fa: 'fas fa-lock'
								}, 
								{
									key: 'allow',
									fa: 'fas fa-lock-open'
								}, 
								{
									key: 'only',
									fa: 'fas fa-fire'
								}
							].map(n => {
								let name
								if(n.key == 'block'){
									name = global.lang.ASK_PASSWORD
								} else {
									name = global.lang[n.key.replaceAll('-', '_').toUpperCase()]
								}
								return {
									name,
									value: n.key,
									icon: n.fa,
									type: 'action',
									safe: true,
									action: async () => {
										await this.auth()
										if(['block', 'remove'].includes(n.key)){
											let fine = !!global.config.get('parental-control-pw')
											if(!fine) {
												fine = await this.setupAuth().catch(console.error)
											}
											if(fine === true){
												global.config.set('parental-control', n.key)
												if(this.authenticated){
													delete this.authenticated
												}
											}
										} else {
											global.config.set('parental-control-pw', '')
											global.config.set('parental-control', n.key)
											if(this.authenticated){
												delete this.authenticated
											}
										}
										global.osd.show('OK', 'fas fa-check-circle faclr-green', 'options', 'normal')
										global.watching.update().catch(console.error)
										process.nextTick(() => global.explorer.refreshNow())
									}
								}
							})                                
							options = options.map(p => {
								p.selected = (def == p.value)
								return p
							})
							return options
						}
					}
				]
				if(global.config.get('parental-control') != 'allow'){
					opts.push({
						name: global.lang.FILTER_WORDS,
						details: global.lang.SEPARATE_WITH_COMMAS, 
						type: 'input',
						fa: 'fas fa-shield-alt',
						action: async (e, v) => {
							if(v !== false && await this.auth()){
								global.config.set('parental-control-terms', v)
								this.setTerms()
							}
						},
						value: () => {
							return global.config.get('parental-control-terms')
						},
						placeholder: global.lang.FILTER_WORDS,
						multiline: true,
						safe: true
					})
				}
				return opts
			}
		}
	}
	setupTerms(tms){
		this.terms = this.keywords(tms || global.config.get('parental-control-terms'))		
		if(this.terms.length){
			this.termsRegex = new RegExp(this.terms.join('|').replace(new RegExp('\\+', 'g'), '\\+'), 'i')
		} else {
			this.termsRegex = false
		}
	}
	setTerms(terms){
		if(typeof(terms) == 'string'){
			this.terms = this.keywords(terms)	
		} else if(!Array.isArray(terms)) {
			console.error('Bad terms format', terms)
			return
		}
		this.terms = [...new Set(this.terms)] // make unique
		let sterms = this.terms.join(',')
		global.config.set('parental-control-terms', sterms)
		this.setupTerms(sterms)
		this.emit('updated')
	}
	update(){
		if(global.config.get('parental-control-terms') == global.config.defaults['parental-control-terms']){ // update only if the user didn't customized
			global.cloud.get('configure').then(c => {
				if(c && c.adultTerms){
					this.setTerms(c.adultTerms)
				}
			}).catch(err => {
				console.error(err)
				setTimeout(() => this.update(), 10000)
			})
		}
	}
	keywords(str){
		return str.toLowerCase().split(',').filter(t => {
			return t.length >= 2
		})
	}
	has(stack){
		return this.termsRegex ? stack.match(this.termsRegex) : false
	}
	allow(entry){
		if(typeof(entry) == 'string'){
			return !this.has(entry)
		}
		if(entry.type && !['group', 'stream'].includes(entry.type)){
			return true
		}
		let allow = true
		let str
		str = entry.name
		if(entry.group){
			str += ' ' + entry.group
		}
		if(str && this.has(str)){
			allow = false
		}
		return allow
	}
	filter(entries, skipProtect){
		if(entries.length){
			switch(global.config.get('parental-control')){
				case 'remove':
					entries = entries.filter(this.allow.bind(this))
					break
				case 'block':
					if(!skipProtect){
						entries = entries.map(e => this.allow(e) ? e : this.protect(e))
					}
					break
			}
		}
		return entries
	}	
	md5(txt){
		if(!this.crypto){
			this.crypto = require('crypto')
		}
		return this.crypto.createHash('md5').update(txt).digest('hex')
	}
	lazyAuth(){
		if(this.authenticated){
			return true
		} else {
			return ['allow', 'only'].includes(global.config.get('parental-control'))
		}
	}
	async auth(){
		const now = global.time()
		if((!this.authenticated || now > this.authenticated) && ['block', 'remove'].includes(global.config.get('parental-control')) && global.config.get('parental-control-pw')){
			const pass = await global.explorer.prompt(global.lang.PASSWORD, global.lang.PASSWORD, '', false, 'fas fa-key', '', [], true)
			if(pass && this.md5(pass) == global.config.get('parental-control-pw')){
				this.authenticated = now + this.authTTL
				return true
			} else {
				global.displayErr(global.lang.PASSWORD_NOT_MATCH)
				throw global.lang.PASSWORD_NOT_MATCH
			}
		} else {
			return true
		}
	}
	async setupAuth(){
		const pass = await global.explorer.prompt(global.lang.CREATE_YOUR_PASS, global.lang.CREATE_YOUR_PASS, '', false, 'fas fa-key', '', [], true)
		if(pass){
			const pass2 = await global.explorer.prompt(global.lang.TYPE_PASSWORD_AGAIN, global.lang.TYPE_PASSWORD_AGAIN, '', false, 'fas fa-key', '', [], true)
			if(pass === pass2){
				global.config.set('parental-control-pw', this.md5(pass))
				return true
			}
		}
		await global.explorer.dialog([
			{template: 'question', text: global.lang.PARENTAL_CONTROL, fa: 'fas fa-exclamation-triangle'},
			{template: 'message', text: global.lang.PASSWORD_NOT_MATCH},
			{template: 'option', id: 'ok', fa: 'fas fa-check-circle', text: 'OK'}
		], 'parental-control', true)
	}
	protect(e){
		if(e.class && e.class.indexOf('parental-control-protected') != -1){
			return e
		}
		const action = async () => {
			let allow = await this.auth().catch(console.error)
			if(allow === true){
				global.explorer.emit('action', e)
			}
		}
		const entry = Object.assign(Object.assign({}, e), {action, class: 'parental-control-protected allow-stream-state', type: 'action', icon: undefined, fa: 'fas fa-lock'})
		return entry
	}
	only(entries){
		if(entries.length){
			entries = entries.filter(e => {
				if(typeof(e) != 'string' && e.type){
					if(!e.class || e.class.indexOf('entry-meta-stream') == -1){
						if(!['group', 'stream'].includes(e.type)){
							return true
						}
					}
				}
				return !this.allow(e)
			})
		}
		return entries
	}
}

module.exports = ParentalControl
