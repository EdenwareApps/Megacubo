
class Setup extends EventEmitter {
    constructor(){
        super()
        this.currentStep = -1
        this.offerCommunitaryMode = true
        this.skipList = window.setupSkipList
        if(!this.skipList){                    
            app.on('setup-skip-list', () => {
                window.setupSkipList = this.skipList = true
                this.applySkipList()
            })   
        }             
        app.on('setup-restart', () => {
            window.setupSkipList = this.isDone = this.skipList = false
            this.check()
        })
        this.check()
    }
    isMobile(){
        return !!parent.cordova
    }
    check(){
        if(!config['setup-completed']){
            this.welcome()
        }
    }
    validateURL(url){
		if(url && url.length > 11){
			let u = url.toLowerCase()
			if(u.substr(0, 4) == 'http' && u.indexOf('://') != -1 && u.indexOf('.') != -1){
				return true
			}
            let m = u.match(new RegExp('^([a-z]{1,6}):', 'i'))
            if(m && m.length > 1 && (m[1].length == 1 || m[1].toLowerCase() == 'file')){ // drive letter or file protocol
                return true
            } else {
                if(u.length >= 2 && u.charAt(0) == '/' && u.charAt(1) != '/'){ // unix path
                    return true
                }
            }
		}
    }
    ask(){
        if(this.skipList) return this.done()
        this.active = true
        setTimeout(() => {
            this.askList((ret) => {
                console.log('ASKED', ret, traceback())
                if(ret == 'sh'){
                    setTimeout(() => {
                        this.communitaryMode()
                    }, 0)
                } else {
                    if(ret && ret != -1){
                        if(this.validateURL(ret)){
                            app.emit('add-list', ret)
                            return this.done()
                        }
                        osd.show(lang.INVALID_URL_MSG, 'fas fa-exclamation-triangle faclr-red', 'setup-err', 'normal')
                    }
                    setTimeout(() => {
                        this.welcome()
                    }, 0)
                    return true
                }
            })
        }, 0)
        return true
    }
    communitaryMode(){   
        if(this.skipList || config['communitary-mode-lists-amount']) return this.done()
        this.active = true     
        explorer.dialog([
            {template: 'question', text: lang.COMMUNITARY_MODE, fa: 'fas fa-users'},
            {template: 'message', text: lang.SUGGEST_COMMUNITARY_LIST +"\r\n"+ lang.ASK_COMMUNITARY_LIST},
            {template: 'option', id: 'agree', fa: 'fas fa-check-circle', text: lang.I_AGREE},
            {template: 'option', id: 'back', fa: 'fas fa-chevron-circle-left', text: lang.BACK}
        ], choose => {
            setTimeout(() => {
                if(choose == 'agree'){
                    this.done(true)
                } else {
                    this.welcome()
                }
            }, 0)
            return true
        }, 'agree')   
    }
    applySkipList(){
        this.skipList = true
        if(this.active && explorer.inModal()){
            this.active = false
            this.dialogQueue = []
            explorer.endModal()
        }
        this.done()
    }
    welcome(){
        if(this.skipList || config['communitary-mode-lists-amount']) return this.done()
        this.active = true
        let text = lang.ASK_IPTV_LIST_FIRST.split('. ').join(".\r\n"), def = 'ok', opts = [
            {template: 'question', text: 'Megacubo', fa: 'fas fa-star'},
            {template: 'message', text},
            {template: 'option', text: lang.ADD_LIST, fa: 'fas fa-plus-square', id: 'ok'}
        ]
        if(this.offerCommunitaryMode){
            opts.push({template: 'option', text: lang.DONT_HAVE_LIST, details: lang.LOAD_COMMUNITARY_LISTS, fa: 'fas fa-times-circle', id: 'sh'})
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
        if(this.skipList) return this.done()
        this.active = true
        explorer.prompt(lang.ASK_IPTV_LIST, 'http://', '', cb, true, 'fas fa-info-circle', null, [
            {template: 'option', text: 'OK', fa: 'fas fa-check-circle', id: 'submit'},
            {template: 'option', text: lang.DONT_HAVE_LIST, fa: 'fas fa-times-circle', id: 'sh'}
        ])
    }
    done(enableCommunitaryMode){
        if(!this.isDone){
            this.isDone = true
            this.active = false
            console.log('PERFORMANCE-SETUP')
            app.emit('config-set', 'setup-completed', true)
            if(enableCommunitaryMode){
                app.emit('lists-manager', 'agree')
            }
            setTimeout(() => {
                if(!this.performanceAsked){
                    this.performanceAsked = true
                    app.emit('performance-setup')
                }
            }, 200)
            console.log('PERFORMANCE-SETUP')
        }
    }
}

