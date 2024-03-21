<script>
	import { onMount } from 'svelte'
  import { main } from '../../modules/bridge/renderer'
  import { OSD } from '../../modules/osd/renderer'
  
  let messages = []
  console.warn('OSD STEP1')
  onMount(async () => {
    console.warn('OSD STEP2')
    main.on('display-error', txt => {
      console.error(txt)
      main.osd && main.osd.show(txt, 'fas fa-exclamation-triangle faclr-red', 'error', 'normal')
    })
    main.on('menu-ready', () => {
        main.osd = new OSD(document.getElementById('osd-root'))
        main.osd.on('updated', () => {
          messages = main.osd.messages
        })
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
  top: var(--menu-padding-top);
  left: var(--menu-padding-left);
  width: 100%;
  padding: 0 2vmin;
  z-index: 10;
  box-sizing: border-box;
  pointer-events: none;
  display: none;
  flex-direction: column;
  align-items: center;
  transition: transform var(--menu-fx-nav-duration) ease-in-out 0s;
}

body.osd #osd-root {
  display: flex !important;
}

body.osd:not(.video) #menu header {
  opacity: 0.15 !important;
}

body.video #osd-root {
  bottom: calc(var(--controls-height) + var(--padding) + var(--seekbar-height));
}

#osd-root>div {
  font-size: var(--menu-entry-name-font-size);
  height: calc(1.5 * var(--menu-entry-name-font-size));
  color: var(--font-color);
  display: flex;
  align-items: center;
  border-width: 0;
  margin-bottom: var(--padding);
  border-radius: calc(var(--radius) * 2);
  text-shadow: 0 0 1vh #000, 0 0 6vh #000;
  margin-bottom: var(--padding-quarter);
  opacity: 1;
  background: var(--modal-background-color);
  max-width: 98%;
}

#osd-root>div:not(.osd-highlight) {
  padding: calc(var(--padding) / 8) var(--padding) calc(var(--padding) / 8) var(--padding);
  margin-left: var(--padding-half);
}

#osd-root>div.osd-highlight {
  font-size: calc(0.25 * var(--menu-header-height));
  height: calc(var(--menu-header-height) - (2 * var(--padding)));
  opacity: 1;
  margin-bottom: calc(1.5 * var(--padding));
  margin-left: var(--padding-half);
  margin-top: var(--padding);
  padding: 0 var(--padding);
}

#osd-root>div>div {
  /*
  vertical-align: middle;
  line-height: 150%;
  */
  display: inline-block;
  height: inherit;
  align-items: center;
}

.osd-icon img,
.osd-icon i {
  width: auto;
  height: inherit;
  margin-right: var(--padding);
  font-size: var(--menu-entry-details-font-size);
  display: inline-flex;
  align-items: center;
}

#osd-root>div.osd-highlight .osd-icon img,
#osd-root>div.osd-highlight .osd-icon i {
  font-size: calc(0.25 * var(--menu-header-height));
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