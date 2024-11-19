import osd from '../osd/osd.js'
import menu from '../menu/menu.js'
import lang from '../lang/lang.js';
import storage from '../storage/storage.js'
import { exec } from 'child_process';
import { EventEmitter } from 'events';
import energy from '../energy/energy.js';
import fs from 'fs';
import downloads from '../downloads/downloads.js';
import AdmZip from 'adm-zip';
import icons from '../icon-server/icon-server.js';
import path from 'path';
import lists from '../lists/lists.js';
import cloud from '../cloud/cloud.js';
import os from 'os';
import diag from '../diagnostics/diagnostics.js';
import np from '../network-ip/network-ip.js';
import ffmpeg from '../ffmpeg/ffmpeg.js';
import decodeEntities from 'decode-entities';
import config from '../config/config.js'
import renderer from '../bridge/bridge.js'
import paths from '../paths/paths.js'
import Download from '../download/download.js'
import { kbfmt, kbsfmt, parseJSON, moment, rmdirSync, ucFirst, ucWords } from '../utils/utils.js'

class Timer extends EventEmitter {
    constructor() {
        super();
        this.timerTimer = 0;
        this.timerData = 0;
        this.timerLabel = false;
    }
    async timer() {
        let opts = [];
        [5, 15, 30, 45].forEach((m) => {
            opts.push({ name: lang.AFTER_X_MINUTES.format(m), details: lang.TIMER, fa: 'fas fa-clock', type: 'group', entries: [], renderer: this.timerChooseAction.bind(this, m) });
        });
        [1, 2, 3].forEach((h) => {
            opts.push({ name: lang.AFTER_X_HOURS.format(h), details: lang.TIMER, fa: 'fas fa-clock', type: 'group', entries: [], renderer: this.timerChooseAction.bind(this, h * 60) });
        });
        return opts;
    }
    timerEntry() {
        let details = '';
        if (this.timerData) {
            details = this.timerData.action + ': ' + moment(this.timerData.end * 1000).fromNow();
            return {
                name: lang.TIMER,
                fa: 'fas fa-stopwatch',
                type: 'action',
                details,
                action: () => {
                    clearTimeout(this.timerData['timer']);
                    this.timerData = 0;
                    menu.refreshNow();
                }
            };
        } else {
            return {
                name: lang.TIMER,
                fa: 'fas fa-stopwatch',
                type: 'group',
                renderer: this.timer.bind(this)
            };
        }
    }
    async timerChooseAction(minutes) {
        var opts = [
            { name: lang.STOP, type: 'action', fa: 'fas fa-stop', action: () => this.timerChosen(minutes, lang.STOP) },
            { name: lang.CLOSE, type: 'action', fa: 'fas fa-times-circle', action: () => this.timerChosen(minutes, lang.CLOSE) }
        ];
        if (!paths.android) {
            opts.push({ name: lang.SHUTDOWN, type: 'action', fa: 'fas fa-power-off', action: () => this.timerChosen(minutes, lang.SHUTDOWN) });
        }
        return opts;
    }
    timerChosen(minutes, action) {
        let t = (Date.now() / 1000);
        this.timerData = { minutes, action, start: t, end: t + (minutes * 60) };
        this.timerData['timer'] = setTimeout(async () => {
            console.warn('TIMER ACTION', this.timerData);
            let action = this.timerData.action
            if (global.streamer.active) {
                if (global.streamer.tuning) {
                    global.streamer.tuning.destroy();
                    global.streamer.tuning = null;
                }
                global.streamer.stop();
            }
            if (action != lang.STOP) {
                let recording = global.premium.recorder && global.premium.recorder.active() ? global.premium.recorder.capture : false, next = () => {
                    if (action == lang.CLOSE) {
                        energy.exit();
                    } else if (action == lang.SHUTDOWN) {
                        this.timerActionShutdown();
                        energy.exit();
                    }
                };
                if (recording) {
                    recording.once('destroy', next);
                } else {
                    next();
                }
            }
            this.timerData = 0;
        }, this.timerData.minutes * 60000);
        menu.open(lang.TOOLS).catch(e => menu.displayErr(e));
    }
    timerActionShutdown() {
        var cmd, secs = 7
        if (process.platform === 'win32') {
            cmd = 'shutdown -s -f -t ' + secs + ' -c "Shutdown system in ' + secs + 's"';
        } else {
            cmd = 'shutdown -h +' + secs + ' "Shutdown system in ' + secs + 's"';
        }
        return exec(cmd, () => {})
    }
}
class PerformanceProfiles extends Timer {
    constructor() {
        super();
        this.uiSetup = false;
        this.profiles = {
            high: {
                'animate-background': 'slow-desktop',
                'auto-test': false,
                'autocrop-logos': true,
                'broadcast-start-timeout': 40,
                'connect-timeout-secs': 10,
                'ffmpeg-broadcast-pre-processing': 'auto',
                'fx-nav-intensity': 2,
                'hls-prefetching': true,
                'in-disk-caching-size': 1024,
                'live-window-time': 180,
                'play-while-loading': true,
                'search-missing-logos': true,
                'show-logos': true,
                'transcoding-resolution': '1080p',
                'mpegts-packet-filter-policy': 1,
                'tune-concurrency': 8,
                'tune-ffmpeg-concurrency': 3,
                'ui-sounds': true
            },
            low: {
                'animate-background': 'none',
                'auto-test': false,
                'autocrop-logos': false,
                'broadcast-start-timeout': 60,
                'connect-timeout-secs': 12,
                'custom-background-video': '',
                'epg': 'disabled',
                'ffmpeg-broadcast-pre-processing': 'no',
                'fx-nav-intensity': 0,
                'hls-prefetching': false,
                'in-disk-caching-size': 768,
                'live-stream-fmt': 'auto',
                'live-window-time': 30,
                'play-while-loading': false,
                'resume': false,
                'search-missing-logos': false,
                'show-logos': false,
                'transcoding-resolution': '480p',
                'mpegts-packet-filter-policy': 1,
                'tune-concurrency': 4,
                'tune-ffmpeg-concurrency': 2,
                'ui-sounds': false
            }
        };
        this.profiles.high['epg-' + lang.locale] = '';
    }
    detectPerformanceMode() {
        let scores = { low: 0, high: 0 };
        Object.keys(this.profiles.low).forEach(att => {
            let cur = config.get(att);
            if (cur == this.profiles.low[att]) {
                scores.low++;
            }
            if (cur == this.profiles.high[att]) {
                scores.high++;
            }
        });
        return scores.low > scores.high ? 'low' : 'high';
    }
    async performance(setup) {
        let cur = this.detectPerformanceMode();
        let txt = lang.PERFORMANCE_MODE_MSG.format(lang.FOR_SLOW_DEVICES, lang.COMPLETE).replaceAll("\n", "<br />");
        if (setup) {
            txt += '<br /><br />' + lang.OPTION_CHANGE_AT_ANYTIME.format(lang.OPTIONS);
        }
        let ret = await menu.dialog([
            { template: 'question', text: lang.PERFORMANCE_MODE, fa: 'fas fa-tachometer-alt' },
            { template: 'message', text: txt },
            { template: 'option', id: 'high', fa: cur == 'high' ? 'fas fa-check-circle' : '', text: lang.COMPLETE },
            { template: 'option', id: 'low', fa: cur == 'low' ? 'fas fa-check-circle' : '', text: lang.FOR_SLOW_DEVICES }
        ], cur);
        console.log('performance-callback', ret);
        if (typeof(this.profiles[ret]) != 'undefined') {
            console.log('performance-callback set', this.profiles[ret])
            config.setMulti(this.profiles[ret])
            global.theme.refresh()
        }
    }
}
class OptionsGPU extends PerformanceProfiles {
    constructor() {
        super();
        this.availableGPUFlags = {
            enable: {
                'in-process-gpu': true,
                'ignore-gpu-blacklist': true,
                'enable-gpu-rasterization': true,
                'force-gpu-rasterization': false,
                'enable-accelerated-video': true,
                'enable-accelerated-video-decode': true,
                'enable-accelerated-mjpeg-decode': true,
                'enable-native-gpu-memory-buffers': true
            },
            disable: {
                'disable-gpu': true,
                'force-cpu-draw': true,
                'disable-gpu-compositing': true,
                'disable-software-rasterizer': true
            }
        };
        this.originalGPUFlags = JSON.stringify(config.get('gpu-flags')); // never change it, will be used to detect config changes and ask for app restarting
    }
    gpuFlagsEntries() {
        const state = config.get('gpu') ? 'enable' : 'disable';
        const opts = Object.keys(this.availableGPUFlags[state]).map(flag => {
            const name = ucFirst(flag.replaceAll('gpu', 'GPU').replaceAll('mjpeg', 'MJPEG').split('-').join(' '), true);
            return {
                name, type: 'check',
                action: (_, checked) => {
                    let flags = config.get('gpu-flags');
                    if (checked) {
                        if (!flags.includes(flag)) {
                            flags.push(flag);
                            const state = config.get('gpu') ? 'enable' : 'disable';
                            const availableFlags = Object.keys(this.availableGPUFlags[state]);
                            flags.sort((a, b) => {
                                return availableFlags.indexOf(b) - availableFlags.indexOf(a);
                            });
                        }
                    } else {
                        flags = flags.filter(f => f != flag);
                    }
                    config.set('gpu-flags', flags);
                },
                checked: () => {
                    let flags = config.get('gpu-flags');
                    return flags.includes(flag);
                }
            };
        });
        opts.push({
            name: lang.RESET,
            fa: 'fas fa-undo-alt',
            type: 'action',
            action: () => {
                this.resetGPUFlags();
                menu.refreshNow();
            }
        });
        return opts;
    }
    resetGPUFlags() {
        const state = config.get('gpu') ? 'enable' : 'disable';
        const opts = Object.keys(this.availableGPUFlags[state]).filter(f => this.availableGPUFlags[state][f] === true);
        config.set('gpu-flags', opts);
    }
    gpuFlagsChanged() {
        return JSON.stringify(config.get('gpu-flags')) != this.originalGPUFlags;
    }
    gpuEntry() {
        if (this.gpuFlagsChanged()) {
            const current = JSON.stringify(config.get('gpu-flags'));
            if (this.lastGPUChangeAsked != current) {
                this.lastGPUChangeAsked = current;
                energy.askRestart();
            }
        }
        return {
            name: 'GPU rendering',
            type: 'group',
            fa: 'fas fa-microchip',
            renderer: this.gpuEntries.bind(this)
        };
    }
    async gpuEntries() {
        let opts = [
            {
                name: lang.ENABLE, type: 'check',
                action: (data, checked) => {
                    config.set('gpu', checked);
                    this.resetGPUFlags();
                    menu.refreshNow();
                },
                checked: () => {
                    return config.get('gpu');
                }
            },
            {
                name: lang.CONFIGURE,
                type: 'group',
                fa: 'fas fa-cog',
                renderer: this.gpuFlagsEntries.bind(this)
            }
        ];
        opts.push({
            name: 'Use HTML5 Fullscreen API',
            type: 'check',
            action: (_, checked) => {
                config.set('fsapi', checked);
            },
            checked: () => {
                return config.get('fsapi');
            }
        });
        return opts;
    }
}
class OptionsExportImport extends OptionsGPU {
    constructor() {
        super()
    }
    async importConfigFile(data, keysToImport, cb) {
        data = parseJSON(String(data))
        if (typeof(data) == 'object') {
            data = this.prepareImportConfigFile(data, keysToImport)
            config.setMulti(data)
            osd.show('OK', 'fas fa-check-circle faclr-green', 'options', 'normal')
            await global.theme.update()
        } else {
            throw 'Not a JSON file.'
        }
    }
    prepareImportConfigFile(atts, keysToImport) {
        let natts = {};
        Object.keys(atts).forEach(k => {
            if (!Array.isArray(keysToImport) || keysToImport.includes(k)) {
                natts[k] = atts[k];
            }
        })
        if (natts['custom-background-image']) {
            const buf = Buffer.from(natts['custom-background-image'], 'base64');
            fs.writeFileSync(global.theme.customBackgroundImagePath, buf);
            natts['custom-background-image'] = global.theme.customBackgroundImagePath;
        }
        if (natts['custom-background-video']) {
            const buf = Buffer.from(natts['custom-background-video'], 'base64');
            const uid = parseInt(Math.random() * 1000);
            const file = global.theme.customBackgroundVideoPath + '-' + uid + '.mp4';
            fs.writeFileSync(file, buf);
            natts['custom-background-video'] = file;
            global.theme.cleanVideoBackgrounds(file);
        }
        return natts;
    }
    prepareExportConfig(atts, keysToExport) {
        let natts = {}        
        if (!atts) {
            atts = config.data;
        }
        Object.keys(atts).forEach(k => {
            if (!Array.isArray(keysToExport) || keysToExport.includes(k)) {
                if (atts[k] != config.defaults[k]) {
                    natts[k] = atts[k];
                }
            }
        });
        if (typeof(natts['custom-background-image']) == 'string' && natts['custom-background-image']) {
            let buf = fs.readFileSync(natts['custom-background-image']);
            if (buf) {
                natts['custom-background-image'] = buf.toString('base64');
            } else {
                delete natts['custom-background-image'];
            }
        }
        if (typeof(natts['custom-background-video']) == 'string' && natts['custom-background-video']) {
            let buf = fs.readFileSync(natts['custom-background-video']);
            if (buf) {
                natts['custom-background-video'] = buf.toString('base64');
            } else {
                delete natts['custom-background-video'];
            }
        }
        return natts;
    }
    prepareExportConfigFile(file, atts, keysToExport, cb) {
        
        fs.writeFile(file, JSON.stringify(this.prepareExportConfig(atts, keysToExport), null, 3), { encoding: 'utf-8' }, err => {
            cb(err, file);
        });
    }
    async import(file) {
        if (file.endsWith('.json')) { // is json?            
            await this.importConfigFile(await fs.promises.readFile(file))
            osd.show(lang.IMPORTED_FILE, 'fas fa-check-circle', 'options', 'normal');
        } else {
            let err;
            try {
                const zip = new AdmZip(file), imported = {};
                for (const entry of zip.getEntries()) {
                    if (entry.entryName.startsWith('config')) {
                        zip.extractEntryTo(entry, path.dirname(config.file), false, true);
                        imported.config = entry.getData().toString('utf8');
                    }
                    if (['bookmarks', 'history', 'epg-history'].some(k => entry.entryName.startsWith(k))) {
                        zip.extractEntryTo(entry, storage.opts.folder, false, true);
                    }
                    if (entry.entryName.startsWith('categories')) {
                        zip.extractEntryTo(entry, storage.opts.folder, false, true, path.basename(storage.resolve(global.channels.channelList.key)));
                        global.channels.load();
                    }
                    if (entry.entryName.startsWith('icons')) {
                        try {
                            zip.extractEntryTo(entry, path.dirname(icons.opts.folder), true, true); // Error: ENOENT: no such file or directory, chmod 'C:\\Users\\samsung\\AppData\\Local\\Megacubo\\Data\\icons\\a&e-|-a-&-e.png'
                        }
                        catch (e) {}
                    }
                    if (entry.entryName.startsWith('Themes')) {
                        zip.extractEntryTo(entry, path.dirname(global.theme.folder), true, true);
                    }
                }
                if (imported.config) {
                    console.warn('CONFIG', imported.config);
                    config.reload(imported.config);
                }
                await storage.cleanup(); // import bookmarks and history to config
                osd.show(lang.IMPORTED_FILE, 'fas fa-check-circle', 'options', 'normal');
            }
            catch (e) {
                menu.displayErr(e);
            }
        }
    }
    export(cb) {
        const zip = new AdmZip(), files = [];
        const add = (path, subDir) => {
            if (fs.existsSync(path)) {
                if (typeof(subDir) == 'string') {
                    zip.addLocalFolder(path, subDir);
                } else {
                    zip.addLocalFile(path);
                }
            }
        };
        add(config.file);
        [global.channels.bookmarks.key, global.channels.history.key, global.channels.channelList.key].forEach(key => {
            files.push(storage.resolve(key, false));
            files.push(storage.resolve(key, true));
        });
        files.forEach(add);
        add(global.theme.folder, 'Themes');
        add(icons.opts.folder, 'icons');
        const { temp } = paths;
        zip.writeZip(temp + '/megacubo.export.zip');
        cb(temp + '/megacubo.export.zip');
    }
}
class Options extends OptionsExportImport {
    constructor() {
        super()
        renderer.ui.on('devtools', () => this.devtools());
    }
    async tools() {
        let entries = [
            this.openURLEntry(),
            this.timerEntry()
        ];
        return entries;
    }
    async showLanguageEntriesDialog() {
        const restart = config.get('communitary-mode-lists-amount');
        let options = [], def = lang.locale;
        let map = await lang.availableLocalesMap();
        Object.keys(map).forEach(id => {
            options.push({
                text: map[id] || id,
                template: 'option',
                fa: 'fas fa-language',
                id
            });
        });
        options.push({
            text: lang.IMPROVE_TRANSLATIONS,
            template: 'option',
            fa: 'fas fa-question-circle',
            id: 'improve'
        });
        let locale = await menu.dialog([
            { template: 'question', text: lang.SELECT_LANGUAGE, fa: 'fas fa-language' }
        ].concat(options), def);
        if (locale == 'improve') {
            renderer.ui.emit('open-external-url', 'https://github.com/EdenwareApps/megacubo/tree/master/www/nodejs-project/lang');
            return await this.showLanguageEntriesDialog();
        }
        const _def = config.get('locale') || lang.locale;
        if (locale) {
            if (locale != _def) {
                osd.show(lang.PROCESSING, 'fa-mega spin-x-alt', 'countries', 'persistent');
                config.set('countries', []);
                config.set('locale', locale);
                let texts = await lang.loadLanguage(locale).catch(console.error);
                if (texts) {
                    lang.locale = locale;
                    lang.applyTexts(texts);
                    renderer.ui.emit('lang', texts);
                    menu.pages = { '': [] };
                    menu.refreshNow();
                }
                osd.hide('countries');
            }
            const countries = lang.countries.getCountriesFromLanguage(locale);
            const pcountries = lang.countries.orderCodesBy(countries, 'population', true).slice(0, 4);
            await this.country([...pcountries, ...countries.filter(c => !pcountries.includes(c))], true).catch(console.error);
            restart && energy.restart();
        }
    }
    async country(suggestedCountries, force) {
        if (!Array.isArray(suggestedCountries) || !suggestedCountries.length) {
            suggestedCountries = lang.alternateCountries;
        }
        if ((force || !config.get('country')) && suggestedCountries && suggestedCountries.length) {
            const to = lang.locale;
            const opts = [
                { template: 'question', fa: 'fas fa-info-circle', text: lang.SELECT_COUNTRY }
            ].concat(suggestedCountries.map(id => {
                const text = lang.countries.getCountryName(id, to);
                return { template: 'option', fa: 'fas fa-globe', text, id };
            }));
            opts.push({ template: 'option', text: lang.OTHER_COUNTRIES, details: lang.ALL, fa: 'fas fa-globe', id: 'countries' });
            let ret = suggestedCountries.length == 1 ? suggestedCountries[0] : (await menu.dialog(opts));
            if (ret == 'countries') {
                const nopts = opts.slice(0, 1).concat(lang.countries.getCountries().map(id => {
                    const text = lang.countries.getCountryName(id, to);
                    return { template: 'option', fa: 'fas fa-globe', text, id };
                }));
                ret = await menu.dialog(nopts);
            }
            osd.show(lang.PROCESSING, 'fa-mega spin-x-alt', 'countries', 'persistent'); // update language of message
            if (!ret && force) {
                ret = suggestedCountries[0];
            }
            if (ret && lang.countries.countryCodeExists(ret)) {
                lang.countryCode = ret; // reference for upcoming lang.getActiveCountries()
                config.set('country', ret);
                config.set('countries', []); // reset
                let countries = await lang.getActiveCountries();
                config.set('countries', countries);
                menu.pages = { '': [] };
                menu.refreshNow();
                await global.channels.load();
                await lists.discovery.reset();
                await global.channels.trending.update();
            }
            osd.hide('countries');
        }
    }
    async countriesEntries(chosenLocale, path) {
        if (!path) {
            path = menu.path;
        }
        const entries = [], locale = chosenLocale === true ? null : (chosenLocale || lang.countryCode);
        let map = await lang.getCountriesMap(locale, chosenLocale ? [] : config.get('countries'));
        if (!chosenLocale && !map.length) {
            map = await lang.getCountriesMap([lang.locale]);
        }
        let actives = config.get('countries');
        if (!actives || !actives.length) {
            actives = await lang.getActiveCountries();
        }
        if (typeof(this.countriesEntriesOriginalActives) == 'undefined') {
            this.countriesEntriesOriginalActives = actives.slice(0);
        }
        entries.push({
            name: lang.BACK,
            type: 'back',
            fa: menu.backIcon,
            path: lang.OPTIONS,
            tabindex: 0,
            action: async () => {
                osd.hide('click-back-to-save');
                let actives = config.get('countries');
                if (!actives.length) {
                    actives = await lang.getActiveCountries();
                }
                if (this.countriesEntriesOriginalActives.sort().join(',') != actives.sort().join(',')) {
                    await lists.discovery.reset();
                    energy.askRestart();
                }
                menu.open(lang.OPTIONS).catch(e => menu.displayErr(e));
            }
        });
        if (map.some(row => !actives.includes(row.code))) {
            entries.push({
                name: lang.SELECT_ALL,
                type: 'action',
                fa: 'fas fa-check-circle',
                action: () => {
                    config.set('countries', map.map(row => row.code));
                    menu.refreshNow();
                }
            });
        } else {
            entries.push({
                name: lang.DESELECT_ALL,
                type: 'action',
                fa: 'fas fa-times-circle',
                action: () => {
                    config.set('countries', []);
                    menu.refreshNow();
                }
            });
        }        
        entries.push(...lists.tools.sort(map).map(row => {
            return {
                name: row.name,
                type: 'check',
                action: (e, checked) => {
                    if (checked) {
                        if (!actives.includes(row.code)) {
                            actives.push(row.code);
                        }
                    } else {
                        let pos = actives.indexOf(row.code);
                        if (pos != -1) {
                            actives.splice(pos, 1);
                        }
                    }
                    config.set('countries', actives);
                },
                checked: () => {
                    return actives.includes(row.code);
                }
            };
        }));
        if (chosenLocale !== true) {
            let options = [], def = lang.locale;
            let map = await lang.availableLocalesMap();
            Object.keys(map).forEach(id => {
                options.push({
                    name: map[id] || id,
                    type: 'group',
                    fa: 'fas fa-language',
                    renderer: async () => this.countriesEntries(id, path)
                });
            });
            options.push({
                name: lang.OTHER_COUNTRIES,
                details: lang.ALL,
                fa: 'fas fa-chevron-right',
                type: 'group',
                renderer: () => this.countriesEntries(true, path)
            });
            entries.push({
                name: lang.ALL,
                fa: 'fas fa-chevron-right',
                type: 'group',
                entries: options
            });
        }
        osd.show(lang.WHEN_READY_CLICK_BACK.format(lang.BACK), 'fas fa-info-circle', 'click-back-to-save', 'persistent');
        return entries;
    }
    tos() {
        renderer.ui.emit('open-external-url', 'https://megacubo.net/tos');
    }
    privacy() {
        renderer.ui.emit('open-external-url', 'https://megacubo.net/privacy');
    }
    uninstall() {
        renderer.ui.emit('open-external-url', 'https://megacubo.net/uninstall-info');
    }
    help() {        
        cloud.get('configure').then(c => {
            const url = (c && typeof(c.help) == 'string') ? c.help : paths.manifest.bugs.url;
            renderer.ui.emit('open-external-url', url);
        }).catch(e => menu.displayErr(e));
    }
    share() {
        let locale = lang.locale; // share Megacubo in optimal language
        if (!['en', 'es', 'pt'].includes(locale)) { // Megacubo website languages
            locale = 'en';
        }
        renderer.ui.emit('share', ucWords(paths.manifest.name), ucWords(paths.manifest.name), 'https://megacubo.net/' + locale + '/');
    }
    async about() {        
        let outdated, c = await cloud.get('configure').catch(console.error)
        if (c) {
            console.log('checking update...');
            let vkey = 'version';
            outdated = c[vkey] > paths.manifest.version;
        }
        const notice = paths.ALLOW_ADDING_LISTS ? lang.ABOUT_LEGAL_NOTICE_LISTS : lang.ABOUT_LEGAL_NOTICE;
        let text = lang.LEGAL_NOTICE + ': ' + notice
        let title = ucWords(paths.manifest.name) + ' v' + paths.manifest.version
        let versionStatus = outdated ? (lang.OUTDATED.toUpperCase() +', ') : ''
        title += ' ('+ versionStatus + process.platform +' '+ os.arch()
        if(paths.manifest.megacubo && paths.manifest.megacubo.revision) {
            title += ', revision: '+ paths.manifest.megacubo.revision
        }
        title += ')';
        let ret = await menu.dialog([
            { template: 'question', fa: 'fas fa-mega', text: title },
            { template: 'message', text },
            { template: 'option', text: 'OK', fa: 'fas fa-check-circle', id: 'ok' },
            { template: 'option', text: lang.HELP, fa: 'fas fa-question-circle', id: 'help' },
            { template: 'option', text: lang.LICENSE_AGREEMENT, fa: 'fas fa-info-circle', id: 'tos' },
            { template: 'option', text: lang.PRIVACY_POLICY, fa: 'fas fa-info-circle', id: 'privacy' },
            { template: 'option', text: lang.UNINSTALL, fa: 'fas fa-trash', id: 'uninstall' },
            { template: 'option', text: lang.SHARE, fa: 'fas fa-share-alt', id: 'share' }
        ], 'ok');
        console.log('about-callback', ret);
        switch (ret) {
            case 'privacy':
                this.privacy();
                break;
            case 'tos':
                this.tos();
                break;
            case 'share':
                this.share();
                break;
            case 'help':
                this.help();
                break;
            case 'uninstall':
                this.uninstall();
                break;
        }
    }
    aboutNetwork() {
        menu.info('Network IP', data, 'fas fa-globe');
    }
    async aboutResources() {
        let txt = [];
        await Promise.allSettled([
            diag.checkDisk().then(data => {
                txt[1] = 'Free disk space: ' + kbfmt(data.free) + '<br />';
            }),
            diag.checkMemory().then(freeMem => {
                const used = process.memoryUsage().rss;
                txt[0] = 'App memory usage: ' + kbfmt(used) + '<br />Free memory: ' + kbfmt(freeMem) + '<br />';
            })
        ]);          
        txt[2] = 'Connection speed: ' + kbsfmt(global.streamer.downlink || 0) + '<br />';
        txt[3] = 'User agent: ' + (config.get('user-agent') || config.get('default-user-agent')) + '<br />';
        txt[4] = 'Network IP: ' + np.networkIP() + '<br />';
        txt[5] = 'Language: ' + lang.languageHint + ' (' + lang.countryCode + ')<br />';
        if (process.platform == 'android') {
            txt[4] = 'Network IP: ' + np.androidIPCommand() + '<br />';
        }
        menu.info('System info', txt.join(''), 'fas fa-memory');
    }
    async resetConfig() {
        let text = lang.RESET_CONFIRM;
        let ret = await menu.dialog([
            { template: 'question', text: ucWords(paths.manifest.name) },
            { template: 'message', text },
            { template: 'option', text: lang.YES, fa: 'fas fa-check-circle', id: 'yes' }, { template: 'option', text: lang.NO, fa: 'fas fa-times-circle', id: 'no' }
        ], 'no');
        if (ret == 'yes') {
            try {
                rmdirSync(paths.data, false)
                rmdirSync(paths.temp, false)
            } catch(e) {
                console.error(e)
            }
            await storage.clear(true)
            await fs.promises.unlink(config.file).catch(console.error)
            energy.restart();
        }
    }
    async transcodingEntries() {
        let entries = [
            {
                name: lang.ENABLE,
                type: 'check',
                action: (data, checked) => {
                    config.set('transcoding', checked);
                },
                checked: () => {
                    return config.get('transcoding');
                }
            },
            {
                name: 'Resolution limit when transcoding', type: 'select', fa: 'fas fa-film',
                renderer: async () => {
                    let def = config.get('transcoding-resolution') || '720p', opts = [
                        { name: lang.TRANSCODING_ENABLED_LIMIT_X.format('480p'), type: 'action', selected: (def == '480p'), action: data => {
                                config.set('transcoding-resolution', '480p');
                            } },
                        { name: lang.TRANSCODING_ENABLED_LIMIT_X.format('720p'), type: 'action', selected: (def == '720p'), action: data => {
                                config.set('transcoding-resolution', '720p');
                            } },
                        { name: lang.TRANSCODING_ENABLED_LIMIT_X.format('1080p'), type: 'action', selected: (def == '1080p'), action: data => {
                                config.set('transcoding-resolution', '1080p');
                            } }
                    ];
                    return opts;
                }
            }
        ];
        return entries;
    }
    async chooseExternalPlayer() {
        if (!this.availableExternalPlayers) {
            return await new Promise((resolve, reject) => {
                renderer.ui.once('external-players', players => {
                    this.availableExternalPlayers = players;
                    this.chooseExternalPlayer().then(resolve).catch(reject);
                });
                renderer.ui.emit('get-external-players');
            });
        }
        const keys = Object.keys(this.availableExternalPlayers);
        if (!keys.length)
            return await this.chooseExternalPlayerFile();
        const opts = keys.map(name => {
            return { template: 'option', fa: 'fas fa-play-circle', text: name, id: name };
        });
        opts.unshift({ template: 'question', fa: 'fas fa-window-restore', text: lang.OPEN_EXTERNAL_PLAYER });
        opts.push({ template: 'option', fa: 'fas fa-folder-open', id: 'custom', text: lang.CUSTOMIZE });
        const chosen = await menu.dialog(opts, null, true);
        if (chosen == 'custom')
            return await this.chooseExternalPlayerFile();
        if (chosen && this.availableExternalPlayers[chosen])
            config.set('external-player', chosen);
        osd.show('OK', 'fas fa-check-circle faclr-green', 'external-player', 'normal');
        return chosen;
    }
    async chooseExternalPlayerFile() {
        const file = await menu.chooseFile('*');
        if (file) {
            const name = ucWords(path.basename(file).replace(new RegExp('\.[a-z]{2,4}$'), '').replaceAll('-', ' ').replaceAll('_', ' '));
            config.set('external-player', [file, name]);
            osd.show('OK', 'fas fa-check-circle faclr-green', 'external-player', 'normal');
        }
    }
    async playbackEntries() {
        const opts = [
            {
                name: lang.CONTROL_PLAYBACK_RATE, type: 'check', action: (data, checked) => {
                    config.set('playback-rate-control', checked);
                }, checked: () => {
                    return config.get('playback-rate-control');
                }, details: lang.RECOMMENDED
            },
            {
                name: 'Use FFmpeg pre-processing on live streams',
                fa: 'fas fa-cog',
                type: 'select',
                renderer: async () => {
                    /*
                    Using FFmpeg as middleware breaks HLS multi-tracks feature
                    but for single track streams can help by storing broadcast on disk
                    allowing a bigger in-disk backbuffer (default: auto)
                    */
                    const def = config.get('ffmpeg-broadcast-pre-processing'), opts = [
                        { name: lang.NO, type: 'action', selected: (def == 'no'), action: () => {
                                config.set('ffmpeg-broadcast-pre-processing', 'no');
                            } },
                        { name: lang.AUTO, type: 'action', selected: (def == 'auto' || !['yes', 'no'].includes(def)), action: () => {
                                config.set('ffmpeg-broadcast-pre-processing', 'auto');
                            } },
                        { name: lang.ALWAYS, type: 'action', selected: (def == 'yes'), action: () => {
                                config.set('ffmpeg-broadcast-pre-processing', 'yes');
                            } },
                        { name: lang.ONLY + ' MPEGTS', type: 'action', selected: (def == 'yes'), action: () => {
                                config.set('ffmpeg-broadcast-pre-processing', 'mpegts');
                            } }
                    ];
                    return opts;
                }
            },
            {
                name: lang.PREFERRED_LIVESTREAM_FMT,
                fa: 'fas fa-cog',
                type: 'select',
                renderer: async () => {
                    const go = type => {
                        let changed;
                        const lists = config.get('lists').map(l => {
                            const newUrl = global.lists.mi.setM3UStreamFmt(l[1], type || 'hls'); // hls as default, since it is adaptative and more compatible
                            if (newUrl) {
                                changed = true;
                                l[1] = newUrl;
                            }
                            return l;
                        });
                        config.set('preferred-livestream-fmt', type);
                        if (changed) {
                            config.set('lists', lists);
                        }
                    };
                    const def = String(config.get('preferred-livestream-fmt')), opts = [
                        { name: 'Auto', type: 'action', selected: (!['mpegts', 'hls'].includes(def)), action: () => {
                                go('');
                            } },
                        { name: 'MPEGTS', type: 'action', selected: (def == 'mpegts'), action: () => {
                                go('mpegts');
                            } },
                        { name: 'HLS', type: 'action', selected: (def == 'hls'), action: () => {
                                go('hls');
                            } }
                    ];
                    return opts;
                }
            },
            {
                name: 'Unpause jumpback',
                fa: 'fas fa-undo-alt',
                type: 'select',
                renderer: async () => {
                    const def = config.get('unpause-jumpback'), opts = [
                        { name: lang.DISABLED, type: 'action', selected: (def == 0), action: () => {
                                config.set('unpause-jumpback', 0);
                            } },
                        { name: '2s', type: 'action', selected: (def == 2), action: () => {
                                config.set('unpause-jumpback', 2);
                            } },
                        { name: '5s', type: 'action', selected: (def == 5), action: () => {
                                config.set('unpause-jumpback', 5);
                            } },
                        { name: '10s', type: 'action', selected: (def == 10), action: () => {
                                config.set('unpause-jumpback', 10);
                            } }
                    ];
                    return opts;
                }
            },
            {
                name: lang.ELAPSED_TIME_TO_KEEP_CACHED + ' (' + lang.LIVE + ')',
                fa: 'fas fa-hdd',
                type: 'slider',
                mask: 'time',
                range: { start: 30, end: 7200 },
                action: async (data, value) => {
                    console.warn('ELAPSED_TIME_TO_KEEP_CACHED', data, value)
                    config.set('live-window-time', value)
                    global.streamer.active && global.streamer.reload()
                },
                value: () => {
                    return config.get('live-window-time');
                }
            },
            {
                name: lang.TRANSCODE, type: 'group', fa: 'fas fa-film', renderer: this.transcodingEntries.bind(this)
            }
        ];
        if (!paths.android) {
            opts.unshift({
                name: lang.SET_DEFAULT_EXTERNAL_PLAYER,
                fa: 'fas fa-window-restore',
                type: 'action',
                action: this.chooseExternalPlayer.bind(this)
            });
            opts.push(this.gpuEntry());
        }
        return opts;
    }
    async connectivityEntries() {
        const opts = [
            {
                name: lang.USE_KEEPALIVE, type: 'check',
                action: (data, checked) => {
                    config.set('use-keepalive', checked);
                },
                checked: () => config.get('use-keepalive'),
                details: lang.RECOMMENDED
            },
            {
                name: lang.CONNECT_TIMEOUT,
                fa: 'fas fa-plug',
                type: 'slider',
                mask: 'time',
                range: { start: 3, end: 60 },
                action: (data, value) => {
                    config.set('connect-timeout-secs', value);
                },
                value: () => config.get('connect-timeout-secs')
            },
            {
                name: lang.BROADCAST_START_TIMEOUT,
                fa: 'fas fa-plug',
                type: 'slider',
                mask: 'time',
                range: { start: 20, end: 90 },
                action: (data, value) => {
                    config.set('broadcast-start-timeout', value);
                },
                value: () => config.get('broadcast-start-timeout')
            },
            {
                name: 'IPv6 usage policy', type: 'select', fa: 'fas fa-globe',
                renderer: async () => {
                    // Some lists wont open using a browser user agent
                    let def = config.get('preferred-ip-version');
                    if (typeof(def) != 'number')
                        def = 0;
                    return [
                        {
                            name: lang.BLOCK,
                            value: 4
                        },
                        {
                            name: lang.ALLOW,
                            value: 0
                        },
                        {
                            name: lang.ONLY,
                            value: 6
                        }
                    ].map(n => {
                        return {
                            name: n.name,
                            type: 'action',
                            selected: def == n.value,
                            action: () => {
                                config.set('preferred-ip-version', n.value);
                            }
                        };
                    });
                }
            }
        ];
        if (!paths.android) {
            opts.splice(1, 0, {
                name: 'TCP Fast Open', type: 'check',
                action: (data, checked) => {
                    config.set('tcp-fast-open', checked);
                    energy.askRestart();
                },
                checked: () => config.get('tcp-fast-open')
            });
        }
        return opts;
    }
    async tuneEntries() {
        let opts = [
            {
                name: lang.TEST_STREAMS_AUTO, type: 'check',
                action: (data, checked) => {
                    config.set('auto-test', checked);
                },
                checked: () => config.get('auto-test')
            },
            {
                name: lang.TEST_STREAMS_TYPE, type: 'check',
                action: (data, checked) => {
                    config.set('status-flags-type', checked);
                },
                checked: () => config.get('status-flags-type')
            },
            {
                name: lang.SKIP_PLAY_CHECKING,
                fa: 'fas fa-cog',
                type: 'select',
                renderer: async () => {
                    const def = config.get('tuning-blind-trust'), opts = [
                        { name: lang.NEVER, type: 'action', selected: (def == ''), action: () => {
                                config.set('tuning-blind-trust', '');
                            } },
                        { name: lang.VIDEOS, type: 'action', selected: (def == 'video'), action: () => {
                                config.set('tuning-blind-trust', 'video');
                            } },
                        { name: lang.LIVE, type: 'action', selected: (def == 'live'), action: () => {
                                config.set('tuning-blind-trust', 'live');
                            } },
                        { name: lang.ALWAYS, type: 'action', selected: (def == 'live,video'), action: () => {
                                config.set('tuning-blind-trust', 'live,video');
                            } }
                    ];
                    return opts;
                }
            },
            {
                name: lang.TUNING_CONCURRENCY_LIMIT,
                fa: 'fas fa-poll-h',
                type: 'slider',
                range: { start: 4, end: 32 },
                action: (data, value) => {
                    console.warn('TUNING_CONCURRENCY_LIMIT', data, value);
                    config.set('tune-concurrency', value);
                },
                value: () => config.get('tune-concurrency')
            },
            {
                name: lang.TUNING_FFMPEG_CONCURRENCY_LIMIT,
                fa: 'fas fa-poll-h',
                type: 'slider',
                range: { start: 1, end: 8 },
                action: (data, value) => {
                    console.warn('TUNING_FFMPEG_CONCURRENCY_LIMIT', data, value);
                    config.set('tune-ffmpeg-concurrency', value);
                },
                value: () => config.get('tune-ffmpeg-concurrency')
            },
            {
                name: 'User agent', type: 'select', fa: 'fas fa-user-secret',
                renderer: async () => {
                    // Some lists wont open using a browser user agent
                    let def = config.get('user-agent'), options = [
                        {
                            name: lang.DEFAULT,
                            value: config.get('default-user-agent')
                        },
                        {
                            name: 'VLC',
                            value: 'VLC/3.0.8 LibVLC/3.0.8'
                        },
                        {
                            name: 'Kodi',
                            value: 'Kodi/16.1 (Windows NT 10.0; WOW64) App_Bitness/32 Version/16.1-Git:20160424-c327c53'
                        },
                        {
                            name: lang.CUSTOMIZE,
                            value: 'custom',
                            details: config.get('user-agent') || config.get('default-user-agent')
                        }
                    ].map(n => {
                        return {
                            name: n.name,
                            type: 'action',
                            details: n.details || '',
                            selected: def == n.value,
                            action: async () => {
                                if (n.value == 'custom') {
                                    n.value = await menu.prompt({
                                        question: 'User agent',
                                        placeholder: lang.CUSTOMIZE,
                                        defaultValue: n.details,
                                        fa: 'fas fa-user-secret'
                                    });
                                }
                                if (n.value) {
                                    config.set('user-agent', n.value);
                                    menu.refresh();
                                }
                            }
                        };
                    });
                    return options;
                }
            }
        ];
        return opts;
    }
    requestClearCache() {
        const usage = storage.size();
        const highUsage = usage > (512 * (1024 * 1024));
        const size = '<font class="faclr-' + (highUsage ? 'red' : 'green') + '">' + kbfmt(usage) + '</font>';
        menu.dialog([
            { template: 'question', text: lang.CLEAR_CACHE, fa: 'fas fa-broom' },
            { template: 'message', text: lang.CLEAR_CACHE_WARNING.format(size) },
            { template: 'option', text: lang.YES, id: 'yes', fa: 'fas fa-check-circle' },
            { template: 'option', text: lang.NO, id: 'no', fa: 'fas fa-times-circle' }
        ], 'no').then(ret => {
            if (ret == 'yes')
                this.clearCache().catch(console.error);
        }).catch(console.error);
    }
    async developerEntries() {
        const opts = [
            {
                name: lang.ENABLE_DISK_CACHE,
                fa: 'fas fa-download',
                type: 'slider',
                range: { start: 512, end: 8192 },
                mask: '{0} MB',
                action: (data, value) => {
                    config.set('in-disk-caching-size', value);
                    storage.opts.maxDiskUsage = value * (1024 * 1024);
                    storage.alignLimiter.call().catch(console.error);
                },
                value: () => config.get('in-disk-caching-size')
            },
            {
                name: 'System info', fa: 'fas fa-memory', type: 'action', action: this.aboutResources.bind(this)
            },
            {
                name: lang.FFMPEG_VERSION,
                fa: 'fas fa-info-circle',
                type: 'action',
                action: () => {
                    ffmpeg.diagnosticDialog();
                }
            },
            {
                name: 'Enable console logging', type: 'check', action: (data, checked) => {
                    config.set('enable-console', checked);
                }, checked: () => {
                    return config.get('enable-console');
                }
            },
            {
                name: 'HLS prefetch', details: lang.RECOMMENDED, type: 'check', action: (data, checked) => {
                    config.set('hls-prefetching', checked);
                }, checked: () => {
                    return config.get('hls-prefetching');
                }
            },
            {
                name: 'Lists loading concurrency',
                type: 'slider',
                fa: 'fas fa-cog',
                range: { start: 1, end: 20 },
                action: (data, value) => {
                    config.set('lists-loader-concurrency', value);
                },
                value: () => {
                    return config.get('lists-loader-concurrency')
                }
            },
            {
                name: 'Debug credentials', fa: 'fas fa-key', type: 'action',
                action: () => {
                    const { manager } = lists;
                    manager.debugCredentials().catch(e => menu.displayErr(e));
                }
            },
            {
                name: 'MPEGTS', fa: 'fas fa-film', type: 'group',
                entries: [
                    {
                        name: 'MPEGTS persistent connections', type: 'check', action: (data, checked) => {
                            config.set('mpegts-persistent-connections', checked);
                        }, checked: () => {
                            return config.get('mpegts-persistent-connections') === true;
                        }
                    },
                    {
                        name: 'MPEGTS use worker', type: 'check', action: (data, checked) => {
                            config.set('mpegts-use-worker', checked);
                        }, checked: () => {
                            return config.get('mpegts-use-worker') === true;
                        }
                    },
                    {
                        name: 'MPEGTS packet filter',
                        fa: 'fas fa-cog',
                        type: 'select',
                        renderer: async () => {
                            const def = config.get('mpegts-packet-filter-policy'), opts = [
                                { name: lang.AUTO, type: 'action', selected: (def == 1), action: () => {
                                        config.set('mpegts-packet-filter-policy', 1)
                                    } },
                                { name: 'Trim larger packets, remove smaller ones', type: 'action', selected: (def == 4), action: () => {
                                        config.set('mpegts-packet-filter-policy', 4)
                                    } },
                                { name: 'Remove invalid size packets', type: 'action', selected: (def == 2), action: () => {
                                        config.set('mpegts-packet-filter-policy', 2)
                                    } },
                                { name: 'Ignore invalid size packets', type: 'action', selected: (def == 3), action: () => {
                                        config.set('mpegts-packet-filter-policy', 3)
                                    } },
                                { name: 'Do not remove repetitions', type: 'action', selected: (def == -1), action: () => {
                                        config.set('mpegts-packet-filter-policy', -1)
                                    } }
                            ]
                            return opts
                        }
                    }
                ]
            },
            {
                name: 'FFmpeg CRF',
                fa: 'fas fa-film',
                type: 'slider',
                range: { start: 15, end: 30 },
                action: (data, value) => {
                    config.set('ffmpeg-crf', value);
                },
                value: () => {
                    return config.get('ffmpeg-crf');
                }
            },
            {
                name: 'Debug connections', type: 'check', action: (data, checked) => {
                    Download.debugConns = checked;
                }, checked: () => {
                    return Download.debugConns;
                }
            },
            {
                name: lang.SAVE_REPORT,
                fa: 'fas fa-info-circle',
                type: 'action',
                action: async () => {
                    diag.saveReport().catch(console.error);
                }
            },
            {
                name: lang.ALLOW_UNKNOWN_SOURCES,
                fa: paths.ALLOW_ADDING_LISTS ? 'fas fa-toggle-on' : 'fas fa-toggle-off',
                type: 'select',
                renderer: async () => {                    
                    const privateFile = paths.cwd + '/ALLOW_ADDING_LISTS.md';
                    const communityFile = paths.cwd + '/ALLOW_COMMUNITY.md';
                    const def = paths.ALLOW_COMMUNITY_LISTS ? 2 : (paths.ALLOW_ADDING_LISTS ? 1 : 0), opts = [
                        {
                            name: lang.DO_NOT_ALLOW,
                            type: 'action', selected: (def == 0),
                            action: async (data) => {
                                if (def == 0)
                                    return;
                                config.set('communitary-mode-lists-amount', 0);
                                await fs.promises.unlink(privateFile).catch(console.error);
                                await fs.promises.unlink(communityFile).catch(console.error);
                                config.set('communitary-mode-lists-amount', 0);
                                menu.refreshNow();
                                energy.askRestart();
                            }
                        },
                        {
                            name: lang.ALLOW_ADDING_LISTS,
                            type: 'action', selected: (def == 1),
                            action: async (data) => {
                                if (def == 1)
                                    return;
                                await fs.promises.writeFile(privateFile, 'OK').catch(console.error);
                                await fs.promises.unlink(communityFile).catch(console.error);
                                config.set('communitary-mode-lists-amount', 0);
                                menu.refreshNow();
                                await menu.info(lang.LEGAL_NOTICE, lang.TOS_CONTENT);
                                energy.askRestart();
                            }
                        },
                        {
                            name: lang.ALLOW_SHARING_LISTS,
                            type: 'action', selected: (def == 2),
                            action: async (data) => {
                                if (def == 2)
                                    return;
                                const { opts: { defaultCommunityModeReach } } = lists;
                                await fs.promises.writeFile(privateFile, 'OK').catch(console.error);
                                await fs.promises.writeFile(communityFile, 'OK').catch(console.error);
                                config.set('communitary-mode-lists-amount', defaultCommunityModeReach);
                                menu.refreshNow();
                                await menu.info(lang.LEGAL_NOTICE, lang.TOS_CONTENT);
                                energy.askRestart();
                            }
                        }
                    ];
                    return opts;
                }
            },
            {
                name: 'Config server base URL',
                fa: 'fas fa-server',
                type: 'input',
                action: (e, value) => {
                    if (!value) {
                        value = cloud.defaultServer; // allow reset by leaving field empty
                    }
                    if (value != cloud.server) {
                        cloud.testConfigServer(value).then(() => {
                            osd.show('OK', 'fas fa-check-circle faclr-green', 'config-server', 'persistent');
                            config.set('config-server', value);
                            setTimeout(() => this.clearCache().catch(console.error), 2000); // allow user to see OK message
                        }).catch(e => menu.displayErr(e));
                    }
                },
                value: () => {
                    return config.get('config-server');
                },
                placeholder: cloud.defaultServer
            }
        ];
        if (!paths.android) {
            opts.push({
                name: 'DevTools',
                type: 'action',
                fa: 'fas fa-terminal',
                action: this.devtools.bind(this)
            });
        }
        return opts;
    }
    async clearCache() {
        osd.show(lang.CLEANING_CACHE, 'fa-mega spin-x-alt', 'clear-cache', 'persistent');
        global.streamer.stop();
        global.streamer.tuning && global.streamer.tuning.destroy();
        await storage.clear();
        osd.show('OK', 'fas fa-check-circle faclr-green', 'clear-cache', 'normal');
        config.save();
        energy.restart();
    }
    entries() {
        const { parentalControl } = lists;
        let secOpt = parentalControl.entry();
        let opts = [
            { name: lang.BEHAVIOUR, type: 'group', fa: 'fas fa-window-restore', renderer: async () => {
                    let opts = [
                        {
                            name: lang.RESUME_PLAYBACK, type: 'check',
                            action: (data, checked) => config.set('resume', checked),
                            checked: () => config.get('resume')
                        },
                        {
                            name: lang.TEST_STREAMS_AUTO, type: 'check',
                            action: (data, checked) => {
                                config.set('auto-test', checked);
                            },
                            checked: () => config.get('auto-test')
                        },
                        {
                            name: lang.AUTO_MINIPLAYER, type: 'check',
                            action: (data, checked) => config.set('miniplayer-auto', checked),
                            checked: () => config.get('miniplayer-auto')
                        },
                        {
                            name: lang.SHOW_LOGOS,
                            type: 'check',
                            action: (e, checked) => config.set('show-logos', checked),
                            checked: () => config.get('show-logos')
                        },
                        {
                            name: lang.STRETCH_THUMBNAILS,
                            fa: 'fas fa-expand-alt',
                            type: 'check',
                            action: (data, value) => {
                                config.set('stretch-logos', value);
                                global.theme.update();
                            },
                            checked: () => {
                                return config.get('stretch-logos');
                            }
                        },
                        {
                            name: lang.PLAY_UI_SOUNDS,
                            type: 'check',
                            action: (e, checked) => {
                                config.set('ui-sounds', checked);
                            },
                            checked: () => {
                                return config.get('ui-sounds');
                            }
                        },
                        {
                            name: lang.SEARCH_MISSING_LOGOS,
                            type: 'check',
                            action: (e, checked) => {
                                config.set('search-missing-logos', checked);
                            },
                            checked: () => {
                                return config.get('search-missing-logos');
                            }
                        },
                        {
                            name: lang.HIDE_BACK_BUTTON,
                            type: 'check',
                            action: (data, value) => {
                                config.set('hide-back-button', value);
                                menu.refreshNow();
                            },
                            checked: () => {
                                return config.get('hide-back-button');
                            }
                        },
                        {
                            name: lang.ALSO_SEARCH_YOUTUBE,
                            type: 'check',
                            action: (e, checked) => {
                                config.set('search-youtube', checked);
                                menu.refreshNow();
                            },
                            checked: () => {
                                return config.get('search-youtube');
                            }
                        },
                        {
                            name: lang.FOLDER_SIZE_LIMIT,
                            fa: 'fas fa-folder',
                            type: 'slider',
                            range: { start: 8, end: 2048 },
                            action: (data, value) => {
                                config.set('folder-size-limit', value);
                            },
                            value: () => {
                                return config.get('folder-size-limit');
                            }
                        },
                        {
                            name: lang.TIMEOUT_SECS_ENERGY_SAVING,
                            fa: 'fas fa-leaf',
                            type: 'slider',
                            range: { start: 0, end: 600 },
                            mask: 'time',
                            action: (data, value) => {
                                config.set('timeout-secs-energy-saving', value);
                            },
                            value: () => {
                                return config.get('timeout-secs-energy-saving');
                            }
                        },
                        {
                            name: lang.SHOW_FUN_LETTERS.format(lang.CATEGORY_KIDS),
                            rawname: '[fun]' + decodeEntities(lang.SHOW_FUN_LETTERS.format(lang.CATEGORY_KIDS)) + '[|fun]',
                            type: 'check',
                            action: (e, checked) => {
                                config.set('kids-fun-titles', checked);
                                menu.refreshNow();
                            },
                            checked: () => {
                                return config.get('kids-fun-titles');
                            }
                        },
                        {
                            name: lang.USE_LOCAL_TIME_COUNTER,
                            type: 'check',
                            action: (e, checked) => {
                                config.set('use-local-time-counter', checked);
                            },
                            checked: () => {
                                return config.get('use-local-time-counter');
                            }
                        },
                        {
                            name: lang.NOTIFY_UPDATES,
                            type: 'check',
                            action: (e, checked) => config.set('hide-updates', !checked),
                            checked: () => !config.get('hide-updates')
                        },
                        {
                            name: lang.MATCH_ENTIRE_WORDS,
                            type: 'check',
                            action: (e, checked) => config.set('search-mode', checked ? 0 : 1),
                            checked: () => config.get('search-mode') !== 1
                        },
                        {
                            name: lang.SHOW_RECOMMENDATIONS_HOME,
                            fa: 'fas fa-th',
                            type: 'select',
                            renderer: async () => {
                                const key = 'home-recommendations'
                                const discount = global.menu.pages[''].filter(e => e.side).length + 2 // +1 for entry-2x, +1 for 'More' entry
                                const pagesize = config.get('view-size').landscape.x * config.get('view-size').landscape.y
                                let def = config.get(key), opts = [
                                    {
                                        name: lang.NEVER, fa: 'fas fa-ban', type: 'action', selected: (def == 0), 
                                        action: () => config.set(key, 0)
                                    }
                                ];
                                [2, 3, 4].forEach(n => {
                                    opts.push({
                                        name: lang.X_BROADCASTS.format((n * pagesize) - discount),
                                        fa: 'fas fa-th', type: 'action', selected: (def == n),
                                        action: async () => {
                                            config.set(key, n)
                                            await menu.updateHomeFilters()
                                        }
                                    })
                                })
                                return opts;
                            }
                        }
                    ]
                    if (!paths.android) {
                        opts.push(...[
                            {
                                name: lang.SPEAK_NOTIFICATIONS,
                                type: 'check',
                                action: (_, value) => {
                                    config.set('osd-speak', value);
                                },
                                checked: () => {
                                    return config.get('osd-speak');
                                }
                            },
                            {
                                name: lang.BOOKMARK_CREATE_DESKTOP_ICONS,
                                type: 'check',
                                action: (_, value) => {
                                    config.set('bookmarks-desktop-icons', value);
                                },
                                checked: () => {
                                    return config.get('bookmarks-desktop-icons');
                                }
                            },
                            {
                                name: lang.WINDOW_MODE_TO_START,
                                fa: 'fas fa-window-maximize',
                                type: 'select',
                                renderer: async () => {
                                    let def = config.get('startup-window'), opts = [
                                        { name: lang.NORMAL, fa: 'fas fa-ban', type: 'action', selected: (def == ''), action: data => {
                                                config.set('startup-window', '');
                                            } },
                                        { name: lang.FULLSCREEN, fa: 'fas fa-window-maximize', type: 'action', selected: (def == 'fullscreen'), action: data => {
                                                config.set('startup-window', 'fullscreen');
                                            } }
                                    ];
                                    if (!paths.android) {
                                        opts.push({ name: 'Miniplayer', fa: 'fas fa-level-down-alt', type: 'action', selected: (def == 'miniplayer'), action: data => {
                                                config.set('startup-window', 'miniplayer');
                                            } });
                                    }
                                    return opts;
                                }
                            }
                        ])
                    }
                    opts.push({ name: lang.ADVANCED, fa: 'fas fa-cogs', type: 'action', action: () => {
                        global.menu.open(lang.OPTIONS +'/'+ lang.ADVANCED).catch(console.error)
                    }})
                    return opts
                } },
            { name: lang.PERFORMANCE_MODE, details: lang.SELECT, fa: 'fas fa-tachometer-alt', type: 'action', action: () => this.performance() },
            { name: lang.LANGUAGE, details: lang.SELECT_LANGUAGE, fa: 'fas fa-language', type: 'action', action: () => this.showLanguageEntriesDialog() },
            { name: lang.COUNTRIES, details: lang.COUNTRIES_HINT, fa: 'fas fa-globe', type: 'group', renderer: () => this.countriesEntries() },
            secOpt,
            { name: lang.MANAGE_CHANNEL_LIST, fa: 'fas fa-list', type: 'group', details: lang.LIVE, renderer: global.channels.options.bind(global.channels) },
            { name: lang.ADVANCED, fa: 'fas fa-cogs', type: 'group', renderer: async () => {
                    const opts = [
                        { name: lang.TUNE, fa: 'fas fa-satellite-dish', type: 'group', renderer: this.tuneEntries.bind(this) },
                        { name: lang.PLAYBACK, fa: 'fas fa-play', type: 'group', renderer: this.playbackEntries.bind(this) },
                        { name: lang.CONNECTIVITY, fa: 'fas fa-network-wired', type: 'group', renderer: this.connectivityEntries.bind(this) },
                        {
                            name: lang.CLEAR_CACHE, icon: 'fas fa-broom', class: 'no-icon', type: 'action', action: () => this.requestClearCache()
                        },
                        {
                            name: lang.RESET_CONFIG,
                            type: 'action',
                            fa: 'fas fa-undo-alt',
                            action: () => this.resetConfig()
                        },
                        {
                            name: lang.DEVELOPER_OPTIONS,
                            fa: 'fas fa-cogs',
                            type: 'group',
                            renderer: this.developerEntries.bind(this)
                        }
                    ];
                    return opts;
                } },
            {
                name: lang.EXPORT_IMPORT,
                type: 'group',
                fa: 'fas fa-file-import',
                entries: [
                    {
                        name: lang.EXPORT_CONFIG,
                        type: 'action',
                        fa: 'fas fa-file-export',
                        action: () => {
                            this.export(file => {
                                downloads.serve(file, true, false).catch(e => menu.displayErr(e));
                            });
                        }
                    },
                    {
                        name: lang.IMPORT_CONFIG,
                        type: 'action',
                        fa: 'fas fa-file-import',
                        action: async () => {
                            // Using multiple mimetypes via HTML5 file selector is broken on Capacitor, only first one is picked
                            // application/json, application/zip, application/octet-stream, application/x-zip-compressed, multipart/x-zip
                            const ret = await menu.chooseFile();
                            await this.import(ret);
                        }
                    },
                    {
                        name: lang.RESET_CONFIG,
                        type: 'action',
                        fa: 'fas fa-undo-alt',
                        action: () => this.resetConfig()
                    }
                ]
            }
        ];
        return opts;
    }
    devtools() {
        this.emit('devtools-open')
    }
    prm(strict) {
        const p = global.premium;
        if (p) {
            if (p.active)
                return !strict || p.active == 'activation';
            if (!strict && p.enabling)
                return true;
        }
        const licensed = config.get('premium-license') && !config.get('premium-disable');
        return licensed;
    }
    openURLEntry() {
        return {
            name: lang.OPEN_URL, fa: 'fas fa-link', details: lang.STREAMS, type: 'action',
            action: async () => {
                let err, defaultURL = '';
                const url = config.get('open-url');
                if (!err && url) {
                    defaultURL = url;
                }
                await menu.prompt({
                    question: lang.OPEN_URL,
                    placeholder: 'http://.../example.m3u8',
                    defaultValue: defaultURL,
                    callback: 'open-url',
                    fa: 'fas fa-link'
                });
            }
        };
    }
    async hook(entries, path) {
        if (!path) {
            const sopts = this.prm() ? [lang.RECORDINGS, lang.TIMER] : [lang.TIMER, lang.THEMES];
            const details = sopts.join(', ');
            const headerOptions = [
                { name: lang.TOOLS, side: true, fa: 'fas fa-box-open', type: 'group', details, renderer: this.tools.bind(this) },
                { name: lang.OPTIONS, side: true, fa: 'fas fa-cog', type: 'group', details: lang.CONFIGURE, renderer: this.entries.bind(this) },
                { name: lang.ABOUT, side: true, fa: 'fas fa-info-circle', type: 'action', action: () => {
                        this.about().catch(e => menu.displayErr(e));
                    } },
                { name: lang.SHUTDOWN, side: true, fa: 'fas fa-power-off', type: 'action', action: () => {
                        renderer.ui.emit('ask-exit');
                    } }
            ];
            entries.push(...headerOptions.filter(o => !entries.some(e => e.name == o.name)))
        }
        return entries;
    }
}

export default new Options()