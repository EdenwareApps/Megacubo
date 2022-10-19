const fs = require('fs')

class Crashlog {
    constructor(){
        this.crashFile = global.paths.data + '/crash.txt' // unreported crashes
        this.crashLogFile = global.paths.data + '/crashlog.txt' // reported crashes
    }
    replaceCircular(val, cache) {
        cache = cache || new WeakSet()
        if (val && typeof(val) == 'object') {
            if (cache.has(val)) return '[Circular]'
            cache.add(val)
            var obj = (Array.isArray(val) ? [] : {})
            for(var idx in val) {
                obj[idx] = this.replaceCircular(val[idx], cache)
            }
            if(val['stack']){
                obj['stack'] = this.replaceCircular(val['stack'])
            }
            cache.delete(val)
            return obj
        }
        return val
    }
    save(...args){
        const os = require('os')
        fs.appendFileSync(this.crashFile, JSON.stringify(Array.from(args).map(a => this.replaceCircular(a)), (key, value) => {
            if(value instanceof Error) {
                var error = {}
                Object.getOwnPropertyNames(value).forEach(function (propName) {
                    error[propName] = value[propName]
                })
                return error
            }
            return value
        }, 3).replaceAll("\\n", "\n") +"\r\n"+ JSON.stringify({
            version: global.MANIFEST ? global.MANIFEST.version : '',
            platform: process.platform,
            release: os.release(),
            arch: os.arch(),
            date: (new Date()).toString(), 
            lang: typeof(lang) != 'undefined' && lang ? lang.locale : ''
        }) +"\r\n\r\n")
    }
    async read(){
        let content = ''
        for(let file of [this.crashFile, this.crashLogFile]){
            let text = await fs.promises.readFile(file).catch(console.error)
            if(text){ // filter "undefined"
                content += text
            }
        }
        return content
    }
    post(content){
        return new Promise((resolve, reject) => {
            const FormData = require('form-data'), form = new FormData(), http = require('http')
            form.append('log', String(content))
            const options = {
                method: 'post',
                host: global.cloud.server.split('/').pop(),
                path: '/report/index.php',
                headers: form.getHeaders()
            }
            let resolved, req = http.request(options, res => {
                res.setEncoding('utf8')
                let data = ''
                res.on('data', (d) => {
                    data += d
                })
                res.once('end', () => {
                    if(data.indexOf('OK') != -1){
                        fs.stat(this.crashLogFile, (err, stat) => {
                            if(stat && stat.file){
                                fs.appendFile(this.crashLogFile, content, () => {
                                    fs.unlink(this.crashFile, () => {})
                                })
                            } else {
                                global.moveFile(this.crashFile, this.crashLogFile, () => {})
                            }
                        })
                        if(!resolved){
                            resolved = true
                            resolve(true)
                        }
                    } else {
                        if(!resolved){
                            resolved = true
                            reject('Invalid response')
                        }
                    }
                })
            })
            req.on('error', (e) => {
                console.error('Houve um erro', e)
                if(!resolved){
                    resolved = true
                    reject(e)
                }
            })
            form.pipe(req)
            req.end()
        })
    }
    async send(){
        const stat = await fs.promises.stat(this.crashFile).catch(() => {})
        if(stat && stat.size){
            const content = await fs.promises.readFile(this.crashFile)
            await this.post(content)
        }
    }
}

module.exports = new Crashlog()
