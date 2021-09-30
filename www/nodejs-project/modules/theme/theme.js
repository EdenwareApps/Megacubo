
const Events = require('events'), fs = require('fs'), path = require('path'), async = require('async')

class Theme extends Events {
    constructor(){
        super()
        this.filtering = false
        this.customBackgroundImagePath = global.paths.data +'/background.png'
        this.customBackgroundVideoPath = global.paths.data +'/background.mp4'
        this.keys = ['theme-name', 'animate-background', 'background-color', 'background-color-transparency', 'custom-background-image', 'custom-background-video', 'font-color', 'font-family', 'font-size', 'uppercase-menu', 'view-size-x', 'view-size-y']
        this.folder = global.paths.data +'/Themes'
        global.ui.once('init', () => {
            this.refresh()
            global.explorer.on('render', (entries, path) => {
                if(path == [global.lang.TOOLS, global.lang.THEMES].join('/')){
                    delete this.creatingThemeName
                }
            })
        })
        global.ui.on('theme-background-image-file', this.importBackgroundImage.bind(this))
        global.ui.on('theme-background-video-file', this.importBackgroundVideo.bind(this))
        global.ui.on('theme-creating-name', name => {
            if(name && name != global.lang.DEFAULT){
                this.creatingThemeName = name
            } else if(!this.creatingThemeName) {
                this.creatingThemeName = 'Untitled' 
            }
            if(this.creatingThemeName != global.config.get('theme-name')){
                global.config.set('theme-name', this.creatingThemeName)
                this.save()
            }
        })
        global.ui.on('theme-import-file', data => {
            console.warn('!!! IMPORT FILE !!!', data)
            global.importFileFromClient(data).then(ret => global.options.importConfigFile(ret, this.keys)).catch(err => {
                global.displayErr(err)
            }).finally(() => {
                global.explorer.refresh()
            })
        })
    }
    setupFilter(){
        if(!this.filtering && global.explorer){
            this.filtering = true
            global.explorer.addFilter(this.filter)
        }
    }
    filter(es, path){
        return new Promise((resolve, reject) => {
            resolve(es.filter(e => {
                return (!e.type || e.type != 'back') && (!e.fa || e.fa != global.explorer.backIcon)
            }))
        })
    }
    colors(file, filter, limit){
        return new Promise((resolve, reject) => {
            global.osd.show(global.lang.PROCESSING, 'fa-mega spin-x-alt', 'theme-processing-colors', 'persistent')
            fs.stat(file, (err, stat) => {
                if(stat && stat.size){
                    const key = 'colors-' + global.explorer.basename(file) + '-' + stat.size, next = colors => {
                        if(typeof(filter) == 'function'){
                            colors = colors.filter(filter)
                        }
                        if(typeof(limit) == 'number'){
                            colors = colors.slice(0, limit)
                        }
                        resolve(colors)
                        global.osd.hide('theme-processing-colors')
                    }
                    global.storage.temp.get(key, content => {
                        if(Array.isArray(content)){
                            next(content)
                        } else {
                            global.jimp.colors(file).then(colors => {
                                global.storage.temp.set(key, colors, true)
                                next(colors)
                            }).catch(reject)
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
            const white = {r: 255, g: 255, b: 255}, f = global.hexToRgb(config.defaults['font-color'])
            if(!this.colorsIncludes(colors, f)){
                colors.unshift(f)
            }
            if(!this.colorsIncludes(colors, white)){
                colors.unshift(white)
            }
        } else {
            const black = {r: 0, g: 0, b: 0}, b = global.hexToRgb(config.defaults['background-color'])
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
    importBackgroundImage(data){
        global.ui.emit('set-loading', {name: global.lang.CHOOSE_BACKGROUND_IMAGE}, true, global.lang.PROCESSING)
        global.osd.show(global.lang.PROCESSING, 'fas fa-cog fa-spin', 'theme-upload', 'persistent')
        global.importFileFromClient(data, this.customBackgroundImagePath).then(ret => this.importBackgroundImageCallback(ret)).catch(err => {
            global.displayErr(err)
        }).finally(() => {
            global.ui.emit('set-loading', {name: global.lang.CHOOSE_BACKGROUND_IMAGE}, false)
            global.osd.hide('theme-upload')
        })
    }
    importBackgroundVideo(data){
        global.ui.emit('set-loading', {name: global.lang.CHANGE_BACKGROUND_VIDEO}, true, global.lang.PROCESSING)
        global.osd.show(global.lang.PROCESSING, 'fas fa-cog fa-spin', 'theme-upload', 'persistent')
        global.importFileFromClient(data, this.customBackgroundVideoPath).then(ret => this.importBackgroundVideoCallback(ret)).catch(err => {
            global.displayErr(err)
        }).finally(() => {
            global.ui.emit('set-loading', {name: global.lang.CHANGE_BACKGROUND_VIDEO}, false)
            global.osd.hide('theme-upload')
        })
    }
    importBackgroundImageCallback(err){
        console.warn('!!! IMPORT CUSTOM BACKGROUND FILE !!!', explorer.path)
        global.config.set('custom-background-image', this.customBackgroundImagePath)
        global.config.set('custom-background-video', '')
        this.update()
        global.explorer.open([global.lang.TOOLS, global.lang.THEMES, global.lang.CREATE_THEME, global.lang.BACKGROUND, global.lang.BACKGROUND_COLOR].join('/'))
    }
    importBackgroundVideoCallback(err){
        console.warn('!!! IMPORT CUSTOM BACKGROUND FILE !!!', explorer.path)
        global.config.set('custom-background-video', this.customBackgroundVideoPath)
        global.config.set('custom-background-image', '')
        this.update()
        global.explorer.open([global.lang.TOOLS, global.lang.THEMES, global.lang.CREATE_THEME, global.lang.BACKGROUND, global.lang.BACKGROUND_COLOR].join('/'))
    }
    themesEntries(cb){
        const themes = {}
        const next = () => {
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
                                this.load(ffile)
                                global.explorer.refresh()
                            }
                        },
                        {
                            name: global.lang.EDIT,
                            type: 'action',
                            fa: 'fas fa-edit',
                            action: () => {
                                this.load(ffile, () => {
                                    this.creatingThemeName = themes[ffile]['theme-name']
                                    global.explorer.open([global.lang.TOOLS, global.lang.THEMES, global.lang.CREATE_THEME].join('/'))                                
                                })
                            }
                        },
                        {
                            name: global.lang.EXPORT,
                            type: 'action',
                            fa: 'fas fa-file-export',
                            action: () => {
                                global.downloads.serve(ffile, true, false).catch(global.displayErr)
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
                                fs.unlink(ffile, () => {
                                    global.explorer.refresh()
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
                    global.explorer.refresh()
                }
            })
            cb(entries)
        }
        fs.readdir(this.folder, (err, files) => {
            if(err){
                fs.mkdir(this.folder, {recursive: true}, () => {})                
                next()
            } else {
                async.eachOfLimit(files, 8, (file, i, done) => {
                    if(file.substr(-4) == '.tmp') return done()
                    let ffile = this.folder +'/'+ file
                    fs.readFile(ffile, (err, content) => {
                        if(err){
                            global.displayErr('Failed to open theme: '+ n)
                            done()
                        } else {
                            let e, n = file.replace('.theme.json', '')
                            try {
                                e = JSON.parse(String(content))
                            } catch(err) {
                                console.error(err, e, content, ffile)
                                global.displayErr('Failed to parse theme: '+ n)
                            }
                            if(e){
                                themes[ffile] = Object.assign({'theme-name': n}, e)
                            }
                            done()
                        }
                    })
                }, next)
            }
        })
    }
    rename(){
        global.ui.emit('prompt', global.lang.THEME_NAME, '', '', 'theme-creating-name', false, 'fas fa-palette')
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
                                this.rename()
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
                                                        if(global.cordova){
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
                                            action: () => {
                                                global.ui.emit('open-file', global.ui.uploadURL, 'theme-background-image-file', 'image/jpeg,image/png', global.lang.CHOOSE_BACKGROUND_IMAGE)
                                            }
                                        },
                                        {
                                            name: global.lang.CHOOSE_BACKGROUND_VIDEO,
                                            type: 'action',
                                            fa: 'fas fa-film', 
                                            action: () => {
                                                global.ui.emit('open-file', global.ui.uploadURL, 'theme-background-video-file', 'video/mp4,video/webm,video/ogg', global.lang.CHOOSE_BACKGROUND_VIDEO)
                                            }
                                        },
                                        {
                                            name: global.lang.BACKGROUND_COLOR,
                                            type: 'group',
                                            fa: 'fas fa-palette',
                                            renderer: () => {
                                                return new Promise((resolve, reject) => {
                                                    this.colors(this.customBackgroundImagePath, c => this.colorLightLevel(c) < 40, 52).then(colors => {
                                                        colors = this.colorsAddDefaults(colors, false).map(c => {
                                                            return global.rgbToHex.apply(null, Object.values(c))
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
                                                                        global.explorer.back()
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
                                                                if(value.match(new RegExp('^#?[0-9a-fA-F]{6}$'))){
                                                                    if(value.length == 6){
                                                                        value = '#' + value
                                                                    }
                                                                    global.config.set('background-color', value)     
                                                                    this.update() 
                                                                    global.explorer.back()                                  
                                                                } else {
                                                                    global.displayErr(global.lang.INCORRECT_FORMAT)
                                                                }
                                                            }
                                                        }),
                                                        resolve(colors)
                                                    }).catch(err => {
                                                        console.error(err)
                                                        reject(err)
                                                        global.explorer.back()
                                                    }).finally(() => {
                                                        global.osd.hide('theme-upload')
                                                        global.ui.emit('set-loading', {name: global.lang.CHOOSE_BACKGROUND_IMAGE}, false)
                                                    })
                                                })
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
                                                            let hex = global.rgbToHex.apply(null, Object.values(c))
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
                                                                        global.explorer.back()
                                                                    }
                                                                }
                                                            }
                                                        })
                                                        colors.push({
                                                            name: lang.CUSTOMIZE,
                                                            type: 'input',
                                                            fa: 'fas fa-palette', 
                                                            value: () => {
                                                                global.config.get('font-color')               
                                                            },
                                                            action: (data, value) => {
                                                                if(value.match(new RegExp('^#?[0-9a-fA-F]{6}$'))){
                                                                    if(value.length == 6){
                                                                        value = '#' + value
                                                                    }
                                                                    global.config.set('font-color', value)     
                                                                    this.update() 
                                                                    global.explorer.back()                                  
                                                                } else {
                                                                    global.displayErr(global.lang.INCORRECT_FORMAT)
                                                                }
                                                            }
                                                        }),
                                                        resolve(colors)
                                                    }).catch(err => {
                                                        console.error(err)
                                                        reject(err)
                                                        global.explorer.back()
                                                    }).finally(() => {
                                                        global.osd.hide('theme-upload')
                                                        global.ui.emit('set-loading', {name: global.lang.CHOOSE_BACKGROUND_IMAGE}, false)
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
                                                    global.ui.on('fontlist', list => {
                                                        global.ui.removeAllListeners('fontlist')
                                                        resolve(list.map(name => {
                                                            return {name, type: 'action', action: () => {
                                                                console.warn("CHOSEN FONT", name)
                                                                global.config.set('font-family', name)
                                                                this.update()
                                                            }}
                                                        }))
                                                    })
                                                    global.ui.emit('fontlist')
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
                                {name: global.lang.LAYOUT_GRID_SIZE, fa: 'fas fa-th', type: 'group', renderer: this.viewSizeEntries.bind(this)}
                            ]
                            resolve(opts)
                        })
                    }
                })
                entries.push({
                    name: global.lang.IMPORT,
                    type: 'action',
                    fa: 'fas fa-file-import', 
                    action: () => {
                        global.ui.emit('open-file', global.ui.uploadURL, 'theme-import-file', 'application/json', global.lang.IMPORT)
                    }
                })
                resolve(entries)
            })
        })
    }
    viewSizeEntries(){
        return new Promise((resolve, reject) => {
            resolve([
                {
                    name: global.lang.HORIZONTAL, 
                    type: 'slider', 
                    fa: 'fas fa-ruler-horizontal', 
                    value: () => {
                        return global.config.get('view-size-x')
                    }, 
                    range: {start: 1, end: 10},
                    action: (data, value) => {
                        console.log('viewSizeX', data, value)
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
                    range: {start: 1, end: 4}, 
                    action: (data, value) => {
                        console.log('viewSizeY', data, value)
                        if(value != global.config.get('view-size-y')){
                            global.config.set('view-size-y', value)
                            this.update()
                        }
                    }
                }
            ])
        })
    }
    refreshCallback(bgi, bgv){
        global.ui.emit('theme-background', bgi, bgv, global.config.get('background-color'), global.config.get('font-color'), global.config.get('animate-background'))
    }
    refresh(){
        let bgi = global.config.get('custom-background-image'), bgv = global.config.get('custom-background-video'), file = __dirname.replace(path.dirname(require.main.filename), '').replace(new RegExp('\\\\', 'g'), '/') +'/client.js?_='+ Math.random()
        global.ui.emit('load-js', '.'+ file)
        if(bgi){
            this.refreshCallback(global.ui.serve(bgi), '')
        } else if(bgv) {
            this.refreshCallback('', global.ui.serve(bgv))
        } else {
            this.refreshCallback('', '')
        }
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
        fs.readFile(file, (err, data) => {
            if(err){
                global.displayErr(err)
            } else {
                global.options.importConfigFile(data, this.keys)
            }
            if(typeof(cb) == 'function'){
                cb()
            }
        })
    }
    update(){
        this.save()
        this.refresh()
    }
    save(){
        const current = global.config.get('theme-name')
        if(current){
            const filename = global.sanitize(current) + '.theme.json', file = this.folder +'/'+ filename
            const atts = global.options.prepareExportConfigFile(global.config.data, this.keys)
            fs.writeFile(file +'.tmp', JSON.stringify(atts, null, 3), {encoding: 'utf-8'}, err => {
                if(err){
                    console.error(err)
                } else {
                    fs.rename(file +'.tmp', file, () => {})
                }
            })
        }
    }
    hook(entries, path){
        return new Promise((resolve, reject) => {
            this.setupFilter()
            if(path == global.lang.TOOLS){
                entries.splice(2, 0, {name: global.lang.THEMES, fa: 'fas fa-palette', type: 'group', renderer: this.entries.bind(this)})
            }
            resolve(entries)
        })
    }
}

module.exports = Theme
