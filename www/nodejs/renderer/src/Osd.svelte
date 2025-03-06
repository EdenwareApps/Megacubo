<script>
	import { onMount } from 'svelte'
  import { main } from '../../modules/bridge/renderer'
  import { OSD } from '../../modules/osd/renderer'
  
  let messages = []
  onMount(async () => {
    main.on('display-error', txt => {
      console.error(txt)
      main.osd && main.osd.show(txt, 'fas fa-exclamation-triangle faclr-red', 'error', 'normal')
    })
    main.osd = new OSD(document.getElementById('osd-root'))
    main.osd.on('updated', () => {
      messages = main.osd.messages
    })
    main.waitMain(() => {
      const internetConnStateOsdID = 'network-state', updateInternetConnState = () => {
        if (navigator.onLine) {
          main.emit('network-state-up')
          main.osd.hide(internetConnStateOsdID)
        } else {
          main.emit('network-state-down')
          main.osd.show(main.lang.NO_INTERNET_CONNECTION, 'fas fa-exclamation-triangle faclr-red', internetConnStateOsdID, 'persistent')
        }
      }
      window.addEventListener('online', updateInternetConnState)
      window.addEventListener('offline', updateInternetConnState)
      navigator.onLine || updateInternetConnState()
    })
  })
</script>
<div id="osd-root">
    {#each messages as message}
        <div class="{message.classes.join(' ')}">
            <div class="osd-icon">{@html message.icon}</div>
            <div class="osd-text slide-in-from-left"><div>{@html message.text}</div></div>
        </div>
    {/each}
</div>
<style global>
#osd-root {
  position: absolute;
  padding: var(--menu-padding);
  z-index: 9;
  box-sizing: border-box;
  pointer-events: none;
  display: none;
  flex-direction: column;
  align-items: center;
  transition: transform var(--menu-fx-nav-duration) ease-in-out 0s;
  top: var(--menu-padding-top);
  bottom: var(--menu-padding-bottom);
  right: var(--menu-padding-right);
  left: var(--menu-padding-left);
  box-sizing: border-box;
}

body.portrait #osd-root {
  align-items: baseline;
}

body.osd #osd-root {
  display: flex !important;
}

body.video #osd-root {
  bottom: calc(var(--controls-height) + var(--padding) + var(--seekbar-height));
}

#osd-root > div {
  font-size: var(--menu-entry-name-font-size);
  font-weight: 500;
  min-height: calc(1.5 * var(--menu-entry-name-font-size));
  color: var(--shadow-background-color);
  display: flex;
  border-width: 0;
  margin-bottom: var(--padding);
  border-radius: var(--radius);
  text-shadow: 1px 1px rgba(0,0,0,0.25);
  opacity: 1;
  background: linear-gradient(to bottom, var(--font-color) 25%, var(--background-color) 200%);
  max-width: 98%;
  padding: var(--padding-half) var(--padding-2x) var(--padding-half) var(--padding-2x);
  margin-left: var(--padding-half);
  line-height: 150%;
  height: inherit;
  box-shadow: 2px 2px 0 rgb(0,0,0);
}

body.video #osd-root > div {
  color: var(--font-color);
  background: rgba(0, 0, 0, 0.8) !important;
  box-shadow: 0 0 var(--padding-2x) rgba(0, 0, 0, 0.5) !important;
}

body.portrait #osd-root > div {
  border-bottom-left-radius: 0;
}

.osd-icon img,
.osd-icon i {
  width: auto;
  height: inherit;
  max-height: var(--controls-height);
  margin: 0 var(--padding);
  font-size: var(--menu-entry-details-font-size);
  display: inline-flex;
}

#osd-root .osd-text {
  position: relative;
  line-height: 150%;
  align-items: center;
  display: flex;
  white-space: pre-wrap;
}

#osd-root .osd-text>div {
  display: block;
}

body:not(.video-loading) #osd-entry-debug-conn-err {
  /* Show connection debug only if video is in loading state */
  display: none !important;
}

body.video:not(.modal) #osd-root {
  transform: scaleY(var(--menu-fx-nav-default-deflate));
}
</style>