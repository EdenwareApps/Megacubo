// thanks @bengfarrell https://github.com/oliver-moran/jimp/issues/753#issuecomment-574852816

const alphaIgnoreLevel = 255 * 0.1

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
	let halfWidth = w / 2
	for (let x = 0; x < halfWidth; x++) {
		for ( let y = 0; y < h; y++) {
			const rgba = scope.constructor.intToRGBA(scope.getPixelColor(x, y))
			if (rgba.a > alphaIgnoreLevel && rgba != c) {
				//console.log('FINDLEFTSIDE', y, x, rgba, c)
				return x
			}
		}
	}
	return 0
}
function findRightSide(scope, w, h, c) {
	let halfWidth = w / 2
	for (let x = w; x > halfWidth; x--) {
		for ( let y = 0; y < h; y++) {
			const rgba = scope.constructor.intToRGBA(scope.getPixelColor(x, y))
			if (rgba.a > alphaIgnoreLevel && rgba != c) {
				return x
			}
		}
	}
	return w
}
function findTopSide(scope, w, h, c) {
	let halfHeight = h / 2
	for ( let y = 0; y < halfHeight; y++) {
		for (let x = 0; x < w; x++) {
			const rgba = scope.constructor.intToRGBA(scope.getPixelColor(x, y))
			if (rgba.a > alphaIgnoreLevel && rgba != c) {
				//console.log('FINDTOPSIDE', y, x, rgba, c)
				return y
			}
		}
	}
	return 0
}
function findBottomSide(scope, w, h, c) {
	let halfHeight = h / 2
	for ( let y = h; y > halfHeight; y--) {
		for (let x = 0; x < w; x++) {
			const rgba = scope.constructor.intToRGBA(scope.getPixelColor(x, y))
			if (rgba.a > alphaIgnoreLevel && rgba != c) {
				//console.log('FINDBOTTOMSIDE', y, x, rgba, c)
				return y
			}
		}
	}
	return h
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
	//console.log('AUTOCROP', {l,r,t,b,firstPixelColor,w,h})
	if(l < (w * 0.4) && r > (w * 0.6) && t < (h * 0.4) && b > (h * 0.6)){ // seems valid values
		if(b > t && r > l){ // seems valid values
			if(l > 0 || t > 0 || r < w || b < h){
				this.crop(l, t, w - (w - r + l), h - (h - b + t))
			} else {
				//console.log('cropping not needed')
			}
		} else {
			console.error('Bad values for autocrop', w, h, firstPixelColor, t, b, l, r)
		}
	} else {
		console.error('Bad values for autocrop*', w, h, firstPixelColor, t, b, l, r)
	}
	return this
}
