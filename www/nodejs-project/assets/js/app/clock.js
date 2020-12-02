
class Clock {
    constructor(element){
        this.element = element
        this.update()
        let date = new Date(), startUpdatingAfter = 60 + 1 - date.getSeconds()
        setTimeout(() => {
            setInterval(this.update.bind(this), 60000)
            this.update()
        }, startUpdatingAfter * 1000)
    }
    update(){
        this.element.innerText = moment().format('LT')
    }
}