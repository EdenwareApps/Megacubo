
const dialer = (() => {
    var self = {
        dialerInterval: 1500, 
        dialerTimer: 0, 
        dialerType: '', 
        nowDialing: ''
    }
    self.notification = notify('...', 'fa-search', 'forever', true)
    self.notification.hide()
    return (evt) => {
        if(evt.target && evt.target.tagName.match(new RegExp('^(input|textarea)$', 'i'))){
            console.warn('INPUT ignored');
            return;
        }
        if(evt.altKey || evt.ctrlKey || evt.metaKey || evt.shiftKey){
            console.warn('MODKEY ignored');
            return;
        }
        if([38, 40].indexOf(evt.keyCode) != -1){
            console.warn('WHEEL ignored');
            return;
        }
        var ok, bms, bd = Config.get('bookmark-dialing'), tp = Config.get('dialing-action'), charCode = (evt.which) ? evt.which : evt.keyCode, chr = (evt.key && evt.key.length == 1) ? evt.key : String.fromCharCode(charCode);
        console.warn('KEY', self.nowDialing, evt, chr);
        if(!self.nowDialing && !isNumeric(chr) && !isLetter(chr)){
            return;
        }
        if(evt.key.length == 1 && isNumberOrLetter(chr)){
            self.nowDialing += chr
        } else if(evt.key == 'Backspace') {
            self.nowDialing = self.nowDialing.substr(0, self.nowDialing.length - 1)
        } else {
            return;
        }
        self.dialerType = (bd && isNumeric(self.nowDialing)) ? 'numeric' : 'mixed'
        var notifyData = null;
        if (bd && isNumeric(chr) && self.dialerType != 'mixed') {
            console.warn('ZZZZZZZZZZZ')
            clearTimeout(self.dialerTimer);
            notifyData = [self.nowDialing.toLowerCase(), 'fa-star', 'normal']
            ok = true;
        } else if (tp != 'disabled' && isNumberOrLetter(chr)) {
            console.warn('ZZZZZZZZZZZ')
            clearTimeout(self.dialerTimer);
            notifyData = [self.nowDialing.toLowerCase(), (self.dialerType == 'mixed') ? 'fa-search' : 'fa-star', 'normal']
            ok = true;
        }
        self.notification.update.apply(self.notification, notifyData)
        console.warn('KEY', chr, '--', self.nowDialing);
        if(ok && typeof(dialingActions[tp]) != 'undefined'){
            self.dialerTimer = setTimeout(() => {
                ok = false;
                console.warn('ZZZZZZZZZZZ', self.dialerType, self.nowDialing)
                if(self.dialerType == 'mixed') {
                    bms = self.nowDialing;
                    if(bms.length > 2) {
                        cb = applyFilters('dialingCallback', (self) => {
                            self.notification.update(bms.toLowerCase(), dialingActions[tp]['icon'], 'normal');
                            dialingActions[tp]['callback'](bms.toLowerCase());
                            self.notification.hide()
                        }, self.nowDialing, self.dialerType, self.notification)
                        self.dialerTimer = setTimeout(() => {
                            cb.call(null, self)
                            self.dialerType = false;
                            self.nowDialing = '';
                        }, 400);
                        ok = true;
                    }
                } else {
                    if(parseInt(self.nowDialing) > 0) {
                        console.warn('ZZZZZZZZZZZ', self.dialerType, self.nowDialing)
                        cb = applyFilters('dialingCallback', (self) => {
                            console.warn('ZZZZZZZZZZZ', self, '|', this)
                            let n = parseInt(self.nowDialing)
                            console.warn('ZZZZZZZZZZZ', n, JSON.stringify(self.nowDialing))
                            bms = Bookmarks.get().filter((bm) => {
                                return bm.bookmarkId == n
                            })
                            if(bms.length) {
                                console.warn('ZZZZZZZZZZZ', bms)
                                bms = bms[0]
                                self.notification.update(bms.name, bms.logo || 'fa-star', 'normal');
                                playEntry(bms);
                                self.notification.hide()
                            } else {
                                self.notification.update(Lang.NOT_FOUND, 'fa-ban', 'short')
                            }
                        }, self.nowDialing, self.dialerType, self.notification)
                        console.warn('ZZZZZZZZZZZ', cb)
                        self.dialerTimer = setTimeout(() => {
                            cb.call(null, self)
                            self.dialerType = false;
                            self.nowDialing = '';
                        }, 400);
                        ok = true;
                    }
                }
                if(!ok) {
                    self.notification.update(Lang.NOT_FOUND, 'fa-ban', 'short');
                    self.dialerType = false;
                    self.nowDialing = '';
                }
            }, self.dialerInterval)
        }
        return true;
    }
})()

jQuery(document).on('keydown', dialer)

addFilter('dialingCallback', (cb, data, type, notification) => {
    if(basename(Menu.path) == Lang.BOOKMARKS && type != 'mixed'){
        var entry = Pointer.selected(true, true)
        if(entry){
            entry = entry.data('entry-data')
            if(typeof(entry.bookmarkId) != 'undefined'){
                console.warn('ZZZZZZZZZZZ')
                cb = (self) => {
                    if(entry.bookmarkId != self.nowDialing){
                        entry.bookmarkId = self.nowDialing
                        Bookmarks.remove(entry)
                        Bookmarks.add(entry)
                        Menu.refresh()
                    } else {
                        notification.update(data, 'fa-ban', 'short')
                    }
                }
            }
        }
    }
    return cb
})

var dialingActions = [];

function registerDialingAction(name, icon, cb){
    dialingActions[name] = {icon: icon, callback: cb}
}

registerDialingAction('disabled', 'fa-ban', (terms) => {
    return false;
})

registerDialingAction('search', 'fa-search', (terms) => {
    goSearch(terms.toLowerCase())
})

registerDialingAction('play', 'fa-play', (terms) => {
    tuneNPlay(terms.toLowerCase(), null, 'mega://play|'+encodeURIComponent(terms.toLowerCase()))
})
