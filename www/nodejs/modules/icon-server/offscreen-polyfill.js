// Minimal OffscreenCanvas polyfill for renderer environments (browser/WebView)
(function(global){
    if (typeof global.OffscreenCanvas !== 'undefined') return;

    class OffscreenCanvas {
        constructor(w, h){
            this._canvas = (typeof document !== 'undefined') ? document.createElement('canvas') : null;
            if (this._canvas) { this._canvas.width = w; this._canvas.height = h }
            Object.defineProperty(this, 'width', { get: () => this._canvas ? this._canvas.width : w, set: v => { if (this._canvas) this._canvas.width = v } });
            Object.defineProperty(this, 'height', { get: () => this._canvas ? this._canvas.height : h, set: v => { if (this._canvas) this._canvas.height = v } });
        }
        getContext(type, opts){
            return this._canvas ? this._canvas.getContext(type, opts) : null;
        }
        convertToBlob(options){
            return new Promise((resolve) => {
                if (!this._canvas) return resolve(new Blob());
                this._canvas.toBlob(resolve, options && options.type, options && options.quality);
            });
        }
    }

    global.OffscreenCanvas = OffscreenCanvas;
})(typeof window !== 'undefined' ? window : (typeof self !== 'undefined' ? self : globalThis));
