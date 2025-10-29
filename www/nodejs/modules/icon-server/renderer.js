export class ImageProcessor {
    constructor(main) {
        this.main = main;
        this.worker = null;
        this.activeRequests = new Map();
        this.requestCounter = 0;
        
        this.createWorker();
        
        // Cleanup on main destroy
        this.main.on('destroy', () => {
            this.destroy();
        });
    }
    
    createWorker() {
        if (this.worker) {
            this.destroyWorker();
        }
        
        this.worker = new Worker(URL.createObjectURL(new Blob([`

            const ALPHA_IGNORE_LEVEL = 255 * 0.1; // More strict - only consider truly transparent pixels (alpha < 10%)
            const STEP_COUNT = 72;
            const DEBUG = false;
            const MAX_DIMENSION = 512;
            const MIN_CROP_SIZE = 16; // Minimum size to prevent tiny images
            
            // Memory pool for reusable objects
            const memoryPool = {
                rgbaObjects: [],
                getRgba: () => memoryPool.rgbaObjects.pop() || { r: 0, g: 0, b: 0, a: 0 },
                returnRgba: (obj) => memoryPool.rgbaObjects.push(obj)
            };
            
            // Adaptive sampling based on image size
            function getAdaptiveStepSize(width, height) {
                const totalPixels = width * height;
                if (totalPixels <= 64 * 64) return 1; // Small images: full scan
                if (totalPixels <= 256 * 256) return 2; // Medium images: 2x sampling
                if (totalPixels <= 512 * 512) return 4; // Large images: 4x sampling
                return Math.max(4, Math.floor(Math.sqrt(totalPixels) / 50)); // Very large: adaptive
            }

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
                const dominantColors = await getLazyFunction('dominantColors', () => getDominantColors)(imageData, count)
                return dominantColors
            }

            self.hasTransparency = async function(url) {
                DEBUG && console.log('Checking transparency for URL:', url)
                const { imageData } = await loadImageData(url, 128, 128) // Small size for speed
                return await isAlpha(imageData)
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
                        const { croppedImage, changed } = await getLazyFunction('autocrop', () => autocrop)(canvas, ctx, alpha, imageData)
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
                return dataURLFromImageBitmap(canvas)
            }

            async function loadImageData(url, width, height) {
                if (typeof(url) !== 'string') return url
                
                // Add browser-like headers to bypass hotlink protection
                const headers = {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
                    'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
                    'Accept-Language': 'en-US,en;q=0.9,pt;q=0.8',
                    'Accept-Encoding': 'gzip, deflate, br',
                    'Cache-Control': 'no-cache',
                    'Pragma': 'no-cache',
                    'Sec-Fetch-Dest': 'image',
                    'Sec-Fetch-Mode': 'no-cors',
                    'Sec-Fetch-Site': 'cross-site',
                    'Sec-Ch-Ua': '"Not A(Brand";v="99", "Google Chrome";v="121", "Chromium";v="121"',
                    'Sec-Ch-Ua-Mobile': '?0',
                    'Sec-Ch-Ua-Platform': '"Windows"',
                    'DNT': '1',
                    'Connection': 'keep-alive',
                    'Upgrade-Insecure-Requests': '1'
                };
                
                // Add specific referer based on domain
                try {
                    const urlObj = new URL(url);
                    const domain = urlObj.hostname;
                    
                    if (domain.includes('github.com') || domain.includes('raw.githubusercontent.com')) {
                        headers['Referer'] = 'https://github.com/';
                    } else if (domain.includes('imgur.com') || domain.includes('i.imgur.com')) {
                        headers['Referer'] = 'https://imgur.com/';
                    } else if (domain.includes('wikipedia.org') || domain.includes('wikimedia.org')) {
                        headers['Referer'] = 'https://www.wikipedia.org/';
                    } else {
                        headers['Referer'] = urlObj.origin + '/';
                    }
                } catch (e) {
                    // If URL parsing fails, use a generic referer
                    headers['Referer'] = 'https://www.google.com/';
                }
                
                const response = await fetch(url, { headers })
                if (!response.ok) {

                    throw new Error(\`Error fetching image: \${response.statusText} - \${url}\`)
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
                const colorMap = new Map()
                const { data, width, height } = imageData
                const stepSize = getAdaptiveStepSize(width, height)
                
                // Use TypedArray for better performance
                const dataView = new Uint8Array(data)
                
                // Sample pixels with adaptive step size
                for (let y = 0; y < height; y += stepSize) {
                    for (let x = 0; x < width; x += stepSize) {
                        const index = (y * width + x) * 4
                        // Create numeric key instead of string for better performance
                        const rgbKey = (dataView[index] << 16) | (dataView[index + 1] << 8) | dataView[index + 2]
                        
                        const count = colorMap.get(rgbKey) || 0
                        colorMap.set(rgbKey, count + 1)
                    }
                }

                // Convert to array and sort
                const colorsArray = Array.from(colorMap.entries())
                    .map(([rgbKey, count]) => {
                        const r = (rgbKey >> 16) & 0xFF
                        const g = (rgbKey >> 8) & 0xFF
                        const b = rgbKey & 0xFF
                        return { color: \`rgb(\${r},\${g},\${b})\`, count }
                    })
                    .sort((a, b) => b.count - a.count)

                return colorsArray.slice(0, colorCount).map(c => c.color)
            }

            async function autocrop(canvas, ctx, alpha, imageData) {
                DEBUG && console.log('autocrop1')
                const { width, height } = canvas
                DEBUG && console.log('autocrop3', width, height)
                const backgroundColor = null // Keep transparency for all images
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
                const stepSize = Math.max(1, Math.floor(w / STEP_COUNT));
                const dataView = new Uint8Array(imageData.data);
                
                for (let x = 0; x < w; x += stepSize) {
                    const index = (y * w + x) * 4;
                    const alpha = dataView[index + 3];
                    
                    if (alpha > ALPHA_IGNORE_LEVEL) {
                        if (c === null) return false;
                        
                        // Direct comparison without object creation
                        const r = dataView[index];
                        const g = dataView[index + 1];
                        const b = dataView[index + 2];
                        
                        if (r !== c.r || g !== c.g || b !== c.b) {
                            return false;
                        }
                    }
                }
                return true;
            }

            function isVerticalLineBlank(imageData, h, c, x) {
                const stepSize = Math.max(1, Math.floor(h / STEP_COUNT));
                const dataView = new Uint8Array(imageData.data);
                const width = imageData.width;
                
                for (let y = 0; y < h; y += stepSize) {
                    const index = (y * width + x) * 4;
                    const alpha = dataView[index + 3];
                    
                    if (alpha > ALPHA_IGNORE_LEVEL) {
                        if (c === null) return false;
                        
                        // Direct comparison without object creation
                        const r = dataView[index];
                        const g = dataView[index + 1];
                        const b = dataView[index + 2];
                        
                        if (r !== c.r || g !== c.g || b !== c.b) {
                            return false;
                        }
                    }
                }
                return true;
            }

            function findLeft(imageData, w, h, c) {
                const halfWidth = Math.floor(w / 2);
                const stepSize = Math.max(1, Math.floor(w / STEP_COUNT));
                
                for (let x = 0; x < halfWidth; x += stepSize) {
                    if (!isVerticalLineBlank(imageData, h, c, x)) {
                        // Fine-tune to exact position
                        for (; x > 0; x--) {
                            if (isVerticalLineBlank(imageData, h, c, x)) {
                                x++;
                                break;
                            }
                        }
                        // Ensure minimum crop size for safety
                        return Math.max(0, Math.min(x, w - MIN_CROP_SIZE));
                    }
                }
                return 0;
            }

            function findRight(imageData, w, h, c) {
                const halfWidth = Math.floor(w / 2);
                const stepSize = Math.max(1, Math.floor(w / STEP_COUNT));
                
                for (let x = w - 1; x > halfWidth; x -= stepSize) {
                    if (!isVerticalLineBlank(imageData, h, c, x)) {
                        // Fine-tune to exact position
                        for (; x < w; x++) {
                            if (isVerticalLineBlank(imageData, h, c, x)) {
                                x--;
                                break;
                            }
                        }
                        // Ensure minimum crop size for safety
                        return Math.min(w, Math.max(x, MIN_CROP_SIZE));
                    }
                }
                return w;
            }

            function findTop(imageData, w, h, c) {
                const halfHeight = Math.floor(h / 2);
                const stepSize = Math.max(1, Math.floor(h / STEP_COUNT));
                
                for (let y = 0; y < halfHeight; y += stepSize) {
                    if (!isHorizontalLineBlank(imageData, w, c, y)) {
                        // Fine-tune to exact position
                        for (; y > 0; y--) {
                            if (isHorizontalLineBlank(imageData, w, c, y)) {
                                y++;
                                break;
                            }
                        }
                        // Ensure minimum crop size for safety
                        return Math.max(0, Math.min(y, h - MIN_CROP_SIZE));
                    }
                }
                return 0;
            }

            function findBottom(imageData, w, h, c) {
                const halfHeight = Math.floor(h / 2);
                const stepSize = Math.max(1, Math.floor(h / STEP_COUNT));
                
                for (let y = h - 1; y > halfHeight; y -= stepSize) {
                    if (!isHorizontalLineBlank(imageData, w, c, y)) {
                        // Fine-tune to exact position
                        for (; y < h; y++) {
                            if (isHorizontalLineBlank(imageData, w, c, y)) {
                                y--;
                                break;
                            }
                        }
                        // Ensure minimum crop size for safety
                        return Math.min(h, Math.max(y, MIN_CROP_SIZE));
                    }
                }
                return h;
            }

            function findLimits(imageData, w, h, c) {
                const top = findTop(imageData, w, h, c);
                const left = findLeft(imageData, w, h, c);
                const right = findRight(imageData, w, h, c);
                const bottom = findBottom(imageData, w, h, c);
                
                // Safety validation: ensure minimum crop size
                const cropWidth = right - left;
                const cropHeight = bottom - top;
                
                if (cropWidth < MIN_CROP_SIZE || cropHeight < MIN_CROP_SIZE) {
                    // Return original dimensions if crop would be too small
                    return { top: 0, left: 0, right: w, bottom: h };
                }
                
                return { top, left, right, bottom };
            }
            
            // Lazy loading for heavy functions
            const lazyFunctions = {
                dominantColors: null,
                autocrop: null
            };
            
            function getLazyFunction(name, factory) {
                if (!lazyFunctions[name]) {
                    lazyFunctions[name] = factory();
                }
                return lazyFunctions[name];
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

        for (const method of ['transform', 'colors', 'hasTransparency']) {
            this.main.on('imp-'+ method, (uid, ...args) => {
                if (this.worker && !this.destroyed) {
                    this.activeRequests.set(uid, { method, args, timestamp: Date.now() });
                    this.worker.postMessage({ method, args: [...args], id: uid })
                } else {
                    this.main.emit('imp-response-'+ uid, new Error('Worker destroyed'))
                }
            })
        }

        this.worker.onmessage = (e) => {
            const { id, result, error } = e.data
            this.activeRequests.delete(id);
            
            if (error) {
                this.main.emit('imp-response-'+ id, error)
            } else {
                this.main.emit('imp-response-'+ id, null, result)
            }
        }
        
        this.worker.onerror = (error) => {
            console.error('ImageProcessor worker error:', error);
            // Recreate worker on error
            this.createWorker();
        };
    }
    
    destroyWorker() {
        if (this.worker) {
            // Reject all pending requests
            for (const [id, request] of this.activeRequests) {
                this.main.emit('imp-response-'+ id, new Error('Worker destroyed'));
            }
            this.activeRequests.clear();
            
            this.worker.terminate();
            this.worker = null;
        }
    }
    
    destroy() {
        if (this.destroyed) return;
        this.destroyed = true;
        
        this.destroyWorker();
        
        // Clear references
        this.main = null;
        this.activeRequests = null;
        this.requestCounter = 0;
        
        // Remove all event listeners
        this.removeAllListeners();
        
        // Force garbage collection if available
    }
}
