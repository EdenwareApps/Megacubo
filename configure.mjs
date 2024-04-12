import fs from 'fs';

async function cp(file, dest) {
	let err
	await fs.promises.copyFile(file, dest).catch(e => {
		err = e
		console.error(e)
	})
	err || console.log('COPIED: '+file +' => '+ dest)
}

async function main() {
	await cp('assets/banner.png', 'android/app/src/main/res/drawable/banner.png')
	for (const file of [
		'android/app/src/main/res/mipmap-ldpi/icon.png',
		'android/app/src/main/res/mipmap-mdpi/icon.png',
		'android/app/src/main/res/mipmap-hdpi/icon.png',
		'android/app/src/main/res/mipmap-xhdpi/icon.png',
		'android/app/src/main/res/mipmap-xxhdpi/icon.png'
	]) {
		await cp('assets/notification.png', file)
	}
}

main()
