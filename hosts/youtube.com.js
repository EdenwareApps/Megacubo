
module.exports = (scope) => {
	if(document.URL.match('(/embed/|/v/|com/tv)')){
		return {element: scope.document.querySelector('body'), scope: scope}; // fit and reveal this whole page
	} else {
		var v = scope.document.querySelector('video');
		if(v){
			return {element: scope.document.querySelector('video'), scope: scope}; // fit this video element
		} else {
			return false;
		}
	}
}