
var findStreams = function (scope){
    var filters = {}, _pl = false, lastGenericDiscovering = false, window = scope;
    function addFilter(hook, callback){
        if(typeof(filters[hook])=='undefined'){
            filters[hook] = [];
        }
        filters[hook].push(callback);
    }    
    function applyFilters(hook){
        var as = Array.prototype.slice.call(arguments).slice(1);
        if(typeof(filters[hook])!='undefined'){
            for(var i=0;i<filters[hook].length;i++){
                as[0] = filters[hook][i].apply(this, as);
            }
        }
        return as[0];
    }    
    var decodeEntities = (function() {
        // this prevents any overhead from creating the object each time
        var element = window.document.createElement('div');

        // regular expression matching HTML entities
        var entity = new RegExp('&(?:#x[a-f0-9]+|#[0-9]+|[a-z0-9]+);?', 'gi');

        return (function (str) {
            // find and replace all the html entities
            str = str.replace(entity, function(m) {
                element.innerHTML = m;
                return element.textContent;
            });

            // reset the value
            element.textContent = '';

            return str;
        });
    })();    
    var absolutize = (function() {
        // this prevents any overhead from creating the object each time
        var a = window.document.createElement('a'), m = window.document.createElement('img');
        return (function (url) {
            if ((typeof url)!='string' || url.match(new RegExp("^(about|res|javascript|#):","i")) || url.match(new RegExp("<[A-Za-z]+ ","i"))){
                return window.document.URL;
            }
            if (url.match(new RegExp("^(mms|rtsp|rtmp|http)s?://"))){
                return url;
            }
            a.href = url;
            if ((typeof a.href)=='string' && new RegExp("^[a-z]{2,7}:\/\/").test(a.href)){
                return a.href;
            } else {
                try{m.src = url;return m.src;}catch(e){};
                return url;
            }
        });
    })();
                    
    function time(){
        return ((new Date()).getTime()/1000);
    }

    function tag(el){
        return (el&&el.tagName)?el.tagName.toLowerCase():'';
    }
    
    function basename(str){
        var base = new String(str).substring(str.lastIndexOf('/') + 1); 
        if(base.lastIndexOf(".") != -1){
            base = base.substring(0, base.lastIndexOf("."));
        }
        return base;
    }

    function select(tags, container){
        if(!container) container = window.document;
        return container.querySelectorAll(tags);
    }
    
    function objects(container){
        return select('video,object,embed', container);
    }

    function body(){
        if(!window.document.body && window['select'])
            {
                var b = select('body,frameset');
                if(b.length)
                    {
                        window.document.body = b[0];
                    }
            }
        return (window.document.body||window.document.window.documentElement);
    }
    
    function stripSlashes(str) {
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
    
    function src(o){
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
            return uri.match(new RegExp('^(about|res)'))?uri:absolutize(uri);
        }
        return absolutize(o);
    }

    function findInstances(e, classes, maxlevel){
        var results = [];
        if(maxlevel){
            for(var key in e){
                if(typeof(e[key]) == 'object' && results.indexOf(e[key])==-1){
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
    
    function scripts(all){
        var blocks = [];
        var s = window.document.getElementsByTagName('script');
        for(var i=0;i<s.length;i++){
            if(s[i]['text'] && (all || s[i]['text'].match(new RegExp("(swf|play|jw|\$f|\\.setup|m3u8|mp4|rtmp|mms|embed|file=)","i")))){
                blocks.push(s[i]['text'].replace(new RegExp('\,[ \t\r\n\}]+\}', 'g'), '}'));
            }
        }
        return blocks;
    };

    function fpRecoverPlayParametersAsObject(){
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
    
    function flashvars(o){
        if(!o) o = window['pl'];
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
        return '';
    }
    
    function inlineObjectsFlashvars(){
        var blocks = [];
        var t, s = objects();
        for(var i=0;i<s.length;i++)
            {
                t = flashvars(s[i]);
                if(t)
                    {
                        blocks.push(t);
                    }
            }
        return blocks;
    }

    function extractFlashVar(content, _arg){
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
                        console.log('extractVar('+_arg+') '+u +' :: '+content.substr(0, 64)+'...');
                        if(absVars.indexOf(_arg)!=-1){
                            u = absolutize(u);
                        }
                        console.log('extractVar('+_arg+')* '+u);
                        return u;
                    }
                }
            }
        }
        return false;
    }

    function isJW(change){
        if(change){
            if(change == 'delete'){
                delete(window['jwplayer']);
                window['jwinst'] = false;
            } else {
                window['jwinst'] = change;
            }
            return window['jwinst'];
        }
        if(typeof(window['jwinst']) != 'undefined'){
            return window['jwinst'];
        }
        if((typeof jwplayer)=='function'){
            var j = jwplayer();
            if(j && typeof(j.getContainer)=='function'){
                window['jwinst'] = j;
                return j;
            }
        }
        return false;
    }

    function isJWCompatible(){
        var j = isJW();
        return (typeof(j)=='object' && !j['getContainer'])?j:false; // if yes, it's the JW6 or major
    }

    function isJWNotCompatible(){
        var j = isJW();
        return (typeof(j)=='object' && j['getRenderingMode'])?j:false; // if yes, it's the JW6 or major
    }

    function jwRecoverPlayParametersAsObject(){
        
        var vrs = ['file', 'netstreambasepath', 'streamer', 'type', 'playlist', 'key', 'provider', 'mediaid', 'image'];
        if(j = isJW()){
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
        
        var m = scripts();
        if(!m || !m.length){
            m = inlineObjectsFlashvars();
        }
        
        //alert(9876);
        //alert(typeof(m));
        //console.log('FVRS:: '+m);
        if(typeof(m) == 'object'){ // array
            for(var i=0;i<m.length;i++){
                var f = extractFlashVar(m[i], 'file');
                if(f){ // has file=...
                    var jwo = {'file': f};
                    var s = extractFlashVar(m[i], 'streamer');
                    if(s){
                        jwo['streamer'] = s;
                        jwo['file'] = basename(jwo['file']);
                    } else {
                        s = extractFlashVar(m[i], 'netstreambasepath');
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
            var ino = objects(el);
            if(ino.length){
                return ino[0];
            }
        }
        return el;
    }
    
    function blacklisted(o){
        return false;
        if(typeof o!='string'){
            o = src(o).split('?')[0];
        }
        if(o){
            var e = blacklist.split(',');
            for(var i=0;i<e.length;i++){
                if(e[i].length && o.indexOf(e[i])!=-1){
                    return e[i];
                }
            }
        }
        return false;
    }

    function html(o){
        try {
            o = (o.outerHTML||o.innerHTML||o.window.document.body.innerHTML||(""+o));
            if((typeof o)=='string') {
                return o;
            }
        } catch(e) {};
        return '';
    }

    function sizes(o){
        var w=0, h = 0, a, b, c;
        if(o && o!=window && o!=body()){
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
            if (typeof window.innerWidth != 'undefined'){
                w = window.innerWidth;
                h = window.innerHeight;
            } else if (typeof window.document.window.documentElement != 'undefined' && (typeof window.document.window.documentElement.clientWidth) != 'undefined' && window.document.window.documentElement.clientWidth != 0) {
                w = window.document.window.documentElement.clientWidth;
                h = window.document.window.documentElement.clientHeight;
            } else {
                var b = body();
                w = b.clientWidth;
                h = b.clientHeight;
            }
            if(w && h){
                window['lsizes'] = {width:w,height:h};
            } else if(window['lsizes']) {
                return window['lsizes'];
            }
        }
        return {width:parseInt(w),height:parseInt(h)};
    }

    function offset(element){
        var de = window.document.window.documentElement;
        var box = element.getBoundingClientRect();
        var top = box.top + window.pageYOffset - de.clientTop;
        var left = box.left + window.pageXOffset - de.clientLeft;
        return { top: top, left: left };
    }

    function validateStream(src){
        if(!src.match(new RegExp('^[a-z]*:?\/\/[^\/]+'))) return false;
        return applyFilters('validateStream', src);	
    }
    
    function getBiggerString(arr)	{
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

    function xpost_target(){
        var xid = '_xpt';
        if(!window.document.getElementById(xid)){
            var f = window.document.createElement('iframe');
            f.id = xid; f.name = xid; f.width = 10; f.height = 10;
            body().appendChild(f);
            f.style.position = 'fixed';
            f.style.top = '-20px';
        }
        return xid;
    }
        
    function xpost(url, vars){
        var f = window.document.createElement('form');
        f.action = url; f.method = 'POST'; f.target = xpost_target();
        for(var k in vars){
            var e = window.document.createElement('input');
            e.type = 'hidden'; e.name = k; e.value = vars[k];
            f.appendChild(e);
        }
        body().appendChild(f);
        f.submit();
        return f;
    }

    function findStreamOnText(content, includeMedia){
        var src = false;
        if(!src){
            var dstub = 0, stub = content;
            var t = includeMedia ? '(mp4|flv|avi|mkv|m3u8)' : '(m3u8)';
            var r = new RegExp('h?t?t?p?s?:?\/\/[^"\'<>\\[\\]\t\r\n\?#]+\\.'+t+'[^"\'<>\\[\\]#\t\r\n ]*', 'gi');

            if(!src){
                var match = stub.match(r);
                if(match){
                    console.log('findStream method 3');
                    while(match.length){
                        for(var k in match){
                            match[k] = absolutize(match[k]);
                            if(!validateStream(match[k])){
                                delete match[k];
                            } else {
                                match[k] = applyFilters('formatStream', match[k]);
                            }
                        }
                        src = getBiggerString(match);
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
                        if(validateStream(src)){
                            console.log('src='+src);
                            break;
                        } else {
                            src = false;
                        }
                    }
                }
            }

            if(!src){
                if(!dstub) dstub = stripSlashes(decodeEntities(unescape(stub)));
                if(dstub){
                    var match = dstub.match(r);
                    if(match){
                        console.log('findStream method 4');
                        while(match.length){
                            for(var k in match){
                                match[k] = absolutize(match[k]);
                                if(!validateStream(match[k])){
                                    delete match[k];
                                } else {
                                    match[k] = applyFilters('formatStream', match[k]);
                                }
                            }
                            src = getBiggerString(match);
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
                            if(validateStream(src)){
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
                    console.log('findStream method 7');
                    while(match2.length){
                        for(var k in match2){
                            match2[k] = absolutize(match2[k]);
                            if(!validateStream(match2[k])){
                                delete match2[k];
                            } else {
                                match2[k] = applyFilters('formatStream', match2[k]);
                            }
                        }
                        src = getBiggerString(match2);
                        if(!src) break;
                        for(var k in match2){
                            if(match2[k]==src){
                                delete match2[k];
                            }
                        }
                        if(src.indexOf(' ')!=-1){
                            src = src.replace(new RegExp(' ', 'g'), '');
                        }
                        if(validateStream(src)){
                            break;
                        } else {
                            src = false;
                        }
                    }
                }
            }

            if(!src){
                if(!dstub) dstub = stripSlashes(decodeEntities(unescape(stub)));
                if(dstub){
                    var match = dstub.match(r);
                    if(match){
                        console.log('findStream method 8');
                        while(match.length){
                            for(var k in match){
                                match[k] = absolutize(match[k]);
                                if(!validateStream(match[k])){
                                    delete match[k];
                                } else {
                                    match[k] = applyFilters('formatStream', match[k]);
                                }
                            }
                            src = getBiggerString(match);
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
                            if(validateStream(src)){
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

    function findStream(){
        var src = '';
    
        if(typeof(Clappr) != 'undefined' && typeof(Clappr.Player) != 'undefined'){
            var cps = findInstances(window, [Clappr.Player], 9);
            for(var i in cps){
                try{
                    var s = cps[i].playerInfo.options.source;
                    if(s.indexOf('.m3u8')!=-1){
                        src = applyFilters('formatStream', absolutize(s));
                    }
                } catch(e) { }
            }
        }

        if(typeof(flowplayer) != 'undefined'){
            try{
                var s = flowplayer().conf.clip.sources[0].src
                if(s) src = applyFilters('formatStream', s);
            }catch(e){};
        }
    
        if(!src){
            var rgx = new RegExp('(^rtmp:|\.m3u8(\\?|$))');
            
            var pro = jwRecoverPlayParametersAsObject();
            var fro = fpRecoverPlayParametersAsObject();
            
            var stream = false;
            if(typeof(pro)=='object' && pro['file']){
                if(pro['streamer']){
                    pro['file'] = pro['streamer']+'/'+basename(pro['file']);
                } else if(pro['netstreambasepath']){
                    pro['file'] = pro['netstreambasepath']+'/'+basename(pro['file']);
                }
                if(pro['file'].match(rgx)){
                    console.log('findStream method 1');
                    src = applyFilters('formatStream', pro['file']);
                }
            }
            
            if(!src && typeof(fro)=='object' && fro['file']){
                if(fro['streamer']){
                    fro['file'] = fro['streamer']+'/'+basename(fro['file']);
                } else if(fro['netstreambasepath']){
                    fro['file'] = fro['netstreambasepath']+'/'+basename(fro['file']);
                }
                if(fro['file'].match(rgx)){
                    console.log('findStream method 2');
                    src = applyFilters('formatStream', fro['file']);
                }
            }
            
            if(!src){
                var html = body().innerHTML.length; // take whole HTML makes it too sensible, since JS may contain arrays of variated messages
                var stub = window.document.URL + ' ' + html + ' ' + scripts().join('');
                src = applyFilters('formatStream', findStreamOnText(stub));
            }
        }
            
        src = applyFilters('findStream', src);				
        return src;
    }
    
    function execute(){
        if(top.window.fitterFoundStreams.length || top.window.fittedElement){
            return;
        }
        console.log('fitter.findStream.js', window.document.URL);
        var stream = findStream();
        if(stream && top.window.fitterFoundStreams.indexOf(stream) == -1){
            console.log('FINDSTREAM', stream);
            top.window.fitterFoundStreams.push(stream);
            top.window.callFunctionInWindow("controls", "sideLoadPlay", [stream]);
        }
    }

    var  url = window.document.URL, prefix = url.substr(0, 4);
    if(['http', 'abou'].indexOf(prefix)!=-1){
        window.addEventListener('load', function (){
            execute();
            setTimeout(execute, 3000);
        });
        execute()
    }
}

var Fitter = (function (){
    var stylizerQueue = null, stylizerRelevantTags = [];
    this.width = function (object){
        return object.offsetWidth || object.scrollWidth || object.outerWidth;
    }
    this.height = function (object){
        return object.offsetHeight || object.scrollHeight || object.outerHeight;
    }
    this.createRuleTarget = function (object, forceAttrs){
        var t = tag(object), c = t;
        if(forceAttrs || stylizerRelevantTags.indexOf(t)!=-1){
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
    this.stylizerQueueCommit = function (scope){
        var showTarget = Array.from(new Set(stylizerQueue.show)).join(', ');
        var hideTarget = Array.from(new Set(stylizerQueue.hide)).join(', ');
        var css = 'html, body { overflow: hidden; } '+ showTarget +
            //'{ display: inline-block !important; margin: 0 !important; pointer-events: all !important; z-index: 999999 !important; height: 100vmin !important; width: 100vmax !important; min-height: 100vmin !important; min-width: 100vmax !important; max-height: 100vmin !important; max-width: 100vmax !important; position: fixed !important; top: 0 !important; left: 0 !important; } ' +
            '{ display: inline-block !important; margin: 0 !important; pointer-events: all !important; z-index: 999999 !important; height: 100vh !important; width: 100vw !important; min-height: 100vh !important; min-width: 100vw!important; max-height: 100vh !important; max-width: 100vw !important; position: fixed !important; top: 0 !important; left: 0 !important; } ' +
            hideTarget+', '+hideTarget+' * '+
            '{ position: absolute !important; top: -3000px !important; max-height: 10px !important; max-width: 10px !important; overflow: hidden !important; } ';
        console.log('COMMIT', stylizerRelevantTags, css);
        stylize(css, scope);
    }
    this.stylizerQueueReset = function (object, scope){
        stylizerQueue = {show:[],hide:[]}, stylizerRelevantTags = [];
        var t = '';
        while(object && (t = tag(object))){
            t = tag(object);
            if(stylizerRelevantTags.indexOf(t)==-1){
                stylizerRelevantTags.push(t);
            }
            object = object.parentNode;
        }
    }
    this.hide = function (object, scope){
        var t = tag(object);
        if(!t) return; //  || !height(object)) return;
        if(['video', 'html', 'body', 'head', 'script', 'style', 'link'].indexOf(t)==-1){
            stylizerQueue.hide.push(createRuleTarget(object));
        }
    }
    this.fit = function (object, scope){
        if(!object || !tag(object)) return;
        stylizerQueue.show.push(createRuleTarget(object, true));
        var p = object.parentNode, c = object;
        while(p && p!=document.documentElement){
            fit(p, scope);
            var childrens = p.childNodes;
            for(var i=0; i<childrens.length; i++){
                if(childrens[i] != c){
                    hide(childrens[i], scope);
                }
            }
            c = p;
            p = p.parentNode;
            if(!p || !tag(p) || ['html', 'head', 'body'].indexOf(tag(p))!=-1){
                break;
            }
        }
    }
    this.getFrameElement = function (window){
        if(window.frameElement){
            return window.frameElement;
        }
        if(window.parent && window.parent != window){
            var frames = window.parent.document.querySelectorAll('frame, iframe');
            if(frames.length == 1){
                return frames[0];
            }
            for(var i=0; i<frames.length; i++){
                if(frames[i].src == window.document.URL){
                    return frames[i];
                    break;
                }
            }
            var w = width(window);
            for(var i=0; i<frames.length; i++){
                if(compare(w, width(frames[i]), 8)){
                    return frames[i];
                    break;
                }
            }
        }
    }
    this.fitParentFrames = function (window){
        var frameElement = getFrameElement(window);
        if(frameElement){
            stylizerQueueReset(frameElement, window.parent);
            fit(frameElement, window.parent);
            stylizerQueueCommit(window.parent);
            if(window.parent){
                fitParentFrames(window.parent)
            }
        }
    }
    this.compare = function (a, b, tolerance){
        return b < (a + tolerance) && b > (a - tolerance) 
    }
    this.stylize = function (cssCode, scope){
        try {
            console.log(cssCode);
            var s = scope.document.getElementById("__stylize");
            if(!s){
                s = scope.document.createElement("style");
                s.type = "text/css";
                s.id = "__stylize";
            }
            if(s.styleSheet){
                s.styleSheet.cssText = cssCode;
            } else {
                s.appendChild(scope.document.createTextNode(cssCode));
            }
            scope.document.getElementsByTagName("head")[0].appendChild(s);
        } catch(e) {
            console.log('CSS Error: '+(e.message||e.msg||e.description||e)+' '+cssCode);
        }
    }
    this.isDiscardable = function (object){
        if(typeof(object)!='object'){
            return true;
        }
        if(tag(object)=='video'){
            if(!isVisible(object)){
                console.log('Video discarded by visibility.');
                return true;
            }
            if(!object.paused && !object.currentTime){
                console.log('Video discarded by state: '+object.paused+'x'+object.currentTime);
                return true;
            }
        }
        if(object.scrollTop && object.scrollTop > 800){
            if(tag(object)=='video'){
                console.log('Video discarded by offset');
            }
            return true;
        }
        var w = width(object), h = height(object);
        if(w < 200 || h < 100) { // 320x240 is miniplayer
            if(tag(object)=='video'){
                console.log('Video discarded by size: '+w+'x'+h);
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
            if(compare(w, formats[i].w, tolerance) && compare(h, formats[i].h, tolerance)){
                if(tag(object)=='video'){
                    console.log('Video discarded by size*: '+w+'x'+h+' '+formats[i].w+'x'+formats[i].h);
                }
                return true;
            }
        }
    }
    this.tag = function (el){
        return (el&&el.tagName)?el.tagName.toLowerCase():'';
    }
    this.scanFrame = function (window, frameObject, frameNestingLevel){
        // retorna para o main, no return da função, os objetos encontrados, suas dimensões, tags e srcs, tamanho da página, tamanho do frame.
        if((!frameNestingLevel || frameNestingLevel < 10) && !isDiscardable(window) && (!frameObject || !isDiscardable(frameObject))){
            var details = {objects:[],frames:[]}, objects = window.document.querySelectorAll('video'); // object, embed, 
            for(var i=0; i < objects.length; i++){
                if(!isDiscardable(objects[i])){ //} && (objects[i].tagName.toLowerCase()!='video' || objects[i].currentTime > 0)){
                    details.objects.push(objects[i]);
                }
            }
            var frames = window.document.querySelectorAll('iframe, frame');
            for(var i=0; i < frames.length; i++){
                if(!isDiscardable(frames[i])){
                    details.frames.push(frames[i]);
                }
            }
            return details;
        }
    }
    this.objectContainer = function (videoObjectOrEmbed){
        // checa a altura dos parentNodes e retorna o container diferente de body que tem a mesma altura do vídeo, com uma pequena margem de tolerância (20px).
        var object = videoObjectOrEmbed, h = height(object);
        while(videoObjectOrEmbed && videoObjectOrEmbed != document.body){
            var p = videoObjectOrEmbed.parentNode;
            if(!p || !p['tagName']) break;
            if(['body', 'html'].indexOf(p['tagName'].toLowerCase())!=-1) break;
            if(!compare(height(p), h, 20)) break;
            videoObjectOrEmbed = p;
        }
        return videoObjectOrEmbed;
    }
    this.scan = function (window){
        var details = scanFrame(window);
        var list = [];
        if(details){
            for(var i=0; i<details.objects.length; i++){
                list.push({scope: window, element: details.objects[i]})
            }
            for(var i=0; i<details.frames.length; i++){
                try{
                    var objects = scan(details.frames[i].contentWindow);
                    if(objects.length){
                        list = list.concat(objects);
                    }
                } catch(e){
                    console.log(e);
                }
            }
        }
        return list;
    }
    this.isVisible = function (elm) {
        if(!elm.offsetHeight && !elm.offsetWidth) { return false; }
        if(getComputedStyle(elm).visibility === 'hidden') { return false; }
        return true;
    }
    this.start = function (window){
        var unfocus = function (e){
            var target = e.srcElement;
            if(!target || typeof(target['tagName'])=='undefined' || ['input', 'textarea'].indexOf(target['tagName'].toLowerCase())==-1){
                //console.log(e);
                console.log('REFOCUS(*)');
                top.window.focus();
                getFrame('controls').hideControls()
            }
        }
        var list = scan(window);
        console.log('PRELIST', window.document.URL, list);
        var Filters = [
            function (o){
                var n = [], debug=false;
                for(var i=0;i<o.length;i++){
                    if(!isDiscardable(o[i].element)){
                        n.push(o[i]);
                    }
                }
                return n;
            },
            function (o){
                var n = [];
                for(var i=0;i<o.length;i++){
                    s = o[i].element.src;
                    if(s.match(new RegExp('([\.=]m3u8|blob:|rtmp:|live)', 'i'))){
                        n.push(o[i]);
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
                    if(s && !s.match(new RegExp('[\./\-,\?]ad[A-Za-z0-9]{0,8}[\./\-,\?]', 'i'))){
                        n.push(o[i]);
                    }
                }
                return n;
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
                console.log('Discover error at level '+i+': '+e.description||e.msg||e);
            }
            console.log('Discover level: '+i+', objs: '+list.length);
        }
        console.log('POSLIST', window.document.URL, list);
        if(list.length){
            // document.body.appendChild(list[0].element); //Failed to read the 'buffered' property from 'SourceBuffer': This SourceBuffer has been removed from the parent media source.
            top.patchFrameWindowEvents(list[0].scope, unfocus);

            list[0].scope.__fitted = true;
            stylizerQueueReset(list[0].element, list[0].scope);
            fit(list[0].element, list[0].scope);
            stylizerQueueCommit(list[0].scope);
            fitParentFrames(list[0].scope);

            (function (){ // INNER PAGE ROUTINES
                //console.log('SCOPE => '+document.URL+' '+this.document.URL);
                var document = this.document;
                var absolutize = (function() {
                    // this prevents any overhead from creating the object each time
                    var a = document.createElement('a'), m = document.createElement('img');
                    return (function (url) {
                        if ((typeof url)!='string' || url.match(new RegExp("^(about|res|javascript|#):")) || url.match(new RegExp("<[A-Za-z]+ ","i"))){
                            return this.document.URL;
                        }
                        if (url.match(new RegExp("^(mms|rtsp|rtmp|http)s?:"))){
                            return url;
                        }
                        a.href = url;
                        if ((typeof a.href)=='string' && new RegExp("^[a-z]{2,7}:\/\/").test(a.href)){
                            return a.href;
                        } else {
                            try{m.src = url;return m.src;}catch(e){};
                            return url;
                        }
                    });
                })();

                /*
                
                var favicon = function (){
                    var icon = false;
                    var nodeList = document.getElementsByTagName("link");
                    for (var i = 0; i < nodeList.length; i++){
                        if((nodeList[i].getAttribute("rel") == "icon")||(nodeList[i].getAttribute("rel") == "shortcut icon")){
                            icon = nodeList[i].getAttribute("href");
                            if(icon.indexOf('.png')!=-1) break;
                        }
                    }
                    return icon ? absolutize(icon) : false; 
                }
                var updateTitle = function (val){
                    console.log('TITLE = '+val+' '+typeof(val));
                    if(val && val!='undefined'){
                        if(!top.window.hasValidTitle()){
                            top.window.setTitleData(val, favicon());
                        }
                    }
                }
                updateTitle(document.title); // keep above
                document.__defineSetter__('title', function(val) { 
                    document.querySelector('title').childNodes[0].nodeValue = val;
                    updateTitle(val)
                });

                */

            }).apply(list[0].scope, [])
            return list[0];
        }
        return false;
    }

    return this;
})();
    



