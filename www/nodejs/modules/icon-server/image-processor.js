import fs from 'fs'
import renderer from '../bridge/bridge.js'
import icons from './icon-server.js';
import downloads from '../downloads/downloads.js';
import { temp } from '../paths/paths.js'
import { randomBytes } from 'node:crypto'

async function saveBase64Image(dataUrl, outputFilePath) {
    const base64Data = dataUrl.replace(/^data:image\/\w+;base64,/, "")
    const imageBuffer = Buffer.from(base64Data, 'base64')
    await fs.promises.writeFile(outputFilePath, imageBuffer)
}

const imp = {}
for (const method of ['transform', 'colors', 'resize', 'hasTransparency']) {
    imp[method] = async (...args) => {
        const uid = randomBytes(9).toString('hex')
        const file = args[0]
        await Promise.allSettled([
            downloads.serve(args[0]).then(a => args[0] = a),
            renderer.ready()
        ])
        return new Promise((resolve, reject) => {
            renderer.ui.once('imp-response-'+ uid, async (err, result) => {
                if (err) {
                    reject(new Error(err))
                } else {
                    if(method === 'transform') {
                        if(result.changed) {
                            await saveBase64Image(result.url, file)
                        }
                        delete result.url
                        result.file = file
                    }
                    resolve(result)
                }
            })
            renderer.ui.emit('imp-'+ method, uid, ...args)
        })
    }
}

imp.iconize = async (file, outputFolder) => {
    if(!outputFolder) outputFolder = temp
    const ext = process.platform == 'win32' ? 'ico' : 'png'
    const outputFile = outputFolder +'/'+ path.basename(file) +'.'+ ext
    const pngOutputFile = ext == 'png' ? outputFile : temp +'/temp.png'
    const ret = await imp.resize(file, 64, 64)
    await saveBase64Image(ret, pngOutputFile)
    if(process.platform == 'win32') {
        await fs.promises.writeFile(outputFile, await pngToIco(pngOutputFile))
        await fs.promises.unlink(pngOutputFile).catch(err => console.error(err))
    } else if(pngOutputFile != outputFile) {
        await fs.promises.copyFile(pngOutputFile, outputFile)
        await fs.promises.unlink(pngOutputFile).catch(err => console.error(err))
    }
    return outputFile
}   

export default imp
