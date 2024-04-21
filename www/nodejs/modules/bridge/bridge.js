import { EventEmitter } from "events";
import http from "http";
import path from 'path';
import fs from 'fs';
import { prepareCORS } from "../utils/utils.js";
import url from 'url';
import formidable from 'formidable';
import closed from '../on-closed/on-closed.js';
import paths from '../paths/paths.js'

class BaseChannel extends EventEmitter {
    constructor() {
        super();
        this.originalEmit = this.emit;
        this.emit = this.customEmit;
        this.setMaxListeners(20);
    }
    onMessage(args) {
        setTimeout(() => this.originalEmit.apply(this, args), 0); // async to prevent blocking renderer
    }
    prepareSerialization(value) {
        if (Array.isArray(value)) {
            return value.map(item => this.prepareSerialization(item));
        }
        else if (typeof (value) == 'object' && value !== null) {
            const ret = {};
            Object.keys(value).forEach(k => {
                if (typeof (value[k]) != 'function')
                    ret[k] = this.prepareSerialization(value[k]);
            });
            return ret;
        }
        else {
            if (typeof (value) == 'function')
                return null;
            return value;
        }
    }
}
class AndroidChannel extends BaseChannel {
    constructor() {
        super();
        this.attach();
    }
    customEmit(...args) {
        this.attach();
        try {
            this.channel.send('message', ...args);
        }
        catch (err) {
            console.error('CANNOT SEND MESSAGE ' + JSON.stringify(args));
        }
    }
    attach() {
        if (!this.channel && paths.android.channel) {
            this.channel = paths.android.channel;
            this.channel.addListener('message', (...args) => this.onMessage(args));
        }
    }
}
class ElectronChannel extends BaseChannel {
    constructor() {
        super();
    }
    customEmit(...args) {
        this.window && !this.window.closed && this.window.webContents.send('message', this.prepareSerialization(args));
    }
}
class BridgeServer extends EventEmitter {
    constructor(opts) {
        super();
        this.ua = 'Megacubo ' + paths.manifest.version;
        if (!paths.android) {
            this.ua += ' ' + this.secret(8);
        }
        this.map = {};
        this.opts = {
            addr: '127.0.0.1',
            port: 0
        };
        if (opts) {
            Object.keys(opts).forEach((k) => {
                this.opts[k] = opts[k];
            });
        }
        this.closed = false;
        const mimes = {
            '.ico': 'image/x-icon',
            '.html': 'text/html',
            '.js': 'text/javascript',
            '.json': 'application/json',
            '.css': 'text/css',
            '.png': 'image/png',
            '.jpg': 'image/jpeg',
            '.wav': 'audio/wav',
            '.mp3': 'audio/mpeg',
            '.mp4': 'video/mp4',
            '.svg': 'image/svg+xml'
        };
        this.setMaxListeners(20);
        this.server = http.createServer((req, response) => {
            if (!this.checkUA(req.headers)) {
                response.writeHead(400, prepareCORS({ 'content-type': 'text/plain' }, req));
                return response.end();
            }
            const parsedUrl = url.parse(req.url, false);
            prepareCORS(response, req);
            response.setHeader('Connection', 'close');
            response.setHeader('Feature-Policy', 'clipboard-read; clipboard-write; fullscreen; autoplay;');
            if (parsedUrl.pathname == '/upload') {
                const form = formidable({ multiples: true });
                form.parse(req, (err, fields, files) => {
                    response.writeHead(200, prepareCORS({ 'content-type': 'text/plain' }, req));
                    response.end('OK');
                    if (fields && fields.cbid && fields.cbid.length) {
                        this.localEmit(fields.cbid, files);
                    }
                    else {
                        this.localEmit(fields.cbid, null);
                    }
                });
            }
            else {
                let pathname = `.${parsedUrl.pathname}`;
                if (pathname == './') {
                    pathname = './index.html';
                }
                if (typeof (this.map[pathname]) != 'undefined') {
                    pathname = this.map[pathname];
                }
                else {
                    pathname = path.join(paths.cwd, pathname);
                }
                const ext = path.parse(pathname).ext;
                fs.access(pathname, err => {
                    if (err) {
                        response.statusCode = 404;
                        response.end(`File ${pathname} not found!`);
                        return;
                    }
                    response.setHeader('Content-type', mimes[ext] || 'text/plain');
                    response.setHeader('Cache-Control', 'max-age=0, no-cache, no-store');
                    let stream = fs.createReadStream(pathname);
                    closed(req, response, stream, () => {
                        console.log(`${req.method} ${req.url} CLOSED`);
                        if (stream) {
                            stream.destroy();
                            stream = null;
                        }
                        response.end();
                    }, { closeOnError: true });
                    stream.pipe(response);
                });
            }
        });
        this.server.listen(0, this.opts.addr, err => {
            if (err)
                console.error(err);
            if (!this.server)
                return;
            this.opts.port = this.server.address().port;
            console.log('Bridge server started', err);
            this.uploadURL = 'http://' + this.opts.addr + ':' + this.opts.port + '/upload';
        })
    }
    secret(length) {
        const charset = 'abcdefghijklmnopqrstuvwxyz0123456789';
        let result = '';
        for (let i = 0; i < length; i++) {
            const randomIndex = Math.floor(Math.random() * charset.length);
            result += charset.charAt(randomIndex);
        }
        return result;
    }
    checkUA(headers) {
        if (paths.android)
            return true;
        return headers && headers['user-agent'] && headers['user-agent'] == this.ua;
    }
    serve(file) {
        if (fs.existsSync(file)) {
            let ext = file.match(new RegExp('\.[A-Za-z0-9]{0,5}$'));
            let stat = fs.statSync(file);
            if (stat) {
                let path = './' + (stat ? stat.size : file.split('/').pop());
                if (ext) {
                    path += ext[0];
                }
                this.map[path] = file;
                return 'http://' + this.opts.addr + ':' + this.opts.port + '/' + path.substr(2);
            }
        }
    }
    destroy() {
        if (this.opts.debug) {
            console.log('closing...');
        }
        this.closed = true;
        this.removeAllListeners();
    }
}
class BridgeUtils extends BridgeServer {
    constructor(opts) {
        super(opts);
    }
    async resolveFileFromClient(data) {
        const check = async (file) => {
            
            await fs.promises.access(file, fs.constants.R_OK);
            return file;
        };
        console.warn('!!! RESOLVE FILE !!!', data);
        if (data) {
            if (Array.isArray(data) && data.length) {
                return await check(data[0]);
            }
            else if (data.file && data.file.filepath && data.file.filepath) {
                return await check(data.file.filepath);
            }
            else if (data.filename && data.filename.path) {
                return await check(data.filename.path);
            }
            else {
                throw new Error('invalid file data');
            }
        }
        else {
            throw new Error('invalid file data');
        }
    }
    async importFileFromClient(data, target) {
        console.warn('!!! IMPORT FILE !!!' + target + ' | ' + JSON.stringify(data));
        
        const resolveFile = await this.resolveFileFromClient(data).catch(err => {
            console.error('DATA=' + JSON.stringify(data) + ' ' + err);
        });
        if (!resolveFile)
            throw 'Resolve error';
        if (target) {
            await fs.promises.copyFile(resolveFile, target);
            return target;
        }
        else {
            return await fs.promises.readFile(resolveFile);
        }
    }
    setElectronWindow(win) {
        this.channel.window = win;
    }
}
class Bridge extends BridgeUtils {
    constructor(opts) {
        super(opts);
        if (paths.android) {
            this.channel = new AndroidChannel();
        }
        else {
            this.channel = new ElectronChannel();
        }
        this.channel.setMaxListeners && this.channel.setMaxListeners(20);
    }
    on(...args) {
        this.channel.on(...args);
    }
    once(...args) {
        this.channel.once(...args);
    }
    emit(...args) {
        return this.channel.emit(...args);
    }
    listenerCount(type) {
        return this.listeners(type).length;
    }
    listeners(type) {
        return this.channel.listeners(type);
    }
    removeListener(...args) {
        return this.channel.removeListener(...args);
    }
    removeAllListeners(...args) {
        return this.channel.removeAllListeners(...args);
    }
    localEmit(...args) {
        this.channel.originalEmit(...args);
    }
    destroy() {
        if (this.server) {
            this.server.close();
            this.server = null;
        }
        this.removeAllListeners();
    }
}

let instance, callbacks = []
export const get = () => {
    if(!instance) {
        instance = new Bridge()
    }
    return instance
}
export const ready = (f, done) => {
    const isReady = !Array.isArray(callbacks);
    if (typeof (f) == 'function') {
        if (isReady) {
            f();
        }
        else {
            callbacks.push(f);
        }
        return;
    }
    else if (f === true) { // promisify
        return new Promise(resolve => {
            if (isReady) {
                resolve();
            }
            else {
                callbacks.push(resolve);
            }
        });
    }
    if (!isReady && done === true) {
        const cbs = callbacks;
        callbacks = null;
        cbs.map(f => {
            try {
                const p = f();
                if (p && typeof (p.catch) == 'function') {
                    p.catch(console.error);
                }
            }
            catch (e) {
                console.error(e);
            }
        });
    }
    return isReady;
}
export default {get, ready};
