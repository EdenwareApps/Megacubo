var json = require('./package.json'), fs = require('fs'), path = require('path');
function extend(obj) {
	Array.prototype.slice.call(arguments, 1).forEach(function (source) {
		if (source) {
			for (var prop in source) {
				if (source[prop].constructor === Object) {
					if (!obj[prop] || obj[prop].constructor === Object) {
						obj[prop] = obj[prop] || {};
						extend(obj[prop], source[prop]);
					} else {
						obj[prop] = source[prop];
					}
				} else {
					obj[prop] = source[prop];
				}
			}
		}
	});
	return obj;
}
var _defaultAppIcon = "default_icon.png";
var _defaultTheme = "nw-custom-frame-theme.css";
var _defaultOptions = {
	"id": "nw-custom-frame",
	"theme": "",
	"uiIconsTheme": "",
	"layout": "horizontal",
	"position": "top",
	"size": 30,
	"frameIconSize": 21,
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
			"close": 'nw-cf-close',
		},
		"icons": {
			"minimize": 'nw-cf-icon-minimize',
			"maximize": 'nw-cf-icon-maximize',
			"restore": 'nw-cf-icon-restore',
			"close": 'nw-cf-icon-close',
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
	"includeCSS": true,
};
var getFavicon = function (document) {
	var favicon;
	var nodeList = document.getElementsByTagName("link");
	for (var i = 0; i < nodeList.length; i++) {
		if ((nodeList[i].getAttribute("rel") === "icon") || (nodeList[i].getAttribute("rel") === "shortcut icon")) {
			favicon = nodeList[i].getAttribute("href");
		}
	}
	return favicon;
};
class CustomFrame {
	constructor(_window, options) {
		this.initialized = false;
		this.options = extend({}, _defaultOptions, options);
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
		if (that.window.localStorage.nwCustomFrameState === undefined) {
			that.window.localStorage.nwCustomFrameState = "initial";
		}
		var currentLocale = window.navigator.language;
		var locales = options.locales[currentLocale] !== undefined ? options.locales[currentLocale] : options.locales[Object.keys(options.locales)[0]];
		var mainContainer = this.createElement("header", {id: options.id, class: options.classes.main})
		var innerContainer = this.createElement("div", {class: options.classes.inner}, null, mainContainer)
		var handleContainer = this.createElement("div", {class: options.classes.handle, style: '-webkit-app-region:drag;'}, null, innerContainer)
		var frameIcon = this.createElement("span", {class: options.classes.icon}, null, handleContainer);
		var favicon
		if (options.details.icon !== undefined) {
			var filename = path.resolve(options.details.icon);
			if (fs.existsSync(filename)) {
				favicon = filename;
			}
		}
		if (!favicon) {
			favicon = getFavicon(this.document) || _defaultAppIcon;
		}
		frameIcon.setAttribute("style", "background-image: url('" + favicon.replace(new RegExp('\\' + path.sep, 'g'), '/') + "')");
		var titleStr;
		if (this.document.getElementsByTagName('title').length !== 0) {
			titleStr = this.document.title;
		} else if (options.details.title !== undefined) {
			titleStr = this.document.title = options.details.title;
		} else {
			titleStr = this.document.title = "Custom Frame";
		}
		var titleSpan = this.createElement("span", {class: options.classes.title}, null, handleContainer)
		titleSpan.innerHTML = titleStr

		var buttonsContainer = this.createElement("div", { class: options.classes.buttonsGroup }, null, innerContainer);
		var buttonMinimize = this.createElement("button", { class: options.classes.buttonBase + " " + options.classes.buttons.minimize, title: locales.minimize }, null, buttonsContainer);
		var buttonMaximize = this.createElement("button", { class: options.classes.buttonBase + " " + options.classes.buttons.maximize, title: locales.maximize }, null, buttonsContainer);
		var buttonRestore = this.createElement("button", { class: options.classes.buttonBase + " " + options.classes.buttons.restore, title: locales.restore }, null, buttonsContainer);
		var buttonClose = this.createElement("button", { class: options.classes.buttonBase + " " + options.classes.buttons.close, title: locales.close }, null, buttonsContainer);

		var iconMinimize = document.createElement("i");
		iconMinimize.setAttribute("class", options.classes.icons.minimize);
		buttonMinimize.appendChild(iconMinimize);
		var iconMaximize = document.createElement("i");
		iconMaximize.setAttribute("class", options.classes.icons.maximize);
		buttonMaximize.appendChild(iconMaximize);
		var iconRestore = document.createElement("i");
		iconRestore.setAttribute("class", options.classes.icons.restore);
		buttonRestore.appendChild(iconRestore);
		var iconClose = document.createElement("i");
		iconClose.setAttribute("class", options.classes.icons.close);
		buttonClose.appendChild(iconClose);
		var size = options.win.getSize();
		var initialPosX = options.win.x, initialPosY = options.win.y;
		var initialSizeW = size[0], initialSizeH = size[1];
		if (options.customFrameState === "maximized") {
			buttonMaximize.setAttribute("style", buttonMaximize.getAttribute("style") === null ? "display: none;" : buttonMaximize.getAttribute("style") + "display: none;");
			options.win.maximize();
		} else if (options.customFrameState === "fullscreen") {
			(options.win.enterFullscreen || options.win.setFullScreen)(true);
		} else {
			buttonRestore.setAttribute("style", buttonRestore.getAttribute("style") === null ? "display: none;" : buttonRestore.getAttribute("style") + "display: none;");
		}
		options.win.removeAllListeners("restore");
		options.win.removeAllListeners("minimize");
		options.win.removeAllListeners("maximize");
		options.win.removeAllListeners("enter-fullscreen");
		options.win.removeAllListeners("leave-fullscreen");
		options.win.removeAllListeners("close");
		options.win.on("maximize", function () {
			that.window.localStorage.nwCustomFrameState = "maximized";
			if (buttonMaximize.getAttribute("style") === null ||
				(buttonMaximize.getAttribute("style") !== null && buttonMaximize.getAttribute("style").indexOf("display: none;") === -1)) {
				buttonMaximize.setAttribute("style", buttonMaximize.getAttribute("style") === null ? "display: none;" : buttonMaximize.getAttribute("style") + "display: none;");
			}
			buttonRestore.setAttribute("style", buttonRestore.getAttribute("style").replace("display: none;", ""));
			that.window.localStorage.nwCustomFramePosX = initialPosX;
			that.window.localStorage.nwCustomFramePosY = initialPosY;
			that.window.localStorage.nwCustomFrameSizeW = initialSizeW;
			that.window.localStorage.nwCustomFrameSizeH = initialSizeH;
		});
		var stateBeforeFullScreen;
		options.win.on("enter-fullscreen", function () {
			stateBeforeFullScreen = that.window.localStorage.nwCustomFrameState;
			that.window.localStorage.nwCustomFrameState = "fullscreen";
			mainContainer.setAttribute("style", mainContainer.getAttribute("style") === null ? "display: none;" : mainContainer.getAttribute("style") + "display: none;");
		});
		options.win.on("leave-fullscreen", function () {
			that.window.localStorage.nwCustomFrameState = stateBeforeFullScreen === "maximized" ? stateBeforeFullScreen : "restored";
			mainContainer.setAttribute("style", mainContainer.getAttribute("style").replace("display: none;", ""));
		});
		options.win.on("restore", function () {
			that.window.localStorage.nwCustomFrameState = "restored";
			buttonRestore.setAttribute("style", buttonRestore.getAttribute("style") === null ? "display: none;" : buttonRestore.getAttribute("style") + "display: none;");
			buttonMaximize.setAttribute("style", buttonMaximize.getAttribute("style").replace("display: none;", ""));
			mainContainer.setAttribute("style", mainContainer.getAttribute("style").replace("display: none;", ""));
		});
		options.win.on("minimize", function () {
			that.window.localStorage.nwCustomFrameState = "minimized";
		});
		options.win.on("close", function () {
			if (that.window.localStorage.nwCustomFrameState !== "maximized") {
				that.window.localStorage.nwCustomFramePosX = options.win.x;
				that.window.localStorage.nwCustomFramePosY = options.win.y;
				that.window.localStorage.nwCustomFrameSizeW = size[0];
				that.window.localStorage.nwCustomFrameSizeH = size[1];
			}
			options.win.removeAllListeners("restore");
			options.win.removeAllListeners("minimize");
			options.win.removeAllListeners("maximize");
			options.win.removeAllListeners("enter-fullscreen");
			options.win.removeAllListeners("leave-fullscreen");
			options.win.close(true);
		});
		buttonMinimize.addEventListener('click', function () {
			options.win.minimize();
		});
		buttonMaximize.addEventListener('click', function () {
			initialPosX = options.win.x;
			initialPosY = options.win.y;
			initialSizeW = size[0];
			initialSizeH = size[1];
			options.win.maximize();
		});
		buttonRestore.addEventListener('click', function () {
			options.win.restore();
		});
		buttonClose.addEventListener('click', function () {
			options.win.close();
		});
		function outerHeight(el) {
			var height = el.offsetHeight;
			var style = getComputedStyle(el);
			height += parseInt(style.marginTop) + parseInt(style.marginBottom);
			return height;
		}
		function finish() {
			var _getPositionHLayout = function (pos) {
				if (pos === "left") {
					pos = "top";
				} else if (pos === "right") {
					pos = "bottom";
				}
				return pos;
			};
			var _getPositionVLayout = function (pos) {
				if (pos === "top") {
					pos = "left";
				} else if (pos === "bottom") {
					pos = "right";
				}
				return pos;
			};
			var body = that.document.body;
			var bodyStyle = getComputedStyle(body);
			var pos = "top";
			/*
			switch(options.layout) {
				case "horizontal":
					pos = _getPositionHLayout(options.position);
					break;
				case "vertical":
					pos = _getPositionVLayout(options.position);
					break;
			}
			*/
			mainContainer.style.position = "fixed";
			mainContainer.style.width = "100%";
			mainContainer.style.height = Number.isInteger(options.size) ? options.size + "px" : options.size;
			mainContainer.style.lineHeight = mainContainer.style.height;
			mainContainer.style.boxSizing = "border-box";
			innerContainer.style.display = "flex";
			handleContainer.style.height = mainContainer.style.height;
			handleContainer.style.lineHeight = mainContainer.style.height;
			handleContainer.style.flex = "1 0 0";
			frameIcon.style.width = Number.isInteger(options.frameIconSize) ? options.frameIconSize + "px" : options.frameIconSize;
			frameIcon.style.backgroundSize = frameIcon.style.width;
			frameIcon.style.height = mainContainer.style.height;
			frameIcon.style.display = "inline-block";
			frameIcon.style.verticalAlign = "inherit";
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
			switch (pos) {
				case "top":
					mainContainer.style.top = 0;
					mainContainer.style.left = 0;
					body.style.marginTop = mainContainer.offsetHeight + "px";
					break;
				case "bottom":
					mainContainer.style.bottom = 0;
					mainContainer.style.left = 0;
					body.style.marginBottom = mainContainer.offsetHeight + "px";
					break;
			}
		}
		if (options.includeCSS) {
			var coreLoaded = false, themeLoaded = false, iconLoaded = false;
			var onLoad = function () {
				if (coreLoaded && themeLoaded && iconLoaded) {
					finish();
				}
			};
			if (json.style !== undefined) {
				new Promise(function (res) {
					var cssFilename = json.style.endsWith('.css') ? json.style : json.style + '.css';
					var linkHref = path.resolve(__dirname, cssFilename);
					if (fs.existsSync(linkHref)) {
						var link = document.createElement('style');
						link.innerHTML = fs.readFileSync(linkHref);
						that.document.head.appendChild(link);
						res();
					} else {
						res();
					}
				}).then(function () {
					coreLoaded = true;
					onLoad()
				});
			}
			if(!options.uiIconsTheme){
				var _path = __dirname.replace(process.cwd(), '').replace(new RegExp('\\\\', 'g'), '/').substr(1)
				if(_path.startsWith('package.nw')){
					_path = _path.substr(10)
				}
				if(!_path.startsWith('/')) {
					_path = '/'+ _path
				}
				options.uiIconsTheme = '.'+ _path + '/icons/css/nw-cf-fa.css';
			}
			var link = document.createElement('link');
			link.setAttribute('rel', 'stylesheet');
			link.setAttribute('type', 'text/css');
			link.setAttribute('href', options.uiIconsTheme);
			link.onload = function (e) {
				iconLoaded = true;
				onLoad();
			};
			link.async = false;
			that.document.head.appendChild(link);
			var linkHref = path.resolve(__dirname, _defaultTheme);
			if (fs.existsSync(linkHref)) {
				var link = document.createElement('style');
				link.innerHTML = fs.readFileSync(linkHref);
				that.document.head.appendChild(link);
			}
			themeLoaded = true;
			onLoad();
		} else {
			finish();
		}
	}
}
exports.attach = function (_window, options) {
	var cf = new CustomFrame(_window, options);
	cf.create();
	options.win.__cfInitialized = true;
}
