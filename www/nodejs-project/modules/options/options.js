
const Events = require('events'), fs = require('fs'), path = require('path')

class Options extends Events {
    constructor(){
        super()
        this.languageNames = {
            en: 'English',
            es: 'Español',
            pt: 'Português',
            it: 'Italiano'
        }
        this.emptyEntry = {name: global.lang.EMPTY, type: 'action', fa: 'fas fa-info-circle', class: 'entry-empty'}
        this.languageLabelMask = "LANG: {0}"
    }
    tools(){
        return new Promise((resolve, reject) => {
            let entries = [
                {name: global.lang.OPEN_URL, fa: 'fas fa-link', type: 'action', action: () => {
                    global.ui.emit('prompt', global.lang.OPEN_URL, 'http://.../example.m3u8', '', 'open-url', false, 'fas fa-link')
                }}
            ]
            resolve(entries)
        })
    }
    languageEntries(){
        return new Promise((resolve, reject) => {
            let options = [], def = global.lang.locale
            let files = fs.readdirSync(global.APPDIR + path.sep + 'lang')
            files.forEach(file => {
                if(file.indexOf('.json') != -1){
                    console.log(file)
                    let locale = file.split('.')[0], icon = 'assets/images/flags/'+ locale +'.png'
                    if(!fs.existsSync(icon)){
                        icon = ''
                    }
                    options.push({
                        name: typeof(this.languageNames[locale]) != 'undefined' ? this.languageNames[locale] : (global.lang.LANGUAGE +': '+ locale.toUpperCase()),
                        details: this.languageLabelMask.format(locale.toUpperCase()),
                        type: 'action',
                        fa: 'fas fa-language',
                        icon,
                        value: locale,
                        action: (data) => {
                            if(data.value != def){
                                global.config.set('locale', data.value)
                                global.energy.restart()
                            }
                        }
                    })    
                }
            })
            options = options.map(p => {
                p.selected = (def == p.value)
                return p
            })    
            resolve(options)
        })
    }
    encodeHTMLEntities(str){
        return str.replace(/[\u00A0-\u9999<>&](?!#)/gim, (i) => {
          return '&#' + i.charCodeAt(0) + ';'
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
    ffmpegVersion(){
        global.ffmpeg.version(data => {
            console.warn('FFMPEG INFO', data)
            global.ui.emit('info', data ? lang.FFMPEG_VERSION : lang.FFMPEG_NOT_FOUND, this.encodeHTMLEntities(data || lang.FFMPEG_NOT_FOUND) +"<br />"+ global.ffmpeg.path)
        })
    }
    about(){
        let text = lang.LEGAL_NOTICE +": "+ lang.ABOUT_LEGAL_NOTICE
        ui.emit('dialog', [
            {template: 'question', text: global.ucWords(global.MANIFEST.name) +' v'+ global.MANIFEST.version +' (' + process.platform + ', '+ require('os').arch() +')'},
            {template: 'message', text},
            {template: 'option', text: 'OK', fa: 'fas fa-info-circle', id: 'ok'},
            {template: 'option', text: global.lang.TOS, fa: 'fas fa-info-circle', id: 'tos'},
            {template: 'option', text: global.lang.HELP, fa: 'fas fa-question-circle', id: 'help'}
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
            if(global.config.get('shared-mode-lists-amount')){
                opts.push({
                    name: global.lang.SHARED_LISTS, 
                    type: 'slider', 
                    fa: 'fas fa-users', 
                    mask: '{0} ' + global.lang.SHARED_LISTS.toLowerCase(), 
                    value: () => {
                        return global.config.get('shared-mode-lists-amount')
                    }, 
                    range: {start: 3, end: global.cordova ? 8 : 12}, // lower for smartphones to prevent OOM
                    action: (data, value) => {
                        global.config.set('shared-mode-lists-amount', value)
                    }
                })
            }
            resolve(opts)
        })
    }
    playbackEntries(){
        return new Promise((resolve, reject) => {
            let opts = [
                {name: global.lang.RESUME_PLAYBACK, type: 'check', action: (data,checked) => {
                    global.config.set('resume', checked)
                }, checked: () => {
                    return global.config.get('resume')
                }},
                {name: global.lang.WARN_ON_CONN_ERR, type: 'check', action: (data, checked) => {
                    global.config.set('warn-on-connection-errors', checked)
                }, checked: () => {
                    return global.config.get('warn-on-connection-errors')
                }},
                {name: global.lang.FFMPEG_VERSION, fa: 'fas fa-info-circle', type: 'action', action: this.ffmpegVersion.bind(this)}
            ]
            resolve(opts)
        })
    }
    entries(){
        return new Promise((resolve, reject) => {
            var opts = [
                {name: global.lang.LANGUAGE, fa: 'fas fa-language', type: 'select', renderer: this.languageEntries.bind(this)},
                {name: global.lang.SECURITY, fa: 'fas fa-shield-alt', type: 'group', entries: [
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
                    }
                ]},
                {name: global.lang.CHANNEL_LIST, fa: 'fas fa-list', type: 'group', renderer: global.channels.options.bind(global.channels)},
                {name: global.lang.PLAYBACK, fa: 'fas fa-play', type: 'group', renderer: this.playbackEntries.bind(this)},
                {name: global.lang.TUNE, fa: 'fas fa-satellite-dish', type: 'group', renderer: this.tuneEntries.bind(this)},
                {name: global.lang.ADVANCED, fa: 'fas fa-cogs', type: 'group', renderer: () => {
                    return new Promise((resolve, reject) => {
                        resolve([
                            {
                                name: 'Debug messages', type: 'check', action: (data, checked) => {
                                global.config.set('debug-messages', checked)
                            }, checked: () => {
                                return global.config.get('debug-messages')
                            }},
                            {
                                name: 'Enable console logging', type: 'check', action: (data, checked) => {
                                global.config.set('enable-console', checked)
                            }, checked: () => {
                                return global.config.get('enable-console')
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
                                name: 'Memory usage', fa: 'fas fa-memory', type: 'action', action: this.aboutMem.bind(this)
                            }
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
