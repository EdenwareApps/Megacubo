class Promoter {
    constructor(){
		if(!this.originalApplyFilters){
			this.originalApplyFilters = global.explorer.applyFilters.bind(global.explorer)
			global.explorer.applyFilters = this.applyFilters.bind(this)
		}
		this.startTime = global.time()
		this.promoteDialogTime = 0
		this.promoteDialogInterval = 1800
		global.ui.on('video-error', () => this.promoteDialogSignal())
		global.ui.on('streamer-is-slow', () => this.promoteDialogSignal())
		global.streamer.on('hard-failure', () => this.promoteDialogSignal())
		global.streamer.on('stop', () => this.promoteDialog())
    }
	async promoteDialog(){
		const now = global.time()
		if(this.promoteDialogPending !== true) return
		// small delay to check if it will not load other stream right after
		process.nextTick(() => {
			if(this.promoteDialogPending !== true) return
			if((now - this.promoteDialogTime) < this.promoteDialogInterval) return
			if(global.streamer.active || global.streamer.isTuning()) return
			const runningTime = now - this.startTime
			if(runningTime < 30) return
			this.promoteDialogTime = now
			this.promoteDialogPending = false
			this.offer('dialog').then(a => a && this.dialogOffer(a)).catch(console.error)
		})
	}
	async promoteDialogSignal(){
		this.promoteDialogPending = true
		this.promoteDialog().catch(console.error)
	}
	async offer(type, skipRequirements){
		const atts = {
			communitary: global.config.get('communitary-mode-lists-amount') > 0,
			premium: global.options.prm(true),
			country: global.lang.countryCode,
			platform: process.platform,
			version: global.MANIFEST.version
		}
		const c = await global.cloud.get('promos')
		if(!Array.isArray(c)) return
		const promos = c.filter(p => {
			if(p.type != type) return
			return Object.keys(atts).every(k => {
				if(skipRequirements && skipRequirements.includes(k)) {
					return true
				} else if(k == 'country') {
					return typeof(p.countries) == 'undefined' || p.countries.includes(atts[k])
				} else if(k == 'platform') {
					return typeof(p.platforms) == 'undefined' || p.platforms.includes(atts[k])
				} else if(k == 'version') {
					return typeof(p.minVersion) == 'undefined' || atts.version >= p.minVersion
				} else {
					return typeof(p[k]) == 'undefined' || p[k] == atts[k]
				}
			})
		})
		if(promos.length) {
			return promos.shift()
		}
	}
    async dialogOffer(a){
		this.promoteDialogShown = true
		const text = a.description
        let callbacks = {}, opts = [
            {template: 'question', text: a.title, fa: a.fa},
            {template: 'message', text}
        ]		
		opts.push(...a.opts.map((o, i) => {
			const id = 'opt-'+ i
			callbacks[id] = async () => {
				if(!o.url) return
				if(o.url.indexOf('{email}') != -1) {
					const email = await global.explorer.prompt({
						question: o.emailPrompt || '',
						placeholder: o.emailPlaceholder || '',
						fa: o.fa
					})
					o.url = o.url.replace('{email}', encodeURIComponent(email || ''))
				}
				if(o.url.indexOf('{name}') != -1) {
					const name = await global.explorer.prompt({
						question: o.namePrompt || '',
						placeholder: o.namePlaceholder || '',
						fa: o.fa
					})
					o.url = o.url.replace('{name}', encodeURIComponent(name || ''))
				}
				if(o.confirmation) {
					global.osd.show(global.lang.PROCESSING, 'fas fa-circle-notch fa-spin', 'promoter', 'persistent')
					global.Download.get({
						url: o.url,
						retries: 10
					}).then(() => {
						global.explorer.info(o.name, o.confirmation)
					}).catch(global.displayErr).finally(() => {
						global.osd.hide('promoter')
					})
				} else {
					global.ui.emit('open-external-url', o.url)
				}
			}
			return {
				template: 'option',
				text: o.name,
				details: o.details,
				id,
				fa: o.fa
			}
		}))
		const id = await global.explorer.dialog(opts)
		if(typeof(callbacks[id]) == 'function') await callbacks[id]()
    }
	async applyFilters(entries, path){
		entries = await this.originalApplyFilters(entries, path)
		if(Array.isArray(entries) && entries.length) {
			const chosen = entries[0].type == 'back' ? 1 : 0
			entries = entries.filter(e => e.hookId != 'promoter')
			entries.forEach((e, i) => { // clear
				if(e.class && e.class.indexOf('entry-2x') != -1) {
					entries[i].class = e.class.replace(new RegExp('(entry-2x|entry-cover|entry-force-cover)', 'g'), '')
				}
			})
			if(!path) { // move entries with icon to top on home
				const orderHint = ['history', 'epg-history', 'watching']
				const hasProgrammeIcon = e => e.programme && e.programme.i
				const hasProgramme = e => e.programme && e.programme.t
				const hasIcon = e => e.icon && !e.icon.startsWith('http://127.0.0.1:')
				const getScore = e => {
					let score = 0
					const p = hasProgramme(e), c = hasIcon(e)
					if(hasProgrammeIcon(e)) score += 1000
					else if(p && c) score += 100
					else if(c) score += 10
					const i = e.hookId ? orderHint.indexOf(e.hookId) : -1
					if(i >= 0) score -= i // subtract instead of sum, sorting helper
					return score
				}
				let max
				entries.forEach((e, i) => {
					const score = getScore(e)
					if(score >= 7 && (!max || score > max.score)) {
						max = {i, score}
					}
				})
				if(max && max.i >= 0) {
					const n = entries[max.i]
					entries.splice(max.i, 1)
					entries.unshift(n)
				}
			}
			if(entries[chosen]){
				const hasIcon = entries[chosen].icon || (entries[chosen].programme && entries[chosen].programme.i)
				if (!path || entries.length == (chosen + 1) || hasIcon) {
					if (typeof (entries[chosen].class) == 'undefined') {
						entries[chosen].class = ''
					}
					entries[chosen].class += ' entry-2x'
					if (hasIcon || !path) {
						entries[chosen].class += ' entry-cover entry-force-cover'
					}
				}
			}
		}
		return entries
	}
}

module.exports = Promoter
