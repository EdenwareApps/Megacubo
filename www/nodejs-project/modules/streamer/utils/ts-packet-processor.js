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
        this.maxPcrJournalSize = 256
        this.pcrJournal = []
        this.pcrSizesJournal = {}
        this.debug = false
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
    readPCRS(buf){
        let pointer = 0, pcrs = {}, errorCount = 0, currentPCR = 0, iterationsCounter = 0, batchPCRSizesJournal = {}
        if(!this.checkSyncByte(buf, 0)){
            pointer = this.nextSyncByte(buf, 0)
            if(pointer == -1){
                return {err: null, buf: null, pcrs: null} // keep this.buffering untouched (if no clear) and stop processing, pcrs ignored
            } else {
                if(this.debug){
                    console.log('skipping first '+ pointer + ' bytes')
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
                    errorCount++
                    if(errorCount > 10){ // seems not mpegts, discard it all and break
                        if(this.debug){
                            console.log('seems not mpegts, discarding it')
                        }
                        return {err: 'seems not mpegts', buffer: null, pcrs: null}
                    }
                }
            }
            let size = offset == -1 ? PACKET_SIZE : (offset - pointer)
            if(currentPCR){
                if(typeof(batchPCRSizesJournal[currentPCR]) == 'undefined'){
                    batchPCRSizesJournal[currentPCR] = size
                } else {
                    batchPCRSizesJournal[currentPCR] += size
                }
            }
            if(size == PACKET_SIZE){
                errorCount = 0
            } else {
                switch(this.packetFilterPolicy){
                    case 1:
                        if(size < PACKET_SIZE){
                            if(this.debug){
                                console.log('bad packet size: '+ size +', removing it') //, buf.slice(pointer, pointer + size))
                            }
                            buf = Buffer.concat([buf.slice(0, pointer), buf.slice(pointer + size)])
                            size = 0
                        } else { 
                            if(this.debug){
                                console.log('bad packet size: '+ size +', trimming it') //, buf.slice(pointer, pointer + size))
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
            if(pcr){
                if(typeof(pcrs[pcr]) == 'undefined'){
                    pcrs[pcr] = pointer
                    currentPCR = pcr
                }
                if(typeof(this.pcrSizesJournal[pcr]) != 'undefined'){
                    // repeated pcr, check by journal how much we can ignore from here
                    let pos = this.pcrJournal.indexOf(pcr), ignore = 0
                    if(pos != -1){
                        for(let i = pos; i < this.pcrJournal.length; i++){
                            if(typeof(this.pcrSizesJournal[this.pcrJournal[i]]) == 'undefined'){
                                break
                            } else {
                                ignore += this.pcrSizesJournal[this.pcrJournal[i]]
                            }
                        }
                    }
                    if(this.debug){
                        console.log('pcrs ignoring', ignore)
                    }
                    pointer += (ignore || size)
                } else {
                    pointer += size
                }
            } else {
                pointer += size
            }
        }
        if(this.debug){
            console.log('pcr iterations', iterationsCounter)
        }
        Object.keys(batchPCRSizesJournal).slice(0, -1).map(Number).forEach(pcr => {
            this.pcrSizesJournal[pcr] = batchPCRSizesJournal[pcr]
        })
        return {err: null, buf, pcrs}
    }
    process(clear){
        if(this.len(this.buffering) < 4){
            if(clear){
                this.buffering = []
            }
            return null // nothing to process
        } 
        if(this.debug){
            console.log('process start')
        }
        let {err, buf, pcrs} = this.readPCRS(Buffer.concat(this.buffering))
        if(err == null && buf == null){ // insufficient buffer size, keep this.buffering
            return
        } else {
            this.buffering = []
            if(err){ // seems not mpegts
                return
            }
        }
        let ret, result = {}
        let pcrTimes = Object.keys(pcrs).map(Number)
        if(pcrTimes.length > 1){
            let pcrsPerBatch = buf.length / pcrs.length
            let minMaxPcrJournalSize = Math.min(100000, pcrsPerBatch * 60) // limit maxPcrJournalSize
            if(this.maxPcrJournalSize < minMaxPcrJournalSize){ // increase maxPcrJournalSize adaptively
                this.maxPcrJournalSize = minMaxPcrJournalSize
            }
            Object.keys(pcrs).slice(0, -1).map(Number).forEach(pcr => {
                pcr = parseInt(pcr)
                if(this.pcrJournal.includes(pcr)){
                    delete pcrs[pcr]
                } else {
                    this.pcrJournal.push(pcr)
                }
            })
            pcrTimes = Object.keys(pcrs).map(Number)
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
                if(this.debug){
                    console.log('process', 'no leftover due to clear')
                }
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
        if(this.debug){
            console.log('process end')
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
        const now = global.time()
        if(this.len(this.buffering) > this.bufferSize || ((now - this.lastFlushTime) >= this.minFlushInterval)){
            this.flush(false)
        }
    }
    flush(clear){
        if(this.buffering.length){
            const now = global.time()
            this.lastFlushTime = now
            if(this.debug){
                console.log('preproc', global.kbfmt(this.len(this.buffering)))
            }
            let data = this.process(clear)
            if(data){
                if(this.debug){
                    console.log('posproc', global.kbfmt(this.len(data)))
                }
                this.emit('data', data)
            }
            if(this.debug){
                console.log('flushtime', global.time() - now, clear)
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
            let s = this.pcrJournal.length - this.maxPcrJournalSize
            for(let i = 0; i < s; i++){
                delete this.pcrSizesJournal[this.pcrJournal[i]]
            }
            this.pcrJournal = this.pcrJournal.slice(s)
        }
    }
    destroy(){
        this.buffering = []
        this.removeAllListeners()
    }
}

module.exports = MPEGTSPacketProcessor
