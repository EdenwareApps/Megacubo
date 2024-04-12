class Tools {
	constructor(){
		this.folderSizeLimitTolerance = 12
	}
	dedup(entries){ // dedup usage should be avoided, for performance, prevent app nav errors and respect lists planned structure
		let changed, already = {}, map = {};
		for(var i=0; i<entries.length; i++){
			if(!entries[i]){
				changed = true
				delete entries[i]
			} else if(
				entries[i].url && 
				!entries[i].prepend && 
				(typeof(entries[i].type) == 'undefined' || entries[i].type == 'stream')
				){
				if(typeof(already[entries[i].url]) != 'undefined'){
					changed = true
					var j = map[entries[i].url]
					entries[j] = this.mergeEntries(entries[j], entries[i])
					delete entries[i]
				} else {
					already[entries[i].url] = 1
					map[entries[i].url] = i
				}
			}
		}
		already = map = null
		return changed ? entries.filter(item => item !== undefined) : entries
	}
	basename(str, rqs){
		str = String(str)
		let qs = '', pos = str.indexOf('?')
		if(pos != -1){
			qs = str.slice(pos + 1)
			str = str.slice(0, pos)
		}
		str = global.forwardSlashes(str)
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
		let _str = new String(str), pos = global.forwardSlashes(_str).lastIndexOf('/')
		if(!pos) return ''
		_str = _str.substring(0, pos)
		return _str
	}
	mapRecursively(list, cb, root){
		for (var i = list.length - 1; i >= 0; i--){
			if(list[i].type && list[i].type == 'group'){
				if(typeof(list[i].entries) != 'undefined'){
					let ret = this.mapRecursively(list[i].entries, cb, true)
					if(Array.isArray(ret)){
						list[i].entries = ret
					} else {					
						list[i].renderer = ret
						delete list[i].entries
					}
				}
			}
		}
		if(root){
			list = cb(list)
		}
		return list
	}
	async asyncMapRecursively(list, cb, root){
		for (var i = list.length - 1; i >= 0; i--){
			if(list[i].type && list[i].type == 'group'){
				if(typeof(list[i].entries) != 'undefined'){
					let ret = await this.asyncMapRecursively(list[i].entries, cb, true)
					if(Array.isArray(ret)){
						list[i].entries = ret
					} else {					
						list[i].renderer = ret
						delete list[i].entries
					}
				}
			}
		}
		if(root){
			list = await cb(list)
		}
		return list
	}
	async offload(list, url){
		if(list.length <= this.offloadThreshold){
			return list
		} else {
			let i = 0
			const pLimit = require('p-limit')
            const limit = pLimit(4)
			return await this.asyncMapRecursively(list, async slist => {
				let key = 'offload-'+ i + '-' + url
                limit(async () => {
                    return await global.storage.set(key, slist, {expiration: true})
                })
				i++
				return key
			}, false)
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
	paginateList(sentries, minPageCount){
		const lists = require('../lists')
		sentries = lists.sort(sentries)
		const folderSizeLimit = global.config.get('folder-size-limit')
		if(sentries.length > (folderSizeLimit + this.folderSizeLimitTolerance)){
			if(!minPageCount) {
				minPageCount = 8
			}
			let expectedFolderSizeLimit = folderSizeLimit
			let n = Math.ceil(sentries.length / minPageCount)
			if(n < expectedFolderSizeLimit){
				expectedFolderSizeLimit = n
			}
			let group, nextName, lastName, entries = [], template = {type: 'group', fa: 'fas fa-box-open'}
			for(let i=0; i<sentries.length; i += expectedFolderSizeLimit){
				group = Object.assign({}, template);
				let gentries = sentries.slice(i, i + expectedFolderSizeLimit)
				nextName = sentries.slice(i + expectedFolderSizeLimit, i + expectedFolderSizeLimit + 1)
				nextName = nextName.length ? nextName[0].name : null
				group.name = this.getRangeName(gentries, lastName, nextName)
                if(group.name.indexOf('[') != -1){
                    group.rawname = group.name
                    group.name = group.name.replace(lists.regexes['between-brackets'], '')
                }
				if(gentries.length){
					lastName = gentries[gentries.length - 1].name
					group.details = this.groupDetails(gentries)
				}
				group.entries = gentries
				entries.push(group)
				n++
			}
			entries = entries.map((group, i) => {
				if(i >= (entries.length - 1)) return group
				const nextGroup = entries[i + 1].name
				group.entries.push({
					name: global.lang.MORE,
					details: nextGroup,
					type: 'action',
					fa: 'fas fa-chevron-right',
					action: () => {
						menu.open(menu.dirname(menu.path) +'/'+ nextGroup).catch(global.displayErr)
					}
				})
				return group
			})
			sentries = entries
		}
		return sentries
	}
	getNameDiff(a, b){
		let c = ''
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
		return c
	}
	getRangeName(entries, lastName, nextName){
		var l, start = '0', end = 'Z', r = new RegExp('[a-z\\d]', 'i'), r2 = new RegExp('[^a-z\\d]+$', 'i')
		for(var i=0; i<entries.length; i++){
			if(lastName){
				l = this.getNameDiff(entries[i].name, lastName)
			} else {
				l = entries[i].name.charAt(0)
			}
			if(l.match(r)){
				start = l.replace(r2, '')
				break
			}
		}
		for(var i=(entries.length - 1); i>=0; i--){
			if(nextName){
				l = this.getNameDiff(entries[i].name, nextName)
			} else {
				l = entries[i].name.charAt(0)
			}
			if(l.match(r)){
				end = l.replace(r2, '')
				break
			}
		}
        const t = {
            s: '[alpha]',
            e: '[|alpha]'
        }
		return start == end ? start : global.lang.X_TO_Y.format(start + t.s, t.e + end)
	}
	mergeEntriesWithNoCollision(leveledIndex, leveledEntries){
		var ok
		if(Array.isArray(leveledIndex) && Array.isArray(leveledEntries)){
			for(var j=0; j<leveledEntries.length; j++){
				ok = false
				for(var i=0; i<leveledIndex.length;i++){
					if(leveledIndex[i].name == leveledEntries[j].name && leveledIndex[i].type == leveledEntries[j].type){
						leveledIndex[i].entries = this.mergeEntriesWithNoCollision(leveledIndex[i].entries, leveledEntries[j].entries)
						ok = true
						break
					}
				}
				if(!ok){
					leveledIndex.push(leveledEntries[j])
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
		return a +' - '+ b
	}
	mergeEntries(a, b){
		if(a.name != b.name){
			const oaName = a.name
			a.name = this.mergeNames(a.name, b.name)
			if(
				(a.rawname && a.rawname != a.name) || 
				(b.rawname && b.rawname != b.name)
			){
				a.rawname = this.mergeNames(a.rawname || a.name, b.rawname || a.name)
			} else {
				a.rawname = a.name
			}
			if(a.path) {
				const parts = a.path.split('/')
				if(parts[parts.length - 1] == oaName) {
					parts[parts.length - 1] = a.name
					a.path = parts.join('/')
				}
			}
		}
		if(b.icon && !a.icon){
			a.icon = b.icon
		}
		return a
	}
	shortenSingleFolders(list){
		for (var i=0; i<list.length; i++){
			if(list[i].type == 'group'){
				if(typeof(list[i].entries) != 'undefined' && list[i].entries.length == 1){
					list[i].entries[0].name = this.mergeNames(list[i].name, list[i].entries[0].name)
					list[i] = list[i].entries[0]
					list[i].path = this.dirname(list[i].path)
					list[i].group = this.dirname(list[i].group)
				}
			}
		}
		return list
	}
	async deepify(entries, opts={}){
		const folderSizeLimit = global.config.get('folder-size-limit')
		if(entries.length <= folderSizeLimit) return entries
        const shouldOffload = entries.length > 4096
		let parsedGroups = {}, groupedEntries = []
		for(let i=0;i<entries.length;i++){
			if(entries[i].group){
				if(typeof(parsedGroups[entries[i].group])=='undefined'){
					parsedGroups[entries[i].group] = []
				}
				parsedGroups[entries[i].group].push(entries[i])
                entries[i] = undefined
			}
		}
		for(let k in parsedGroups){
			groupedEntries.push({name: this.basename(k), path: k, type: 'group', entries: parsedGroups[k]});
		}
		entries = entries.filter(e => e)
		for(let i=0; i<groupedEntries.length; i++){
			if(groupedEntries[i].path.indexOf('/') != -1){ // has path
				entries = this.insertAtPath(entries, groupedEntries[i].path, groupedEntries[i])
			}
		}
        for(let i=0; i<groupedEntries.length; i++){
			if(groupedEntries[i].path.indexOf('/') == -1){ // no path
				entries = this.mergeEntriesWithNoCollision(entries, [groupedEntries[i]])
			}
		}
		groupedEntries = parsedGroups = null
		entries = this.mapRecursively(entries, es => {
			return this.paginateList(es, opts.minPageCount)
		}, true)
        if(opts.source){
			entries = this.mapRecursively(entries, list => {
				if(list.length && !list[0].source){
					list[0].source = opts.source // leave a hint for expandEntries
				}
				return list
			}, true)
		}
        if(shouldOffload){
            entries = await this.offload(entries, opts.source)
        }
        return entries
	}
}

module.exports = Tools
