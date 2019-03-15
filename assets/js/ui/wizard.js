
var Wizard = (() => {
    var self = {}
    self.step = 0
    self.finished = false
    self.finish = () => {
        self.finished = true
        Config.set('wizard-finished', true)
        doAction('wizardFinish')
    }
    self.start = () => {
        self.steps = [
            {
                question: Lang.SHARED_EXCLUSIVE_MODE_QUESTION, 
                answers: [
                    ['<i class="fas fa-users"></i> '+Lang.SHARED_MODE, () => {
                        jQuery('.prompt .fa-users').parent('button').html('<i class="fas fa-circle-notch pulse-spin"></i> ' + Lang.PROCESSING)
                        Config.set('search-range-size', Config.defaults['search-range-size'])
                        setTimeout(self.next, 10)
                    }], 
                    ['<i class="fas fa-user-shield"></i> '+Lang.EXCLUSIVE_MODE, () => {
                        let done = () => {
                            Config.set('search-range-size', 0)
                            self.next()
                        }
                        if(!getSources().length){
                            addNewSource((err, type) => {
                                if(!err){
                                    if(type == 'list'){
                                        done()
                                    } else {
                                        console.warn('No list provided, try again.')
                                        notify(Lang.INVALID_URL_MSG, 'fa-exclamation-circle faclr-red', 'normal')
                                        setTimeout(self.go, 10)
                                    }
                                }
                            }, Lang.ASK_IPTV_LIST, true)
                        } else done()
                    }]
                ]
            }
        ]
        self.go()
    }
    self.go = (n) => {
        modalClose()
        if(Config.get('wizard-finished') !== true && typeof(self.steps[self.step]) != 'undefined'){
            modalConfirm(self.steps[self.step].question, self.steps[self.step].answers, false)
        } else {
            self.finish()
        }
    }
    self.prev = () => {
        self.step--;
        self.go()
    }
    self.next = () => {
        self.step++;
        self.go()
    }
    return self;
})()

Config.defaults = Object.assign({
    'wizard-finished': false
}, Config.defaults)

addAction('appStart', () => {
    if(!Config.get('search-range-size') && !getSources().length){
        Config.set('wizard-finished', false)
    }
    Wizard.start()
})