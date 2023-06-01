## Description

**Version :** _0.9.01b_

**NW Custom Frame** allows you to create a custom window frame for your [nw.js](https://nwjs.io/) application in just a few lines of code.

### Features : 
* Fully customizable!
* Persistent Size & Position : You can close the window and open it later the position and size is saved.
* Fullscreen support
* Ultra Lightweight default font icons (contains only the necessary / .woff2 = 2.44kb)

> **Image**

> ![](https://github.com/MeowWoem/nw-custom-frame/raw/master/docs/image_example01.jpg)

## Installation

### Using NPM : 
In the root folder of your [nw.js](https://nwjs.io/) app.

```sh
$ npm install nw-custom-frame
```

### Using Git : 
In the `node_modules` folder of your [nw.js](https://nwjs.io/) app.

```sh
$ git clone https://github.com/MeowWoem/nw-custom-frame.git
```

## Requirement :

Before starts you need to create an [nw.js](https://nwjs.io/) app if it is not already done ([follow this guide if you need](https://github.com/nwjs/nw.js/wiki/Getting-Started-with-nw.js)).

Then in your `package.json` you need to turn off the native frame window : 
```json
/* ... others options ... */
"window": {
	"title": "Your app title",
	"icon": "your_app_icon.png",
	"frame": false
},
/* ... others options ... */
```

**IMPORTANT NOTE : Transparent windows are not totally supported!**

## Quick start

### Create a custom window frame : 

**Theses following lines must be called in the DOM context of your app.**

```javascript
var nwcf = require('nw-custom-frame');
nwcf.attach(window, optionnalOptions); // See below for options list
```

### Customize your frame : 

#### Options list : 

```javascript
defaultOptions = {
	"id": "nw-custom-frame", // ID of title bar container
	"theme": "", // Path to your CSS file
	"uiIconsTheme": "", // Path to your CSS File
	"size": 30, // You can specify the size in em,rem, etc...
	"frameIconSize": 21, // You can specify the size in em,rem, etc...
	"classes": {
		"main": 'nw-cf',
		"inner": 'nw-cf-inner',
		"handle": 'nw-cf-handle',
		"icon": 'nw-cf-icon',
		"title": 'nw-cf-title',
		"buttonsGroup": 'nw-cf-buttons',
		"buttonBase": 'nw-cf-btn',
		"buttons": {
			"minimize": 'nw-cf-minimize',
			"maximize": 'nw-cf-maximize',
			"restore": 'nw-cf-restore',
			"close": 	'nw-cf-close',
		},
		"icons": {
			"minimize": 'nw-cf-icon-minimize',
			"maximize": 'nw-cf-icon-maximize',
			"restore": 'nw-cf-icon-restore',
			"close": 	'nw-cf-icon-close',
		}
	},
	"locales": {
		"en": {
			"close": "Close",
			"maximize": "Maximize",
			"restore": "Restore",
			"minimize": "Minimize",
		},
		"fr": {
			"close": "Fermer",
			"maximize": "Agrandir",
			"restore": "Restaurer",
			"minimize": "Réduire",
		}
	},
};
```

## Planned features

- [ ] Multiple windows support
- [ ] Kiosk mode support