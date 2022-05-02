
const async = require('async')
const List = require(global.APPDIR + '/modules/lists/list.js')
const UpdateListIndex = require(global.APPDIR + '/modules/lists/update-list-index.js')
const ConnRacing = require(global.APPDIR + '/modules/conn-racing')
const Common = require(global.APPDIR + '/modules/lists/common.js')
const Cloud = require(APPDIR + '/modules/cloud')

require(APPDIR + '/modules/supercharge')(global)

storage = require(APPDIR + '/modules/storage')({})

Download = require(APPDIR + '/modules/download')
cloud = new Cloud()

const emit = (type, content) => {
	postMessage({id: 0, type: 'event', data: type +':'+ JSON.stringify(content)})
}

class ListsUpdater extends Common {
	constructor(){
		super()
		this.debug = false
		this.isUpdating = false
		this.relevantKeywords = []
	}
	setRelevantKeywords(relevantKeywords){
		return new Promise((resolve, reject) => {
			this.relevantKeywords = relevantKeywords
			resolve(true)
		})
	}
    update(urls){
		return new Promise((resolve, reject) => {
			if(this.isUpdating){
				return this.once('updated', () => this.update(urls).then(resolve).catch(reject))
			}
			if(this.debug){
				console.log('updater - start', urls)
			}
			this.isUpdating = true		
			this.racing = new ConnRacing(urls, {retries: 1, timeout: 5})
			const retries = []
			async.eachOfLimit(urls, 3, (url, i, acb) => {
				if(this.racing.ended){
					if(this.debug){
						console.log('updater - racing ended')
					}
					acb()
				} else {
					this.racing.next(res => {
						if(res && res.valid){
							if(this.debug){
								console.log('updater - updating', res.url)
							}
							this.updateList(res.url).then(updated => {
								if(this.debug){
									console.log('updater - updated', res.url, updated)
								}
								if(updated){
									emit('list-updated', res.url)
								}
							}).catch(err => {
								console.error('updater - err: '+ err)
							}).finally(acb)
						} else {
							if(this.debug){
								console.log('updater - failed', res.url, res)
							}
							if(res){
								retries.push(res.url)
							}
							acb()
						}
					})
				}
			}, () => {
				this.racing.end()

				// now retry the failed ones
				if(this.debug){
					console.log('updater - retry', retries)
				}
				this.retryRacing = new ConnRacing(retries, {retries: 3, timeout: 20})
				async.eachOfLimit(retries, 3, (url, i, acb) => {
					if(this.retryRacing.ended){
						acb()
					} else {
						this.retryRacing.next(res => {
							if(res && res.valid){
								if(this.debug){
									console.log('updater - updating', res.url)
								}
								this.updateList(res.url).then(updated => {
									if(this.debug){
										console.log('updater - updated', res.url, updated)
									}
									acb()
									if(updated){
										emit('list-updated', res.url)
									}
								}).catch(err => {
									console.error('updater - err: '+ err)
									acb()
								})
							} else {
								if(this.debug){
									console.log('updater - failed', res.url, res)
								}
								acb()
							}
						})
					}
				}, () => {
					this.retryRacing.end()
					this.isUpdating = false
					this.emit('updated')
					resolve(true)
				})
			})
		})
    }
	updateList(url){
		return new Promise((resolve, reject) => {
			this.shouldUpdate(url, should => {
				const now = global.time()
				if(this.debug){
					console.log('updater - should', url, should)
				}
				if(should){
					const updateMeta = {}
					const file = global.storage.raw.resolve(global.LIST_DATA_KEY_MASK.format(url))
					const updater = new UpdateListIndex(url, url, file, this, Object.assign({}, updateMeta))
					updateMeta.updateAfter = now + 180
					this.setListMeta(url, updateMeta)
					updater.start().then(() => {
						if(this.debug){
							console.log('updater - result', url, updater.index)
						}
						if(updater.index){
							updateMeta.contentLength = updater.contentLength
							updateMeta.updateAfter = now + (24 * 3600)
							this.setListMeta(url, updater.index.meta)
							this.setListMeta(url, updateMeta)
							resolve(true)
						} else {
							if(this.debug){
								console.log('updater - result', err)
							}
							resolve(false) // no need to update, by contentLength
						}
					}).catch(err => {
						if(this.debug){
							console.log('updater - result', url, err)
						}
						reject(err)
					}).finally(() => updater.destroy())
				} else {
					resolve(false) // no need to update, by updateAfter
				}
			})
		})
	}
	validateIndex(url, cb){
		const list = new List(url, null, this.relevantKeywords)
		list.start().then(() => cb()).catch(err => cb(err))
	}
	shouldUpdate(url, cb){
		this.getListMeta(url, updateMeta => {
			let now = global.time()
			let should = !updateMeta || now >= updateMeta.updateAfter
			if(should){
				cb(should)
			} else {
				this.validateIndex(url, err => {
					if(err){
						console.error('Invalid index, should update', url, err)
						cb(true)
					} else {
						cb(false)
					}
				})
			}
		})
	}
}

module.exports = ListsUpdater
