var subtitlesContainer, subtitlesIcon = 'fa-comments', subtitlesNotification = notify('.', subtitlesIcon, 'forever', true)
subtitlesNotification.hide()

function srt2vtt(content){
    var srtxt = content.split("\n"), txt = '';
    txt = "WEBVTT\n";
    for(var i=0; i<srtxt.length; i++) {
        if(srtxt[i].match(/[0-9]+:[0-9]+:[0-9]+,[0-9]+\s-->\s[0-9]+:[0-9]+:[0-9]+,[0-9]+/g)){
            txt = txt + srtxt[i].replace(/,/g,".") + "\n";
        } else {
            txt = txt + srtxt[i] + "\n";
        }
    }
    return txt
}

function vtt2b64(content){
    console.warn('VTT', content)
    return "data:text/vtt;base64," + btoa(unescape(encodeURIComponent(content)))
}

var subtitlerLangCodes = {
    "af-za": "afr",
    "sq-al": "alb",
    "ar-dz": "ara",
    "hy-am": "arm",
    "eu-es": "baq",
    "be-by": "bel",
    "bg-bg": "bul",
    "en-cb": "car",
    "ca-es": "cat",
    "zh-cn": "chi",
    "cs-cz": "cze",
    "da-dk": "dan",
    "nl-be": "dut",
    "en-au": "eng",
    "et-ee": "est",
    "fo-fo": "fao",
    "fi-fi": "fin",
    "fr-be": "fre",
    "gl-es": "gaa",
    "ka-ge": "geo",
    "de-at": "ger",
    "el-gr": "ell",
    "gu-in": "guj",
    "he-il": "heb",
    "hi-in": "hin",
    "hr-hr": "hrv",
    "hu-hu": "hun",
    "is-is": "ice",
    "id-id": "ind",
    "it-it": "ita",
    "ja-jp": "jpn",
    "kn-in": "kan",
    "kk-kz": "kaz",
    "kok-in": "kok",
    "ko-kr": "kor",
    "lt-az-az": "lat",
    "lv-lv": "lav",
    "lt-lt": "lit",
    "mn-mn": "lol",
    "mk-mk": "mac",
    "mr-in": "mar",
    "nb-no": "nor",
    "pl-pl": "pol",
    "ru-ru": "rus",
    "sa-in": "san",
    "cy-sr-sp": "scc",
    "sk-sk": "slo",
    "sl-si": "slv",
    "sw-ke": "swa",
    "sv-fi": "swe",
    "syr-sy": "syr",
    "ta-in": "tam",
    "tt-ru": "tat",
    "te-in": "tel",
    "th-th": "tha",
    "tr-tr": "tur",
    "uk-ua": "ukr",
    "ur-pk": "urd",
    "cy-uz-uz": "uzb",
    "vi-vn": "vie",
    "ro-ro": "rum",
    "pt-br": "pob",

    // default patterns
    "^en_": "eng",
    "^es_": "spa",
    "^pr_": "por",
    "^zh_": "chi"    
}

function getSubtitlerLangCode(locales){
    var codes = [], maybeCodes = []
    locales.toLowerCase().replaceAll('_', '-').split(',').forEach((locale) => {
        if(typeof(subtitlerLangCodes[locale]) != 'undefined'){
            codes.push(subtitlerLangCodes[locale])
        } else {
            let slocale = locale.substr(0, 2)
            Countries.data.forEach((country) => {
                if(country.locale.substr(0, 2) == locale){
                    maybeCodes.push(subtitlerLangCodes[locale])
                }
            })
        }
    })
    return (codes.length ? codes : (maybeCodes.length ? maybeCodes : [locales])).filter((c) => { return c && c.length }).join(',')
}

function subtitlesContainerUpdate(trk){
    if(trk && trk.length){
        if(subtitlesContainer){
            subtitlesContainer.empty()
        } else {
            var ob = getFrame('overlay').document.body
            subtitlesContainer = document.createElement('div')
            subtitlesContainer.id = 'subtitles-container'
            subtitlesContainer.className = 'fit-player'
            ob.appendChild(subtitlesContainer)
            subtitlesContainer = jQuery(subtitlesContainer)
        }
        var subs = ''
        for(var i=0; i<trk.length; i++){
            subs += '<div>'+trk[i].text.replaceAll("\n", "<br />")+'</div>'
        }
        subtitlesContainer.html(subs)
        console.warn('TRK', trk.length, subtitlesContainer.html())
    } else if(subtitlesContainer) {
        subtitlesContainer.empty()
    }
}

function setVideoSubtitle(vttb64, url, locale, video){
    if(Playback.active){
        Playback.active.subtitle = url
        if(!video){
            video = Playback.active.getVideo()
        }
        if(video){
            for (var i = 0; i < video.textTracks.length; i++) {
                video.textTracks[i].mode = 'disabled';
                if(video.textTracks[i].parentNode){
                    video.textTracks[i].parentNode.removeChild(video.textTracks[i])
                }
                delete video.textTracks[i]
            }
            track = document.createElement("track")
            track.kind = "subtitles";
            track.label = locale.toUpperCase()
            track.srclang = locale;
            track.src = vttb64;
            track.default = 'default';
            //track.onload = () => { alert('UAU!') }
            track.addEventListener("load", () => {
                jQuery(video).one('timeupdate', () => {
                    video.textTracks[0].mode = "showing";
                    video.textTracks[0].addEventListener('cuechange', (e) => {
                        subtitlesContainerUpdate(video.textTracks[0].activeCues)
                    })
                })
            })
            video.appendChild(track)
            setActiveEntry({url: url})
            doAction('subtitleAdded')
        }
    }
}

function setupSubtitle(data){
    if(Playback.active){
        setActiveEntry({url: data.url}, 'fa-mega spin-x-alt', false)
        subtitlesNotification.update(Lang.SUBTITLE_APPLYNG, subtitlesIcon, 'forever')
        request({
            url: data.url,
            encoding: 'latin1',
            ttl: 6 * 3600
        }, (error, response, body) => {
            if(error || !body){
                subtitlesNotification.update(Lang.SUBTITLE_APPLY_ERROR, 'fa-exclamation-triangle faclr-red', 'normal')
            } else {
                setVideoSubtitle(vtt2b64(srt2vtt(body)), data.url, data.locale)
                subtitlesNotification.update(Lang.SUBTITLE_APPLY_SUCCESS, 'fa-check-circle', 'normal')
            }
        })
    } else {
        subtitlesNotification.update(Lang.START_PLAYBACK_FIRST, 'fa-exclamation-triangle faclr-red', 'normal')    
    }
}

function fetchSubtitles(q, cb){
    var subtitler = require("subtitler")
    if(subtitler){
        var callback = (subtitles) => {
            console.warn('SUBTITLES', subtitles)
            if(Array.isArray(subtitles)){
                var entries = [];
                for(var i=0; i<subtitles.length; i++){
                    entries.push({
                        type: 'option',
                        logo: subtitlesIcon,
                        url: subtitles[i].SubDownloadLink.replace('.gz', '.srt'),
                        name: subtitles[i].SubFileName,
                        locale: subtitles[i].ISO639,
                        callback: setupSubtitle
                    })
                }
                cb(entries)
            } else {
                cb([])
            }
        }
        subtitler.api.login().then((token) => {
            var c = Config.get('custom-subtitles-language'), lang = getSubtitlerLangCode(((c&&c!='auto')?c+',':'') + getDefaultLocale(false, true))
            subtitler.api.searchForTitle(token, lang, q).then((results) => {
                subtitler.api.logout(token)
                callback(results)
            })
        })
    } else {
        cb('Subtitler unavailable.')
    }
}

var customSubtitlesLanguage = '';
function getSubtitlesEntry(){
    return {   
        name: Lang.SUBTITLES, 
        type: 'group', 
        logo: subtitlesIcon,
        class: 'entry-nosub',
        entries: [
            {
                name: Lang.SEARCH,
                type: 'group',
                logo: 'fa-search',
                renderer: () => {
                    if(Playback.active){
                        return [
                            Menu.loadingEntry()
                        ]
                    } else {
                        return [
                            {
                                name: Lang.START_PLAYBACK_FIRST,
                                class: 'entry-empty',
                                type: 'back',
                                logo: 'fa-info-circle'
                            }
                        ]
                    }
                },
                callback: () => {
                    if(Playback.active){
                        var terms = prepareSearchTerms(Playback.active.entry.name).join(' ')
                        goSearch(null, 'subtitles')
                    }
                }
            },
            {
                name: Lang.LANGUAGE, 
                type: 'group', 
                logo: 'fa-globe', 
                entries: [
                    {
                        type: 'input',
                        logo: 'fa-globe',
                        name: Lang.LANGUAGE,
                        change: function (entry, element, val){
                            if(!val || val.length > 3){
                                val = 'auto'
                            } else if(val.length == 2){
                                let n = Countries.select()
                            }
                            Config.set('custom-subtitles-language', val)
                        },
                        value: Config.get('custom-subtitles-language') || 'auto'
                    },
                    {
                        type: 'option',
                        logo: 'fa-save',
                        name: Lang.SAVE,
                        callback: () => {
                            Menu.back()
                        }
                    }
                ]
            }
        ]
    }
}

addFilter('videosMetaEntries', (entries) => {
    entries.splice(2, 0, getSubtitlesEntry())
    return entries
})

function subtitlesMaybeRefresh(){
    if(Menu.path.indexOf(Lang.SUBTITLES) != -1 && basename(Menu.path) != Lang.LANGUAGE){
        Menu.refresh()
    }
}

Playback.on('commit', subtitlesMaybeRefresh)
Playback.on('stop', () => {
    subtitlesContainerUpdate(false)
    subtitlesMaybeRefresh()
})    

addAction('appReady', () => {
    registerSearchEngine(Lang.SUBTITLES, 'subtitles', fetchSubtitles)
})
