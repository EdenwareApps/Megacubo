
import path from 'path'
import { data } from '../paths/paths.js'
import energy from '../energy/energy.js'

class Profiles {
    constructor(){
		this.logged = null
		this.folder = path.join(data, 'Users')
		this.load()
    }
    getSystemUser(){
        return process.env.USERNAME || process.env.USER || 'Default'
    }
    load(){
		if(!fs.existsSync(this.folder)){
			fs.mkdirSync(this.folder)
		}
		this.list = fs.readdirSync(this.folder).filter((name) => {
			return name != 'Store' && fs.statSync(path.join(this.folder, name)).isDirectory()
		})
		if(!this.list.length){
			let usr = this.getSystemUser()
			fs.mkdirSync(path.join(this.folder, usr))
		}
		var name = localStorage.getItem('logged-user')
		if(!name || !this.list.includes(name)){
			name = this.list[0]
		}
        this.logged = name
        this.loggedFolder = path.join(this.folder, name)
        localStorage.setItem('logged-user', name)
	}
	logon(name){
		if(this.list.includes(name)){
			localStorage.setItem('logged-user', name)
			energy.restart()
		}
	}
}

export default Profiles
