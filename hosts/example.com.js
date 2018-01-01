
module.exports = function process(scope){
	return false; // failed to fetch active video element, fallback to default fitter process()
	return 'http://www.google.com'; // redirect to a proper URL where the video will be found
	return {element: scope.document.querySelector('video'), scope: scope}; // fit this video element
	return {element: scope.document.querySelector('body'), scope: scope}; // fit and reveal this whole page
}