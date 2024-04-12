import { NodeJS } from 'capacitor-nodejs'
import { KeepAwake } from '@capacitor-community/keep-awake';
import { App } from '@capacitor/app';
import { NativeFileDownloader } from '@eoscz/capacitor-plugin-native-file-downloader'
import { Keyboard } from '@capacitor/keyboard';
import { Share } from '@capacitor/share';
import { AndroidPermissions } from '@ionic-native/android-permissions/ngx/';
import { StatusBar } from '@capacitor/status-bar';

setTimeout(() => {
	return StatusBar.setBackgroundColor({color: '#100927'})
}, 250)

const androidPermissions = new AndroidPermissions()
const requestPermission = async perm => {
	const result = await androidPermissions.requestPermission(androidPermissions.PERMISSION[perm])
	return result.hasPermission
}

window.capacitor = {
	NodeJS, App, Share,
	KeepAwake, Keyboard,
	NativeFileDownloader,
	AndroidPermissions,
	requestPermission
}
