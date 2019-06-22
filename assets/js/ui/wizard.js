
const Wizard = (() => {
    var self = {}
    self.step = 0
    self.finished = false
    self.finish = () => {
        if(!self.finished){
            self.finished = true
            doAction('appReady')
        }
    }
    self.start = () => {
        self.steps = [
            {
                question: Lang.SHARED_EXCLUSIVE_MODE_QUESTION, 
                answers: [
                    ['<i class="fas fa-users"></i> '+Lang.SHARED_MODE, () => {
                        jQuery('.prompt .fa-users').parent('button').html('<i class="fas fa-circle-notch pulse-spin"></i> ' + Lang.PROCESSING)
                        Config.set('search-range-size', sharedDefaultSearchRangeSize)
                        process.nextTick(self.next)
                        if(typeof(addNewSourceNotification) != 'undefined'){
                            addNewSourceNotification.hide()
                        }
                    }], 
                    ['<i class="fas fa-user-shield"></i> '+Lang.EXCLUSIVE_MODE, () => {
                        const done = () => {
                            Config.set('search-range-size', 0)
                            self.next()
                            if(typeof(addNewSourceNotification) != 'undefined'){
                                addNewSourceNotification.hide()
                            }
                        }, validate = () => {
                            return getSources().length
                        }
                        if(validate()){
                            done()
                        } else {
                            addNewSource((err, type) => {
                                if(validate()){
                                    done()
                                } else {
                                    console.warn('No list provided, try again.')
                                    setTimeout(self.prev, 0)
                                }
                            }, Lang.ASK_IPTV_LIST, false, true)
                        }
                    }]
                ],
                condition: () => {
                    return Config.get('search-range-size') <= 0 && !getSources().length
                }
            }
        ]
        self.go()
    }
    self.go = () => {
        if(isModal()){
            modalClose(true)
        }
        if(typeof(self.steps[self.step]) != 'undefined'){
            if(self.steps[self.step].condition()){
                modalConfirm(self.steps[self.step].question, self.steps[self.step].answers, false)
            } else {
                self.next()
            }
        } else {
            self.finish()
        }
    }
    self.prev = () => {
        if(self.step > 0){
            self.step--
        }
        self.go()
    }
    self.next = () => {
        self.step++
        self.go()
    }
    return self;
})()

addAction('appStart', Wizard.start)
