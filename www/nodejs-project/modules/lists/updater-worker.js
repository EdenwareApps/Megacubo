
const Common = require('./common'), List = require('./list')
const UpdateListIndex = require('./update-list-index')
const utils = require('../multi-worker/utils')(__filename)

class ListsUpdater extends Common {
	constructor(){
		super()
		this.debug = false
		this.relevantKeywords = []
		this.info = {}
	}
	async setRelevantKeywords(relevantKeywords){
		this.relevantKeywords = relevantKeywords
		return true
	}
	async getInfo(){
		return this.info
	}
	async update(url, force, progressId){
		if(!url){
			return this.info[url] = 'invalid url'
		}
		if(this.debug){
			console.log('updater - start', url)
		}
		this.info[url] = 'updating'
		if(this.debug){
			console.log('updater - updating', url)
		}
		let err
		const updated = await this.updateList(url, force, progressId).catch(e => err = e)
		if(typeof(err) != 'undefined'){
			this.info[url] = 'update failed, '+ String(err)
			console.error('updater - err: '+ err +' '+ global.traceback())
		} else {
			if(this.debug){
				console.log('updater - updated', url, updated)
			}
			this.info[url] = updated ? 'updated' : 'already updated'
		}
		return this.info[url]
    }
	async updateList(url, force, progressId=0){
		if(this.debug){
			console.log('updater updateList', url)
		}
		utils.emit('progress', {progressId, progress: 0, url})
		const should = force === true || (await this.updaterShouldUpdate(url))
		const now = global.time()
		if(this.debug){
			console.log('updater - should 1', url, should, force)
		}
		if(should){
			const updateMeta = {}
			const file = global.storage.raw.resolve(global.LIST_DATA_KEY_MASK.format(url))
			const updater = new UpdateListIndex(url, url, file, this, Object.assign({}, updateMeta), force === true)
			updateMeta.updateAfter = now + 180
			if(this.debug){
				console.log('updater - should 2', url, should)
			}
			await this.setListMeta(url, updateMeta).catch(console.error)
			let ret
			if(this.debug){
				console.log('updater - should 3', url, should)
			}
			updater.on('progress', progress => progress > 0 && utils.emit('progress', {progressId, progress, url}))
			const start = global.time()
			await updater.start()
			if(this.debug){
				console.log('updater - updated after '+ parseInt(global.time() - start) +'s', url, should)
			}
			if(updater.index){
				updateMeta.contentLength = updater.contentLength
				updateMeta.updateAfter = now + (24 * 3600)
				await this.setListMeta(url, updater.index.meta).catch(console.error)
				await this.setListMeta(url, updateMeta).catch(console.error)
				ret = true
			} 
			if(this.debug){
				console.log('updater - updated 1', url, should)
			}
			updater.destroy()
			if(this.debug){
				console.log('updater - updated 2', url, should)
			}
			return ret || false
		} else {
			return false // no need to update, by updateAfter
		}
	}
	async validateIndex(url){
		const list = new List(url, null)
		await list.start()
		const validated = list.index.length > 0
		list.destroy()
		return validated
	}
	async updaterShouldUpdate(url){
		const updateMeta = await this.getListMeta(url)
		if(this.debug){
			console.log('updater shouldUpdate', JSON.stringify(updateMeta, null, 3), url)
		}
		let now = global.time()
		let should = url.indexOf('#xtream') == -1 && (!updateMeta || now >= updateMeta.updateAfter)
		if(!should){
			const start = global.time()
			const valid = await this.validateIndex(url).catch(console.error)
			if(this.debug){
				console.log('updater shouldUpdate index validation took '+ parseInt(global.time() - start) +'s', JSON.stringify(updateMeta, null, 3), url)
			}
			if(valid === true) {
				return false
			}
		}
		return true
	}
	async terminate(){}
}

module.exports = ListsUpdater
