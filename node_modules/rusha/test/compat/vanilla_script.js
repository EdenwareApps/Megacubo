describe('Vanilla Script Compatibility', () => {
  it('provides compatibility with Rusha in-process', () => {
    const digest = Rusha.createHash().update('abc').digest('hex');
    expect(digest).to.equal('a9993e364706816aba3e25717850c26c9cd0d89d');
  });

  it('provides compatibility with Rusha worker', () => {
    const promise = new Promise((resolve, reject) => {
      const worker = Rusha.createWorker();
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
