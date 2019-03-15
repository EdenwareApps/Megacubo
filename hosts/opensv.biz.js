module.exports = function process(scope){
	var c = scope.document.querySelector('.playButton')
	if(c){
		c.click()
	}
	return true;
}