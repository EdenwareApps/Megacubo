
class Setup extends EventEmitter {
    constructor(){
        super()
        this.offerCommunitaryMode = true
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
                    app.emit('add-list', ret)
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
            {template: 'option', text: lang.ADD_LIST, fa: 'fas fa-plus-square', id: 'ok'}
        ]
        if(this.offerCommunitaryMode){
            opts.push({template: 'option', text: lang.DONT_HAVE_LIST, fa: 'fas fa-times-circle', id: 'sh'})
        }
        explorer.dialog(opts, choose => {
            setTimeout(() => {
                if(choose == 'no'){
                    this.done()
                } else if(choose == 'sh') {
                    this.communitaryMode()
                } else {
                    this.ask()
                }
            }, 0)
            return true
        }, def)
    }
    communitaryMode(){        
        explorer.dialog([
            {template: 'question', text: lang.COMMUNITARY_MODE, fa: 'fas fa-users'},
            {template: 'message', text: lang.SUGGEST_COMMUNITARY_LIST +"\r\n"+ lang.ASK_COMMUNITARY_LIST},
            {template: 'option', id: 'back', fa: 'fas fa-times-circle', text: lang.BACK},
            {template: 'option', id: 'agree', fa: 'fas fa-check-circle', text: lang.I_AGREE}
        ], choose => {
            setTimeout(() => {
                if(choose == 'agree'){
                    this.done(true)
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
            {template: 'option', text: lang.ADD_LIST, fa: 'fas fa-plus-square', id: 'ok'}
        ]
        if(this.offerCommunitaryMode){
            opts.push({template: 'option', text: lang.DONT_HAVE_LIST, fa: 'fas fa-times-circle', id: 'sh'})
        } else {
            opts.push({template: 'option', text: lang.ADD_LATER, fa: 'fas fa-clock', id: 'no'})
        }
        explorer.dialog(opts, choose => {
            setTimeout(() => {
                if(choose == 'no'){
                    this.done()
                } else if(choose == 'sh') {
                    this.communitaryMode()
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
    done(enableCommunitaryMode){
        console.log('PERFORMANCE-SETUP')
        app.emit('config-set', 'setup-complete', true)
        if(enableCommunitaryMode){
            app.emit('lists-manager', 'agree')
        }
        setTimeout(() => {
            app.emit('performance-setup')            
        }, 200)
        console.log('PERFORMANCE-SETUP')
    }
}

