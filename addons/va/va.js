
var vaFilters = [
    {key: 'hue', mask: 'hue-rotate({0}deg)'}, 
    {key: 'contrast', mask: 'contrast({0}%)'}, 
    {key: 'saturation', mask: 'saturate({0}%)'}, 
    {key: 'brightness', mask: 'brightness({0}%)'}
];

function applyVideoAdjustments(){
    var filter = '';
    vaFilters.forEach((r) => {
        var v = Config.get('va-' + r.key)
        if(typeof(v)=='number'){
            filter += ' '+r.mask.format(v)
        }
    })
    if(filter){
        var p = getFrame('player')
        var css = 'video { filter: '+filter+'; }';
        stylizer(css, 'va', p)
        console.warn(filter)
        if(Playback.active){
            var v = Playback.active.getVideo()
            if(v && v.ownerDocument.defaultView && v.ownerDocument.defaultView != p){
                stylizer(css, 'va', v.ownerDocument.defaultView)
            }
        }
    }
}

function getVideoAdjustmentEntries(){
    var vaLogic = (data, element, value) => {
        Config.set('va-' + data.label, value)
        applyVideoAdjustments()
    };
    var entries = [
        {name: Lang.SATURATION, type: 'slider', logo: 'fa-adjust', label: 'saturation', range: {start: 0, end: 200}, change: vaLogic},
        {name: Lang.BRIGHTNESS, type: 'slider', logo: 'fa-adjust', label: 'brightness', range: {start: 0, end: 200}, change: vaLogic},
        {name: Lang.CONTRAST, type: 'slider', logo: 'fa-adjust', label: 'contrast', range: {start: 0, end: 200}, change: vaLogic},
        {name: Lang.HUE, type: 'slider', logo: 'fa-adjust', label: 'hue', range: {start: 0, end: 360}, change: vaLogic},
        {name: Lang.CLEAR, type: 'option', logo: 'fa-undo', label: Lang.RESET_DATA, callback: () => {
            vaFilters.forEach((r) => {
                Config.set('va-' + r.key, Config.defaults['va-' + r.key])
            })
            applyVideoAdjustments()
            Menu.refresh()
        }}        
    ];
    entries = entries.map((data) => {
        if(data.type == 'slider'){
            data.value = Config.get('va-' + data.label)
            if(typeof(data.value) != 'number'){
                if(data.label == 'hue'){
                    data.value = 0;
                } else {
                    data.value = 100;
                }
            }
        }
        return data;
    })
    return entries;
}

Playback.on('commit', () => {
    setTimeout(applyVideoAdjustments, 400)
})

addFilter('toolsEntries', (entries, path) => {
    entries.push({name: Lang.VIDEO_ADJUSTMENT, logo: 'fa-adjust', type: 'group', renderer: getVideoAdjustmentEntries})
	return entries;
})

Config.defaults = Object.assign({
    'va-hue': 0,
    'va-contrast': 100,
    'va-saturation': 100,
    'va-brightness': 100
}, Config.defaults)
