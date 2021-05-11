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
        fs.stat(file, (err, stat) => {
            if(stat && stat.size){
                let i = 0, lastLine = '', rl = readline.createInterface({
                    input: fs.createReadStream(file),
                    crlfDelay: Infinity
                })
                rl.on('line', line => {
                    if(this.destroyed){
                        if(rl){
                            lastLine = ''
                            rl.close()
                            rl = null
                        }
                    } else {
                        if(line && line.charAt(0) == '{'){
                            lastLine = line
                        } else {
                            console.error('Bad line readen', line, file, i)
                        }
                    }
                })
                rl.once('close', () => {
                    cb(lastLine)
                    rl = null
                })
            } else {
                return cb([])
            }
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
