class Emphasis {
    constructor(){
		if(!this.originalApplyFilters){
			this.originalApplyFilters = global.explorer.applyFilters.bind(global.explorer)
			global.explorer.applyFilters = this.applyFilters.bind(this)
		}
    }
	async promote(){
		const atts = {
			communitary: global.config.get('communitary-mode-lists-amount') > 0,
			premium: global.options.prm(true),
			country: global.lang.countryCode
		}
		const c = await global.cloud.get('promote')
		if(!Array.isArray(c)) return
		const promos = c.filter(p => {
			return Object.keys(atts).every(k => {
				if(k == 'country') {
					return p.countries.includes(atts[k])
				} else {
					return p[k] == atts[k]
				}
			})
		})
		if(promos.length) {
			const a = promos.shift()
			if(a) {
				// icon, url, name, details
				a.prepend = '<i class="fas fa-rectangle-ad" aria-hidden="true"></i> '
				a.fa = 'fas fa-rectangle-ad'
				a.hookId = 'emphasis'
				if(!a.type) {
					a.type = 'action'
					a.action = () => {
						global.ui.emit('open-external-url', a.url)
					}
				}
				return a
			}
		}
	}
	async applyFilters(entries, path){
		entries = await this.originalApplyFilters(entries, path)
		if(Array.isArray(entries) && entries.length) {
			const i = entries[0].type == 'back' ? 1 : 0
			entries = entries.filter(e => e.hookId != 'emphasis')
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
			if(entries[i]){
				const prm = global.options.prm(true)
				const hasIcon = entries[i].icon || (entries[i].programme && entries[i].programme.i)
				if(!path && !hasIcon && !prm) {
					const promo = await this.promote().catch(console.error)
					if(promo && promo.url) {
						entries = entries.filter(e => e.hookId != 'epg-history')
						entries.unshift(promo)
					}
				}
				if (!path || entries.length == (i + 1) || hasIcon) {
					if (typeof (entries[i].class) == 'undefined') {
						entries[i].class = ''
					}
					entries[i].class += ' entry-2x'
					if (hasIcon || !path) {
						entries[i].class += ' entry-cover entry-force-cover'
					}
				}
			}
		}
		return entries
	}
}

module.exports = Emphasis
