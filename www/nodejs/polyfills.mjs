// Polyfill Web APIs for Node.js < 20
// Undici requires these globals to exist

const { File: BufferFile, Blob: BufferBlob } = await import('buffer')

if (typeof globalThis.File === 'undefined') {
	globalThis.File = BufferFile
}

if (typeof globalThis.Blob === 'undefined') {
	globalThis.Blob = BufferBlob
}

