const fs = require('fs'), Events = require('events'), Parser = require('./parser')
const ListIndexUtils = require('./list-index-utils')
const MediaURLInfo = require('../streamer/utils/media-url-info')

class UpdateListIndex extends ListIndexUtils { 
	constructor(url, directURL, file, master, updateMeta, forceDownload){
		super()
        this.url = url
        this.file = file
		this.playlists = []
        this.master = master
        this.directURL = directURL
        this.updateMeta = updateMeta
        this.forceDownload = forceDownload === true
        this.tmpfile = global.paths.temp +'/'+ parseInt(Math.random() * 100000000000) + '.tmp'
        this.seriesRegex = new RegExp('(\\b|^)[st]?[0-9]+ ?[epx]{1,2}[0-9]+($|\\b)', 'i')
        this.vodRegex = new RegExp('[\\.=](mp4|mkv|mpeg|mov|m4v|webm|ogv|hevc|divx)($|\\?|&)', 'i')
        this.liveRegex = new RegExp('[\\.=](m3u8|ts)($|\\?|&)', 'i')
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
		entry.terms.name.concat(entry.terms.group).forEach(term => {
			if(typeof(this.index.terms[term]) == 'undefined'){
				this.index.terms[term] = {n: [], g: []}
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
	connect(path){
		return new Promise((resolve, reject) => {
            if(path.match(new RegExp('^//[^/]+\\.'))){
                path = 'http:' + path
            }
            if(path.match(new RegExp('^https?:'))){
                let resolved
                const opts = {
                    url: path,
                    p2p: !!this.forceDownload,
                    retries: 3,
                    followRedirect: true,
                    keepalive: false,
                    headers: {
                        'accept-charset': 'utf-8, *;q=0.1'
                    },
                    timeout: Math.max(30, global.config.get('connect-timeout')), // some servers will take too long to send the initial response
                    downloadLimit: 200 * (1024 * 1024), // 200Mb
                    cacheTTL: this.forceDownload ? 0 : 3600,
                    debug: false
                }
                this.stream = new global.Download(opts)
                this.stream.on('response', (statusCode, headers) => {
                    if(this.debug){
                        console.log('response', statusCode, headers, this.updateMeta)
                    }
                    resolved = true
                    if(statusCode >= 200 && statusCode < 300){
                        this.contentLength = this.stream.totalContentLength
                        if(this.stream.totalContentLength > 0 && (this.stream.totalContentLength == this.updateMeta.contentLength)){
                            this.stream.destroy()
                            resolve(false) // no need to update
                        } else {
                            this.stream.currentResponse.pause()
                            resolve(true)
                        }
                    } else {
                        this.stream.destroy()
                        reject('http error '+ statusCode)
                    }
                })
                this.stream.on('end', () => {
                    if(this.debug){
                        console.log('end')
                    }
                    this.stream.destroy()
                    if(!resolved) {
                        resolved = true
                        reject('unknown http error')
                    }
                })
                this.stream.on('error', e => {
                    if(this.debug){
                        console.log('err', e)
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
                            resolve(true)
                        }
                    } else {
                        reject('file not found or empty*')
                    }
                })
            }
        })
	}
	async start(){
        let alturl, urls = [this.directURL], fmt = global.config.get('live-stream-fmt')
        if(['hls', 'mpegts'].includes(fmt)) {
            if(!this.mi) {
                this.mi = new MediaURLInfo()
            }
            alturl = this.mi.setURLFmt(this.directURL, fmt)
            if(alturl){
                urls.unshift(alturl)
            }
        }
        await fs.promises.mkdir(global.dirname(this.tmpfile), {recursive: true}).catch(console.error)
        const writer = fs.createWriteStream(this.tmpfile, {
            highWaterMark: Number.MAX_SAFE_INTEGER
        })
        let connected
        for(let url of urls){
            connected = await this.connect(url).catch(console.error)
            if(connected === true){
                await this.parseStream(writer).catch(console.error)     
                if(this.indexateIterator) break
            }
        }
        console.error('PLAYLISTS', this.playlists)
        let i = 0
        while(i < this.playlists.length){
            const playlist = this.playlists[i]
            i++
            connected = await this.connect(playlist.url).catch(console.error)
            console.error('PLAYLIST '+ playlist.url +' '+ this.indexateIterator)
            if(connected === true){
                await this.parseStream(writer, playlist).catch(console.error)
            }
        }
        console.error('PLAYLISTS end')
        await this.writeIndex(writer).catch(err => console.warn('writeIndex error', err))
        writer.destroy()
        return true
	}
	parseStream(writer, playlist){
		return new Promise((resolve, reject) => {
			let resolved, count, destroyListener = () => {
                if(!resolved){
                    resolved = true
                    fs.unlink(this.tmpfile, () => {})
                    reject('destroyed')
                }
            }
			this.parser = new Parser(this.stream)
			this.parser.on('meta', meta => {
				Object.assign(this.index.meta, meta)
			})
			this.parser.on('playlist', e => {
                this.playlists.push(e)
			})
			this.parser.on('entry', entry => {
                count++
				if(this.destroyed){
                    if(!resolved){
                        resolved = true
                        reject('destroyed')
                    }
                    return
				}
                if(this.ext(entry.url) == 'm3u8'){
                    this.hlsCount++
                }
                if(playlist){
                    entry.group = global.joinPath(global.joinPath(playlist.group, playlist.name), entry.group)
                }
                if(entry.group){ // collect some data to sniff after if each group seems live, serie or movie
                    if(typeof(this.groups[entry.group]) == 'undefined'){
                        this.groups[entry.group] = []
                    }
                    this.groups[entry.group].push({
                        name: entry.name,
                        url: entry.url,
                        icon: entry.icon
                    })
                }
                entry = this.indexate(entry, this.indexateIterator)
                writer.write(JSON.stringify(entry) + "\r\n")
                this.indexateIterator++
			})
            this.once('destroy', destroyListener)
			this.parser.once('end', () => {
                this.removeListener('destroy', destroyListener)
                if(!resolved){
                    resolved = true
                    if(count){
                        resolve(true)
                    } else {
                        reject('empty list')
                    }
                    if(this.contentLength <= 0){
                        this.contentLength = this.stream.received
                    }
                    this.parser.destroy()
                    this.stream.destroy()
                    this.stream = this.parser = null
                }
			})
            if(this.stream instanceof global.Download){                
                this.stream.currentResponse.resume()
            }
            // if we dont know contentLength, we'll estimate a big list size to show some progress for the user, even it being less consistent
            let contentLength = this.contentLength && this.contentLength > 0 ? this.contentLength : (100 * (1024 * 1024))
            let received = 0, pp = contentLength / 100
            this.stream.on('data', chunk => {
                received += chunk.length
                let progress = parseInt(received / pp)
                if(progress > 99){
                    progress = 99
                }
                if(this.playlists.length){
                    let i = -1
                    this.playlists.some((p, n) => {
                        if(p.url == playlist.url){
                            i = n
                            return true
                        }
                    })
                    if(i != -1){
                        const lr = 100 / (this.playlists.length + 1)
                        const pr = (i * lr) + (progress * (lr / 100))
                        progress = pr
                    }
                }
                if(progress !== this.progress) {
                    this.progress = progress
                    this.emit('progress', progress)
                }
            })
		})
	}
    writeIndex(writer){
        return new Promise((resolve, reject) => {
			let resolved
            this.index.length = this.indexateIterator
            this.index.hlsCount = this.hlsCount
            this.index.groupsTypes = this.sniffGroupsTypes(this.groups)
            if(this.index.length || !fs.existsSync(this.file)){
                const finish = err => {
                    if(resolved) return
                    resolved = true
                    if(err) console.error(err)
                    global.moveFile(this.tmpfile, this.file, err => {
                        if(err){
                            reject(err)
                        } else if(this.index.length) {
                            resolve(true)
                        } else {
                            resolve(false)
                        }
                        fs.access(this.tmpfile, err => err || fs.unlink(this.tmpfile, () => {}))
                    }, 10)
                }
                writer.on('finish', finish)
                writer.on('close', finish)
                writer.on('error', finish)
                writer.write(JSON.stringify(this.index))
                writer.end()
            } else {
                resolved = true
                fs.unlink(this.tmpfile, () => reject('empty list'))
            }
        })
    }
    sniffGroupsTypes(groups){
        let ret = {live: [], vod: [], series: []}
        Object.keys(groups).forEach(g => {
            let icon, types = groups[g].map(e => {
                if(e.icon && !icon){
                    icon = e.icon
                }
                return this.sniffStreamType(e)
            }).filter(s => s)
            let type = this.mode(types)
            if(type){
                ret[type].push({
                    name: g,
                    icon
                })
            }
        })
        return ret
    }
    sniffStreamType(e){
        if(e.name.match(this.seriesRegex)){
            return 'series'
        } else if(e.url.match(this.vodRegex)){
            return 'vod'
        } else if(e.url.match(this.liveRegex)){
            return 'live'
        }
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
            terms: {},
            groups: {},
            meta: {},
            gids: {}
        }
		this.indexateIterator = 0
		this.contentLength = -1
        this.hlsCount = 0
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
