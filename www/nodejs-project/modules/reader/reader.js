// simple wrapper around createReader to prevent fatal errors when the file is deleted before opening

const fs = require('fs');
const EventEmitter = require('events');

const createReadStream = (...args) => {
  let stream;
  try {
    if (!args[0]) throw new Error('Empty file path');
    fs.accessSync(args[0], fs.constants.F_OK);
    stream = fs.createReadStream(...args);
    if (!stream.on) throw new Error('Invalid file stream returned');
    return stream;
  } catch (err) {
    console.error(err);
    const emitter = new EventEmitter();
    emitter.pipe = (destination) => {
      if (destination instanceof EventEmitter) {
        emitter.on('data', (data) => {
          destination.emit('data', data);
        });
        emitter.on('end', () => {
          destination.emit('end');
        });
        emitter.on('error', (error) => {
          destination.emit('error', error);
        });
        emitter.emit('pipe', destination);
      } else {
        const error = new Error('Destination is not a valid EventEmitter');
        emitter.emit('error', error);
      }
      return destination;
    };
    process.nextTick(() => {
      emitter.emit('error', err);
      emitter.emit('close');
    });
    return emitter;
  }
};

module.exports = createReadStream;
