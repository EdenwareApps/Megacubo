import jimp from 'jimp'
import jimpCustomAutocrop from '../jimp-autocrop-custom/jimp-autocrop-custom.js'
import fs from 'fs'
import path from 'path'
import ColorThief from 'color-thief-jimp'
import { temp } from '../paths/paths.js'
import pngToIco from 'png-to-ico'

class JimpWorker {
	constructor(){}	
    load(){
        if(typeof(this.jimp) == 'undefined'){
            this.jimp = jimp
            const jdecoder = this.jimp.decoders['image/jpeg']
            this.jimp.decoders['image/jpeg'] = data => jdecoder(data, {maxMemoryUsageInMB: 256})
            this.jimpCustomAutocrop = jimpCustomAutocrop
        }
    }
    isAlpha(image){
        const padding = 3
        const padding2 = padding + 1
        let alphas = [], corners = [
            [padding, padding],
            [padding, image.bitmap.width - padding2],
            [image.bitmap.height - padding2, padding],
            [image.bitmap.height - padding2, image.bitmap.width - padding2]
        ], valid = corners.some(coords => {
            let px = this.jimp.intToRGBA(image.getPixelColor(coords[0], coords[1]))
            if(px){
                alphas.push(px.a)
                return px.a < 240
            }
        })
        if(!valid) console.warn('not transparent image, corners: ' + JSON.stringify(corners) + ', alphas: ' + JSON.stringify(alphas))
        return valid
    }
    transform(file, opts){
        const maxWidth = 400, maxHeight = 400
        let changed
        opts = Object.assign({autocrop: true, shouldBeAlpha: 0, resize: false}, opts)
        return new Promise((resolve, reject) => {
            this.load()
            this.jimp.read(file).then(image => {
                if(image.bitmap.width > 0 && image.bitmap.height > 0) {
                    let alpha = this.isAlpha(image)
                    if(opts.shouldBeAlpha == 2 && !alpha){
                        return reject('not an alpha image')
                    }
                    if(opts.minWidth && opts.minWidth > image.bitmap.width){
                        return reject('bad image dimensions '+ image.bitmap.width +'x'+ image.bitmap.height)
                    }
                    if(opts.minHeight && opts.minHeight > image.bitmap.height){
                        return reject('bad image dimensions* '+ image.bitmap.width +'x'+ image.bitmap.height)
                    }
                    if(opts.shouldBeAlpha == 2 && !alpha){
                        return reject('not an alpha image')
                    }
                    if(opts.resize){
                        if(image.bitmap.width > maxWidth){
                            const start = (new Date()).getTime()
                            image = image.resize(maxWidth, this.jimp.AUTO)
                            console.log('JIMP resizeX', (new Date()).getTime() - start)
                            changed = true
                        }
                        if(image.bitmap.height > maxHeight) {
                            const start = (new Date()).getTime()
                            image = image.resize(this.jimp.AUTO, maxHeight)
                            console.log('JIMP resizeX', (new Date()).getTime() - start)
                            changed = true
                        }
                    }
                    if(opts.autocrop){
                        image.autocrop = this.jimpCustomAutocrop
                        image = image.autocrop({tolerance: 0.002})
                        if(image.autoCropped) changed = true
                    }
                    if(changed){
                        image.write(file, () => resolve({file, alpha, changed}))
                    } else {
                        resolve({file, alpha, changed})
                    }
                } else {
                    reject('invalid image** ' + image.bitmap.width +'x'+ image.bitmap.height)
                }
                image = null
            }).catch(err => {
                console.error('Jimp failed to open', err, file)
                reject('invalid image*')
            })
        })
    }
    colors(file){
        return new Promise((resolve, reject) => {
            console.log('jimp.colors')
            this.load()
            console.log('jimp.colors1')
            this.jimp.read(file).then(image => {
                console.log('jimp.colors2')
                try {
                    image = image.resize(36, 36)
                    const palette = ColorThief.getPalette(image, 24)
                    console.log('jimp.colors3')
                    const colors = Array.isArray(palette) ? palette.map(px => {
                        return {r: px[0], g: px[1], b: px[2]}
                    }) : []
                    resolve(colors)
                } catch(e) {
                    reject(e)
                }
            }).catch(err => {
                console.log('jimp.colors4')
                reject(err)
            })
        })
    }
    test(file){
        return new Promise((resolve, reject) => {
            resolve('OK')
        })
    }
    async iconize(file, outputFolder){
        if(!outputFolder) outputFolder = temp
        const ext = process.platform == 'win32' ? 'ico' : 'png'
        const pngOutputFile = temp +'/temp.png'
        const outputFile = outputFolder +'/'+ path.basename(file) +'.'+ ext
        this.load()
        let image = await this.jimp.read(file)
        image.contain(64, 64, this.jimp.HORIZONTAL_ALIGN_CENTER | this.jimp.VERTICAL_ALIGN_MIDDLE)
        const imagerd = new this.jimp(64, 64, 0x00000000)
        imagerd.composite(image, 0, 0)
        await imagerd.writeAsync(pngOutputFile, this.jimp.MIME_PNG)
        if(process.platform == 'win32') {
            await fs.promises.writeFile(outputFile, await pngToIco(pngOutputFile))
        } else {
            await fs.promises.copyFile(pngOutputFile, outputFile)
        }
        return outputFile
    }
    async terminate(){}
}

export default JimpWorker