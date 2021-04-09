
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
                    global.removeFolder(global.paths['data'], false, true)
                    global.removeFolder(global.paths['temp'], false, true)
                    global.energy.restart()
                    break
            }
        })
        global.ui.on('locale-callback', locale => {
            let def = global.lang.locale
            if(locale != def){
                global.config.set('locale', locale)
                global.energy.restart()
            }
        })
        global.ui.on('clear-cache', ret => {
            if(ret == 'yes') this.clearCache()
        })
        this.languageNames = {
            en: 'English',
            es: 'Español',
            pt: 'Português',
            it: 'Italiano'
        }
        this.emptyEntry = {name: global.lang.EMPTY, type: 'action', fa: 'fas fa-info-circle', class: 'entry-empty'}
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
                ui.emit('dialog', [
                    {template: 'question', text: global.lang.LANGUAGE, fa: 'fas fa-language'}
                ].concat(options), 'locale-callback', def)
            }
        })
    }
    tos(){
        global.ui.emit('open-external-url', 'https://megacubo.tv/tos')
    }
    help(){
        global.cloud.get('configure').then(c => {
            const url = (c && typeof(c.help) == 'string') ? c.help : global.MANIFEST.bugs
            global.ui.emit('open-external-url', url)
        }).catch(global.displayErr)
    }
	share(){
		global.ui.emit('share', global.ucWords(global.MANIFEST.name), global.ucWords(global.MANIFEST.name), 'https://megacubo.tv/online/')
	}
    about(){
        let text = lang.LEGAL_NOTICE +": "+ lang.ABOUT_LEGAL_NOTICE
        ui.emit('dialog', [
            {template: 'question', text: global.ucWords(global.MANIFEST.name) +' v'+ global.MANIFEST.version +' (' + process.platform + ', '+ require('os').arch() +')'},
            {template: 'message', text},
            {template: 'option', text: 'OK', fa: 'fas fa-info-circle', id: 'ok'},
            {template: 'option', text: global.lang.HELP, fa: 'fas fa-question-circle', id: 'help'},
            {template: 'option', text: global.lang.SHARE, fa: 'fas fa-share-alt', id: 'share'},
            {template: 'option', text: global.lang.TOS, fa: 'fas fa-info-circle', id: 'tos'}
        ], 'about-callback', 'ok')
    }
    aboutMem(){
        const used = process.memoryUsage().rss
        let data = 'Memory usage: ' + global.kbfmt(used) + '<br />'  
        ui.emit('info', 'Memory usage', data)
    }
    resetConfig(){
        let text = global.lang.RESET_CONFIRM
        ui.emit('dialog', [
            {template: 'question', text: global.ucWords(global.MANIFEST.name)},
            {template: 'message', text},
            {template: 'option', text: global.lang.YES, fa: 'fas fa-info-circle', id: 'yes'},
            {template: 'option', text: global.lang.NO, fa: 'fas fa-times-circle', id: 'no'}
        ], 'reset-callback', 'no')
    }
    closeApp(){
        global.energy.exit()
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
        let folders = [global.paths['data'], global.paths['temp']], size = 0, gfs = require('get-folder-size')
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
        let folders = [global.paths['data'], global.paths['temp']]
        async.eachOf(folders, (folder, i, done) => {
            global.removeFolder(folder, false, done)
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
                {name: global.lang.STARTUP, type: 'group', fa: 'fas fa-star-of-life', renderer: () => {
                    return new Promise((resolve, reject) => {
                        let opts = [
                            {name: global.lang.RESUME_PLAYBACK, type: 'check', action: (data, checked) => {
                                global.config.set('resume', checked)
                            }, checked: () => {
                                return global.config.get('resume')
                            }}
                        ]
                        opts.push({
                            name: global.lang.WINDOW,
                            fa: 'fas fa-window-maximize', 
                            type: 'select', 
                            renderer: () => {
                                return new Promise((resolve, reject) => {
                                    let def = global.config.get('startup-window'), opts = [
                                        {name: global.lang.NORMAL, fa:  'fas fa-ban', type: 'action', selected: (def == ''), action: (data) => {
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
                {name: global.lang.CHANNEL_LIST, fa: 'fas fa-list', type: 'group', renderer: global.channels.options.bind(global.channels)},
                {name: global.lang.TUNE, fa: 'fas fa-satellite-dish', type: 'group', renderer: this.tuneEntries.bind(this)},
                {name: global.lang.ADVANCED, fa: 'fas fa-cogs', type: 'group', renderer: () => {
                    return new Promise((resolve, reject) => {
                        resolve([
                            {
                                name: global.lang.AUTO_MINIPLAYER, type: 'check', action: (data, checked) => {
                                global.config.set('miniplayer-auto', checked)
                            }, checked: () => {
                                return global.config.get('miniplayer-auto')
                            }},
                            {
                                name: 'Enable console logging', type: 'check', action: (data, checked) => {
                                global.config.set('enable-console', checked)
                            }, checked: () => {
                                return global.config.get('enable-console')
                            }},
                            {
                                name: 'FFMPEG audio repair', type: 'check', action: (data, checked) => {
                                global.config.set('ffmpeg-audio-repair', checked)
                            }, checked: () => {
                                return global.config.get('ffmpeg-audio-repair')
                            }},
                            {
                                name: 'Control playback rate according to the buffer', type: 'check', action: (data, checked) => {
                                global.config.set('playback-rate-control', checked)
                            }, checked: () => {
                                return global.config.get('playback-rate-control')
                            }},
                            {
                                name: 'Use keepalive connections', type: 'check', action: (data, checked) => {
                                global.config.set('use-keepalive', checked)
                            }, checked: () => {
                                return global.config.get('use-keepalive')
                            }},
                            {
                                name: 'Allow transcoding', type: 'check', action: (data, checked) => {
                                global.config.set('allow-transcoding', checked)
                            }, checked: () => {
                                return global.config.get('allow-transcoding')
                            }},
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
                                name: global.lang.CLEAR_CACHE, icon: 'fas fa-broom', type: 'action', action: () => this.requestClearCache()
                            },
                            {
                                name: 'Memory usage', fa: 'fas fa-memory', type: 'action', action: this.aboutMem.bind(this)
                            },
                            {name: global.lang.FFMPEG_VERSION, fa: 'fas fa-info-circle', type: 'action', action: global.ffmpeg.diagnosticDialog.bind(global.ffmpeg)}
                        ])
                    })
                }},
                {name: global.lang.RESET_CONFIG, fa: 'fas fa-trash', type: 'action', action: this.resetConfig.bind(this)}
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
