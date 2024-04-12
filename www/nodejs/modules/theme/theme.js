const { EventEmitter } = require('events')

class Theme extends EventEmitter {
    constructor(){
        super()

        const { data } = require('../paths')
        this.backgroundVideoSizeLimit = 40 * (1024 * 1024)
        this.customBackgroundImagePath = data +'/background.png'
        this.customBackgroundVideoPath = data +'/background'
        this.keys = [
            'theme-name', 'animate-background', 'background-color', 
            'background-color-transparency', 'custom-background-image', 
            'custom-background-video', 'font-color', 'font-family', 
            'font-size', 'uppercase-menu', 'view-size-x', 'view-size-y', 
            'view-size-portrait-x', 'view-size-portrait-y', 'fx-nav-intensity'
        ]
        this.folder = data +'/Themes'
        global.rendererReady(() => {
            this.refresh()
            global.menu.on('render', (entries, path) => {
                if(path == [global.lang.TOOLS, global.lang.THEMES].join('/')){
                    delete this.creatingThemeName
                }
            })
        })
        global.renderer.on('theme-creating-name', name => {
            if(name && name != global.lang.DEFAULT){
                this.creatingThemeName = name
            } else if(!this.creatingThemeName) {
                this.creatingThemeName = 'Untitled' 
            }
            const prevName = global.config.get('theme-name')
            if(this.creatingThemeName != prevName){
                global.config.set('theme-name', this.creatingThemeName)
                this.save(() => {
                    const fs = require('fs')
                    const ffile = this.folder +'/'+ global.sanitize(prevName) + '.theme.json'
                    fs.unlink(ffile, () => {})
                })
                if(prevName && global.menu.path.indexOf(prevName) != -1 && global.menu.path.indexOf(global.lang.CREATE_THEME) == -1){
                    global.menu.open(global.menu.path.replace(prevName, this.creatingThemeName)).catch(displayErr)
                }
            }
        })
    }
    colors(file, filter, limit){
        return new Promise((resolve, reject) => {
            const fs = require('fs')
            global.osd.show(global.lang.PROCESSING, 'fa-mega spin-x-alt', 'theme-processing-colors', 'persistent')
            fs.stat(file, (err, stat) => {
                if(stat && stat.size){
                    const key = 'colors-' + global.menu.basename(file) + '-' + stat.size, next = colors => {
                        global.osd.hide('theme-processing-colors')
                        if(typeof(filter) == 'function'){
                            colors = colors.filter(filter)
                        }
                        if(typeof(limit) == 'number'){
                            colors = colors.slice(0, limit)
                        }
                        resolve(colors)
                    }
                    global.storage.get(key, content => {
                        if(Array.isArray(content)){
                            next(content)
                        } else {
                            const jimp = require('../jimp-worker/main')
                            jimp.colors(file).then(colors => {
                                global.storage.set(key, colors, {expiration: true})
                                next(colors)
                            }).catch(err => {
                                console.error(err)
                                next([])
                            })
                        }
                    })
                } else {
                    resolve([])
                    global.osd.hide('theme-processing-colors')
                }
            })
        })
    }
    colorsIncludes(colors, color){
        let i = colors.findIndex(x => x.r == color.r && x.g == color.g && x.b == color.b)
        return i >= 0
    }
    colorsAddDefaults(colors, light){
        if(light){
            const white = {r: 255, g: 255, b: 255}, f = this.hexToRgb(config.defaults['font-color'])
            if(!this.colorsIncludes(colors, f)){
                colors.unshift(f)
            }
            if(!this.colorsIncludes(colors, white)){
                colors.unshift(white)
            }
        } else {
            const black = {r: 0, g: 0, b: 0}, b = this.hexToRgb(config.defaults['background-color'])
            if(!this.colorsIncludes(colors, b)){
                colors.unshift(b)
            }
            if(!this.colorsIncludes(colors, black)){
                colors.unshift(black)
            }
        }
        return colors
    }
    colorLightLevel(color){
        let n = 0
        Object.values(color).forEach(v => {
            n += v
        })
        return (n / (255 * 3)) * 100
    }
    async importBackgroundImage(file){
        global.renderer.emit('set-loading', {name: global.lang.CHOOSE_BACKGROUND_IMAGE}, true, global.lang.PROCESSING)
        global.osd.show(global.lang.PROCESSING, 'fas fa-cog fa-spin', 'theme-upload', 'persistent')
        try {
            const fs = require('fs')
            await fs.promises.copyFile(file, this.customBackgroundImagePath)
            console.warn('!!! IMPORT CUSTOM BACKGROUND FILE !!!', menu.path, file, this.customBackgroundImagePath)
            global.config.set('custom-background-image', this.customBackgroundImagePath)
            global.config.set('custom-background-video', '')
            this.update()
            global.menu.open([global.lang.TOOLS, global.lang.THEMES, global.lang.CREATE_THEME, global.lang.BACKGROUND, global.lang.BACKGROUND_COLOR].join('/')).catch(displayErr)
        } catch(err) {
            global.displayErr(err)
        }
        global.renderer.emit('set-loading', {name: global.lang.CHOOSE_BACKGROUND_IMAGE}, false)
        global.osd.hide('theme-upload')
    }
    async importBackgroundVideo(file){
        global.renderer.emit('set-loading', {name: global.lang.CHOOSE_BACKGROUND_VIDEO}, true, global.lang.PROCESSING)
        global.osd.show(global.lang.PROCESSING, 'fas fa-cog fa-spin', 'theme-upload', 'persistent')
        try {
            const fs = require('fs')
            const targetFile = this.customBackgroundVideoPath +'-'+ uid + '.mp4'
            const stat = await fs.promises.stat(file)
            const tooBig = stat && stat.size >= this.backgroundVideoSizeLimit
            if(tooBig) throw 'This video file is too big. Limit it to 40MB at least.'
            await fs.promises.copyFile(file, targetFile)
            console.warn('!!! IMPORT CUSTOM BACKGROUND FILE !!!', menu.path, file, targetFile)
            global.config.set('custom-background-video', targetFile)
            global.config.set('custom-background-image', '')
            if(global.config.get('background-color') == global.config.defaults['background-color']){
                global.config.set('background-color', '#000000')
            }
            this.update()
            this.cleanVideoBackgrounds(targetFile)
            global.osd.show(global.lang.BACKGROUND_VIDEO_BLACK_SCREEN_HINT, 'fas fa-info-circle', 'theme-upload-hint', 'long')
            global.menu.open([global.lang.TOOLS, global.lang.THEMES, global.lang.CREATE_THEME, global.lang.BACKGROUND, global.lang.BACKGROUND_COLOR].join('/')).catch(displayErr)
        } catch(err) {
            global.displayErr(err)
        }
        global.renderer.emit('set-loading', {name: global.lang.CHOOSE_BACKGROUND_VIDEO}, false)
        global.osd.hide('theme-upload')
    }
    cleanVideoBackgrounds(currentFile){
        const fs = require('fs')
        const path = require('path')
        const dir = path.dirname(currentFile), name = path.basename(currentFile)
        fs.readdir(dir, (err, files) => {
            if(files){
                files.forEach(file => {
                    if(file.startsWith('background') && file != name && file.substr(-4) == '.mp4'){
                        fs.unlink(path.join(dir, file), () => {})
                    }
                })
            }
        })
    }
    themesEntries(cb){
        const themes = {}
        const fs = require('fs')
        fs.readdir(this.folder, async (err, files) => {
            if(err){
                fs.mkdir(this.folder, {recursive: true}, () => {})
            } else {
                const promises = files.filter(file => file.substr(-4) != '.tmp').map(file => {
                    return async () => {
                        let err, ffile = this.folder +'/'+ file
                        let content = await fs.promises.readFile(ffile)
                        let n = file.replace('.theme.json', '')
                        if(err){
                            global.displayErr('Failed to open theme: '+ n)
                        } else {
                            let e
                            try {
                                e = global.parseJSON(String(content))
                                if(e){
                                    themes[ffile] = Object.assign({'theme-name': n}, e)
                                }
                            } catch(err) {
                                console.error(err, e, content, ffile)
                                global.displayErr('Failed to parse theme: '+ n)
                                delete themes[ffile]
                            }
                        }
                    }
                })
                await Promise.allSettled(promises)
            }
            let def = global.config.get('theme-name'), defLabel = '<i class="fas fa-check-circle"></i> '+ global.lang.ENABLED
            let entries = Object.keys(themes).map(ffile => {
                return {
                    name: themes[ffile]['theme-name'],
                    details: def == themes[ffile]['theme-name'] ? defLabel : '',
                    fa: 'fas fa-palette',
                    prepend: '<i class="fas fa-circle" style="color: '+ themes[ffile]['background-color'] +'"></i> ',
                    type: 'select',
                    entries: [
                        {
                            name: global.lang.APPLY,
                            type: 'action',
                            fa: 'fas fa-check-circle',
                            action: () => {
                                this.load(ffile, () => {
                                    global.menu.refreshNow()
                                })
                            }
                        },
                        {
                            name: global.lang.EDIT,
                            type: 'action',
                            fa: 'fas fa-edit',
                            action: () => {
                                this.load(ffile, () => {
                                    this.creatingThemeName = themes[ffile]['theme-name']
                                    global.menu.open([global.lang.TOOLS, global.lang.THEMES, global.lang.CREATE_THEME].join('/')).catch(displayErr)                                
                                })
                            }
                        },
                        {
                            name: global.lang.EXPORT,
                            type: 'action',
                            fa: 'fas fa-file-export',
                            action: () => {
                                const downloads = require('../downloads')
                                downloads.serve(ffile, true, false).catch(global.displayErr)
                            }
                        },
                        {
                            name: global.lang.REMOVE,
                            type: 'action',
                            fa: 'fas fa-trash',
                            action: () => {
                                if(themes[ffile]['theme-name'] == global.config.get('theme-name')){
                                    this.reset()
                                }
                                
                                const fs = require('fs')
                                fs.unlink(ffile, () => {
                                    global.menu.refreshNow()
                                })
                            }
                        }
                    ]
                }
            })
            entries = entries.sortByProp('name')
            entries.unshift({
                name: global.lang.DEFAULT,
                details: [global.lang.DEFAULT, ''].includes(def) ? defLabel : '',
                fa: 'fas fa-palette',
                prepend: '<i class="fas fa-circle" style="color: '+ global.config.defaults['background-color'] +'"></i> ',
                type: 'action',
                action: () => {
                    this.reset()
                    global.menu.refreshNow()
                }
            })
            cb(entries)
        })
    }
	componentToHex(c) {
		const hex = c.toString(16);
		return hex.length == 1 ? '0' + hex : hex
	}
	hexToRgb(ohex) {
		const shorthandRegex = /^#?([a-f\d])([a-f\d])([a-f\d])$/i, hex = ohex.replace(shorthandRegex, (m, r, g, b) => {
			return r + r + g + g + b + b
		})
		const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex)
		return result ? {
			r: parseInt(result[1], 16),
			g: parseInt(result[2], 16),
			b: parseInt(result[3], 16)
		} : ohex
	}
    rgbToHex(r, g, b) {
		return '#'+ this.componentToHex(r) + this.componentToHex(g) + this.componentToHex(b)
	}
    async rename(name){
        await global.menu.prompt({
            question: global.lang.THEME_NAME,
            placeholder: '',
            defaultValue: name || '',
            callback: 'theme-creating-name',
            fa: 'fas fa-palette'
        })
    }
    entries(){
        return new Promise((resolve, reject) => {
            this.themesEntries(entries => {
                const current = global.config.get('theme-name') || global.lang.DEFAULT
                entries.push({
                    name: global.lang.CREATE_THEME,
                    type: 'group',
                    fa: 'fas fa-plus-square',
                    renderer: () => {
                        return new Promise((resolve, reject) => {
                            if(!this.creatingThemeName){
                                this.rename().catch(console.error)
                            }
                            let opts = [
                                {
                                    name: global.lang.BACKGROUND,
                                    type: 'group',
                                    fa: 'fas fa-image',
                                    safe: true,
                                    entries: [
                                        {
                                            name: global.lang.ANIMATE_BACKGROUND,
                                            type: 'select',
                                            fa: 'fas fa-image',
                                            safe: true,
                                            renderer: () => {
                                                return new Promise((resolve, reject) => {
                                                    let def = global.config.get('animate-background')                                    
                                                    if(def.indexOf('-desktop') != -1){
                                                        if(global.paths.android){
                                                            def = 'none'
                                                        } else {
                                                            def = def.replace('-desktop', '')
                                                        }
                                                    }
                                                    let options = [
                                                        {
                                                            name: global.lang.STOP,
                                                            key: 'none'
                                                        }, 
                                                        {
                                                            name: global.lang.SLOW,
                                                            key: 'slow'
                                                        }, 
                                                        {
                                                            name: global.lang.FAST,
                                                            key: 'fast'
                                                        }
                                                    ].map(n => {
                                                        return {
                                                            name: n.name,
                                                            value: n.key,
                                                            type: 'action',
                                                            action: data => {
                                                                global.config.set('animate-background', n.key)
                                                                this.update()
                                                            }
                                                        }
                                                    })                                
                                                    options = options.map(p => {
                                                        p.selected = (def == p.value)
                                                        return p
                                                    })
                                                    resolve(options)
                                                })
                                            }
                                        },
                                        {
                                            name: global.lang.CHOOSE_BACKGROUND_IMAGE,
                                            type: 'action',
                                            fa: 'fas fa-image', 
                                            action: async () => {
                                                const file = await global.menu.chooseFile('image/jpeg,image/png')
                                                await this.importBackgroundImage(file)
                                            }
                                        },
                                        {
                                            name: global.lang.CHOOSE_BACKGROUND_VIDEO,
                                            details: global.lang.HTML5_COMPAT_REQUIRED,
                                            type: 'action',
                                            fa: 'fas fa-film', 
                                            action: async () => {
                                                const file = await global.menu.chooseFile('video/mp4,video/webm,video/ogg')
                                                await this.importBackgroundVideo(file)
                                            }
                                        },
                                        {
                                            name: global.lang.BACKGROUND_COLOR,
                                            type: 'group',
                                            fa: 'fas fa-palette',
                                            renderer: async () => {
                                                let hasErr, colors = await this.colors(this.customBackgroundImagePath, c => this.colorLightLevel(c) < 40, 52).catch(err => hasErr = err)
                                                global.osd.hide('theme-upload')
                                                global.renderer.emit('set-loading', {name: global.lang.CHOOSE_BACKGROUND_IMAGE}, false)
                                                if(!Array.isArray(colors)) colors = []
                                                colors = this.colorsAddDefaults(colors, false).map(c => {
                                                    return this.rgbToHex.apply(null, Object.values(c))
                                                })
                                                colors = [... new Set(colors)].slice(0, 32).map((hex, i) => {
                                                    return {
                                                        name: global.lang.BACKGROUND_COLOR + ' ' +  (i + 1),
                                                        details: hex.substr(1),
                                                        type: 'action',
                                                        fa: 'fas fa-stop',
                                                        color: hex,
                                                        action: () => {
                                                            if(hex != global.config.get('background-color')){
                                                                global.config.set('background-color', hex)
                                                                this.update()
                                                            } else {    
                                                                global.menu.back()
                                                            }
                                                        }
                                                    }
                                                })
                                                colors.push({
                                                    name: lang.CUSTOMIZE,
                                                    type: 'input',
                                                    fa: 'fas fa-palette', 
                                                    value: () => global.config.get('background-color'),
                                                    action: (data, value) => {
                                                        if(String(value).match(new RegExp('^#?[0-9a-fA-F]{6}$'))){ // TypeError: value.match is not a function 
                                                            if(value.length == 6){
                                                                value = '#' + value
                                                            }
                                                            global.config.set('background-color', value)     
                                                            this.update() 
                                                            global.menu.back()                                  
                                                        } else {
                                                            global.displayErr(global.lang.INCORRECT_FORMAT)
                                                        }
                                                    }
                                                })
                                                return colors
                                            },
                                            value: () => {
                                                return global.config.get('background-color')
                                            },
                                            placeholder: '#000000'
                                        },
                                        {
                                            name: global.lang.BACKGROUND_COLOR_TRANSPARENCY, 
                                            type: 'slider', 
                                            fa: 'fas fa-adjust',
                                            range: {start: 1, end: 100},
                                            action: (data, value) => {
                                                console.warn('BACKGROUND_COLOR_TRANSPARENCY', data, value)
                                                global.config.set('background-color-transparency', value)
                                                this.update()
                                            }, 
                                            value: () => {
                                                return global.config.get('background-color-transparency')
                                            }
                                        }
                                    ]
                                },
                                {
                                    name: global.lang.FONT,
                                    type: 'group',
                                    fa: 'fas fa-font',
                                    entries: [
                                        {
                                            name: global.lang.FONT_COLOR,
                                            type: 'group',
                                            fa: 'fas fa-palette',
                                            renderer: () => {
                                                return new Promise((resolve, reject) => {
                                                    this.colors(this.customBackgroundImagePath, c => this.colorLightLevel(c) > 70, 32).then(colors => {
                                                        colors = this.colorsAddDefaults(colors, true).map((c, i) => {
                                                            let hex = this.rgbToHex.apply(null, Object.values(c))
                                                            return {
                                                                name: global.lang.FONT_COLOR + ' ' +  (i + 1),
                                                                type: 'action',
                                                                fa: 'fas fa-stop',
                                                                color: hex,
                                                                action: () => {
                                                                    let cc = hex
                                                                    if(cc != global.config.get('font-color')){
                                                                        global.config.set('font-color', cc)
                                                                        this.update()
                                                                    } else {    
                                                                        global.menu.back()
                                                                    }
                                                                }
                                                            }
                                                        })
                                                        colors.push({
                                                            name: lang.CUSTOMIZE,
                                                            type: 'input',
                                                            fa: 'fas fa-palette', 
                                                            value: () => global.config.get('font-color'),
                                                            action: (data, value) => {
                                                                if(value && value.match(new RegExp('^#?[0-9a-fA-F]{6}$'))){
                                                                    if(value.length == 6){
                                                                        value = '#' + value
                                                                    }
                                                                    global.config.set('font-color', value)     
                                                                    this.update() 
                                                                    global.menu.back()                                  
                                                                } else {
                                                                    global.displayErr(global.lang.INCORRECT_FORMAT)
                                                                }
                                                            }
                                                        }),
                                                        resolve(colors)
                                                    }).catch(err => {
                                                        console.error(err)
                                                        reject(err)
                                                        global.menu.back()
                                                    }).finally(() => {
                                                        global.osd.hide('theme-upload')
                                                        global.renderer.emit('set-loading', {name: global.lang.CHOOSE_BACKGROUND_IMAGE}, false)
                                                    })
                                                })
                                            },
                                            value: () => {
                                                return global.config.get('font-color')
                                            },
                                            placeholder: '#FFFFFF'
                                        },
                                        {
                                            name: global.lang.FONT_FAMILY, 
                                            type: 'select',
                                            fa: 'fas fa-font',            
                                            renderer: () => {
                                                return new Promise((resolve, reject) => {
                                                    global.renderer.on('fontlist', list => {
                                                        global.renderer.removeAllListeners('fontlist')
                                                        resolve(list.map(name => {
                                                            return {name, type: 'action', action: () => {
                                                                console.warn('CHOSEN FONT', name)
                                                                global.config.set('font-family', name)
                                                                this.update()
                                                            }}
                                                        }))
                                                    })
                                                    global.renderer.emit('fontlist')
                                                })
                                            }
                                        },
                                        {
                                            name: global.lang.UPPERCASE_LETTERS_MENU, 
                                            type: 'check', 
                                            action: (data, value) => {
                                                global.config.set('uppercase-menu', value)
                                                this.update()
                                            }, 
                                            checked: () => {
                                                return global.config.get('uppercase-menu')
                                            }
                                        },
                                        {
                                            name: global.lang.FONT_SIZE, 
                                            type: 'slider', 
                                            fa: 'fas fa-text-width',
                                            range: {start: 1, end: 10},
                                            action: (data, value) => {
                                                console.warn('FONT_SIZE', data, value)
                                                global.config.set('font-size', value)
                                                this.update()
                                            }, 
                                            value: () => {
                                                return global.config.get('font-size')
                                            }
                                        }
                                    ]
                                },
                                {name: global.lang.RENAME, fa: 'fas fa-edit', type: 'action', action: () => this.rename(global.config.get('theme-name')).catch(console.error)},
                                {name: global.lang.LAYOUT_GRID_SIZE, fa: 'fas fa-th', type: 'group', renderer: this.gridLayoutEntries.bind(this)},
                                {
                                    name: 'FX Navigation Intensity',
                                    fa: 'fas fa-film',
                                    type: 'slider', 
                                    range: {start: 0, end: 10},
                                    action: (data, value) => {
                                        global.config.set('fx-nav-intensity', value)
                                        this.update()
                                    }, 
                                    value: () => {
                                        return global.config.get('fx-nav-intensity')
                                    }
                                }
                            ]
                            resolve(opts)
                        })
                    }
                })
                entries.push({
                    name: global.lang.IMPORT,
                    type: 'action',
                    fa: 'fas fa-file-import', 
                    action: async () => {
                        const fs = require('fs')
                        const file = await global.menu.chooseFile('application/json')
                        const options = require('../options')
                        options.importConfigFile(await fs.promises.readFile(file), this.keys, () => {
                            global.menu.refreshNow()
                        })
                    }
                })
                entries.push({
                    name: global.lang.MORE_THEMES,
                    type: 'group',
                    fa: 'fas fa-download', 
                    renderer: () => this.remoteThemes().catch(console.error)
                })
                resolve(entries)
            })
        })
    }
    applyRemoteTheme(url, name='Untitled'){
        const fs = require('fs')
        const file = this.folder +'/'+ global.sanitize(name) + '.theme.json'
        fs.stat(file, (err, stat) => {
            const next = () => {
                global.osd.show(global.lang.LOADING +' 0%', 'fas fa-download', 'theme', 'persistent')
                global.Download.file({
                    debug: false,
                    file,
                    url,
                    progress: p => {
                        global.osd.show(global.lang.LOADING +' '+ p +'%', 'fas fa-download', 'theme', 'persistent')
                    },
                    cacheTTL: 24 * 3600
                }).then(file => {
                    global.osd.hide('theme')
                    this.load(file, err => err && fs.unlink(file, () => {}))
                    global.menu.refreshNow()
                }).catch(global.displayErr)
            }
            if(stat && stat.size){
                fs.unlink(file, next)
            } else {
                next()
            }
        })
    }
    async remoteThemes(){
        const { server } = require('../cloud')
        let themes = await global.Download.get({url: server +'/themes/feed.json', responseType: 'json'})
        if(Array.isArray(themes)){
            return themes.map(t => {
                return {
                    name: t.name,
                    details: t.author,
                    type: 'action',
                    fa: 'fas fa-palette',
                    icon: t.icon,
                    class: 'entry-icon-no-fallback',
                    action: () => {
                        this.applyRemoteTheme(t.url, t.name)
                    }
                }
            })
        }
        return []
    }
    async gridLayoutEntries(){
        return [
            {
                name: global.lang.LANDSCAPE_MODE, 
                type: 'group', 
                fa: 'fas fa-grip-horizontal', 
                entries: [
                    {
                        name: global.lang.HORIZONTAL, 
                        type: 'slider', 
                        fa: 'fas fa-ruler-horizontal', 
                        value: () => {
                            return global.config.get('view-size-x')
                        }, 
                        range: {start: 1, end: 10},
                        action: (data, value) => {
                            console.log('gridLayoutX', data, value)
                            if(value != global.config.get('view-size-x')){
                                global.config.set('view-size-x', value)
                                this.update()
                            }
                        }
                    },
                    {
                        name: global.lang.VERTICAL, 
                        type: 'slider', 
                        fa: 'fas fa-ruler-vertical', 
                        value: () => {
                            return global.config.get('view-size-y')
                        }, 
                        range: {start: 1, end: 8}, 
                        action: (data, value) => {
                            console.log('gridLayoutY', data, value)
                            if(value != global.config.get('view-size-y')){
                                global.config.set('view-size-y', value)
                                this.update()
                            }
                        }
                    }
                ]
            },
            {
                name: global.lang.PORTRAIT_MODE, 
                type: 'group', 
                fa: 'fas fa-grip-vertical', 
                entries: [
                    {
                        name: global.lang.HORIZONTAL, 
                        type: 'slider', 
                        fa: 'fas fa-ruler-horizontal', 
                        range: {start: 1, end: 4}, 
                        value: () => {
                            return global.config.get('view-size-portrait-x')
                        }, 
                        action: (data, value) => {
                            console.log('gridLayoutX', data, value)
                            if(value != global.config.get('view-size-portrait-x')){
                                global.config.set('view-size-portrait-x', value)
                                this.update()
                            }
                        }
                    },
                    {
                        name: global.lang.VERTICAL, 
                        type: 'slider', 
                        fa: 'fas fa-ruler-vertical',
                        range: {start: 1, end: 10}, 
                        value: () => {
                            return global.config.get('view-size-portrait-y')
                        }, 
                        action: (data, value) => {
                            console.log('gridLayoutY', data, value)
                            if(value != global.config.get('view-size-portrait-y')){
                                global.config.set('view-size-portrait-y', value)
                                this.update()
                            }
                        }
                    }
                ]
            }
        ]
    }
    refresh(){
        let bgi = global.config.get('custom-background-image'), bgv = global.config.get('custom-background-video')
        if(bgv) {
            bgi = ''
            bgv = global.renderer.serve(bgv)
        } else if(bgi){
            bgi = global.renderer.serve(bgi)
            bgv = ''
        } else {
            bgi = bgv = ''
        }
        global.renderer.emit('theme-update', bgi, bgv, global.config.get('background-color'), global.config.get('font-color'), global.config.get('animate-background'))
    }
    reset(){
        let natts = {}
        this.keys.forEach(k => {
            natts[k] = global.config.defaults[k]
        })
        global.config.setMulti(natts)
        this.refresh()
    }
    load(file, cb){
        const fs = require('fs')
        fs.readFile(file, (err, data) => {
            const next = err => typeof(cb) == 'function' && cb(err)
            if(err){
                global.displayErr(err)
                next(err)
            } else {
                global.config.set('custom-background-image', '')
                global.config.set('custom-background-video', '')

                const options = require('../options')
                options.importConfigFile(data, this.keys, next)
            }
        })
    }
    update(cb){
        this.save(cb)
        this.refresh()
    }
    save(cb){
        const current = global.config.get('theme-name')
        if(current){
            const filename = global.sanitize(current) + '.theme.json', file = this.folder +'/'+ filename
            const options = require('../options')
            options.prepareExportConfigFile(file +'.tmp', null, this.keys, err => {
                if(err){
                    global.displayErr(err)
                    if(typeof(cb) == 'function'){
                        cb()
                    }
                } else {
                    global.moveFile(file +'.tmp', file, err => {
                        if(err){
                            global.displayErr(err)
                        }
                        if(typeof(cb) == 'function'){
                            cb()
                        }
                    })
                }
            })
        } else {
            if(typeof(cb) == 'function'){
                cb()
            }
        }
    }
    hook(entries, path){
        return new Promise((resolve, reject) => {
            if(path == global.lang.TOOLS){
                entries.splice(2, 0, {name: global.lang.THEMES, fa: 'fas fa-palette', type: 'group', renderer: this.entries.bind(this)})
            }
            resolve(entries)
        })
    }
}

module.exports = Theme
