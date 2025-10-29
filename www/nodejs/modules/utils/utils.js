import sanitizeFilename from 'sanitize-filename'
import np from '../network-ip/network-ip.js'
import os from 'os'
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
import rangeParser from 'range-parser';

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

if (!global.Promise.any) {
    global.Promise.any = function (iterable) {
        if (!iterable || typeof iterable[Symbol.iterator] !== 'function') {
            return Promise.reject(new TypeError('Invalid iterable'));
        }
        return new Promise((resolve, reject) => {
            const promises = Array.from(iterable);
            const errors = [];
            let rejectedCount = 0;

            if (promises.length === 0) {
                return reject(new Error('All promises were rejected'));
            }

            promises.forEach((p, index) => {
                Promise.resolve(p)
                    .then(resolve)
                    .catch((error) => {
                        errors[index] = error;
                        rejectedCount++;
                        if (rejectedCount === promises.length) {
                            reject(new Error('All promises were rejected'));
                        }
                    });
            });
        });
    };
}

const uncaughtExceptionsDebug = false

if (uncaughtExceptionsDebug) {
    const OldPromise = global.Promise; 
    global.Promise = class Promise extends OldPromise {
        constructor(executor) {
            super(executor);
            this.$stack = traceback();
        }
    };
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

const DEFAULT_ACCESS_CONTROL_ALLOW_HEADERS = 'Origin, X-Requested-With, Content-Type, Cache-Control, Accept, Content-Range, Range, Vary, range, Authorization, User-Agent, Referer, Accept-Language, Accept-Encoding, Sec-Fetch-Dest, Sec-Fetch-Mode, Sec-Fetch-Site, Sec-Ch-Ua, Sec-Ch-Ua-Mobile, Sec-Ch-Ua-Platform, DNT, Connection, Upgrade-Insecure-Requests'
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
export const forwardSlashes = path => {
    if (path && path.includes('\\')) {
        return path.replaceAll('\\', '/').replaceAll('//', '/');
    }
    return path;
}
export const isUnderRootAsync = async (relPath, root) => {
    try {
        const resolvedPath = path.resolve(root, relPath);
        const normalizedPath = await fs.promises.realpath(resolvedPath);
        return forwardSlashes(normalizedPath).startsWith(forwardSlashes(root));
    } catch (error) {
        // If realpath fails (e.g., file doesn't exist), just check if the resolved path starts with root
        const resolvedPath = path.resolve(root, relPath);
        return forwardSlashes(resolvedPath).startsWith(forwardSlashes(root));
    }
}
export const getDomain = (u, includePort) => {
    if (!u || typeof u !== 'string') {
        return '';
    }
    
    let d = u;
    if (u.includes('//')) {
        d = u.split('//')[1].split('/')[0]
    }
    if (d && d.includes('@')) {
        d = d.split('@')[1]
    }
    if (d && d.includes(':') && !includePort) {
        d = d.split(':')[0]
    }
    return d || '';
}
export const isLocal = file => {
    if (typeof(file) != 'string') {
        return false
    }
    let m = file.match(new RegExp('^([a-z]{1,6}):', 'i'));
    if (m && m.length && (m[1].length == 1 || m[1].toLowerCase() == 'file')) { // drive letter or file protocol
        return true
    } else {
        if (file.length >= 2 && file.startsWith('/') && file.charAt(1) != '/') { // unix path
            return true
        }
    }
    return false
}
export const isYT = (url) => {
    if (url.includes('youtu')) {
        const d = getDomain(url)
        if (d == 'youtube.com' || d == 'youtu.be' || d.endsWith('.youtube.com')) {
            return true
        }
    }
    return false
}
export const basename = (str, removeQueryString = false) => {
    str = String(str);
    
    // Normalize path separators first
    str = forwardSlashes(str)
    
    // Only treat ? as query string if it's at the very end of the path (not in the middle)
    let qs = ''
    const lastSlash = str.lastIndexOf('/')
    const pathAfterLastSlash = lastSlash !== -1 ? str.slice(lastSlash + 1) : str
    const qPos = pathAfterLastSlash.indexOf('?')
    
    if (qPos !== -1) {
        const afterQ = pathAfterLastSlash.slice(qPos + 1)
        // Only treat as query string if there's content after ? and it looks like a query
        if (afterQ && (afterQ.includes('=') || afterQ.includes('&'))) {
            qs = afterQ
            const pathWithoutQuery = lastSlash !== -1 ? 
                str.slice(0, lastSlash + 1) + pathAfterLastSlash.slice(0, qPos) :
                pathAfterLastSlash.slice(0, qPos)
            str = pathWithoutQuery
        }
    }
    
    // Get the last part of the path (after the last slash)
    const pos = str.lastIndexOf('/')
    if (pos != -1) {
        str = str.substring(pos + 1)
    }
    
    // Add back query string if requested
    if (!removeQueryString && qs) {
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

const allowedProtocols = new Set(['http:', 'https:', 'ftp:', 'rtmp:', 'rtmps:', 'rtmpt:', 'rtmpts:', 'rtmpe:', 'rtmpte:', 'rtmp://', 'rtmps://', 'rtmpt://', 'rtmpts://', 'rtmpe://', 'rtmpte://', 'rtp://', 'udp://', 'rtsp:', 'rtsps:', 'rtsp://', 'rtsps://', 'mms:', 'mmsh:', 'mmst:', 'mmsh://', 'mmst://', 'mega://', 'srt://', 'srtp://', 'tls://', 'tcp://'])
export const validateURL = url => {
    if (!url || url.length < 2) return false;
    try {
        const formattedUrl = url.startsWith('//') ? 'http:' + url : url;
        const parsedUrl = new URL(formattedUrl);
        return allowedProtocols.has(parsedUrl.protocol);
    } catch (err) {
        return false;
    }
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
export const decodeUnicodeEscapes = (str) => {
    if (typeof str !== 'string') return str;
    
    // Decode Unicode escape sequences like u00e3 -> ã, u00c1 -> Á
    return str.replace(/u([0-9a-fA-F]{4})/g, (match, hex) => {
        try {
            return String.fromCharCode(parseInt(hex, 16));
        } catch (e) {
            return match; // Return original if conversion fails
        }
    });
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
            const requestOrigin = url.split('/').slice(0, 3).join('/');
            // Always allow localhost/127.0.0.1 origins
            if (requestOrigin.includes('127.0.0.1') || requestOrigin.includes('localhost')) {
                origin = '*';
            } else {
                origin = requestOrigin;
            }
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
export const listNameFromURL = (url) => {
    if (!url) {
        return 'Untitled ' + parseInt(Math.random() * 9999);
    }

    // Input length validation to mitigate performance issues
    if (url.length > 1000) {
        console.error('URL too long, returning default name');
        return 'Untitled ' + parseInt(Math.random() * 9999);
    }

    let name, subName;
    let parsedUrl;
    try {
        parsedUrl = new URL(url.startsWith('//') ? `http:${url}` : url);
        if (parsedUrl.search) {
            const params = parsedUrl.searchParams;
            ['name', 'dn', 'title'].forEach(key => {
                const value = params.get(key);
                if (value && (!name || value.length > name.length)) {
                    name = value;
                }
            });
            ['user', 'username'].forEach(key => {
                const value = params.get(key);
                if (value && !subName) {
                    subName = value;
                }
            });
        }
        if (!name && parsedUrl.username) {
            const username = parsedUrl.username;
            const hostname = parsedUrl.hostname;
            if (username && hostname) {
                name = `${username} ${hostname}`;
            }
        }
    } catch (err) {
        console.error('Error parsing URL:', err);
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
        url = String(url).replace(/^[a-z]*:\/\//i, '').split('/').filter((s) => s.length);
        if (!url.length) {
            return 'Untitled ' + parseInt(Math.random() * 9999);
        } else if (url.length === 1) {
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
export const formatThousands = (strOrNumber, locale = null) => {
    // format string or number thousands to locale-formatted string
    // Supports multi-language formatting based on locale
    
    // Get current locale from global lang if not provided
    if (!locale && typeof global !== 'undefined' && global.lang?.locale) {
        locale = global.lang.locale;
    }
    
    // Default locale fallbacks
    const defaultLocale = locale || 'en';
    
    if (typeof strOrNumber === 'string') {
        strOrNumber = parseInt(strOrNumber.replace(/[^0-9]/g, ''));
    }
    
    if (typeof strOrNumber === 'number') {
        // Format number according to locale conventions
        try {
            return strOrNumber.toLocaleString(defaultLocale, {
                minimumFractionDigits: 0,
                maximumFractionDigits: 0
            });
        } catch (e) {
            // Fallback to default formatting if locale is not supported
            return strOrNumber.toLocaleString('en', {
                minimumFractionDigits: 0,
                maximumFractionDigits: 0
            });
        }
    }
    
    return strOrNumber;
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
        await fs.promises.rmdir(dir, { recursive: true }).catch(err => console.error(err));
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
            // Use fs.rm instead of deprecated fs.rmdir
            if (fs.rmSync) {
                fs.rmSync(dir, { maxRetries: 10, retryDelay: 200, recursive: true, force: true });
            } else {
                // Fallback for older Node.js versions
                fs.rmdirSync(dir, { maxRetries: 10, retryDelay: 200, recursive: true });
            }
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
        try {
            const piece = 'is not a function'
            if (!ex.stack || typeof ex.stack !== 'string') {
                return 'No stack trace available'
            }
            const parts = ex.stack.split(piece)
            if (!parts || parts.length < 2) {
                return ex.stack || 'No stack trace available'
            }
            return parts.slice(1).join(piece).trim()
        } catch (stackError) {
            return 'Stack trace processing failed'
        }
    }
}

export const parseRange = (range, length) => {
    const maxInt = Number.MAX_SAFE_INTEGER;
    const ranges = rangeParser(typeof(length) == 'number' ? length : maxInt, range.replace('bytes ', 'bytes='));
    if (Array.isArray(ranges)) { // TODO: enable multi-ranging support
        let requestingRange = ranges[0];
        if (typeof(requestingRange.end) != 'number') { // remove dummy value
            delete requestingRange.end;
        } else if (requestingRange.end >= (maxInt - 1)) { // remove dummy value
            delete requestingRange.end;
        }
        return requestingRange;
    }
}

const SYNC_BYTE = 0x47
const PACKET_SIZE = 188

export const isSyncByteValid = (buffer, position, strict = false) => {
    
    if (position + 2 >= buffer.length) return false

    const char = pos => typeof(buffer.get) == 'function' ? buffer.get(pos) : buffer[pos]
    if (char(position) !== SYNC_BYTE) return false
    
    if (strict) {
        // transport_error_indicator verification
        const transportError = (char(position + 1) & 0x80) !== 0
        if (transportError) return false
        
        // pid validation with safe bitwise operations
        const pid = ((char(position + 1) & 0x1F) << 8) | char(position + 2)
        return pid >= 0x0000 && pid <= 0x1FFF // 13 bits (0-8191)
    }
    return true
}

export const isPacketized = (buffer) => {
    if (!Buffer.isBuffer(buffer) || buffer.length < PACKET_SIZE) return false
    
    // calculate packets for verification
    let errors = 0, pointer = 0, foundPackets = 0
    const maxPacketsToCheck = 10
    const errorTolerance = Math.ceil(maxPacketsToCheck / 4)
    const totalPackets = Math.floor(buffer.length / PACKET_SIZE)
    
    // intelligent packet verification
    while (pointer <= buffer.length) {
        // two-step verification for optimization
        if (isSyncByteValid(buffer, pointer, true)) {
            pointer += PACKET_SIZE
            foundPackets++
        } else {
            const newPointer = findSyncBytePosition(buffer, pointer)
            if(newPointer === 0) {
                foundPackets++
                pointer = PACKET_SIZE
            } else if ((newPointer - pointer) > PACKET_SIZE) {
                return false
            } else {
                pointer = newPointer
            }
        }
    }
    
   return foundPackets >= Math.max(1, totalPackets - errorTolerance)
}

export const findSyncBytePosition = (buffer, from = 0) => {
    const bufferLength = buffer.length // get the length of the buffer
    let position = buffer.indexOf(SYNC_BYTE, from) // find the position of the first sync byte starting from 'from'

    // continue searching while a valid sync byte is not found 
    // and we are within the buffer limits
    while (position !== -1 && position < bufferLength - PACKET_SIZE) {
        if (isSyncByteValid(buffer, position, false)) {
            return position // return position if the sync byte is valid
        }
        position = buffer.indexOf(SYNC_BYTE, position + 1) // move to the next sync byte
    }    
    return -1  // return -1 if no valid sync byte is found
}
