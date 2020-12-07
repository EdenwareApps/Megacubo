
const Events = require('events'), fs = require('fs'), path = require('path')

class Theme extends Events {
    constructor(){
        super()
        this.filtering = false
        this.emptyEntry = {name: global.lang.EMPTY, type: 'action', fa: 'fas fa-info-circle', class: 'entry-empty'}
        this.customBackgroundImagePath = global.storage.folder + '/background.png'
        global.ui.on('init', this.refresh.bind(this))
        global.ui.on('theme-background-image-file', this.importBackgroundImage.bind(this))
        /*
        global.config.extend({
            'hide-back-button': false,
            'search-missing-logos': true,
            'show-logos': false
        })
        */
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
                    }
                    global.storage.get(key, content => {
                        if(Array.isArray(content)){
                            next(content)
                        } else {
                            global.jimp.colors(file).then(colors => {
                                global.tstorage.set(key, colors, true)
                                next(colors)
                            }).catch(reject)
                        }
                    })
                } else {
                    resolve([])
                }
            })
        })
    }
    colorsIncludes(colors, color){
        let i = colors.findIndex(x => x.r == color.r && x.g == color.g && x.b == color.b)
        return i >= 0
    }
    colorsAddDefaults(colors){        
        let black = {r: 0, g: 0, b: 0}, white = {r: 255, g: 255, b: 255}, b = global.hexToRgb(config.defaults['background-color']), f = global.hexToRgb(config.defaults['font-color'])
        if(!this.colorsIncludes(colors, b)){
            colors.unshift(b)
        }
        if(!this.colorsIncludes(colors, f)){
            colors.unshift(f)
        }
        if(!this.colorsIncludes(colors, black)){
            colors.unshift(black)
        }
        if(!this.colorsIncludes(colors, white)){
            colors.unshift(white)
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
        global.ui.emit('set-loading', {name: global.lang.CHANGE_BACKGROUND_IMAGE}, true, global.lang.PROCESSING)
        global.osd.show(global.lang.PROCESSING, 'fas fa-cog fa-spin', 'theme-upload', 'persistent')
        global.importFileFromClient(data, this.customBackgroundImagePath).then(ret => this.importBackgroundImageCallback(ret)).catch(err => {
            global.displayErr(err)
        }).finally(() => {
            global.ui.emit('set-loading', {name: global.lang.CHANGE_BACKGROUND_IMAGE}, false)
            global.osd.hide('theme-upload')
        })
    }
    importBackgroundImageCallback(err){
        console.warn('!!! IMPORT CUSTOM BACKGROUND FILE !!!')
        global.osd.show('OK', 'fas fa-check-circle', 'theme-upload', 'normal')
        global.config.set('custom-background-image', this.customBackgroundImagePath)
        this.refresh()
    }
    entries(){
        return new Promise((resolve, reject) => {
            let opts = [
                {
                    name: global.lang.SHOW_LOGOS,
                    type: 'check',
                    action: (e, checked) => {
                        global.config.set('show-logos', checked)
                    }, 
                    checked: () => {
                        return global.config.get('show-logos')
                    }
                },
                {
                    name: global.lang.SEARCH_MISSING_LOGOS,
                    type: 'check',
                    action: (e, checked) => {
                        global.config.set('search-missing-logos', checked)
                    }, 
                    checked: () => {
                        return global.config.get('search-missing-logos')
                    }
                },
                {
                    name: global.lang.PREFER_LOGOS_WITH_TRANSPARENCY,
                    type: 'check',
                    action: (e, checked) => {
                        global.config.set('transparent-logos-only', checked)
                    }, 
                    checked: () => {
                        return global.config.get('transparent-logos-only')
                    }
                },
                {
                    name: global.lang.HIDE_BACK_BUTTON, 
                    type: 'check', 
                    action: (data, value) => {
                        global.config.set('hide-back-button', value)
                        global.explorer.refresh()
                    }, 
                    checked: () => {
                        return global.config.get('hide-back-button')
                    }
                },
                {
                    name: global.lang.ANIMATE_BACKGROUND,
                    type: 'select',
                    fa: 'fas fa-image',
                    safe: true,
                    renderer: () => {
                        return new Promise((resolve, reject) => {
                            let def = global.config.get('animate-background'), options = [
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
                                    action: (data) => {
                                        global.config.set('animate-background', n.key)
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
                    name: lang.CHANGE_BACKGROUND_IMAGE,
                    type: 'action',
                    fa: 'fas fa-image', 
                    action: () => {
                        global.ui.emit('open-file', global.ui.uploadURL, 'theme-background-image-file', 'image/jpeg,image/png')
                    }
                },
                {
                    name: global.lang.BACKGROUND_COLOR,
                    type: 'group',
                    fa: 'fas fa-palette',
                    renderer: () => {
                        return new Promise((resolve, reject) => {
                            this.colors(this.customBackgroundImagePath, c => this.colorLightLevel(c) < 40, 32).then(colors => {
                                colors = this.colorsAddDefaults(colors).map((c, i) => {
                                    let hex = global.rgbToHex.apply(null, Object.values(c))
                                    return {
                                        name: global.lang.BACKGROUND_COLOR + ' ' +  (i + 1),
                                        type: 'action',
                                        fa: 'fas fa-stop',
                                        color: hex,
                                        action: () => {
                                            let cc = hex
                                            if(cc != global.config.get('background-color')){
                                                global.config.set('background-color', cc)
                                                this.refresh()
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
                                        global.config.get('background-color')               
                                    },
                                    action: (data, value) => {
                                        global.config.set('background-color', value)     
                                        this.refresh() 
                                        global.explorer.back()                                  
                                    }
                                }),
                                resolve(colors)
                            }).catch(err => {
                                console.error(err)
                                reject(err)
                                global.explorer.back()
                            }).finally(() => {
                                global.osd.hide('theme-upload')
                                global.ui.emit('set-loading', {name: global.lang.CHANGE_BACKGROUND_IMAGE}, false)
                            })
                        })
                    },
                    value: () => {
                        return global.config.get('background-color')
                    },
                    placeholder: '#000000'
                },       
                {
                    name: global.lang.FONT, 
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
                                        this.refresh()
                                    }}
                                }))
                            })
                            global.ui.emit('fontlist')
                        })
                    }
                },
                {
                    name: global.lang.FONT_COLOR,
                    type: 'group',
                    fa: 'fas fa-palette',
                    renderer: () => {
                        return new Promise((resolve, reject) => {
                            this.colors(this.customBackgroundImagePath, c => this.colorLightLevel(c) > 70, 32).then(colors => {
                                colors = this.colorsAddDefaults(colors).map((c, i) => {
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
                                                this.refresh()
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
                                        global.config.set('font-color', value)     
                                        this.refresh() 
                                        global.explorer.back()                                  
                                    }
                                }),
                                resolve(colors)
                            }).catch(err => {
                                console.error(err)
                                reject(err)
                                global.explorer.back()
                            }).finally(() => {
                                global.osd.hide('theme-upload')
                                global.ui.emit('set-loading', {name: global.lang.CHANGE_BACKGROUND_IMAGE}, false)
                            })
                        })
                    },
                    value: () => {
                        return global.config.get('font-color')
                    },
                    placeholder: '#FFFFFF'
                },
                {
                    name: global.lang.UPPERCASE_LETTERS_MENU, 
                    type: 'check', 
                    action: (data, value) => {
                        global.config.set('uppercase-menu', value)
                        this.refresh()
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
                        this.refresh()
                    }, 
                    value: () => {
                        return global.config.get('font-size')
                    }
                },
                {name: global.lang.LAYOUT_GRID_SIZE, fa: 'fas fa-th', type: 'group', renderer: this.viewSizeEntries.bind(this)}
            ]
            resolve(opts)
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
                    range: {start: 1, end: 12},
                    action: (data, value) => {
                        console.log('viewSizeX', data, value)
                        if(value != global.config.get('view-size-x')){
                            global.config.set('view-size-x', value)
                            this.refresh()
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
                        console.log('viewSizeY', data, value)
                        if(value != global.config.get('view-size-y')){
                            global.config.set('view-size-y', value)
                            this.refresh()
                        }
                    }
                }
            ])
        })
    }
    refreshCallback(bgi){
        global.ui.emit('theme-background', bgi, global.config.get('background-color'), global.config.get('font-color'), global.config.get('animate-background'))
    }
    refresh(){
        let bgi = config.get('custom-background-image'), file = __dirname.replace(path.dirname(require.main.filename), '').replace(new RegExp('\\\\', 'g'), '/') +'/client.js?_='+ Math.random()
        global.ui.emit('load-js', '.'+ file)
        if(bgi){
            global.base64.fromFile(bgi).then(data => {
                if(data){
                    bgi = data
                } else {
                    bgi = ''
                }
            }).catch(e => {
                console.error(e)
                bgi = ''
            }).finally(() => {
                this.refreshCallback(bgi)
            })
        } else {
            this.refreshCallback(bgi)
        }
    }
    hook(entries, path){
        return new Promise((resolve, reject) => {
            this.setupFilter()
            if(path == global.lang.OPTIONS){
                entries.splice(2, 0, {name: global.lang.APPEARANCE, fa: 'fas fa-palette', type: 'group', renderer: this.entries.bind(this)})
            }
            resolve(entries)
        })
    }
}

module.exports = Theme
