import { kbfmt } from '../../utils/utils.js'
import { EventEmitter } from "events";
import MultiBuffer from "./multibuffer.js";
import config from "../../config/config.js"

const SYNC_BYTE = 0x47;
const PACKET_SIZE = 188;
const ADAPTATION_POSITION = 6;
class MPEGTSProcessor extends EventEmitter {
    constructor() {
        super();
        this.debug = false;
        this.maxPcrMemoSize = 1536; // max pcrs memory to prevent repetitions on reconnect
        /*
        -1 = uninitialized
        0 = new conn, buffer up
        1 = passing through (startup default)
        2 = passing through permanently, not used
        */
        this.direction = 1;
        this.packetBuffer = new MultiBuffer();
        this.packetFilterPolicy = config.get('mpegts-packet-filter-policy');
        this.pcrMemoNudgeSize = parseInt(this.maxPcrMemoSize / 10);
        this.pcrMemoSize = 0;
        this.pcrMemo = new Map();
    }
    checkSyncByte(pos) {
        return pos >= 0 && pos < this.packetBuffer.length && this.packetBuffer.get(pos) == SYNC_BYTE;
    }
    nextSyncByte(offset = 0) {
        while (offset < (this.packetBuffer.length - 4)) {
            const pos = this.packetBuffer.indexOf(SYNC_BYTE, offset);
            if (pos == -1) {
                return -1;
            }
            else if (this.checkSyncByte(pos)) {
                return pos;
            }
            else { // not a valid sync byte
                offset = pos + 1;
            }
        }
        return -1;
    }
    packetize() {
        let currentPCR, initialPos = 0;
        let pointer = this.checkSyncByte(0) ? 0 : this.nextSyncByte();
        let positions = {}, outputBounds = { start: -1, end: -1 }, errorCount = 0, iterationsCounter = 0;
        if (pointer == -1) {
            if (this.debug) {
                console.log('no next sync byte after ' + pointer + ' bytes');
            }
            return;
        }
        else if (pointer) {
            if (this.debug) {
                console.log('skipping first ' + pointer + ' bytes');
            }
            initialPos = pointer;
        }
        while (pointer >= 0 && (pointer + PACKET_SIZE) <= this.packetBuffer.length) {
            if (this.debug) {
                iterationsCounter++;
            }
            let offset = -1;
            if ((pointer + PACKET_SIZE) < this.packetBuffer.length) { // has a next packet start
                if (!this.checkSyncByte(pointer + PACKET_SIZE)) {
                    offset = this.packetBuffer.indexOf(SYNC_BYTE, pointer + PACKET_SIZE);
                }
            }
            let size = offset == -1 ? PACKET_SIZE : (offset - pointer);
            if (size == PACKET_SIZE) {
                errorCount = 0;
            }
            else {
                errorCount++;
                if (errorCount > 10) { // seems not mpegts, discard all
                    this.direction = 0;
                    this.packetBuffer.clear();
                    return;
                }
                switch (this.packetFilterPolicy) {
                    case 1:
                        if (size < PACKET_SIZE) {
                            console.log('bad packet size: ' + size + ', removing it');
                            this.packetBuffer.remove(pointer, pointer + size);
                            size = 0;
                        }
                        else {
                            console.log('bad packet size: ' + size + ', trimming it');
                            this.packetBuffer.remove(pointer + PACKET_SIZE, pointer + size);
                            size = PACKET_SIZE;
                        }
                        break;
                    case 2:
                        console.log('bad packet size: ' + size + ', removing it');
                        this.packetBuffer.remove(pointer, pointer + size);
                        size = 0;
                        break;
                    default:
                        console.log('bad packet size: ' + size + ', passthrough');
                }
            }
            if (!size)
                continue;
            const pcr = this.pcr(pointer);
            if (pcr) {
                if (!currentPCR && this.direction == -1) { // first packet detected
                    currentPCR = 1; // dummy value
                }
                if (currentPCR) {
                    const pass = this.handlePCR(pcr);
                    if (pass === true) {
                        if (outputBounds.start === -1) {
                            outputBounds.start = positions[currentPCR] || initialPos;
                        }
                        if (outputBounds.end < pointer) {
                            outputBounds.end = pointer;
                        }
                    }
                }
                currentPCR = pcr;
                if (typeof (positions[pcr]) == 'undefined') {
                    positions[pcr] = pointer;
                }
            }
            pointer += size;
        }
        if (outputBounds.start !== -1) {
            const chunk = this.packetBuffer.extract(outputBounds.start, outputBounds.end);
            if ((chunk.length % PACKET_SIZE) > 0) {
                console.error('BAD PCR SIZE', chunk, chunk.length, (chunk.length % PACKET_SIZE), outputBounds);
            }
            if (this.debug) {
                console.log('PCR DATA EMIT = ' + kbfmt(chunk.length));
            }
            this.emit('data', chunk);
        }
    }
    handlePCR(pcr) {
        if (!this.pcrMemo.has(pcr)) {
            this.pcrMemoSize++;
            this.pcrMemo.set(pcr, 0);
            if (this.pcrMemoSize > this.maxPcrMemoSize) {
                const deleteCount = this.pcrMemoSize - (this.maxPcrMemoSize - this.pcrMemoNudgeSize);
                const keysToDelete = Array.from(this.pcrMemo.keys()).slice(0, deleteCount);
                keysToDelete.forEach((pcr) => this.pcrMemo.delete(pcr));
                this.pcrMemoSize -= deleteCount;
            }
            if (this.direction < 1) {
                this.direction = 1;
            }
        }
        if (this.direction >= 1) {
            return true;
        }
    }
    pcr(position) {
        if ((position + ADAPTATION_POSITION) > this.packetBuffer.length) {
            return;
        }
        const header = this.packetBuffer.readUInt32BE(position);
        const adaptationFieldControl = (header & 0x30) >>> 4;
        if ((adaptationFieldControl & 0x2) !== 0 && this.packetBuffer.readUInt8(position + 4) !== 0) {
            const flags = this.packetBuffer.readUInt8(position + 5);
            if ((flags & 0x10) !== 0 || (flags & 0x08) !== 0) {
                let pcrBase = this.packetBuffer.readUInt32BE(position + ADAPTATION_POSITION);
                let pcrExtension = this.packetBuffer.readUInt16BE(position + ADAPTATION_POSITION + 4);
                pcrBase = pcrBase * 2 + (((pcrExtension & 0x8000) !== 0) ? 1 : 0);
                pcrExtension = pcrExtension & 0x1ff;
                return pcrBase * 300 + pcrExtension;
            }
        }
    }
    push(chunk) {
        if (this.destroyed)
            return;
        if (!Buffer.isBuffer(chunk)) { // is buffer
            chunk = Buffer.from(chunk);
        }
        this.packetBuffer.append(chunk);
        this.packetize();
    }
    flush() {
        if (this.direction === 1) {
            this.direction = 0;
        }
        if (this.packetBuffer.length) {
            this.packetBuffer.clear();
        }
    }
    destroy() {
        this.destroyed = true;
        this.removeAllListeners();
        this.pcrMemo.clear();
        this.packetBuffer.destroy();
    }
    async terminate() {
        this.destroy();
    }
}
export default MPEGTSProcessor;
