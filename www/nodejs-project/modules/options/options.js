
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
                    recording.on('destroy', next)
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

class Options extends Timer {
    constructor(){
        super()
        global.ui.on('about-callback', ret => {
            console.log('about-callback', ret)
            switch(ret){
                case 'tos':
                    this.tos()
                    break
                case 'share':
                    this.share()
                    break
                case 'help':
                    this.help()
                    break
            }
        })
        global.ui.on('reset-callback', ret => {
            console.log('reset-callback', ret)
            switch(ret){
                case 'yes':
                    global.rmdir(global.paths.data, false, true)
                    global.rmdir(global.paths.temp, false, true)
                    global.energy.restart()
                    break
            }
        })
        global.ui.on('locale-callback', locale => {
            let def = global.lang.locale
            if(locale && (locale != def)){
                global.config.set('locale', locale)
                global.energy.restart()
            }
        })
        global.ui.on('clear-cache', ret => {
            if(ret == 'yes') this.clearCache()
        })
        global.ui.on('config-import-file', data => {
            console.warn('!!! IMPORT FILE !!!', data)
            global.importFileFromClient(data).then(ret => this.importConfigFile(ret)).catch(err => {
                global.displayErr(err)
            })
        })
        this.languageNames = {
            en: 'English',
            es: 'Español',
            pt: 'Português',
            it: 'Italiano'
        }
    }
    importConfigFile(data, keysToImport){
        console.log('Config file', data)
        try {
            data = JSON.parse(String(data))
            if(typeof(data) == 'object'){
                data = this.prepareImportConfigFile(data, keysToImport)
                global.config.setMulti(data)
                global.osd.show('OK', 'fas fa-check-circle', 'options', 'normal')
                global.theme.update()
            } else {
                throw new Error('Not a JSON file.')
            }
        } catch(e) {
            global.displayErr('Invalid file', e)
        }
    }
    prepareImportConfigFile(atts, keysToImport){
        let natts = {}
        if(Array.isArray(keysToImport)){
            Object.keys(atts).forEach(k => {
                if(keysToImport.includes(k)){
                    natts[k] = atts[k]
                }
            })
        } else {
            natts = Object.assign(natts, atts)
        }
        if(natts['custom-background-image']){
            const buf = Buffer.from(natts['custom-background-image'], 'base64')
            fs.writeFileSync(global.theme.customBackgroundImagePath, buf)
            natts['custom-background-image'] = global.theme.customBackgroundImagePath
        }
        return natts
    }
    prepareExportConfigFile(atts, keysToExport){
        let natts = {}
        if(Array.isArray(keysToExport)){
            Object.keys(atts).forEach(k => {
                if(keysToExport.includes(k)){
                    natts[k] = atts[k]
                }
            })
        } else {
            natts = Object.assign(natts, atts)
        }
        if(typeof(natts['custom-background-image']) == 'string' && natts['custom-background-image']){
            let buf = fs.readFileSync(natts['custom-background-image'])
            if(buf){
                natts['custom-background-image'] = buf.toString('base64')
            } else {
                delete natts['custom-background-image']
            }
        }
        return natts
    }
    tools(){
        return new Promise((resolve, reject) => {
            let defaultURL = ''
            global.rstorage.get('open-url', url => {
                if(url){
                    defaultURL = url
                }
                let entries = [
                    {name: global.lang.OPEN_URL, fa: 'fas fa-link', type: 'action', action: () => {
                        global.ui.emit('prompt', global.lang.OPEN_URL, 'http://.../example.m3u8', defaultURL, 'open-url', false, 'fas fa-link')
                    }},
                    this.timerEntry()
                ]
                resolve(entries)
            })
        })
    }
    showLanguageEntriesDialog(){
        let options = [], def = global.lang.locale
        let files = fs.readdirSync(global.APPDIR + path.sep + 'lang')
        fs.readdir(global.APPDIR + path.sep + 'lang', (err, files) => {
            if(err){
                console.error(err)
            } else {
                files.forEach(file => {
                    if(file.indexOf('.json') != -1){
                        console.log(file)
                        let locale = file.split('.')[0]
                        options.push({
                            text: typeof(this.languageNames[locale]) != 'undefined' ? this.languageNames[locale] : (global.lang.LANGUAGE +': '+ locale.toUpperCase()),
                            template: 'option',
                            fa: 'fas fa-language',
                            id: locale
                        })
                    }
                })
                global.ui.emit('dialog', [
                    {template: 'question', text: global.lang.LANGUAGE, fa: 'fas fa-language'}
                ].concat(options), 'locale-callback', def)
            }
        })
    }
    tos(){
        global.ui.emit('open-external-url', 'https://megacubo.net/tos')
    }
    help(){
        global.cloud.get('configure').then(c => {
            const url = (c && typeof(c.help) == 'string') ? c.help : global.MANIFEST.bugs
            global.ui.emit('open-external-url', url)
        }).catch(global.displayErr)
    }
	share(){
		global.ui.emit('share', global.ucWords(global.MANIFEST.name), global.ucWords(global.MANIFEST.name), 'https://megacubo.net/online/')
	}
    about(){
        let text = lang.LEGAL_NOTICE +': '+ lang.ABOUT_LEGAL_NOTICE
        global.ui.emit('dialog', [
            {template: 'question', text: global.ucWords(global.MANIFEST.name) +' v'+ global.MANIFEST.version +' (' + process.platform + ', '+ require('os').arch() +')'},
            {template: 'message', text},
            {template: 'option', text: 'OK', fa: 'fas fa-info-circle', id: 'ok'},
            {template: 'option', text: global.lang.HELP, fa: 'fas fa-question-circle', id: 'help'},
            {template: 'option', text: global.lang.SHARE, fa: 'fas fa-share-alt', id: 'share'},
            {template: 'option', text: global.lang.TOS, fa: 'fas fa-info-circle', id: 'tos'}
        ], 'about-callback', 'ok')
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
                txt[0] = 'Memory usage: '+ global.kbfmt(used) +'<br />Free memory: '+ global.kbfmt(freeMem) +'<br />'
            }).catch(console.error).finally(() => done())
        }], () => {
            global.ui.emit('info', 'Resource usage', txt.join(''))
        })
    }
    aboutNetwork(){
        let data = 'Network IP: '+ global.networkIP()
        if(process.platform == 'android'){
            data += '<br />'+ global.androidIPCommand()
        } 
        global.ui.emit('info', 'Network IP', data)
    }
    resetConfig(){
        let text = global.lang.RESET_CONFIRM
        global.ui.emit('dialog', [
            {template: 'question', text: global.ucWords(global.MANIFEST.name)},
            {template: 'message', text},
            {template: 'option', text: global.lang.YES, fa: 'fas fa-info-circle', id: 'yes'},
            {template: 'option', text: global.lang.NO, fa: 'fas fa-times-circle', id: 'no'}
        ], 'reset-callback', 'no')
    }
    closeApp(){
        global.energy.exit()
    }
    playbackEntries(){
        return new Promise((resolve, reject) => {
            let opts = [
                {
                    name: 'Control playback rate according to the buffer', type: 'check', action: (data, checked) => {
                    global.config.set('playback-rate-control', checked)
                }, checked: () => {
                    return global.config.get('playback-rate-control')
                }, details: 'Recommended'}, 
                {
                    name: 'FFmpeg audio repair', type: 'check', action: (data, checked) => {
                    global.config.set('ffmpeg-audio-repair', checked)
                }, checked: () => {
                    return global.config.get('ffmpeg-audio-repair')
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
                    name: 'Use FFmpeg for HLS', details: 'Recommended', type: 'check', action: (data, checked) => {
                    global.config.set('ffmpeg-hls', checked)
                }, checked: () => {
                    return global.config.get('ffmpeg-hls')
                }},                
                {
                    name: 'Transcoding', type: 'select', fa: 'fas fa-film',
                    renderer: () => {
                        return new Promise((resolve, reject) => {
                            let def = global.config.get('transcoding'), opts = [
                                {name: global.lang.NEVER, type: 'action', selected: !def, action: (data) => {
                                    global.config.set('transcoding', '')
                                }},
                                {name: global.lang.TRANSCODING_ENABLED_LIMIT_X.format('480p'), type: 'action', selected: (def == '480p'), action: (data) => {
                                    global.config.set('transcoding', '480p')
                                }},
                                {name: global.lang.TRANSCODING_ENABLED_LIMIT_X.format('720p'), type: 'action', selected: (def == '720p'), action: (data) => {
                                    global.config.set('transcoding', '720p')
                                }},
                                {name: global.lang.TRANSCODING_ENABLED_LIMIT_X.format('1080p'), type: 'action', selected: (def == '1080p'), action: (data) => {
                                    global.config.set('transcoding', '1080p')
                                }}
                            ]
                            resolve(opts)
                        })
                    }
                },
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
                    name: 'Use keepalive connections', type: 'check', action: (data, checked) => {
                    global.config.set('use-keepalive', checked)
                }, checked: () => {
                    return global.config.get('use-keepalive')
                }, details: 'Recommended'}
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
                    name: global.lang.TUNING_CONCURRENCY_LIMIT, 
                    fa: 'fas fa-poll-h', 
                    type: 'slider', 
                    range: {start: 1, end: 8},
                    action: (data, value) => {
                        console.warn('TUNING_CONCURRENCY_LIMIT', data, value)
                        global.config.set('tuning-concurrency', value)
                    }, 
                    value: () => {
                        return global.config.get('tuning-concurrency')
                    }
                },
                {
                    name: global.lang.CONNECT_TIMEOUT, 
                    fa: 'fas fa-plug', 
                    type: 'slider', 
                    range: {start: 5, end: 60},
                    action: (data, value) => {
                        console.warn('CONNECT_TIMEOUT', data, value)
                        global.config.set('connect-timeout', value)
                    }, 
                    value: () => {
                        return global.config.get('connect-timeout')
                    }
                }
            ]
            if(global.config.get('shared-mode-reach')){
                opts.push({
                    name: global.lang.COMMUNITY_LISTS, 
                    type: 'slider', 
                    fa: 'fas fa-users', 
                    mask: '{0} ' + global.lang.COMMUNITY_LISTS.toLowerCase(), 
                    value: () => {
                        return global.config.get('shared-mode-reach')
                    }, 
                    range: {start: 5, end: 24},
                    action: (data, value) => {
                        global.config.set('shared-mode-reach', value)
                    }
                })
            }
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
            global.ui.emit('dialog', [
                {template: 'question', text: global.lang.CLEAR_CACHE, fa: 'fas fa-broom'},
                {template: 'message', text: global.lang.CLEAR_CACHE_WARNING.format(size)},
                {template: 'option', text: global.lang.YES, id: 'yes', fa: 'fas fa-check-circle'},
                {template: 'option', text: global.lang.NO, id: 'no', fa: 'fas fa-times-circle'}
            ], 'clear-cache', 'no')
        })
    }
    clearCache(){
        global.osd.show(global.lang.CLEANING_CACHE, 'fa-mega spin-x-alt', 'clear-cache', 'persistent')
        global.ui.emit('clear-cache')
        global.streamer.stop()
        if(global.tuning){
            global.tuning.stop()
        }
        let folders = [global.storage.folder, global.paths.temp, global.icons.opts.folder]
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
            let secOpt = {
                name: global.lang.SECURITY, fa: 'fas fa-shield-alt', type: 'group', 
                entries: [
                {
                    name: global.lang.ADULT_CONTENT,
                    fa: 'fas fa-user-lock',
                    type: 'select',
                    safe: true,
                    renderer: () => {
                        return new Promise((resolve, reject) => {
                            let def = global.config.get('parental-control-policy'), options = [
                                {
                                    key: 'allow',
                                    fa: 'fas fa-lock-open'
                                }, 
                                {
                                    key: 'block',
                                    fa: 'fas fa-lock'
                                }, 
                                {
                                    key: 'only',
                                    fa: 'fas fa-fire'
                                }
                            ].map(n => {
                                return {
                                    name: global.lang[n.key.replaceAll('-', '_').toUpperCase()],
                                    value: n.key,
                                    icon: n.fa,
                                    type: 'action',
                                    safe: true,
                                    action: (data) => {
                                        global.config.set('parental-control-policy', n.key)
                                        global.explorer.refresh()
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
                }]
            }
            if(global.config.get('parental-control-policy') != 'allow'){
                secOpt.entries.push({
                    name: global.lang.FILTER_WORDS,
                    type: 'input',
                    fa: 'fas fa-shield-alt',
                    action: (e, v) => {
                        if(v !== false){
                            global.config.set('parental-control-terms', v)
                        }
                    },
                    value: () => {
                        return global.config.get('parental-control-terms')
                    },
                    placeholder: global.lang.FILTER_WORDS,
                    multiline: true,
                    safe: true
                })
            }
            let opts = [
                {name: global.lang.BEHAVIOUR, type: 'group', fa: 'fas fa-window-restore', renderer: () => {
                    return new Promise((resolve, reject) => {
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
                            }
                        ]
                        opts.push({
                            name: global.lang.WINDOW_MODE_TO_START,
                            fa: 'fas fa-window-maximize', 
                            type: 'select', 
                            renderer: () => {
                                return new Promise((resolve, reject) => {
                                    let def = global.config.get('startup-window'), opts = [
                                        {name: global.lang.NORMAL, fa: 'fas fa-ban', type: 'action', selected: (def == ''), action: (data) => {
                                            global.config.set('startup-window', '')
                                        }},
                                        {name: global.lang.FULLSCREEN, fa: 'fas fa-window-maximize', type: 'action', selected: (def == 'fullscreen'), action: (data) => {
                                            global.config.set('startup-window', 'fullscreen')
                                        }}
                                    ]
                                    if(!global.cordova){
                                        opts.push({name: 'Miniplayer', fa: 'fas fa-level-down-alt', type: 'action', selected: (def == 'miniplayer'), action: (data) => {
                                            global.config.set('startup-window', 'miniplayer')
                                        }})
                                    }
                                    resolve(opts)
                                })
                            }
                        })
                        resolve(opts)
                    })
                }},
                {name: global.lang.LANGUAGE, fa: 'fas fa-language', type: 'action', action: () => this.showLanguageEntriesDialog()},
                secOpt,
                {name: global.lang.MANAGE_CHANNEL_LIST, fa: 'fas fa-list', type: 'group', details: global.lang.LIVE, renderer: global.channels.options.bind(global.channels)},
                {name: global.lang.ADVANCED, fa: 'fas fa-cogs', type: 'group', renderer: () => {
                    return new Promise((resolve, reject) => {
                        resolve([
                            {name: global.lang.TUNE, fa: 'fas fa-satellite-dish', type: 'group', renderer: this.tuneEntries.bind(this)},
                            {name: global.lang.PLAYBACK, fa: 'fas fa-play', type: 'group', renderer: this.playbackEntries.bind(this)},
                            {
                                name: 'Enable console logging', type: 'check', action: (data, checked) => {
                                global.config.set('enable-console', checked)
                            }, checked: () => {
                                return global.config.get('enable-console')
                            }}, 
                            {
                                name: 'Unoptimized search', type: 'check', action: (data, checked) => {
                                global.config.set('unoptimized-search', checked)
                            }, checked: () => {
                                return global.config.get('unoptimized-search')
                            }},  
                            {  
                                name: global.lang.CLEAR_CACHE, icon: 'fas fa-broom', type: 'action', action: () => this.requestClearCache()
                            },
                            {
                                name: 'Resource usage', fa: 'fas fa-memory', type: 'action', action: this.aboutResources.bind(this)
                            },
                            {
                                name: 'Network IP', fa: 'fas fa-globe', type: 'action', action: this.aboutNetwork.bind(this)
                            },
                            {name: global.lang.FFMPEG_VERSION, fa: 'fas fa-info-circle', type: 'action', action: global.ffmpeg.diagnosticDialog.bind(global.ffmpeg)}
                        ])
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
                                const filename = 'megacubo.config.json', file = global.downloads.folder + path.sep + filename
                                const atts = this.prepareExportConfigFile(global.config.data)
                                fs.writeFile(file, JSON.stringify(atts, null, 3), {encoding: 'utf-8'}, err => {
                                    global.downloads.serve(file, true, false).catch(global.displayErr)
                                })
                            }
                        },
                        {
                            name: global.lang.IMPORT_CONFIG,
                            type: 'action',
                            fa: 'fas fa-file-import', 
                            action: () => {
                                global.ui.emit('open-file', global.ui.uploadURL, 'config-import-file', 'application/json')
                            }
                        }
                    ]
                },
                {
                    name: global.lang.RESET_CONFIG, 
                    type: 'action',
                    fa: 'fas fa-undo-alt', 
                    action: () => this.resetConfig()
                }
            ]
            resolve(opts)
        })
    }
    hook(entries, path){
        return new Promise((resolve, reject) => {
            if(path == '' && !entries.some(e => e.name == global.lang.TOOLS)){
                entries = entries.concat([
                    {name: global.lang.TOOLS, fa: 'fas fa-box-open', type: 'group', renderer: this.tools.bind(this)},
                    {name: global.lang.OPTIONS, fa: 'fas fa-cog', type: 'group', renderer: this.entries.bind(this)},
                    {name: global.lang.ABOUT, fa: 'fas fa-info-circle', type: 'action', action: this.about.bind(this)},
                    {name: global.lang.EXIT, fa: 'fas fa-power-off', type: 'action', action: global.energy.askExit.bind(global.energy)}
                ])
            }
            resolve(entries)
        })
    }
}

module.exports = Options
