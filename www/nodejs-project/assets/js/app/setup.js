
class Setup extends EventEmitter {
    constructor(){
        super()
        this.check()
    }
    isMobile(){
        return !!parent.cordova
    }
    check(){
        if(!config['setup-complete']){
            this.welcome()
        }
    }
    ask(){
        setTimeout(() => {
            this.askList((ret) => {
                console.log('ASKED', ret, traceback())
                if(ret && ret != -1){
                    app.emit('add-source', ret)
                    this.done()
                } else {
                    setTimeout(() => {
                        this.infoIPTVList()
                    }, 0)
                }
                return true
            })
        }, 0)
        return true
    }
    infoIPTVList(){
        let def = 'ok', opts = [
            {template: 'question', text: 'Megacubo', fa: 'fas fa-exclamation-circle'},
            {template: 'message', text: lang.NO_LIST_PROVIDED},
            {template: 'option', text: lang.ADD_LIST, fa: 'fas fa-plus-square', id: 'ok'},
            {template: 'option', text: lang.ADD_LATER, fa: 'fas fa-clock', id: 'no'}
        ]
        if(!this.isMobile()){
            opts.pop()
            opts.push({template: 'option', text: lang.SHARED_MODE, fa: 'fas fa-users', id: 'sh'})
        }
        explorer.dialog(opts, choose => {
            console.log('CHH', choose)
            setTimeout(() => {
                if(choose == 'no'){
                    this.done()
                } else if(choose == 'sh') {
                    this.communityMode()
                } else {
                    this.ask()
                }
            }, 0)
            return true
        }, def)
    }
    communityMode(){        
        explorer.dialog([
            {template: 'question', text: lang.SHARED_MODE, fa: 'fas fa-users'},
            {template: 'message', text: lang.ASK_COMMUNITY_LIST},
            {template: 'option', id: 'back', fa: 'fas fa-times-circle', text: lang.BACK},
            {template: 'option', id: 'agree', fa: 'fas fa-check-circle', text: lang.I_AGREE}
        ], choose => {
            console.log('CHH', choose)
            setTimeout(() => {
                if(choose == 'agree'){
                    app.emit('config-set', 'setup-complete', true)
                    setTimeout(() => app.emit('lists-manager', 'agree'), 200)
                } else {
                    this.infoIPTVList()
                }
            }, 0)
            return true
        }, 'back')   
    }
    welcome(){
        let text = lang.ASK_IPTV_LIST_FIRST.split('. ').join(".\r\n"), def = 'ok', opts = [
            {template: 'question', text: 'Megacubo', fa: 'fas fa-star'},
            {template: 'message', text},
            {template: 'option', text: lang.ADD_LIST, fa: 'fas fa-plus-square', id: 'ok'},
            {template: 'option', text: lang.ADD_LATER, fa: 'fas fa-clock', id: 'no'}
        ]
        if(!this.isMobile()){
            opts.pop()
            opts.push({template: 'option', text: lang.SHARED_MODE, fa: 'fas fa-users', id: 'sh'})
        }
        explorer.dialog(opts, choose => {
            console.log('CHH', choose, traceback())
            setTimeout(() => {
                if(choose == 'no'){
                    this.done()
                } else if(choose == 'sh') {
                    this.communityMode()
                } else {
                    this.ask()
                }
            }, 0)
            return true
        }, def)
    }
    askList(cb){
        explorer.prompt(lang.ASK_IPTV_LIST, 'http://', '', cb, true, 'fas fa-info-circle')
    }
    done(){
        app.emit('config-set', 'setup-complete', true)
    }
}

