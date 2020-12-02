// thanks @bengfarrell https://github.com/oliver-moran/jimp/issues/753#issuecomment-574852816

function isTransparent(rgba){
	return rgba.a === 0
}
function isWhite(rgba){
	return rgba.r === 255 &&  rgba.g === 255 &&  rgba.b === 255
}
function isBlack(rgba){
	return rgba.r === 0 &&  rgba.g === 0 &&  rgba.b === 0
}
function findLeftSide(scope, w, h, c) {
	for (let x = 0; x < w; x++) {
		for ( let y = 0; y < h; y++) {
			const rgba = scope.constructor.intToRGBA(scope.getPixelColor(x, y))
			if (rgba.a != 0 && rgba != c) {
				return x
			}
		}
	}
}
function findRightSide(scope, w, h, c) {
	for (let x = w; x > 0; x--) {
		for ( let y = 0; y < h; y++) {
			const rgba = scope.constructor.intToRGBA(scope.getPixelColor(x, y))
			if (rgba.a != 0 && rgba != c) {
				return x
			}
		}
	}
}
function findTopSide(scope, w, h, c) {
	for ( let y = 0; y < h; y++) {
		for (let x = 0; x < w; x++) {
			const rgba = scope.constructor.intToRGBA(scope.getPixelColor(x, y))
			if (rgba.a != 0 && rgba != c) {
				return y
			}
		}
	}
}
function findBottomSide(scope, w, h, c) {
	for ( let y = h; y > 0; y--) {
		for (let x = 0; x < w; x++) {
			const rgba = scope.constructor.intToRGBA(scope.getPixelColor(x, y))
			if (rgba.a != 0 && rgba != c) {
				return y
			}
		}
	}
}
module.exports = function autocrop() {
	const w = this.bitmap.width
	const h = this.bitmap.height
	let firstPixelColor = this.constructor.intToRGBA(this.getPixelColor(0, 0))
	if(!(isTransparent(firstPixelColor) || isWhite(firstPixelColor) || isBlack(firstPixelColor))){
		firstPixelColor = {r: 0, g: 0, b: 0, a: 0}
	}
	const l = findLeftSide(this, w, h, firstPixelColor)
	const r = findRightSide(this, w, h, firstPixelColor)
	const t = findTopSide(this, w, h, firstPixelColor)
	const b = findBottomSide(this, w, h, firstPixelColor)
	if(l < (w * 0.4) && r > (w * 0.6) && t < (h * 0.4) && b > (h * 0.6)){ // seems valid values
		if(b > t && r > l){ // seems valid values
			this.crop(l, t, w - (w - r + l), h - (h - b + t))
		} else {
			console.error('Bad values for autocrop', w, h, firstPixelColor, t, b, l, r)
		}
	} else {
		console.error('Bad values for autocrop*', w, h, firstPixelColor, t, b, l, r)
	}
	return this
}
