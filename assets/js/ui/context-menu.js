function contextMenuSetup(){
    var menus = {
        window: {
            menu: new nw.Menu,
            target: window
        }
    }
    console.error('POOX')
    loadScripts([
        'context-menu-actions.js'
    ], 'assets/js/ui/', () => {
        console.error('POOX')
        var actions = Config.get('context-menu')
        console.error('POOX')
        if(actions){
            for(var type in actions){
                if(Array.isArray(actions[type])){
                    actions[type].forEach((action) => {
                        if(typeof(menus[type]) != 'undefined'){
                            if(typeof(action) == 'string'){
                                if(typeof(contextMenuActions[action]) != 'undefined'){
                                    menus[type].menu.append(new nw.MenuItem({
                                        label: Lang['ACTION_DESC_' + action] || Lang[action] || action,
                                        click: contextMenuActions[action][0]
                                    }))
                                } 
                            } else {
                                menus[type].menu.append(new nw.MenuItem({ 
                                    type: 'separator' 
                                }))
                            }
                        }
                    })
                }
            }
            console.error('POOX')
            for(var i in menus){
                let data = menus[i];
                jQuery(data.target).on('contextmenu', (e) => {
                    //if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target.isContentEditable) {
                    e.preventDefault();
                    e.stopPropagation();
                    data.menu.popup(e.pageX, e.pageY)
                })
            }
        }
        console.error('POOX')
    })
}

addAction('appReady', contextMenuSetup)
