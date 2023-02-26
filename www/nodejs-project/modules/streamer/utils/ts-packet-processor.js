const Events = require('events'), fs = require('fs')

const SYNC_BYTE = 0x47
const PACKET_SIZE = 188
const ADAPTATION_POSITION = 6

class MPEGTSPacketProcessorUtils extends Events {
	constructor(){
        super()        
    }
	len(data){
		if(!data){
			return 0
		} else if(Array.isArray(data)) {
			let len = 0
			data.forEach(d => len += this.len(d))
			return len
		} else if(typeof(data.byteLength) != 'undefined') {
			return data.byteLength
		} else {
			return data.length
		}
	}
    pcr(x, position){
        const header = x.readUInt32BE(position)
        const adaptationFieldControl = (header & 0x30) >>> 4
        if ((adaptationFieldControl & 0x2) !== 0 && x.readUInt8(position + 4) !== 0) {
            const flags = x.readUInt8(position + 5)
            if ((flags & 0x10) !== 0 || (flags & 0x08) !== 0) {
                let pcrBase = x.readUInt32BE(position + ADAPTATION_POSITION);
                let pcrExtension = x.readUInt16BE(position + ADAPTATION_POSITION + 4)
                pcrBase = pcrBase * 2 + (((pcrExtension & 0x8000) !== 0) ? 1 : 0)
                pcrExtension = pcrExtension & 0x1ff
                return pcrBase * 300 + pcrExtension
            }
        }
    }
    checkSyncByte(c, pos){
        if(pos >= 0 && pos < (c.length - 4)){
            const header = c.readUInt32BE(pos || 0), packetSync = (header & 0xff000000) >> 24
            return packetSync !== SYNC_BYTE
        }
    }
    nextSyncByte(c, pos){
        while(pos < (c.length - 4)){
            if(this.checkSyncByte(c, pos)){
                return pos
            }
            pos++
        }
        return -1
    }
}

class MPEGTSPacketProcessor extends MPEGTSPacketProcessorUtils {
	constructor(){
        super()
        this.debug = false
        this.direction = -1 // -1 = uninitialized; 0 = new conn, buffering up; 1 = passing through
        this.buffering = []
        this.maxPcrJournalSize = 8192 // 256 was not enough
        this.packetFilterPolicy = 1
        this.pcrJournal = []
        this.on('pcr', (pcr, data, start, end) => {
            if(this.pcrJournal.includes(pcr)){
                console.warn('REPEATED PCR LEAKING', pcr, data.length, this.direction)
                return
            } else {
                this.pcrJournal.push(pcr)
                if(this.pcrJournal.length > this.maxPcrJournalSize){
                    this.pcrJournal.splice(0, this.pcrJournal.length - this.maxPcrJournalSize)
                }
                if(this.direction !== 1){
                    this.direction = 1
                }
            }
            if(this.direction === 1){
                this.emit('data', data.slice(start, end))
            }
        })
    }
    packetize(){
        let currentPCR, cutpoint = 0, buf = Buffer.concat(this.buffering)
        let pointer = 0, positions = {}, errorCount = 0, iterationsCounter = 0
        if(!this.checkSyncByte(buf, 0)){
            pointer = this.nextSyncByte(buf, 0)
            if(pointer == -1){
                if(this.debug){
                    console.log('no next sync byte after '+ pointer +' bytes')
                }
                return
            } else {
                if(this.debug){
                    console.log('skipping first '+ pointer +' bytes')
                }
            }
        }
        while(pointer >= 0 && (pointer + PACKET_SIZE) <= buf.length){
            if(this.debug){
                iterationsCounter++
            }
            let offset = -1
            if((pointer + PACKET_SIZE) < (buf.length + 4)){ // has a next packet start
                if(!this.checkSyncByte(buf, pointer + PACKET_SIZE)){
                    offset = this.nextSyncByte(buf, pointer + PACKET_SIZE)
                }
            }
            let size = offset == -1 ? PACKET_SIZE : (offset - pointer)
            if(size == PACKET_SIZE){
                errorCount = 0
            } else {
                if(this.debug){
                    console.log('bad packet size: '+ size)
                }
                errorCount++
                if(errorCount > 10){ // seems not mpegts, break and pass all through from here
                    this.direction = 2
                    this.buffering = []
                    this.emit('data', buf)
                    return
                }
                switch(this.packetFilterPolicy){
                    case 1:
                        if(size < PACKET_SIZE){
                            console.log('bad packet size: '+ size +', removing it') //, buf.slice(pointer, pointer + size))
                            buf = Buffer.concat([buf.slice(0, pointer), buf.slice(pointer + size)])
                            size = 0
                        } else { 
                            console.log('bad packet size: '+ size +', trimming it') //, buf.slice(pointer, pointer + size))
                            buf = Buffer.concat([buf.slice(0, pointer + PACKET_SIZE), buf.slice(pointer + size)]) // trim
                            size = PACKET_SIZE
                        }
                        break
                    case 2:
                        console.log('bad packet size: '+ size +', removing it')
                        buf = Buffer.concat([buf.slice(0, pointer), buf.slice(pointer + size)])
                        size = 0
                        break
                    default:
                        console.log('bad packet size: '+ size +', passthrough')
                }
            }
            if(!size) continue
            const pcr = this.pcr(buf, pointer)
            if(pcr){
                if(!currentPCR && this.direction == -1){
                    currentPCR = 1 // dummy value
                }
                if(currentPCR){
                    this.emit('pcr', pcr, buf, positions[currentPCR] || 0, pointer)
                }
                cutpoint = pointer
                currentPCR = pcr
                if(typeof(positions[pcr]) == 'undefined') {
                    positions[pcr] = pointer
                }
            }
            pointer += size
        }
        if(this.debug){
            console.log('pcr iterations', iterationsCounter)
        }
        if(cutpoint > 0){
            this.buffering = [ buf.slice(cutpoint) ]
        }
    }
	push(chunk){
        if(this.destroyed){
            return
        }
        if(!Buffer.isBuffer(chunk)){ // is buffer
            chunk = Buffer.from(chunk)
        }
        if(this.direction == 2){            
            this.emit('data', chunk)
        } else {
            this.buffering.push(chunk)
            this.packetize()
        }
    }
    flush(){
        if(this.direction === 1){
            this.direction = 0
        }
        if(this.buffering.length){
            this.buffering = []
        }        
    }
    destroy(){
        this.destroyed = true
        this.buffering = []
        this.pcrJournal = []
        this.removeAllListeners()
    }
}

module.exports = MPEGTSPacketProcessor
