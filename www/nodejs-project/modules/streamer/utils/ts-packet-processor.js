const Events = require('events'), fs = require('fs')

const SYNC_BYTE = 0x47
const PACKET_SIZE = 188

class TSPacketProcessor extends Events {
	constructor(){
        super()
        this.packetFilterPolicy = 1 // 0=bypass, 1=force size, 2=remove
        this.lastFlushTime = 0
        this.minFlushInterval = 3 // secs
        this.buffering = []
        this.bufferSize = (512 * 1024) // 512KB
        this.pcrRepeatCheckerTimeout = 10 // after X seconds without receiving a valid pcr, give up and reset the pcr checking
        this.pcrRepeatCheckerLastValidPCRFoundTime = global.time()
        // this.debug = true
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
    process(clear){ // TODO: process try to remove repeated fragments by trusting in pcr times, seems not the better approach, someone has a better idea?
        if(this.len(this.buffering) < 4){
            if(clear){
                this.buffering = []
            }
            return null // nothing to process
        }
        let pointer = 0, pcrs = {}, buf = Buffer.concat(this.buffering), lastPCR = 0, discontinuityLevel = 0, pcrLog = [], pcrLogIrregular = false
        if(!this.checkSyncByte(buf, 0)){
            pointer = this.nextSyncByte(buf, 0)
            if(pointer == -1){
                if(clear){
                    this.buffering = []
                }
                return null // keep this.buffering untouched (if no clear) and stop processing, pcrs ignored
            }
        }
        if(this.debug){
            console.log('process start', this.currentPCR, this.parsingPCR)
        }
        this.buffering = []
        while(pointer >= 0 && (pointer + PACKET_SIZE) <= buf.length){
            let offset = -1
            if((pointer + PACKET_SIZE) < (buf.length + 4)){ // has a next packet start
                if(!this.checkSyncByte(buf, pointer + PACKET_SIZE)){
                    if(this.debug){
                        console.log('bad syncByte for next packet')
                    }
                    offset = this.nextSyncByte(buf, pointer + PACKET_SIZE)
                    if(offset != -1){
                        if(!this.checkSyncByte(buf, offset)){
                            offset = -1
                            console.error('HARD TO FIND NEXT SYNC BYTE, ABORT')
                            if(clear){
                                this.buffering = []
                            } else {
                                this.buffering = [buf]
                                return null
                            }
                            break
                        }
                    }
                }
            }
            let size = offset == -1 ? PACKET_SIZE : (offset - pointer)
            if(size != PACKET_SIZE){
                switch(this.packetFilterPolicy){
                    case 1:
                        if(this.debug){
                            console.log('bad packet size: '+ size +', trimming it')
                        }
                        if(size < PACKET_SIZE){
                            let padding = Buffer.alloc(PACKET_SIZE - size, '\0', 'utf8')
                            buf = Buffer.concat([buf.slice(0, pointer), padding, buf.slice(pointer + size)])
                        } else { 
                            buf = Buffer.concat([buf.slice(0, pointer + PACKET_SIZE), buf.slice(pointer + size)]) // trim
                        }
                        size = PACKET_SIZE
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
            if(pcr){ // is pcr packet
                if(lastPCR && pcr < lastPCR){
                    pcrLogIrregular = true        
                    pcrLog.push('> ' + pcr + ' ('+ lastPCR +'|'+ this.currentPCR +'|'+ this.parsingPCR +')')
                } else {                    
                    pcrLog.push(pcr)
                }
                lastPCR = pcr
                if(this.parsingPCR){ // already receiving a specific pcr
                    if(pcr != this.parsingPCR){ // go to new pcr
                        this.parsingPCR = pcr
                        if(discontinuityLevel <= 2 && this.isPCRDiscontinuity(pcr)){
                            console.log('pcr discontinuity', pcr)
                            discontinuityLevel++
                        } else {
                            discontinuityLevel = 0
                            this.currentPCR = pcr
                        }
                        pcrs[this.parsingPCR] = pointer
                    } else { // continue receiving the parsingPCR, no need for further checking cause it comes from same connection
                        if(typeof(pcrs[this.parsingPCR]) == 'undefined'){
                            pcrs[this.parsingPCR] = pointer
                        }
                    }
                } else { // new connection
                    if(!this.currentPCR || pcr > this.currentPCR){ // first connection OR next pcr
                        this.parsingPCR = pcr
                        if(discontinuityLevel <= 2 && this.isPCRDiscontinuity(pcr)){
                            if(this.debug){
                                console.log('pcr discontinuity', pcr)
                            }
                            discontinuityLevel++
                        } else {
                            discontinuityLevel = 0
                            this.currentPCR = pcr
                        }
                        pcrs[this.parsingPCR] = pointer
                    }
                }
            } else { // not a pcr packet
                if(this.parsingPCR){ // continue receiving the parsingPCR, no need for further checking cause it comes from same connection
                    if(typeof(pcrs[this.parsingPCR]) == 'undefined'){
                        pcrs[this.parsingPCR] = pointer
                    }
                } // else if no parsingPCR, is a new connection, ignore it until receive the first pcr packet to know where we are
            }
            pointer += size
        }
        let ret, result = {}, pcrTimes = Object.keys(pcrs)
        if(pcrTimes.length > 1){
            if(this.debug){
                console.log('pcrs received', pcrTimes.length)
            }
            this.pcrRepeatCheckerLastValidPCRFoundTime = global.time() // reset pcr checking timeout counter
            result = {
                start: parseInt(pcrs[pcrTimes[0]]),
                end: parseInt(pcrs[pcrTimes[pcrTimes.length - 1]]),
                leftover: parseInt(pcrs[pcrTimes[pcrTimes.length - 1]])
            }
        } else { // only one pcr or less found
            if(this.debug){
                console.log('few pcrs received', pcrTimes.length, (global.time() - this.pcrRepeatCheckerLastValidPCRFoundTime), global.kbfmt(buf.length))
            }
            if(clear){
                if(!pcrTimes.length && this.isPCRDiscontinuity(lastPCR) && (global.time() - this.pcrRepeatCheckerLastValidPCRFoundTime) > this.pcrRepeatCheckerTimeout){
                    // after X seconds without receiving a valid pcr, give up and reset the pcr checking for next data
                    if(this.debug){
                        console.log('PCR CHECKER RESET', '('+ global.time() +'s - '+ this.pcrRepeatCheckerLastValidPCRFoundTime +'s) > '+ this.pcrRepeatCheckerTimeout, this.currentPCR, lastPCR)
                    }
                    this.pcrRepeatCheckerLastValidPCRFoundTime = global.time() // reset pcr checking timeout counter
                    this.currentPCR = 0
                }
            }
            result = {
                leftover: 0
            }
        }
        if(typeof(result.start) != 'undefined'){
            ret = buf.slice(result.start, result.end)  
            if(this.debug){
                console.log('process', 'start: '+ pcrTimes[0] +' ('+ pcrs[pcrTimes[0]] +'), end: '+ pcrTimes[pcrTimes.length - 1] +' ('+ pcrs[pcrTimes[pcrTimes.length - 1]] +')')
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
                console.log('process', 'no leftover? should not happen', JSON.stringify(pcrs), JSON.stringify(result), buf.length)
            }
        }
        if(pcrLogIrregular && this.debug){
            console.log('PCRLOG', pcrLog.join("\r\n"))
        }
        return ret
    }
    filter(buf){ // only adjust packet sizes and startByte
        let pointer = 0, pcrs = {}
        if(!this.checkSyncByte(buf, 0)){
            pointer = this.nextSyncByte(buf, 0)
            if(pointer == -1){
                return Buffer.alloc(0)
            }
        }
        let end, start = pointer
        while(pointer >= 0 && (pointer + PACKET_SIZE) <= buf.length){
            let offset = -1
            if((pointer + PACKET_SIZE) < (buf.length + 4)){ // has a next packet start
                if(!this.checkSyncByte(buf, pointer + PACKET_SIZE)){
                    if(this.debug){
                        console.log('bad syncByte for next packet')
                    }
                    offset = this.nextSyncByte(buf, pointer + PACKET_SIZE)
                    if(offset != -1){
                        if(!this.checkSyncByte(buf, offset)){
                            offset = -1
                            console.error('HARD TO FIND NEXT SYNC BYTE, ABORT')
							break
                        }
                    }
                }
            }
            let size = offset == -1 ? PACKET_SIZE : (offset - pointer)
            if(size != PACKET_SIZE){
                switch(this.packetFilterPolicy){
                    case 1:
                        if(this.debug){
                            console.log('bad packet size: '+ size +', trimming it')
                        }
                        if(size < PACKET_SIZE){
                            let padding = Buffer.alloc(PACKET_SIZE - size, '\0', 'utf8')
                            buf = Buffer.concat([buf.slice(0, pointer), padding, buf.slice(pointer + size)])
                        } else { 
                            buf = Buffer.concat([buf.slice(0, pointer + PACKET_SIZE), buf.slice(pointer + size)]) // trim
                        }
                        size = PACKET_SIZE
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
            pointer += size
            end = pointer
        }
        return buf.slice(start, end)
    }
    isPCRDiscontinuity(pcr){
        let pcrGapLimit = 699999999
        return this.currentPCR && Math.abs(this.currentPCR - pcr) > pcrGapLimit
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
        this.parsingPCR = false
    }
    destroy(){
        this.buffering = []
        this.removeAllListeners()
    }
}

module.exports = TSPacketProcessor
