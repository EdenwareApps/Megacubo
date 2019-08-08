
/*
// before 14.4.5 changes

scan(scope) | return [{scope: scope, element: video}, ...] from scanFrame recursively
called from run()
Receive a window scope and call scanFrame in that, after it joins the scanFrame() results of each of his frames. Return a recursive list of objects.

scanFrame(scope) | return {objects:[],frames:[]} not recursively
called from scan()
Receive a window scope return a non-recursive list of objects and frames.

run(scope) | return {scope: window, element: video} from scan() + filterlevels
called from start()
Receive a window scope, call scan() to get a recursive list of objects and run them against filter levels to get the most appropriate. Returns the winner object and his scope.

start(contentWindow) | returns {scope: window, element: video} from run()
called from playback.js
Receive a window scope and match him against hosts filters, if a filter is available for the domain it returns his results, if not, call run() on the scope and return the recursive list of objects. Return a winner object and his scope for playback.js.

*/

var doFindStreams = (scope, intent, callback) => {
    var self = {}, _pl = false, lastGenericDiscovering = false;
    if(!scope || !scope.document){
        return;
    }
    self.absolutize = (() => {
        // this prevents any overhead from creating the object each time
        var a = scope.document.createElement('a'), m = scope.document.createElement('img');
        return ((url) => {
            if ((typeof url)!='string' || url.match(new RegExp("^(about|res|javascript|#):","i")) || url.match(new RegExp("<[A-Za-z]+ ","i"))){
                return scope.document.URL
            }
            if (url.match(new RegExp("^(mms|rtsp|rtmp|http)s?://"))){
                return url
            }
            a.href = url;
            if ((typeof a.href)=='string' && new RegExp("^[a-z]{2,7}:\/\/").test(a.href)){
                return a.href
            } else {
                try{
                    m.src = url
                    return m.src
                }catch(e){}
                return url
            }
        })
    })()
    self.stripSlashes = function (str) {
        return (str + '').replace(/\\(.?)/g, function (s, n1) {
        switch (n1) {
        case '\\':
            return '\\';
        case '0':
            return '\u0000';
        case '':
            return '';
        default:
            return n1;
        }
        });
    }
    self.src = function (o){
        if(typeof o != 'string'){
            var uri = false;
            var flashvars = false;
            var t = tag(o);
            if(t=='object')
                {
                    try
                        {
                            var p = o.getElementsByTagName('param');
                            for(var i=0;i<p.length;i++)
                                {
                                    var n = (p[i].name||'').toLowerCase();
                                    if(n=='movie'||n=='src'||n=='filename'||n=='url')
                                        {
                                            if(!uri)
                                                {
                                                    uri = p[i].value;
                                                }
                                        }
                                }
                        }
                    catch(e){};
                }
            if(t=='video')
                {
                    try
                        {
                            var p = o.getElementsByTagName('source');
                            for(var i=0;i<p.length;i++)
                                {
                                    var s = (p[i].src||'').toLowerCase();
                                    if(s)
                                        {
                                            if(!uri)
                                                {
                                                    uri = s;
                                                }
                                            break;
                                        }
                                }
                        }
                    catch(e){}
                }
            if(!uri)
                {
                    try
                        {
                            if(o['src'])
                                {
                                    uri = o.src;
                                }
                        }
                    catch(e){}
                }
            if(!uri)
                {
                    try
                        {
                            if(o['data'])
                                {
                                    uri = o.data;
                                }
                        }
                    catch(e){};
                }
            if((typeof uri) != 'string')
                {
                    return '';
                }
            return uri.match(new RegExp('^(about|res)'))?uri:self.absolutize(uri);
        }
        return self.absolutize(o);
    }
    self.findInstances = function (e, classes, maxlevel){
        var results = [];
        if(maxlevel){
            for(var key in e){
                if(typeof(e[key]) == 'object' && e[key] && results.indexOf(e[key])==-1){
                    var ok = false;
                    for(var i in classes){
                        if(e[key] instanceof classes[i]){
                            ok = true;
                            results.push(e[key]);
                            break;
                        }
                    }
                    /*
                    if(!ok){
                        try{
                            results.concat(findInstances(e[key], classes, maxlevel - 1));
                        }catch(e){
                        }
                    }
                    */
                }
            }
        }
        return results;
    }    
    self.scripts = function (all){
        var blocks = [];
        var s = scope.document.getElementsByTagName('script');
        for(var i=0;i<s.length;i++){
            if(s[i]['text'] && (all || s[i]['text'].match(new RegExp("(swf|play|jw|\$f|\\.setup|m3u8|mp4|rtmp|mms|embed|file=)","i")))){
                blocks.push(s[i]['text'].replace(new RegExp('\,[ \t\r\n\}]+\}', 'g'), '}'));
            }
        }
        return blocks;
    }
    self.fpRecoverPlayParametersAsObject = function (){
        if(typeof(flowplayer)=='undefined') return false;
        // var vrs = ['clip', 'hlsFix', 'hlsQualities', 'hostname', 'live', 'rtmp', 'swf', 'swfHls'];
        var map = {'src': 'file', 'completeUrl': 'file', 'netConnectionUrl': 'netConnectionUrl'}, gotcnf = false, ret = false, result = {}; //, 'suffix': 'type'};
        var l = flowplayer();
        if(typeof(l)=='object'){
            if(typeof(l.getClip)=='function'){
                l = [l.getClip()];
                gotcnf = true;
            } else {
                l = l.conf;
                if(typeof(l)=='object'){
                    l = l.clip;
                    if(typeof(l)=='object'){
                        l = l.sources;
                        gotcnf = true;
                    }
                }
            }
        }
        if(gotcnf){
            for(var i=0;i<l.length;i++){
                for(var key in map){
                    if(l[i][key]){
                        result[map[key]] = decodeURIComponent(l[i][key]);
                        ret = true;
                    }
                }
            }
        }
        if(ret) return result;
        // the last one should be the most compatible, the loop above will already consolidate the last one
        //alert(JSON.stringify(result));
    }
    
    self.flashvars = function (o){
        if(o){
            if(tag(o)=='object')
                {
                    var c = o.getElementsByTagName('param');
                    for (var j=0; j<c.length;j++)
                        {
                            var n = c[j].getAttribute('name');
                            if (n != null)
                                {
                                    if (n.toLowerCase()=='flashvars')
                                        {
                                            return c[j].getAttribute('value');
                                        }
                                }
                        }
                }
            try
                {
                    var f = o.getAttribute('flashvars');
                    if((typeof f)=='string')
                        {
                            return f;
                        }
                }
            catch(e){};
            try
                {
                    var f = src(o);
                    if((typeof f)=='string')
                        {
                            var pos = f.indexOf('?');
                            if(pos==-1) return '';
                            return f.substr(pos+1);
                        }
                }
            catch(e){}
        }
        return '';
    }
    
    self.inlineObjectsFlashvars = function (){
        var blocks = [];
        var t, s = scope.document.querySelectorAll('video,object,embed');
        for(var i=0;i<s.length;i++)
            {
                t = self.flashvars(s[i]);
                if(t)
                    {
                        blocks.push(t);
                    }
            }
        return blocks;
    }

    self.extractFlashVar = function (content, _arg){
        var absVars = ['file', 'netstreambasepath', 'streamer', 'playlist', 'image'];
        content = " "+content.replace(new RegExp('[\t\r\n]', 'gm'), ' ');
        var regexes = [
            '[^A-Za-z0-9\/]'+_arg+'[ \'"=,:]+([^ \'"]*)',
            '[^A-Za-z0-9\/]'+_arg+'[ \'"=,:]+([^ \'"&]*)' // can bad match URLs with "&" inside, last resort only
        ]; // without ":" will break some detections (inline js)
        for(var i=0;i<regexes.length;i++){
            var u, m = content.match(new RegExp(regexes[i], 'gim'));
            if(m){
                for(var i=0;i<m.length;i++){
                    u = m[i].replace("'", '"');
                    if(u.indexOf('"')!=-1){
                        u = u.split('"');
                        u = u[u.length-1];
                    }
                    if(u.indexOf("'")!=-1){
                        u = u.split("'");
                        u = u[u.length-1];
                    }
                    if(!u.match(new RegExp('^[a-z]*:?\/\/[^\/]+'))){
                        u = u.split('=');
                        u = u[u.length-1];
                    }
                    if(u && u.length && !u.match(new RegExp('\.(png|gif|bmp|srt|vtt|jpe?g)', 'i'))){
                        console.log('[FITTER] extractVar('+_arg+') '+u +' :: '+content.substr(0, 64)+'...');
                        if(absVars.indexOf(_arg)!=-1){
                            u = self.absolutize(u);
                        }
                        console.log('[FITTER] extractVar('+_arg+')* '+u);
                        return u;
                    }
                }
            }
        }
        return false;
    }

    self.isJW = function (change){
        if(change){
            if(change == 'delete'){
                delete(scope['jwplayer']);
                scope['jwinst'] = false;
            } else {
                scope['jwinst'] = change;
            }
            return scope['jwinst'];
        }
        if(typeof(scope['jwinst']) != 'undefined'){
            return scope['jwinst'];
        }
        if((typeof scope.jwplayer)=='function'){
            var j = scope.jwplayer();
            if(j && typeof(j.getContainer)=='function'){
                scope['jwinst'] = j;
                return j;
            }
        }
        return false;
    }

    self.isJWCompatible = function (){
        var j = self.isJW();
        return (typeof(j)=='object' && !j['getContainer'])?j:false; // if yes, it's the JW6 or major
    }

    self.isJWNotCompatible = function (){
        var j = self.isJW();
        return (typeof(j)=='object' && j['getRenderingMode'])?j:false; // if yes, it's the JW6 or major
    }
    self.jwRecoverPlayParametersAsObject = function (){
        
        var vrs = ['file', 'netstreambasepath', 'streamer', 'type', 'playlist', 'key', 'provider', 'mediaid', 'image'];
        if(j = self.isJW()){
            if(typeof(j.getPlaylistItem)=='function'){
            
                var l = false;
                try{
                    l = j.getPlaylistItem();
                }catch(e){};
                if(typeof(l)=='object'){
                    var ret = false, result = {};
                    if(l['sources']){
                        l = l['sources'][0];
                    }
                    for(var j=0;j<vrs.length;j++){
                        if(l[vrs[j]]){
                            result[vrs[j]] = decodeURIComponent(l[vrs[j]]);
                            ret = true;
                        }
                    }
                    if(ret){ 
                        return result;
                    }
                }
                
                var l = false;
                try{
                    l = j.getPlaylist();
                }catch(e){};
                if(typeof(l)=='object'){
                    var ret = false, result = {};
                    for(var i=0;i<l.length;i++){
                        if(l[i]['sources']){
                            l[i] = l[i]['sources'][0];
                        }
                        for(var j=0;j<vrs.length;j++){
                            if(l[i][vrs[j]]){
                                result[vrs[j]] = decodeURIComponent(l[i][vrs[j]]);
                                ret = true;
                            }
                        }
                        if(ret){ 
                            return result;
                        }
                    }
                }
                
            }
        }
        
        var m = self.scripts();
        if(!m || !m.length){
            m = self.inlineObjectsFlashvars();
        }
        
        //alert(9876);
        //alert(typeof(m));
        //console.log('[FITTER] FVRS:: '+m);
        if(typeof(m) == 'object' && m){ // array
            for(var i=0;i<m.length;i++){
                var f = self.extractFlashVar(m[i], 'file');
                if(f){ // has file=...
                    var jwo = {'file': f};
                    var s = self.extractFlashVar(m[i], 'streamer');
                    if(s){
                        jwo['streamer'] = s;
                        jwo['file'] = basename(jwo['file']);
                    } else {
                        s = self.extractFlashVar(m[i], 'netstreambasepath');
                        if(s){
                            jwo['netstreambasepath'] = s;
                            jwo['file'] = basename(jwo['file']);
                        }
                    }
                    return jwo;
                    break;
                }
            }
        }        
    }    
    function ino(el){ // inner object
        var t = tag(el);
        if(!t.match(new RegExp('^(object|embed|video|audio|iframe)$', 'i'))){
            var ino = scope.document.querySelectorAll(el);
            if(ino.length){
                return ino[0];
            }
        }
        return el;
    }
    self.html = function (o){
        try {
            o = (o.outerHTML||o.innerHTML||(""+o));
            if((typeof o)=='string') {
                return o;
            }
        } catch(e) {};
        return '';
    }
    self.sizes = function (o){
        var w=0, h = 0, a, b, c;
        if(o && o!=scope && o!=scope.document.querySelector('body')){
            if(o.getBoundingClientRect){
                try	{
                    var c = o.getBoundingClientRect();
                    if(c && (typeof c.right)=="number"){
                        w = c.right - c.left;
                        h = c.bottom - c.top;
                    }
                }catch(e){};
            }
            if(!w || !h || (w>10000 && h>10000)){ // IE bug on getBounding..., returning 30000 instead of 300
                var v = function (v){return (v&&v!='0'&&!v.match(new RegExp("(%|em|pt)")));}
                w = String(o.offsetWidth);
                h = String(o.offsetHeight);
                if(!v(w)) w = String(o.width);
                if(!v(h)) h = String(o.height);
                if(!v(w)) w = String(o.scrollWidth);
                if(!v(h)) h = String(o.scrollHeight);
                if(!v(w)) w = String(o.clientWidth);
                if(!v(h)) h = String(o.clientHeight);
                if(!v(w)) w = String(o.style.width);
                if(!v(h)) h = String(o.style.height);
                w = parseInt(w.replace(/[^0-9]/,''));
                h = parseInt(h.replace(/[^0-9]/,''));
                if(isNaN(w)) w = 0;
                if(isNaN(h)) h = 0;
            }
        } else {
            var w=0, h = 0;
            if (typeof scope.innerWidth != 'undefined'){
                w = scope.innerWidth;
                h = scope.innerHeight;
            } else if (typeof scope.document.scope.documentElement != 'undefined' && (typeof scope.document.documentElement.clientWidth) != 'undefined' && scope.document.documentElement.clientWidth != 0) {
                w = scope.document.documentElement.clientWidth;
                h = scope.document.documentElement.clientHeight;
            } else {
                var b = scope.document.querySelector('body');
                w = b.clientWidth;
                h = b.clientHeight;
            }
            if(w && h){
                scope['lsizes'] = {width:w,height:h};
            } else if(scope['lsizes']) {
                return scope['lsizes'];
            }
        }
        return {width:parseInt(w),height:parseInt(h)};
    }
    self.offset = function (element){
        var de = scope.document.documentElement;
        var box = element.getBoundingClientRect();
        var top = box.top + scope.pageYOffset - de.clientTop;
        var left = box.left + scope.pageXOffset - de.clientLeft;
        return { top: top, left: left };
    }
    self.validateStream = function (src){
        return src.match(new RegExp('^[a-z]*:?\/\/[^\/]+'));	
    }    
    self.getBiggerString = function (arr)	{
        if(typeof(arr)=='object' && arr.length){
            var maxLen = 0, maxKey = false;
            for(var i in arr){
                if(maxKey === false || (typeof(arr[i])=='string' && arr[i].length > maxLen)){
                    maxLen = (typeof(arr[i])=='string') ? arr[i].length : 0;
                    maxKey = i;
                }
            }
            if(maxKey !== false){
                return arr[maxKey];
            }
        }
        return false;
    }
    self.findStreamOnText = function (content, includeMedia){
        var src = false;
        if(!src){
            var dstub = 0, stub = content;
            var t = includeMedia ? '(mp4|flv|avi|mkv|m3u8)' : '(m3u8)';
            var r = new RegExp('h?t?t?p?s?:?\/\/[^"\'<>\\[\\]\t\r\n\?#]+\\.'+t+'[^"\'<>\\[\\]#\t\r\n ]*', 'gi');

            if(!src){
                var match = stub.match(r);
                if(match){
                    console.log('[FITTER] findStream method 3');
                    while(match.length){
                        for(var k in match){
                            match[k] = self.absolutize(match[k]);
                            if(!self.validateStream(match[k])){
                                delete match[k];
                            }
                        }
                        src = self.getBiggerString(match);
                        if(!src) break;
                        for(var k in match){
                            if(match[k]==src){
                                delete match[k];
                            }
                        }
                        if(src.indexOf(' ')!=-1){
                            src = src.replace(new RegExp(' ', 'g'), '');
                        }
                        if(src.indexOf('m3u8&')!=-1){
                            src = src.split('m3u8&')[0]+'m3u8';
                        }
                        if(src.indexOf('m3u8]')!=-1){
                            src = src.split('m3u8]')[0]+'m3u8';
                        }
                        if(src.indexOf(';http')!=-1){
                            src = 'http'+src.split(';http')[1];
                        }
                        if(src.indexOf(';rtmp')!=-1){
                            src = 'rtmp'+src.split(';rtmp')[1];
                        }
                        if(self.validateStream(src)){
                            console.log('[FITTER] src='+src);
                            break;
                        } else {
                            src = false;
                        }
                    }
                }
            }
            if(!src){
                if(!dstub) dstub = self.stripSlashes(decodeEntities(unescape(stub)));
                if(dstub){
                    var match = dstub.match(r);
                    if(match){
                        console.log('[FITTER] findStream method 4');
                        while(match.length){
                            for(var k in match){
                                match[k] = self.absolutize(match[k]);
                                if(!self.validateStream(match[k])){
                                    delete match[k];
                                }
                            }
                            src = self.getBiggerString(match);
                            if(!src) break;
                            for(var k in match){
                                if(match[k]==src){
                                    delete match[k];
                                }
                            }
                            if(src.indexOf(' ')!=-1){
                                src = src.replace(new RegExp(' ', 'g'), '');
                            }
                            if(src.indexOf('m3u8&')!=-1){
                                src = src.split('m3u8&')[0]+'m3u8';
                            }
                            if(src.indexOf('m3u8]')!=-1){
                                src = src.split('m3u8]')[0]+'m3u8';
                            }
                            if(src.indexOf(';http')!=-1){
                                src = 'http'+src.split(';http')[1];
                            }
                            if(src.indexOf(';rtmp')!=-1){
                                src = 'rtmp'+src.split(';rtmp')[1];
                            }
                            if(self.validateStream(src)){
                                break;
                            } else {
                                src = false;
                            }
                        }
                    }
                }
            }            
            r = new RegExp('(rtmp[set]?:\/\/[^\'"<>\\[\\]#\t\r\n ]*)', 'gi');
            if(!src){
                var match2 = stub.match(r);
                if(match2){
                    console.log('[FITTER] findStream method 7');
                    while(match2.length){
                        for(var k in match2){
                            match2[k] = self.absolutize(match2[k]);
                            if(!self.validateStream(match2[k])){
                                delete match2[k];
                            }
                        }
                        src = self.getBiggerString(match2);
                        if(!src) break;
                        for(var k in match2){
                            if(match2[k]==src){
                                delete match2[k];
                            }
                        }
                        if(src.indexOf(' ')!=-1){
                            src = src.replace(new RegExp(' ', 'g'), '');
                        }
                        if(self.validateStream(src)){
                            break;
                        } else {
                            src = false;
                        }
                    }
                }
            }
            if(!src){
                if(!dstub) dstub = self.stripSlashes(decodeEntities(unescape(stub)));
                if(dstub){
                    var match = dstub.match(r);
                    if(match){
                        console.log('[FITTER] findStream method 8');
                        while(match.length){
                            for(var k in match){
                                match[k] = self.absolutize(match[k]);
                                if(!self.validateStream(match[k])){
                                    delete match[k];
                                }
                            }
                            src = self.getBiggerString(match);
                            if(!src) break;
                            for(var k in match){
                                if(match[k]==src){
                                    delete match[k];
                                }
                            }
                            if(src.indexOf(' ')!=-1){
                                src = src.replace(new RegExp(' ', 'g'), '');
                            }
                            if(src.indexOf('&')!=-1){
                                src = src.split('&')[0];
                            }
                            if(self.validateStream(src)){
                                break;
                            } else {
                                src = false;
                            }
                        }
                    }
                }
            }
        }
        return src;
    }
    self.findStream = function (intent){
        var src = '';    
        if(typeof(scope.Clappr) != 'undefined' && typeof(scope.Clappr.Player) != 'undefined'){
            var cps = self.findInstances(scope, [scope.Clappr.Player], 9);
            for(var i in cps){
                try{
                    var s = cps[i].playerInfo.options.source;
                    if(s.indexOf('.m3u8')!=-1){
                        src = self.absolutize(s);
                    }
                } catch(e) { }
            }
        }
        if(typeof(scope.flowplayer) != 'undefined'){
            try{
                var s = scope.flowplayer().conf.clip.sources[0].src
                if(s) src = s;
            }catch(e){};
        }
        if(!src){
            var rgx = new RegExp('(^rtmp:|\.m3u8(\\?|$))');            
            var pro = self.jwRecoverPlayParametersAsObject();
            var fro = self.fpRecoverPlayParametersAsObject();            
            var stream = false;
            if(typeof(pro)=='object' && pro['file']){
                if(pro['streamer']){
                    pro['file'] = pro['streamer']+'/'+basename(pro['file']);
                } else if(pro['netstreambasepath']){
                    pro['file'] = pro['netstreambasepath']+'/'+basename(pro['file']);
                }
                if(pro['file'].match(rgx)){
                    console.log('[FITTER] findStream method 1');
                    src = pro['file'];
                }
            }            
            if(!src && typeof(fro)=='object' && fro['file']){
                if(fro['streamer']){
                    fro['file'] = fro['streamer']+'/'+basename(fro['file']);
                } else if(fro['netstreambasepath']){
                    fro['file'] = fro['netstreambasepath']+'/'+basename(fro['file']);
                }
                if(fro['file'].match(rgx)){
                    console.log('[FITTER] findStream method 2');
                    src = fro['file'];
                }
            }            
            if(!src){
                var b = scope.document.querySelector('body');
                if(b){
                    var html = b.innerHTML; // take whole HTML makes it too sensible, since JS may contain arrays of variated messages
                    var stub = scope.document.URL + ' ' + html + ' ' + self.scripts().join('');
                    //console.log('[FITTER] DEEPSEARCH', stub);
                    if(stub.match(new RegExp('(m3u8|rtmp|mp4|play|hls|live)', 'i'))){
                        src = self.findStreamOnText(stub, intent.streamType != 'live')
                    }
                }
            }
        }            
        return src;
    }    
    console.log('[FITTER] DOFINDSTREAMS', scope.document.URL || '');
    var stream = self.findStream(intent)
    if(stream){
        console.log('[FITTER] FOUNDSTREAM', stream);
        callback(stream);
    } else {
        console.log('[FITTER] NOSTREAMFOUND', scope.document.URL);
    }
    self = null;
}

var Fitter = (() => {
    var debug = debugAllow(false), self = {}, defaultStylizerRelevantTags = ['a', 'iframe', 'div'], stylizerRelevantTags = defaultStylizerRelevantTags;
    self.width = function (object){
        return object.offsetWidth || object.scrollWidth || object.outerWidth;
    }
    self.height = function (object){
        return object.offsetHeight || object.scrollHeight || object.outerHeight;
    }
    self.createRuleTarget = function (object, forceAttrs){
        var t = tag(object), c = t;
        if(1 || forceAttrs || stylizerRelevantTags.indexOf(t) != -1){
            var s = false;
            if(object.className){
                var match = object.className.match(new RegExp('(rand\-[0-9]+)'));
                if(match && match.length > 1){
                    s = match[1];
                }
            }
            if(!s){
                s = 'rand-' + parseInt(Math.random() * 1000000);
                object.className += ' ' + s;
            }
            c += '.'+s;
        }
        return c;
    }
    self.stylizerQueueCommit = function (scope){
        console.warn('[FITTER] STYLIZER', scope.stylizerQueue.hide);
        var showTarget = Array.from(new Set(scope.stylizerQueue.show)).join(', ');
        var hideTarget = Array.from(new Set(scope.stylizerQueue.hide)).join(', ');
        var css = `
        html, body { overflow: hidden; } 
        video::-webkit-media-controls-panel { background: rgba(43,51,63,.7); } 
        video::-webkit-media-controls-current-time-display, video::-webkit-media-controls-time-remaining-display { color: #ddd !important; } 
        video::-webkit-media-controls-mute-button, video::-webkit-media-controls-play-button, video::-webkit-media-controls-fullscreen-button { filter: brightness(2.4); cursor: pointer; }
        `
        if(showTarget){
            css += showTarget + '{ display: inline-flex !important; opacity: 1 !important; align-items: center; margin: 0 !important; pointer-events: all !important; z-index: 2147483647 !important; height: inherit !important; width: inherit !important; min-height: 100vh !important; min-width: 100vw!important; max-height: 100vh !important; max-width: 100vw !important; top: 0 !important; left: 0 !important; background-color: #000; } '
            var t = showTarget.replace(new RegExp('^ ?(object|video|embed)[^,]*,'), '')
            if(t){
                css += t + ' { position: fixed !important; } '
            }
            t = showTarget.match(new RegExp('^ ?video[^,]*'))
            if(t && t.length){
                css += t + ' { position: static !important; } '
            }
        }
        if(hideTarget){
            css += hideTarget+', '+hideTarget+' * '
            css += '{ position: absolute !important; top: -3000px !important; max-height: 10px !important; max-width: 10px !important; overflow: hidden !important; z-index: -1; } '
        }
        console.log('[FITTER] COMMIT', stylizerRelevantTags, css);
        try{
            if(scope.document){
                scope.document.querySelectorAll('link, style').forEach((s) => {
                    s.parentNode.removeChild(s)
                });
                stylizer(css, 'fitter', scope)
            }
        } catch(e) {
            console.error('[FITTER]', e)
        }
    }
    self.stylizerQueueReset = function (object, scope){
        scope.stylizerQueue = {show:[],hide:[]};
        stylizerRelevantTags = defaultStylizerRelevantTags;
        var t = '';
        while(object && (t = tag(object))){
            t = tag(object);
            if(stylizerRelevantTags.indexOf(t)==-1){
                stylizerRelevantTags.push(t);
            }
            object = object.parentNode;
        }
    }
    self.hide = function (object, scope){
        var t = tag(object);
        if(!t) return; //  || !height(object)) return;
        if(['video', 'html', 'body', 'head', 'script', 'style', 'link'].indexOf(t)==-1){
            scope.stylizerQueue.hide.push(self.createRuleTarget(object));
        }
    }
    self.fit = function (object, scope){
        if(!object || !tag(object)) return;
        var root = typeof(top.fittingQueue) == 'undefined' || !Array.isArray(top.fittingQueue)
        if(root){
            top.fittingQueue = []
        }
        scope.stylizerQueue.show.push(self.createRuleTarget(object, true));
        var p = object.parentNode, c = object;
        while(p && p!=document.documentElement){
            if(top.fittingQueue.indexOf(p) == -1){
                top.fittingQueue.push(p)
                self.fit(p, scope);
                var childrens = p.childNodes;
                for(var i=0; i<childrens.length; i++){
                    if(childrens[i] != c && (!childrens[i].id || ['player-status', 'video-controls'].indexOf(childrens[i].id) == -1)){
                        self.hide(childrens[i], scope);
                    }
                }
            }
            c = p;
            p = p.parentNode;
            if(!p || !tag(p) || ['html', 'head', 'body'].indexOf(tag(p))!=-1){
                break;
            }
        }
        if(root){
            console.log('[FITTER] Fit() done', traceback())
            top.fittingQueue = []
        }
    }
    self.outerFit = function (object, scope){
        if(!object || !tag(object)) return;
        //console.log('[FITTER] OUTERFIT START');
        if(typeof(scope.stylizerQueue) == 'undefined'){
            scope.stylizerQueue = {show:[],hide:[]};
            stylizerRelevantTags = defaultStylizerRelevantTags;
        }
        var p = object.parentNode, c = object;
        while(p && p != document.documentElement){
            //console.log('[FITTER] OUTERFIT');
            c = p;
            p = p.parentNode;
            if(!p || !tag(p) || ['html', 'head', 'body'].indexOf(tag(p))!=-1){
                break;
            }
        }
        for(var i=0; i<p.childNodes.length; i++){
            if(p.childNodes[i] == c){
                //console.log('[FITTER] OUTERFIT', p.childNodes[i]);
                if(p.childNodes[i].className){
                    p.childNodes[i].className = p.childNodes[i].className.replace(new RegExp('rand\-[0-9]+', 'g'));
                    //console.log('[FITTER] OUTERFIT', p.childNodes[i]);
                }
            } else {
                //console.log('[FITTER] OUTERFIT', p.childNodes[i]);
                self.hide(p.childNodes[i], scope)
            }
        }
        //console.log('[FITTER] OUTERFIT END', p.childNodes[i]);
        self.stylizerQueueCommit(scope)
    }
    self.getFrameElement = function (scope){
        if(scope.frameElement){
            return scope.frameElement;
        }
        if(scope.parent && scope.parent != scope){
            var frames = scope.parent.document.querySelectorAll('frame, iframe');
            if(frames.length == 1){
                return frames[0];
            }
            for(var i=0; i<frames.length; i++){
                if(frames[i].src == scope.document.URL){
                    console.log('[FITTER] Found parent frame by SRC.', frames[i].src, frames);
                    return frames[i];
                    break;
                }
            }
            for(var i=0; i<frames.length; i++){
                if(frames[i].contentWindow && (frames[i].contentWindow.document.URL == scope.document.URL)){
                    console.log('[FITTER] Found parent frame by URL.');
                    return frames[i];
                    break;
                }
            }
            var w = self.width(scope);
            for(var i=0; i<frames.length; i++){
                if(self.compare(w, self.width(frames[i]), 20)){
                    console.log('[FITTER] Found parent frame by approximated dimension.');
                    return frames[i];
                    break;
                }
            }
            var maxHeight = 0, maxKey = -1, h;
            for(var i=0; i<frames.length; i++){
                var h = self.height(frames[i]);
                if(h > maxHeight){
                    maxHeight = h;
                    maxKey = i;
                }
            }
            if(maxKey != -1){
                console.log('[FITTER] Found parent frame by biggest height.');
                return frames[maxKey];
            }
        }
    }
    self.fitParentFrames = function (scope){
        scope.onresize = null;
        var frameElement = self.getFrameElement(scope);
        if(frameElement){
            frameElement.setAttribute('allowFullScreen', '');
            self.stylizerQueueReset(frameElement, scope.parent);
            self.fit(frameElement, scope.parent);
            self.stylizerQueueCommit(scope.parent);
            if(scope.parent && scope.parent != scope){
                console.log('[FITTER] PARENT', scope, scope.parent, scope.document.URL, scope.parent.document.URL);
                self.fitParentFrames(scope.parent)
            }
        } else if(scope != top && scope != scope.parent){
            console.log('[FITTER] FAILED TO GET FRAME ELEMENT', scope)
        }
    }
    self.compare = function (a, b, tolerance){
        return b < (a + tolerance) && b > (a - tolerance) 
    }
    self.isDiscardable = function (object, intent){
        if(!object){
            console.log('[FITTER] Null video.');
            return true;
        }
        if(typeof(object)!='object'){
            console.log('[FITTER] Video discarded by type ('+typeof(object)+').');
            return true;
        }
        if(tag(object)=='video'){
            object.muted = true;
            if(!object.currentSrc){
                console.log('[FITTER] Video discarded due to empty src.');
                return true;
            }
            if(object.paused && object.currentSrc.indexOf('blob:')==-1){
                object.play()
            }
        }
        if(object.scrollTop && object.scrollTop > 800){
            if(tag(object)=='video'){
                console.log('[FITTER] Video discarded by offset');
            }
            return true;
        }
        var w = self.width(object), h = self.height(object);
        if(w < 200 || h < 100) { // 320x240 is miniplayer
            if(tag(object)=='video'){
                console.log('[FITTER] Video discarded by size: '+w+'x'+h+'.');
            }
            return true; 
        }
        var tolerance = 4, formats = [
            {w:300,h:250},
            {w:300,h:300},
            {w:300,h:600},
            {w:200,h:200},
            {w:250,h:250},
            {w:336,h:280},
            {w:160,h:600},
            {w:468,h:60},
            {w:728,h:90}
        ];
        for(var i=0;i<formats.length;i++){
            if(self.compare(w, formats[i].w, tolerance) && self.compare(h, formats[i].h, tolerance)){
                if(tag(object)=='video'){
                    console.log('[FITTER] Video discarded by size*: '+w+'x'+h+' '+formats[i].w+'x'+formats[i].h+'.');
                }
                return true;
            }
        }
    }
    self.objectContainer = function (videoObjectOrEmbed){
        // checa a altura dos parentNodes e retorna o container diferente de body que tem a mesma altura do vídeo, com uma pequena margem de tolerância (20px).
        var object = videoObjectOrEmbed, h = height(object);
        while(videoObjectOrEmbed && videoObjectOrEmbed != document.body){
            var p = videoObjectOrEmbed.parentNode;
            if(!p || !p['tagName']) break;
            if(['body', 'html'].indexOf(p['tagName'].toLowerCase())!=-1) break;
            if(!self.compare(height(p), h, 20)) break;
            videoObjectOrEmbed = p;
        }
        return videoObjectOrEmbed;
    }
    self.scanFrame = function (scope, intent, frameObject, frameNestingLevel){
        // retorna para o main, no return da função, os objetos encontrados e seus scopes.
        if((!frameNestingLevel || frameNestingLevel < 10) && !self.isDiscardable(scope, intent) && (!frameObject || !self.isDiscardable(frameObject, intent))){
            var s, details = {videos:[],frames:[]}, videos = scope.document.querySelectorAll('video'), minScroll = -1; // object, embed, 
            for(var i=0; i < videos.length; i++){
                self.watchVideo(videos[i], intent);
                var s = jQuery(videos[i]).offset().top;
                if(s >= 0 && (minScroll == -1 || s < minScroll)){
                    minScroll = s;
                }
                if(!self.isDiscardable(videos[i], intent)){
                    if(!videos[i].currentTime && videos[i].src && videos[i].paused){
                        videos[i].play()
                    }
                    if(videos[i].duration < Config.get('min-buffer-secs-before-commit')){
                        console.log('[FITTER] Video pos-discarded by duration (paused='+videos[i].paused+', currentTime='+videos[i].currentTime+', duration='+videos[i].duration+').');
                        continue;
                    } else {
                        details.videos.push(videos[i])
                    }
                }
            }
            var frames = scope.document.querySelectorAll('iframe, frame');
            for(var i=0; i < frames.length; i++){
                if(!self.isDiscardable(frames[i], intent)){
                    var s = jQuery(frames[i]).offset().top;
                    if(s >= 0 && (minScroll == -1 || s < minScroll)){
                        minScroll = s;
                    }
                    details.frames.push(frames[i]);
                }
            }
            if(minScroll!=-1){
                if(debug){
                    console.log('[FITTER] MINSCROLL', minScroll, scope.document.documentElement.scrollTop, scope.document.URL)
                }
                if(minScroll > scope.document.documentElement.scrollTop){
                    scope.scrollTo(0, minScroll)
                }
            }
            return details;
        }
    }
    self.scan = function (scope, intent){
        var file, domains, list = [], domain = scope.document.domain, domains = Object.keys(top.preFitterIndex);
        for(var i=0; i<domains.length; i++){
            if(domain.indexOf(domains[i])==0 || domain.indexOf('.'+domains[i])!=-1){
                file = top.preFitterIndex[domains[i]];
                break;
            }
        }
        if(file){
            if(debug){
                console.log('[FITTER] PREFITTER MODULE MATCHED', file, scope.document.URL)
            }
            var listItem = require(file)(scope, intent, self, top)
            if(debug){
                console.log('[FITTER] PREFITTER MODULE RETURNED', listItem)
            }
            if(listItem && typeof(listItem)=='string') { // if returns a string should be a redirect URL
                if(debug){
                    console.log('[FITTER] PREFITTER REDIRECT', listItem)
                }
                scope.location.href = listItem;
                return false;
            } else if(listItem === true){
                if(debug){
                    console.log('[FITTER] PREFITTER MODULE FORWARDED TO DISCOVERY returning true', listItem)
                }
            }
        } else {
            if(debug){
                console.log('[FITTER] NO PREFITTER', domain, scope.document.URL);
            }
        }
        if(listItem && typeof(listItem)=='object' && listItem.element){
            return [listItem];
        }
        if(scope.unloadOnSideload){
            self.findStreams(scope, intent, (streamURL) => {
                intent.sideloadAdd(streamURL)
                scope.location.href = 'about:blank'
            })
            return []
        }
        var details = self.scanFrame(scope, intent);
        var list = [];
        if(details){
            for(var i=0; i<details.videos.length; i++){
                list.push({scope: scope, element: details.videos[i]})
            }
            for(var i=0; i<details.frames.length; i++){
                self.watchFrame(details.frames[i], intent);
                try{
                    var objects = self.scan(details.frames[i].contentWindow, intent); // scan instead of scanFrame, to run hosts files
                    if(objects.length){
                        list = list.concat(objects)
                    }
                } catch(e){
                    console.log('[FITTER]', e)
                }
            }
        }
        if(debug){
            console.log('[FITTER] PREFITTER SCAN RESULT', domain, list)
        }
        return list;
    }
    self.findStreams = function (scope, intent, callback){
        doFindStreams(scope, intent, callback);
        var frames = scope.document.querySelectorAll("iframe, frame");
        for(var i=0; i<frames.length; i++){
            var c, w = false;
            try {
                c = frames[i].contentWindow;
                c = c.document;
            } catch(e) {
                w = false;
                console.warn('[FITTER]', e)
            }
            if(w){
                self.findStreams(w, intent, callback)
            }
        }
    }
    self.isVisible = function (elm) {
        if(!elm.offsetHeight && !elm.offsetWidth) { return false; }
        if(getComputedStyle(elm).visibility === 'hidden') { return false; }
        return true;
    }
    self.prepare = function (data){
        if(!data){
            console.error('[FITTER] BAD DATA', data, traceback());
            return;
        }
        if(!data.scope || !data.scope.document){
            data.scope = data.element.ownerDocument.defaultView;
        }
        if(!data.scope || !data.scope.document){
            console.error('[FITTER] BAD SCOPE', data, traceback());
            return;
        }
        var tg = tag(data.element), unfocus = function (e){
            var target = e.srcElement;
            if(!target || typeof(target['tagName'])=='undefined' || ['input', 'textarea'].indexOf(target['tagName'].toLowerCase())==-1){
                //console.log(e);
                console.log('[FITTER] REFOCUS(*)');
                top.window.focus()
            }
        }
        if(!data.element.parentNode) {
            data.scope.document.querySelector('body').appendChild(data.element) //Failed to read the 'buffered' property from 'SourceBuffer': This SourceBuffer has been removed from the parent media source.
        }
        top.enableEventForwarding(data.scope, unfocus);
        data.scope.__fitted = true;
        console.log('[FITTER] PREPARE', data);
        if(['html', 'body'].indexOf(tg) == -1){
            self.stylizerQueueReset(data.element, data.scope);
            self.fit(data.element, data.scope);
            self.stylizerQueueCommit(data.scope)
        }
        self.fitParentFrames(data.scope);
        if(tg == 'video'){
            data.element.removeAttribute('style')
        }
        return data;
    }
    self.run = function (scope, intent){
        var list = self.scan(scope, intent);
        if(debug){
            console.log('[FITTER] PRELIST', scope.document.URL, list)
        }
        var Filters = [
            function (o){
                var n = [], debug=false;
                for(var i=0;i<o.length;i++){
                    if(!self.isDiscardable(o[i].element, intent)){
                        s = o[i].element.src;
                        if(intent.streamType != 'video' && s.match(new RegExp('([\.=]m3u8|blob:|rtmp:|=rtmp)', 'i'))){
                            n.push(o[i])
                        } else if(intent.streamType != 'live' && s.match(new RegExp('[\.=](mp4|mp3|acc|webm|ogv)', 'i'))){
                            n.push(o[i])
                        }
                    }
                }
                return n;
            },
            function (o){
                var n = [];
                for(var i=0;i<o.length;i++){
                    if(o[i].currentTime > 0 || o[i].autoplay){
                        n.push(o[i]);
                    }
                }
                return n;
            },
            function (o){
                var n = [];
                for(var i=0;i<o.length;i++){
                    var s = (o[i].element.src||'').split('?')[0];
                    if(s && !s.match(new RegExp('[\./\\-,\?]ad[A-Za-z0-9]{0,8}[\./\\-,\?]', 'i'))){
                        n.push(o[i]);
                    }
                }
                return n;
            },
            function (o){
                o = o.sort((a, b) => {
                    var c = (a.element.paused || a.element.muted) ? 0 : (a.element.duration || 0), d = (b.element.paused || b.element.muted)  ? 0 : (b.element.duration || 0);
                    if(c < d) return 1;
                    if(c > d) return -1;
                    return 0;
                });
                return o;
            }
        ];
        var o = Filters[0](list);
        for(var i=1; (list.length > 1 && i < Filters.length); i++){
            o = list;
            try{
                o = Filters[i](list);
                if(o.length){
                    list = o;
                }
            }catch(e){
                console.log('[FITTER] Discover error at level '+i, e)
            }
            console.log('[FITTER] Discover level: '+i+', objs: '+list.length);
        }
        if(debug){
            console.log('[FITTER] POSLIST', scope.document.URL, list)
        }
        if(list.length){
            return list[0]
        } else if(typeof(scope.allowSearchStreamInCode)=='undefined' || scope.allowSearchStreamInCode !== false) {
            self.findStreams(scope, intent, (streamURL) => {
                intent.sideloadAdd(streamURL)
            })
            scope.allowSearchStreamInCode = false; // search in code once
        }
        return false;
    }
    self.watchVideo = (video, intent) => {
        //if(debug){
        //    console.warn('[FITTER] PREFITTER WATCH VIDEO', video.ownerDocument.URL, video, video.src, intent, intent.runFitter)
        //}
        jQuery(video).off('timeupdate').one('timeupdate', (event) => {
            intent.runFitter(); // tricky delay, recall the processing
            if(debug){
                console.warn('[FITTER] PREFITTER DURATION CHANGED OK', video.ownerDocument.URL, video, video.duration, intent, intent.runFitter)
            }
        })
    }
    self.watchFrame = (frame, intent) => {
        var innerScope = false;
        try {
            if(frame.contentWindow.document){
                innerScope = frame.contentWindow;
            }
        } catch (e) {}
        if(innerScope){
            if(innerScope.document.readyState.match(new RegExp('(complete|interactive)'))){
                if(debug){
                    //console.warn('[FITTER] WAITFRAME', innerScope.document.URL, time())
                }
                self.watchScope(innerScope, intent)
            } else {
                innerScope.document.onreadystatechange = () => {
                    self.watchFrame(frame, intent)
                }
            }
        } else {
            setTimeout(() => {
                if(frame && intent && intent.allowFitter && intent.allowFitter()){
                    self.watchFrame(frame, intent)
                }
            }, 400)
        }
    },
    self.framesHash = (scope, intent) => {
        var hash = '';
        scope.document.querySelectorAll('iframe, frame, video').forEach((frame) => {
            hash += frame.src + ' '+ frame.currentTime || '0';
        });
        return hash;
    },
    self.watchScope = (scope, intent) => {
        if(!scope.watchingTimer && scope.document){
            scope.watchingTimer = 1;
            scope.onerror = (e) => {
                console.error('[FITTER]', scope.document.URL, e);
                return true;
            }
            if(debug){
                console.warn('[FITTER] PREFITTER MUTATION SETUP', (scope.document) ? scope.document.URL : 'blank')
            }
            var hash = self.framesHash(scope, intent);
            var observer = new scope.MutationObserver((mutations) => {
                if(scope.watchingTimer){
                    clearTimeout(scope.watchingTimer)
                }
                scope.watchingTimer = scope.setTimeout(() => {
                    if(debug){
                        console.warn('[FITTER] PREFITTER MUTATION')
                    }
                    observer.disconnect();
                    if(!intent.error && !intent.ended && !intent.getVideo()){
                        var nhash = self.framesHash(scope, intent);
                        if(nhash != hash){
                            if(debug){
                                console.warn('[FITTER] PREFITTER MUTATION SUCCESS', scope.document.URL, nhash, hash, intent)
                            }
                            hash = nhash;
                            intent.runFitter();
                            observer.observe(scope.document, {attributes: false, childList: true, characterData: false, subtree:true})
                        }
                    } else {
                        if(debug){
                            console.warn('[FITTER] PREFITTER MUTATION OFF', (scope.document) ? scope.document.URL : 'blank')
                        }
                    }
                }, 50)
            });
            observer.observe(scope.document, {attributes: false, childList: true, characterData: false, subtree:true});
            if(debug){
                console.warn('[FITTER] PREFITTER MUTATION SETUP OK')
            }
        }
    }
    self.scopeToDocument = function (scope) {
        var doc = false;
        try {
            doc = scope.document;
        } catch(e) { }
        return doc ? doc : false;
    },
    self.start = function (scope, intent){
        var doc = self.scopeToDocument(scope)
        if(debug){
            console.log('[FITTER] PREFITTER RUN', (scope.document) ? scope.document.URL : 'blank');
        }
        if(!scope || !doc || !intent || !intent.allowFitter || !intent.allowFitter()){
            return false;
        }
        if(debug){
            console.log('[FITTER] PREFITTER RUN', (scope.document) ? scope.document.URL : 'blank')
        }
        var list = self.run(scope, intent)
        if(debug){
            console.log('[FITTER] PREFITTER RUN OK', list, (scope.document) ? scope.document.URL : 'blank')
        }
        if(list && typeof(list)=='object' && list.element){ // if returns a object, should be {element:videoElement, scope:videoElementWindow}
            if(debug){
                console.log('[FITTER] PREFITTER PREPARE', list, (scope.document) ? scope.document.URL : 'blank')
            }
            try{
                if(intent.fitterCallback(list)){
                    // console.warn('PREPPAREDDDDDDDDDD!!!!!!!!!');
                    self.prepare(list)
                }
            } catch(e) {
                console.error('[FITTER]', e, 'catched')
            }
        } else {
            self.watchScope(scope, intent)
        }
    }
    if(!top.preFitterIndex){
        top.preFitterIndex = {};
        var files = fs.readdir('hosts', (err, files) => {
            if(Array.isArray(files)){
                for(var i=0; i<files.length; i++){
                    let domains = files[i].replace('.js', '').split(',')
                    for(var j=0; j<domains.length; j++){
                        top.preFitterIndex[domains[j]] = './hosts/'+files[i];
                    }
                }
            } else {
                console.error('[FITTER] Failed to read /hosts.')
            }
        })
        if(debug){
            console.log('[FITTER] PREFITTERINDEX', top.preFitterIndex)
        }
    }
    return self;
})();
    



