
const fs = require('fs')

class Base64 {
    ext(file){
        return String(file).split('?')[0].split('#')[0].split('.').pop().toLowerCase()
    }
    decode(b64){
        return Buffer.from(b64.replace(new RegExp('^data:[A-Za-z0-9\-\/]+;base64,'), ''), 'base64')
    }
    toFile(b64, file) {
        return new Promise((resolve, reject) => {
            const data = b64.replace(new RegExp('^data:[A-Za-z0-9\-\/]+;base64,'), '')
            fs.writeFile(file, data, 'base64', err => {
                if(err){
                    console.error(err)
                    reject(err)
                } else {
                    resolve()
                }
            })
        })
    }
    isHTTP(url){  
        return url.match(new RegExp('^(//|https?://)'))
    }
    from(source){  
        return new Promise((resolve, reject) => {  
            if(this.isHTTP(source)){
                this.fromHTTP(source).then(resolve).catch(reject)
            } else {
                this.fromFile(source).then(resolve).catch(reject)
            }
        })
    }
    fromHTTP(url){  
        return new Promise((resolve, reject) => {  
            global.Download.get({
                url,
                responseType: 'buffer',
                retries: 2
            }).then(content => {
                if(!content){
                    console.error('Failed to read URL', err, url)
                    reject('Failed to read URL')
                } else {
                    this.fromImageBuffer(content, url).then(resolve).catch(reject)
                }
            }).catch(err => {
                console.error('Failed to read URL', err, url)
                reject('Failed to read URL')
            })
        })
    }
    fromFile(file){  
        return new Promise((resolve, reject) => {  
            fs.stat(file, (err, stat) => {
                if(stat && stat.size) {
                    fs.readFile(file, (err, content) => {
                        if(err) {
                            console.error('Failed to read file', err)
                            reject('Failed to read file')
                        } else {
                            this.fromImageBuffer(content, file).then(resolve).catch(reject)
                        }
                    })
                } else {
                    console.error('File do not exists.')
                    reject('File do not exists.')
                }
            })
        })
    }
    fromImageBuffer(content, extOrName){    
        return new Promise((resolve, reject) => {
            var type = 'image/jpeg', ext = (this.ext(extOrName) || extOrName)
            switch(ext){
                case 'png':
                    type = 'image/png'
                    break
                case 'jpg':
                case 'jpeg':
                    type = 'image/jpeg'
                    break
                case 'mp4':
                    type = 'video/mp4'
                    break
                case 'webm':
                    type = 'video/webm'
                    break
            }
            if(!(content instanceof Buffer)){
                content = Buffer.from(content, 'binary')
            }
            content = content.toString('base64')
            if(content.length > 36){
                resolve('data:'+type+';base64,'+ content)
            } else {
                reject('failed')
            }
        })
    }
}

module.exports = Base64
 