import { NodeJS } from 'capacitor-nodejs'
import { KeepAwake } from '@capacitor-community/keep-awake';
import { App } from '@capacitor/app';
import { NativeFileDownloader } from '@eoscz/capacitor-plugin-native-file-downloader'
import { Keyboard } from '@capacitor/keyboard';
import { Share } from '@capacitor/share';
import { Clipboard } from '@capacitor/clipboard';
import { BackgroundMode } from '@anuradev/capacitor-background-mode';
import { PIP } from 'tv.megacubo.pip';

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
	clipboard, PIP,
	BackgroundMode
}
