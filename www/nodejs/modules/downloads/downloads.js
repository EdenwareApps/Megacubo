import Download from '../download/download.js'
import { basename, decodeURIComponentSafe, prepareCORS } from "../utils/utils.js";
import osd from '../osd/osd.js'
import lang from "../lang/lang.js";
import { EventEmitter } from 'node:events';
import fs from "fs";
import http from "http";
import url from 'node:url';
import path from 'path';
import parseRange from 'range-parser';
import closed from '../on-closed/on-closed.js';
import renderer from '../bridge/bridge.js'
import paths from '../paths/paths.js'

class Downloads extends EventEmitter {
    constructor() {
        super();
        this.map = {};
        this.server = false;
        this.timer = 0;
        this.served = [];
        const { temp } = paths;
        this.folder = temp;
        if (this.folder.charAt(this.folder.length - 1) != '/') {
            this.folder += '/';
        }
        this.clients = [];
        this.icon = 'fas fa-download';
        this.opts = {
            port: 0,
            addr: '127.0.0.1'
        };
        this.mimes = {
            '.ico': 'image/x-icon',
            '.html': 'text/html',
            '.js': 'text/javascript',
            '.json': 'application/json',
            '.css': 'text/css',
            '.png': 'image/png',
            '.jpg': 'image/jpeg',
            '.wav': 'audio/wav',
            '.mp3': 'audio/mpeg',
            '.svg': 'image/svg+xml',
            '.pdf': 'application/pdf',
            '.doc': 'application/msword',
            '.mp4': 'video/mp4',
            '.ts': 'video/MP2T'
        }
        this.activeDownloads = {}
        renderer.ui.on('download-in-background', this.download.bind(this))
    }
    dialogCallback(ret) {
        if (ret == 'downloads-start') {
            if (this.askingDownloadStart) {
                this.download(this.askingDownloadStart.url, this.askingDownloadStart.name, this.askingDownloadStart.target);
            }
        } else {
            const cancelPrefix = 'downloads-cancel-';
            if (String(ret).startsWith(cancelPrefix)) {
                const uid = ret.substr(cancelPrefix.length);
                Object.keys(this.activeDownloads).some(url => {
                    if (this.activeDownloads[url].uid == uid) {
                        this.activeDownloads[url].cancelled = true;
                        this.activeDownloads[url].destroy();
                        fs.unlink(this.activeDownloads[url].file, () => {});
                        renderer.ui.emit('background-mode-unlock', 'saving-file-' + uid);
                        osd.hide(uid);
                        delete this.activeDownloads[url];
                        global.menu && global.menu.refreshNow();
                        return true;
                    }
                });
            }
        }
        if (this.askingDownloadStart) {
            this.askingDownloadStart = null;
        }
    }
    contentRange(type, size, range) {
        const irange = range || { start: 0, end: size - 1 };
        return type + ' ' + irange.start + '-' + irange.end + '/' + (size || '*');
    }
    prepare() {
        return new Promise((resolve, reject) => {
            if (this.server) {
                return resolve(this.opts.port);
            }            
            this.server = http.createServer((req, res) => {
                const uid = (Date.now() / 1000);
                this.clients.push(uid);
                const parsedUrl = url.parse(req.url);
                let pathname = `.${parsedUrl.pathname}`;
                if (pathname == './') {
                    pathname = './index.html';
                }
                pathname = decodeURIComponentSafe(pathname);
                const ext = path.parse(pathname).ext;
                if (typeof(this.map[pathname]) != 'undefined') {
                    pathname = this.map[pathname];
                } else {
                    pathname = path.join(this.folder, pathname);
                }
                let resHeaders = prepareCORS({
                    'accept-ranges': 'bytes',
                    'content-type': this.mimes[ext] || 'text/plain',
                    'cache-control': 'max-age=0, no-cache, no-store',
                    //'content-disposition': 'attachment; filename="' + name + '"',
                    'connection': 'close'
                }, req);
                if (pathname.match(new RegExp('^https?://'))) {
                    let reqHeaders = {
                        'content-encoding': 'identity'
                    };
                    if (req.headers.range) {
                        reqHeaders['range'] = req.headers.range
                    }
                    const download = new Download({
                        url: pathname,
                        keepalive: false,
                        retries: 5,
                        headers: reqHeaders,
                        followRedirect: true
                    });
                    download.once('response', (status, headers) => {
                        resHeaders = Object.assign(Object.assign({}, headers), resHeaders);
                        resHeaders = download.removeHeaders(headers, [
                            'transfer-encoding',
                            'content-encoding',
                            'keep-alive',
                            'strict-transport-security',
                            'content-security-policy',
                            'x-xss-protection',
                            'cross-origin-resource-policy'
                        ]);
                        if (!resHeaders['content-length'] && download.contentLength > 0) {
                            resHeaders['content-length'] = download.contentLength;
                        }
                        res.writeHead(status <= 0 ? 500 : status, resHeaders);
                    });
                    download.on('error', console.error);
                    download.on('data', chunk => res.write(chunk));
                    download.once('end', () => {
                        res.end();
                    });
                    download.start();
                } else {
                    pathname = fs.realpathSync(path.resolve(paths.cwd, pathname))
                    if (!pathname.startsWith(paths.cwd)) {
                        res.statusCode = 403;
                        res.end();
                        return;
                    }
                    fs.stat(pathname, (err, stat) => {
                        if (err) {
                            res.statusCode = 404;
                            res.end();
                            return;
                        }
                        let status = 200, len = stat.size, start = 0, end = Math.max(0, len - 1);
                        if (req.headers.range) {
                            const ranges = parseRange(len, req.headers.range, { combine: true });
                            if (ranges === -1) {
                                res.writeHead(416, {
                                    'content-length': 0,
                                    'content-range': 'bytes */' + len,
                                    'x-debug': 1
                                });
                                return res.end();
                            }
                            if (Array.isArray(ranges)) {
                                start = ranges[0].start;
                                if (end >= len || end < 0) {
                                    end = ranges[0].end = len - 1;
                                }
                                {
                                    end = ranges[0].end;
                                }
                                status = 206;
                                resHeaders['content-range'] = this.contentRange('bytes', len, ranges[0]);
                                resHeaders['content-length'] = end - start + 1;
                                len = end - start + 1;
                            }
                        }
                        if (start >= stat.size) { // dont use len here, may be altered
                            res.writeHead(416, prepareCORS({
                                'content-length': 0,
                                'content-range': 'bytes */' + len,
                                'x-debug': 2
                            }, req))
                            return res.end()
                        }
                        if (!resHeaders['content-length']) {
                            resHeaders['content-length'] = end - start + 1;
                        }
                        resHeaders['x-debug'] = start + '-' + end + '/' + stat.size;
                        res.writeHead(status, prepareCORS(resHeaders))
                        if (req.method === 'HEAD' || len == 0)
                            return res.end();
                        let stream = fs.createReadStream(pathname, { start, end });
                        let sent = 0;
                        closed(req, res, stream, () => {
                            if (stream) {
                                stream.destroy();
                                stream = null;
                            }
                            let i = this.clients.indexOf(uid);
                            if (i != -1) {
                                this.clients.splice(i, 1);
                            }
                            res.end();
                        });
                        stream.pipe(res);
                        stream.on('data', chunk => sent += chunk.length);
                    });
                }
            }).listen(this.opts.port, this.opts.addr, (err) => {
                if (err) {
                    console.error('unable to listen on port', err);
                    return reject(err);
                }
                this.opts.port = this.server.address().port;
                resolve(this.opts.port);
            });
        });
    }
    import(file) {
        return new Promise((resolve, reject) => {
            const name = path.basename(file);
            const dest = path.join(this.folder, name);
            this.served.push(dest);
            if (file == dest) {
                resolve('http://' + this.opts.addr + ':' + this.opts.port + '/' + encodeURIComponent(name));
            } else {
                fs.copyFile(file, dest, err => {
                    if (err) {
                        reject(err)
                    } else {
                        resolve('http://' + this.opts.addr + ':' + this.opts.port + '/' + encodeURIComponent(name))
                    }
                })
            }
        })
    }
    async serve(file, triggerDownload, doImport, name) {
        await this.prepare();
        if (!name) {
            name = path.basename(file) || String(Math.random()).substr(2)
        }
        let url
        if (doImport) {
            url = await this.import(file)
        } else {
            url = 'http://' + this.opts.addr + ':' + this.opts.port + '/' + encodeURIComponent(name);
            this.map['./' + name] = file
        }
        if (triggerDownload) {
            renderer.ui.emit('download', url, name)
            if(paths.android) {
                osd.show(lang.FILE_SAVED_ON.format('Download', name), 'fas fa-check-circle', 'downloads', 'normal')
            }
        }
        return url
    }
    async serveContent(filename, content) {
        await this.prepare()
        const url = 'http://' + this.opts.addr + ':' + this.opts.port + '/' + encodeURIComponent(filename)
        const file = paths.temp +'/'+ filename
        await fs.promises.writeFile(file, content)
        this.map['./' + filename] = file
        return url
    }
    clear() {
        fs.access(this.folder, error => {
            if (error) {
                fs.mkdir(this.folder, { recursive: true }, () => {});
            } else {
                this.served.forEach(f => fs.unlink(f, () => {}));
                this.served = [];
            }
        });
    }
    async askDownload(url, name, target) {
        if(!global.menu) return
        this.askingDownloadStart = { url, name, target };
        let ret = await global.menu.dialog([
            { template: 'question', text: paths.manifest.window.title, fa: this.icon },
            { template: 'message', text: lang.DOWNLOAD_START_CONFIRM.format(name) + "\r\n\r\n" + lang.DOWNLOAD_START_HINT.format([lang.TOOLS, lang.ACTIVE_DOWNLOADS].join('/')) },
            { template: 'option', text: lang.YES, id: 'downloads-start', fa: 'fas fa-check-circle' },
            { template: 'option', text: lang.NO, id: 'no', fa: 'fas fa-times-circle' }
        ], 'no');
        this.dialogCallback(ret);
    }
    getUniqueFilenameHelper(name, i) {
        let pos = name.lastIndexOf('.');
        if (pos == -1) {
            return name + '-' + i;
        } else {
            return name.substr(0, pos) + '-' + i + name.substr(pos);
        }
    }
    getUniqueFilename(files, name) {
        let i = 0, nname = name;
        while (files.includes(nname)) {
            i++;
            nname = this.getUniqueFilenameHelper(name, i);
        }
        return nname;
    }
    download(url, name, target) {
        target = target.replace('file:///', '/');
        console.log('Download in background', url, name, target);
        if (typeof(this.activeDownloads[url]) != 'undefined') {
            return;
        }
        
        fs.readdir(target, (err, files) => {
            if (Array.isArray(files)) {
                name = this.getUniqueFilename(files, name);
                console.log('UNIQUE FILENAME ' + name + ' IN ' + files.join(','));
            } else {
                console.log('READDIR ERR ' + String(err));
            }
            const uid = 'download-' + name.replace(new RegExp('[^A-Za-z0-9]+', 'g'), '');
            renderer.ui.emit('background-mode-lock', 'saving-file-' + uid);
            osd.show(lang.SAVING_FILE_X.format(name), 'fa-mega busy-x', uid, 'persistent');
            const file = target + '/' + name;
            const writer = fs.createWriteStream(file, { flags: 'w', highWaterMark: Number.MAX_SAFE_INTEGER }), download = new Download({
                url,
                keepalive: false,
                retries: 999,
                headers: {},
                followRedirect: true
            });
            download.uid = uid;
            download.file = file;
            download.filename = name;
            this.activeDownloads[url] = download;
            if (global.menu && global.menu.path == lang.TOOLS) {
                global.menu.refresh()
            }
            download.on('progress', progress => {
                osd.show(lang.SAVING_FILE_X.format(name) + '  ' + parseInt(progress) + '%', 'fa-mega busy-x', uid, 'persistent');
                if (global.menu && global.menu.path.includes(lang.ACTIVE_DOWNLOADS)) {
                    global.menu.refresh()
                }
            });
            download.on('error', console.error);
            download.on('data', chunk => writer.write(chunk));
            download.once('end', () => {
                const finished = () => {
                    writer.destroy();
                    const done = () => {
                        renderer.ui.emit('background-mode-unlock', 'saving-file-' + uid);
                        delete this.activeDownloads[url];
                        if (global.menu && global.menu.path.includes(lang.ACTIVE_DOWNLOADS)) {
                            global.menu.refreshNow()
                        }
                    };
                    if (download.cancelled) {
                        done();
                    } else {
                        osd.show(lang.FILE_SAVED_ON.format(basename(target) || target, name), 'fas fa-check-circle', uid, 'normal');
                        fs.chmod(file, 0o777, err => {
                            console.log('Updated file permissions', err);
                            done();
                        });
                    }
                };
                writer.on('finish', finished);
                writer.on('error', finished);
                writer.end();
            });
            download.start();
        });
    }
    entry() {
        return {
            name: lang.ACTIVE_DOWNLOADS,
            type: 'group',
            fa: this.icon,
            renderer: this.entries.bind(this)
        };
    }
    entries() {
        return new Promise((resolve, reject) => {
            let entries = Object.keys(this.activeDownloads).map(url => {
                const download = this.activeDownloads[url], name = download.filename.split('/').pop();
                return {
                    name,
                    details: lang.SAVING_FILE + ' ' + download.progress + '%',
                    type: 'action',
                    fa: this.icon,
                    action: async () => {
                        if(!global.menu) return
                        let ret = await global.menu.dialog([
                            { template: 'question', text: paths.manifest.window.title, fa: this.icon },
                            { template: 'message', text: lang.DOWNLOAD_CANCEL_CONFIRM.format(name) },
                            { template: 'option', text: lang.YES, id: 'downloads-cancel-' + download.uid, fa: 'fas fa-check-circle' },
                            { template: 'option', text: lang.NO, id: 'no', fa: 'fas fa-times-circle' }
                        ], 'no');
                        this.dialogCallback(ret);
                    }
                };
            });
            resolve(entries);
        });
    }
    async hook(entries, path) {
        if (path == lang.TOOLS && !entries.some(e => e.name == lang.ACTIVE_DOWNLOADS) && Object.keys(this.activeDownloads).length) {
            entries.push(this.entry())
        }
        return entries
    }
}
export default new Downloads()
