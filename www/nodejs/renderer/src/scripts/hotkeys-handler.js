export class HotkeysHandler {
    constructor() {
        this.specials = {
            'backspace': 8,
            'tab': 9,
            'enter': 13,
            'pause': 19,
            'capslock': 20,
            'esc': 27,
            'space': 32,
            'pageup': 33,
            'pagedown': 34,
            'end': 35,
            'home': 36,
            'left': 37,
            'up': 38,
            'right': 39,
            'down': 40,
            'insert': 45,
            'delete': 46,
            'f1': 112,
            'f2': 113,
            'f3': 114,
            'f4': 115,
            'f5': 116,
            'f6': 117,
            'f7': 118,
            'f8': 119,
            'f9': 120,
            'f10': 121,
            'f11': 122,
            'f12': 123,
            '?': 191, // Question mark
            'minus': [189, 109],
            'plus': [187, 107],
            'pause': 19,
            'browserback': 166,
            'browserforward': 167,
            'browserrefresh': 168,
            'browserstop': 169,
            'browsersearch': 170,
            'browserbookmarks': 171,
            'browserhome': 172,
            'volumemute': 173,
            'volumedown': 174,
            'volumeup': 175,
            'mediatracknext': 176,
            'mediatrackprevious': 177,
            'mediastop': 178,
            'mediaplaypause': 179,
            'mediaselect': 181, // enter
            'mediaback': 182,
            'backslash': 220
        };
        this.lists = {};
        this.active = null;
        this.pressed = {};
        this.isStarted = false;
    }

    getKey(type, maskObj) {
        var key = type;

        if (maskObj.ctrl) { key += '_ctrl'; }
        if (maskObj.alt) { key += '_alt'; }
        if (maskObj.shift) { key += '_shift'; }

        var keyMaker = function (key, which) {
            if (which && which !== 16 && which !== 17 && which !== 18) { key += '_' + which; }
            return key;
        };

        if (Array.isArray(maskObj.which)) {
            var keys = [];
            maskObj.which.forEach(function (which) {
                keys.push(keyMaker(key, which));
            });
            return keys;
        } else {
            return keyMaker(key, maskObj.which);
        }
    }

    isNumeric(n) {
        return !!String(n).match(new RegExp('^[0-9]+$'));
    }

    getMaskObject(mask) {
        var obj = {};
        var items = mask.split('+');

        items.forEach(function (item) {
            if (item === 'ctrl' || item === 'alt' || item === 'shift') {
                obj[item] = true;
            } else {
                obj.which = this.specials[item] || (this.isNumeric(item) ? item : item.toUpperCase().charCodeAt());
            }
        }, this);

        return obj;
    }

    checkIsInput(target) {
        var name = target.tagName.toLowerCase();
        var type = target.type;
        return (name === 'input' && ['text', 'password', 'file', 'search', 'range'].indexOf(type) > -1) || name === 'textarea';
    }

    run(type, e) {
        if (!this.active) { return; }

        var maskObj = {
            ctrl: e.ctrlKey,
            alt: e.altKey,
            shift: e.shiftKey,
            which: e.which
        };

        var key = this.getKey(type, maskObj);
        var shortcuts = this.active[key];

        if (!shortcuts) { return; }

        var isInput = this.checkIsInput(e.target);
        var isPrevented = false;

        shortcuts.forEach(function (shortcut) {
            if (!isInput || shortcut.enableInInput) {
                if (!isPrevented) {
                    e.preventDefault();
                    isPrevented = true;
                }
                shortcut.handler(e);
            }
        });
    }

    start(list) {
        list = list || 'default'
        this.active = this.lists[list]
        if (this.isStarted) return
        this.keydownListener = e => {
            if (!this.pressed[e.which]) {
                this.run('down', e)
            }
            this.pressed[e.which] = true
            this.run('hold', e)
        }
        this.keyupListener = e => {
            this.pressed[e.which] = false
            this.run('up', e)
        }
        document.addEventListener('keydown', this.keydownListener)
        document.addEventListener('keyup', this.keyupListener)
        this.isStarted = true
        return this
    }

    stop() {
        document.removeEventListener('keydown', this.keydownListener)
        document.removeEventListener('keyup', this.keyupListener)
        this.isStarted = false
        return this
    }

    add(params) {
        if (!params.mask) { throw new Error("this.handler.add: required parameter 'params.mask' is undefined."); }
        if (!params.handler) { throw new Error("this.handler.add: required parameter 'params.handler' is undefined."); }

        var type = params.type || 'down';
        var listNames = params.list ? params.list.replace(/\s+/g, '').split(',') : ['default'];

        listNames.forEach(function (name) {
            if (!this.lists[name]) { this.lists[name] = {}; }
            var list = this.lists[name];
            var masks = params.mask.toLowerCase().replace(/\s+/g, '').split(',');

            masks.forEach(function (mask) {
                var maskObj = this.getMaskObject(mask);
                var keys = this.getKey(type, maskObj);
                if (!Array.isArray(keys)) { keys = [keys]; }
                keys.forEach(function (key) {
                    if (!list[key]) { list[key] = []; }
                    list[key].push(params);
                });
            }, this);
        }, this);

        return this;
    }

    remove(params) {
        if (!params.mask) { throw new Error("this.handler.remove: required parameter 'params.mask' is undefined."); }

        var type = params.type || 'down';
        var listNames = params.list ? params.list.replace(/\s+/g, '').split(',') : ['default'];

        listNames.forEach(function (name) {
            if (!this.lists[name]) { return true; }
            var masks = params.mask.toLowerCase().replace(/\s+/g, '').split(',');

            masks.forEach(function (mask) {
                var maskObj = this.getMaskObject(mask);
                var keys = this.getKey(type, maskObj);
                if (!Array.isArray(keys)) { keys = [keys]; }

                keys.forEach(function (key) {
                    delete this.lists[name][key];
                }, this);
            }, this);
        }, this);

        return this;
    }
}
