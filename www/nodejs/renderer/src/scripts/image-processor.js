export class ImageProcessor {
    constructor(main) {
        this.worker = new Worker(URL.createObjectURL(new Blob([`

            const ALPHA_IGNORE_LEVEL = 255 * 0.2;
            const STEP_COUNT = 72;
            const DEBUG = false;
            const MAX_DIMENSION = 512;

            self.onmessage = async function(e) {
                const { method, args, id } = e.data
                let result, error

                DEBUG && console.log('Worker received message:', { method, args, id })

                try {
                    result = await self[method](...args)
                } catch (err) {
                    error = String(err)
                }

                DEBUG && console.log('Worker sending message back:', { id, result, error })
                self.postMessage({ id, result, error })
            }

            self.colors = async function(url, count = 5) {
                DEBUG && console.log('Processing colors for URL:', url)
                const { imageData } = await loadImageData(url, 36, 36)
                const dominantColors = await getDominantColors(imageData, count)
                return dominantColors
            }

            self.transform = async function(url, opts = {}) {
                opts = Object.assign({ autocrop: true, shouldBeAlpha: 0 }, opts)
                DEBUG && console.log('Transforming image with options:', opts)
                const {canvas, ctx, imageBitmap, imageData} = await loadImageData(url)
                const alpha = await isAlpha(imageData)

                if (opts.shouldBeAlpha === 2 && !alpha) {
                    throw new Error('Not an alpha image')
                }

                const ret = { url, alpha, changed: false }
                if (opts.autocrop) {
                    try {
                        DEBUG && console.log('Transforming image 2')
                        const { croppedImage, changed } = await autocrop(canvas, ctx, alpha, imageData)
                        DEBUG && console.log('Transforming image 3')
                        if (changed) {
                            let err
                            const newUrl = await dataURLFromImageBitmap(croppedImage).catch(e => err = e)
                            if (!err && newUrl) {
                                ret.url = newUrl
                                ret.changed = true
                            } else {
                                DEBUG && console.error('Error creating data URL:', err)
                                ret.error = err
                            }
                        }
                    } catch(err) {
                        DEBUG && console.error('worker err', err)
                        ret.error = err
                    }
                } else if(imageBitmap.width > MAX_DIMENSION || imageBitmap.height > MAX_DIMENSION) {
                    let err
                    const newUrl = await dataURLFromImageBitmap(canvas).catch(e => err = e)
                    if (!err && newUrl) {
                        ret.url = newUrl
                        ret.changed = true
                    } else {
                        DEBUG && console.error('Error creating data URL*:', err)
                        ret.error = err
                    }
                }
                return ret // returns whether it has alpha
            }
                    
            self.resize = async (url, width, height) => {
                const { canvas } = await loadImageData(url, width, height)
                return await dataURLFromImageBitmap(canvas)
            }

            async function loadImageData(url, width, height) {
                if (typeof(url) !== 'string') return url
                const response = await fetch(url)
                if (!response.ok) {
                    throw new Error(\`Error fetching image: \${response.statusText}\`)
                }
                const blob = await response.blob()
                const imageBitmap = await createImageBitmap(blob)
                if(!width || !height) {
                    if(imageBitmap.width > MAX_DIMENSION) {
                        width = MAX_DIMENSION
                        height = Math.round(imageBitmap.height * (MAX_DIMENSION / imageBitmap.width))
                    } else if(imageBitmap.height > MAX_DIMENSION) {
                        height = MAX_DIMENSION
                        width = Math.round(imageBitmap.width * (MAX_DIMENSION / imageBitmap.height))
                    } else {
                        width = imageBitmap.width
                        height = imageBitmap.height
                    }
                }
                const canvas = new OffscreenCanvas(width, height)
                const ctx = canvas.getContext('2d')
                ctx.drawImage(imageBitmap, 0, 0, imageBitmap.width, imageBitmap.height, 0, 0, width, height)
                const imageData = ctx.getImageData(0, 0, width, height)
                return {ctx, canvas, imageBitmap, imageData}
            }

            async function isAlpha(imageData) {
                const padding = 3
                const padding2 = padding + 1
                const { data, width, height } = imageData
                const corners = [
                    [padding, padding],
                    [padding, height - padding2],
                    [height - padding2, padding],
                    [height - padding2, width - padding2],
                ]
                for(const coords of corners) {
                    let a = data[(coords[0] * width + coords[1]) * 4 + 3]
                    if(a < ALPHA_IGNORE_LEVEL) {
                        return true
                    }
                }
                DEBUG && console.warn('Not a transparent image')
                return false
            }

            async function getDominantColors(imageData, colorCount = 5) {
                const colorMap = {}
                const { data, width, height } = imageData

                for (let y = 0; y < height; y++) {
                    for (let x = 0; x < width; x++) {
                        const index = (y * width + x) * 4 // RGBA
                        const rgba = \`\${data[index]},\${data[index + 1]},\${data[index + 2]}\` // ignores alpha

                        if (!colorMap[rgba]) {
                            colorMap[rgba] = 0
                        }
                        colorMap[rgba]++
                    }
                }

                const colorsArray = Object.entries(colorMap)
                    .map(([color, count]) => ({ color: \`rgb(\${color})\`, count }))
                    .sort((a, b) => b.count - a.count)

                return colorsArray.slice(0, colorCount).map(c => c.color)
            }

            async function autocrop(canvas, ctx, alpha, imageData) {
                DEBUG && console.log('autocrop1')
                const { width, height } = canvas
                DEBUG && console.log('autocrop3', width, height)
                const backgroundColor = alpha ? null : { r: 255, g: 255, b: 255, a: 255 }
                const { left, right, top, bottom } = limits = await findLimits(imageData, width, height, backgroundColor)
                DEBUG && console.log('autocrop4')
                if (bottom > top && right > left && !(left === 0 && right === width && top === 0 && bottom === height)) {DEBUG && console.log('autocrop')
                    const croppedCanvas = new OffscreenCanvas(right - left, bottom - top)
                    const croppedCtx = croppedCanvas.getContext('2d')
                    croppedCtx.drawImage(canvas, left, top, croppedCanvas.width, croppedCanvas.height, 0, 0, croppedCanvas.width, croppedCanvas.height);
                    DEBUG && console.log('autocrop')
                    return { croppedImage: croppedCanvas, changed: true }
                }
                return { croppedImage: null, changed: false }
            }

            function isHorizontalLineBlank(imageData, w, c, y) {
                let stepSize = Math.max(1, parseInt(w / STEP_COUNT));
                for (let x = 0; x < w; x += stepSize) {
                    const index = (y * w + x) * 4; // RGBA index
                    const rgba = {
                        r: imageData.data[index],
                        g: imageData.data[index + 1],
                        b: imageData.data[index + 2],
                        a: imageData.data[index + 3],
                    };
                    if (rgba.a > ALPHA_IGNORE_LEVEL && (c === null || rgba.r !== c.r || rgba.g !== c.g || rgba.b !== c.b)) {
                        return false;
                    }
                }
                return true;
            }

            function isVerticalLineBlank(imageData, h, c, x) {
                let stepSize = Math.max(1, parseInt(h / STEP_COUNT));
                for (let y = 0; y < h; y += stepSize) {
                    const index = (y * imageData.width + x) * 4; // RGBA index
                    const rgba = {
                        r: imageData.data[index],
                        g: imageData.data[index + 1],
                        b: imageData.data[index + 2],
                        a: imageData.data[index + 3],
                    };
                    if (rgba.a > ALPHA_IGNORE_LEVEL && (c === null || rgba.r !== c.r || rgba.g !== c.g || rgba.b !== c.b)) {
                        return false;
                    }
                }
                return true;
            }

            function findLeft(imageData, w, h, c) {
                const halfWidth = w / 2;
                const stepSize = Math.max(1, parseInt(w / STEP_COUNT));
                for (let x = 0; x < halfWidth; x += stepSize) {
                    if (!isVerticalLineBlank(imageData, h, c, x)) {
                        for (; x > 0; x--) {
                            if (isVerticalLineBlank(imageData, h, c, x)) {
                                x++;
                                break;
                            }
                        }
                        return x;
                    }
                }
                return 0;
            }

            function findRight(imageData, w, h, c) {
                const halfWidth = w / 2;
                const stepSize = Math.max(1, parseInt(w / STEP_COUNT));
                for (let x = w; x > halfWidth; x -= stepSize) {
                    if (!isVerticalLineBlank(imageData, h, c, x)) {
                        for (; x < w; x++) {
                            if (isVerticalLineBlank(imageData, h, c, x)) {
                                x--;
                                break;
                            }
                        }
                        return x;
                    }
                }
                return w;
            }

            function findTop(imageData, w, h, c) {
                const halfHeight = h / 2;
                const stepSize = Math.max(1, parseInt(h / STEP_COUNT));
                for (let y = 0; y < halfHeight; y += stepSize) {
                    if (!isHorizontalLineBlank(imageData, w, c, y)) {
                        for (; y > 0; y--) {
                            if (isHorizontalLineBlank(imageData, w, c, y)) {
                                y++;
                                break;
                            }
                        }
                        return y;
                    }
                }
                return 0;
            }

            function findBottom(imageData, w, h, c) {
                const halfHeight = h / 2;
                const stepSize = Math.max(1, parseInt(h / STEP_COUNT));
                for (let y = h; y > halfHeight; y -= stepSize) {
                    if (!isHorizontalLineBlank(imageData, w, c, y)) {
                        for (; y < h; y++) {
                            if (isHorizontalLineBlank(imageData, w, c, y)) {
                                y--;
                                break;
                            }
                        }
                        return y;
                    }
                }
                return h;
            }

            function findLimits(imageData, w, h, c) {
                const top = findTop(imageData, w, h, c);
                const left = findLeft(imageData, w, h, c);
                const right = findRight(imageData, w, h, c);
                const bottom = findBottom(imageData, w, h, c);
                return { top, left, right, bottom }
            }

            function dataURLFromImageBitmap(canvas) {
                return canvas.convertToBlob().then(blob => {
                    return new Promise((resolve, reject) => {
                        const reader = new FileReader()
                        reader.onloadend = () => resolve(reader.result)
                        reader.onerror = reject
                        reader.readAsDataURL(blob)
                    })
                })
            }
        `], { type: 'application/javascript' })))

        for (const method of ['transform', 'colors']) {
            main.on('imp-'+ method, (uid, ...args) => {
                this.worker.postMessage({ method, args: [...args], id: uid })
            })
        }

        this.worker.onmessage = (e) => {
            const { id, result, error } = e.data
            if (error) {
                main.emit('imp-response-'+ id, error)
            } else {
                main.emit('imp-response-'+ id, null, result)
            }
        }
    }
}
