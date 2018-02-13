
module.exports = (scope) => {
	var match;
	var url = scope.document.URL, useYTTV = false;
	if(useYTTV){
		if(url.match('(/embed/|/v/|com/tv)')){
			return {element: scope.document.querySelector('body'), scope: scope}; // fit and reveal this whole page
		} else if(match=url.match(new RegExp('v=([^&#\\?]+)'))) {
			var id = match[1];
			return 'https://www.youtube.com/tv#/watch/video/control?v='+id+'#nofit';
			// https://www.youtube.com/tv#/watch/video/control?v=TVrN96ZX9v0 // &resume
		} else {
			if(top != window){
				return true;
			}
			return {element: scope.document.querySelector('body'), scope: scope}; // fit and reveal this whole page;
		}
	} else {
		if(url.match('(/embed/|/v/)')){
			return {element: scope.document.querySelector('body'), scope: scope}; // fit and reveal this whole page
		} else if(match=url.match(new RegExp('v=([^&#\\?]+)'))) {
			var id = match[1];
			return 'https://www.youtube.com/embed/'+id+'?autoplay=1&rel=0&showinfo=0#nofit';
		} else {
			if(top != window){
				return true;
			}
			return {element: scope.document.querySelector('body'), scope: scope}; // fit and reveal this whole page;
		}
	}
}