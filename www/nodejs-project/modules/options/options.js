
const Events = require('events'), fs = require('fs'), path = require('path'), async = require('async')

class Timer extends Events {
    constructor(){
        super()
        this.timerTimer = 0
        this.timerData = 0
        this.timerLabel = false
    }
    timer(){
        return new Promise((resolve, reject) => {
            let opts = [];
            [5, 15, 30, 45].forEach((m) => {
                opts.push({name: global.lang.AFTER_X_MINUTES.format(m), details: global.lang.TIMER, fa: 'fas fa-clock', type: 'group', entries: [], renderer: this.timerChooseAction.bind(this, m)});
            });
            [1, 2, 3].forEach((h) => {
                opts.push({name: global.lang.AFTER_X_HOURS.format(h), details: global.lang.TIMER, fa: 'fas fa-clock', type: 'group', entries: [], renderer: this.timerChooseAction.bind(this, h * 60)});
            })
            resolve(opts)
        })
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
                    global.explorer.refresh()
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
    timerChooseAction(minutes){
        return new Promise((resolve, reject) => {
            var opts = [
                {name: global.lang.STOP, type: 'action', fa: 'fas fa-stop', action: () => this.timerChosen(minutes, global.lang.STOP)},
                {name: global.lang.CLOSE, type: 'action', fa: 'fas fa-times-circle', action: () => this.timerChosen(minutes, global.lang.CLOSE)}
            ]
            if(!global.cordova){
                opts.push({name: global.lang.SHUTDOWN, type: 'action', fa: 'fas fa-power-off', action: () => this.timerChosen(minutes, global.lang.SHUTDOWN)})
            }
            resolve(opts)
        })
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
                'fx-nav-intensity': 2,
                'p2p': true,
                'play-while-loading': true,
                'search-missing-logos': true,
                'show-logos': true,
                'transcoding': '1080p',
                'ts-packet-filter-policy': 1,
                'tune-concurrency': 12,
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
                'fx-nav-intensity': 0,
                'p2p': false,
                'play-while-loading': false,
                'resume': false,
                'search-missing-logos': false,
                'show-logos': false,
                'transcoding': '',
                'ts-packet-filter-policy': 1,
                'tune-concurrency': 4,
                'tune-ffmpeg-concurrency': 2,
                'tuning-prefer-hls': true,
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
                global.updateEPGConfig(this.profiles[ret].epg)
            }
            global.theme.refresh()
        }
    }
}

class OptionsExportImport extends PerformanceProfiles {
    constructor(){
        super()
    }
    importConfigFile(data, keysToImport, cb){
        console.log('Config file', data)
        try {
            data = JSON.parse(String(data))
            if(typeof(data) == 'object'){
                data = this.prepareImportConfigFile(data, keysToImport)
                global.config.setMulti(data)
                global.osd.show('OK', 'fas fa-check-circle', 'options', 'normal')
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

class OptionsHardwareAcceleration extends OptionsExportImport {
    constructor(){
        super()
        this.hwaDisableFlags = ['--disable-gpu', '--force-cpu-draw']
    }
    async setHardwareAcceleration(enable){
        let hasErr
        const fs = require('fs'), file = APPDIR +'/package.json'
        const ret = await fs.promises.access(file, fs.constants.W_OK).catch(err => {
            hasErr = err
        })
        if(hasErr){
            global.explorer.dialog([
                {template: 'question', text: 'Megacubo', fa: 'fas fa-info-circle'},
                {template: 'message', text: 'You must run Megacubo as admin to change this option.'},
                {template: 'option', text: 'OK', id: 'ok'}
            ], 'ok').catch(console.error) // dont wait
            global.explorer.refresh()
        } else {
            let manifest = await fs.promises.readFile(file)
            manifest = JSON.parse(manifest) 
            this.hwaDisableFlags.forEach(flag => {
                manifest['chromium-args'] = manifest['chromium-args'].replace(flag, '').trim()
            });
            if(!enable){
                this.hwaDisableFlags.forEach((flag) => {
                    manifest['chromium-args'] += ' '+ flag
                })
            }
            await fs.promises.writeFile(file, JSON.stringify(manifest, null, 3))
            global.energy.restart()
        }
    }
    getHardwareAcceleration(){
        const fs = require('fs')
        let manifest = String(fs.readFileSync(APPDIR +'/package.json'))
        return !this.hwaDisableFlags.every((flag) => {
            return manifest.indexOf(flag) != -1
        })
    }    
}

class Options extends OptionsHardwareAcceleration {
    constructor(){
        super()
        global.ui.on('config-import-file', data => {
            console.warn('!!! IMPORT FILE !!!', data)
            global.importFileFromClient(data).then(ret => this.import(ret)).catch(err => {
                global.displayErr(err)
            })
        })        
    }
    tools(){
        return new Promise((resolve, reject) => {
            let defaultURL = ''
            global.storage.raw.get('open-url', url => {
                if(url){
                    defaultURL = url
                }
                let entries = [
                    {name: global.lang.OPEN_URL, fa: 'fas fa-link', details: global.lang.STREAMS, type: 'action', action: () => {
                        global.ui.emit('prompt', global.lang.OPEN_URL, 'http://.../example.m3u8', defaultURL, 'open-url', false, 'fas fa-link')
                    }},
                    this.timerEntry()
                ]
                resolve(entries)
            })
        })
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
                global.explorer.refresh()
            }
        }
    }
    async countriesEntries(allCountries, path){
        if(!path){
            path = global.explorer.path
        }
        const entries = []
        let map = await global.lang.getCountriesMap(
            allCountries === true ? null : await global.lang.getCountryLanguages(global.lang.countryCode),
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
                    global.explorer.refresh()
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
                    global.explorer.refresh()
                }
            })
        }
        map.forEach(row => {
            entries.push({
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
            })
        })
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
		global.ui.emit('share', global.ucWords(global.MANIFEST.name), global.ucWords(global.MANIFEST.name), 'https://megacubo.net/')
	}
    async about(){
        let outdated
        let c = await cloud.get('configure').catch(console.error)
        if(c){
            updateEPGConfig(c)
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
            {template: 'question', fa: 'fas fa-info-circle', text: title},
            {template: 'message', text},
            {template: 'option', text: 'OK', fa: 'fas fa-check-circle', id: 'ok'},
            {template: 'option', text: global.lang.HELP, fa: 'fas fa-question-circle', id: 'help'},
            {template: 'option', text: global.lang.LICENSE_AGREEMENT, fa: 'fas fa-info-circle', id: 'tos'},
            {template: 'option', text: global.lang.PRIVACY_POLICY, fa: 'fas fa-info-circle', id: 'privacy'},
            {template: 'option', text: global.lang.UNINSTALL, fa: 'fas fa-info-circle', id: 'uninstall'},
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
    aboutResources(){
        let txt = []
        async.parallel([done => {
            global.diagnostics.checkDisk().then(data => {
                txt[1] = 'Free disk space: '+ global.kbfmt(data.free) +'<br />'
            }).catch(console.error).finally(() => done())
        }, done => {
            global.diagnostics.checkMemory().then(freeMem => {
                const used = process.memoryUsage().rss
                txt[0] = 'App memory usage: '+ global.kbfmt(used) +'<br />Free memory: '+ global.kbfmt(freeMem) +'<br />'
            }).catch(console.error).finally(() => done())
        }], () => {
            txt[2] = 'Connection speed: '+ global.kbsfmt(global.streamer.downlink || 0) +'<br />'
            txt[3] = 'User agent: '+ (global.config.get('user-agent') || global.config.get('default-user-agent')) +'<br />'
            global.explorer.info('System info', txt.join(''), 'fas fa-memory')
        })
    }
    aboutNetwork(){
        let data = 'Network IP: '+ global.networkIP()
        if(process.platform == 'android'){
            data += '<br />'+ global.androidIPCommand()
        } 
        global.explorer.info('Network IP', data, 'fas fa-globe')
    }
    async resetConfig(){
        let text = global.lang.RESET_CONFIRM
        let ret = await global.explorer.dialog([
            {template: 'question', text: global.ucWords(global.MANIFEST.name)},
            {template: 'message', text},
            {template: 'option', text: global.lang.YES, fa: 'fas fa-info-circle', id: 'yes'},
            {template: 'option', text: global.lang.NO, fa: 'fas fa-times-circle', id: 'no'}
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
                renderer: () => {
                    return new Promise((resolve, reject) => {
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
                        resolve(opts)
                    })
                }
            }
        ]
        return entries
    }
    playbackEntries(){
        return new Promise((resolve, reject) => {
            let opts = [
                {
                    name: global.lang.CONTROL_PLAYBACK_RATE, type: 'check', action: (data, checked) => {
                    global.config.set('playback-rate-control', checked)
                }, checked: () => {
                    return global.config.get('playback-rate-control')
                }, details: 'Recommended'}, 
                {
                    name: 'HLS prefetch', type: 'check', action: (data, checked) => {
                    global.config.set('hls-prefetching', checked)
                }, checked: () => {
                    return global.config.get('hls-prefetching')
                }},
                {
                    name: global.lang.USE_KEEPALIVE, type: 'check', action: (data, checked) => {
                    global.config.set('use-keepalive', checked)
                }, checked: () => {
                    return global.config.get('use-keepalive')
                }, details: 'Recommended'},
                {
                    name: 'Unpause jumpback',
                    fa: 'fas fa-undo', 
                    type: 'select', 
                    renderer: () => {
                        return new Promise((resolve, reject) => {
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
                            resolve(opts)
                        })
                    }
                },            ,
                {
                    name: global.lang.ELAPSED_TIME_TO_KEEP_CACHED, 
                    details: global.lang.LIVE,
                    fa: 'fas fa-hdd', 
                    type: 'slider', 
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
                },
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
                }
            ]
            resolve(opts)
        })
    }
    tuneEntries(){
        return new Promise((resolve, reject) => {
            let opts = [
                {
                    name: global.lang.TEST_STREAMS, type: 'check', action: (data, checked) => {
                    global.config.set('auto-testing', checked)
                }, checked: () => {
                    return global.config.get('auto-testing')
                }},
                {
                    name: global.lang.TEST_STREAMS_TYPE, type: 'check', action: (data, checked) => {
                    global.config.set('status-flags-type', checked)
                }, checked: () => {
                    return global.config.get('status-flags-type')
                }},
                {
                    name: global.lang.PREFER_HLS, type: 'check', action: (data, checked) => {
                    global.config.set('tuning-prefer-hls', checked)
                }, checked: () => {
                    return global.config.get('tuning-prefer-hls')
                }},
                {
                    name: global.lang.TUNING_CONCURRENCY_LIMIT, 
                    fa: 'fas fa-poll-h', 
                    type: 'slider', 
                    range: {start: 4, end: 32},
                    action: (data, value) => {
                        console.warn('TUNING_CONCURRENCY_LIMIT', data, value)
                        global.config.set('tune-concurrency', value)
                    }, 
                    value: () => {
                        return global.config.get('tune-concurrency')
                    }
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
                    value: () => {
                        return global.config.get('tune-ffmpeg-concurrency')
                    }
                },
                {
                    name: global.lang.CONNECT_TIMEOUT, 
                    fa: 'fas fa-plug', 
                    type: 'slider', 
                    range: {start: 3, end: 30},
                    action: (data, value) => {
                        global.config.set('connect-timeout', value)
                    }, 
                    value: () => {
                        return global.config.get('connect-timeout')
                    }
                },
                {
                    name: global.lang.BROADCAST_START_TIMEOUT, 
                    fa: 'fas fa-plug', 
                    type: 'slider', 
                    range: {start: 20, end: 90},
                    action: (data, value) => {
                        global.config.set('broadcast-start-timeout', value)
                    }, 
                    value: () => {
                        return global.config.get('broadcast-start-timeout')
                    }
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
                },       
                {
                    name: 'IPv6 usage policy', type: 'select', fa: 'fas fa-globe',
                    renderer: async () => {
                        // Some lists wont open using a browser user agent
                        let def = global.config.get('prefer-ipv6')
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
                                    global.config.set('prefer-ipv6', n.value)
                                }
                            }
                        })
                    }
                }
            ]
            resolve(opts)
        })
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
    clearCache(){
        global.osd.show(global.lang.CLEANING_CACHE, 'fa-mega spin-x-alt', 'clear-cache', 'persistent')
        global.ui.emit('clear-cache')
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
            global.osd.show('OK', 'fas fa-check-circle', 'clear-cache', 'normal')
            global.config.save()
			global.energy.restart()
        })
    }
    entries(){
        return new Promise((resolve, reject) => {
            let secOpt = global.lists.parentalControl.entry()
            let opts = [
                {name: global.lang.PERFORMANCE_MODE, details: global.lang.SELECT, fa: 'fas fa-tachometer-alt', type: 'action', action: () => this.performance()},
                {name: global.lang.BEHAVIOUR, type: 'group', fa: 'fas fa-window-restore', renderer: async () => {
                    let opts = [
                        {name: global.lang.RESUME_PLAYBACK, type: 'check', action: (data, checked) => {
                            global.config.set('resume', checked)
                        }, checked: () => {
                            return global.config.get('resume')
                        }},
                        {
                            name: global.lang.AUTO_MINIPLAYER, type: 'check', action: (data, checked) => {
                            global.config.set('miniplayer-auto', checked)
                        }, checked: () => {
                            return global.config.get('miniplayer-auto')
                        }},                            
                        {
                            name: global.lang.SHOW_LOGOS,
                            type: 'check',
                            action: (e, checked) => {
                                global.config.set('show-logos', checked)
                            }, 
                            checked: () => {
                                return global.config.get('show-logos')
                            }
                        },   ,
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
                                global.explorer.refresh()
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
                                global.explorer.refresh()
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
                            name: global.lang.USE_LOCAL_TIME_COUNTER, 
                            type: 'check', 
                            action: (e, checked) => {
                                global.config.set('use-local-time-counter', checked)
                            }, 
                            checked: () => {
                                return global.config.get('use-local-time-counter')
                            }
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
                        renderer: () => {
                            return new Promise((resolve, reject) => {
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
                                resolve(opts)
                            })
                        }
                    })
                    return opts
                }},
                {name: global.lang.LANGUAGE, fa: 'fas fa-language', type: 'action', action: () => this.showLanguageEntriesDialog()},
                {name: global.lang.COUNTRIES, details: global.lang.COUNTRIES_HINT, fa: 'fas fa-globe', type: 'group', renderer: () => this.countriesEntries()},
                secOpt,
                {name: global.lang.MANAGE_CHANNEL_LIST, fa: 'fas fa-list', type: 'group', details: global.lang.LIVE, renderer: global.channels.options.bind(global.channels)},
                {name: global.lang.ADVANCED, fa: 'fas fa-cogs', type: 'group', renderer: () => {
                    return new Promise((resolve, reject) => {
                        const opts = [
                            {name: global.lang.TUNE, fa: 'fas fa-satellite-dish', type: 'group', renderer: this.tuneEntries.bind(this)},
                            {name: global.lang.PLAYBACK, fa: 'fas fa-play', type: 'group', renderer: this.playbackEntries.bind(this)},
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
                                entries: [
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
                                        name: 'Unoptimized search', type: 'check', action: (data, checked) => {
                                        global.config.set('unoptimized-search', checked)
                                    }, checked: () => {
                                        return global.config.get('unoptimized-search')
                                    }}, 
                                    {
                                        name: 'System info', fa: 'fas fa-memory', type: 'action', action: this.aboutResources.bind(this)
                                    },
                                    {
                                        name: 'Network IP', fa: 'fas fa-globe', type: 'action', action: this.aboutNetwork.bind(this)
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
                                        name: 'Debug connections', type: 'check', action: (data, checked) => {
                                        global.config.set('debug-conns', checked)
                                    }, checked: () => {
                                        return global.config.get('debug-conns')
                                    }},
                                    {
                                        name: 'Save report log', 
                                        fa: 'fas fa-info-circle', 
                                        type: 'action', 
                                        action: async () => {
                                            global.diagnostics.saveReport().catch(console.error)
                                        }
                                    },
                                    {
                                        name: 'Save crash log', 
                                        fa: 'fas fa-info-circle', 
                                        type: 'action', 
                                        action: async () => {
                                            const filename = 'megacubo-crash-log.txt', file = global.downloads.folder + path.sep + filename
                                            let content = await global.crashlog.read()
                                            fs.writeFile(file, content || 'Empty.', {encoding: 'utf-8'}, err => {
                                                if(err) return global.displayErr(err)
                                                global.downloads.serve(file, true, false).catch(global.displayErr)
                                            })
                                        }
                                    },
                                    {
                                        name: 'Save last tuning log', 
                                        fa: 'fas fa-info-circle', 
                                        type: 'action', 
                                        action: () => {
                                            if(!global.tuning) return global.displayErr('No tuning found')
                                            const filename = 'megacubo-tuning-log.txt', file = global.downloads.folder + path.sep + filename
                                            fs.writeFile(file, global.tuning.logText(), {encoding: 'utf-8'}, err => {
                                                if(err) return global.displayErr(err)
                                                global.debugTuning = true
                                                global.downloads.serve(file, true, false).catch(global.displayErr)
                                                global.ui.emit('debug-tuning', true)
                                            })
                                        }
                                    }                            
                                ]
                            }
                        ]
                        if(!global.cordova){
                            opts[opts.length - 1].entries.push({
                                name: 'GPU rendering', type: 'check', action: (data, checked) => {
                                this.setHardwareAcceleration(checked).catch(global.displayErr)
                            }, checked: () => {
                                return this.getHardwareAcceleration()
                            }})
                        }
                        resolve(opts)
                    })
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
            resolve(opts)
        })
    }
    hook(entries, path){
        return new Promise((resolve, reject) => {
            if(path == '' && !entries.some(e => e.name == global.lang.TOOLS)){
                entries.splice(entries.length - 2, 0, {name: global.lang.TOOLS, fa: 'fas fa-box-open', type: 'group', renderer: this.tools.bind(this)})
                entries = entries.concat([
                    {name: global.lang.OPTIONS, fa: 'fas fa-cog', type: 'group', details: global.lang.CONFIGURE, renderer: this.entries.bind(this)},
                ])
            }
            resolve(entries)
        })
    }
}

module.exports = Options
