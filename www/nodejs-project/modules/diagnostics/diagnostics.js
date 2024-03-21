const { EventEmitter } = require('events')

class Diagnostics extends EventEmitter {
    constructor(){
		super()
		const { temp } = require('../paths')
		this.folder = temp
		this.minDiskSpaceRequired = 512 * (1024 * 1024) // 512MB
		this.minFreeMemoryRequired = 350 * (1024 * 1024) // 350MB
		this.lowDiskSpaceWarnInterval = 5 * 50 // 5min
		this.checkDiskUI().catch(console.error)
	}
	async report(){
		const lists = require('../lists')
		const version = global.paths.manifest.version
		const diskSpace = await this.checkDisk()
		const freeMem = global.kbfmt(await this.checkMemory())
		const config = global.deepClone(global.config.data)
		const listsInfo = lists.info(true)
		const myLists = config.lists.map(a => a[1]);
		const listsRequesting = lists.requesting
		const tuning = global.tuning ? global.tuning.logText(false) : ''
		const processedLists = lists.processedLists.keys()
		const processing = lists.loader.processes.filter(p => p.started() && !p.done()).map(p => {
			return {
				url: p.url,
				priority: p.priority
			}
		})
		const crashlog = require('../crashlog')
		let err, crashlogContent = await crashlog.read().catch(e => err = e)
		const crashLog = crashlogContent || err || 'Empty'
		const gpu = await this.gpuReport()
		const updaterResults = lists.loader.results, privateLists = [];
		['lists', 'parental-control-terms', 'parental-control-pw', 'premium-license'].forEach(k => delete config[k])
		Object.keys(lists).forEach(url => {
			lists[url].owned = myLists.includes(url)
			if(lists[url].private){
				privateLists.push(url)
			}
		})
		if(diskSpace && diskSpace.size){
			diskSpace.free = global.kbfmt(diskSpace.free)
			diskSpace.size = global.kbfmt(diskSpace.size)
		}
		let report = {version, diskSpace, freeMem, config, listsInfo, listsRequesting, updaterResults, processedLists, processing, tuning, gpu, crashLog}
		report = JSON.stringify(report, null, 3)
		privateLists.forEach(url => {
			report = report.replace(url, 'http://***')
		})
		return report
	}
    async gpuReport(){
		if(global.paths.cordova) return {}
        let err
        const { app } = require('electron')
        const report = {
            featureStatus: app.getGPUFeatureStatus(),
            info: await app.getGPUInfo('complete').catch(e => err = e)
        }
        if(err) {
            report.info = String(err)
        }
        return report
    }
	async saveReport(){
		const fs = require('fs')
		const downloads = require('../downloads')
		const file = downloads.folder +'/megacubo-report.txt'
		const report = await this.report()
		await fs.promises.writeFile(file, report, {encoding: 'utf8'})
		downloads.serve(file, true, false).catch(global.displayErr)
		global.renderer.emit('clipboard-write', report)
		console.error('REPORT => '+ report)
	}
    async checkDisk(){
		return require('check-disk-space').default(this.folder) // {diskPath: "C:", free: 12345678, size: 98756432}
    }
    checkDiskOSD(){
		this.checkDisk().then(data => {
			let fine = data.free >= this.minDiskSpaceRequired
			if(!fine){
				global.osd.show(global.lang.LOW_DISK_SPACE_AVAILABLE.format(global.kbfmt(data.free)), 'fas fa-exclamation-triangle faclr-red', 'diag', 'long')
			}
		}).catch(console.error)
    }
    async checkDiskUI(force){
		let data = await this.checkDisk()
		let fine = data.free >= this.minDiskSpaceRequired
		if(!fine || force){
			global.menu.dialog([
				{template: 'question', text: global.paths.manifest.window.title, fa: 'fas fa-exclamation-triangle faclr-red'},
				{template: 'message', text: global.lang.LOW_DISK_SPACE_AVAILABLE.format(global.kbfmt(data.free))},
				{template: 'option', text: global.lang.CLEAR_CACHE, id: 'clear'},
				{template: 'option', text: 'OK', id: 'ok'}
			], 'ok').then(ret => {
				if(ret == 'clear'){
					const options = require('../options')
					options.requestClearCache()
				}
			}).catch(console.error) // dont wait
			// {diskPath: "C:", free: 12345678, size: 98756432}
		}
		return fine
    }
    checkMemory(){
		return new Promise((resolve, reject) => {
			const cp = require('child_process')
			if(process.platform == 'win32'){
				cp.exec('wmic OS get FreePhysicalMemory', (err, stdout) => {
					if(err){
						return reject('checkMemory err:' + String(err))
					}
					let data = stdout.split("\n")
					if(data.length > 1){
						resolve(parseInt(data[1].trim()) * 1024)
					} else {
						reject('checkMemory err: bad data, '+ String(data))
					}
				})
			} else {
				cp.exec('free -b', (err, stdout) => {
					if(err){
						return reject('checkMemory err:' + String(err))
					}
					let data = stdout.match(new RegExp('Mem: +[0-9]+ +[0-9]+ +([0-9]+)'))
					if(data && data.length > 1){
						resolve(parseInt(data[1].trim()))
					} else {
						reject('checkMemory err: bad data, '+ String(data))
					}
				})
			}
		})
    }
    async checkMemoryUI(force){
		let freeBytes = await this.checkMemory()
		let fine = freeBytes >= this.minFreeMemoryRequired
		if(!fine || force){
			global.menu.dialog([
				{template: 'question', text: global.paths.manifest.window.title, fa: 'fas fa-exclamation-triangle faclr-red'},
				{template: 'message', text: global.lang.LOW_MEMORY_AVAILABLE.format(global.kbfmt(freeBytes))},
				{template: 'option', text: 'OK', id: 'ok'}
			], 'ok').catch(console.error) // dont wait
			// {diskPath: "C:", free: 12345678, size: 98756432}
		}
		return fine
    }
}

module.exports = new Diagnostics()
