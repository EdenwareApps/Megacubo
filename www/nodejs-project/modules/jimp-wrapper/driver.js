
class JimpDriver {
	constructor(){}	
    load(){
        if(typeof(this.jimp) == 'undefined'){
            this.jimp = require('jimp')
            this.jimpCustomAutocrop = require(APPDIR +'/modules/jimp-autocrop-custom')
        }
    }
    autoCropValidateAlpha(image){
        let err, alphas = [], corners = [
            [0, 0],
            [0, image.bitmap.width - 1],
            [image.bitmap.height - 1, 0],
            [image.bitmap.height - 1, image.bitmap.width - 1]
        ], valid = corners.some(coords => {
            let px = this.jimp.intToRGBA(image.getPixelColor(coords[0], coords[1]))
            if(px){
                alphas.push(px.a)
                return px.a < 255
            }
        })
        if(!valid){
            err = 'not transparent image, corners: ' + JSON.stringify(corners) + ', alphas: ' + JSON.stringify(alphas)
        }
        return {valid, err}
    }
    transform(data, opts){
        const maxWidth = 500, maxHeight = 500
        opts = Object.assign({autocrop: true, alphaOnly: true}, opts)
        return new Promise((resolve, reject) => {
            this.load()
            if(data && data.length > 32){
                if(!(data instanceof Buffer)){
                    data = Buffer.from(data)
                }
                this.jimp.read(data).then(image => {
                    if(image.bitmap.width > 0 && image.bitmap.height > 0) {
                        let ret = !opts.alphaOnly || (this.autoCropValidateAlpha(image))
                        if(!opts.alphaOnly || ret.valid){
                            if(opts.autocrop){
                                image.autocrop = this.jimpCustomAutocrop
                                image = image.autocrop({tolerance: 0.002})
                            }
                            if(image.bitmap.width > maxWidth){
                                image = image.resize(maxWidth, this.jimp.AUTO)
                            }
                            if(image.bitmap.height > maxHeight) {
                                image = image.resize(this.jimp.AUTO, maxHeight)
                            }
                            image.getBufferAsync(this.jimp.AUTO).then(resolve).catch(reject)
                        } else {
                            reject('not transparent image ' + ret.err)
                        }
                    } else {
                        reject('invalid image** ' + image.bitmap.width +'x'+ image.bitmap.height + ' ' + data.length)
                    }
                }).catch(err => {
                    console.error(err)
                    reject('invalid image* ' + data.length)
                })
            } else {
                console.error(err)
                reject('invalid image* ' + data.length)
            }
        })
    }
    colors(file){
        return new Promise((resolve, reject) => {
            this.load()
            this.jimp.read(file).then(image => {
                image = image.resize(100, 100)
                const ColorThief = require('color-thief-jimp'), palette = ColorThief.getPalette(image, 24)
                const colors = Array.isArray(palette) ? palette.map(px => {
                    return {r: px[0], g: px[1], b: px[2]}
                }) : []
                resolve(colors)
            }).catch(err => {
                reject(err)
            })
        })
    }
}

module.exports = JimpDriver
