import { main } from '../../../modules/bridge/renderer'

export class Clock {
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
    humanize(seconds, zeroMeansDisabled) {
        const duration = moment.duration(seconds, 'seconds')
        const days = duration.days()
        const hours = duration.hours()
        const minutes = duration.minutes()
        const secs = duration.seconds()
        let message = ''
        if (days == 1) {
            message += main.lang.X_DAY.format(days) + ', '
        } else if (days > 1) {
            message += main.lang.X_DAYS.format(days) + ', '
        }
        if (hours == 1) {
            message += main.lang.X_HOUR.format(hours) + ', '
        } else if (hours > 1) {
            message += main.lang.X_HOURS.format(hours) + ', '
        }
        if (minutes == 1) {
            message += main.lang.X_MINUTE.format(minutes) + ', '
        } else if (minutes > 1) {
            message += main.lang.X_MINUTES.format(minutes) + ', '
        }
        if (secs == 1) {
            message += main.lang.X_SECOND.format(secs) + ', '
        } else if (secs > 1) {
            message += main.lang.X_SECONDS.format(secs) + ', '
        } else if(!message) {
            if(zeroMeansDisabled){
                message = main.lang.DISABLED
            } else {
                message = main.lang.X_SECONDS.format(secs)
            }
        }
        message = message.replace(/,\s*$/, '')
        return message
    }
}