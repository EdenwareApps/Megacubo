import { NodeJS } from 'capacitor-nodejs'
import { KeepAwake } from '@capacitor-community/keep-awake';
import { App } from '@capacitor/app';
import { NativeFileDownloader } from '@eoscz/capacitor-plugin-native-file-downloader'
import { Keyboard } from '@capacitor/keyboard';
import { Share } from '@capacitor/share';

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

window.capacitor = {
	NodeJS, App, Share,
	KeepAwake, Keyboard,
	NativeFileDownloader,
	requestPermission
}
