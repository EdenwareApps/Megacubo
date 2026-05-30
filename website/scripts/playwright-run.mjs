import net from 'node:net';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address?.port ? address.port : undefined;
      server.close((error) => {
        if (error) return reject(error);
        if (port === undefined) return reject(new Error('Failed to determine a free port'));
        resolve(port);
      });
    });
  });
}

const port = process.env.DOCUSSAURUS_PORT ? Number(process.env.DOCUSSAURUS_PORT) : await getFreePort();
console.log(`Using Docusaurus port ${port} (DOCUSAURUS_PORT=${process.env.DOCUSSAURUS_PORT ?? 'unset'})`);
console.log(`Starting Playwright with base URL http://127.0.0.1:${port}`);
const userArgs = process.argv.slice(2);
const hasReporter = userArgs.some((arg) => arg.startsWith('--reporter'));
const args = ['test', ...(hasReporter ? userArgs : ['--reporter=list', ...userArgs])];
const playwrightBinary = process.platform === 'win32'
  ? path.join(__dirname, '..', 'node_modules', '.bin', 'playwright.cmd')
  : path.join(__dirname, '..', 'node_modules', '.bin', 'playwright');
const command = `${playwrightBinary} ${args.map((arg) => JSON.stringify(arg)).join(' ')}`;
const spawnOptions = {
  stdio: 'inherit',
  cwd: path.join(__dirname, '..'),
  env: {
    ...process.env,
    DOCUSAURUS_PORT: String(port),
  },
};

const child = process.platform === 'win32'
  ? spawn('cmd.exe', ['/c', playwrightBinary, ...args], spawnOptions)
  : spawn(playwrightBinary, args, spawnOptions);

child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exit(code ?? 0);
});

child.on('error', (error) => {
  console.error(error);
  process.exit(1);
});
