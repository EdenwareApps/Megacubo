## 0.7.0

- Add binary key support (@deoxxa)
- Improve test output format (@jhermsmeier)
- Removed node v0.8 from CI tests

## 0.6.0

- Fixed invalid test data (@themasch)
- Added `Makefile` for browser tests (@themasch)
- Fixed Browserify compatibility (@themasch)

## 0.5.2

- Thorough fix for 64 bit and 53 bit numbers (@pwmckenna)

## 0.5.1

- Added warning on float conversion during encoding (@jhermsmeier)

## 0.5.0

- Added support for 64 bit number values (@pwmckenna)
- Switched benchmark lib to `matcha` (@themasch)
- Fixed npm scripts to work on Windows (@jhermsmeier)

## 0.4.3
 * improved performance a lot
 * dropped support for de- and encoding floats to respect the spec

   *note:* node-bencode will still decodes stuff like "i42.23e" but will cast the
   result to an interger

## 0.4.2
 * bugfix: sort dictionary keys to follow the spec

## 0.4.1
 * bugfix: number decoding was kinda broken

## 0.4.0
 * fixed problems with multibyte strings
 * some performance improvements
 * improved code quality

## 0.3.0
 * #decode() accepts a encoding as its second paramtere

## 0.2.0
 * complete rewrite, @jhermsmeier joins the team

## 0.1.0
 * added encoding

## 0.0.1
First version, decoding only
