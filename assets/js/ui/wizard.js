
class Wizard {
    constructor(){
        this.step = 0
        this.finished = false
    }
    finish(){
        if(!this.finished){
            this.finished = true
            doAction('appReady')
        }
    }
    start(){
        this.steps = [
            {
                question: Lang.SHARED_EXCLUSIVE_MODE_QUESTION, 
                answers: [
                    ['<i class="fas fa-user-shield"></i> ' + Lang.EXCLUSIVE_MODE, () => {
                        const done = () => {
                            Config.set('search-range-size', 0)
                            if(typeof(askForInputNotification) != 'undefined'){
                                askForInputNotification.hide()
                            }
                            process.nextTick(this.next.bind(this))
                        }, validate = () => {
                            return getSources().length
                        }
                        if(validate()){
                            done()
                        } else {
                            askForListEx((err, type) => {
                                if(validate()){
                                    done()
                                } else {
                                    console.warn('No list provided, try again.')
                                    askForInputNotification.update(Lang.INVALID_URL_MSG, 'fa-exclamation-circle faclr-red', 'normal')
                                    setTimeout(this.prev.bind(this), 0)
                                }
                            })
                        }
                    }],
                    ['<i class="fas fa-users"></i> ' + Lang.SHARED_MODE, () => {
                        jQuery('.prompt .fa-users').parent('button').html('<i class="fas fa-circle-notch pulse-spin"></i> ' + Lang.PROCESSING)
                        Config.set('search-range-size', sharedDefaultSearchRangeSize)
                        if(typeof(askForInputNotification) != 'undefined'){
                            askForInputNotification.hide()
                        }
                        process.nextTick(this.next.bind(this))
                    }]
                ],
                condition: () => {
                    return Config.get('search-range-size') <= 0 && !getSources().length
                }
            }
        ]
        this.steps = applyFilters('wizardSteps', this.steps)
        this.go()
    }
    go(){
        if(isModal()){
            modalClose(true)
        }
        if(typeof(this.steps[this.step]) != 'undefined'){
            if(this.steps[this.step].condition()){
                modalConfirm(this.steps[this.step].question, this.steps[this.step].answers, false)
            } else {
                this.next()
            }
        } else {
            this.finish()
        }
    }
    prev(){
        if(this.step > 0){
            this.step--
        }
        this.go()
    }
    next(){
        this.step++
        this.go()
    }
}

const wizard = new Wizard()
addAction('appStart', () => {
    wizard.start()
})
