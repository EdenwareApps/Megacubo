
class BridgeCustomEmitter extends EventEmitter {
    constructor (){
        super()
        this.originalEmit = this.emit
        this.emit = this.customEmit
        parent.channel.on('message', args => {
            this.originalEmit.apply(this, args)
        })
    }
    customEmit(...args){
        parent.channel.post('message', args)
    }
}

function setupIOCalls(ioInstance){
    return new Proxy(ioInstance, {
        get: (ioInstance, field) => {
            if(field in ioInstance){
                return ioInstance[field]
            }
            const id = parseInt(Math.random() * 1000000)
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

var appReady, app
window.addEventListener('message', e => {
    if(e.data.action == 'ready' && !appReady){
        appReady = true
        console.log('ready', e.data)
        app = setupIOCalls(new BridgeCustomEmitter())
        app.emit('bind')
        parent.channelGetLangCallback()
        //window.addEventListener('beforeunload', () => app.emit('unbind'))
        initApp()
        console.log('ready OK')  
    }
})
