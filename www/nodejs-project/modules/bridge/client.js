
class BridgeCustomEmitter extends EventEmitter {
    constructor (){
        super()
        this.originalEmit = this.emit
        this.emit = this.customEmit
        this.channel = parent.channel
        this.channel.on('message', args => {
            this.originalEmit.apply(this, args)
        })
    }
    customEmit(...args){
        this.channel.post('message', args)
    }
}

function setupIOCalls(ioInstance){
    return new Proxy(ioInstance, {
        get: (ioInstance, field) => {
            if(field in ioInstance){
                return ioInstance[field]
            }
            const id = parseInt(Math.random() * 10000000000000)
            return (...args) => {
                return new Promise((resolve, reject) => {
                    ioInstance.once('callback-' + id, ret => {
                        (ret.error ? reject : resolve)(ret.data)
                    })
                    ioInstance.emit('call-' + field, {id, args})
                })
            }
        }
    })
}
