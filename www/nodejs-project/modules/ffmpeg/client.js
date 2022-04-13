
class FFmpegController {
    constructor(){
        this.debug = false
        this.executionIds = {}
    }
    bind(){                
        app.on('ffmpeg-exec', this.exec.bind(this))
        app.on('ffmpeg-kill', this.kill.bind(this))
        app.on('ffmpeg-exit', this.exit.bind(this))
        window.addEventListener('beforeunload', () => this.exit())
        window.addEventListener('unload', () => this.exit())
    }
    trimErrorMessage(err){
        return String(err).split("\n").map(s => s.trim()).filter(s => s.length > 2).slice(-2).join("\n")
    }
    exec(id, cmd, trimResponse){
        if(this.debug){
            console.log('ffmpeg.exec', id, cmd)
        }
        top.ffmpeg.exec(cmd, data => {
            if(this.debug){
                console.log('ffmpeg.exec returned', cmd, data)
            }
            let pos = data.indexOf('-')
            if(pos != -1){
                let type = data.substr(0, pos), info = data.substr(pos + 1)
                if(type == 'start'){
                    let executionId = parseInt(info)
                    if(this.executionIds[id] && this.executionIds[id] == 'kill'){ // a kill call is pending
                        delete this.executionIds[id]
                        this._kill(executionId)
                    } else {
                        this.executionIds[id] = executionId
                    }
                } else if(type == 'metadata') {
                    app.emit('ffmpeg-metadata-'+ id, info)
                } else {
                    delete this.executionIds[id]
                    if(trimResponse) info = this.trimErrorMessage(info)
                    app.emit('ffmpeg-callback-'+ id, null, info)
                }
            } else {
                delete this.executionIds[id]
                console.error('ffmpeg.exec badly formatted response', cmd.join(' '), data)
                if(trimResponse) data = this.trimErrorMessage(data)
                app.emit('ffmpeg-callback-'+ id, data || 'error', '')
            }
        }, err => {
            console.error('ffmpeg.exec error', cmd.join(' '), err)
            if(trimResponse) err = this.trimErrorMessage(err)
            app.emit('ffmpeg-callback-'+ id, err || 'error', '')
            delete this.executionIds[id]
        })
    }
    kill(id){       
        if(this.debug){
            console.log('ffmpeg.exec kill '+ id)
        }
        if(typeof(this.executionIds[id]) != 'undefined' && this.executionIds[id] != 'kill'){
            let executionId = this.executionIds[id]
            this._kill(executionId)
        } else {
            this.executionIds[id] = 'kill'
        }
    }
    exit(){
        if(this.debug){
            console.log('ffmpeg.exec exit')
        }
        Object.values(this.executionIds).forEach(pid => {
            if(pid != 'kill'){
                this._kill(pid)
            }
        })
    }
    _kill(executionId){
        if(this.debug){
            console.log('ffmpeg.exec _kill '+  executionId)
        }
        top.ffmpeg.kill(executionId)
        let keepIds = []
        Object.keys(this.executionIds).forEach(k => {
            if(this.executionIds[k] == executionId){
                delete this.executionIds[k]
            } else if(this.executionIds[k] != 'kill'){
                keepIds.push(this.executionIds[k])
            }
        })
    }
}

window.ffmpeg = new FFmpegController()
