'use strict';

const assert = require('assert');
const fs = require('fs');

const Rusha = require('../../dist/rusha.js');

const hashInWorker = (createWorker, input) => {
  return new Promise((resolve, reject) => {
    const worker = createWorker();
    worker.onmessage = (e) => {
      worker.terminate();
      if (e.data.error) {
        reject(e.data.error);
      } else {
        resolve(e.data.hash);
      }
    };
    worker.postMessage(Object.assign({id: 0}, input));
  });
};

describe('Rusha Worker', () => {
  describe('createWorker', () => {
    it('spawns a new worker`', () => {
      const blob = new Blob([]);
      return expect(hashInWorker(Rusha.createWorker, {data: blob}))
        .to.eventually.equal('da39a3ee5e6b4b0d3255bfef95601890afd80709');
    });
  });

  describe('automagic worker behaviour', () => {
    it('spawns when used by Worker constructor', () => {
      const workerSource = fs.readFileSync(__dirname + '/../../dist/rusha.min.js', 'utf8');
      const workerBlob = new Blob([workerSource]);
      const workerURL = URL.createObjectURL(workerBlob);
      const blob = new Blob([]);
      return expect(hashInWorker(() => new Worker(workerURL), {data: blob}))
        .to.eventually.equal('da39a3ee5e6b4b0d3255bfef95601890afd80709');
    });

    it('can be disabled', (done) => {
      const workerSource = fs.readFileSync(__dirname + '/../../dist/rusha.min.js', 'utf8');
      const workerBlob = new Blob([workerSource, 'Rusha.disableWorkerBehaviour();']);
      const workerURL = URL.createObjectURL(workerBlob);
      const rw = new Worker(workerURL);
      const blob = new Blob([]);
      let gotReply = false
      rw.onmessage = (e) => {
        gotReply = true;
      };
      rw.postMessage({id: 0, data: blob});
      setTimeout(() => {
        assert(!gotReply);
        done();
      }, 1000);
    });
  });

  describe('hashing', () => {
    it('1 kiB', () => {
      const zero1k = new Int8Array(1024);
      for (let i = 0; i < 1024; i++) {
        zero1k[i] = i;
      }
      const blob = new Blob([zero1k]);
      return expect(hashInWorker(Rusha.createWorker, {data: blob}))
        .to.eventually.equal('5b00669c480d5cffbdfa8bdba99561160f2d1b77');
    });

    it('1 kiB file', () => {
      const zero1k = new Int8Array(1024);
      for (let i = 0; i < 1024; i++) {
        zero1k[i] = i;
      }
      const blob = new Blob([zero1k]);
      return expect(hashInWorker(Rusha.createWorker, {file: blob}))
        .to.eventually.equal('5b00669c480d5cffbdfa8bdba99561160f2d1b77');
    });

    it('1 MiB', () => {
      const zero1M = new Int8Array(1024 * 1024);
      for (let i = 0; i < 1024 * 1024; i++) {
        zero1M[i] = i;
      }
      const blob = new Blob([zero1M]);
      return expect(hashInWorker(Rusha.createWorker, {data: blob}))
        .to.eventually.equal('ecfc8e86fdd83811f9cc9bf500993b63069923be');
    });

    it('1 MiB file', () => {
      const zero1M = new Int8Array(1024 * 1024);
      for (let i = 0; i < 1024 * 1024; i++) {
        zero1M[i] = i;
      }
      const blob = new Blob([zero1M]);
      return expect(hashInWorker(Rusha.createWorker, {file: blob}))
        .to.eventually.equal('ecfc8e86fdd83811f9cc9bf500993b63069923be');
    });

    it('10 MiB', () => {
      const zero1M = new Int8Array(1024 * 1024);
      for (let i = 0; i < 1024 * 1024; i++) {
        zero1M[i] = i;
      }
      const blob = new Blob(new Array(8).fill(zero1M));
      return expect(hashInWorker(Rusha.createWorker, {data: blob}))
        .to.eventually.equal('2f9ae0e3d61b155cb367ef711bda8c5ee2924954');
    });

    it('10 MiB file', () => {
      const zero1M = new Int8Array(1024 * 1024);
      for (let i = 0; i < 1024 * 1024; i++) {
        zero1M[i] = i;
      }
      const blob = new Blob(new Array(8).fill(zero1M));
      return expect(hashInWorker(Rusha.createWorker, {file: blob}))
        .to.eventually.equal('2f9ae0e3d61b155cb367ef711bda8c5ee2924954');
    });
  });
});
