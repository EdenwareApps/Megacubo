'use strict';

const open = (...args) => {
	return new Promise((resolve, reject) => {
		const opn = require('open')
		if(process.platform == 'android'){
			const path = require('path'), fs = require('fs'), fschmod = require('fs-chmod')
			
			const sourceXdg = global.APPDIR + '/node_modules/open/xdg-open'
			const folder = global.paths['data'].replace(new RegExp('\\\\', 'g'), '/') + path.sep + 'xdg'
			const xdg = folder + path.sep + path.basename(sourceXdg)
			
			fs.mkdir(path.dirname(xdg), {recursive: true}, err => {   
				if(err){
					console.error(err)
					return reject(err)
				}
				fs.copyFile(sourceXdg, xdg, err => {    
					if(err){
						console.error(err)
						return reject(err)
					}
					fs.chmod(xdg, 0o775, err => {   
						if(err){
							console.error(err)
							return reject(err)
						}
						fschmod.chmod(xdg, '+x').then(() => {
							const exec = require('child_process').exec
							exec(xdg + ' ' + args[0], {shell: true}, (error, stdout, stderr) => {
								console.log({error, stdout, stderr})
								resolve({error, stdout, stderr})
							})
						}).catch(e => {
							console.error(err)
							reject(e)
						})
					})
				})
			})		
		} else {
			opn.apply(null, args).then(resolve).catch(reject)
		}
	})
}

module.exports = open
