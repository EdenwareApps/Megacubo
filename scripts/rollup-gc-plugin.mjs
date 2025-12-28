// Rollup plugin to call global.gc() after each bundle is written

const getMemUsageMB = () => {
  return parseInt(process.memoryUsage().heapUsed / 1024 / 1024) +'MB';
}

export default function gcPlugin() {
  return {
    name: 'gc-plugin',
    writeBundle() {
      // First GC after bundle is written
      if (global.gc) {
        console.log('-> Running garbage collection after bundle write... ' + getMemUsageMB());
        global.gc();
      }
    },
    closeBundle() {
      // Final GC after all workers and resources are closed
      if (global.gc) {
        console.log('-> Running garbage collection after bundle close... ' + getMemUsageMB());
        global.gc();
      } else {
        console.warn('-> global.gc() is not available. Make sure to run with --expose-gc flag.');
      }
    }
  };
}

