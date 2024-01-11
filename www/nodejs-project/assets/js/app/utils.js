
Object.defineProperty(Array.prototype, 'unique', {
    enumerable: false,
    configurable: false,
    writable: false,
    value: function() {
        var arr = []
        for (var i = 0; i < this.length; i++) {
            if (arr.indexOf(this[i]) == -1){
                arr.push(this[i])
            }
        }
        return arr
    }
})
Object.defineProperty(String.prototype, 'format', {
    enumerable: false,
    configurable: false,
    writable: false,
    value: function (){
        var args = arguments;
        return this.replace(/{(\d+)}/g, function(match, number) {
        return typeof args[number] != 'undefined'
            ? args[number]
            : match
        })
    }
})
Object.defineProperty(String.prototype, 'replaceAll', {
    enumerable: false,
    configurable: false,
    writable: false,
    value: function(search, replacement) {
        var target = this
        if(target.indexOf(search)!=-1){
            target = target.split(search).join(replacement)
        }
        return String(target)
    }
})
Object.defineProperty(Number.prototype, 'between', {
    enumerable: false,
    configurable: false,
    writable: false,
    value: function(a, b) {
        var min = Math.min(a, b), max = Math.max(a, b)
        return this >= min && this <= max
    }
})
if(typeof(Object.values) != 'function') {
    Object.defineProperty(Object.prototype, 'values', {
        enumerable: false,
        configurable: false,
        writable: false,
        value: obj => {
            let res = []
            for (var i in obj) {
                if (obj.hasOwnProperty(i)) {
                    res.push(obj[i])
                }
            }
            return res
        }
    })
}

if(typeof($) != 'undefined'){
    $.ajaxSetup({ cache: false })
    $.fn.reverse = function() {
        return this.pushStack(this.get().reverse(), arguments);
    } 
}

function css(code, id, scope){
    if(!scope){
        scope = window
    }
    if(scope && scope.document){
        try {
            //console.warn('style creating', code)
            var s = scope.document.getElementById("css-"+ id)
            if(s){
                if(s.dataset.code == code){
                    return
                }
            } else {
                //console.warn('style created');
                s = scope.document.createElement("style")
                s.type = "text/css"
                s.id = "css-"+ id
            }
            s.dataset.code = code
            s.innerText = '';
            s.appendChild(scope.document.createTextNode(code))
            scope.document.querySelector("head, body").appendChild(s)
            //console.warn('style created OK')
        } catch(e) {
            console.log('CSS Error', e, code)
        }
    }
}

function loadJS(url, cb, retries=3){
    var script = document.createElement("script")
	script.type = "text/javascript";
	if(typeof(cb) == 'function'){
		script.onload = function (){
			console.warn('LOADED', url);
			setTimeout(cb, 1)
		}
		script.onerror = function (){
			if(retries){
				retries--
				console.warn('RETRY', url);
				setTimeout(function (){
					loadJS(url, cb, retries)
				}, 1)
			} else {
				console.warn('ERROR', url);
				setTimeout(cb, 1)
			}
		}
	}
	script.src = url;
	document.querySelector("head").appendChild(script)
}

function loadJSOnIdle(url, cb, retries=3){
    requestIdleCallback(() => {
        loadJS(url, (...args) => {
            requestIdleCallback(cb)
        }, retries)
    })
}

function time(){
    return Date.now() / 1000
}

var absolutize = (url, base) => {
    if('string' !== typeof(url) || !url){
        return null; // wrong or empty url
    } else if(url.match(/^[a-z]+\:\/\//i)){ 
        return url; // url is absolute already 
    } else if(url.startsWith('//')){ 
        return 'http:'+ url; // url is absolute already 
    } else if(url.match(/^[a-z]+\:/i)){ 
        return url; // data URI, mailto:, tel:, etc.
    } else if('string' !== typeof(base)){
        var a=document.createElement('a'); 
        a.href=url; // try to resolve url without base  
        if(!a.pathname){ 
            return null; // url not valid 
        }
        return 'http://'+url
    } else { 
        base = absolutize(base) // check base
        if(base === null){
            return null // wrong base
        }
    }
    var a=document.createElement('a')
    a.href=base;    
    if(url[0] == '/'){ 
        base = [] // rooted path
    } else{ 
        base = a.pathname.split('/') // relative path
        base.pop()
    }
    url=url.split('/');
    for(var i=0; i<url.length; ++i){
        if(url[i]==='.'){ // current directory
            continue;
        }
        if(url[i]==='..'){ // parent directory
            if('undefined'===typeof base.pop() || base.length===0){ 
                return null; // wrong url accessing non-existing parent directories
            }
        }
        else{ // child directory
            base.push(url[i]); 
        }
    }
    return a.protocol + '//' + a.hostname + (a.port && a.port != 80 ? ':' + a.port : '') + base.join('/');
}

function parseThousands(s){
    var locale = getLocale(false, true)
    return Number(String(s).replace(new RegExp('[^0-9]', 'g'), '')).toLocaleString(locale)
}

function basename(str, rqs){
    str = String(str), qs = ''
    let pos = str.indexOf('?')
    if(pos != -1){
        qs = str.slice(pos + 1)
        str = str.slice(0, pos)
    }
    str = str.replaceAll('\\', '/')
    pos = str.lastIndexOf('/')
    if(pos != -1){
        str = str.substring(pos + 1)
    }
    if(!rqs && qs){
        str += '?'+qs
    }
    return str
}

function dirname(str){
    _str = new String(str)
    pos = global.forwardSlashes(_str).lastIndexOf('/')
    if(!pos) return ''
    _str = _str.substring(0, pos)
    return _str
}

function prepareFilename(file, keepAccents){
    let ret = file.replace(new RegExp('[\\\\/:*?\"<>|]', 'g'), '')
    if(!keepAccents){
        ret = ret.normalize('NFD').replace(new RegExp('[\u0300-\u036f]', 'g'), '').replace(new RegExp('[^A-Za-z0-9\\._\\- ]', 'g'), '')
    }
    return ret
}

function ucWords(str){
    return str.toLowerCase().replace(/^[\u00C0-\u1FFF\u2C00-\uD7FF\w]|\s[\u00C0-\u1FFF\u2C00-\uD7FF\w]/g, function(letter) {
        return letter.toUpperCase();
    })
}

function ucFirst(str, keepCase){
    if(!keepCase){
        str = str.toLowerCase()
    }
    return str.replace(/^[\u00C0-\u1FFF\u2C00-\uD7FF\w]/g, letter => {
        return letter.toUpperCase()
    })
}

function ucNameFix(name){
    if(name == name.toLowerCase()){
        return ucWords(name)
    }
    return name;
}
function toTitleCase(str) {
    return str.replace(/\w\S*/g, function(txt){
        return txt.charAt(0).toUpperCase() + txt.substr(1).toLowerCase();
    })
}

function parseQueryString(url) {
    var queryString = url;
    if(url.indexOf('?') != -1){
        queryString = url.split('?')[1]
    }
    var params = {}, queries, temp, i, l;
    // Split into key/value pairs
    queries = queryString.split("&");
    // Convert the array of strings into an object
    for ( i = 0, l = queries.length; i < l; i++ ) {
        temp = queries[i].split('=');
        params[temp[0]] = (temp.length > 1) ? decodeURIComponent(temp[1]) : '';
    }
    return params;
}

function centralizedResizeWindow(w, h, animate){
    var tw = window.top;
    if(tw){
        var t = (screen.availHeight - h) / 2, l = (screen.availWidth - w) / 2;
        if(animate){
            var initialTop = parent.parent.win.y;
            var initialLeft = parent.parent.win.x;
            var initialWidth = tw.outerWidth;
            var initialHeight = tw.outerHeight;
            $({percent: 0}).animate({percent: 100}, {
                step: (percent) => { 
                    var width = initialWidth + (percent * ((w - initialWidth) / 100)), height = initialHeight + (percent * ((h - initialHeight) / 100));
                    var top = initialTop + (percent * ((t - initialTop) / 100)), left = initialLeft + (percent * ((l - initialLeft) / 100));
                    //console.log('resize', top, left, width, height);
                    tw.moveTo(left, top);
                    tw.resizeTo(width, height)
                }
            })
        } else {
            // console.log('resize', t, l, w, h);
            tw.resizeTo(w, h);
            tw.moveTo(l, t)
        }
    }
}

function trimChar(string, charToRemove) {
    while(string.charAt(0)==charToRemove) {
        string = string.substring(1);
    }
    while(string.charAt(string.length-1)==charToRemove) {
        string = string.substring(0,string.length-1);
    }
    return string;
}

function hmsClockToSeconds(str) {
    var cs = str.split('.'), p = cs[0].split(':'), s = 0, m = 1;    
    while (p.length > 0) {
        s += m * parseInt(p.pop(), 10);
        m *= 60;
    }    
    if(cs.length > 1 && cs[1].length >= 2){
        s += parseInt(cs[1].substr(0, 2)) / 100;
    }
    return s;
}

function hmsSecondsToClock(secs) {
    var sec_num = parseInt(secs, 10); // don't forget the second param
    var hours   = Math.floor(sec_num / 3600);
    var minutes = Math.floor((sec_num - (hours * 3600)) / 60);
    var seconds = sec_num - (hours * 3600) - (minutes * 60);    
    if (hours   < 10) {hours   = "0"+hours;}
    if (minutes < 10) {minutes = "0"+minutes;}
    if (seconds < 10) {seconds = "0"+seconds;}
    return hours+':'+minutes+':'+seconds;
}

function createDateAsUTC(date) {
    return new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate(), date.getHours(), date.getMinutes(), date.getSeconds()));
}

function convertDateToUTC(date) { 
    return new Date(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), date.getUTCHours(), date.getUTCMinutes(), date.getUTCSeconds()); 
}

function arrayMin(arr) {
    var len = arr.length, min = arr[0] || '';
    while (len--) {
        if (arr[len] < min) {
        min = arr[len];
        }
    }
    return min;
}
    
function arrayMax(arr) {
    var len = arr.length, max = arr[0] || '';
    while (len--) {
        if (arr[len] > max) {
        max = arr[len];
        }
    }
    return max;
}

function getProto(u){
    var pos = u.indexOf('://');
    if(pos != -1){
        var proto = u.substr(0, pos).toLowerCase();
        return proto;
    }
    if(u.substr(0, 2)=='//'){
        return 'http';
    }
    return false;
}

function extractURLs(val){
    var urls = [], lines = val.split("\n");
    for(var i=0; i<lines.length; i++){
        if(lines[i].match(new RegExp('^(//|https?:)'))){
            urls.push(lines[i]);
        }
    }
    return urls;
}

function dateStamp(){
    var d = new Date();
    return d.getFullYear()+"-"+("0"+(d.getMonth()+1)).slice(-2)+"-"+("0" + d.getDate()).slice(-2) + " " + ("0" + d.getHours()).slice(-2) + "-" + ("0" + d.getMinutes()).slice(-2);
}

function nl2br (str) {
    var breakTag = '<br />';
    return (str + '').replace(/([^>\r\n]?)(\r\n|\n\r|\r|\n)/g, '$1' + breakTag + '$2');
}

function stripHTML(html){
    return html.replace(new RegExp('<\\/?[^>]+>', 'g'), ' ').replace(new RegExp('[ \r\n\t]+', 'g'), ' ').trim()
}

function fixUTF8(str) {
    return String(str)
    // U+20AC  0x80  € â‚¬   %E2 %82 %AC
    .replace(/â‚¬/g, '€')
    // U+201A  0x82  ‚ â€š   %E2 %80 %9A
    .replace(/â€š/g, '‚')
    // U+0192  0x83  ƒ Æ’  %C6 %92
    .replace(/Æ’/g, 'ƒ')
    // U+201E  0x84  „ â€ž   %E2 %80 %9E
    .replace(/â€ž/g, '„')
    // U+2026  0x85  … â€¦   %E2 %80 %A6
    .replace(/â€¦/g, '…')
    // U+2020  0x86  † â€  %E2 %80 %A0
    .replace(/â€\u00A0/g, '†')
    // U+2021  0x87  ‡ â€¡   %E2 %80 %A1
    .replace(/â€¡/g, '‡')
    // U+02C6  0x88  ˆ Ë†  %CB %86
    .replace(/Ë†/g, 'ˆ')
    // U+2030  0x89  ‰ â€°   %E2 %80 %B0
    .replace(/â€°/g, '‰')
    // U+0160  0x8A  Š Å   %C5 %A0
    .replace(/Å\u00A0/g, 'Š')
    // U+2039  0x8B  ‹ â€¹   %E2 %80 %B9
    .replace(/â€¹/g, '‹')
    // U+0152  0x8C  Œ Å’  %C5 %92
    .replace(/Å’/g, 'Œ')
    // U+017D  0x8E  Ž Å½  %C5 %BD
    .replace(/Å½/g, 'Ž')
    // U+2018  0x91  ‘ â€˜   %E2 %80 %98
    .replace(/â€˜/g, '‘')
    // U+2019  0x92  ’ â€™   %E2 %80 %99
    .replace(/â€™/g, '’')
    // U+201C  0x93  “ â€œ   %E2 %80 %9C
    .replace(/â€œ/g, '“')
    // U+201D  0x94  ” â€  %E2 %80 %9D
    .replace(/â€\u009D/g, '”')
    // U+2022  0x95  • â€¢   %E2 %80 %A2
    .replace(/â€¢/g, '•')
    // U+2013  0x96  – â€“   %E2 %80 %93
    .replace(/â€“/g, '–')
    // U+2014  0x97  — â€”   %E2 %80 %94
    .replace(/â€”/g, '—')
    // U+02DC  0x98  ˜ Ëœ  %CB %9C
    .replace(/Ëœ/g, '˜')
    // U+2122  0x99  ™ â„¢   %E2 %84 %A2
    .replace(/â„¢/g, '™')
    // U+0161  0x9A  š Å¡  %C5 %A1
    .replace(/Å¡/g, 'š')
    // U+203A  0x9B  › â€º   %E2 %80 %BA
    .replace(/â€º/g, '›')
    // U+0153  0x9C  œ Å“  %C5 %93
    .replace(/Å“/g, 'œ')
    // U+017E  0x9E  ž Å¾  %C5 %BE
    .replace(/Å¾/g, 'ž')
    // U+0178  0x9F  Ÿ Å¸  %C5 %B8
    .replace(/Å¸/g, 'Ÿ')
    // U+00A0  0xA0    Â   %C2 %A0
    .replace(/Â /g, ' ')
    // U+00A1  0xA1  ¡ Â¡  %C2 %A1
    .replace(/Â¡/g, '¡')
    // U+00A2  0xA2  ¢ Â¢  %C2 %A2
    .replace(/Â¢/g, '¢')
    // U+00A3  0xA3  £ Â£  %C2 %A3
    .replace(/Â£/g, '£')
    // U+00A4  0xA4  ¤ Â¤  %C2 %A4
    .replace(/Â¤/g, '¤')
    // U+00A5  0xA5  ¥ Â¥  %C2 %A5
    .replace(/Â¥/g, '¥')
    // U+00A6  0xA6  ¦ Â¦  %C2 %A6
    .replace(/Â¦/g, '¦')
    // U+00A7  0xA7  § Â§  %C2 %A7
    .replace(/Â§/g, '§')
    // U+00A8  0xA8  ¨ Â¨  %C2 %A8
    .replace(/Â¨/g, '¨')
    // U+00A9  0xA9  © Â©  %C2 %A9
    .replace(/Â©/g, '©')
    // U+00AA  0xAA  ª Âª  %C2 %AA
    .replace(/Âª/g, 'ª')
    // U+00AB  0xAB  « Â«  %C2 %AB
    .replace(/Â«/g, '«')
    // U+00AC  0xAC  ¬ Â¬  %C2 %AC
    .replace(/Â¬/g, '¬')
    // U+00AD  0xAD  ­ Â­  %C2 %AD
    .replace(/Â­/g, '­')
    // U+00AE  0xAE  ® Â®  %C2 %AE
    .replace(/Â®/g, '®')
    // U+00AF  0xAF  ¯ Â¯  %C2 %AF
    .replace(/Â¯/g, '¯')
    // U+00B0  0xB0  ° Â°  %C2 %B0
    .replace(/Â°/g, '°')
    // U+00B1  0xB1  ± Â±  %C2 %B1
    .replace(/Â±/g, '±')
    // U+00B2  0xB2  ² Â²  %C2 %B2
    .replace(/Â²/g, '²')
    // U+00B3  0xB3  ³ Â³  %C2 %B3
    .replace(/Â³/g, '³')
    // U+00B4  0xB4  ´ Â´  %C2 %B4
    .replace(/Â´/g, '´')
    // U+00B5  0xB5  µ Âµ  %C2 %B5
    .replace(/Âµ/g, 'µ')
    // U+00B6  0xB6  ¶ Â¶  %C2 %B6
    .replace(/Â¶/g, '¶')
    // U+00B7  0xB7  · Â·  %C2 %B7
    .replace(/Â·/g, '·')
    // U+00B8  0xB8  ¸ Â¸  %C2 %B8
    .replace(/Â¸/g, '¸')
    // U+00B9  0xB9  ¹ Â¹  %C2 %B9
    .replace(/Â¹/g, '¹')
    // U+00BA  0xBA  º Âº  %C2 %BA
    .replace(/Âº/g, 'º')
    // U+00BB  0xBB  » Â»  %C2 %BB
    .replace(/Â»/g, '»')
    // U+00BC  0xBC  ¼ Â¼  %C2 %BC
    .replace(/Â¼/g, '¼')
    // U+00BD  0xBD  ½ Â½  %C2 %BD
    .replace(/Â½/g, '½')
    // U+00BE  0xBE  ¾ Â¾  %C2 %BE
    .replace(/Â¾/g, '¾')
    // U+00BF  0xBF  ¿ Â¿  %C2 %BF
    .replace(/Â¿/g, '¿')
    // U+00C0  0xC0  À Ã€  %C3 %80
    .replace(/Ã€/g, 'À')
    // U+00C2  0xC2  Â Ã‚  %C3 %82
    .replace(/Ã‚/g, 'Â')
    // U+00C3  0xC3  Ã Ãƒ  %C3 %83
    .replace(/Ãƒ/g, 'Ã')
    // U+00C4  0xC4  Ä Ã„  %C3 %84
    .replace(/Ã„/g, 'Ä')
    // U+00C5  0xC5  Å Ã…  %C3 %85
    .replace(/Ã…/g, 'Å')
    // U+00C6  0xC6  Æ Ã†  %C3 %86
    .replace(/Ã†/g, 'Æ')
    // U+00C7  0xC7  Ç Ã‡  %C3 %87
    .replace(/Ã‡/g, 'Ç')
    // U+00C8  0xC8  È Ãˆ  %C3 %88
    .replace(/Ãˆ/g, 'È')
    // U+00C9  0xC9  É Ã‰  %C3 %89
    .replace(/Ã‰/g, 'É')
    // U+00CA  0xCA  Ê ÃŠ  %C3 %8A
    .replace(/ÃŠ/g, 'Ê')
    // U+00CB  0xCB  Ë Ã‹  %C3 %8B
    .replace(/Ã‹/g, 'Ë')
    // U+00CC  0xCC  Ì ÃŒ  %C3 %8C
    .replace(/ÃŒ/g, 'Ì')
    // U+00CD  0xCD  Í Ã   %C3 %8D
    .replace(/Ã\u008D/g, 'Í')
    // U+00CE  0xCE  Î ÃŽ  %C3 %8E
    .replace(/ÃŽ/g, 'Î')
    // U+00CF  0xCF  Ï Ã   %C3 %8F
    .replace(/Ã\u008F/g, 'Ï')
    // U+00D0  0xD0  Ð Ã   %C3 %90
    .replace(/Ã\u0090/g, 'Ð')
    // U+00D1  0xD1  Ñ Ã‘  %C3 %91
    .replace(/Ã‘/g, 'Ñ')
    // U+00D2  0xD2  Ò Ã’  %C3 %92
    .replace(/Ã’/g, 'Ò')
    // U+00D3  0xD3  Ó Ã“  %C3 %93
    .replace(/Ã“/g, 'Ó')
    // U+00D4  0xD4  Ô Ã”  %C3 %94
    .replace(/Ã”/g, 'Ô')
    // U+00D5  0xD5  Õ Ã•  %C3 %95
    .replace(/Ã•/g, 'Õ')
    // U+00D6  0xD6  Ö Ã–  %C3 %96
    .replace(/Ã–/g, 'Ö')
    // U+00D7  0xD7  × Ã—  %C3 %97
    .replace(/Ã—/g, '×')
    // U+00D8  0xD8  Ø Ã˜  %C3 %98
    .replace(/Ã˜/g, 'Ø')
    // U+00D9  0xD9  Ù Ã™  %C3 %99
    .replace(/Ã™/g, 'Ù')
    // U+00DA  0xDA  Ú Ãš  %C3 %9A
    .replace(/Ãš/g, 'Ú')
    // U+00DB  0xDB  Û Ã›  %C3 %9B
    .replace(/Ã›/g, 'Û')
    // U+00DC  0xDC  Ü Ãœ  %C3 %9C
    .replace(/Ãœ/g, 'Ü')
    // U+00DD  0xDD  Ý Ã   %C3 %9D
    .replace(/Ã\u009D/g, 'Ý')
    // U+00DE  0xDE  Þ Ãž  %C3 %9E
    .replace(/Ãž/g, 'Þ')
    // U+00DF  0xDF  ß ÃŸ  %C3 %9F
    .replace(/ÃŸ/g, 'ß')
    // U+00E0  0xE0  à Ã   %C3 %A0
    .replace(/Ã\u00A0/g, 'à')
    // U+00E1  0xE1  á Ã¡  %C3 %A1
    .replace(/Ã¡/g, 'á')
    // U+00E2  0xE2  â Ã¢  %C3 %A2
    .replace(/Ã¢/g, 'â')
    // U+00E3  0xE3  ã Ã£  %C3 %A3
    .replace(/Ã£/g, 'ã')
    // U+00E4  0xE4  ä Ã¤  %C3 %A4
    .replace(/Ã¤/g, 'ä')
    // U+00E5  0xE5  å Ã¥  %C3 %A5
    .replace(/Ã¥/g, 'å')
    // U+00E6  0xE6  æ Ã¦  %C3 %A6
    .replace(/Ã¦/g, 'æ')
    // U+00E7  0xE7  ç Ã§  %C3 %A7
    .replace(/Ã§/g, 'ç')
    // U+00E8  0xE8  è Ã¨  %C3 %A8
    .replace(/Ã¨/g, 'è')
    // U+00E9  0xE9  é Ã©  %C3 %A9
    .replace(/Ã©/g, 'é')
    // U+00EA  0xEA  ê Ãª  %C3 %AA
    .replace(/Ãª/g, 'ê')
    // U+00EB  0xEB  ë Ã«  %C3 %AB
    .replace(/Ã«/g, 'ë')
    // U+00EC  0xEC  ì Ã¬  %C3 %AC
    .replace(/Ã¬/g, 'ì')
    // U+00ED  0xED  í Ã­  %C3 %AD
    .replace(/Ã\u00AD/g, 'í')
    // U+00EE  0xEE  î Ã®  %C3 %AE
    .replace(/Ã®/g, 'î')
    // U+00EF  0xEF  ï Ã¯  %C3 %AF
    .replace(/Ã¯/g, 'ï')
    // U+00F0  0xF0  ð Ã°  %C3 %B0
    .replace(/Ã°/g, 'ð')
    // U+00F1  0xF1  ñ Ã±  %C3 %B1
    .replace(/Ã±/g, 'ñ')
    // U+00F2  0xF2  ò Ã²  %C3 %B2
    .replace(/Ã²/g, 'ò')
    // U+00F3  0xF3  ó Ã³  %C3 %B3
    .replace(/Ã³/g, 'ó')
    // U+00F4  0xF4  ô Ã´  %C3 %B4
    .replace(/Ã´/g, 'ô')
    // U+00F5  0xF5  õ Ãµ  %C3 %B5
    .replace(/Ãµ/g, 'õ')
    // U+00F6  0xF6  ö Ã¶  %C3 %B6
    .replace(/Ã¶/g, 'ö')
    // U+00F7  0xF7  ÷ Ã·  %C3 %B7
    .replace(/Ã·/g, '÷')
    // U+00F8  0xF8  ø Ã¸  %C3 %B8
    .replace(/Ã¸/g, 'ø')
    // U+00F9  0xF9  ù Ã¹  %C3 %B9
    .replace(/Ã¹/g, 'ù')
    // U+00FA  0xFA  ú Ãº  %C3 %BA
    .replace(/Ãº/g, 'ú')
    // U+00FB  0xFB  û Ã»  %C3 %BB
    .replace(/Ã»/g, 'û')
    // U+00FC  0xFC  ü Ã¼  %C3 %BC
    .replace(/Ã¼/g, 'ü')
    // U+00FD  0xFD  ý Ã½  %C3 %BD
    .replace(/Ã½/g, 'ý')
    // U+00FE  0xFE  þ Ã¾  %C3 %BE
    .replace(/Ã¾/g, 'þ')
    // U+00FF  0xFF  ÿ Ã¿  %C3 %BF
    .replace(/Ã¿/g, 'ÿ')
}

function kfmt(num, digits = 1) {
    var si = [
        { value: 1, symbol: "" },
        { value: 1E3, symbol: "K" },
        { value: 1E6, symbol: "M" },
        { value: 1E9, symbol: "G" },
        { value: 1E12, symbol: "T" },
        { value: 1E15, symbol: "P" },
        { value: 1E18, symbol: "E" }
    ];
    var rx = /\.0+$|(\.[0-9]*[1-9])0+$/;
    var i;
    for (i = si.length - 1; i > 0; i--) {
        if (num >= si[i].value) {
        break;
        }
    }
    return (num / si[i].value).toFixed(digits).replace(rx, "$1") + si[i].symbol;
}

function kbfmt(bytes, decimals = 1) { // https://stackoverflow.com/questions/15900485/correct-way-to-convert-size-in-bytes-to-kb-mb-gb-in-javascript
    if (bytes === 0) return '0 Bytes'
    const k = 1024, dm = decimals < 0 ? 0 : decimals, sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i]
}

function kbsfmt(bytes, decimals = 1){
    if (isNaN(bytes) || typeof(bytes) != 'number') return 'N/A'
    if (bytes === 0) return '0 Bytes/ps'
    const k = 1024, dm = decimals < 0 ? 0 : decimals, sizes = ['Bytes/ps', 'KBps', 'MBps', 'GBps', 'TBps', 'PBps', 'EBps', 'ZBps', 'YBps']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i]
}

function isValidPath(url){ // poor checking for now
    if(url.indexOf('/') == -1 && url.indexOf('\\') == -1){
        return false;
    }
    return true;
}

var installedVersion = 0;
function getManifest(callback){
    $.get('package.json', function (data){
        if(typeof(data)=='string'){
            data = data.replace(new RegExp('/\\* .+ \\*/', 'gm'), '');
            data = JSON.parse(data.replaceAll("\n", ""))
        }
        console.log(data);
        if(data && data.version){
            installedVersion = data.version;
        }
        callback(data)
    })
}
    
function applyIcon(icon){
    if(top){
        var doc = parent.parent.document;
        var link = doc.querySelector("link[rel*='icon']") || doc.createElement('link');
        link.type = 'image/x-png';
        link.rel = 'shortcut icon';
        link.href = icon;
        doc.querySelector('head').appendChild(link);
        var c = doc.querySelector('.cf-icon');
        if(c) {
            c.style.backgroundImage = 'url("{0}")'.format(icon)
        }
    }
}

function wordWrapPhrase(str, count, sep){
    var ret = '', sts = String(str).split(' '), wordsPerLine = Math.ceil(sts.length / count);
    for(var i=0; i<count; i++){
        if(i){
            ret += sep;
        }
        ret += sts.slice(i * wordsPerLine, (i * wordsPerLine) + wordsPerLine).join(' ');
    }
    return ret;
}

function replaceLast(x, y, z){
    var a = x.split("");
    a[x.lastIndexOf(y)] = z;
    return a.join("");
}

function urldecode(t){
    t = t.replaceAll('+', ' ');
    try {
        var nt = decodeURIComponent(t.replaceAll('+', ' '));
        if(nt) {
            t = nt;
        }
    } catch(e) { }
    return t;
}   

function componentToHex(c) {
    var hex = c.toString(16);
    return hex.length == 1 ? "0" + hex : hex;
}

function rgbToHex(r, g, b) {
    return "#" + componentToHex(r) + componentToHex(g) + componentToHex(b);
}

function hexToRgb(ohex) {
    var shorthandRegex = /^#?([a-f\d])([a-f\d])([a-f\d])$/i, hex = ohex.replace(shorthandRegex, (m, r, g, b) => {
        return r + r + g + g + b + b
    })
    var result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex)
    return result ? {
        r: parseInt(result[1], 16),
        g: parseInt(result[2], 16),
        b: parseInt(result[3], 16)
    } : ohex
}

function removeQueryString(url){
    return url.split('?')[0].split('#')[0];
}

function isM3U8(url){
    if(typeof(url)!='string') return false;
    return ['m3u8'].indexOf(getExt(url)) != -1;            
}

function isTS(url){
    if(typeof(url)!='string') return false;
    return ['m2ts', 'ts'].indexOf(getExt(url)) != -1  
}

function isRemoteTS(url){
    if(typeof(url)!='string') return false;
    return isHTTP(url) && ['m2ts', 'ts'].indexOf(getExt(url)) != -1  
}

function isHTTP(url){
    if(typeof(url)!='string') return false;
    return url.match(new RegExp('^https?:', 'i'));            
}

function isHTTPS(url){
    if(typeof(url)!='string') return false;
    return url.match(new RegExp('^https:', 'i'));            
}

function getExt(url){
    return String(url).split('?')[0].split('#')[0].split('.').pop().toLowerCase();        
}

function closest(num, arr) {
    var curr = arr[0];
    var diff = Math.abs (num - curr);
    for (var val = 0; val < arr.length; val++) {
        var newdiff = Math.abs (num - arr[val]);
        if (newdiff < diff) {
            diff = newdiff;
            curr = arr[val];
        }
    }
    return curr;
}

function traceback() { 
    try { 
        var a = {}
        a.debug()
    } catch(ex) {
        return ex.stack.replace('TypeError: a.debug is not a function', '').trim()
    }
}

if(typeof(logErr) != 'function'){
    logErr = (...args) => {
        let log = '', a = Array.from(args)
        try {
            log += JSON.stringify(a, censor(a)) + "\r\n"
        } catch(e) { }
        log += traceback()+"\r\n\r\n"
    }
}

function checkPermissions(_perms, callback) {
	if(!Array.isArray(_perms)){
		_perms = [_perms]
	}
	_perms = _perms.map(p => {
		if(typeof(p) == 'string'){
			p = parent.cordova.plugins.permissions[p]
		}
		return p
	})
	parent.cordova.plugins.permissions.checkPermission(_perms, status => {
		console.log('checking permissions => '+ JSON.stringify({_perms, status}))
		if (status.hasPermission) {
			return callback(true)
		}
        parent.cordova.plugins.permissions.requestPermissions(_perms, status => callback(!!status.hasPermission), () => callback(false))
	}, null)
}

var openFileDialogChooser = false;
function openFileDialog(callback, accepts) {
    if(!openFileDialogChooser){ // JIT
        openFileDialogChooser = $('<input type="file" />');
    }
    openFileDialogChooser.get(0).value = "";
    if(accepts){
        openFileDialogChooser.attr("accept", accepts)
    } else {
        openFileDialogChooser.removeAttr("accept")
    }
    openFileDialogChooser.off('change');
    openFileDialogChooser.on('change', function(evt) {
        callback(openFileDialogChooser.val());
    });    
    openFileDialogChooser.trigger('click');  
    return openFileDialogChooser;
}

var saveFileDialogChooser = false;
function saveFileDialog(callback, placeholder) {
    if(!saveFileDialogChooser){ // JIT
        saveFileDialogChooser = $('<input type="file" nwsaveas />');
    }
    if(placeholder){
        saveFileDialogChooser.prop('nwsaveas', placeholder)
    }
    saveFileDialogChooser.off('change');
    saveFileDialogChooser.val('');
    saveFileDialogChooser.on('change', (evt) => {
        callback(saveFileDialogChooser.val());
    });    
    saveFileDialogChooser.trigger('click')
}

var saveFolderDialogChooser = false;
function saveFolderDialog(callback, placeholder) {
    if(!saveFolderDialogChooser){ // JIT
        saveFolderDialogChooser = $('<input type="file" nwdirectory />');
    }
    if(placeholder){
        saveFolderDialogChooser.prop('nwdirectory', placeholder)
    }
    saveFolderDialogChooser.off('change');
    saveFolderDialogChooser.val('');
    saveFolderDialogChooser.on('change', (evt) => {
        callback(saveFolderDialogChooser.val());
    });    
    saveFolderDialogChooser.trigger('click')
}

//chooseFile(function (file){alert(file);window.ww=file});

function isYoutubeURL(source){
    if(typeof(source)=='string'){
        var parts = source.split('/');
        if(parts.length > 2){
            if(parts[2].match(new RegExp('youtube\.com|youtu\.be'))){
                return true;
            }
        }
    }
}

function isValidHex(hex){
    return /^#([A-Fa-f0-9]{3,4}){1,2}$/.test(hex)
}

function getChunksFromString(st, chunkSize){
    return st.match(new RegExp(`.{${chunkSize}}`, "g"))
}

function convertHexUnitTo256(hexStr){
    return parseInt(hexStr.repeat(2 / hexStr.length), 16)
}

function getAlphafloat(a, alpha){
    if (typeof a !== "undefined") {return a / 256}
    if (typeof alpha !== "undefined"){
        if (1 < alpha && alpha <= 100) { return alpha / 100}
        if (0 <= alpha && alpha <= 1) { return alpha }
    }
    return 1
}

function hexToRGBA(hex, alpha){
    if (!isValidHex(hex)) {
        throw new Error('Invalid HEX '+ hex)
    }
    const chunkSize = Math.floor((hex.length - 1) / 3)
    const hexArr = getChunksFromString(hex.slice(1), chunkSize)
    const [r, g, b, a] = hexArr.map(convertHexUnitTo256)
    return 'rgba('+ [r, g, b, getAlphafloat(a, alpha)].join(', ') +')'
}

function setupFontDetector(){
    if(typeof(window.isFontAvailable) != 'function'){
        var width, body = document.body || document.querySelector('body')  
        var container = document.createElement('span')
        container.innerHTML = Array(100).join('wi')
        container.style.cssText = [
            'position:absolute',
            'width:auto',
            'font-size:128px',
            'left:-99999px'
        ].join(' !important;')
        var getWidth = fontFamily => {
            container.style.fontFamily = fontFamily.split(',').map(f => "'"+ f.trim() +"'").join(',')
            body.appendChild(container)
            width = container.clientWidth
            body.removeChild(container)        
            return width
        }
        // Pre compute the widths of monospace, serif & sans-serif
        // to improve performance.
        var monoWidth  = getWidth('monospace')
        var serifWidth = getWidth('serif')
        var sansWidth  = getWidth('sans-serif')  
        window.isFontAvailable = font => {
          return monoWidth !== getWidth(font + ',monospace') ||
            sansWidth !== getWidth(font + ',sans-serif') ||
            serifWidth !== getWidth(font + ',serif');
        }
    }
}

function getFontList(){
    setupFontDetector()
    return [
        '-apple-system',
        'Arial',
        'BlinkMacSystemFont', 
        'Calibri',
        'Cantarell', 
        'Century Gothic',
        'Comic Sans',
        'Consolas',
        'Courier',
        'Dejavu Sans',
        'Dejavu Serif',
        'Futura',
        'Georgia',
        'Gill Sans',
        'Gotham',
        'Helvetica',
        'Helvetica Neue', 
        'Impact',
        'Lato',
        'Lucida Sans',
        'Myriad Pro',
        'Netflix Sans',
        'Open Sans',
        'Oxygen-Sans', 
        'Palatino',
        'Roboto',
        'Segoe UI', 
        'sans-serif',
        'Tahoma',
        'Times New Roman',
        'Trebuchet',
        'Ubuntu', 
        'Verdana',
        'Zapfino'
    ].filter(isFontAvailable)
}
