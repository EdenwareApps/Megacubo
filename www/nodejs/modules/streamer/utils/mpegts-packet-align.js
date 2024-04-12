const SYNC_BYTE = 0x47
const PACKET_SIZE = 188

class MPEGTSPacketAligner {
    constructor() {
        this.buffer = null
    } 
    checkSyncByte(chunk, pos){
        return pos >= 0 && pos < chunk.length && chunk[pos] == SYNC_BYTE
    }
    nextSyncByte(chunk, offset=0){
        while(offset < (chunk.length - 4)){
            const pos = chunk.indexOf(SYNC_BYTE, offset)
            if(pos == -1){
                return -1
            } else if(this.checkSyncByte(chunk, pos)){
                return pos
            } else { // not a valid sync byte
                offset = pos + 1
            }
        }
        return -1
    }
    align(chunk) {
        if(this.buffer) {
            chunk = Buffer.concat([this.buffer, chunk])
        }
        let pointer = this.checkSyncByte(chunk, 0) ? 0 : this.nextSyncByte(chunk)
        let errorCount = 0
        if(pointer == -1){
            this.buffer = chunk
            return
        } else if(pointer) {
            if(this.debug){
                console.log('skipping first '+ pointer +' bytes')
            }
            chunk = chunk.slice(pointer)
            pointer = 0            
        }
        while((pointer + PACKET_SIZE) <= chunk.length){
            let offset = -1
            if((pointer + PACKET_SIZE) < chunk.length){ // has a next packet start
                if(!this.checkSyncByte(pointer + PACKET_SIZE)){
                    offset = chunk.indexOf(SYNC_BYTE, pointer + PACKET_SIZE)
                }
            }
            let size = offset == -1 ? PACKET_SIZE : (offset - pointer)
            if(size == PACKET_SIZE){
                errorCount = 0
            } else {
                errorCount++
                if(errorCount > 10){ // seems not mpegts, discard all
                    this.buffer = null
                    return
                }
                if(size < PACKET_SIZE){
                    console.log('bad packet size: '+ size +', removing it')
                    chunk = Buffer.concat([
                        chunk.slice(0, pointer),
                        chunk.slice(pointer + size)
                    ])
                    size = 0
                } else { 
                    console.log('bad packet size: '+ size +', trimming it')
                    chunk = Buffer.concat([
                        chunk.slice(0, pointer + PACKET_SIZE),
                        chunk.slice(pointer + size)
                    ])
                    size = PACKET_SIZE
                }
            }
            if(size) pointer += size
        }
        if(pointer < chunk.length) {
            this.buffer = chunk.slice(pointer)
        }
        return chunk.slice(0, pointer)
    }
    destroy() {
        this.destroyed = true
        this.buffer = null
    }
}

module.exports = MPEGTSPacketAligner
