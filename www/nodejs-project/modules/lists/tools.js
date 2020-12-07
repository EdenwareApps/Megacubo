const async = require('async')

class Tools {
	constructor(opts){
		this.opts = {
			folderSizeLimit: 96,
			folderSizeLimitTolerance: 12
		}
        if(opts){
            Object.keys(opts).forEach((k) => {
                this.opts[k] = opts[k]
            })
        }
	}
	basename(str, rqs){
		str = String(str)
		let qs = '', pos = str.indexOf('?')
		if(pos != -1){
			qs = str.slice(pos + 1)
			str = str.slice(0, pos)
		}
		str = str.replaceAll('\\', '/')
		pos = str.lastIndexOf('/')
		if(pos != -1){
			str = str.substring(pos + 1)
		}
		if(!rqs && qs){
			str += '?' + qs
		}
		return str
	}
	dirname(str){
		let _str = new String(str), pos = _str.replaceAll('\\', '/').lastIndexOf('/')
		if(!pos) return ''
		_str = _str.substring(0, pos)
		return _str
	}
	labelify(list){
		for (var i=0; i<list.length; i++){
			if(typeof(list[i].type) == 'undefined' || list[i].type == 'stream') {
				list[i].details = list[i].groupName || (this.basename(list[i].path || list[i].group))
			}
		}
		return list
	}
	shortenSingleFolders(list){
		for (var i=0; i<list.length; i++){
			if(list[i].type == 'group'){
				if(list[i].entries.length == 1){
					list[i].entries[0].name = this.mergeNames(list[i].name, list[i].entries[0].name)
					list[i] = list[i].entries[0]
					list[i].path = this.dirname(list[i].path)
					list[i].group = this.dirname(list[i].group)
				}
			}
		}
		return list
	}
	/*
	mapRecursively(list, cb, root){
		for (var i = 0; i < list.length; i++){
			if(list[i].type == 'group'){
				list[i].entries = this.mapRecursively(list[i].entries, cb, true)
			}
		}
		if(root){
			list = cb(list)
		}
		return list
	}
	*/
	mapRecursively(list, cb, root){
		for (var i = list.length - 1; i >= 0; i--){
			if(list[i].type && list[i].type == 'group'){
				let ret = this.mapRecursively(list[i].entries, cb, true)
				if(Array.isArray(ret)){
					list[i].entries = ret
				} else {					
					list[i].renderer = ret
					delete list[i].entries
				}
			}
		}
		if(root){
			list = cb(list)
		}
		return list
	}
	offload(list, url, cb){
		if(list.length <= this.opts.offloadThreshold){
			return cb(list)
		} else {
			let map = {}, i = 0
			list = this.mapRecursively(list, slist => {
				let key = 'offload-'+ i + '-' + url
				map[key] = slist
				i++
				return key
			}, false)
			async.eachOfLimit(Object.keys(map), 8, (key, i, acb) => {
				global.tstorage.set(key, map[key], true, acb)
			}, () => {
				cb(list)
			})
		}
	}
	insertAtPath(_index, groupname, group){ // group is entry object of type "group" to be put as last location, create the intermediaries, groupname is like a path
		var structure = this.buildPathStructure(groupname, group);
		_index = this.mergeEntriesWithNoCollision(_index, structure);
		return _index;
	}
	isASCIIChar(chr){
		let c = chr.charCodeAt(0)
		return ((c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122))
	}
	groupDetails(entries){
		let streams, categories, details = []
		streams = entries.filter(e => e.url).length
		categories = entries.length - streams
		if(streams) details.push(global.lang.X_BROADCASTS.format(streams))
		if(categories) details.push(global.lang.X_CATEGORIES.format(categories))
		return details.join(', ')
	}
	paginateList(sentries){
		sentries = this.sortList(sentries)
		if(sentries.length > (this.opts.folderSizeLimit + this.opts.folderSizeLimitTolerance)){
			let folderSizeLimit = Math.min(this.opts.folderSizeLimit, sentries.length / 8) // generate at least 8 pages to ease navigation
			let group, nextName, lastName, entries = [], template = {type: 'group', fa: 'fas fa-folder-open'}, n = 1
			for(let i=0; i<sentries.length; i += folderSizeLimit){
				group = Object.assign({}, template);
				// console.log('CD', i, folderSizeLimit);
				let gentries = sentries.slice(i, i + folderSizeLimit)
				nextName = sentries.slice(i + folderSizeLimit, i + folderSizeLimit + 1)
				nextName = nextName.length ? nextName[0].name : null
				group.name = this.getRangeName(gentries, lastName, nextName)
				if(gentries.length){
					lastName = gentries[gentries.length - 1].name
					group.details = this.groupDetails(gentries)
				}
				// console.log('DC', gentries.length);
				group.entries = gentries
				entries.push(group)
				n++
			}
			sentries = entries
		}
		// console.log('DD', entries.length);
		return sentries
	}
	sortList(list){
		var result = list.slice(0)
		result.sort((a, b) => {
			return (a.type && a.type == 'option') ? 1 : ((a.name.toLowerCase() > b.name.toLowerCase()) ? 1 : ((b.name.toLowerCase() > a.name.toLowerCase()) ? -1 : 0))
		})
		return result
	}
	getNameDiff(a, b){
		let c = ''
		//console.log('namdiff', JSON.stringify(a), b)
		for(let i=0;i<a.length;i++){
			if(a[i] && b && b[i] && a[i] == b[i]){
				c += a[i]
			} else {
				c += a[i]
				if(this.isASCIIChar(a[i])){
					break
				}
			}
		}
		//console.log('namdiff res', c)
		return c
	}
	getRangeName(entries, lastName, nextName){
		var l, start = '0', end = 'Z', r = new RegExp('[a-z\\d]', 'i'), r2 = new RegExp('[^a-z\\d]+$', 'i')
		//console.log('last', JSON.stringify(lastName))
		for(var i=0; i<entries.length; i++){
			if(lastName){
				l = this.getNameDiff(entries[i].name, lastName)
			} else {
				l = entries[i].name.charAt(0)
			}
			if(l.match(r)){
				start = l.toLowerCase().replace(r2, '')
				break
			}
		}
		//console.log('next')
		for(var i=(entries.length - 1); i>=0; i--){
			if(nextName){
				l = this.getNameDiff(entries[i].name, nextName)
			} else {
				l = entries[i].name.charAt(0)
			}
			if(l.match(r)){
				end = l.toLowerCase().replace(r2, '')
				break
			}
		}
		return start == end ? start : lang.X_TO_Y.format(start.toUpperCase(), end.toUpperCase())
	}
	// mergeEntriesWithNoCollision([{name:'1',type:'group', entries:[1,2,3]}], [{name:'1',type:'group', entries:[4,5,6]}])
	mergeEntriesWithNoCollision(leveledIndex, leveledEntries){
		var ok
		if(Array.isArray(leveledIndex) && Array.isArray(leveledEntries)){
			for(var j=0;j<leveledEntries.length;j++){
				ok = false;
				for(var i=0;i<leveledIndex.length;i++){
					if(leveledIndex[i].type==leveledEntries[j].type && leveledIndex[i].name==leveledEntries[j].name){
						//console.log('LEVELING', leveledIndex[i], leveledEntries[j])
						leveledIndex[i].entries = this.mergeEntriesWithNoCollision(leveledIndex[i].entries, leveledEntries[j].entries)
						ok = true
						break
					}
				}
				if(!ok){
					//console.log('NOMATCH FOR '+leveledEntries[j].name, leveledIndex, leveledEntries[j]);
					leveledIndex.push(leveledEntries[j])
					//console.log('noMATCH' , JSON.stringify(leveledIndex).substr(0, 128));
				}
			}
		}
		return leveledIndex
	}
	buildPathStructure(path, group){ // group is entry object of type "group" to be put as last location, create the intermediaries
		var groupEntryTemplate = {name: '', path: '', type: 'group', details: '', entries: []}
		path = path.replace(new RegExp('\\+'), '/')
		var paths = path.split('/')
		var structure = group
		for(var i=(paths.length - 2);i>=0;i--){
			//console.log(structure)
			var entry = groupEntryTemplate
			entry.entries = [Object.assign({}, structure)]
			entry.name = paths[i]
			entry.details = ''
			entry.path = paths.slice(0, i + 1).join('/')
			structure = entry
		}
		return [structure]
	}
	mergeNames(a, b){
		var la = a.toLowerCase()
		var lb = b.toLowerCase()
		if(la && la.indexOf(lb) != -1){
			return a
		}
		if(lb && lb.indexOf(la) != -1){
			return b
		}
		return this.compressName(a +' '+ b)
	}
	compressName(a){
		return  [...new Set(a.split(' ').filter(s => s.length > 1))].join(' ')
	}
	mergeEntries(a, b){
		if(a.name != b.name){
			a.name = this.mergeNames(a.name, b.name)
			if(
				(a.rawname && a.rawname != a.name) || 
				(b.rawname && b.rawname != b.name)
			){
				a.rawname = this.mergeNames(a.rawname || a.name, b.rawname || a.name)
			} else {
				a.rawname = a.name
			}
		}
		if(b.icon && !a.icon){
			a.icon = b.icon
		}
		return a
	}
	dedup(flatList){
		let already = {}, map = {};
		for(var i=0; i<flatList.length; i++){
			if(!flatList[i]){
				delete flatList[i]
			} else if((typeof(flatList[i].type)=='undefined' || flatList[i].type=='stream') && !flatList[i].prepend){
				if(typeof(already[flatList[i].url])!='undefined'){
					var j = map[flatList[i].url]
					flatList[j] = this.mergeEntries(flatList[j], flatList[i])
					delete flatList[i]
				} else {
					already[flatList[i].url] = 1
					map[flatList[i].url] = i
				}
			}
		}
		already = map = null
		return flatList.filter((item) => {
			return item !== undefined
		})
	}
	deepify(flatList){
		let parsedGroups = {}, groupedEntries = [], recursivelyGroupedList = []
		for(let i=0;i<flatList.length;i++){
			if(!flatList[i].group || !flatList[i].group.match(new RegExp('[A-Za-z0-9]'))){
				recursivelyGroupedList.push(flatList[i])
			} else {
				if(typeof(parsedGroups[flatList[i].group])=='undefined'){
					parsedGroups[flatList[i].group] = []
				}
				parsedGroups[flatList[i].group].push(flatList[i])
			}
		}
		for(let k in parsedGroups){
			groupedEntries.push({name: this.basename(k), path: k, type: 'group', details: '', entries: parsedGroups[k]});
		}
		for(let i=0; i<groupedEntries.length; i++){
			if(groupedEntries[i].path.indexOf('/') != -1){ // has path
				recursivelyGroupedList = this.insertAtPath(recursivelyGroupedList, groupedEntries[i].path, groupedEntries[i])
			}
		}
		for(let i=0; i<groupedEntries.length; i++){
			if(groupedEntries[i].path.indexOf('/') == -1){ // no path
				recursivelyGroupedList = this.mergeEntriesWithNoCollision(recursivelyGroupedList, [groupedEntries[i]])
			}
		}
		groupedEntries = parsedGroups = null
		recursivelyGroupedList = this.mapRecursively(recursivelyGroupedList, this.shortenSingleFolders.bind(this), true)
		recursivelyGroupedList = this.mapRecursively(recursivelyGroupedList, this.labelify.bind(this), true)
		recursivelyGroupedList = this.mapRecursively(recursivelyGroupedList, this.paginateList.bind(this), true)
		return recursivelyGroupedList
	}
}

module.exports = Tools
