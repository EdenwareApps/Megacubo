
.PHONY: all test benchmark

browserify: bencode.js lib/*.js
	mkdir -p dist
	browserify bencode.js -s bencode -o dist/bencode.js

# TODO: thats not how it should behave!
browser-test: bencode.js lib/*.js test/*.js
	mkdir -p dist
	browserify test/*.test.js -o dist/tests.js
	echo "<script src='tests.js'></script>" > dist/test.html
	# open dist/test.html in your browser now

test:
	npm test

benchmark:
	npm run-script bench

all: browserify test
