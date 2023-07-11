class Emphasis {
    constructor(){
		if(!this.originalApplyFilters){
			this.originalApplyFilters = global.explorer.applyFilters.bind(global.explorer)
			global.explorer.applyFilters = this.applyFilters.bind(this)
		}
    }
	async ad(){
		const c = await global.cloud.get('configure')
		const a = c['ad-'+ global.lang.countryCode] || c['ad']
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
				let ni = entries.findIndex(e => {
					return (e.programme && e.programme.i) || (e.icon && !e.icon.startsWith('http://127.0.0.1:'))
				})
				if(ni == -1) ni = entries.findIndex(e => e.icon)
				if(ni > 0) {
					const n = entries[ni]
					entries.splice(ni, 1)
					entries.unshift(n)
				}
			}
			if(entries[i]){
				const prm = global.options.prm()
				const hasIcon = entries[i].icon || (entries[i].programme && entries[i].programme.i)
				if(!path && !hasIcon && !prm) {
					const ad = await this.ad().catch(console.error)
					if(ad && ad.url) {
						entries = entries.filter(e => e.hookId != 'epg-history')
						entries.unshift(ad)
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
