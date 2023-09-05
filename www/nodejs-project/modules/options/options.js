const Events = require('events'), fs = require('fs'), path = require('path')
const decodeEntities = require('decode-entities'), async = require('async')

class Timer extends Events {
    constructor(){
        super()
        this.timerTimer = 0
        this.timerData = 0
        this.timerLabel = false
    }
    async timer(){
        let opts = [];
        [5, 15, 30, 45].forEach((m) => {
            opts.push({name: global.lang.AFTER_X_MINUTES.format(m), details: global.lang.TIMER, fa: 'fas fa-clock', type: 'group', entries: [], renderer: this.timerChooseAction.bind(this, m)});
        });
        [1, 2, 3].forEach((h) => {
            opts.push({name: global.lang.AFTER_X_HOURS.format(h), details: global.lang.TIMER, fa: 'fas fa-clock', type: 'group', entries: [], renderer: this.timerChooseAction.bind(this, h * 60)});
        })
        return opts
    }
    timerEntry(){
        let details = ''
        if(this.timerData){
            details = this.timerData.action +': '+ global.moment(this.timerData.end * 1000).fromNow()
            return {
                name: global.lang.TIMER, 
                fa: 'fas fa-stopwatch',
                type: 'action', 
                details,
                action: () => {
                    clearTimeout(this.timerData['timer'])
                    this.timerData = 0
                    global.explorer.refreshNow()
                }
            }
        } else {
            return {
                name: global.lang.TIMER, 
                fa: 'fas fa-stopwatch',
                type: 'group', 
                renderer: this.timer.bind(this)
            }
        }
    }
    async timerChooseAction(minutes){
        var opts = [
            {name: global.lang.STOP, type: 'action', fa: 'fas fa-stop', action: () => this.timerChosen(minutes, global.lang.STOP)},
            {name: global.lang.CLOSE, type: 'action', fa: 'fas fa-times-circle', action: () => this.timerChosen(minutes, global.lang.CLOSE)}
        ]
        if(!global.cordova){
            opts.push({name: global.lang.SHUTDOWN, type: 'action', fa: 'fas fa-power-off', action: () => this.timerChosen(minutes, global.lang.SHUTDOWN)})
        }
        return opts
    }
    timerChosen(minutes, action){
        let t = global.time()
        this.timerData = {minutes, action, start: t, end: t + (minutes * 60)}
        this.timerData['timer'] = setTimeout(() => {
            console.warn('TIMER ACTION', this.timerData)
            let action = this.timerData.action
            if(global.streamer.active){
                if(global.tuning){
                    global.tuning.destroy()
                }
                global.streamer.stop()
            }
            if(action != global.lang.STOP){
                let recording = global.recorder && global.recorder.active() ? global.recorder.capture : false, next = () => {
                    if(action == global.lang.CLOSE){
                        global.energy.exit()
                    } else if(action == global.lang.SHUTDOWN){
                        this.timerActionShutdown()
                        global.energy.exit()
                    }
                }
                if(recording){
                    recording.once('destroy', next)
                } else {
                    next()
                }
            }
            this.timerData = 0
        }, this.timerData.minutes * 60000)
        global.explorer.open(global.lang.TOOLS).catch(global.displayErr)
    }
    timerActionShutdown(){
        var cmd, secs = 7, exec = require("child_process").exec;
        if(process.platform === 'win32') {
            cmd = 'shutdown -s -f -t '+secs+' -c "Shutdown system in '+secs+'s"';
        } else {
            cmd = 'shutdown -h +'+secs+' "Shutdown system in '+secs+'s"';
        }
        return exec(cmd)
    }
}

class PerformanceProfiles extends Timer {
    constructor(){
        super()
        this.uiSetup = false
        this.profiles = {
            high: {
                'animate-background': 'slow-desktop',
                'auto-testing': true,
                'autocrop-logos': true,
                'broadcast-start-timeout': 40,
                'connect-timeout': 5,
                'ffmpeg-broadcast-pre-processing': 'auto',
                'fx-nav-intensity': 2,
                'hls-prefetching': true,
                'live-window-time': 180,
                'play-while-loading': true,
                'search-missing-logos': true,
                'show-logos': true,
                'transcoding-resolution': '1080p',
                'ts-packet-filter-policy': 1,
                'tune-concurrency': 8,
                'tune-ffmpeg-concurrency': 3,
                'ui-sounds': true
            },
            low: {
                'animate-background': 'none',
                'auto-testing': false,
                'autocrop-logos': false,
                'broadcast-start-timeout': 60,
                'connect-timeout': 10,
                'custom-background-video': '',
                'epg': 'disabled',
                'ffmpeg-broadcast-pre-processing': 'no',
                'fx-nav-intensity': 0,
                'hls-prefetching': false,
                'live-stream-fmt': 'auto',
                'live-window-time': 10,
                'play-while-loading': false,
                'resume': false,
                'search-missing-logos': false,
                'show-logos': false,
                'transcoding-resolution': '480p',
                'ts-packet-filter-policy': 1,
                'tune-concurrency': 4,
                'tune-ffmpeg-concurrency': 2,
                'ui-sounds': false
            }
        }
        this.profiles.high['epg-'+ global.lang.locale] = ''
        global.ui.on('about-dialog', ret => {
            this.about().catch(global.displayErr)
        })
    }
    detectPerformanceMode(){
        let scores = {low: 0, high: 0}
        Object.keys(this.profiles.low).forEach(att => {
            let cur = global.config.get(att)
            if(cur == this.profiles.low[att]){
                scores.low++
            }
            if(cur == this.profiles.high[att]){
                scores.high++
            }
        })
        return scores.low > scores.high ? 'low' : 'high'
    }
    async performance(setup){
        let cur = this.detectPerformanceMode()
        let txt = global.lang.PERFORMANCE_MODE_MSG.format(global.lang.FOR_SLOW_DEVICES, global.lang.COMPLETE).replaceAll("\n", "<br />")
        if(setup){
            txt += '<br /><br />'+ global.lang.OPTION_CHANGE_AT_ANYTIME.format(global.lang.OPTIONS)
        }
        let ret = await global.explorer.dialog([
            {template: 'question', text: global.lang.PERFORMANCE_MODE, fa: 'fas fa-tachometer-alt'},
            {template: 'message', text: txt},
            {template: 'option', id: 'high', fa: cur == 'high' ? 'fas fa-check-circle' : '', text: global.lang.COMPLETE},
            {template: 'option', id: 'low', fa: cur == 'low' ? 'fas fa-check-circle' : '', text: global.lang.FOR_SLOW_DEVICES}
        ], cur)        
        console.log('performance-callback', ret)
        if(typeof(this.profiles[ret]) != 'undefined'){
            console.log('performance-callback set', this.profiles[ret])
            global.config.setMulti(this.profiles[ret])
            if(typeof(this.profiles[ret].epg) != 'undefined'){
                this.updateEPGConfig(this.profiles[ret].epg)
            }
            global.theme.refresh()
        }
    }
}

class OptionsGPU extends PerformanceProfiles {
    constructor() {
        super()
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
        }
        this.originalGPUFlags = JSON.stringify(global.config.get('gpu-flags')) // never change it, will be used to detect config changes and ask for app restarting
    }
    gpuFlagsEntries() {
        const state = global.config.get('gpu') ? 'enable' : 'disable'
        const opts = Object.keys(this.availableGPUFlags[state]).map(flag => {
            const name = global.ucFirst(flag.replaceAll('gpu', 'GPU').replaceAll('mjpeg', 'MJPEG').split('-').join(' '), true)
            return {
                name, type: 'check',
                action: (_, checked) => {
                    let flags = global.config.get('gpu-flags')
                    if(checked) {
                        if(!flags.includes(flag)) {
                            flags.push(flag)
                            const state = global.config.get('gpu') ? 'enable' : 'disable'
                            const availableFlags = Object.keys(this.availableGPUFlags[state])
                            flags.sort((a, b) => {
                                return availableFlags.indexOf(b) - availableFlags.indexOf(a)
                            })
                        }
                    } else {
                        flags = flags.filter(f => f != flag)
                    }
                    global.config.set('gpu-flags', flags)
                },
                checked: () => {
                    let flags = global.config.get('gpu-flags')
                    return flags.includes(flag)
                }
            }
        })
        opts.push({
            name: global.lang.RESET,
            fa: 'fas fa-undo-alt',
            type: 'action',
            action: () => {
                this.resetGPUFlags()
                global.explorer.refreshNow()
            }
        })
        return opts
    }
    resetGPUFlags() {
        const state = global.config.get('gpu') ? 'enable' : 'disable'
        const opts = Object.keys(this.availableGPUFlags[state]).filter(f => this.availableGPUFlags[state][f] === true)
        global.config.set('gpu-flags', opts)
    }
    gpuFlagsChanged() {
        return JSON.stringify(global.config.get('gpu-flags')) != this.originalGPUFlags
    }
    gpuEntry() {
        if(this.gpuFlagsChanged()) {
            const current = JSON.stringify(global.config.get('gpu-flags'))
            if(this.lastGPUChangeAsked != current) {
                this.lastGPUChangeAsked = current
                global.energy.askRestart()
            }
        }
        return {
            name: 'GPU rendering',
            type: 'group',
            fa: 'fas fa-microchip',
            renderer: this.gpuEntries.bind(this)
        }
    }
    async gpuEntries() {
        let opts = [
            {
                name: global.lang.ENABLE, type: 'check',
                action: (data, checked) => {
                    global.config.set('gpu', checked)
                    this.resetGPUFlags()
                    global.explorer.refreshNow()
                },
                checked: () => {
                    return global.config.get('gpu')
                }
            },            
            {
                name: global.lang.CONFIGURE,
                type: 'group',
                fa: 'fas fa-cog',
                renderer: this.gpuFlagsEntries.bind(this)
            }
        ]
        opts.push({
            name: 'Use HTML5 Fullscreen API', 
            type: 'check',
            action: (_, checked) => {
                global.config.set('fsapi', checked)
            },
            checked: () => {
                return global.config.get('fsapi')
            }
        })
        return opts
    }
    async saveGPUReport(){
        let err
        const { app } = require('electron')
        const file = global.downloads.folder +'/gpu-report.txt'
        const report = {
            featureStatus: app.getGPUFeatureStatus(),
            info: await app.getGPUInfo('complete').catch(e => err = e)
        }
        if(err) {
            report.info = String(err)
        }
        await fs.promises.writeFile(file, JSON.stringify(report, null, 3), {encoding: 'utf8'})
        global.downloads.serve(file, true, false).catch(global.displayErr)
    }
}

class OptionsExportImport extends OptionsGPU {
    constructor(){
        super()
    }
    importConfigFile(data, keysToImport, cb){
        console.log('Config file', data)
        try {
            data = global.parseJSON(String(data))
            if(typeof(data) == 'object'){
                data = this.prepareImportConfigFile(data, keysToImport)
                global.config.setMulti(data)
                global.osd.show('OK', 'fas fa-check-circle faclr-green', 'options', 'normal')
                global.theme.update(cb)
            } else {
                throw new Error('Not a JSON file.')
            }
        } catch(e) {
            if(typeof(cb) == 'function'){
                cb(e)
            }
            global.displayErr('Invalid file', e)
        }
    }
    prepareImportConfigFile(atts, keysToImport){
        let natts = {}
        Object.keys(atts).forEach(k => {
            if(!Array.isArray(keysToImport) || keysToImport.includes(k)){
                natts[k] = atts[k]
            }
        })
        if(natts['custom-background-image']){
            const buf = Buffer.from(natts['custom-background-image'], 'base64')
            fs.writeFileSync(global.theme.customBackgroundImagePath, buf)
            natts['custom-background-image'] = global.theme.customBackgroundImagePath
        }
        if(natts['custom-background-video']){
            const buf = Buffer.from(natts['custom-background-video'], 'base64')
            const uid = parseInt(Math.random() * 1000)
            const file = global.theme.customBackgroundVideoPath +'-'+ uid + '.mp4'
            fs.writeFileSync(file, buf)
            natts['custom-background-video'] = file
            global.theme.cleanVideoBackgrounds(file)
        }
        return natts
    }
    prepareExportConfig(atts, keysToExport){
        let natts = {}
        if(!atts){
            atts = global.config.data
        }
        Object.keys(atts).forEach(k => {
            if(!Array.isArray(keysToExport) || keysToExport.includes(k)){
                if(atts[k] != global.config.defaults[k]){
                    natts[k] = atts[k]
                }
            }
        })
        if(typeof(natts['custom-background-image']) == 'string' && natts['custom-background-image']){
            let buf = fs.readFileSync(natts['custom-background-image'])
            if(buf){
                natts['custom-background-image'] = buf.toString('base64')
            } else {
                delete natts['custom-background-image']
            }
        }
        if(typeof(natts['custom-background-video']) == 'string' && natts['custom-background-video']){
            let buf = fs.readFileSync(natts['custom-background-video'])
            if(buf){
                natts['custom-background-video'] = buf.toString('base64')
            } else {
                delete natts['custom-background-video']
            }
        }
        return natts
    }
    prepareExportConfigFile(file, atts, keysToExport, cb){
        fs.writeFile(file, JSON.stringify(this.prepareExportConfig(atts, keysToExport), null, 3), {encoding: 'utf-8'}, err => {
            cb(err, file)
        })
    }
    import(data){
        const sample = String(data.slice(0, 12))
        if(sample.charAt(0) == '{' || sample.charAt(0) == '['){ // is json?
            this.importConfigFile(data)            
            global.osd.show(global.lang.IMPORTED_FILE, 'fas fa-check-circle', 'options', 'normal')
        } else {
            const zipFile = global.paths.temp +'/temp.zip'
            fs.writeFile(zipFile, data, err => {
                if(err){
                    return global.displayErr(err)
                }
                try {
                    const AdmZip = require('adm-zip')
                    const zip = new AdmZip(zipFile), imported = {}
                    async.eachOf(zip.getEntries(), (entry, i, done) => {
                        if(entry.entryName.startsWith('config')) {
                            zip.extractEntryTo(entry, path.dirname(global.config.file), false, true)
                            imported.config = entry.getData().toString('utf8')
                        }
                        if(entry.entryName.startsWith('bookmarks')) {
                            zip.extractEntryTo(entry, global.storage.folder, false, true)
                            delete global.storage.cacheExpiration[global.bookmarks.key]
                            global.bookmarks.load()
                        }
                        if(entry.entryName.startsWith('history')) {
                            zip.extractEntryTo(entry, global.storage.folder, false, true)
                            delete global.storage.cacheExpiration[global.histo.key]
                            global.histo.load()
                        }                    
                        if(entry.entryName.startsWith('categories')) {
                            zip.extractEntryTo(entry, global.storage.raw.folder, false, true, path.basename(global.storage.raw.resolve(global.channels.categoriesCacheKey)))
                            delete global.storage.raw.cacheExpiration[global.channels.categoriesCacheKey]
                            global.channels.load()
                        }
                        if(entry.entryName.startsWith('icons')) {
                            try {
                                zip.extractEntryTo(entry, path.dirname(global.icons.opts.folder), true, true) // Error: ENOENT: no such file or directory, chmod 'C:\\Users\\samsung\\AppData\\Local\\Megacubo\\Data\\icons\\a&e-|-a-&-e.png'
                            } catch(e) {}
                        }
                        if(entry.entryName.startsWith('Themes')) {
                            zip.extractEntryTo(entry, path.dirname(global.theme.folder), true, true)
                        }
                        done()
                    }, () => {
                        if(imported.config) {
                            console.warn('CONFIG', imported.config)
                            global.config.reload(imported.config)
                        }
                        global.osd.show(global.lang.IMPORTED_FILE, 'fas fa-check-circle', 'options', 'normal')
                    })
                } catch(e) {
                    global.displayErr(e)
                }
            })
        }
    }
    export(cb){
        const AdmZip = require('adm-zip')
        const zip = new AdmZip(), files = []
        const add = (path, subDir) => {
            if(fs.existsSync(path)){
                if(typeof(subDir) == 'string'){
                    zip.addLocalFolder(path, subDir)
                } else {
                    zip.addLocalFile(path)
                }
            }
        }
        add(global.config.file);
        [global.bookmarks.key, global.histo.key, global.channels.categoriesCacheKey].forEach(key => {
            files.push(global.storage.resolve(key, false))
            files.push(global.storage.resolve(key, true))
        })
        files.forEach(add)
        add(global.theme.folder, 'Themes')
        add(global.icons.opts.folder, 'icons')
        zip.writeZip(global.paths.temp +'/megacubo.export.zip')
        cb(global.paths.temp +'/megacubo.export.zip')
    }
}

class Options extends OptionsExportImport {
    constructor(){
        super()
        global.ui.on('devtools', () => this.devtools())
        global.ui.on('config-import-file', data => {
            console.warn('!!! IMPORT FILE !!! '+ typeof(global.ui.importFileFromClient), data)
            global.ui.importFileFromClient(data).then(ret => this.import(ret)).catch(global.displayErr)
        })
    }
    async updateEPGConfig(c){
        let activeEPG = global.config.get('epg-'+ global.lang.locale)
        if(activeEPG == 'disabled'){
            activeEPG = false
            await global.lists.manager.setEPG('', false).catch(console.error)
        } else {
            if(!activeEPG || activeEPG == 'auto'){
                if(!c){
                    c = await global.cloud.get('configure').catch(console.error)
                }
                if(c && c.epg){
                    activeEPG = c.epg[global.lang.countryCode] || c.epg[global.lang.locale] || false
                } else {
                    activeEPG = false
                }
            }
            await global.lists.manager.setEPG(activeEPG || '', false).catch(console.error)
        }
    }
    async tools(){
        let err, defaultURL = ''
        const url = await global.storage.raw.promises.get('open-url').catch(e => err = e)
        if(!err && url){
            defaultURL = url
        }
        let entries = [
            {name: global.lang.OPEN_URL, fa: 'fas fa-link', details: global.lang.STREAMS, type: 'action', action: () => {
                global.ui.emit('prompt', global.lang.OPEN_URL, 'http://.../example.m3u8', defaultURL, 'open-url', false, 'fas fa-link')
            }},
            this.timerEntry()
        ]
        return entries
    }
    async showLanguageEntriesDialog(){
        let options = [], def = global.lang.locale
        let map = await global.lang.availableLocalesMap()
        Object.keys(map).forEach(id => {
            options.push({
                text: map[id] || id,
                template: 'option',
                fa: 'fas fa-language',
                id
            })
        })
        let locale = await global.explorer.dialog([
            {template: 'question', text: global.lang.LANGUAGE, fa: 'fas fa-language'}
        ].concat(options), def)
        let _def = global.config.get('locale') || global.lang.locale
        if(locale && (locale != _def)){
            global.config.set('countries', [])
            global.config.set('locale', locale)
            let texts = await global.lang.loadLanguage(locale)
            if(texts){
                global.lang.applyTexts(texts)
                global.ui.emit('lang', texts)
                global.explorer.pages = {'': []}
                global.explorer.refreshNow()
            }
        }
    }
    async countriesEntries(allCountries, path){
        if(!path){
            path = global.explorer.path
        }
        const entries = []
        let map = await global.lang.getCountriesMap(
            allCountries === true ? null : global.lang.countries.getCountryLanguages(global.lang.countryCode),
            global.config.get('countries')
        )
        if(!allCountries && !map.length){
            map = await global.lang.getCountriesMap([global.lang.locale])
        }
        let actives = global.config.get('countries')
        if(!actives || !actives.length) {
            actives = await global.lang.getActiveCountries()
        }
        if(typeof(this.countriesEntriesOriginalActives) == 'undefined'){
            this.countriesEntriesOriginalActives = actives.slice(0)
        }
        entries.push({
            name: global.lang.BACK,
            type: 'back',
            fa: global.explorer.backIcon,
            path: global.lang.OPTIONS,
            tabindex: 0,
            action: async () => {
                global.osd.hide('click-back-to-save')
                let actives = global.config.get('countries')
                if(!actives.length) {
                    actives = await global.lang.getActiveCountries()
                }
                if(this.countriesEntriesOriginalActives.sort().join(',') != actives.sort().join(',')){
                    global.energy.askRestart()
                }
                global.explorer.open(global.lang.OPTIONS).catch(displayErr)
            }
        })
        if(map.some(row => !actives.includes(row.code))){
            entries.push({
                name: global.lang.SELECT_ALL,
                type: 'action',
                fa: 'fas fa-check-circle',
                action: () => {
                    global.config.set('countries', map.map(row => row.code))
                    global.explorer.refreshNow()
                }
            })
        } else {
            entries.push({
                name: global.lang.DESELECT_ALL,
                type: 'action',
                fa: 'fas fa-times-circle',
                action: () => {
                    let countries = map.map(row => row.code)
                    if(countries.includes(global.lang.countryCode)){
                        countries = [global.lang.countryCode]
                    } else {
                        countries = countries.slice(0, 1) // at least one country should be enabled
                    }
                    global.config.set('countries', countries)
                    global.explorer.refreshNow()
                }
            })
        }
        entries.push(...global.lists.sort(map).map(row => {
            return {
                name : row.name,
                type: 'check',
                action: (e, checked) => {
                    if(checked){
                        if(!actives.includes(row.code)){
                            actives.push(row.code)
                        }
                    } else {
                        let pos = actives.indexOf(row.code)
                        if(pos != -1){
                            actives.splice(pos, 1)
                        }
                    }
                    global.config.set('countries', actives)
                },
                checked: () => {
                    return actives.includes(row.code)
                }
            }
        }))
        if(allCountries !== true){
            entries.push({
                name: global.lang.OTHER_COUNTRIES,
                fa: 'fas fa-chevron-right',
                type: 'group',
                renderer: () => this.countriesEntries(true, path)
            })
        }
        global.osd.show(global.lang.WHEN_READY_CLICK_BACK.format(global.lang.BACK), 'fas fa-info-circle', 'click-back-to-save', 'persistent')
        return entries
    }
    tos(){
        global.ui.emit('open-external-url', 'https://megacubo.net/tos')
    }
    privacy(){
        global.ui.emit('open-external-url', 'https://megacubo.net/privacy')
    }
    uninstall(){
        global.ui.emit('open-external-url', 'https://megacubo.net/uninstall-info')
    }
    help(){
        global.cloud.get('configure').then(c => {
            const url = (c && typeof(c.help) == 'string') ? c.help : global.MANIFEST.bugs
            global.ui.emit('open-external-url', url)
        }).catch(global.displayErr)
    }
	share(){
        let locale = global.lang.locale // share Megacubo in optimal language
        if(!['en', 'es', 'pt'].includes(locale)) { // Megacubo website languages
            locale = 'en'
        }
		global.ui.emit('share', global.ucWords(global.MANIFEST.name), global.ucWords(global.MANIFEST.name), 'https://megacubo.net/'+ locale +'/')
	}
    async about(){
        let outdated, c = await cloud.get('configure').catch(console.error)
        if(c){
            this.updateEPGConfig(c)
            console.log('checking update...')
            let vkey = 'version'
            outdated = c[vkey] > global.MANIFEST.version
        }
        const os = require('os')
        let text = lang.LEGAL_NOTICE +': '+ lang.ABOUT_LEGAL_NOTICE
        let title = global.ucWords(global.MANIFEST.name) +' v'+ global.MANIFEST.version
        let versionStatus = outdated ? global.lang.OUTDATED : global.lang.CURRENT_VERSION
        title += ' ('+ versionStatus +', ' + process.platform +' '+ os.arch() +')'
        let ret = await global.explorer.dialog([
            {template: 'question', fa: 'fas fa-mega', text: title},
            {template: 'message', text},
            {template: 'option', text: 'OK', fa: 'fas fa-check-circle', id: 'ok'},
            {template: 'option', text: global.lang.HELP, fa: 'fas fa-question-circle', id: 'help'},
            {template: 'option', text: global.lang.LICENSE_AGREEMENT, fa: 'fas fa-info-circle', id: 'tos'},
            {template: 'option', text: global.lang.PRIVACY_POLICY, fa: 'fas fa-info-circle', id: 'privacy'},
            {template: 'option', text: global.lang.UNINSTALL, fa: 'fas fa-trash', id: 'uninstall'},
            {template: 'option', text: global.lang.SHARE, fa: 'fas fa-share-alt', id: 'share'}
        ], 'ok')
        console.log('about-callback', ret)
        switch(ret){
            case 'privacy':
                this.privacy()
                break
            case 'tos':
                this.tos()
                break
            case 'share':
                this.share()
                break
            case 'help':
                this.help()
                break
            case 'uninstall':
                this.uninstall()
                break
        }
    }
    aboutNetwork(){
        global.explorer.info('Network IP', data, 'fas fa-globe')
    }
    aboutResources(){
        let txt = []
        async.parallel([done => {
            global.diag.checkDisk().then(data => {
                txt[1] = 'Free disk space: '+ global.kbfmt(data.free) +'<br />'
            }).catch(console.error).finally(() => done())
        }, done => {
            global.diag.checkMemory().then(freeMem => {
                const used = process.memoryUsage().rss
                txt[0] = 'App memory usage: '+ global.kbfmt(used) +'<br />Free memory: '+ global.kbfmt(freeMem) +'<br />'
            }).catch(console.error).finally(() => done())
        }], () => {
            txt[2] = 'Connection speed: '+ global.kbsfmt(global.streamer.downlink || 0) +'<br />'
            txt[3] = 'User agent: '+ (global.config.get('user-agent') || global.config.get('default-user-agent')) +'<br />'
            txt[4] = 'Network IP: '+ global.networkIP() +'<br />'
            if(process.platform == 'android'){
                txt[4] = global.androidIPCommand() +'<br />'
            } 
            global.explorer.info('System info', txt.join(''), 'fas fa-memory')
        })
    }
    async resetConfig(){
        let text = global.lang.RESET_CONFIRM
        let ret = await global.explorer.dialog([
            {template: 'question', text: global.ucWords(global.MANIFEST.name)},
            {template: 'message', text},
            {template: 'option', text: global.lang.YES, fa: 'fas fa-check-circle', id: 'yes'},            {template: 'option', text: global.lang.NO, fa: 'fas fa-times-circle', id: 'no'}
        ], 'no')
        if(ret == 'yes'){
            global.rmdir(global.paths.data, false, true)
            global.rmdir(global.paths.temp, false, true)
            global.energy.restart()
        }
    }
    async transcodingEntries(){
        let entries = [
            {
                name: global.lang.ENABLE, 
                type: 'check', 
                action: (data, checked) => {
                    global.config.set('transcoding', checked)
                },
                checked: () => {
                    return global.config.get('transcoding')
                }
            },
            {
                name: 'Enable when tuning', 
                type: 'check', 
                action: (data, checked) => {
                    global.config.set('transcoding-tuning', checked)
                },
                checked: () => {
                    return global.config.get('transcoding-tuning')
                }
            },
            {
                name: 'Resolution limit when transcoding', type: 'select', fa: 'fas fa-film',
                renderer: async () => {
                    let def = global.config.get('transcoding-resolution') || '720p', opts = [
                        {name: global.lang.TRANSCODING_ENABLED_LIMIT_X.format('480p'), type: 'action', selected: (def == '480p'), action: data => {
                            global.config.set('transcoding-resolution', '480p')
                        }},
                        {name: global.lang.TRANSCODING_ENABLED_LIMIT_X.format('720p'), type: 'action', selected: (def == '720p'), action: data => {
                            global.config.set('transcoding-resolution', '720p')
                        }},
                        {name: global.lang.TRANSCODING_ENABLED_LIMIT_X.format('1080p'), type: 'action', selected: (def == '1080p'), action: data => {
                            global.config.set('transcoding-resolution', '1080p')
                        }}
                    ]
                    return opts
                }
            }
        ]
        return entries
    }
    chooseExternalPlayer() {
        return new Promise((resolve, reject) => {
            if(!this.availableExternalPlayers) {
                global.ui.once('external-players', players => {
                    this.availableExternalPlayers = players
                    this.chooseExternalPlayer().then(resolve).catch(reject)
                })
                global.ui.emit('get-external-players')
                return
            }
            const keys = Object.keys(this.availableExternalPlayers)
            if(!keys.length) {
                return reject('No external players detected.')
            }
            const opts = keys.map(name => {
                return {template: 'option', fa: 'fas fa-play-circle', text: name, id: name}
            })
            opts.unshift({template: 'question', fa: 'fas fa-window-restore', text: global.lang.OPEN_EXTERNAL_PLAYER})
            global.explorer.dialog(opts, null, true).then(chosen => {
                if(chosen && this.availableExternalPlayers[chosen]) {
                    global.config.set('external-player', chosen)
                }
                global.osd.show('OK', 'fas fa-check-circle faclr-green', 'external-player', 'normal')
                resolve(chosen)
            }).catch(reject)
        })
    }
    async playbackEntries(){
        const opts = [
            {
                name: global.lang.CONTROL_PLAYBACK_RATE, type: 'check', action: (data, checked) => {
                global.config.set('playback-rate-control', checked)
            }, checked: () => {
                return global.config.get('playback-rate-control')
            }, details: global.lang.RECOMMENDED},
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
                    const def = global.config.get('ffmpeg-broadcast-pre-processing'), opts = [
                        {name: global.lang.NO, type: 'action', selected: (def == 'no'), action: () => {
                            global.config.set('ffmpeg-broadcast-pre-processing', 'no')
                        }},
                        {name: global.lang.AUTO, type: 'action', selected: (def == 'auto' || !['yes', 'no'].includes(def)), action: () => {
                            global.config.set('ffmpeg-broadcast-pre-processing', 'auto')
                        }},
                        {name: global.lang.ALWAYS, type: 'action', selected: (def == 'yes'), action: () => {
                            global.config.set('ffmpeg-broadcast-pre-processing', 'yes')
                        }}
                    ]
                    return opts
                }
            },
            {
                name: global.lang.PREFERRED_LIVESTREAM_FMT,
                fa: 'fas fa-cog', 
                type: 'select', 
                renderer: async () => {
                    const go = type => {
                        let changed
                        const lists = global.config.get('lists').map(l => {
                            const newUrl = global.lists.mi.setM3UStreamFmt(l[1], type || 'hls') // hls as default, since it is adaptative and more compatible
                            if(newUrl) {
                                changed = true
                                l[1] = newUrl
                            }
                            return l
                        })
                        global.config.set('preferred-livestream-fmt', type)
                        if(changed) {
                            global.config.set('lists', lists)
                        }
                    }
                    const def = String(global.config.get('preferred-livestream-fmt')), opts = [
                        {name: 'Auto', type: 'action', selected: (!['mpegts', 'hls'].includes(def)), action: () => {
                            go('')
                        }},
                        {name: 'MPEGTS', type: 'action', selected: (def == 'mpegts'), action: () => {
                            go('mpegts')
                        }},
                        {name: 'HLS', type: 'action', selected: (def == 'hls'), action: () => {
                            go('hls')
                        }}
                    ]
                    return opts
                }
            },
            {
                name: 'Unpause jumpback',
                fa: 'fas fa-undo-alt', 
                type: 'select', 
                renderer: async () => {
                    const def = global.config.get('unpause-jumpback'), opts = [
                        {name: global.lang.DISABLED, type: 'action', selected: (def == 0), action: () => {
                            global.config.set('unpause-jumpback', 0)
                        }},
                        {name: '2s', type: 'action', selected: (def == 2), action: () => {
                            global.config.set('unpause-jumpback', 2)
                        }},
                        {name: '5s', type: 'action', selected: (def == 5), action: () => {
                            global.config.set('unpause-jumpback', 5)
                        }},
                        {name: '10s', type: 'action', selected: (def == 10), action: () => {
                            global.config.set('unpause-jumpback', 10)
                        }}
                    ]
                    return opts
                }
            },
            {
                name: global.lang.ELAPSED_TIME_TO_KEEP_CACHED +' ('+ global.lang.LIVE +')',
                fa: 'fas fa-hdd', 
                type: 'slider', 
                mask: 'time',
                range: {start: 30, end: 7200},
                action: (data, value) => {
                    console.warn('ELAPSED_TIME_TO_KEEP_CACHED', data, value)
                    global.config.set('live-window-time', value)
                }, 
                value: () => {
                    return global.config.get('live-window-time')
                }
            },            
            {
                name: global.lang.TRANSCODE, type: 'group', fa: 'fas fa-film', renderer: this.transcodingEntries.bind(this)
            }
        ]
        if(!global.cordova) {
            opts.unshift({
                name: global.lang.SET_DEFAULT_EXTERNAL_PLAYER,
                fa: 'fas fa-window-restore', 
                type: 'action', 
                action: this.chooseExternalPlayer.bind(this)
            })
            opts.push(this.gpuEntry())
        }
        return opts
    }
    async connectivityEntries(){
        const opts = [
            {
                name: global.lang.USE_KEEPALIVE, type: 'check',
                action: (data, checked) => {
                    global.config.set('use-keepalive', checked)
                },
                checked: () => global.config.get('use-keepalive'),
                details: global.lang.RECOMMENDED
            },
            {
                name: 'TCP Fast Open', type: 'check',
                action: (data, checked) => {
                    global.config.set('tcp-fast-open', checked)
                    global.energy.askRestart()
                },
                checked: () => global.config.get('tcp-fast-open')
            }, 
            {
                name: global.lang.CONNECT_TIMEOUT, 
                fa: 'fas fa-plug', 
                type: 'slider', 
                mask: 'time',
                range: {start: 3, end: 30},
                action: (data, value) => {
                    global.config.set('connect-timeout', value)
                }, 
                value: () => global.config.get('connect-timeout')
            },
            {
                name: global.lang.BROADCAST_START_TIMEOUT, 
                fa: 'fas fa-plug', 
                type: 'slider', 
                mask: 'time',
                range: {start: 20, end: 90},
                action: (data, value) => {
                    global.config.set('broadcast-start-timeout', value)
                }, 
                value: () => global.config.get('broadcast-start-timeout')
            },            
            {
                name: 'IPv6 usage policy', type: 'select', fa: 'fas fa-globe',
                renderer: async () => {
                    // Some lists wont open using a browser user agent
                    let def = global.config.get('preferred-ip-version')
                    if(typeof(def) != 'number'){
                        def = -1
                    }
                    return [
                        {
                            name: global.lang.BLOCK,
                            value: 4
                        }, 
                        {
                            name: global.lang.ALLOW,
                            value: -1
                        }, 
                        {
                            name: global.lang.ONLY,
                            value: 6
                        }
                    ].map(n => {
                        return {
                            name: n.name,
                            type: 'action',
                            selected: def == n.value,
                            action: () => {
                                global.config.set('preferred-ip-version', n.value)
                            }
                        }
                    })
                }
            }
        ]
        return opts
    }
    async tuneEntries(){
        let opts = [
            {
                name: global.lang.TEST_STREAMS, type: 'check',
                action: (data, checked) => {
                    global.config.set('auto-testing', checked)
                },
                checked: () => global.config.get('auto-testing')
            },
            {
                name: global.lang.TEST_STREAMS_TYPE, type: 'check',
                action: (data, checked) => {
                    global.config.set('status-flags-type', checked)
                },
                checked: () => global.config.get('status-flags-type')
            },
            {
                name: global.lang.TUNING_CONCURRENCY_LIMIT, 
                fa: 'fas fa-poll-h', 
                type: 'slider', 
                range: {start: 4, end: 32},
                action: (data, value) => {
                    console.warn('TUNING_CONCURRENCY_LIMIT', data, value)
                    global.config.set('tune-concurrency', value)
                }, 
                value: () => global.config.get('tune-concurrency')
            },
            {
                name: global.lang.TUNING_FFMPEG_CONCURRENCY_LIMIT, 
                fa: 'fas fa-poll-h', 
                type: 'slider', 
                range: {start: 1, end: 4},
                action: (data, value) => {
                    console.warn('TUNING_FFMPEG_CONCURRENCY_LIMIT', data, value)
                    global.config.set('tune-ffmpeg-concurrency', value)
                }, 
                value: () => global.config.get('tune-ffmpeg-concurrency')
            },         
            {
                name: 'User agent', type: 'select', fa: 'fas fa-user-secret',
                renderer: async () => {
                    // Some lists wont open using a browser user agent
                    let def = global.config.get('user-agent'), options = [
                        {
                            name: global.lang.DEFAULT,
                            value: ''
                        }, 
                        {
                            name: 'VLC',
                            value: 'VLC/3.0.8 LibVLC/3.0.8'
                        }, 
                        {
                            name: 'Kodi',
                            value: 'Kodi/16.1 (Windows NT 10.0; WOW64) App_Bitness/32 Version/16.1-Git:20160424-c327c53'
                        }
                    ].map(n => {
                        return {
                            name: n.name,
                            type: 'action',
                            selected: def == n.value,
                            action: () => {
                                global.config.set('user-agent', n.value)
                            }
                        }
                    })
                    return options
                }
            }
        ]
        return opts
    }
    requestClearCache(){
        let folders = [global.storage.folder, global.paths.temp, global.icons.opts.folder], size = 0, gfs = require('get-folder-size')
        async.eachOf(folders, (folder, i, done) => {
            gfs(folder, (err, s) => {
                if(!err){
                    size += s
                }
                done()
            })
        }, () => {
            let highUsage = size > (512 * (1024 * 1024))
            size = '<font class="faclr-' + (highUsage ? 'red' : 'green') + '">' + global.kbfmt(size) + '</font>'
            global.explorer.dialog([
                {template: 'question', text: global.lang.CLEAR_CACHE, fa: 'fas fa-broom'},
                {template: 'message', text: global.lang.CLEAR_CACHE_WARNING.format(size)},
                {template: 'option', text: global.lang.YES, id: 'yes', fa: 'fas fa-check-circle'},
                {template: 'option', text: global.lang.NO, id: 'no', fa: 'fas fa-times-circle'}
            ], 'no').then(ret => {
                if(ret == 'yes') this.clearCache()
            }).catch(console.error)
        })
    }
    async developerEntries() {
        const opts = [
            {
                name: 'Config server base URL', 
                fa: 'fas fa-server', 
                type: 'input', 
                action: (e, value) => {
                    if(!value){
                        value = global.cloud.defaultServer // allow reset by leaving field empty
                    }
                    if(value != global.cloud.server){
                        global.cloud.testConfigServer(value).then(() => {
                            global.osd.show('OK', 'fas fa-check-circle faclr-green', 'config-server', 'persistent')
                            global.config.set('config-server', value)
                            setTimeout(() => this.clearCache(), 2000) // allow user to see OK message
                        }).catch(global.displayErr)
                    }
                },
                value: () => {
                    return global.config.get('config-server')
                },
                placeholder: global.cloud.defaultServer
            }, 
            {
                name: 'System info', fa: 'fas fa-memory', type: 'action', action: this.aboutResources.bind(this)
            },
            {
                name: global.lang.FFMPEG_VERSION, 
                fa: 'fas fa-info-circle', 
                type: 'action', 
                action: global.ffmpeg.diagnosticDialog.bind(global.ffmpeg)
            },
            {
                name: 'Enable console logging', type: 'check', action: (data, checked) => {
                global.config.set('enable-console', checked)
            }, checked: () => {
                return global.config.get('enable-console')
            }},
            {
                name: 'HLS prefetch', details: global.lang.RECOMMENDED, type: 'check', action: (data, checked) => {
                global.config.set('hls-prefetching', checked)
            }, checked: () => {
                return global.config.get('hls-prefetching')
            }},
            {
                name: 'MPEGTS Joining', details: global.lang.RECOMMENDED, type: 'check', action: (data, checked) => {
                global.config.set('ts-packet-filter-policy', checked ? 1 : -1)
            }, checked: () => {
                return global.config.get('ts-packet-filter-policy') !== -1                    
            }},
            {
                name: 'FFmpeg CRF',
                fa: 'fas fa-film',
                type: 'slider', 
                range: {start: 15, end: 30},
                action: (data, value) => {
                    global.config.set('ffmpeg-crf', value)
                }, 
                value: () => {
                    return global.config.get('ffmpeg-crf')
                }
            },
            {
                name: 'Debug connections', type: 'check', action: (data, checked) => {
                global.debugConns = checked
            }, checked: () => {
                return global.debugConns
            }},
            {
                name: global.lang.SAVE_REPORT, 
                fa: 'fas fa-info-circle', 
                type: 'action', 
                action: async () => {
                    global.diag.saveReport().catch(console.error)
                }
            }                          
        ]
        if(!global.cordova){
            opts.push({
                name: 'DevTools',
                type: 'action',
                fa: 'fas fa-terminal',
                action: this.devtools.bind(this)
            })
        }
        return opts
    }
    clearCache(){
        global.osd.show(global.lang.CLEANING_CACHE, 'fa-mega spin-x-alt', 'clear-cache', 'persistent')
        global.streamer.stop()
        if(global.tuning){
            global.tuning.destroy()
        }
        let folders = [
            global.storage.folder, 
            global.paths.temp, 
            global.icons.opts.folder
        ]
        async.eachOf(folders, (folder, i, done) => {
            global.rmdir(folder, false, done)
        }, () => {
            global.osd.show('OK', 'fas fa-check-circle faclr-green', 'clear-cache', 'normal')
            global.config.save()
			global.energy.restart()
        })
    }
    entries(){
        let secOpt = global.lists.parentalControl.entry()
        let opts = [
            {name: global.lang.BEHAVIOUR, type: 'group', fa: 'fas fa-window-restore', renderer: async () => {
                let opts = [
                    {
                        name: global.lang.RESUME_PLAYBACK, type: 'check',
                        action: (data, checked) => global.config.set('resume', checked),
                        checked: () => global.config.get('resume')
                    },
                    {
                        name: global.lang.AUTO_MINIPLAYER, type: 'check', 
                        action: (data, checked) => global.config.set('miniplayer-auto', checked),
                        checked: () => global.config.get('miniplayer-auto')
                    },
                    {
                        name: global.lang.SHOW_LOGOS,
                        type: 'check',
                        action: (e, checked) => global.config.set('show-logos', checked),
                        checked: () => global.config.get('show-logos')
                    },
                    {
                        name: global.lang.STRETCH_THUMBNAILS,
                        fa: 'fas fa-expand-alt',
                        type: 'check', 
                        action: (data, value) => {
                            global.config.set('stretch-logos', value)
                            global.theme.update()
                        }, 
                        checked: () => {
                            return global.config.get('stretch-logos')
                        }
                    },                    
                    {
                        name: global.lang.PLAY_UI_SOUNDS,
                        type: 'check',
                        action: (e, checked) => {
                            global.config.set('ui-sounds', checked)
                        }, 
                        checked: () => {
                            return global.config.get('ui-sounds')
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
                        name: global.lang.HIDE_BACK_BUTTON, 
                        type: 'check', 
                        action: (data, value) => {
                            global.config.set('hide-back-button', value)
                            global.explorer.refreshNow()
                        }, 
                        checked: () => {
                            return global.config.get('hide-back-button')
                        }
                    },                                
                    {
                        name: global.lang.ALSO_SEARCH_YOUTUBE,
                        type: 'check',
                        action: (e, checked) => {
                            global.config.set('search-youtube', checked)
                            global.explorer.refreshNow()
                        }, 
                        checked: () => {
                            return global.config.get('search-youtube')
                        }
                    },
                    {
                        name: global.lang.FOLDER_SIZE_LIMIT, 
                        fa: 'fas fa-folder', 
                        type: 'slider', 
                        range: {start: 8, end: 2048},
                        action: (data, value) => {
                            global.config.set('folder-size-limit', value)
                        }, 
                        value: () => {
                            return global.config.get('folder-size-limit')
                        }
                    },
                    {
                        name: global.lang.TIMEOUT_SECS_ENERGY_SAVING, 
                        fa: 'fas fa-leaf', 
                        type: 'slider',
                        range: {start: 0, end: 600},
                        mask: 'time',
                        action: (data, value) => {
                            global.config.set('timeout-secs-energy-saving', value)
                        }, 
                        value: () => {
                            return global.config.get('timeout-secs-energy-saving')
                        }
                    },
                    {
                        name: global.lang.SHOW_FUN_LETTERS.format(global.lang.CATEGORY_KIDS), 
                        rawname: '[fun]'+ decodeEntities(global.lang.SHOW_FUN_LETTERS.format(global.lang.CATEGORY_KIDS)) +'[|fun]', 
                        type: 'check',
                        action: (e, checked) => {
                            global.config.set('kids-fun-titles', checked)
                            global.explorer.refreshNow()
                        }, 
                        checked: () => {
                            return global.config.get('kids-fun-titles')
                        }
                    },
                    {
                        name: global.lang.USE_LOCAL_TIME_COUNTER, 
                        type: 'check', 
                        action: (e, checked) => {
                            global.config.set('use-local-time-counter', checked)
                        }, 
                        checked: () => {
                            return global.config.get('use-local-time-counter')
                        }
                    },
                    {
                        name: global.lang.NOTIFY_UPDATES,
                        type: 'check',
                        action: (e, checked) => global.config.set('hide-updates', !checked),
                        checked: () => !global.config.get('hide-updates')
                    },
                    {
                        name: global.lang.MATCH_ENTIRE_WORDS,
                        type: 'check',
                        action: (e, checked) => global.config.set('search-mode', checked ? 0 : 1),
                        checked: () => global.config.get('search-mode') !== 1
                    }
                ]
                if(!global.cordova){
                    opts.push({
                        name: global.lang.SPEAK_NOTIFICATIONS, 
                        type: 'check', 
                        action: (data, value) => {
                            global.config.set('osd-speak', value)
                        }, 
                        checked: () => {
                            return global.config.get('osd-speak')
                        }
                    })
                }
                opts.push({
                    name: global.lang.WINDOW_MODE_TO_START,
                    fa: 'fas fa-window-maximize', 
                    type: 'select', 
                    renderer: async () => {
                        let def = global.config.get('startup-window'), opts = [
                            {name: global.lang.NORMAL, fa: 'fas fa-ban', type: 'action', selected: (def == ''), action: data => {
                                global.config.set('startup-window', '')
                            }},
                            {name: global.lang.FULLSCREEN, fa: 'fas fa-window-maximize', type: 'action', selected: (def == 'fullscreen'), action: data => {
                                global.config.set('startup-window', 'fullscreen')
                            }}
                        ]
                        if(!global.cordova){
                            opts.push({name: 'Miniplayer', fa: 'fas fa-level-down-alt', type: 'action', selected: (def == 'miniplayer'), action: data => {
                                global.config.set('startup-window', 'miniplayer')
                            }})
                        }
                        return opts
                    }
                })
                return opts
            }},
            {name: global.lang.PERFORMANCE_MODE, details: global.lang.SELECT, fa: 'fas fa-tachometer-alt', type: 'action', action: () => this.performance()},
            {name: global.lang.LANGUAGE, fa: 'fas fa-language', type: 'action', action: () => this.showLanguageEntriesDialog()},
            {name: global.lang.COUNTRIES, details: global.lang.COUNTRIES_HINT, fa: 'fas fa-globe', type: 'group', renderer: () => this.countriesEntries()},
            secOpt,
            {name: global.lang.MANAGE_CHANNEL_LIST, fa: 'fas fa-list', type: 'group', details: global.lang.LIVE, renderer: global.channels.options.bind(global.channels)},
            {name: global.lang.ADVANCED, fa: 'fas fa-cogs', type: 'group', renderer: async () => {
                const opts = [
                    {name: global.lang.TUNE, fa: 'fas fa-satellite-dish', type: 'group', renderer: this.tuneEntries.bind(this)},
                    {name: global.lang.PLAYBACK, fa: 'fas fa-play', type: 'group', renderer: this.playbackEntries.bind(this)},
                    {name: global.lang.CONNECTIVITY, fa: 'fas fa-network-wired', type: 'group', renderer: this.connectivityEntries.bind(this)},
                    {  
                        name: global.lang.CLEAR_CACHE, icon: 'fas fa-broom', type: 'action', action: () => this.requestClearCache()
                    },
                    {
                        name: global.lang.RESET_CONFIG, 
                        type: 'action',
                        fa: 'fas fa-undo-alt', 
                        action: () => this.resetConfig()
                    },
                    {
                        name: global.lang.DEVELOPER_OPTIONS,
                        fa: 'fas fa-cogs', 
                        type: 'group',
                        renderer: this.developerEntries.bind(this)
                    }
                ]
                return opts
            }},
            {
                name: global.lang.EXPORT_IMPORT,
                type: 'group',
                fa: 'fas fa-file-import',
                entries: [
                    {
                        name: global.lang.EXPORT_CONFIG,
                        type: 'action',
                        fa: 'fas fa-file-export', 
                        action: () => {
                            this.export(file => {
                                global.downloads.serve(file, true, false).catch(global.displayErr)
                            })
                        }
                    },
                    {
                        name: global.lang.IMPORT_CONFIG,
                        type: 'action',
                        fa: 'fas fa-file-import', 
                        action: () => {
                            global.ui.emit('open-file', global.ui.uploadURL, 'config-import-file', 'application/json, application/zip, application/octet-stream, application/x-zip-compressed, multipart/x-zip', global.lang.IMPORT_CONFIG)
                        }
                    }
                ]
            }
        ]
        return opts
    }
    devtools(){
        const { BrowserWindow } = require('electron')
        BrowserWindow.getAllWindows().shift().openDevTools()
    }
    prm(strict) {
        const p = global.premium
        if(p && p.active) return !strict || p.active == 'activation'
        if(p && p.enabling) return true
        const licensed = global.config.get('premium-license') && !global.config.get('premium-disable')
        return !!licensed
    }
    insertEntry(entry, entries, preferredPosition=-1, before, after, prop='name'){
        const i = entries.findIndex(e => e[prop] == entry[prop])
        if(i >= 0) entries.splice(i, 1) // is already present
        if(preferredPosition < 0) preferredPosition = entries.length - preferredPosition
        if(before) {
            const f = Array.isArray(before) ? (e => before.some(n => e.name == n || e.hookId == n)) : (e => e.name == before || e.hookId == before)
            const n = entries.findIndex(f)
            if(n >= 0) preferredPosition = n
        }
        if(after) {
            const f = Array.isArray(after) ? (e => after.some(n => e.name == n || e.hookId == n)) : (e => e.name == before || e.hookId == before)
            const n = entries.findLastIndex(f)
            if(n >= 0) preferredPosition = n + 1
        }
        entries.splice(preferredPosition, 0, entry)
    }
    async hook(entries, path){
        if(!path) {
            const sopts = this.prm() ? [global.lang.RECORDINGS, global.lang.TIMER] :  [global.lang.TIMER, global.lang.THEMES]
            const details = sopts.join(', ')
            this.insertEntry({name: global.lang.TOOLS, fa: 'fas fa-box-open', type: 'group', details, renderer: this.tools.bind(this)}, entries, -2)
            this.insertEntry({name: global.lang.OPTIONS, fa: 'fas fa-cog', type: 'group', details: global.lang.CONFIGURE, renderer: this.entries.bind(this)}, entries, -1)
        }
        return entries
    }
}

module.exports = Options
