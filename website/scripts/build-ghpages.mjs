import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const websiteDir = path.join(__dirname, '..');
const buildDir = path.join(websiteDir, 'build');
const ghpagesDir = path.join(buildDir, 'Megacubo');

async function removeIfExists(target) {
  try {
    await fs.rm(target, { recursive: true, force: true });
  } catch {
    // ignore
  }
}

async function copyDirectoryContents(src, dest) {
  await fs.mkdir(dest, { recursive: true });
  const entries = await fs.readdir(src, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === 'Megacubo') continue;
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    await fs.cp(srcPath, destPath, { recursive: true });
  }
}

async function cleanRootBuildDir(buildRoot, keep = []) {
  const entries = await fs.readdir(buildRoot, { withFileTypes: true });
  for (const entry of entries) {
    if (keep.includes(entry.name)) continue;
    await removeIfExists(path.join(buildRoot, entry.name));
  }
}

async function writeRedirectIndex(buildRoot) {
  const redirectHtml = `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta http-equiv="refresh" content="0;url=./Megacubo/" />
    <meta name="robots" content="noindex" />
    <title>Redirecting...</title>
  </head>
  <body>
    <p>Redirecting to <a href="./Megacubo/">./Megacubo/</a></p>
  </body>
</html>`;
  await fs.writeFile(path.join(buildRoot, 'index.html'), redirectHtml, 'utf8');
}

async function runBuild() {
  return new Promise((resolve, reject) => {
    const proc = spawn('npx', ['docusaurus', 'build'], {
      cwd: websiteDir,
      stdio: 'inherit',
      shell: true,
    });
    proc.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`docusaurus build failed with exit code ${code}`));
    });
  });
}

async function main() {
  await runBuild();
  await removeIfExists(ghpagesDir);
  await copyDirectoryContents(buildDir, ghpagesDir);
  await cleanRootBuildDir(buildDir, ['Megacubo', '.nojekyll']);
  await writeRedirectIndex(buildDir);
  console.log(`Created GitHub Pages deploy folder at ${ghpagesDir}`);
  console.log(`Root build now contains only a redirect index.html and the Megacubo folder.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
