
function shareEntry(){
    return {
        name: Lang.SHARE, 
        logo: 'fa-heart', 
        type: 'group', 
        entries: [
            {name: Lang.SHARE+': Facebook', logo: 'fab fa-facebook', type: 'option', callback: () => { goShare('facebook') }},
            {name: Lang.SHARE+': Twitter', logo: 'fab fa-twitter', type: 'option', callback: () => { goShare('twitter') }},
            {name: Lang.SHARE+': '+Lang.MORE_OPTIONS, logo: 'fab fa-twitter', type: 'option', callback: goShare}
        ]
    }
}

function goShare(type){
    var mask, url, n = Playback.active ? Playback.active.entry.name : ' '
    switch(type){
        case 'facebook':
            mask = Lang.SHARE_FACEBOOK_MASK    
            url = 'https://www.facebook.com/sharer/sharer.php?u={0}&quote={1}'
            break;
        case 'twitter':
            mask = Lang.SHARE_TWITTER_MASK
            url = 'https://twitter.com/share?url={0}&text={1}'
            break;
        default:
            mask = Lang.SHARE_TWITTER_MASK
            url = 'https://www.addtoany.com/share#url={0}&title={1}'
    }
    nw.Shell.openExternal(url.format(encodeURIComponent(url), encodeURIComponent(mask.format(n).replace(new RegExp(' +'), ' '))))
}

addFilter('playingMetaEntries', (entries, path) => {
    entries.push(shareEntry())
	return entries;
})

addAction('preMenuInit', () => {
    Menu.entries = Menu.insert(Menu.entries, Lang.ABOUT, shareEntry())
})