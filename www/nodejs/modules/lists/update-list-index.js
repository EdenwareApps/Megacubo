import { dirname, joinPath, moveFile } from '../utils/utils.js';
import Download from '../download/download.js'
import ListIndexUtils from './list-index-utils.js'
import { temp } from '../paths/paths.js'
import fs from 'fs'
import MediaURLInfo from '../streamer/utils/media-url-info.js'
import Xtr from './xtr.js'
import Mag from './mag.js'
import { Parser } from './parser.js'
import config from '../config/config.js'
import { Database } from 'jexidb';

class UpdateListIndex extends ListIndexUtils { 
	constructor(opts={}){
		super()
        this.url = opts.url
        this.file = opts.file
		this.playlists = []
        this.master = opts.master
        this.lastProgress = -1
        this.directURL = opts.directURL || this.url
        this.updateMeta = opts.updateMeta
        this.forceDownload = opts.forceDownload === true
        this.uid = parseInt(Math.random() * 100000000000)
        this.tmpOutputFile = temp +'/'+ this.uid +'.jdb.tmp'
        this.timeout = opts.timeout || config.get('read-timeout')
        this.indexMeta = {}
        this.debug = opts.debug
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
	indexate(entry, i, db){
        entry = this.master.prepareEntry(entry)
        entry.terms.name.concat(entry.terms.group).forEach(term => {
            if (typeof(db.index.terms[term]) == 'undefined') {
                db.index.terms[term] = { n: [], g: [] }
            }
        })
		entry.terms.name.forEach(term => {
            // ensure it's an array an not a method
			if(Array.isArray(db.index.terms[term].n) && !db.index.terms[term].n.includes(i)){
				db.index.terms[term].n.push(i)
			}
		})
		entry.terms.group.forEach(term => {
			if(Array.isArray(db.index.terms[term].n) && !db.index.terms[term].g.includes(i)){
				db.index.terms[term].g.push(i)
			}
		})
        if(entry.name && entry.gid){
            if(typeof(db.index.gids) == 'undefined'){
                db.index.gids = {}
            }
            if(typeof(db.index.gids[entry.gid]) == 'undefined'){
                db.index.gids[entry.gid] = []
            }
            if(!db.index.gids[entry.gid].includes(entry.name)){
                db.index.gids[entry.gid].push(entry.name)
            }
        }
		if(typeof(db.index.groups[entry.group]) == 'undefined'){
			db.index.groups[entry.group] = []
		}
		db.index.groups[entry.group].push(i)
		return entry
	}
    parseHeadersMeta(headers) {
        const prefix = 'x-m3u-meta-'
        Object.keys(headers).filter(k => k.startsWith(prefix)).forEach(k => {
            const name = k.substr(prefix.length)
            this.indexMeta[name] = headers[k]            
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
                    debug: false, // this.debug,
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
                this.stream = new Download(opts)
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
        let alturl, urls = [this.directURL], fmt = config.get('live-stream-fmt')
        if(['hls', 'mpegts'].includes(fmt)) {
            if(!this.mi) {
                this.mi = new MediaURLInfo()
            }
            alturl = this.mi.setURLFmt(this.directURL, fmt)
            if(alturl){
                urls.unshift(alturl)
            }
        }
        await fs.promises.mkdir(dirname(this.tmpOutputFile), {recursive: true}).catch(console.error)
        const db = new Database(this.tmpOutputFile, {
            clear: true,
            index: {
                length: 0,
                uniqueStreamsLength: 0,
                terms: {},
                groups: {},
                meta: {},
                gids: {}
            },
            v8: false,
            compressIndex: false
        })
        await db.init()
        db.on('before-save', () => {
            Object.assign(db.index.meta, this.indexMeta)
            this.indexMeta = db.index.meta
            db.index.uniqueStreamsLength = this.uniqueStreamsIndexate.size
            db.index.groupsTypes = this.sniffGroupsTypes(this.groups)
        })
        db.on('insert', (e, i) => {
            e = this.indexate(e, i, db)
            if(e.group) { // collect some data to sniff after if each group seems live, serie or movie
                if(typeof(this.groups[e.group]) == 'undefined') {
                    this.groups[e.group] = []
                }
                this.groups[e.group].push({
                    name: e.name,
                    url: e.url,
                    icon: e.icon
                })
            }
            if(!this.uniqueStreamsIndexate.has(e.url)) {
                this.uniqueStreamsIndexate.add(e.url)
            }
            this.indexateIterator++
        })
        for(let url of urls){
            let err
            const hasCredentials = url.includes('@')
            if(hasCredentials && url.includes('#xtream')) {
                await this.xparse(url, db).catch(console.error)
                if(this.indexateIterator) break
            } else if(hasCredentials && url.includes('#mag')) {
                await this.mparse(url, db).catch(console.error)
                if(this.indexateIterator) break
            } else {
                const ret = await this.fetch(url).catch(e => err = e)
                if(!err && ret){
                    await this.parse(ret, db).catch(console.error)
                    if(this.indexateIterator) break
                }
            }
        }
        let i = 0
        while(i < this.playlists.length){ // new playlists can be live added in the loop fetch() call
            let err
            const playlist = this.playlists[i]
            i++
            const ret = await this.fetch(playlist.url).catch(e => err = e)
            console.error('PLAYLIST '+ playlist.url +' '+ this.indexateIterator +' '+ err)
            if(!err && ret){
                await this.parse(ret, db, playlist).catch(console.error)
            }
        }
        let err
        await db.save().catch(e => err = e)
        await db.destroy().catch(e => err = e)
        await moveFile(this.tmpOutputFile, this.file).catch(e => { if(!err) err = e })
        if(err) {
            console.error('writeIndex error', err)
        }
        return true
	}
    async xparse(url, db){
        let err
        const xtr = new Xtr(url)
        xtr.on('progress', p => this.emit('progress', p, this.url))
        xtr.on('meta', meta => {
            Object.assign(this.indexMeta, meta)
        })
        xtr.on('entry', entry => db.insert(entry).catch(console.error))
        await xtr.run().catch(e => err = e)
        xtr.destroy()
        if(err) {
            console.error('XPARSE '+ err)
            throw err
        }
    }
    async mparse(url, db){
        let err
        const mag = new Mag(url)
        mag.on('progress', p => this.emit('progress', p, this.url))
        mag.on('meta', meta => {
            Object.assign(this.indexMeta, meta)
        })
        mag.on('entry', entry => db.insert(entry).catch(console.error))
        await mag.run().catch(e => err = e)
        mag.destroy()
        if(err) {
            console.error('MPARSE '+ err)
            throw err
        }
    }
	async parse(opts, db, playlist){
        let resolved
        const endListener = () => {
            this.parser && this.parser.end()
        }
        this.parser && this.parser.destroy()
        this.parser = new Parser(opts)
        this.parser.on('meta', meta => Object.assign(this.indexMeta, meta))
        this.parser.on('playlist', e => this.playlists.push(e))
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
		const ret = new Promise((resolve, reject) => {
            const destroyListener = () => {
                if(!resolved){
                    resolved = true
                    reject('destroyed')
                }
            }
			this.parser.on('entry', entry => {
				if(this.destroyed){
                    if(!resolved){
                        resolved = true
                        reject('destroyed')
                    }
                    return
				}
                if(playlist){
                    entry.group = joinPath(joinPath(playlist.group, playlist.name), entry.group)
                }
                db.insert(entry).catch(console.error)
			})
            this.once('destroy', destroyListener)
			this.parser.once('finish', () => {
                if(!resolved){
                    resolved = true
                    if(this.indexateIterator) {
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
		})
        this.parser.start()
        this.stream.once('end', endListener)
        this.stream.resume()
        return await ret
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
	reset(){	
        this.groups = {}
		this.indexateIterator = 0
		this.uniqueStreamsIndexate = new Set()
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

export default UpdateListIndex
