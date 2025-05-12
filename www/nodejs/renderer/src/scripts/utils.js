
if (typeof Array.prototype.unique === 'undefined') {
    Object.defineProperty(Array.prototype, 'unique', {
        enumerable: false,
        configurable: false,
        writable: false,
        value: function () {
            return [...new Set(this)]
        }
    })
}

if (typeof String.prototype.format === 'undefined') {
    Object.defineProperty(String.prototype, 'format', {
        enumerable: false,
        configurable: false,
        writable: false,
        value: function () {
            var args = arguments;
            return this.replace(/{(\d+)}/g, function (match, number) {
                return typeof args[number] != 'undefined'
                    ? args[number]
                    : match
            })
        }
    })
}

if (typeof String.prototype.replaceAll === 'undefined' ) {
    Object.defineProperty(String.prototype, 'replaceAll', {
        enumerable: false,
        configurable: false,
        writable: false,
        value: function (search, replacement) {
            var target = this
            if (target.includes(search)) {
                target = target.split(search).join(replacement)
            }
            return String(target)
        }
    })
}

try {
    if (typeof Object.values === 'undefined') {
        Object.defineProperty(Object, 'values', {
            enumerable: false,
            configurable: true,
            writable: true,
            value: function (obj) {
                if (obj === null || typeof obj !== 'object') {
                    throw new TypeError('Object.values called on non-object');
                }
                return Object.keys(obj).map(key => obj[key]);
            }
        });
    }
} catch(e) {
    console.error('Object.values is not supported', e)
}

export const css = (code, id, scope) => {
    if(!scope){
        scope = window
    }
    if(scope && scope.document){
        try {
            //console.warn('style creating', code)
            var s = scope.document.getElementById('css-'+ id)
            if(s){
                s.parentNode.removeChild(s)
            } else {
                //console.warn('style created');
                s = scope.document.createElement('style')
                s.type = 'text/css'
                s.id = 'css-'+ id
            }
            s.innerText = '';
            s.appendChild(scope.document.createTextNode(code))
            scope.document.body.insertAdjacentElement('beforeend', s)
            //console.warn('style created OK')
        } catch(e) {
            console.log('CSS Error', e, code)
        }
    }
}

let detectFontSizeTempElement = null
export const detectFontSizeMultiplier = () => {
    const testFontSize = 100 // px
    if(!detectFontSizeTempElement) {
        detectFontSizeTempElement = document.createElement('span')
        detectFontSizeTempElement.textContent = 'M'
        detectFontSizeTempElement.style.cssText = `
            font-size: ${testFontSize}px;
            line-height: ${testFontSize}px;
            position: absolute;
            visibility: hidden;
        `
    }
    document.body.appendChild(detectFontSizeTempElement)
    const renderedHeight = detectFontSizeTempElement.offsetHeight
    document.body.removeChild(detectFontSizeTempElement)
    return testFontSize / renderedHeight
}

export const getCssVariable = variableName => {
    return getComputedStyle(document.documentElement).getPropertyValue(variableName).trim();
}

export const time = () => {
    return Date.now() / 1000
}

export const absolutize = (url, base) => {
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
    } else { 
        base = a.pathname.split('/') // relative path
        base.pop()
    }
    url=url.split('/');
    for(var i=0; i<url.length; ++i){
        if(url[i]==='.'){ // current directory
            continue;
        }
        if(url[i]==='..'){ // parent directory
            if('undefined'===typeof(base.pop()) || base.length===0){ 
                return null; // wrong url accessing non-existing parent directories
            }
        } else { // child directory
            base.push(url[i]); 
        }
    }
    return a.protocol + '//' + a.hostname + (a.port && a.port != 80 ? ':' + a.port : '') + base.join('/');
}

export const basename = (str, rqs) => {
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

export const ucWords = (str) => {
    return str.toLowerCase().replace(/^[\u00C0-\u1FFF\u2C00-\uD7FF\w]|\s[\u00C0-\u1FFF\u2C00-\uD7FF\w]/g, function(letter) {
        return letter.toUpperCase();
    })
}

export const kbfmt = (bytes, decimals = 1) => { // https://stackoverflow.com/questions/15900485/correct-way-to-convert-size-in-bytes-to-kb-mb-gb-in-javascript
    if (bytes === 0) return '0 Bytes'
    const k = 1024, dm = decimals < 0 ? 0 : decimals, sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i]
}

export const kbsfmt = (bytes, decimals = 1) => {
    if (isNaN(bytes) || typeof(bytes) != 'number') return 'N/A'
    if (bytes === 0) return '0 Bytes/ps'
    const k = 1024, dm = decimals < 0 ? 0 : decimals, sizes = ['Bytes/ps', 'KBps', 'MBps', 'GBps', 'TBps', 'PBps', 'EBps', 'ZBps', 'YBps']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i]
}

export const traceback = () => { 
    try { 
        const a = {}
        a.debug()
    } catch(ex) {
        const piece = 'is not a function'
        return ex.stack.split(piece).slice(1).join(piece).trim()
    }
}
