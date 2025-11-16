import storage from '../storage/storage.js'
import { Common } from './common.js'
import { getListMeta, setListMeta, resolveListDatabaseFile } from './list-meta.js'
import setupUtils from '../multi-worker/utils.js'
import UpdateListIndex from './update-list-index.js'
import ListIndex from './list-index.js'
import { getFilename } from 'cross-dirname'

const utils = setupUtils(getFilename())

class UpdaterWorker extends Common {
	constructor() {
		super()
		this.debug = false
		this._relevantKeywords = {}
		this.info = {}
		this.maxInfoEntries = 100 // Limit info entries to prevent memory accumulation
		this.cleanupInterval = null
		this.setupMemoryManagement()
	}

	setupMemoryManagement() {
		// Clean up old info entries periodically to prevent memory accumulation
		this.cleanupInterval = setInterval(() => {
			this.cleanupInfoEntries()
		}, 30000) // Clean up every 30 seconds
	}

	cleanupInfoEntries() {
		const entries = Object.keys(this.info)
		if (entries.length > this.maxInfoEntries) {
			// Remove oldest entries (simple FIFO cleanup)
			const toRemove = entries.slice(0, entries.length - this.maxInfoEntries)
			toRemove.forEach(key => {
				delete this.info[key]
			})
			console.log(`Cleaned up ${toRemove.length} old info entries`)
		}
	}
	async setRelevantKeywords(relevantKeywords) {
		if (Array.isArray(relevantKeywords) && relevantKeywords.length) {
			this._relevantKeywords = relevantKeywords
			return true
		}
		return false
	}
	async relevantKeywords() {
		return this._relevantKeywords
	}
	async getInfo() {
		return this.info
	}
	async update(url, params = {}) {
		if (!url) {
			return this.info[url] = 'invalid url'
		}
		this.info[url] = 'updating'
		let err
		const updated = await this.updateList(url, params).catch(e => err = e)
		if (typeof (err) != 'undefined') {
			// Check if the error is specifically about missing meta file
			if (String(err).includes('meta file not found or empty')) {
				this.info[url] = 'meta file missing, forcing update'
				// Force update to regenerate meta file
				const forceUpdated = await this.updateList(url, { ...params, force: true }).catch(e => {
					this.info[url] = 'meta file regeneration failed, ' + String(e)
					console.error('updater - meta file regeneration failed: ' + e)
					throw e
				})
				this.info[url] = forceUpdated ? 'meta file regenerated' : 'meta file regeneration skipped'
				return this.info[url]
			}

			// Handle 404 errors gracefully - don't treat as critical error
			if (String(err).includes('404') || String(err).includes('List not found')) {
				this.info[url] = 'list not found (404)'
				return this.info[url] // Don't throw, just mark as not found
			}

			this.info[url] = 'update failed, ' + String(err)
			console.error('updater - err: ' + err)
			throw err
		}
		this.info[url] = updated ? 'updated' : 'already updated'
		return this.info[url]
	}
	async updateList(url, params = {}) {
		utils.emit('progress', { progressId: params.uid, progress: 0, url })

		let should
		try {
			should = params.force === true || (await this.updaterShouldUpdate(url))
		} catch (err) {
			console.error('updater - error checking if should update:', err)
			should = true // Force update if we can't determine
		}

		const now = (Date.now() / 1000)

		if (should) {
			// Emitir evento de início de atualização ANTES de começar
			utils.emit('update-start', { url })
			
			const updateMeta = {}
			const file = resolveListDatabaseFile(url)
			let updater = null
			let updateSucceeded = false
			
			try {
				updater = new UpdateListIndex({
					url,
					directURL: url,
					file,
					master: this,
					updateMeta: Object.assign({}, updateMeta),
					forceDownload: params.force === true,
					timeout: params.timeout,
					debug: this.debug
				})

				updateMeta.updateAfter = now + 180

				await setListMeta(url, { updateAfter: now + 180 }).catch(err => console.error(err)) // update specific values instead of throwing back oudated data mmerged
				let ret

				updater.on('progress', progress => progress > 0 && utils.emit('progress', { progressId: params.uid, progress, url }))
				const start = (Date.now() / 1000)

				let result
				try {
					result = await updater.start()
					updateSucceeded = true
				} catch (err) {
					console.error('updater - error during update:', err)
					// Emitir erro específico
					utils.emit('update-error', { url, error: err })
					// Ensure proper cleanup on error
					if (updater) {
						await updater.destroy().catch(cleanupErr => console.error('Error during updater cleanup:', cleanupErr))
					}
					throw err
				}


				if (typeof (updater.contentLength) == 'number') {
					updateMeta.contentLength = updater.contentLength
					updateMeta.updateAfter = now + (24 * 3600)

					// Save updateMeta to database
					await setListMeta(url, { updateAfter: updateMeta.updateAfter, contentLength: updateMeta.contentLength }).catch(err => console.error(err)) // update specific values instead of throwing back oudated data mmerged

					// indexMeta is saved by UpdateListIndex with merge

					ret = true
				}

				// Always destroy updater to free memory
				if (updater && !updater.destroyed) {
					await updater.destroy().catch(err => console.error('Error during updater cleanup:', err))
					updater = null
				}


				await storage.registerFile(file, {
					ttl: 24 * 3600,
					size: 'auto',
					raw: true
				})

				// Emitir evento de fim de atualização (sucesso)
				utils.emit('update-end', { url, succeeded: updateSucceeded })
				
				return ret ? result : false
			} finally {
				// Ensure cleanup even if something goes wrong
				if (updater && !updater.destroyed) {
					try {
						await updater.destroy().catch(err => console.error('Error during final updater cleanup:', err))
					} catch (cleanupErr) {
						console.error('Error during final updater cleanup:', cleanupErr)
					}
					updater = null
				}
				
				// Garantir que sempre emitimos update-end, mesmo em caso de erro
				if (!updateSucceeded && should) {
					utils.emit('update-end', { url, succeeded: false })
				}
			}
		} else {
			// Não precisa atualizar - emitir evento de fim imediatamente
			utils.emit('update-end', { url, succeeded: false, skipped: true })
			return false // no need to update, by updateAfter
		}
	}
	async validateIndex(url) {
		let err
		const file = resolveListDatabaseFile(url)
		const list = new ListIndex(file, url)
		let validated = false

		try {
			try {
				await list.ready()
			} catch (e) {
				err = e
			}

			if (err) {
				// Check if the error is specifically about missing meta file
				if (String(err).includes('meta file not found or empty')) {
					// Return false to trigger update, but don't treat as validation error
					return false;
				}
				return false
			}

			// Check if the list has a meta file error even after successful init
			if (list.indexError && String(list.indexError).includes('meta file not found or empty')) {
				return false;
			}


			// Validate only if nameTerms index is not empty AND groups match
			try {
				const nameTermsValid = list.db && list.db.indexManager &&
					list.db.indexManager.index &&
					list.db.indexManager.index.data &&
					list.db.indexManager.index.data.nameTerms &&
					Object.keys(list.db.indexManager.index.data.nameTerms).length > 0

				validated = nameTermsValid

			} catch (validationErr) {
				console.error('updater validateIndex: error during validation:', validationErr);
				validated = false
			}
		} finally {
			// Garantir que o ListIndex sempre seja destruído, mesmo em caso de erro
			try {
				if (list && !list.destroyed) {
					await list.destroy()
				}
			} catch (destroyErr) {
				console.error('updater validateIndex: error destroying list in finally:', destroyErr);
			}
		}

		return validated
	}
	async updaterShouldUpdate(url) {
		const updateAfter = await this.getUpdateAfter(url)
		let now = (Date.now() / 1000)
		let should = !url.includes('#xtream') && (!updateAfter || now >= updateAfter)

		if (!should) {

			const start = (Date.now() / 1000)
			const valid = await this.validateIndex(url).catch(() => false)

			if (valid === true) {
				return false
			}
			// If validation failed due to missing meta file, force update
			if (valid === false) {
				return true
			}
		}
		return true
	}

	async hasMissingMetaFile(url) {
		try {
			const file = resolveListDatabaseFile(url)
			const metaFile = file.replace(/\.jdb$/i, '.meta.jdb')

			// Check if main file exists
			const mainStat = await storage.stat(file).catch(() => null)
			if (!mainStat || mainStat.size < 1024) {
				return false // Main file doesn't exist or is too small
			}

			// Check if meta file exists and has content
			const metaStat = await storage.stat(metaFile).catch(() => null)
			if (!metaStat || metaStat.size === 0) {
				return true
			}

			// Additional check: verify meta file contains valid data
			try {
				const metaData = await getListMeta(url);
				if (!metaData || typeof metaData.length !== 'number' || metaData.length === 0) {
					return true
				}
			} catch (err) {

				return true
			}

			return false
		} catch (err) {

			return false
		}
	}
	async terminate() {
		// Clean up resources
		if (this.cleanupInterval) {
			clearInterval(this.cleanupInterval)
			this.cleanupInterval = null
		}

		// Clear info object to free memory
		this.info = {}
		
		// Clear relevantKeywords to free memory
		this._relevantKeywords = {}
	}
}

export default UpdaterWorker