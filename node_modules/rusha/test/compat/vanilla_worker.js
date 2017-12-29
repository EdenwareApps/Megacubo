describe('Vanilla Worker Compatibility', () => {
  it('provides compatibility with Rusha worker', () => {
    const promise = new Promise((resolve, reject) => {
      const worker = new Worker('/base/dist/rusha.min.js');
      worker.onmessage = (e) => {
        worker.terminate();
        if (e.data.error) {
          reject(e.data.error);
        } else {
          resolve(e.data.hash);
        }
      };
      worker.postMessage({id: 0, data: 'abc'});
    });

    return expect(promise).to.eventually.equal('a9993e364706816aba3e25717850c26c9cd0d89d');
  });
});
