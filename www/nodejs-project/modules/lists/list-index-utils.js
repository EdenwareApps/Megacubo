const fs = require('fs'), Events = require('events')
const readline = require('readline'), createReader = require('../reader')

class ListIndexUtils extends Events {
	constructor(){
		super()
        this.seriesRegex = new RegExp('(\\b|^)[st]?[0-9]+ ?[epx]{1,2}[0-9]+($|\\b)', 'i')
        this.vodRegex = new RegExp('[\\.=](mp4|mkv|mpeg|mov|m4v|webm|ogv|hevc|divx)($|\\?|&)', 'i')
        this.liveRegex = new RegExp('([0-9]+/[0-9]+|[\\.=](m3u8|ts))($|\\?|&)', 'i')
        this.indexTemplate = {
            groups: {},
            terms: {},
            meta: {}
        }
    }
    sniffStreamType(e){
        if(e.name.match(this.seriesRegex)) {
            return 'series'
        } else if(e.url.match(this.vodRegex)) {
            return 'vod'
        } else if(e.url.match(this.liveRegex)) {
            return 'live'
        }
    }
    getRangesFromMap(map) {
        const ranges = []
        map.forEach(n => ranges.push({start: this.linesMap[n], end: this.linesMap[n + 1] - 1}))
        return ranges
    }
    async readLinesByMap(map) {
        const ranges = this.getRangesFromMap(map)
        const lines = {}
        let fd = null
        try {
            fd = await fs.promises.open(this.file, 'r')
            for (const [index, range] of ranges.entries()) {
                const length = range.end - range.start
                const buffer = Buffer.alloc(length)
                const { bytesRead } = await fd.read(buffer, 0, length, range.start)                
                if(bytesRead < buffer.length) {
                    buffer = buffer.slice(0, bytesRead)
                }
                lines[map[index]] = buffer.toString()
            }
        } catch (error) {
            console.error(error)
        } finally {
            if (fd !== null) {
                try {
                    await fd.close().catch(console.error)
                } catch (error) {
                    console.error("Error closing file descriptor:", error)
                }
            }
        }
        return lines
    }
    readLines(map){
        return new Promise((resolve, reject) => {
            if(map){
                if(!map.length){
                    return reject('empty map requested')
                }
                map.sort()
                if(Array.isArray(this.linesMap)) {
                    return this.readLinesByMap(map).then(resolve).catch(reject)
                }
            }
            fs.stat(this.file, (err, stat) => {
                if(err || !stat){
                    return reject(err || 'stat failed with no error')
                }
                if(stat.size){
                    let max, i = 0, lines = {}, rl = readline.createInterface({
                        input: createReader(this.file),
                        crlfDelay: Infinity
                    })
                    if(map){
                        max = global.getArrayMax(map)
                    } else {
                        max = -1
                    }
                    rl.on('line', line => {
                        if(this.destroyed){
                            if(rl){
                                rl.close()
                                rl = null
                            }
                            reject('list destroyed')
                        } else {
                            if(!line || line.charAt(0) != '{'){
                                console.error('Bad line readen', this.file, i)
                            }
                            if(!map || map.includes(i)){
                                lines[i] = line
                            }
                            if(max > 0 && i == max){
                                rl.close()
                            }
                            i++
                        }
                    })
                    rl.once('close', () => {
                        if(!map){
                            let last = Object.keys(lines).pop() // remove index from entries
                            delete lines[last]
                        }
                        resolve(lines)
                        rl = null
                    })
                } else {
                    return reject('empty file '+ stat.size)
                }
            })
        })
    }
    async readLastLine() {
        const bufferSize = 16834
        const { size } = await fs.promises.stat(this.file)
        const fd = await fs.promises.open(this.file, 'r')
        let line = ''
        let readPosition = Math.max(size - bufferSize, 0)
        while(readPosition >= 0){
            const readSize = Math.min(bufferSize, size - readPosition)
            const { buffer, bytesRead } = await fd.read(Buffer.alloc(readSize), 0, readSize, readPosition)
            const content = String(buffer)
            line = content + line
            const pos = content.lastIndexOf("\n")
            if (pos != -1) {
                line = line.substring(pos + 1)
                break
            }
            if(!bytesRead) {
                break
            }
            readPosition -= bytesRead
        }
        await fd.close().catch(console.error)
        return line
    }
    async readIndex(){
        let line = await this.readLastLine()
        let index = false
        if(line){
            try {
                let parsed = global.parseJSON(line)
                if(Array.isArray(parsed)) {
                    this.linesMap = parsed
                    const fd = await fs.promises.open(this.file, 'r')
                    const from = parsed[parsed.length - 2]
                    const length = parsed[parsed.length - 1] - from
                    const buffer = Buffer.alloc(length)
                    const { bytesRead } = await fd.read(buffer, 0, length, from)
                    await fd.close().catch(console.error)
                    line = String(buffer).substr(0, bytesRead)
                    index = JSON.parse(line)
                } else {
                    index = parsed // old style compat
                }
            } catch(e) {
                console.error('Index parsing failure', e, this.file)
            }
        }
        if(index && typeof(index.length) != 'undefined'){
            if(index.linesMap) {
                this.linesMap = index.linesMap
                delete index.linesMap
            }
            return index
        } else {
            console.error('Bad index', String(line).substr(0, 256), this.file)
            return this.indexTemplate
        }
    }
}

module.exports = ListIndexUtils
