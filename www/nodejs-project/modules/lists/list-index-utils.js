const fs = require('fs'), Events = require('events'), readline = require('readline')

class ListIndexUtils extends Events {
	constructor(){
		super()
        this.seriesRegex = new RegExp('(\\b|^)[st]?[0-9]+ ?[epx]{1,2}[0-9]+($|\\b)', 'i')
        this.vodRegex = new RegExp('[\\.=](mp4|mkv|mpeg|mov|m4v|webm|ogv|hevc|divx)($|\\?|&)', 'i')
        this.liveRegex = new RegExp('[\\.=](m3u8|ts)($|\\?|&)', 'i')
        this.indexTemplate = {
            groups: {},
            terms: {},
            meta: {}
        }
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
    readLines(map){
        return new Promise((resolve, reject) => {
            if(map){
                if(!map.length){
                    return reject('empty map requested')
                }
                map.sort()
            }
            fs.stat(this.file, (err, stat) => {
                if(err || !stat){
                    return reject(err || 'stat failed with no error')
                }
                if(stat.size){
                    let max, i = 0, lines = {}, rl = readline.createInterface({
                        input: fs.createReadStream(this.file),
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
                                console.error('Bad line readen', line, this.file, i)
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
    async readLastLine(file) {         
        let bufferSize = 1024
        let self = {
            stat: null,
            file: null,
        }
        self.stat = await fs.promises.stat(file)
        self.file = await fs.promises.open(file, 'r')
        let chars = 0
        let lineCount = 0
        let lines = ''
        while(true){
            if (lines.length > self.stat.size) {
                lines = lines.substring(lines.length - self.stat.size)
            }
            if (lines.length >= self.stat.size || lineCount >= 1) {
                let pos = lines.indexOf("\n")
                if (pos != -1) {
                    lines = lines.substring(pos + 1);
                }
                self.file.close()
                self.file = null
                break
            }
            let readSize = Math.min(bufferSize, self.stat.size - chars)
            let nextChunk = await self.file.read(Buffer.alloc(readSize), 0, readSize, self.stat.size - readSize - chars)
            let chunk = String(nextChunk.buffer)
            lines = chunk + lines
            if (chunk.indexOf("\n") != -1 && lines.length > 1) {
                lineCount++;
            }
            chars += nextChunk.bytesRead
        }
        return lines.split("\n").pop()
    }
    async readIndex(){
        let line = await this.readLastLine(this.file)
        let index = false
        if(line){
            try {
                index = global.parseJSON(line)
            } catch(e) {
                console.error('Index parsing failure', line, e, this.file)
            }
        }
        if(index && typeof(index.length) != 'undefined'){
            return index
        } else {
            console.error('Bad index', String(line).substr(0, 256), this.file)
            return this.indexTemplate
        }
    }
}

module.exports = ListIndexUtils
