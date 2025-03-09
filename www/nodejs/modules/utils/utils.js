import sanitizeFilename from 'sanitize-filename'
import np from '../network-ip/network-ip.js'
import os from 'os';
import { URL } from 'node:url'
import { inWorker } from '../paths/paths.js'
import fs from 'fs'
import vm from 'vm'
import path from 'path'
import dayjs from 'dayjs'
import cloneModule from 'fast-json-clone'
import utc from 'dayjs/plugin/utc.js'
import timezone from 'dayjs/plugin/timezone.js' // dependent on utc plugin
import relativeTime from 'dayjs/plugin/relativeTime.js'
import localizedFormat from 'dayjs/plugin/localizedFormat.js'
import { getDirname } from 'cross-dirname'

dayjs.extend(utc)
dayjs.extend(timezone)
dayjs.extend(relativeTime)
dayjs.extend(localizedFormat)

const originalLocale = dayjs.locale.bind(dayjs)
dayjs.locale = async locales => {
    if (typeof(locales) == 'string') {
        locales = [locales]
    }
    const dir = getDirname()
    const run = (content, varName) => {
        const context = {
            global: {
                [varName]: null
            },
            [varName]: null,
            output: null
        }
        vm.createContext(context)
        try {
            const script = new vm.Script(content)
            script.runInNewContext(context)
            return context.output || context.global[varName] || context[varName] || null
        } catch(err) {
            return null
        }
    }
    for (const locale of locales) {
        const file = path.join(dir, 'dayjs-locale', locale +'.js')
        const stat = await fs.promises.stat(file).catch(() => {})
        if (!stat || !stat.size) continue
    
        const varName = 'dayjs_locale_' + locale.replace('-', '_')
        const scriptContent = await fs.promises.readFile(file, 'utf8')
        let trimmedScriptContent = 'output='+ scriptContent.
            replace(new RegExp('(^.*|,)[a-z] ?=', 'm'), '').
            replace(new RegExp(';[^;]*return.*$', 'm'), '')
        const ret = run(trimmedScriptContent, varName) || run(scriptContent, varName)
        if(!ret) {
            console.error(`Error loading locale ${locale} from ${file}`)
            continue
        }
        originalLocale(ret)
        break
    }
}

export const moment = dayjs

if (!global.Promise.allSettled) {
    global.Promise.allSettled = ((promises) => Promise.all(promises.map(p => p
        .then(value => ({
        status: 'fulfilled', value
    }))
        .catch(reason => ({
        status: 'rejected', reason
    })))))
}

if (!global.String.prototype.format) {
    Object.defineProperty(global.String.prototype, 'format', {
        enumerable: false,
        configurable: false,
        writable: false,
        value: function () {
            var args = arguments;
            return this.replace(/{(\d+)}/g, function (match, number) {
                return typeof args[number] != 'undefined'
                    ? args[number]
                    : match;
            });
        }
    });
}
if (!global.String.prototype.matchAll) {
    Object.defineProperty(global.String.prototype, 'matchAll', {
        enumerable: false,
        configurable: false,
        writable: false,
        value: function (regexp) {
            var matches = [];
            this.replace(regexp, function () {
                var arr = ([]).slice.call(arguments, 0);
                var extras = arr.splice(-2);
                arr.index = extras[0];
                arr.input = extras[1];
                matches.push(arr);
            });
            return matches.length ? matches : [];
        }
    });
}
if (!global.Array.prototype.findLastIndex) {
    Object.defineProperty(global.Array.prototype, 'findLastIndex', {
        enumerable: false,
        configurable: false,
        writable: false,
        value: function (callback, thisArg) {
            for (let i = this.length - 1; i >= 0; i--) {
                if (callback.call(thisArg, this[i], i, this))
                    return i;
            }
            return -1;
        }
    });
}
if (!global.Array.prototype.unique) {
    Object.defineProperty(global.Array.prototype, 'unique', {
        enumerable: false,
        configurable: false,
        writable: false,
        value: function () {
            return [...new Set(this)];
        }
    });
}
if (!global.Array.prototype.sortByProp) {
    Object.defineProperty(global.Array.prototype, 'sortByProp', {
        enumerable: false,
        configurable: false,
        writable: false,
        value: function (p, reverse) {
            if (Array.isArray(this)) { // this.slice is not a function (?!)
                return this.slice(0).sort((a, b) => {
                    let ua = typeof(a[p]) == 'undefined', ub = typeof(b[p]) == 'undefined';
                    if (ua && ub)
                        return 0;
                    if (ua && !ub)
                        return reverse ? 1 : -1;
                    if (!ua && ub)
                        return reverse ? -1 : 1;
                    if (reverse)
                        return (a[p] > b[p]) ? -1 : (a[p] < b[p]) ? 1 : 0;
                    return (a[p] > b[p]) ? 1 : (a[p] < b[p]) ? -1 : 0;
                });
            }
            return this;
        }
    });
}
if (!global.Number.prototype.between) {
    Object.defineProperty(global.Number.prototype, 'between', {
        enumerable: false,
        configurable: false,
        writable: false,
        value: function (a, b) {
            var min = Math.min(a, b), max = Math.max(a, b);
            return this >= min && this <= max;
        }
    });
}
if (!global.String.prototype.replaceAll) {
    Object.defineProperty(global.String.prototype, 'replaceAll', {
        enumerable: false,
        configurable: false,
        writable: false,
        value: function (search, replacement) {
            let target = String(this);
            if (target.includes(search)) {
                target = target.split(search).join(replacement);
            }
            return target;
        }
    });
}

const DEFAULT_ACCESS_CONTROL_ALLOW_HEADERS = 'Origin, X-Requested-With, Content-Type, Cache-Control, Accept, Content-Range, Range, Vary, range, Authorization'
const trimExt = (text, exts) => {
    if (typeof(exts) == 'string') {
        exts = [exts]
    }
    exts.some(e => {
        if (text.endsWith('.' + e)) {
            text = text.substr(0, text.length - (e.length + 1))
            return true
        }
    })
    return text
}
const cleanListName = (name) => {
    return trimExt(name.replace(/[?\\"<>]/g, ' '), ['m3u'])
}

export const clone = (cloneModule?.default || cloneModule)
export const LIST_DATA_KEY_MASK = 'list-data-1-{0}'
export const forwardSlashes = path => {
    if (path && path.includes('\\')) {
        return path.replaceAll('\\', '/').replaceAll('//', '/');
    }
    return path;
}
export const getDomain = (u, includePort) => {
    let d = u;
    if (u && u.includes('//')) {
        d = u.split('//')[1].split('/')[0]
    }
    if (d.includes('@')) {
        d = d.split('@')[1]
    }
    if (d.includes(':') && !includePort) {
        d = d.split(':')[0]
    }
    return d
}
export const isYT = (url) => {
    if (url.includes('youtu')) {
        const d = getDomain(url)
        if (d.includes('youtube.com') || d.includes('youtu.be')) {
            return true
        }
    }
}
export const basename = (str, rqs) => {
    str = String(str);
    let qs = '', pos = str.indexOf('?')
    if (pos != -1) {
        qs = str.slice(pos + 1)
        str = str.slice(0, pos)
    }
    str = forwardSlashes(str)
    pos = str.lastIndexOf('/')
    if (pos != -1) {
        str = str.substring(pos + 1)
    }
    if (!rqs && qs) {
        str += '?' + qs
    }
    return str
}
export const ext = file => {
    let parts = basename(file, true).split('.')
    if (parts.length > 1) {
        return parts.pop().toLowerCase()
    } else {
        return ''
    }
}
export const joinPath = (folder, file) => {
    if (!file)
        return folder;
    if (!folder)
        return file;
    let ret, ffolder = folder, ffile = file;
    if (ffolder.includes('\\')) {
        ffolder = forwardSlashes(ffolder);
    }
    if (ffile.includes('\\')) {
        ffile = forwardSlashes(ffile);
    }
    let folderEndsWithSlash = ffolder.charAt(ffolder.length - 1) == '/';
    let fileStartsWithSlash = ffile.startsWith('/');
    if (fileStartsWithSlash && folderEndsWithSlash) {
        ret = ffolder + ffile.substr(1);
    } else if (fileStartsWithSlash || folderEndsWithSlash) {
        ret = ffolder + ffile;
    } else {
        ret = ffolder + '/' + ffile;
    }
    return ret
}
export const decodeURIComponentSafe = uri => {
    try {
        return decodeURIComponent(uri);
    }
    catch (e) {
        return uri.replace(new RegExp('%[A-Z0-9]{0,2}', 'gi'), x => {
            try {
                return decodeURIComponent(x);
            }
            catch (e) {
                return x;
            }
        });
    }
}
export const moveFile = async (from, to) => {
    await fs.promises.mkdir(dirname(to), { recursive: true }).catch(() => {})
    try {
        await fs.promises.rename(from, to)
    } catch (err) {
        try {
            await fs.promises.copyFile(from, to)
            await fs.promises.unlink(from)
        } catch(err) {
            throw err
        }
    }
}
const insertEntryLookup = (e, term) => {
    if (Array.isArray(term)) {
        return term.some(t => insertEntryLookup(e, t))
    }
    return term && (e.name === term || e.hookId === term)
}

const insertEntryPosition = (entries, entry, existingIndex) => {
    let position = -1
    if (existingIndex >= 0) {
        position = existingIndex;
    }
    if (entry.order) {
        if (entry.order.before) {
            const beforeIndex = entries.findIndex(e => insertEntryLookup(e, entry.order.before || []));
            if (beforeIndex >= 0 && (position === -1 || beforeIndex < position)) {
                position = beforeIndex
            }
        }
        if (entry.order.after) {
            const afterIndex = entries.findLastIndex(e => insertEntryLookup(e, entry.order.after || []));
            if (afterIndex >= 0 && (position === -1 || afterIndex >= position)) {
                position = afterIndex + 1
            }
        }
    }
    if (position === -1) position = entries.length
    return position
}

export const insertEntry = (entry, entries, before, after) => {
    entry.order = { before, after }
    const existingIndex = entries.findIndex(e => e.name === entry.name);
    const position = insertEntryPosition(entries, entry, existingIndex);
    if (existingIndex === position) {
        entries[position] = entry
        return
    }
    if (existingIndex >= 0) entries.splice(existingIndex, 1)
    entries.splice(position, 0, entry)
}

const validateURLRegex = new RegExp(
    // supported protocols: http, https, rtmp, rtmps, rtmpte, rtsp, mms, and others
    '^(?:(?:(?:https?|rt[ms]p[a-z]{0,2}):)?\\/\\/)' + 
    // optional user authentication
    '(?:\\S+(?::\\S*)?@)?' + 
    // domain name or IP address (without excluding private IPs)
    '(?:(?:[1-9]\\d?|1\\d\\d|2[01]\\d|22[0-3])(?:\\.(?:1?\\d{1,2}|2[0-4]\\d|25[0-5])){2}' + 
    '(?:\\.(?:[1-9]\\d?|1\\d\\d|2[0-4]\\d|25[0-4]))|' + // match valid IP address
    '(?:(?:[a-z\\u00a1-\\uffff0-9]-*)*[a-z\\u00a1-\\uffff0-9]+)' + // match domain name
    '(?:\\.(?:[a-z\\u00a1-\\uffff0-9]-*)*[a-z\\u00a1-\\uffff0-9]+)*' + // subdomains
    '(?:\\.(?:[a-z\\u00a1-\\uffff]{2,}))' + // top-level domain
    ')(?::\\d{2,5})?' + // optional port
    '(?:[/?#]\\S*)?$', // optional path and query string
    'i' // case-insensitive
)

export const validateURL = url => {
    if (!url || url.length <= 11) return false
    return validateURLRegex.test(url)
}

export const ucFirst = (str, keepCase) => {
    if (!keepCase) {
        str = str.toLowerCase();
    }
    return str.replace(/^[\u00C0-\u1FFF\u2C00-\uD7FF\w]/g, letter => {
        return letter.toUpperCase();
    });
}
export const ts2clock = time => {
    if (typeof(time) == 'string') {
        time = parseInt(time)
    }
    time = moment(time * 1000)
    return time.format('LT')
}
export const dirname = _path => {
    let parts = _path.replace(new RegExp('\\\\', 'g'), '/').split('/')
    parts.pop()
    return parts.join('/')
}
export const sanitize = (txt, keepAccents) => {
    let ret = txt;
    if (keepAccents !== true) {
        //ret = ret.replace(new RegExp('[^\x00-\x7F]+', 'g'), '')
        ret = ret.normalize('NFD').replace(new RegExp('[\u0300-\u036f]', 'g'), '').replace(new RegExp('[^A-Za-z0-9\\._\\- ]', 'g'), '');
    }
    return sanitizeFilename(ret);
}
if (process.platform == 'android') {
    if (np.shouldPatchNetworkInterfaces()) {
        os.networkInterfaces = () => np.networkInterfaces();
    }
}
export const prepareCORS = (headers, url, forceOrigin) => {
    let origin = typeof(forceorigin) == 'string' ? forceOrigin : '*';
    if (url) {
        if (typeof(url) != 'string') { // is req object
            if (url.headers.origin) {
                url = url.headers.origin;
            } else {
                const scheme = url.connection.encrypted ? 'https' : 'http';
                const host = url.headers.host;
                url = scheme + '://' + host + url.url;
            }
        }
        let pos = url.indexOf('//');
        if (!forceOrigin && pos != -1 && pos <= 5) {
            origin = url.split('/').slice(0, 3).join('/');
        }
    }
    if (headers.setHeader) { // response object
        headers.setHeader('access-control-allow-origin', origin);
        headers.setHeader('access-control-allow-methods', 'GET,HEAD,OPTIONS');
        headers.setHeader('access-control-allow-headers', DEFAULT_ACCESS_CONTROL_ALLOW_HEADERS);
        headers.setHeader('access-control-expose-headers', DEFAULT_ACCESS_CONTROL_ALLOW_HEADERS);
        headers.setHeader('access-control-allow-credentials', true);
    } else {
        headers['access-control-allow-origin'] = origin;
        headers['access-control-allow-methods'] = 'GET,HEAD,OPTIONS';
        headers['access-control-allow-headers'] = DEFAULT_ACCESS_CONTROL_ALLOW_HEADERS;
        headers['access-control-expose-headers'] = DEFAULT_ACCESS_CONTROL_ALLOW_HEADERS;
        headers['access-control-allow-credentials'] = true;
    }
    return headers;
}
export const isWritable = stream => {
    return (stream.writable || stream.writeable) && !stream.finished;
}
export const listNameFromURL = url => {
    if (!url)
        return 'Untitled ' + parseInt(Math.random() * 9999);
    let name, subName;
    if (url.includes('?')) {
        url.split('?')[1].split('&').forEach(s => {
            s = s.split('=');
            if (s.length > 1) {
                if (['name', 'dn', 'title'].includes(s[0])) {
                    if (!name || name.length < s[1].length) {
                        name = s[1];
                    }
                }
                if (['user', 'username'].includes(s[0])) {
                    if (!subName) {
                        subName = s[1];
                    }
                }
            }
        });
    }
    if (!name && url.includes('@')) {
        const m = url.match(new RegExp('//([^:]+):[^@]+@([^/#]+)'));
        if (m) {
            name = m[2] + ' ' + m[1];
        }
    }
    if (name) {
        name = decodeURIComponentSafe(name);
        if (!name.includes(' ') && name.includes('+')) {
            name = name.replaceAll('+', ' ').replaceAll('<', '').replaceAll('>', '');
        }
        return cleanListName(name);
    }
    if (!url.includes('//')) { // isLocal
        return cleanListName(url.split('/').pop());
    } else {
        url = String(url).replace(new RegExp('^[a-z]*://', 'i'), '').split('/').filter(s => s.length);
        if (!url.length) {
            return 'Untitled ' + parseInt(Math.random() * 9999);
        } else if (url.length == 1) {
            return cleanListName(url[0].split(':')[0]);
        } else {
            return cleanListName(url[0].split('.')[0] + ' ' + (subName || url[url.length - 1].substr(0, 24)));
        }
    }
}
export const parseCommaDelimitedURIs = (url, pickFirst) => {
    let urls
    if(Array.isArray(url)) {
        urls = url.slice(0)
    } else {
        if (url.match(new RegExp(', *(https?://|//)'))) {
            urls = url.replace(',//', ',http://').replaceAll(', http', ',http').split(',http').map((u, i) => {
                if (i) {
                    u = 'http' + u
                }
                return u
            })
        } else if(url) {
            urls = [url]
        } else {
            urls = []
        }
    }
    return pickFirst ? urls.shift() : urls
}
export const kbfmt = (bytes, decimals = 2) => {
    if (isNaN(bytes) || typeof(bytes) != 'number')
        return 'N/A';
    if (bytes === 0)
        return '0 Bytes';
    const k = 1024, dm = decimals < 0 ? 0 : decimals, sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}
export const kbsfmt = (bytes, decimals = 1) => {
    if (isNaN(bytes) || typeof(bytes) != 'number')
        return 'N/A';
    if (bytes === 0)
        return '0 Bytes/ps';
    const k = 1024, dm = decimals < 0 ? 0 : decimals, sizes = ['Bytes/ps', 'KBps', 'MBps', 'GBps', 'TBps', 'PBps', 'EBps', 'ZBps', 'YBps'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}
export const absolutize = (path, url) => {
    if (!path)
        return url;
    if (!url)
        return path;
    if (path.startsWith('//')) {
        path = 'http:' + path;
    }
    if (path.match(new RegExp('^[htps:]?//'))) {
        return path;
    }
    let uri;
    try {
        uri = new URL(path, url)
        return uri.href
    } catch (e) {
        return joinPath(url, path)
    }
}
export const ucWords = (str, force) => {
    if (!force && str != str.toLowerCase()) {
        return str;
    }
    return str.replace(new RegExp('(^|[ ])[A-zÀ-ú]', 'g'), letra => {
        return letra.toUpperCase();
    });
}
export const rmdir = async (folder, itself) => {
    if (!folder) return;
    let dir = forwardSlashes(folder);
    if (dir.charAt(dir.length - 1) === '/') {
        dir = dir.slice(0, -1);
    }

    let err;
    await fs.promises.access(dir).catch(e => err = e);
    if (!err) {
        console.log('Removing directory', { dir });
        await fs.promises.rmdir(dir, { recursive: true }).catch(console.error);
    }

    if (!itself) {
        await fs.promises.mkdir(dir, { recursive: true });
    }
}
export const rmdirSync = (folder, itself) => {
    if (!folder) return;
    let dir = forwardSlashes(folder);
    if (dir.charAt(dir.length - 1) === '/') {
        dir = dir.slice(0, -1);
    }

    try {
        if (fs.existsSync(dir)) {
            fs.rmdirSync(dir, { maxRetries: 10, retryDelay: 200, recursive: true });
        }
    } catch (e) {
        console.error(e);
    }

    if (!itself) {
        try {
            fs.mkdirSync(dir, { recursive: true });
        } catch (e) {
            console.error(e);
        }
    }
}
export const time = dt => {
    if(dt){
        if(typeof(dt) == 'number') {
            return dt
        } else if(typeof(dt) == 'string') {
            return parseInt(dt)
        }
    } else {
        dt = new Date()
    }
    return parseInt(dt.getTime() / 1000)
}
export const kfmt = (num, digits) => {
    var si = [
        { value: 1, symbol: '' },
        { value: 1E3, symbol: 'K' },
        { value: 1E6, symbol: 'M' },
        { value: 1E9, symbol: 'G' },
        { value: 1E12, symbol: 'T' },
        { value: 1E15, symbol: 'P' },
        { value: 1E18, symbol: 'E' }
    ];
    var i, rx = /\.0+$|(\.[0-9]*[1-9])0+$/;
    for (i = si.length - 1; i > 0; i--) {
        if (num >= si[i].value) {
            break;
        }
    }
    return (num / si[i].value).toFixed(digits).replace(rx, "$1") + si[i].symbol;
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

const SYNC_BYTE = 0x47 // define the sync byte value
const PACKET_SIZE = 188 // define the size of each packet

export const isSyncByteValid = (buffer, position) => {
    // check the transport_error_indicator (bit 7 of the second byte)
    const transportErrorIndicator = (buffer[position + 1] & 0x80) === 0 // should be 0 to indicate no transport error
    const pid = ((buffer[position + 1] & 0x1F) << 8) | buffer[position + 2] // extract the PID
    // return true if there's no transport error and the PID is within a valid range
    return transportErrorIndicator && (pid >= 0 && pid <= 8191)
}

export const isPacketized = sample => {
    // check if the sample is a buffer, has sufficient length,
    // and if the sync byte is valid at the start of the buffer
    return Buffer.isBuffer(sample) && sample.length >= PACKET_SIZE && isSyncByteValid(sample, 0)
}

export const findSyncBytePosition = (buffer, from = 0) => {
    const bufferLength = buffer.length // get the length of the buffer
    let position = buffer.indexOf(SYNC_BYTE, from) // find the position of the first sync byte starting from 'from'

    // continue searching while a valid sync byte is not found 
    // and we are within the buffer limits
    while (position !== -1 && position < bufferLength - PACKET_SIZE) {
        if (isSyncByteValid(buffer, position)) {
            return position // return position if the sync byte is valid
        }
        position = buffer.indexOf(SYNC_BYTE, position + 1) // move to the next sync byte
    }    
    return -1  // return -1 if no valid sync byte is found
}
