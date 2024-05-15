import { basename, moveFile, parseJSON, sanitize } from "../utils/utils.js";
import Download from '../download/download.js'
import osd from '../osd/osd.js'
import menu from '../menu/menu.js'
import lang from "../lang/lang.js";
import storage from '../storage/storage.js'
import { EventEmitter } from "events";
import fs from "fs";
import jimp from "../jimp-worker/main.js";
import path from "path";
import downloads from "../downloads/downloads.js";
import options from "../options/options.js";
import cloud from "../cloud/cloud.js";
import config from "../config/config.js"
import renderer from '../bridge/bridge.js'
import paths from '../paths/paths.js'

class Theme extends EventEmitter {
    constructor() {
        super();
        const { data } = paths;
        this.jimp = jimp
        this.backgroundVideoSizeLimit = 40 * (1024 * 1024);
        this.customBackgroundImagePath = data + '/background.png';
        this.customBackgroundVideoPath = data + '/background';
        this.keys = [
            'theme-name', 'animate-background', 'background-color',
            'background-color-transparency', 'custom-background-image',
            'custom-background-video', 'font-color', 'font-family',
            'font-size', 'uppercase-menu', 'view-size-x', 'view-size-y',
            'view-size-portrait-x', 'view-size-portrait-y', 'fx-nav-intensity'
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
    async colors(file, filter, limit) {
        osd.show(lang.PROCESSING, 'fa-mega spin-x-alt', 'theme-processing-colors', 'persistent');
        let err
        const stat = await fs.promises.stat(file).catch(e => err = e)
        if(err) {
            console.error(err)
            osd.hide('theme-processing-colors')
            return []
        }
        const key = 'colors-' + basename(file) + '-' + stat.size
        let colors = await storage.get(key)
        if (!Array.isArray(colors)) {
            colors = await jimp.colors(file)
            await storage.set(key, colors, { expiration: true })                    
        }
        if (!Array.isArray(colors)) {
            colors = []
        }
        osd.hide('theme-processing-colors')
        if (typeof(filter) == 'function') {
            colors = colors.filter(filter)
        }
        if (typeof(limit) == 'number') {
            return colors.slice(0, limit)
        }
        return colors
    }
    colorsIncludes(colors, color) {
        let i = colors.findIndex(x => x.r == color.r && x.g == color.g && x.b == color.b);
        return i >= 0;
    }
    colorsAddDefaults(colors, light) {
        if (light) {
            const white = { r: 255, g: 255, b: 255 }, f = this.hexToRgb(config.defaults['font-color']);
            if (!this.colorsIncludes(colors, f)) {
                colors.unshift(f);
            }
            if (!this.colorsIncludes(colors, white)) {
                colors.unshift(white);
            }
        } else {
            const black = { r: 0, g: 0, b: 0 }, b = this.hexToRgb(config.defaults['background-color']);
            if (!this.colorsIncludes(colors, b)) {
                colors.unshift(b);
            }
            if (!this.colorsIncludes(colors, black)) {
                colors.unshift(black);
            }
        }
        return colors;
    }
    colorLightLevel(color) {
        let n = 0;
        Object.values(color).forEach(v => {
            n += v;
        });
        return (n / (255 * 3)) * 100;
    }
    async importBackgroundImage(file) {
        renderer.get().emit('set-loading', { name: lang.CHOOSE_BACKGROUND_IMAGE }, true, lang.PROCESSING);
        osd.show(lang.PROCESSING, 'fas fa-cog fa-spin', 'theme-upload', 'persistent');
        try {            
            await fs.promises.copyFile(file, this.customBackgroundImagePath);
            console.warn('!!! IMPORT CUSTOM BACKGROUND FILE !!!', menu.path, file, this.customBackgroundImagePath);
            config.set('custom-background-image', this.customBackgroundImagePath);
            config.set('custom-background-video', '');
            await this.update()
            await menu.open([lang.TOOLS, lang.THEMES, lang.CREATE_THEME, lang.BACKGROUND, lang.BACKGROUND_COLOR].join('/')).catch(e => menu.displayErr(e))
        } catch (err) {
            menu.displayErr(err)
        }
        console.warn('!!! IMPORT CUSTOM BACKGROUND FILE !!! ok', menu.path, file, this.customBackgroundImagePath);
        renderer.get().emit('set-loading', { name: lang.CHOOSE_BACKGROUND_IMAGE }, false);
        osd.hide('theme-upload');
    }
    async importBackgroundVideo(file) {
        renderer.get().emit('set-loading', { name: lang.CHOOSE_BACKGROUND_VIDEO }, true, lang.PROCESSING);
        osd.show(lang.PROCESSING, 'fas fa-cog fa-spin', 'theme-upload', 'persistent');
        try {
            
            const targetFile = this.customBackgroundVideoPath + '-' + uid + '.mp4';
            const stat = await fs.promises.stat(file);
            const tooBig = stat && stat.size >= this.backgroundVideoSizeLimit;
            if (tooBig)
                throw 'This video file is too big. Limit it to 40MB at least.';
            await fs.promises.copyFile(file, targetFile);
            console.warn('!!! IMPORT CUSTOM BACKGROUND FILE !!!', menu.path, file, targetFile);
            config.set('custom-background-video', targetFile);
            config.set('custom-background-image', '');
            if (config.get('background-color') == config.defaults['background-color']) {
                config.set('background-color', '#000000');
            }
            await this.update()
            this.cleanVideoBackgrounds(targetFile);
            osd.show(lang.BACKGROUND_VIDEO_BLACK_SCREEN_HINT, 'fas fa-info-circle', 'theme-upload-hint', 'long');
            menu.open([lang.TOOLS, lang.THEMES, lang.CREATE_THEME, lang.BACKGROUND, lang.BACKGROUND_COLOR].join('/')).catch(e => menu.displayErr(e));
        }
        catch (err) {
            menu.displayErr(err);
        }
        renderer.get().emit('set-loading', { name: lang.CHOOSE_BACKGROUND_VIDEO }, false);
        osd.hide('theme-upload');
    }
    cleanVideoBackgrounds(currentFile) {        
        const dir = path.dirname(currentFile), name = basename(currentFile);
        fs.readdir(dir, (err, files) => {
            if (files) {
                files.forEach(file => {
                    if (file.startsWith('background') && file != name && file.substr(-4) == '.mp4') {
                        fs.unlink(path.join(dir, file), () => {});
                    }
                });
            }
        });
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
                    e = parseJSON(String(content))
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
        const def = config.get('theme-name'), defLabel = '<i class="fas fa-check-circle"></i> ' + lang.ENABLED;
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
                            console.log('Edit theme')
                            console.log('Edit theme', ffile)
                            await this.load(ffile)
                            console.log('Edit theme OK', ffile, JSON.stringify(themes))
                            console.log('Edit theme OK', ffile, Object.keys(themes))
                            console.log('Edit theme OK', ffile, themes[ffile]['theme-name'])
                            this.creatingThemeName = themes[ffile]['theme-name'];
                            console.log('Edit theme OK', ffile, this.creatingThemeName)                                
                            await menu.open([lang.TOOLS, lang.THEMES, lang.CREATE_THEME].join('/')).catch(e => menu.displayErr(e));
                            console.log('Edit theme OK**', ffile, themes[ffile]['theme-name'])
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
                            if (themes[ffile]['theme-name'] == config.get('theme-name')) {
                                this.reset();
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
            prepend: '<i class="fas fa-circle" style="color: ' + config.defaults['background-color'] + '"></i> ',
            type: 'action',
            action: () => {
                this.reset();
                menu.refreshNow();
            }
        });
        return entries
    }
    componentToHex(c) {
        const hex = c.toString(16);
        return hex.length == 1 ? '0' + hex : hex;
    }
    hexToRgb(ohex) {
        const shorthandRegex = /^#?([a-f\d])([a-f\d])([a-f\d])$/i, hex = ohex.replace(shorthandRegex, (m, r, g, b) => {
            return r + r + g + g + b + b;
        });
        const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
        return result ? {
            r: parseInt(result[1], 16),
            g: parseInt(result[2], 16),
            b: parseInt(result[3], 16)
        } : ohex;
    }
    rgbToHex(r, g, b) {
        return '#' + this.componentToHex(r) + this.componentToHex(g) + this.componentToHex(b);
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
        const prevName = config.get('theme-name')
        if (this.creatingThemeName != prevName) {
            config.set('theme-name', this.creatingThemeName);
            await this.save()
            if(prevName != lang.DEFAULT) {
                const ffile = this.folder + '/' + sanitize(prevName) + '.theme.json';
                fs.unlink(ffile, () => {})
            }
            if (prevName && menu.path.indexOf(prevName) != -1 && menu.path.indexOf(lang.CREATE_THEME) == -1) {
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
                    this.creatingThemeName || this.rename().catch(console.error)
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
                                            let def = config.get('animate-background');
                                            if (def.indexOf('-desktop') != -1) {
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
                                                        config.set('animate-background', n.key);
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
                                        let hasErr, colors = await this.colors(this.customBackgroundImagePath, c => this.colorLightLevel(c) < 40, 52).catch(err => hasErr = err);
                                        osd.hide('theme-upload');
                                        renderer.get().emit('set-loading', { name: lang.CHOOSE_BACKGROUND_IMAGE }, false);
                                        if (!Array.isArray(colors)) colors = [];
                                        colors = this.colorsAddDefaults(colors, false).map(c => {
                                            return this.rgbToHex.apply(this, Object.values(c));
                                        });
                                        colors = [...new Set(colors)].slice(0, 32).map((hex, i) => {
                                            return {
                                                name: lang.BACKGROUND_COLOR + ' ' + (i + 1),
                                                details: hex.substr(1),
                                                type: 'action',
                                                fa: 'fas fa-stop',
                                                faStyle: 'color: '+ hex,
                                                action: async () => {
                                                    if (hex != config.get('background-color')) {
                                                        config.set('background-color', hex);
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
                                            value: () => config.get('background-color'),
                                            action: async (data, value) => {
                                                if (String(value).match(new RegExp('^#?[0-9a-fA-F]{6}$'))) { // TypeError: value.match is not a function 
                                                    if (value.length == 6) {
                                                        value = '#' + value;
                                                    }
                                                    config.set('background-color', value);
                                                    await this.update()
                                                    menu.back()
                                                } else {
                                                    menu.displayErr(lang.INCORRECT_FORMAT);
                                                }
                                            }
                                        });
                                        return colors;
                                    },
                                    value: () => {
                                        return config.get('background-color');
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
                                        config.set('background-color-transparency', value)
                                        await this.update()
                                    },
                                    value: () => {
                                        return config.get('background-color-transparency');
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
                                            this.colors(this.customBackgroundImagePath, c => this.colorLightLevel(c) > 70, 32).then(colors => {
                                                colors = this.colorsAddDefaults(colors, true).map((c, i) => {
                                                    let hex = this.rgbToHex.apply(this, Object.values(c));
                                                    return {
                                                        name: lang.FONT_COLOR + ' ' + (i + 1),
                                                        type: 'action',
                                                        fa: 'fas fa-stop',
                                                        faStyle: 'color: '+ hex,
                                                        action: async () => {
                                                            let cc = hex;
                                                            if (cc != config.get('font-color')) {
                                                                config.set('font-color', cc);
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
                                                    value: () => config.get('font-color'),
                                                    action: async (data, value) => {
                                                        if (value && value.match(new RegExp('^#?[0-9a-fA-F]{6}$'))) {
                                                            if (value.length == 6) {
                                                                value = '#' + value;
                                                            }
                                                            config.set('font-color', value);
                                                            await this.update()
                                                            menu.back()
                                                        } else {
                                                            menu.displayErr(lang.INCORRECT_FORMAT);
                                                        }
                                                    }
                                                }),
                                                    resolve(colors);
                                            }).catch(err => {
                                                console.error(err);
                                                reject(err);
                                                menu.back();
                                            }).finally(() => {
                                                osd.hide('theme-upload');
                                                renderer.get().emit('set-loading', { name: lang.CHOOSE_BACKGROUND_IMAGE }, false);
                                            });
                                        });
                                    },
                                    value: () => {
                                        return config.get('font-color');
                                    },
                                    placeholder: '#FFFFFF'
                                },
                                {
                                    name: lang.FONT_FAMILY,
                                    type: 'select',
                                    fa: 'fas fa-font',
                                    renderer: () => {
                                        return new Promise(resolve => {
                                            renderer.get().on('fontlist', list => {
                                                renderer.get().removeAllListeners('fontlist');
                                                resolve(list.map(name => {
                                                    return {
                                                        name, type: 'action',
                                                        action: async () => {
                                                            console.warn('CHOSEN FONT', name);
                                                            config.set('font-family', name);
                                                            await this.update()
                                                        }
                                                    }
                                                }))
                                            })
                                            renderer.get().emit('fontlist')
                                        });
                                    }
                                },
                                {
                                    name: lang.UPPERCASE_LETTERS_MENU,
                                    type: 'check',
                                    action: async (data, value) => {
                                        config.set('uppercase-menu', value)
                                        await this.update()
                                    },
                                    checked: () => {
                                        return config.get('uppercase-menu');
                                    }
                                },
                                {
                                    name: lang.FONT_SIZE,
                                    type: 'slider',
                                    fa: 'fas fa-text-width',
                                    range: { start: 1, end: 10 },
                                    action: async (data, value) => {
                                        console.warn('FONT_SIZE', data, value);
                                        config.set('font-size', value);
                                        await this.update()
                                    },
                                    value: () => {
                                        return config.get('font-size');
                                    }
                                }
                            ]
                        },
                        { name: lang.RENAME, fa: 'fas fa-edit', type: 'action', action: () => this.rename(config.get('theme-name')).catch(console.error) },
                        { name: lang.LAYOUT_GRID_SIZE, fa: 'fas fa-th', type: 'group', renderer: this.gridLayoutEntries.bind(this) },
                        {
                            name: 'FX Navigation Intensity',
                            fa: 'fas fa-film',
                            type: 'slider',
                            range: { start: 0, end: 10 },
                            action: async (data, value) => {
                                config.set('fx-nav-intensity', value);
                                await this.update();
                            },
                            value: () => {
                                return config.get('fx-nav-intensity');
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
            renderer: () => this.remoteThemes().catch(console.error)
        });
        return entries
    }
    applyRemoteTheme(url, name = 'Untitled') {        
        const file = this.folder + '/' + sanitize(name) + '.theme.json';
        fs.stat(file, (err, stat) => {
            const next = () => {
                osd.show(lang.LOADING + ' 0%', 'fas fa-download', 'theme', 'persistent');
                Download.file({
                    debug: false,
                    file,
                    url,
                    progress: p => {
                        osd.show(lang.LOADING + ' ' + p + '%', 'fas fa-download', 'theme', 'persistent');
                    },
                    cacheTTL: 24 * 3600
                }).then(async file => {
                    osd.hide('theme')
                    await this.load(file)
                    menu.refreshNow()
                }).catch(e => {                    
                    Download.cache.remove(url)
                    fs.unlink(file, () => {})
                    menu.displayErr(e)
                })
            };
            if (stat && stat.size) {
                fs.unlink(file, next);
            } else {
                next();
            }
        });
    }
    async remoteThemes() {
        const { server } = cloud;
        let themes = await Download.get({ url: server + '/themes/feed.json', responseType: 'json' });
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
                            return config.get('view-size-x');
                        },
                        range: { start: 1, end: 10 },
                        action: async (data, value) => {
                            console.log('gridLayoutX', data, value);
                            if (value != config.get('view-size-x')) {
                                config.set('view-size-x', value);
                                await this.update()
                            }
                        }
                    },
                    {
                        name: lang.VERTICAL,
                        type: 'slider',
                        fa: 'fas fa-ruler-vertical',
                        value: () => {
                            return config.get('view-size-y');
                        },
                        range: { start: 1, end: 8 },
                        action: async (data, value) => {
                            console.log('gridLayoutY', data, value);
                            if (value != config.get('view-size-y')) {
                                config.set('view-size-y', value);
                                await this.update();
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
                            return config.get('view-size-portrait-x');
                        },
                        action: async (data, value) => {
                            console.log('gridLayoutX', data, value);
                            if (value != config.get('view-size-portrait-x')) {
                                config.set('view-size-portrait-x', value);
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
                            return config.get('view-size-portrait-y');
                        },
                        action: async (data, value) => {
                            console.log('gridLayoutY', data, value);
                            if (value != config.get('view-size-portrait-y')) {
                                config.set('view-size-portrait-y', value);
                                await this.update();
                            }
                        }
                    }
                ]
            }
        ];
    }
    refresh() {
        let bgi = config.get('custom-background-image'), bgv = config.get('custom-background-video');
        if (bgv) {
            bgi = '';
            bgv = renderer.get().serve(bgv);
        } else if (bgi) {
            bgi = renderer.get().serve(bgi);
            bgv = '';
        } else {
            bgi = bgv = '';
        }
        renderer.get().emit('theme-update', bgi, bgv, config.get('background-color'), config.get('font-color'), config.get('animate-background'));
    }
    reset() {
        let natts = {};
        this.keys.forEach(k => {
            natts[k] = config.defaults[k];
        });
        config.setMulti(natts);
        this.refresh();
    }
    async load(file) {
        const data = await fs.promises.readFile(file)
        config.set('custom-background-image', '')
        config.set('custom-background-video', '')
        await options.importConfigFile(data, this.keys)
    }
    async update(cb) {
        await this.save()
        this.refresh()
    }
    save() {
        return new Promise(resolve => {
            const current = config.get('theme-name');
            if (current) {
                const filename = sanitize(current) + '.theme.json', file = this.folder + '/' + filename;
                options.prepareExportConfigFile(file + '.tmp', null, this.keys, err => {
                    if (err) {
                        menu.displayErr(err)
                        return reject(err)
                    }
                    moveFile(file + '.tmp', file, err => {
                        if (err) {
                            menu.displayErr(err)
                            return reject(err)
                        }
                        resolve()
                    })
                });
            } else {
                resolve()
            }
        })
    }
    async hook(entries, path) {
        if (path == lang.TOOLS) {
            entries.splice(2, 0, { name: lang.THEMES, fa: 'fas fa-palette', type: 'group', renderer: this.entries.bind(this) });
        }
        return entries
    }
}
export default Theme;
