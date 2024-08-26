import { EventEmitter } from "events";
import fs, { read } from "fs";
import pLimit from "p-limit";
import readline from "readline";
import { parseJSON } from '../utils/utils.js'

class ListIndexUtils extends EventEmitter {
    constructor() {
        super();
        this.seriesRegex = new RegExp('(\\b|^)[st]?[0-9]+ ?[epx]{1,2}[0-9]+($|\\b)', 'i');
        this.vodRegex = new RegExp('[\\.=](mp4|mkv|mpeg|mov|m4v|webm|ogv|hevc|divx)($|\\?|&)', 'i');
        this.liveRegex = new RegExp('([0-9]+/[0-9]+|[\\.=](m3u8|ts))($|\\?|&)', 'i');
        this.indexTemplate = {
            groups: {},
            terms: {},
            meta: {}
        };
    }
    sniffStreamType(e) {
        if (e.name && e.name.match(this.seriesRegex)) {
            return 'series';
        } else if (e.url.match(this.vodRegex)) {
            return 'vod';
        } else if (e.url.match(this.liveRegex)) {
            return 'live';
        }
    }
    getRangesFromMap(map) {
        const ranges = [];
        map.forEach(n => ranges.push({ start: this.linesMap[n], end: this.linesMap[n + 1] - 1 }));
        return ranges;
    }
    async readLinesByMap(map) {
        const ranges = this.getRangesFromMap(map);
        const lines = {};
        let fd = null;
        try {
            fd = await fs.promises.open(this.file, 'r');
            const limit = pLimit(4);
            const tasks = ranges.map((r, i) => {
                return async () => {
                    const length = r.end - r.start;
                    const buffer = Buffer.alloc(length);
                    const { bytesRead } = await fd.read(buffer, 0, length, r.start);
                    if (bytesRead < buffer.length) {
                        buffer = buffer.slice(0, bytesRead);
                    }
                    lines[map[i]] = buffer.toString();
                };
            }).map(limit);
            await Promise.allSettled(tasks);
        } catch (error) {
            console.error(error)
        } finally {
            if (fd !== null) {
                try {
                    await fd.close().catch(console.error);
                } catch (error) {
                    console.error("Error closing file descriptor:", error);
                }
            }
        }
        return lines;
    }
    readLines(map) {
        return new Promise((resolve, reject) => {
            if (map) {
                if (!map.length) {
                    return reject('empty map requested');
                }
                map.sort()
                if (Array.isArray(this.linesMap)) {
                    return this.readLinesByMap(map).then(resolve).catch(reject)
                }
            }            
            fs.stat(this.file, (err, stat) => {
                if (err || !stat) {
                    return reject(err || 'stat failed with no error');
                }
                if (stat.size) {
                    let max, i = 0, lines = {}
                    const input = fs.createReadStream(this.file)
                    const rl = readline.createInterface({input, crlfDelay: Infinity})
                    if (map) {
                        max = Math.max(...map)
                    } else {
                        max = -1
                    }
                    rl.on('line', line => {
                        if (this.destroyed) {
                            rl.close()
                            reject('list destroyed');
                        } else {
                            if (!map || map.includes(i)) {
                                if (!line || !line.startsWith('{')) {
                                    if (map || !line.startsWith('[')) {
                                        console.error('Bad line readen', this.file, i, line);
                                    }
                                } else {
                                    lines[i] = line;
                                }
                            }
                            if (max > 0 && i == max) {
                                rl.close()
                            }
                            i++;
                        }
                    });
                    rl.once('close', () => {
                        if (!map) {
                            let last = Object.keys(lines).pop(); // remove index from entries
                            delete lines[last];
                        }
                        resolve(lines)
                        rl.close()
                    });
                } else {
                    return reject('empty file ' + stat.size);
                }
            });
        });
    }
    async readLastLine() {
        const bufferSize = 4096
        const { size } = await fs.promises.stat(this.file)
        const fd = await fs.promises.open(this.file, 'r')
        let buffer, lastReadSize, readPosition = Math.max(size - bufferSize, 0)
        while (readPosition >= 0) {
            const readSize = Math.min(bufferSize, size - readPosition)
            if(readSize !== lastReadSize) {
                lastReadSize = readSize
                buffer && buffer.dispose()
                buffer = Buffer.alloc(readSize)
            }
            const { bytesRead } = await fd.read(buffer, 0, readSize, readPosition)            
            if (bytesRead === 0) break
            const newlineIndex = buffer.lastIndexOf(0x0A) // 0x0A is the ASCII code for '\n'
            if (newlineIndex !== -1) {
                let err
                const start = readPosition + newlineIndex
                const lastLine = Buffer.alloc(size - start)
                const { bytesRead } = await fd.read(lastLine, 0, size - start, start)
                await fd.close().catch(console.error)
                if(err) throw err
                return String(lastLine)
            } else {
                readPosition -= bufferSize
            }
        }
        await fd.close().catch(console.error)
        return ''
    }
    async readIndex() {
        if(!this.linesMap) {
            const line = await this.readLastLine()
            if (!line) throw 'empty file'
            const parsed = parseJSON(line)
            if (!Array.isArray(parsed)) throw 'bad lines map'
            this.linesMap = parsed
        }
        let err
        const fd = await fs.promises.open(this.file, 'r');
        const from = this.linesMap[this.linesMap.length - 2];
        const length = this.linesMap[this.linesMap.length - 1] - from;
        const buffer = Buffer.alloc(length);
        const { bytesRead } = await fd.read(buffer, 0, length, from).catch(e => err = e)
        await fd.close().catch(console.error);
        if(err) throw err
        const index = JSON.parse(String(buffer).substr(0, bytesRead))
        if (index && typeof(index.length) != 'undefined') {
            return index
        } else {
            console.error('Bad index on '+ this.file, index)
            return this.indexTemplate
        }
    }
}
export default ListIndexUtils
