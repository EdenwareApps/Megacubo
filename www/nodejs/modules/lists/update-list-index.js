const ListIndexUtils = require('./list-index-utils')

class UpdateListIndex extends ListIndexUtils { 
	constructor(url, directURL, file, master, updateMeta, forceDownload){
		super()
        this.url = url
        this.file = file
		this.playlists = []
        this.master = master
        this.lastProgress = -1
        this.directURL = directURL
        this.updateMeta = updateMeta
        this.forceDownload = forceDownload === true
        this.uid = parseInt(Math.random() * 100000000000)

        const { temp } = require('../paths')
        this.tmpOutputFile = temp +'/'+ this.uid +'.out.tmp'
        this.timeout = global.config.get('read-timeout')
        this.linesMapPtr = 0
        this.linesMap = []
        this.debug = false
        this.reset()
    }
    ext(file){
		let basename = String(file).split('?')[0].split('#')[0].split('/').pop()
		basename = basename.split('.')
		if(basename.length > 1){
			return basename.pop().toLowerCase()
		} else {
			return ''
		}
    }
	indexate(entry, i){
        entry = this.master.prepareEntry(entry)
        if (!entry.terms) entry.terms = { name: [], group: [] }
        entry.terms.name.concat(entry.terms.group).forEach(term => {
            if (typeof (this.index.terms[term]) == 'undefined') {
                this.index.terms[term] = { n: [], g: [] }
            }
        })
		entry.terms.name.forEach(term => {
            // ensure it's an array an not a method
			if(Array.isArray(this.index.terms[term].n) && !this.index.terms[term].n.includes(i)){
				this.index.terms[term].n.push(i)
			}
		})
		entry.terms.group.forEach(term => {
			if(Array.isArray(this.index.terms[term].n) && !this.index.terms[term].g.includes(i)){
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
    parseHeadersMeta(headers) {
        const prefix = 'x-m3u-meta-'
        Object.keys(headers).filter(k => k.startsWith(prefix)).forEach(k => {
            const name = k.substr(prefix.length)
            this.index.meta[name] = headers[k]
        })
    }
	fetch(path){
		return new Promise((resolve, reject) => {
            if(path.match(new RegExp('^//[^/]+\\.'))){
                path = 'http:' + path
            }
            if(path.match(new RegExp('^https?:'))){
                console.error('UpdateListIndex fetch '+ path +' ('+ this.timeout +')')
                let resolved
                const opts = {
                    debug: this.debug,
                    url: path,
                    retries: 3,
                    followRedirect: true,
                    keepalive: false,
                    headers: {
                        'accept-charset': 'utf-8, *;q=0.1'
                    },
                    timeout: this.timeout, // some servers will take too long to send the initial response
                    downloadLimit: 200 * (1024 * 1024), // 200Mb
                    encoding: 'utf8'
                }
                this.stream = new global.Download(opts)
                this.stream.on('redirect', (url, headers) => this.parseHeadersMeta(headers))
                this.stream.on('response', (statusCode, headers) => {
                    if(this.debug) {
                        console.log('UpdateListIndex response', statusCode, headers, this.updateMeta)
                    }
                    resolved = true
                    this.parseHeadersMeta(headers)
                    if(statusCode >= 200 && statusCode < 300){
                        if(this.stream.totalContentLength) {
                            this.contentLength = this.stream.totalContentLength
                        }
                        if(this.stream.totalContentLength > 0 && (this.stream.totalContentLength == this.updateMeta.contentLength)){
                            console.log('UpdateListIndex fetch skipped')
                            this.stream.destroy()
                            resolve(false) // no need to update
                        } else {
                            this.stream.pause()
                            resolve({
                                stream: this.stream,
                                url: this.stream.currentURL // use final URL for relative URLs normalization
                            })
                        }
                    } else {
                        this.stream.destroy()
                        reject('http error '+ statusCode)
                    }
                })
                this.stream.on('end', () => {
                    if(this.debug){
                        console.log('UpdateListIndex fetch end')
                    }
                    this.stream && this.stream.destroy()
                    if(!resolved) {
                        resolved = true
                        reject('unknown http error')
                    }
                })
                this.stream.on('error', e => {
                    console.error('UpdateListIndex fetch err', e)
                })
                this.stream.start()
            } else {
                const file = path
                const fs = require('fs')
                fs.stat(file, (err, stat) => {
                    if(stat && stat.size){
                        this.contentLength = stat.size
                        if(stat.size > 0 && stat.size == this.updateMeta.contentLength){
                            resolve(false) // no need to update
                        } else {
                            this.stream = fs.createReadStream(file)
                            resolve({
                                stream: this.stream,
                                url: file
                            })
                        }
                    } else {
                        reject('file not found or empty*')
                    }
                })
            }
        })
	}
	async start(){
        const fs = require('fs')
        let alturl, urls = [this.directURL], fmt = global.config.get('live-stream-fmt')
        if(['hls', 'mpegts'].includes(fmt)) {
            if(!this.mi) {
                const MediaURLInfo = require('../streamer/utils/media-url-info')
                this.mi = new MediaURLInfo()
            }
            alturl = this.mi.setURLFmt(this.directURL, fmt)
            if(alturl){
                urls.unshift(alturl)
            }
        }
        await fs.promises.mkdir(global.dirname(this.tmpOutputFile), {recursive: true}).catch(console.error)
        const writer = fs.createWriteStream(this.tmpOutputFile)
        writer.once('finish', () => this.writerClosed = true)
        for(let url of urls){
            let err
            const hasCredentials = url.indexOf('@') != -1
            if(hasCredentials && url.indexOf('#xtream') != -1) {
                await this.xparse(url, writer).catch(console.error)
                if(this.indexateIterator) break
            } else if(hasCredentials && url.indexOf('#mag') != -1) {
                await this.mparse(url, writer).catch(console.error)
                if(this.indexateIterator) break
            } else {
                const ret = await this.fetch(url).catch(e => err = e)
                if(!err && ret){
                    await this.parse(ret, writer).catch(console.error)
                    if(this.indexateIterator) break
                }
            }
        }
        let i = 0
        while(i < this.playlists.length){
            let err
            const playlist = this.playlists[i]
            i++
            const ret = await this.fetch(playlist.url).catch(e => err = e)
            console.error('PLAYLIST '+ playlist.url +' '+ this.indexateIterator +' '+ err)
            if(!err && ret){
                await this.parse(ret, writer, playlist).catch(console.error)
            }
        }
        await this.writeIndex(writer).catch(err => console.warn('writeIndex error', err))
        writer.destroy()
        return true
	}
    async xparse(url, writer){
        let err, count = 0
        const Xtr = require('./xtr')
        const xtr = new Xtr(url)
        xtr.on('progress', p => this.emit('progress', p, this.url))
        xtr.on('meta', meta => {
            Object.assign(this.index.meta, meta)
        })
        xtr.on('entry', entry => {
            count++
            if(entry.group) { // collect some data to sniff after if each group seems live, serie or movie
                if(typeof(this.groups[entry.group]) == 'undefined') {
                    this.groups[entry.group] = []
                }
                this.groups[entry.group].push({
                    name: entry.name,
                    url: entry.url,
                    icon: entry.icon
                })
            }
            entry = this.indexate(entry, this.indexateIterator)
            const line = Buffer.from(JSON.stringify(entry) + "\n")
            writer.write(line)
            this.linesMap.push(this.linesMapPtr)
            this.linesMapPtr += line.byteLength
            if(!this.uniqueStreamsIndexate.has(entry.url)) {
                this.uniqueStreamsIndexate.set(entry.url, null)
                this.uniqueStreamsIndexateIterator++
            }
            this.indexateIterator++
        })
        await xtr.run().catch(e => err = e)
        xtr.destroy()
        if(err) {
            console.error('XPARSE '+ err)
            throw err
        }
    }
    async mparse(url, writer){
        let err, count = 0
        const Mag = require('./mag')
        const mag = new Mag(url)
        mag.on('progress', p => this.emit('progress', p, this.url))
        mag.on('meta', meta => {
            Object.assign(this.index.meta, meta)
        })
        mag.on('entry', entry => {
            count++
            if(entry.group) { // collect some data to sniff after if each group seems live, serie or movie
                if(typeof(this.groups[entry.group]) == 'undefined') {
                    this.groups[entry.group] = []
                }
                this.groups[entry.group].push({
                    name: entry.name,
                    url: entry.url,
                    icon: entry.icon
                })
            }
            entry = this.indexate(entry, this.indexateIterator)
            const line = Buffer.from(JSON.stringify(entry) + "\n")
            writer.write(line)
            this.linesMap.push(this.linesMapPtr)
            this.linesMapPtr += line.byteLength
            if(!this.uniqueStreamsIndexate.has(entry.url)) {
                this.uniqueStreamsIndexate.set(entry.url, null)
                this.uniqueStreamsIndexateIterator++
            }
            this.indexateIterator++
        })
        await mag.run().catch(e => err = e)
        mag.destroy()
        if(err) {
            console.error('XPARSE '+ err)
            throw err
        }
    }
	parse(opts, writer, playlist){
		return new Promise((resolve, reject) => {
			let resolved, count = 0
            const destroyListener = () => {
                if(!resolved){
                    resolved = true
                    reject('destroyed')
                }
            }
            const endListener = () => {
                this.parser && this.parser.end()
            }
            this.parser && this.parser.destroy()

            const Parser = require('./parser')
            this.parser = new Parser(opts)
			this.parser.on('meta', meta => Object.assign(this.index.meta, meta))
			this.parser.on('playlist', e => this.playlists.push(e))
			this.parser.on('entry', entry => {
                count++
				if(this.destroyed){
                    if(!resolved){
                        resolved = true
                        reject('destroyed')
                    }
                    return
				}
                if(playlist){
                    entry.group = global.joinPath(global.joinPath(playlist.group, playlist.name), entry.group)
                }
                if(entry.group) { // collect some data to sniff after if each group seems live, serie or movie
                    if(typeof(this.groups[entry.group]) == 'undefined') {
                        this.groups[entry.group] = []
                    }
                    this.groups[entry.group].push({
                        name: entry.name,
                        url: entry.url,
                        icon: entry.icon
                    })
                }
                entry = this.indexate(entry, this.indexateIterator)
                const line = Buffer.from(JSON.stringify(entry) + "\n") // Writer expects buffer, that's better to get byteLength right after
                writer.write(line)
                this.linesMap.push(this.linesMapPtr)
                this.linesMapPtr += line.byteLength
                if(!this.uniqueStreamsIndexate.has(entry.url)) {
                    this.uniqueStreamsIndexate.set(entry.url, null)
                    this.uniqueStreamsIndexateIterator++
                }
                this.indexateIterator++
			})
            this.parser.on('progress', readen => {
                const pp = this.contentLength / 100
                let progress = Math.max(0, parseInt(readen / pp))
                if(progress > 99) progress = 99
                if(this.playlists.length > 0){
                    let i = -1
                    this.playlists.some((p, n) => {
                        if(!playlist || playlist.url == p.url){
                            i = n
                            return true
                        }
                    })
                    if(i != -1){
                        const lr = 100 / (this.playlists.length + 1)
                        const pr = (i * lr) + (progress * (lr / 100))
                        progress = parseInt(pr)
                    }
                }
                if(progress != this.lastProgress) {
                    this.lastProgress = progress
                    this.emit('progress', progress, this.url)
                }
            })
            this.once('destroy', destroyListener)
			this.parser.once('finish', () => {
                if(!resolved){
                    resolved = true
                    if(count){
                        resolve(true)
                    } else {
                        reject('empty list')
                    }
                    if(this.contentLength == this.defaultContentLength) {
                        this.contentLength = this.stream.received
                    }
                    this.parser.destroy()
                    this.stream && this.stream.destroy()
                    this.stream = this.parser = null
                }
			})
            this.parser.start()
            this.stream.once('end', endListener)
            this.stream.resume()
		})
	}
    writeIndex(writer){
        return new Promise((resolve, reject) => {
            const fs = require('fs')
            fs.stat(this.file, (err, stat) => {
                let resolved
                const exists = !err && stat && stat.size
                this.index.length = this.indexateIterator
                this.index.uniqueStreamsLength = this.uniqueStreamsIndexateIterator
                this.index.groupsTypes = this.sniffGroupsTypes(this.groups)
                if(this.index.length || !exists) {
                    const finish = err => {
                        if(resolved) return
                        resolved = true
                        if(err) console.error(err)
                        global.moveFile(this.tmpOutputFile, this.file, err => {
                            if(err){
                                reject(err)
                            } else if(this.index.length) {
                                resolve(true)
                            } else {
                                resolve(false)
                            }
                            fs.access(this.tmpOutputFile, err => err || fs.unlink(this.tmpOutputFile, () => {}))
                        }, 10)
                    }
                    writer.once('finish', finish)
                    writer.on('error', finish)
                    
                    const indexLine = JSON.stringify(this.index) +"\n"
                    this.linesMap.push(this.linesMapPtr)
                    this.linesMapPtr += Buffer.byteLength(indexLine, 'utf8')
                    this.linesMap.push(this.linesMapPtr)

                    const linesMapLine = JSON.stringify(this.linesMap)
                    writer.write(indexLine + linesMapLine)
                    writer.end()
                } else {
                    resolved = true
                    fs.unlink(this.tmpOutputFile, () => reject('empty list'))
                }
            })
        })
    }
    sniffGroupsTypes(groups){
        const ret = {live: [], vod: [], series: []}
        Object.keys(groups).forEach(g => {
            let icon
            const isSeried = this.isGroupSeried(groups[g])
            const types = groups[g].map(e => {
                if(e.icon && !icon){
                    icon = e.icon
                }
                return isSeried ? 'series' : this.sniffStreamType(e)
            }).filter(s => s)
            const type = this.mode(types)
            if(type){
                ret[type].push({ name: g, icon })
            }
        })
        return ret
    }
    isGroupSeried(es){
        if(es.length < 5) return false
        const masks = {}
        const mask = n => n.replace(new RegExp('[0-9]+', 'g'), '*')
        es.forEach(e => {
            if(!e.name) return // Cannot read property 'replace' of null
            const m = mask(e.name)
            if(typeof(masks[m]) == 'undefined') masks[m] = 0
            masks[m]++
        })
        return Object.values(masks).some(n => n >= (es.length * 0.7))
    }
    mode(a){ // https://stackoverflow.com/a/65821663
        let obj = {}
        let maxNum
        let maxVal
        for(let v of a){
            obj[v] = ++obj[v] || 1
            if(maxVal === undefined || obj[v]> maxVal){
                maxNum = v
                maxVal = obj[v]
            }
        }
        return maxNum
    }
    rdomain(u){
        if(u && u.indexOf('//') != -1){
            return u.split('//')[1].split('/')[0].split(':')[0].split('.').slice(-2)
        }
        return ''
    }
	reset(){	
        this.groups = {}
		this.index = {
            length: 0,
            uniqueStreamsLength: 0,
            terms: {},
            groups: {},
            meta: {},
            gids: {}
        }
		this.indexateIterator = 0
		this.uniqueStreamsIndexate = new Map()
		this.uniqueStreamsIndexateIterator = 0
		this.defaultContentLength = 62 * (1024 * 1024) // estimate it if we don't know
		this.contentLength = this.defaultContentLength // estimate it if we don't know
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
			this._log = []
		}
	}
}

module.exports = UpdateListIndex
