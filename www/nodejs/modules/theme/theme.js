import { basename, moveFile, sanitize } from "../utils/utils.js";
import Download from '../download/download.js'
import osd from '../osd/osd.js'
import menu from '../menu/menu.js'
import lang from "../lang/lang.js";
import storage from '../storage/storage.js'
import { EventEmitter } from "events";
import fs from "fs";
import imp from "../icon-server/image-processor.js";
import path from "path";
import downloads from "../downloads/downloads.js";
import options from "../options/options.js";
import cloud from "../cloud/cloud.js";
import renderer from '../bridge/bridge.js'
import paths from '../paths/paths.js'
import { parse } from '../serialize/serialize.js'
import Color from 'parse-css-color'

class Theme extends EventEmitter {
    constructor() {
        super();
        const { data } = paths;
        this.imp = imp
        this.backgroundVideoSizeLimit = 40 * (1024 * 1024);
        this.customBackgroundImagePath = data + '/background.png';
        this.customBackgroundVideoPath = data + '/background';
        this.keys = [
            'theme-name', 'animate-background', 'background-color',
            'background-transparency', 'custom-background-image',
            'custom-background-video', 'font-color', 'font-family',
            'font-size', 'uppercase-menu', 'view-size', 'fx-nav-intensity'
        ];
        this.folder = data + '/Themes';
        renderer.ready(() => {
            this.refresh();
            menu.on('render', (entries, path) => {
                if (path == [lang.TOOLS, lang.THEMES].join('/')) {
                    delete this.creatingThemeName;
                }
            });
        })
    }
    componentToHex(c) {
        const hex = c.toString(16);
        return hex.length == 1 ? '0' + hex : hex;
    }
    color(color, format = '') {
        const c = typeof(color) == 'string' ? Color(color) : {values: Array.isArray(color) ? color : [color.r, color.g, color.b], alpha: color.a||color.alpha||1};
        if(format == 'rgb') {
            return `rgb(${c.values[0]}, ${c.values[1]}, ${c.values[2]})`
        } else if(format == 'rgba') {
            return `rgba(${c.values[0]}, ${c.values[1]}, ${c.values[2]}, ${c.alpha||c.a})`
        } else if(format == 'hex') {
            return `#${this.componentToHex(c.values[0])}${this.componentToHex(c.values[1])}${this.componentToHex(c.values[2])}`
        } else if(format == 'hexa') {
            return `#${this.componentToHex(c.values[0])}${this.componentToHex(c.values[1])}${this.componentToHex(c.values[2])}${this.componentToHex(parseInt((c.alpha||c.a) * 255))}`
        } else if(format == 'human') {
            return c.values.join(' ')
        }
        return {
            r: c.values[0],
            g: c.values[1],
            b: c.values[2],
            a: c.alpha
        }
    }
    async colors(file, lightLevel, limit) {
        osd.show(lang.PROCESSING, 'fa-mega busy-x', 'theme-processing-colors', 'persistent');
        let err
        const stat = await fs.promises.stat(file).catch(e => err = e)
        if(err) {
            console.error(err)
            osd.hide('theme-processing-colors')
            return []
        }
        const key = 'colors-' + basename(file) + '-' + stat.size + '-' + lightLevel + '-' + limit
        let colors = await storage.get(key)
        if (!Array.isArray(colors)) {
            colors = await imp.colors(file, limit)
            await storage.set(key, colors, { expiration: true })                    
        }
        if (!Array.isArray(colors)) {
            colors = []
        }
        osd.hide('theme-processing-colors')
        if (Array.isArray(lightLevel)) {
            colors = colors.map(color => {
                const parsed = this.color(color)
                return this.equalizeLightLevel(parsed, lightLevel)
            })
        }
        colors = [...new Set(colors)]
        if (typeof(limit) == 'number') {
            return colors.slice(0, limit)
        }
        return colors
    }
    equalizeLightLevel(color, filter) {
        const {r, g, b} = color;
        const S = r + g + b;
        const lightLevel = (S / 765) * 100;
        const [min, max] = filter;
        const targetLightLevel = lightLevel < min ? min : (lightLevel > max ? max : lightLevel)
        if (lightLevel < targetLightLevel) {
            const requiredIncrease =  Math.min(targetLightLevel - lightLevel) / 100;
            const maxIncrease =  Math.max(0, Math.min(...[r, g, b].map(c => 255 - c)));
            const increaseSize = Math.min((255 * requiredIncrease), maxIncrease);
            return {
                r: Math.round(r + increaseSize),
                g: Math.round(g + increaseSize),
                b: Math.round(b + increaseSize)
            }
        } else if (lightLevel > targetLightLevel) {
            const requiredDecrease =  Math.max(lightLevel - targetLightLevel) / 100;
            const maxDecrease =  Math.min(r, g, b);
            const decreaseSize = Math.min((255 * requiredDecrease), maxDecrease);
            return {
                r: Math.round(r - decreaseSize),
                g: Math.round(g - decreaseSize),
                b: Math.round(b - decreaseSize)
            }
        } else {
            return color;
        }
    }
    colorsIncludes(colors, color) {
        let i = colors.findIndex(x => x.r == color.r && x.g == color.g && x.b == color.b);
        return i >= 0;
    }
    colorsAddDefaults(colors, light) {
        if (light) {
            const white = { r: 255, g: 255, b: 255 }
            const f = this.color(global.config.defaults['font-color']);
            if (!this.colorsIncludes(colors, f)) {
                colors.unshift(f);
            }
            if (!this.colorsIncludes(colors, white)) {
                colors.unshift(white);
            }
        } else {
            const black = { r: 0, g: 0, b: 0 }, b = this.color(global.config.defaults['background-color']);
            if (!this.colorsIncludes(colors, b)) {
                colors.unshift(b);
            }
            if (!this.colorsIncludes(colors, black)) {
                colors.unshift(black);
            }
        }
        return colors;
    }
    async importBackgroundImage(file) {
        osd.show(lang.PROCESSING, 'fas fa-cog fa-spin', 'theme-upload', 'persistent');
        try {            
            await fs.promises.copyFile(file, this.customBackgroundImagePath);
            console.warn('!!! IMPORT CUSTOM BACKGROUND FILE !!!', menu.path, file, this.customBackgroundImagePath);
            global.config.set('custom-background-image', this.customBackgroundImagePath);
            global.config.set('custom-background-video', '');
            await this.update()
            await menu.open([lang.TOOLS, lang.THEMES, lang.CREATE_THEME, lang.BACKGROUND, lang.BACKGROUND_COLOR].join('/')).catch(e => menu.displayErr(e))
        } catch (err) {
            menu.displayErr(err)
        }
        console.warn('!!! IMPORT CUSTOM BACKGROUND FILE !!! ok', menu.path, file, this.customBackgroundImagePath);
        osd.hide('theme-upload');
    }
    async importBackgroundVideo(file) {
        osd.show(lang.PROCESSING, 'fas fa-cog fa-spin', 'theme-upload', 'persistent');
        try {
            
            const targetFile = this.customBackgroundVideoPath + '-' + uid + '.mp4';
            const stat = await fs.promises.stat(file);
            const tooBig = stat && stat.size >= this.backgroundVideoSizeLimit;
            if (tooBig)
                throw 'This video file is too big. Limit it to 40MB at least.';
            await fs.promises.copyFile(file, targetFile);
            console.warn('!!! IMPORT CUSTOM BACKGROUND FILE !!!', menu.path, file, targetFile);
            global.config.set('custom-background-video', targetFile);
            global.config.set('custom-background-image', '');
            if (global.config.get('background-color') == global.config.defaults['background-color']) {
                global.config.set('background-color', '#000000');
            }
            await this.update()
            this.cleanVideoBackgrounds(targetFile);
            osd.show(lang.BACKGROUND_VIDEO_BLACK_SCREEN_HINT, 'fas fa-info-circle', 'theme-upload-hint', 'long');
            menu.open([lang.TOOLS, lang.THEMES, lang.CREATE_THEME, lang.BACKGROUND, lang.BACKGROUND_COLOR].join('/')).catch(e => menu.displayErr(e));
        } catch (err) {
            menu.displayErr(err);
        }
        osd.hide('theme-upload');
    }
    cleanVideoBackgrounds(currentFile) {        
        const dir = path.dirname(currentFile), name = basename(currentFile)
        fs.readdir(dir, (err, files) => {
            if (files) {
                files.forEach(file => {
                    if (file.startsWith('background') && file != name && file.substr(-4) == '.mp4') {
                        fs.unlink(path.join(dir, file), () => {});
                    }
                });
            }
        })
    }
    async localThemes() {
        let err
        const themes = {}        
        const files = await fs.promises.readdir(this.folder).catch(e => err)
        if (!Array.isArray(files)) {
            fs.mkdir(this.folder, { recursive: true }, () => {})
            return []
        }
        console.log(files)
        for(const file of files.filter(file => !file.endsWith('.tmp'))) {
            let err, ffile = this.folder + '/' + file;
            let content = await fs.promises.readFile(ffile)
            let n = file.replace('.theme.json', '')
            if (err) {
                menu.displayErr('Failed to open theme: ' + n)
            } else {
                let e
                try {
                    e = parse(String(content))
                    if (e) {
                        themes[ffile] = Object.assign({ 'theme-name': n }, e)
                    }
                }
                catch (err) {
                    console.error(err, e, content, ffile);
                    menu.displayErr('Failed to parse theme: ' + n)
                    delete themes[ffile]
                }
            }
        }
        const def = global.config.get('theme-name'), defLabel = '<i class="fas fa-check-circle"></i> ' + lang.ENABLED;
        let entries = Object.keys(themes).map(ffile => {
            return {
                name: themes[ffile]['theme-name'],
                details: def == themes[ffile]['theme-name'] ? defLabel : '',
                fa: 'fas fa-palette',
                prepend: '<i class="fas fa-circle" style="color: ' + themes[ffile]['background-color'] + '"></i> ',
                type: 'select',
                entries: [
                    {
                        name: lang.APPLY,
                        type: 'action',
                        fa: 'fas fa-check-circle',
                        action: async () => {
                            await this.load(ffile)
                            menu.refreshNow()
                        }
                    },
                    {
                        name: lang.EDIT,
                        type: 'action',
                        fa: 'fas fa-edit',
                        action: async () => {
                            await this.load(ffile)
                            this.creatingThemeName = themes[ffile]['theme-name'];
                            await menu.open([lang.TOOLS, lang.THEMES, lang.CREATE_THEME].join('/')).catch(e => menu.displayErr(e));
                        }
                    },
                    {
                        name: lang.EXPORT,
                        type: 'action',
                        fa: 'fas fa-file-export',
                        action: () => {
                            downloads.serve(ffile, true, false).catch(e => menu.displayErr(e));
                        }
                    },
                    {
                        name: lang.REMOVE,
                        type: 'action',
                        fa: 'fas fa-trash',
                        action: () => {
                            if (themes[ffile]['theme-name'] == global.config.get('theme-name')) {
                                this.reset(true);
                            }                            
                            fs.unlink(ffile, () => {
                                menu.refreshNow();
                            });
                        }
                    }
                ]
            }
        })
        entries = entries.sortByProp('name');
        entries.unshift({
            name: lang.DEFAULT,
            details: [lang.DEFAULT, ''].includes(def) ? defLabel : '',
            fa: 'fas fa-palette',
            prepend: '<i class="fas fa-circle" style="color: ' + global.config.defaults['background-color'] + '"></i> ',
            type: 'action',
            action: () => {
                this.reset(true);
                menu.refreshNow();
            }
        });
        return entries
    }
    async rename(name) {
        name = await menu.prompt({
            question: lang.THEME_NAME,
            placeholder: '',
            defaultValue: name || '',
            fa: 'fas fa-palette'
        })
        if (name && name != lang.DEFAULT) {
            this.creatingThemeName = name;
        } else if (!this.creatingThemeName) {
            this.creatingThemeName = 'Untitled';
        }
        const prevName = global.config.get('theme-name')
        if (this.creatingThemeName != prevName) {
            global.config.set('theme-name', this.creatingThemeName);
            await this.save()
            if(prevName != lang.DEFAULT) {
                const ffile = this.folder + '/' + sanitize(prevName) + '.theme.json';
                fs.unlink(ffile, () => {})
            }
            if (prevName && menu.path.includes(prevName) && !menu.path.includes(lang.CREATE_THEME)) {
                await menu.open(menu.path.replace(prevName, this.creatingThemeName)).catch(e => menu.displayErr(e));
            }
        }
    }
    async entries() {
        const entries = await this.localThemes()
        entries.push({
            name: lang.CREATE_THEME,
            type: 'group',
            fa: 'fas fa-plus-square',
            renderer: () => {
                return new Promise((resolve, reject) => {
                    this.creatingThemeName || this.rename().catch(err => console.error(err))
                    let opts = [
                        {
                            name: lang.BACKGROUND,
                            type: 'group',
                            fa: 'fas fa-image',
                            safe: true,
                            entries: [
                                {
                                    name: lang.ANIMATE_BACKGROUND,
                                    type: 'select',
                                    fa: 'fas fa-image',
                                    safe: true,
                                    renderer: () => {
                                        return new Promise((resolve, reject) => {
                                            let def = global.config.get('animate-background');
                                            if (def.includes('-desktop')) {
                                                if (paths.android) {
                                                    def = 'none';
                                                } else {
                                                    def = def.replace('-desktop', '');
                                                }
                                            }
                                            let options = [
                                                {
                                                    name: lang.STOP,
                                                    key: 'none'
                                                },
                                                {
                                                    name: lang.SLOW,
                                                    key: 'slow'
                                                },
                                                {
                                                    name: lang.FAST,
                                                    key: 'fast'
                                                }
                                            ].map(n => {
                                                return {
                                                    name: n.name,
                                                    value: n.key,
                                                    type: 'action',
                                                    action: async data => {
                                                        global.config.set('animate-background', n.key);
                                                        await this.update()
                                                    }
                                                };
                                            });
                                            options = options.map(p => {
                                                p.selected = (def == p.value);
                                                return p;
                                            });
                                            resolve(options);
                                        });
                                    }
                                },
                                {
                                    name: lang.CHOOSE_BACKGROUND_IMAGE,
                                    type: 'action',
                                    fa: 'fas fa-image',
                                    action: async () => {
                                        const file = await menu.chooseFile('image/jpeg,image/png');
                                        await this.importBackgroundImage(file);
                                    }
                                },
                                {
                                    name: lang.CHOOSE_BACKGROUND_VIDEO,
                                    details: lang.HTML5_COMPAT_REQUIRED,
                                    type: 'action',
                                    fa: 'fas fa-film',
                                    action: async () => {
                                        const file = await menu.chooseFile('video/mp4,video/webm,video/ogg');
                                        await this.importBackgroundVideo(file);
                                    }
                                },
                                {
                                    name: lang.BACKGROUND_COLOR,
                                    type: 'group',
                                    fa: 'fas fa-palette',
                                    renderer: async () => {
                                        const file = global.config.get('custom-background-image') || (global.config.get('custom-background-video') ? await global.ffmpeg.thumbnail(global.config.get('custom-background-video')) : this.customBackgroundImagePath)
                                        let hasErr, colors = await this.colors(file, [0, 25], 52).catch(err => hasErr = err);
                                        osd.hide('theme-upload');
                                        await global.menu.withBusy(global.menu.path +'/'+ lang.BACKGROUND_COLOR, async () => {
                                            if (!Array.isArray(colors)) colors = []
                                            try {
                                                colors = this.colorsAddDefaults(colors, false).map(c => this.color(c));
                                                colors = [...new Set(colors)].slice(0, 32).map((color, i) => {
                                                    const hex = this.color(color, 'hex')
                                                    return {
                                                        name: lang.BACKGROUND_COLOR + ' ' + (i + 1),
                                                        details: this.color(color, 'human'),
                                                        type: 'action',
                                                        fa: 'fas fa-stop',
                                                        faStyle: 'color: '+ hex,
                                                        action: async () => {
                                                            if (hex != global.config.get('background-color')) {
                                                                global.config.set('background-color', hex);
                                                                await this.update()
                                                            } else {
                                                                menu.back();
                                                            }
                                                        }
                                                    };
                                                });
                                                colors.push({
                                                    name: lang.CUSTOMIZE,
                                                    type: 'input',
                                                    fa: 'fas fa-palette',
                                                    value: () => global.config.get('background-color'),
                                                    action: async (data, value) => {
                                                        if (String(value).match(new RegExp('^#?[0-9a-fA-F]{6}$'))) { // TypeError: value.match is not a function 
                                                            if (value.length == 6) {
                                                                value = '#' + value;
                                                            }
                                                            global.config.set('background-color', value);
                                                            await this.update()
                                                            menu.back()
                                                        } else {
                                                            menu.displayErr(lang.INCORRECT_FORMAT);
                                                        }
                                                    }
                                                })
                                            } catch (err) { 
                                                console.error(err)
                                            }
                                        })
                                        return colors
                                    },
                                    value: () => {
                                        return global.config.get('background-color');
                                    },
                                    placeholder: '#000000'
                                },
                                {
                                    name: lang.BACKGROUND_COLOR_TRANSPARENCY,
                                    type: 'slider',
                                    fa: 'fas fa-adjust',
                                    range: { start: 1, end: 100 },
                                    action: async (data, value) => {
                                        console.warn('BACKGROUND_COLOR_TRANSPARENCY', data, value)
                                        global.config.set('background-transparency', value)
                                        await this.update()
                                    },
                                    value: () => {
                                        return global.config.get('background-transparency');
                                    }
                                }
                            ]
                        },
                        {
                            name: lang.FONT,
                            type: 'group',
                            fa: 'fas fa-font',
                            entries: [
                                {
                                    name: lang.FONT_COLOR,
                                    type: 'group',
                                    fa: 'fas fa-palette',
                                    renderer: () => {
                                        return new Promise((resolve, reject) => {
                                            this.colors(this.customBackgroundImagePath, [75, 100], 32).then(colors => {
                                                colors = this.colorsAddDefaults(colors, true).map(color => {
                                                    const hex = this.color(color, 'hex');
                                                    return {
                                                        name: this.color(color, 'human'),
                                                        type: 'action',
                                                        fa: 'fas fa-stop',
                                                        faStyle: 'color: '+ hex,
                                                        action: async () => {
                                                            if (hex != global.config.get('font-color')) {
                                                                global.config.set('font-color', hex);
                                                                await this.update()
                                                            } else {
                                                                menu.back();
                                                            }
                                                        }
                                                    };
                                                });
                                                colors.push({
                                                    name: lang.CUSTOMIZE,
                                                    type: 'input',
                                                    fa: 'fas fa-palette',
                                                    value: () => global.config.get('font-color'),
                                                    action: async (data, value) => {
                                                        if (value && value.match(new RegExp('^#?[0-9a-fA-F]{6}$'))) {
                                                            if (value.length == 6) {
                                                                value = '#' + value;
                                                            }
                                                            global.config.set('font-color', value);
                                                            await this.update()
                                                            menu.back()
                                                        } else {
                                                            menu.displayErr(lang.INCORRECT_FORMAT);
                                                        }
                                                    }
                                                })
                                                resolve(colors);
                                            }).catch(err => {
                                                console.error(err);
                                                reject(err);
                                                menu.back();
                                            }).finally(() => {
                                                osd.hide('theme-upload')
                                            })
                                        })
                                    },
                                    value: () => {
                                        return global.config.get('font-color');
                                    },
                                    placeholder: '#FFFFFF'
                                },
                                {
                                    name: lang.FONT_FAMILY,
                                    type: 'select',
                                    fa: 'fas fa-font',
                                    renderer: () => {
                                        return new Promise(resolve => {
                                            renderer.ui.once('fontlist', list => {
                                                resolve(list.map(name => {
                                                    return {
                                                        name, type: 'action',
                                                        action: async () => {
                                                            console.warn('CHOSEN FONT', name);
                                                            global.config.set('font-family', name);
                                                            await this.update()
                                                        }
                                                    }
                                                }))
                                            })
                                            renderer.ui.emit('fontlist')
                                        });
                                    },
                                    value: () => {
                                        return global.config.get('font-family');
                                    }
                                },
                                {
                                    name: lang.UPPERCASE_LETTERS_MENU,
                                    type: 'check',
                                    action: async (data, value) => {
                                        global.config.set('uppercase-menu', value)
                                        await this.update()
                                    },
                                    checked: () => {
                                        return global.config.get('uppercase-menu');
                                    }
                                },
                                {
                                    name: lang.FONT_SIZE,
                                    type: 'slider',
                                    fa: 'fas fa-text-width',
                                    range: { start: 1, end: 10 },
                                    action: async (data, value) => {
                                        console.warn('FONT_SIZE', data, value);
                                        global.config.set('font-size', value);
                                        await this.update()
                                    },
                                    value: () => {
                                        return global.config.get('font-size');
                                    }
                                }
                            ]
                        },
                        { name: lang.RENAME, fa: 'fas fa-edit', type: 'action', action: () => this.rename(global.config.get('theme-name')).catch(err => console.error(err)) },
                        { name: lang.LAYOUT_GRID_SIZE, fa: 'fas fa-th', type: 'group', renderer: this.gridLayoutEntries.bind(this) },
                        {
                            name: 'FX Navigation Intensity',
                            fa: 'fas fa-film',
                            type: 'slider',
                            range: { start: 0, end: 10 },
                            action: async (data, value) => {
                                global.config.set('fx-nav-intensity', value);
                                await this.update();
                            },
                            value: () => {
                                return global.config.get('fx-nav-intensity');
                            }
                        }
                    ];
                    resolve(opts);
                });
            }
        });
        entries.push({
            name: lang.IMPORT,
            type: 'action',
            fa: 'fas fa-file-import',
            action: async () => {                        
                const file = await menu.chooseFile('application/json');
                await options.importConfigFile(await fs.promises.readFile(file), this.keys)
                menu.refreshNow()
            }
        });
        entries.push({
            name: lang.MORE_THEMES,
            type: 'group',
            fa: 'fas fa-download',
            renderer: () => this.remoteThemes().catch(err => console.error(err))
        });
        return entries
    }
    async applyRemoteTheme(url, name = 'Untitled') {
        const file = this.folder + '/' + sanitize(name) + '.theme.json'
        const stat = await fs.promises.stat(file).catch(() => {})
        if(stat && stat.size) {
            await fs.promises.unlink(file)
        }
        osd.show(lang.LOADING, 'fas fa-download', 'theme', 'persistent');
        let err
        const rfile = await Download.file({
            debug: false,
            file,
            url,
            progress: p => {
                osd.show(lang.LOADING +' '+ p +'%', 'fas fa-download', 'theme', 'persistent');
            },
            cacheTTL: 24 * 3600
        }).catch(e => err = e)
        console.log('applyRemoteTheme', rfile, err)
        if (err) {
            osd.hide('theme')
            await Download.cache.invalidate(url)
            await fs.promises.unlink(file)
            menu.displayErr(err)
        } else {
            await this.load(rfile).catch(err => {
                Download.cache.invalidate(url).catch(err => console.error(err))
                fs.promises.unlink(rfile).catch(err => console.error(err))
                console.error(err)
                menu.displayErr(err)
            }).finally(() => {
                osd.hide('theme')
            })
        }
    }
    async remoteThemes() {
        let themes = await Download.get({
            cacheTTL: 600,
            url: cloud.server +'/themes/feed.json',
            responseType: 'json'
        })
        if (Array.isArray(themes)) {
            return themes.map(t => {
                return {
                    name: t.name,
                    details: t.author,
                    type: 'action',
                    fa: 'fas fa-palette',
                    icon: t.icon,
                    class: 'entry-icon-no-fallback',
                    action: () => {
                        this.applyRemoteTheme(t.url, t.name);
                    }
                };
            });
        }
        return [];
    }
    async gridLayoutEntries() {
        return [
            {
                name: lang.LANDSCAPE_MODE,
                type: 'group',
                fa: 'fas fa-grip-horizontal',
                entries: [
                    {
                        name: lang.HORIZONTAL,
                        type: 'slider',
                        fa: 'fas fa-ruler-horizontal',
                        value: () => {
                            return global.config.get('view-size').landscape.x;
                        },
                        range: { start: 1, end: 10 },
                        action: async (data, value) => {
                            console.log('gridLayoutX', data, value)
                            const metrics = global.config.get('view-size')
                            if (metrics.landscape.x != value) {
                                metrics.landscape.x = value
                                global.config.set('view-size', metrics)
                                await this.update()
                            }
                        }
                    },
                    {
                        name: lang.VERTICAL,
                        type: 'slider',
                        fa: 'fas fa-ruler-vertical',
                        value: () => {
                            return global.config.get('view-size').landscape.y;
                        },
                        range: { start: 1, end: 8 },
                        action: async (data, value) => {
                            console.log('gridLayoutY', data, value)
                            const metrics = global.config.get('view-size')
                            if (metrics.landscape.y != value) {
                                metrics.landscape.y = value
                                global.config.set('view-size', metrics)
                                await this.update()
                            }
                        }
                    }
                ]
            },
            {
                name: lang.PORTRAIT_MODE,
                type: 'group',
                fa: 'fas fa-grip-vertical',
                entries: [
                    {
                        name: lang.HORIZONTAL,
                        type: 'slider',
                        fa: 'fas fa-ruler-horizontal',
                        range: { start: 1, end: 4 },
                        value: () => {
                            return global.config.get('view-size').portrait.x;
                        },
                        action: async (data, value) => {
                            console.log('gridLayoutX', data, value)
                            const metrics = global.config.get('view-size')
                            if (metrics.portrait.x != value) {
                                metrics.portrait.x = value
                                global.config.set('view-size', metrics)
                                await this.update();
                            }
                        }
                    },
                    {
                        name: lang.VERTICAL,
                        type: 'slider',
                        fa: 'fas fa-ruler-vertical',
                        range: { start: 1, end: 10 },
                        value: () => {
                            return global.config.get('view-size').portrait.y;
                        },
                        action: async (data, value) => {
                            console.log('gridLayoutY', data, value)
                            const metrics = global.config.get('view-size')
                            if (metrics.portrait.y != value) {
                                metrics.portrait.y = value
                                global.config.set('view-size', metrics);
                                await this.update();
                            }
                        }
                    }
                ]
            }
        ];
    }
    refresh() {
        let bgi = global.config.get('custom-background-image'), bgv = global.config.get('custom-background-video');
        if (bgv) {
            bgi = '';
            bgv = renderer.ui.serve(bgv);
        } else if (bgi) {
            bgi = renderer.ui.serve(bgi);
            bgv = '';
        } else {
            bgi = bgv = '';
        }
        renderer.ui.emit('theme-update', bgi, bgv, global.config.get('background-color'), global.config.get('font-color'), global.config.get('animate-background'));
    }
    reset(refresh) {
        let natts = {};
        this.keys.forEach(k => {
            natts[k] = global.config.defaults[k];
        });
        global.config.setMulti(natts);
        refresh && this.refresh();
    }
    async load(file) {
        this.reset(false);
        const data = await fs.promises.readFile(file)
        global.config.set('custom-background-image', '')
        global.config.set('custom-background-video', '')
        await options.importConfigFile(data, this.keys)
    }
    async update() {
        await this.save()
        this.refresh()
    }
    async save() {
        const current = global.config.get('theme-name')
        if (current) {
            const filename = sanitize(current) +'.theme.json', file = this.folder +'/'+ filename
            try {
                await options.prepareExportConfigFile(file, null, this.keys)
            } catch (err) {
                console.error(err)
                menu.displayErr(err)
            }
        }
    }
    async hook(entries, path) {
        if (path == lang.TOOLS) {
            entries.splice(2, 0, { name: lang.THEMES, fa: 'fas fa-palette', type: 'group', renderer: this.entries.bind(this) });
        }
        return entries
    }
}
export default Theme;
