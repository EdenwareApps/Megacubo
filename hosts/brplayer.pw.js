module.exports = function process(scope){
	var __os = scope.document.querySelectorAll(".play-wrapper")
	if(__os.length) {
		__os[0].click()
	}
	return true; // true = run default fitting
}
