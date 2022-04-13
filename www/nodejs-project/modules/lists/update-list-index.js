const fs = require('fs'), Events = require('events'), Parser = require('./parser')
const ListIndexUtils = require('./list-index-utils'), FileWriter = require(global.APPDIR + '/modules/write-queue/file-writer')

class UpdateListIndex extends ListIndexUtils {
	constructor(url, directURL, file, parent, updateMeta){
		super()
        this.url = url
        this.directURL = directURL
        this.file = file
		this.tmpfile = file + '.tmp'
        this.updateMeta = updateMeta
		this.contentLength = -1
        this.parent = (() => parent)
        this.reset()
    }
	indexate(entry, i){
		entry = this.parent().prepareEntry(entry)
		entry.terms.name.concat(entry.terms.group).forEach(term => {
			if(typeof(this.index.terms[term]) == 'undefined'){
				this.index.terms[term] = {n: [], g: []}
			}
		})
		entry.terms.name.forEach(term => {
			if(!this.index.terms[term].n.includes(i)){
				this.index.terms[term].n.push(i)
			}
		})
		entry.terms.group.forEach(term => {
			if(!this.index.terms[term].g.includes(i)){
				this.index.terms[term].g.push(i)
			}
		})
        if(entry.name && entry.gid){
            if(typeof(this.index.gids) == 'undefined'){
                this.index.gids = {}
            }
            if(typeof(this.index.gids[entry.gid]) == 'undefined'){
                this.index.gids[entry.gid] = []
            }
            if(!this.index.gids[entry.gid].includes(entry.name)){
                this.index.gids[entry.gid].push(entry.name)
            }
        }
		if(typeof(this.index.groups[entry.group]) == 'undefined'){
			this.index.groups[entry.group] = []
		}
		this.index.groups[entry.group].push(i)
		return entry
	}
	start(){
		return new Promise((resolve, reject) => {
            if(this.debug){
                console.log('load', should)
            }
            let now = global.time(), path = this.directURL
            if(path.match(new RegExp('^//[^/]+\\.'))){
                path = 'http:' + path
            }
            if(path.match(new RegExp('^https?:'))){
                const opts = {
                    url: path,
                    retries: 3,
                    followRedirect: true,
                    keepalive: false,
                    headers: {
                        'accept-charset': 'utf-8, *;q=0.1'
                    },
                    downloadLimit: 28 * (1024 * 1024) // 28Mb
                }
                this.stream = new global.Download(opts)
                this.stream.once('response', (statusCode, headers) => {
                    now = global.time()
                    if(statusCode >= 200 && statusCode < 300){
                        this.contentLength = this.stream.totalContentLength
                        if(this.stream.totalContentLength > 0 && (this.stream.totalContentLength == this.updateMeta.contentLength)){
                            this.stream.destroy()
                            resolve(false) // no need to update
                        } else {
                            this.parseStream().then(() => {
                                resolve(this.index)
                            }).catch(err => {
                                reject(err)
                            })
                        }
                    } else {
                        this.stream.destroy()
                        reject('http error '+ statusCode)
                    }
                })
                this.stream.start()
            } else {
                fs.stat(path, (err, stat) => {
                    if(stat && stat.size){
                        this.contentLength = stat.size
                        if(stat.size > 0 && stat.size == this.updateMeta.contentLength){
                            resolve(false) // no need to update
                        } else {
                            this.stream = fs.createReadStream(path)
                            this.parseStream().then(() => {
                                resolve(this.index)
                            }).catch(err => {
                                reject(err)
                            })
                        }
                    } else {
                        reject('file not found or empty')
                    }
                })
            }
        })
	}
	parseStream(stream){	
		return new Promise((resolve, reject) => {
			if(stream && this.stream != stream){
				this.stream = stream
			}
			let initialized, resolved, writer = new FileWriter(this.tmpfile)
			this.indexateIterator = 0
			this.parser = new Parser(this.stream)
			this.parser.on('meta', meta => {
                if(!initialized){
                    initialized = true
                    this.reset()
                }
				this.index.meta = Object.assign(this.index.meta, meta)
			})
			this.parser.on('entry', entry => {
				if(this.destroyed){
					return reject('destroyed')
				}
                if(!initialized){
                    initialized = true
                    this.reset()
                }
                entry = this.indexate(entry, this.indexateIterator)
                writer.write(JSON.stringify(entry) + "\r\n")
                this.indexateIterator++
			})
            this.on('destroy', () => {
                writer.destroy()
                if(!resolved){
                    fs.unlink(this.tmpfile, () => {})
                    reject('destroyed')
                }
            })
			this.parser.once('end', () => {
                this.index.length = this.indexateIterator
                if(this.index.length){
                    writer.write(JSON.stringify(this.index))
                    writer.ended(() => {
                        writer.destroy()
                        global.moveFile(this.tmpfile, this.file, () => {
                            resolved = true
                            resolve(true)
                        })
                    })
                } else {
                    writer.destroy()
                    fs.unlink(this.tmpfile, () => {})
                    reject('empty list')
                }
			})
		})
	}
	reset(){	
		this.index = {
            length: 0,
            terms: {},
            groups: {},
            meta: {},
            gids: {}
        }
		this.indexateIterator = 0
	}
	destroy(){
		if(!this.destroyed){
			this.reset()
            if(this.stream){
                this.stream.destroy()
                this.stream = null
            }
            if(this.parser){
                this.parser.destroy()
                delete this.parser
            }
			this.destroyed = true
			this.emit('destroy')
            this.removeAllListeners()
			this.parent = (() => {return {}})
			this._log = []
		}
	}
}

module.exports = UpdateListIndex
