import { LIST_DATA_KEY_MASK } from "../utils/utils.js";
import storage from '../storage/storage.js'
import Common from './common.js'
import setupUtils from '../multi-worker/utils.js'
import UpdateListIndex from './update-list-index.js'
import List from './list.js'
import { getFilename } from 'cross-dirname'           

const utils = setupUtils(getFilename())

class ListsUpdater extends Common {
	constructor(){
		super()
		this.debug = true
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
	async update(url, params={}){
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
		const updated = await this.updateList(url, params).catch(e => err = e)
		if(typeof(err) != 'undefined'){
			this.info[url] = 'update failed, '+ String(err)
			console.error('updater - err: '+ err)
		} else {
			if(this.debug){
				console.log('updater - updated', url, updated)
			}
			this.info[url] = updated ? 'updated' : 'already updated'
		}
		return this.info[url]
    }
	async updateList(url, params={}){
		if(this.debug){
			console.log('updater updateList', url)
		}
		utils.emit('progress', {progressId: params.uid, progress: 0, url})
		const should = params.force === true || (await this.updaterShouldUpdate(url))
		const now = (Date.now() / 1000)
		if(this.debug){
			console.log('updater - should 1', url, should, params.force)
		}
		if(should){
			const updateMeta = {}
			const key = LIST_DATA_KEY_MASK.format(url)
			const file = storage.resolve(key)
			const updater = new UpdateListIndex(url, url, file, this, Object.assign({}, updateMeta), params.force === true)
			if(typeof(params.timeout) == 'number') {
				updater.timeout = params.timeout
			}
			updateMeta.updateAfter = now + 180
			if(this.debug) {
				console.log('updater - should 2', url, should)
			}
			await this.setListMeta(url, updateMeta).catch(console.error)
			let ret
			if(this.debug){
				console.log('updater - should 3', url, should)
			}
			updater.on('progress', progress => progress > 0 && utils.emit('progress', {progressId: params.uid, progress, url}))
			const start = (Date.now() / 1000)
			await updater.start()
			if(this.debug){
				console.log('updater - updated after '+ parseInt((Date.now() / 1000) - start) +'s', url, should)
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
			storage.touch(key, {
				size: 'auto',
				raw: true,
				expiration: true
			})
			return ret || false
		} else {
			return false // no need to update, by updateAfter
		}
	}
	async validateIndex(url){
		const list = new List(url, this.relevantKeywords)
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
		let now = (Date.now() / 1000)
		let should = url.indexOf('#xtream') == -1 && (!updateMeta || now >= updateMeta.updateAfter)
		if(!should){
			const start = (Date.now() / 1000)
			const valid = await this.validateIndex(url).catch(console.error)
			if(this.debug){
				console.log('updater shouldUpdate index validation took '+ parseInt((Date.now() / 1000) - start) +'s', JSON.stringify({valid, updateMeta}, null, 3), url)
			}
			if(valid === true) {
				return false
			}
		}
		return true
	}
	async terminate(){}
}

export default ListsUpdater
