
module.exports = (scope, intent, self, _top) => {
	var prop = 'checker-' + intent.uid
	if(typeof(scope[prop]) == 'undefined'){
		_top.console.log('[youtube.com] skipper')
		if(intent.sideloadAdd){
			_top.console.log('[youtube.com] sideload disabled for this domain')
			intent.sideloadAdd = () => {} // disallow sideload for this domain
		}
		var self = {
			player: false,
			selectors: {
				skipButton: '.videoAdUiSkipButton,.ytp-ad-skip-button',
				preSkipButton: '.videoAdUiPreSkipButton',
				closeBannerAd: '.close-padding.contains-svg,a.close-button,.ytp-ad-overlay-close-button',
				loginRequired: '.yt-player-error-message-renderer .yt-simple-endpoint yt-formatted-string'
			}
		}
		self.reveal = () => {
			_top.console.log('[youtube.com] reveal')	
			if(!intent.started && !intent.error && !intent.ended){
				_top.console.log('[youtube.com] reveal (2)')	
				intent.start()
			}
		}
		self.svad = () => {		
			var sel = scope.document.querySelectorAll(self.selectors.skipButton)
			if (sel.length > 0) {
				_top.console.log('[youtube.com] vad skipped')	
				//scope.document.getElementsByClassName('video-stream html5-main-video')[0].src = ''	
				sel[0].click()
			}
		}		
		self.hoad = () => {		
			var oad = scope.document.getElementsByClassName('ad-container ad-container-single-media-element-annotations')[0];
			if (oad && oad.style.display !== 'none') {
				_top.console.log('[youtube.com] hide oad')
				oad.style.display = 'none';
			}
		}		
		self.clrq = () => {	
			if(!intent.started && !intent.error && !intent.ended){	
				var sel = scope.document.querySelectorAll(self.selectors.loginRequired)
				_top.console.log('[youtube.com] clrq')	
				if (sel.length > 0) {
					self.reveal()
				}
			}
		}			
		self.do = (e) => {		
			_top.console.log('[youtube.com] DOM event listener triggered', e)
			if (e.target.innerHTML.length > 0) {
				self.svad()
				self.hoad()
			} else {
				self.clrq()
			}
		}				
		self.listen = () => {		
			var vad = scope.document.getElementsByClassName('video-ads')[0];		
			if (vad) {		
				_top.console.log('[youtube.com] listen (2)')	
				self.player.removeEventListener('DOMSubtreeModified', self.listen)
				vad.addEventListener('DOMSubtreeModified', self.do)
			}
		}		
		self.hook = () => {		
			if(!self.player){
				self.player = scope.document.querySelector('#player')
				if(self.player){
					_top.console.log('[youtube.com] listen')	
					self.player.addEventListener('DOMSubtreeModified', self.listen)
				}
			}
			return self.player;
		}
		self.wttl = () => {
			var target = scope.document.querySelector('head > title'), observer = new MutationObserver((mutations) => {
				mutations.forEach((mutation) => {
					intent.rename(mutation.target.textContent)
				})
			})
			observer.observe(target, { subtree: true, characterData: true, childList: true })
		}
		_top.console.log('[youtube.com] hooking')
		if(!self.hook()){
			_top.console.log('[youtube.com] hooking (2)')
			scope.addEventListener('load', self.hook)
		}
		scope[prop] = self
	} else {
		scope[prop].clrq()
	}
	var v = scope.document.querySelector('video')
	if(v && v.paused){
		const e = scope.document.querySelector('.ytp-play-button'), ended = () => {
			if(!intent.ended){
				// top.console.warn("GOTCHAAH!!!", v.src, v.currentSrc, v.duration, v.currentTime, v.networkState, v.readyState)
				intent.ended = true;
				intent.emit('end', intent)
			}
		}	
		if(e){
			_top.console.log('[youtube.com] play')	
			e.click()
		}
		v.onloadedmetadata = function() {
			if(v.networkState == 0 && v.readyState == 0){
				ended()
			}
		}
		v.addEventListener('ended', () => {
			ended()
		})
	}
	return true;
}