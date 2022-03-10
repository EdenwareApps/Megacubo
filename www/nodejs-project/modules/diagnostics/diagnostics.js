const Events = require('events')

class Diagnostics extends Events {
    constructor(){
		super()
		this.folder = global.paths.temp
		this.minDiskSpaceRequired = 512 * (1024 * 1024) // 512MB
		this.minFreeMemoryRequired = 350 * (1024 * 1024) // 350MB
		this.lowDiskSpaceWarnInterval = 5 * 50 // 5min
		this.checkDiskUI().catch(console.error)
	}
    checkDisk(){
		return new Promise((resolve, reject) => {
			require('check-disk-space')(this.folder).then((diskSpace) => {
				resolve(diskSpace) // // {diskPath: "C:", free: 12345678, size: 98756432}
			})				
		})
    }
    checkDiskOSD(){
		this.checkDisk().then(data => {
			let fine = data.free >= this.minDiskSpaceRequired
			if(!fine){
				global.osd.show(global.lang.LOW_DISK_SPACE_AVAILABLE.format(global.kbfmt(data.free)), 'fas fa-exclamation-triangle faclr-red', 'diagnostics', 'long')
			}
		}).catch(console.error)
    }
    checkDiskUI(force){
		return new Promise((resolve, reject) => {
			this.checkDisk().then(data => {
				let fine = data.free >= this.minDiskSpaceRequired
				if(!fine || force){
					global.ui.emit('dialog', [
						{template: 'question', text: 'Megacubo', fa: 'fas fa-exclamation-triangle faclr-red'},
						{template: 'message', text: global.lang.LOW_DISK_SPACE_AVAILABLE.format(global.kbfmt(data.free))},
						{template: 'option', text: 'OK', id: 'ok'}
					], 'diagnostics', 'ok') 
					// {diskPath: "C:", free: 12345678, size: 98756432}
				}
				resolve(fine)
			}).catch(reject)
		})
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
    checkMemoryUI(force){
		return new Promise((resolve, reject) => {
			this.checkMemory().then(freeBytes => {
				let fine = freeBytes >= this.minFreeMemoryRequired
				if(!fine || force){
					global.ui.emit('dialog', [
						{template: 'question', text: 'Megacubo', fa: 'fas fa-exclamation-triangle faclr-red'},
						{template: 'message', text: global.lang.LOW_MEMORY_AVAILABLE.format(global.kbfmt(freeBytes))},
						{template: 'option', text: 'OK', id: 'ok'}
					], 'diagnostics', 'ok') 
					// {diskPath: "C:", free: 12345678, size: 98756432}
				}
				resolve(fine)
			}).catch(reject)
		})
    }
}

module.exports = Diagnostics

