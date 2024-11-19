import { NodeJS } from 'capacitor-nodejs'
import { KeepAwake } from '@capacitor-community/keep-awake';
import { App } from '@capacitor/app';
import { NativeFileDownloader } from '@eoscz/capacitor-plugin-native-file-downloader'
import { Keyboard } from '@capacitor/keyboard';
import { Share } from '@capacitor/share';
import { Clipboard } from '@capacitor/clipboard';

const requestPermission = async perm => {
	const permissions = cordova.plugins.permissions
	const has = await new Promise((resolve => {
		permissions.hasPermission(permissions[perm], status => {
			resolve(!!status.hasPermission)
		}, () => {
			resolve(false)
		})
	}))
	if(!has) {
		const got = await new Promise((resolve => {
			permissions.requestPermission(permissions[perm], status => {
				resolve(!!status.hasPermission)
			}, () => {
				resolve(false)
			})
		}))
		return got
	}
	return has
}

const clipboard = async text => {
	if(typeof text === 'string') {
		await Clipboard.write({string: text})
	} else {
		const { type, value } = await Clipboard.read()	  
		return {type, value}
	}
}

window.capacitor = {
	NodeJS, App, Share,
	KeepAwake, Keyboard,
	NativeFileDownloader,
	requestPermission,
	clipboard
}
