import { kbfmt } from '../utils/utils.js'
import menu from '../menu/menu.js'
import lang from "../lang/lang.js";
import { EventEmitter } from 'events';
import fs from "fs";
import downloads from "../downloads/downloads.js";
import config from "../config/config.js"
import renderer from '../bridge/bridge.js'
import paths from '../paths/paths.js'

let FFmpegControllerUIDIterator = 1;
class FFmpegController extends EventEmitter {
    constructor(input, master) {
        super();
        this.master = master;
        this.input = input;
        this.outputVideoCodec = 'copy';
        this.outputAudioCodec = 'copy';
        this.options = {
            input: [],
            output: []
        };
        this.uid = FFmpegControllerUIDIterator;
        FFmpegControllerUIDIterator++;
    }
    cmdArr() {
        let cmd = [];
        this.options.input.forEach(a => cmd.push(...a));
        if (this.input) {
            // add these input options only if we have an input, not in -version, per example
            // set probesize/analyzeduration too high will make ffmpeg startup too slow
            // TODO: allow to customize probesize and analyzeduration
            const defaults = [
                ['-y'],
                ['-loglevel', 'info'],
                ['-analyzeduration', 10000000],
                ['-probesize', 10000000],
                ['-err_detect', 'ignore_err'],
                ['-i', this.input]
            ];
            defaults.forEach(c => {
                cmd.includes(c[0]) || cmd.push(...c);
            });
            if (this.input.startsWith('https')) {
                cmd.push(...['-tls_verify', 0]);
            }
        }
        this.options.output.forEach(a => cmd.push(...a));
        if (this.dest) {
            const defaults = [
                ['-preset', 'ultrafast'],
                ['-map', '0:a?', '-map', '0:v?'],
                ['-sn'],
                ['-shortest'],
                ['-avoid_negative_ts', 'make_zero'],
                ['-strict', '-2'],
                ['-max_muxing_queue_size', 4096] // https://stackoverflow.com/questions/49686244/ffmpeg-too-many-packets-buffered-for-output-stream-01	
            ];
            defaults.forEach(f => cmd.includes(f[0]) || cmd.push(...f));
            if (this.outputVideoCodec.endsWith('264')) {
                // libx264, h264 - make HTML5 compatible
                const vdefaults = [
                    ['-movflags', '+faststart'],
                    ['-profile:v', 'baseline'],
                    ['-preset:v', 'ultrafast'],
                    ['-pix_fmt', 'yuv420p'],
                    ['-level:v', '3.0'],
                    // we are encoding for watching, so avoid to waste too much time+cpu with encoding, at cost of bigger disk space usage
                    ['-crf', config.get('ffmpeg-crf')]
                ];
                const resolutionLimit = config.get('transcoding-resolution');
                switch (resolutionLimit) {
                    case '480p':
                        vdefaults.push(['-vf', 'scale=\'min(852,iw)\':min\'(480,ih)\':force_original_aspect_ratio=decrease']);
                        break;
                    case '720p':
                        vdefaults.push(['-vf', 'scale=\'min(1280,iw)\':min\'(720,ih)\':force_original_aspect_ratio=decrease']);
                        break;
                    case '1080p':
                        vdefaults.push(['-vf', 'scale=\'min(1920,iw)\':min\'(1080,ih)\':force_original_aspect_ratio=decrease']);
                        break;
                }
                vdefaults.forEach(f => cmd.includes(f[0]) || cmd.push(...f));
            }
            if (this.outputAudioCodec == 'aac') {
                const adefaults = [
                    ['-preset:a', 'ultrafast'],
                    ['-profile:a', 'aac_low'],
                    ['-preset:a', 'ultrafast'],
                    ['-b:a', '128k'],
                    ['-ac', 2],
                    ['-ar', 48000],
                    ['-af', 'aresample=async=1:min_hard_comp=0.100000:first_pts=0'],
                    ['-bsf:a', 'aac_adtstoasc'] // The aac_ adtstoasc switch may not be necessary with more recent versions of FFmpeg, which may insert the switch automatically. https://streaminglearningcenter.com/blogs/discover-six-ffmpeg-commands-you-cant-live-without.html
                ];
                adefaults.forEach(f => cmd.includes(f[0]) || cmd.push(...f));
            }
            cmd.push(...[
                this.dest.replace(new RegExp('\\\\', 'g'), '/')
            ]);
        }
        return cmd;
    }
    adjustOptions(k, v) {
        if (Array.isArray(k)) {
            return k;
        }
        if (typeof (v) == 'number') {
            v = String(v);
        }
        if (typeof (v) != 'string') {
            if (typeof (k) != 'string') {
                console.error('BADTYPE: ' + typeof (k) + ' ' + k);
            }
            return k.split(' ');
        }
        return [k, v];
    }
    inputOptions(k, v) {
        this.options.input.push(this.adjustOptions(k, v));
        return this;
    }
    outputOptions(k, v) {
        this.options.output.push(this.adjustOptions(k, v));
        return this;
    }
    format(fmt) {
        this.outputOptions('-f', fmt);
        return this;
    }
    audioCodec(codec) {
        this.outputAudioCodec = codec;
        this.outputOptions('-c:a', this.outputAudioCodec);
        return this;
    }
    videoCodec(codec) {
        this.outputVideoCodec = codec;
        this.outputOptions('-c:v', this.outputVideoCodec);
        return this;
    }
    output(dest) {
        this.dest = dest;
        return this;
    }
    run() {
        let cmdArr = this.cmdArr();
        renderer.get().on('ffmpeg-callback-' + this.uid, this.callback.bind(this));
        renderer.get().on('ffmpeg-metadata-' + this.uid, this.metadataCallback.bind(this));
        renderer.get().emit('ffmpeg-exec', this.uid, cmdArr);
        this.emit('start', cmdArr.join(' '));
    }
    abort() {
        renderer.get().emit('ffmpeg-abort', this.uid);
        this.options.input = this.options.output = [];
        renderer.get().removeAllListeners('ffmpeg-callback-' + this.uid);
        renderer.get().removeAllListeners('ffmpeg-metadata-' + this.uid);
        this.emit('abort');
    }
    metadataCallback(nfo) {
        let codecs = this.master.codecs(nfo), dimensions = this.master.dimensions(nfo), bitrate = this.master.rawBitrate(nfo);
        //console.log('ffmpeg.metadata', nfo, codecs)
        //if(bitrate) this.emit('bitrate', bitrate)
        if (codecs)
            this.emit('codecData', codecs);
        if (dimensions)
            this.emit('dimensions', dimensions);
    }
    callback(err, output) {
        //console.log('ffmpeg.callback '+ this.uid +"\n::ERR:: "+ err +"\n::OUTPUT:: "+ output)
        if (err) {
            this.emit('error', err);
        }
        else {
            this.emit('end', output);
        }
    }
}
class FFMPEGHelper extends EventEmitter {
    constructor() {
        super();
        this.debug = false;
    }
    clockToSeconds(str) {
        let cs = str.split('.'), p = cs[0].split(':'), s = 0, m = 1;
        while (p.length > 0) {
            s += m * parseInt(p.pop(), 10);
            m *= 60;
        }
        if (cs.length > 1 && cs[1].length >= 2) {
            s += parseInt(cs[1].substr(0, 2)) / 100;
        }
        return s;
    }
    parseBytes(t, b) {
        let n = parseFloat(t);
        switch (b) {
            case "kb":
            case "kbit":
            case "kbits":
                n = n * 1024;
                break;
            case "mb":
            case "mbit":
            case "mbits":
                n = n * (1024 * 1024);
                break;
            case "gb":
            case "gbit":
            case "gbits":
                n = n * (1024 * 1024 * 1024);
                break;
        }
        return parseInt(n);
    }
    fmtSlashes(file) {
        return file.replace(new RegExp("[\\\\/]+", "g"), "/");
    }
}
class FFMPEGMediaInfo extends FFMPEGHelper {
    constructor() {
        super();
    }
    duration(nfo) {
        let dat = nfo.match(new RegExp(': +([0-9]{2}:[0-9]{2}:[0-9]{2})\\.[0-9]{2}'));
        return dat ? this.clockToSeconds(dat[1]) : 0;
    }
    codecs(nfo, raw) {
        let rp = raw === true ? ': ([^\r\n]+)' : ': ([^,\r\n]+)';
        let video = nfo.match(new RegExp('Video' + rp)), audio = nfo.match(new RegExp('Audio' + rp)), unknown = nfo.match(new RegExp('Unknown' + rp));
        video = Array.isArray(video) ? video[1] : (Array.isArray(unknown) ? 'unknown' : '');
        audio = Array.isArray(audio) ? audio[1] : '';
        return { video, audio };
    }
    dimensions(nfo) {
        let match = nfo.match(new RegExp('[0-9]{2,5}x[0-9]{2,5}'));
        return match && match.length ? match[0] : '';
    }
    rawBitrate(nfo) {
        // bitrate: 1108 kb/s
        let bitrate = 0, lines = nfo.match(new RegExp("Stream #[^\n]+", "g"));
        if (lines) {
            lines.forEach(line => {
                let raw = line.match(new RegExp('([0-9\\.]+) ([a-z]+)/s'));
                if (raw) {
                    bitrate += this.parseBytes(raw[1], raw[2]);
                }
            });
        }
        let matches = nfo.matchAll(new RegExp('itrate(: |=)([0-9\\.]+) ?([a-z]+)/s', 'g'));
        for (let raw of matches) {
            let n = this.parseBytes(raw[2], raw[3]);
            if (!bitrate || n > bitrate) {
                bitrate = n;
            }
        }
        return bitrate ? bitrate : false;
    }
    getFileDuration(file, cb) {
        let next = () => {
            this.info(file, true, nfo => {
                if (nfo) {
                    // console.log('mediainfo', nfo)
                    let duration = this.duration(nfo.output + ' ' + nfo.error);
                    if (isNaN(duration)) {
                        console.error('duration() failure', nfo, duration);
                        cb('duration check failure', 0);
                    }
                    else {
                        cb(null, duration);
                    }
                }
                else {
                    cb('FFmpeg unable to process ' + file + ' ' + JSON.stringify(nfo), 0);
                }
            });
        };
        fs.access(file, err => {
            if (err) {
                cb('File not found or empty.', 0);
            }
            else {
                next();
            }
        });
    }
    bitrate(file, cb, length) {
        let next = () => {
            this.info(file, false, nfo => {
                if (nfo) {
                    const output = nfo.output + ' ' + nfo.error;
                    let codecs = this.codecs(output), rate = this.rawBitrate(output), dimensions = this.dimensions(output);
                    // console.log('NFO BITRATE', codecs, rate, dimensions, Buffer.from(nfo))
                    if (nfo.size) {
                        length = nfo.size;
                    }
                    if (length) {
                        let duration = nfo.duration || this.duration(output);
                        const nrate = parseInt(length / duration);
                        if (!rate || nrate > rate) {
                            rate = nrate;
                        }
                    }
                    if (isNaN(rate)) {
                        console.error('bitrate() failure', nfo, kbfmt(length));
                        cb('bitrate check failure', null, codecs, dimensions);
                    }
                    else {
                        cb(null, rate, codecs, dimensions);
                    }
                }
                else {
                    cb('FFmpeg unable to process ' + file + ' ' + JSON.stringify(nfo), 0);
                }
            });
        };
        if (length || !this.isLocal(file)) {
            next();
        }
        else {
            
            fs.stat(file, (err, stat) => {
                if (err) {
                    cb('File not found or empty.', 0, false);
                }
                else {
                    length = stat.size;
                    next();
                }
            });
        }
    }
    isLocal(file) {
        if (typeof (file) != 'string') {
            return;
        }
        let m = file.match(new RegExp('^([a-z]{1,6}):', 'i'));
        if (m && m.length && (m[1].length == 1 || m[1].toLowerCase() == 'file')) { // drive letter or file protocol
            return true;
        }
        else {
            if (file.length >= 2 && file.startsWith('/') && file.charAt(1) != '/') { // unix path
                return true;
            }
        }
    }
    ext(file) {
        const ext = String(file).split('?')[0].split('#')[0].split('.').pop().toLowerCase();
        return ext.length >= 2 && ext.length <= 4 ? ext : null;
    }
    info(path, durationWanted, cb) {
        if (path.indexOf('://') == -1) {
            this.exec(path, [], (error, output) => {
                
                fs.stat(path, (err, stat) => {
                    cb({ error, output, size: stat ? stat.size : null });
                });
            });
        }
        else {
            const seconds = 4; // should be less than 10
            const ext = this.ext(path) || 'ts';
            const { temp } = paths;
            const tempFile = temp + '/' + Math.random() + '.' + ext;
            if (path.toLowerCase().indexOf('.m3u8') != -1)
                path = 'hls+' + path;
            const inputOptions = [
                '-timeout', 30000,
                '-rw_timeout', 30000
            ];
            const outputOptions = [,
                '-max_muxing_queue_size', 9999
                // '-c', 'copy' // omit -c and -f to ensure a bitrate output
            ];
            if (!durationWanted) {
                inputOptions.unshift(...[
                    '-ss', '00:00:00',
                    '-to', '00:00:30' //+ seconds
                ]);
            }
            this.exec(path, [...outputOptions, tempFile], (error, output) => {
                
                fs.stat(tempFile, (err, stat) => {
                    cb({ error, output, size: stat ? stat.size : null, duration: seconds });
                    err || fs.unlink(tempFile, () => { });
                });
            }, inputOptions);
        }
    }
}
class FFMPEGDiagnostic extends FFMPEGMediaInfo {
    constructor() {
        super();
    }
    encodeHTMLEntities(str) {
        return str.replace(/[\u00A0-\u9999<>&](?!#)/gim, (i) => {
            return '&#' + i.charCodeAt(0) + ';';
        });
    }
    saveLog() {
        let text = '';
        this.diagnostic().then(txt => {
            text = txt;
        }).catch(err => {
            text = String(err);
        }).finally(() => {
            
            const filename = 'megacubo-ffmpeg-log.txt', file = downloads.folder + '/' + filename;
            fs.writeFile(file, text, { encoding: 'utf-8' }, err => {
                if (err)
                    return menu.displayErr(err);
                downloads.serve(file, true, false).catch(e => menu.displayErr(e));
            });
        });
    }
    diagnosticDialog() {
        let fa, text;
        this.diagnostic().then(txt => {
            fa = 'fas fa-info-circle';
            text = txt;
        }).catch(err => {
            fa = 'fas fa-exclamation-triangle faclr-red';
            text = String(err);
        }).finally(async () => {
            let ret = await menu.dialog([
                { template: 'question', text: lang.ABOUT + ': FFmpeg', fa },
                { template: 'message', text: this.encodeHTMLEntities(text) },
                { template: 'option', text: 'OK', id: 'ok', fa: 'fas fa-check-circle' },
                { template: 'option', text: lang.SAVE, id: 'savelog', fa: 'fas fa-save' }
            ], 'ok');
            if (ret == 'savelog') {
                this.saveLog();
            }
        });
    }
    diagnostic() {
        return new Promise((resolve, reject) => {
            if (this.log) {
                return resolve(this.log);
            }
            this.arch(arch => {
                this.version((data, output) => {
                    const nl = "\r\n";
                    this.log = (data || lang.FFMPEG_NOT_FOUND) + nl;
                    this.log += 'Arch: ' + arch + nl;
                    let finish = () => {
                        resolve(this.log);
                    };
                    finish();
                });
            });
        });
    }
    _arch() {
        if (process.platform == 'win32') {
            return 'win' + (process.arch == 'x64' ? 64 : 32);
        }
        else {
            switch (process.arch) {
                case 'arm64':
                    return 'arm64-v8a';
                    break;
                case 'arm':
                    return 'armeabi-v7a';
                    break;
                case 'x64':
                    return 'x86_64';
                    break;
                case 'ia32':
                case 'x32':
                default:
                    return 'x86';
            }
        }
    }
    arch(cb) {
        if (process.platform == 'android') {
            
            let archHintFile = paths.cwd + '/arch.dat';
            fs.stat(archHintFile, (err, stat) => {
                if (stat && stat.size) {
                    fs.readFile(archHintFile, (err, ret) => {
                        if (ret) {
                            cb(String(ret).trim());
                        }
                        else {
                            cb(this._arch());
                        }
                    });
                }
                else {
                    cb(this._arch());
                }
            });
        }
        else {
            cb(this._arch());
        }
    }
}
class FFMPEG extends FFMPEGDiagnostic {
    constructor() {
        super();
        if (!paths.android) {
            renderer.get().on('ffmpeg-download', state => {
                this.downloading = state;
                state || this.emit('downloaded');
            });
            renderer.ready(() => {
                const { data } = paths;
                renderer.get().emit('ffmpeg-check', lang.INSTALLING_FFMPEG, data);
            });
        }
    }
    ready() {
        return new Promise(resolve => {
            this.downloading ? this.once('downloaded', resolve) : resolve();
        });
    }
    create(input, opts) {
        const proc = new FFmpegController(input, this);
        if (opts) {
            if (opts.live) {
                // proc.inputOptions('-re') // it will make hls startup slower
            }
        }
        return proc;
    }
    exec(input, cmd, cb, inputOptions) {
        const proc = this.create(input, { live: false }), timeout = setTimeout(() => {
            proc && proc.abort();
            if (typeof (cb) == 'function') {
                cb('timeout', '');
                cb = null;
            }
        }, 30000);
        proc.outputOptions(cmd);
        if (inputOptions) {
            proc.inputOptions(inputOptions);
        }
        proc.once('end', data => {
            clearTimeout(timeout);
            if (typeof (cb) == 'function') {
                cb(null, data);
                cb = null;
            }
        });
        proc.on('error', err => {
            clearTimeout(timeout);
            if (typeof (cb) == 'function') {
                cb(err);
                cb = null;
            }
        });
        proc.run();
    }
    version(cb) {
        this.exec('', ['-version'], (error, output) => {
            let data = String(error || output);
            let m = data.match(new RegExp('ffmpeg version ([^ ]*)'));
            if (m && m.length > 1) {
                cb(m[1], data);
            }
            else {
                cb(false, data);
            }
        });
    }
}
export default new FFMPEG()
