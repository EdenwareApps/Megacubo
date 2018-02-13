
module.exports = function process(scope){
	return false; // false = abort fitting
	return true; // true = run default fitting
	return 'http://www.google.com'; // redirect to a proper URL where the video will be found
	return {element: scope.document.querySelector('video'), scope: scope}; // fit this video element
	return {element: scope.document.querySelector('body'), scope: scope}; // fit and reveal this whole page
}