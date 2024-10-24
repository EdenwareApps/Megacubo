var _defaultAppIcon = 'default_icon.png';
var _defaultOptions = {
	'id': 'custom-frame',
	'theme': '',
	'uiIconsTheme': '',
	'layout': 'horizontal',
	'position': 'top',
	'size': 30,
	'frameIconSize': 21,
	'classes': {
		'main': 'cf',
		'inner': 'cf-inner',
		'handle': 'cf-handle',
		'icon': 'cf-icon',
		'title': 'cf-title',
		'buttonsGroup': 'cf-buttons',
		'buttonBase': 'cf-btn',
		'buttons': {
			'minimize': 'cf-minimize',
			'maximize': 'cf-maximize',
			'restore': 'cf-restore',
			'close': 'cf-close',
		},
		'icons': {
			'minimize': 'cf-icon-minimize',
			'maximize': 'cf-icon-maximize',
			'restore': 'cf-icon-restore',
			'close': 'cf-icon-close',
		}
	},
	'locales': {
		'en': {
			'close': 'Close',
			'maximize': 'Maximize',
			'restore': 'Restore',
			'minimize': 'Minimize',
		},
		'fr': {
			'close': 'Fermer',
			'maximize': 'Agrandir',
			'restore': 'Restaurer',
			'minimize': 'Réduire',
		}
	}
};
var getFavicon = function (document) {
	var favicon;
	var nodeList = document.getElementsByTagName('link');
	for (var i = 0; i < nodeList.length; i++) {
		if ((nodeList[i].getAttribute('rel') === 'icon') || (nodeList[i].getAttribute('rel') === 'shortcut icon')) {
			favicon = nodeList[i].getAttribute('href');
		}
	}
	return favicon;
};
class CustomFrame {
	constructor(_window, options) {
		this.initialized = false;
		this.options = Object.assign(_defaultOptions, options);
		this.window = _window;
		this.document = _window.document;
	}
	createElement(name, attributes, styles, parentNode) {
		const element = document.createElement(name)
		if (attributes) {
			for (const key in attributes) {
				if (Object.hasOwnProperty.call(attributes, key)) {
					element.setAttribute(key, attributes[key])
				}
			}
		}
		if (styles) {
			for (const key in styles) {
				if (Object.hasOwnProperty.call(styles, key)) {
					element.style[key] = styles[key]
				}
			}
		}
		if (parentNode) {
			parentNode.appendChild(element)
		}
		return element
	}
	create() {
		var that = this;
		var options = this.options;
		if (that.window.localStorage.customFrameState === undefined) {
			that.window.localStorage.customFrameState = 'initial';
		}
		var currentLocale = window.navigator.language;
		var locales = options.locales[currentLocale] !== undefined ? options.locales[currentLocale] : options.locales[Object.keys(options.locales)[0]];
		var mainContainer = this.createElement('header', { id: options.id, class: options.classes.main }, {
			height: Number.isInteger(options.size) ? options.size + 'px' : options.size
		})
		var innerContainer = this.createElement('div', { class: 'cf-inner' }, null, mainContainer)
		var handleContainer = this.createElement('div', { class: 'cf-handle' }, { height: mainContainer.style.height, lineHeight: mainContainer.style.height }, innerContainer)
		var favicon
		if (options.details.icon !== undefined) {
			favicon = options.details.icon;
		}
		if (!favicon) {
			favicon = getFavicon(this.document) || _defaultAppIcon;
		}
		var frameIcon = this.createElement('span', { class: 'cf-icon' }, { width: Number.isInteger(options.frameIconSize) ? options.frameIconSize + 'px' : options.frameIconSize, height: mainContainer.style.height, backgroundImage: 'url("' + favicon + '")' }, handleContainer);
		frameIcon.style.backgroundSize = frameIcon.style.width
		var titleStr;
		if (this.document.getElementsByTagName('title').length !== 0) {
			titleStr = this.document.title;
		} else if (options.details.title !== undefined) {
			titleStr = this.document.title = options.details.title;
		} else {
			titleStr = this.document.title = 'Custom Frame';
		}
		var titleSpan = this.createElement('span', { class: options.classes.title }, null, handleContainer)
		titleSpan.innerHTML = titleStr

		var buttonsContainer = this.createElement('div', { class: options.classes.buttonsGroup }, null, innerContainer);
		var buttonMinimize = this.createElement('button', { class: options.classes.buttonBase + ' ' + options.classes.buttons.minimize, title: locales.minimize }, null, buttonsContainer);
		var buttonMaximize = this.createElement('button', { class: options.classes.buttonBase + ' ' + options.classes.buttons.maximize, title: locales.maximize }, null, buttonsContainer);
		var buttonRestore = this.createElement('button', { class: options.classes.buttonBase + ' ' + options.classes.buttons.restore, title: locales.restore }, null, buttonsContainer);
		var buttonClose = this.createElement('button', { class: options.classes.buttonBase + ' ' + options.classes.buttons.close, title: locales.close }, null, buttonsContainer);

		var iconMinimize = document.createElement('i');
		iconMinimize.setAttribute('class', options.classes.icons.minimize);
		buttonMinimize.appendChild(iconMinimize);
		var iconMaximize = document.createElement('i');
		iconMaximize.setAttribute('class', options.classes.icons.maximize);
		buttonMaximize.appendChild(iconMaximize);
		var iconRestore = document.createElement('i');
		iconRestore.setAttribute('class', options.classes.icons.restore);
		buttonRestore.appendChild(iconRestore);
		var iconClose = document.createElement('i');
		iconClose.setAttribute('class', options.classes.icons.close);
		buttonClose.appendChild(iconClose);
		var size = options.win.getSize()
		var position = options.win.getPosition()
		var initialPosX = position[0], initialPosY = position[1]
		var initialSizeW = size[0], initialSizeH = size[1];
		if (options.customFrameState === 'maximized') {
			buttonMaximize.setAttribute('style', buttonMaximize.getAttribute('style') === null ? 'display: none;' : buttonMaximize.getAttribute('style') + 'display: none;');
			options.win.maximize();
		} else if (options.customFrameState === 'fullscreen') {
			(options.win.enterFullscreen || options.win.setFullScreen)(true);
		} else {
			buttonRestore.setAttribute('style', buttonRestore.getAttribute('style') === null ? 'display: none;' : buttonRestore.getAttribute('style') + 'display: none;');
		}
		options.win.removeAllListeners('restore');
		options.win.removeAllListeners('minimize');
		options.win.removeAllListeners('maximize');
		options.win.removeAllListeners('enter-fullscreen');
		options.win.removeAllListeners('leave-fullscreen');
		options.win.removeAllListeners('close');
		options.win.on('maximize', function () {
			that.window.localStorage.customFrameState = 'maximized';
			if (buttonMaximize.getAttribute('style') === null ||
				(buttonMaximize.getAttribute('style') !== null && !buttonMaximize.getAttribute('style').includes('display: none;'))) {
				buttonMaximize.setAttribute('style', buttonMaximize.getAttribute('style') === null ? 'display: none;' : buttonMaximize.getAttribute('style') + 'display: none;');
			}
			buttonRestore.setAttribute('style', buttonRestore.getAttribute('style').replace('display: none;', ''));
			that.window.localStorage.customFramePosX = initialPosX;
			that.window.localStorage.customFramePosY = initialPosY;
			that.window.localStorage.customFrameSizeW = initialSizeW;
			that.window.localStorage.customFrameSizeH = initialSizeH;
		});
		var stateBeforeFullScreen;
		options.win.on('enter-fullscreen', function () {
			stateBeforeFullScreen = that.window.localStorage.customFrameState;
			that.window.localStorage.customFrameState = 'fullscreen';
			mainContainer.setAttribute('style', mainContainer.getAttribute('style') === null ? 'display: none;' : mainContainer.getAttribute('style') + 'display: none;');
		});
		options.win.on('leave-fullscreen', function () {
			that.window.localStorage.customFrameState = stateBeforeFullScreen === 'maximized' ? stateBeforeFullScreen : 'restored';
			mainContainer.setAttribute('style', mainContainer.getAttribute('style').replace('display: none;', ''));
		});
		options.win.on('restore', function () {
			that.window.localStorage.customFrameState = 'restored';
			buttonRestore.setAttribute('style', buttonRestore.getAttribute('style') === null ? 'display: none;' : buttonRestore.getAttribute('style') + 'display: none;');
			buttonMaximize.setAttribute('style', buttonMaximize.getAttribute('style').replace('display: none;', ''));
			mainContainer.setAttribute('style', mainContainer.getAttribute('style').replace('display: none;', ''));
		});
		options.win.on('minimize', function () {
			that.window.localStorage.customFrameState = 'minimized';
		});
		options.win.on('close', function () {
			if (that.window.localStorage.customFrameState !== 'maximized') {
				const position = options.win.getPosition(), size = options.win.getSize()
				that.window.localStorage.customFramePosX = position[0];
				that.window.localStorage.customFramePosY = position[1];
				that.window.localStorage.customFrameSizeW = size[0];
				that.window.localStorage.customFrameSizeH = size[1];
			}
			options.win.removeAllListeners('restore');
			options.win.removeAllListeners('minimize');
			options.win.removeAllListeners('maximize');
			options.win.removeAllListeners('enter-fullscreen');
			options.win.removeAllListeners('leave-fullscreen');
			options.win.close(true);
		});
		buttonMinimize.addEventListener('click', function () {
			options.win.minimize();
		}, {passive: true});
		buttonMaximize.addEventListener('click', function () {
			const position = options.win.getPosition()
			initialPosX = position[0];
			initialPosY = position[1];
			initialSizeW = size[0];
			initialSizeH = size[1];
			options.win.maximize();
		}, {passive: true});
		buttonRestore.addEventListener('click', function () {
			options.win.restore();
		}, {passive: true});
		buttonClose.addEventListener('click', function () {
			options.win.close();
		}, {passive: true});
		
		this.createElement('link', { href: options.style, rel: 'stylesheet', type: 'text/css' }, null, that.document.head);
		this.createElement('link', { href: options.uiIconsTheme, rel: 'stylesheet', type: 'text/css' }, null, that.document.head);
		this.createElement('link', { href: options.frameTheme, rel: 'stylesheet', type: 'text/css' }, null, that.document.head);

		var body = that.document.body;
		buttonsContainer.style.height = mainContainer.style.height;
		buttonsContainer.style.lineHeight = mainContainer.style.height;
		buttonMinimize.style.height = mainContainer.style.height;
		buttonMinimize.style.lineHeight = mainContainer.style.height;
		buttonMaximize.style.height = mainContainer.style.height;
		buttonMaximize.style.lineHeight = mainContainer.style.height;
		buttonRestore.style.height = mainContainer.style.height;
		buttonRestore.style.lineHeight = mainContainer.style.height;
		buttonClose.style.height = mainContainer.style.height;
		buttonClose.style.lineHeight = mainContainer.style.height;
		body.insertBefore(mainContainer, body.firstChild);
		mainContainer.style.top = 0;
		mainContainer.style.left = 0;
		body.style.marginTop = mainContainer.offsetHeight + 'px';
	}
}
CustomFrame.attach = (_window, options) => {
	const cf = new CustomFrame(_window, options)
	cf.create()
}
