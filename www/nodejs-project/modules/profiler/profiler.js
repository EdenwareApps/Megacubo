
const path = require('path'), EntriesGroup = require(path.resolve(__dirname, '../entries-group'))

class Profiler extends EntriesGroup {
    constructor(){
        super('profiler')
        this.limit = 36
        this.resumed = false
        this.allowDupes = true
        this.timer = 0 // bind to streamer commit and stop
        global.streamer.on('commit', () => {
            let time = global.time()
            if(this.timer){
                clearTimeout(this.timer)
            }
            this.timer = setTimeout(() => {
                if(global.streamer.active){
                    let entry = global.streamer.active.data
                    entry.profilerTime = time
                    this.remove(entry)
                    this.add(entry)
                }
            }, 120000)
        })
        global.streamer.on('uncommit', () => {
            if(this.timer){
                clearTimeout(this.timer)
            }
        })
    }
    getCurrentProgram(){
        // Pega o conteúdo assistido e checa se é um canal live (isChannel ou mega.parse), se sim checa no EPG o programa que está passando com getProgram neste canal e retorna os dados juntos. Se não tiver programa retorna apenas os dados do canal.
    }
    getProgram(canal){
    
    }
    sync(){
        if(getCurrentProgram.canalNName == this.data[0].canalNName){
            //update data[0] watchEnd
        } else {
            this.data.unshift(currentProgram).slice (0, this.limit)
        }
    }
    suggestions(count){
        // checa os programas passando agora que possuem as categorias dos programas que a pessoa assiste e retorna os resultados de maior score, cada categoria que a pessoa assiste recebe um score que é igual ao número de minutos assistidos daquela categoria
    }
    getPreferredCategories(){
        let cats = {}
        this.data.forEach(program => {
            //para casa categoria desse programa adicione pra minutos do panda ao value, sendo o score
        })
        return cats
    }
}

module.exports = Profiler
