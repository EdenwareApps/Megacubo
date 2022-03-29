const fs = require('fs'), Events = require('events'), readline = require('readline')

class ListIndexUtils extends Events {
	constructor(){
		super()
		this.indexTemplate = {
            terms: {},
            groups: {},
            meta: {}
        }
    }
    readLines(file, map, cb){
        if(map && !map.length){
            return cb([])
        }
        fs.stat(file, (err, stat) => {
            if(stat && stat.size){
                let max, i = 0, lines = [], rl = readline.createInterface({
                    input: fs.createReadStream(file),
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
                        cb([])
                    } else {
                        if(!line || line.charAt(0) != '{'){
                            console.error('Bad line readen', line, file, i)
                        }
                        if(!map || map.includes(i)){
                            lines.push(line)
                        }
                        if(max > 0 && i == max){
                            rl.close()
                        }
                        i++
                    }
                })
                rl.once('close', () => {
                    if(!map){
                        lines.pop() // remove index from entries
                    }
                    cb(lines)
                    rl = null
                })
            } else {
                return cb([])
            }
        })
    }
    readLastLine(file, cb) {
        let fs = require('fs').promises
        let bufferSize = 512
        const readPreviousChar = function(stat, file, currentCharacterCount) {
            let readSize = Math.min(bufferSize, stat.size - currentCharacterCount)
            return file.read(Buffer.alloc(readSize), 0, readSize, stat.size - readSize - currentCharacterCount)
        }
        let self = {
            stat: null,
            file: null,
        }
        let promises = []
        promises.push(fs.stat(file).then(stat => self.stat = stat))
        promises.push(fs.open(file, 'r').then(file => self.file = file))
        Promise.all(promises).then(() => {
            let chars = 0
            let lineCount = 0
            let lines = ''
            const loop = () => {
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
                    return cb(lines.split("\n").pop())
                }
                return readPreviousChar(self.stat, self.file, chars)
                    .then((nextChunk) => {
                        let chunk = String(nextChunk.buffer)
                        lines = chunk + lines;
                        if (chunk.indexOf("\n") != -1 && lines.length > 1) {
                            lineCount++;
                        }
                        chars += nextChunk.bytesRead
                    })
                    .then(loop)
            };
            return loop()
        }).catch((reason) => {
            console.error(reason)
            if (self.file !== null) {
                self.file.close()
                self.file = null
            }
            cb('')
        })
    }
    readIndex(cb){
        this.readLastLine(this.file, line => {
            let index = false
            if(line){
                try {
                    index = JSON.parse(line)
                } catch(e) {
                    console.error('Index parsing failure', line, e, this.file)
                }
            }
            if(index && typeof(index.length) != 'undefined'){
                cb(index)
            } else {
                console.error('Bad index', line, this.file)
                cb(this.indexTemplate)
            }
        })
    }
}

module.exports = ListIndexUtils
