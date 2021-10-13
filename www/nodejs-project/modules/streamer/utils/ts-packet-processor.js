const Events = require('events'), fs = require('fs')

const SYNC_BYTE = 0x47
const PACKET_SIZE = 188

class MPEGTSPacketProcessor extends Events {
	constructor(){
        super()
        this.packetFilterPolicy = 1 // 0=bypass, 1=force size by trimming or padding, 2=remove
        this.lastFlushTime = 0
        this.minFlushInterval = 3 // secs
        this.buffering = []
        this.bufferSize = (512 * 1024) // 512KB
        this.maxPcrJournalSize = 2048
        this.pcrJournal = []
        this.debug = true
    }
	len(data){
		if(!data){
			return 0
		} else if(Array.isArray(data)) {
			let len = 0
			data.forEach(d => {
				len += this.len(d)
			})
			return len
		} else if(typeof(data.byteLength) != 'undefined') {
			return data.byteLength
		} else {
			return data.length
		}
	}
    pcr(x){
        const header = x.readUInt32BE(0), adaptationFieldControl = (header & 0x30) >>> 4
        if ((adaptationFieldControl & 0x2) !== 0) {
          var adaptationLength = x.readUInt8(4)
          if (adaptationLength !== 0) {
            let flags = x.readUInt8(5), pcrFlag = (flags & 0x10) !== 0
            if (pcrFlag === true) {
              let adaptationPosition = 6, pcrBase = x.readUInt32BE(adaptationPosition), pcrExtension = x.readUInt16BE(adaptationPosition + 4)
              pcrBase = pcrBase * 2 + (((pcrExtension & 0x8000) !== 0) ? 1 : 0)
              pcrExtension = pcrExtension & 0x1ff
              return pcrBase * 300 + pcrExtension
            }
          }
        }
    }
    process(clear){
        if(this.len(this.buffering) < 4){
            if(clear){
                this.buffering = []
            }
            return null // nothing to process
        }
        let pointer = 0, pcrs = {}, buf = Buffer.concat(this.buffering)
        if(!this.checkSyncByte(buf, 0)){
            pointer = this.nextSyncByte(buf, 0)
            if(pointer == -1){
                if(clear){
                    this.buffering = []
                }
                return null // keep this.buffering untouched (if no clear) and stop processing, pcrs ignored
            } else {
                console.log('skipping first '+ pointer + ' bytes')
            }
        }
        this.buffering = []
        while(pointer >= 0 && (pointer + PACKET_SIZE) <= buf.length){
            let offset = -1
            if((pointer + PACKET_SIZE) < (buf.length + 4)){ // has a next packet start
                if(!this.checkSyncByte(buf, pointer + PACKET_SIZE)){
                    offset = this.nextSyncByte(buf, pointer + PACKET_SIZE)
                }
            }
            let size = offset == -1 ? PACKET_SIZE : (offset - pointer)
            if(size != PACKET_SIZE){
                switch(this.packetFilterPolicy){
                    case 1:
                        if(size < PACKET_SIZE){
                            if(this.debug){
                                console.log('bad packet size: '+ size +', removing it', buf.slice(pointer, pointer + size))
                            }
                            buf = Buffer.concat([buf.slice(0, pointer), buf.slice(pointer + size)])
                            size = 0
                        } else { 
                            if(this.debug){
                                console.log('bad packet size: '+ size +', trimming it', buf.slice(pointer, pointer + size))
                            }
                            buf = Buffer.concat([buf.slice(0, pointer + PACKET_SIZE), buf.slice(pointer + size)]) // trim
                            size = PACKET_SIZE
                        }
                        break
                    case 2:
                        if(this.debug){
                            console.log('bad packet size: '+ size +', removing it')
                        }
                        buf = Buffer.concat([buf.slice(0, pointer), buf.slice(pointer + size)])
                        size = 0
                        break
                    default:
                        if(this.debug){
                            console.log('bad packet size: '+ size +', bypassing it')
                        }
                }
            }
            if(!size) continue
            const pcr = this.pcr(buf.slice(pointer, pointer + size))
            if(pcr && typeof(pcrs[pcr]) == 'undefined'){
                pcrs[pcr] = pointer
            }
            pointer += size
        }
        let ret, result = {}
        let pcrTimes = Object.keys(pcrs)
        if(pcrTimes.length > 1){
            Object.keys(pcrs).slice(0, -1).forEach(pcr => {
                if(this.pcrJournal.includes(pcr)){
                    delete pcrs[pcr]
                } else {
                    this.pcrJournal.push(pcr)
                }
            })
            pcrTimes = Object.keys(pcrs)
            if(this.debug){
                console.log('pcrs received', pcrTimes.length)
            }
            result = {
                start: parseInt(pcrs[pcrTimes[0]]),
                end: parseInt(pcrs[pcrTimes[pcrTimes.length - 1]]),
                leftover: parseInt(pcrs[pcrTimes[pcrTimes.length - 1]])
            }
        } else { // only one pcr or less found
            if(this.debug){
                console.log('few pcrs received', pcrTimes.length, global.kbfmt(buf.length))
            }
            result = {
                leftover: 0
            }
        }
        if(typeof(result.start) != 'undefined'){
            ret = buf.slice(result.start, result.end)  
            if(this.debug){
                console.log('process', result, ret.length, 'start: '+ pcrTimes[0] +' ('+ pcrs[pcrTimes[0]] +'), end: '+ pcrTimes[pcrTimes.length - 1] +' ('+ pcrs[pcrTimes[pcrTimes.length - 1]] +')')
            }
        }
        if(result.leftover < buf.length){
            if(clear){
                this.buffering = []
            } else {
                this.buffering = [buf.slice(result.leftover)]
                if(this.debug){
                    console.log('process', 'leftover: ' + global.kbfmt(buf.length - result.leftover))
                }
            }
        } else {
            if(this.debug){
                console.log('process', 'no leftover')
            }
            this.buffering = []
        }
        return ret
    }
    checkSyncByte(c, pos){
        if(pos < 0 || pos > (c.length - 4)){
            //console.error('bad checkSyncByte', c.length, c.length - 4, pos)
            return false
        } else {
            const header = c.readUInt32BE(pos || 0), packetSync = (header & 0xff000000) >> 24
            return packetSync == SYNC_BYTE
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
	push(chunk){
        if(!Buffer.isBuffer(chunk)){ // is buffer
            chunk = Buffer.from(chunk)
        }
        this.buffering.push(chunk)
        if(this.len(this.buffering) > this.bufferSize){
            this.flush(false)
        }
    }
    flush(clear){
        if(this.buffering.length){
            const now = global.time()
            if(clear || ((this.lastFlushTime - now) >= this.minFlushInterval)){
                this.lastFlushTime = now
                if(this.debug){
                    console.log('preproc', global.kbfmt(this.len(this.buffering)))
                }
                let data = this.process(clear)
                if(this.debug){
                    console.log('posproc', global.kbfmt(this.len(data)))
                }
                if(data){
                    if(this.debug){
                        console.log('data', global.kbfmt(this.len(data)))
                    }
                    this.emit('data', data)
                }
                if(this.debug){
                    console.log('flushtime', global.time() - now, clear)
                }
            }
            if(clear){
                this.clear()
            }
        }        
    }
    clear(){
        if(this.debug){
            console.log('clear')
        }
        this.buffering = []
        if(this.pcrJournal.length > this.maxPcrJournalSize){
            this.pcrJournal = this.pcrJournal.slice(-this.maxPcrJournalSize)
        }
    }
    destroy(){
        this.buffering = []
        this.removeAllListeners()
    }
}

module.exports = MPEGTSPacketProcessor
