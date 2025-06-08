<script>
import { onMount } from 'svelte';
import { main } from '../../modules/bridge/renderer'

export class Clock {
    constructor(element){
        this.element = element
        this.update()
        const secondsRemainingOnCurrentMinute = 60 + 1 - new Date().getSeconds()
        setTimeout(() => {
            this.interval = setInterval(this.update.bind(this), 60000)
            this.update()
        }, secondsRemainingOnCurrentMinute * 1000)
    }
    update(){
        let time
        const date = new Date()
        const locale = main.lang?.locale
        const fullLocale = `${locale}-${main.lang.countryCode}`
        const params = {hour: '2-digit', minute: '2-digit'}
        try {
            time = date.toLocaleTimeString(fullLocale, params)
        } catch (e) {
            time = date.toLocaleTimeString(locale, params)
        }
        this.element.innerText = time
    }    
    humanize(seconds, zeroMeansDisabled) {
        const days = Math.floor(seconds / 86400) // 86400 seconds in a day
        const hours = Math.floor((seconds % 86400) / 3600) // 3600 seconds in an hour
        const minutes = Math.floor((seconds % 3600) / 60) // 60 seconds in a minute
        const secs = seconds % 60

        let message = ''
    
        if (days === 1) {
            message += main.lang.X_DAY.format(days) + ', '
        } else if (days > 1) {
            message += main.lang.X_DAYS.format(days) + ', '
        }
    
        if (hours === 1) {
            message += main.lang.X_HOUR.format(hours) + ', '
        } else if (hours > 1) {
            message += main.lang.X_HOURS.format(hours) + ', '
        }
    
        if (minutes === 1) {
            message += main.lang.X_MINUTE.format(minutes) + ', '
        } else if (minutes > 1) {
            message += main.lang.X_MINUTES.format(minutes) + ', '
        }
    
        if (secs === 1) {
            message += main.lang.X_SECOND.format(secs) + ', '
        } else if (secs > 1) {
            message += main.lang.X_SECONDS.format(secs) + ', '
        } else if (!message) {
            if (zeroMeansDisabled) {
                message = main.lang.DISABLED
            } else {
                message = main.lang.X_SECONDS.format(secs)
            }
        }
    
        // Remove the trailing comma and space, if any
        message = message.replace(/,\s*$/, '')
        return message
    }    
}

let element = null
onMount(() => {
    main.clock = new Clock(element)
}) 
</script>

<style>
time {
    background: var(--background-color);
    padding: var(--padding-quarter) var(--padding-quarter) var(--padding-quarter) var(--padding);
    border-top-left-radius: var(--radius);
}
</style>

<time bind:this={element}></time>