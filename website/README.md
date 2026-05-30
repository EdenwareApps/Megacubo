# Website

This website is built using [Docusaurus](https://docusaurus.io/), a modern static website generator.

## Installation

```bash
yarn
```

## Local Development

```bash
yarn start
```

This command starts a local development server and opens up a browser window. Most changes are reflected live without having to restart the server.

Important behavior:
- `docusaurus start` is optimized for fast development and serves only the default locale (`en`) in dev mode.
- Non-default locale routes such as `/pt-BR/` are not the correct target for full multilingual validation in dev mode.

## Build

```bash
yarn build
```

This command generates static content into the `build` directory. For this project, the GitHub Pages deploy output is also copied into `website/build/Megacubo` by the `build:ghpages` script.

## Multilingual Local Validation (GitHub Pages Mode)

Use this flow to validate i18n output exactly as it will run on GitHub Pages project paths (`/Megacubo/`):

```bash
cd website
npx docusaurus build
npm run serve:ghpages
```

Why this command:
- Generic static servers (for example `npx serve build`) usually mount the build at `/` and do not emulate a project subpath.
- This project deploys under `/Megacubo/`, so local validation must keep that prefix.
- `serve:ghpages` uses `scripts/serve-build.mjs`, which serves the build at `/Megacubo/` without moving files manually.

Expected URLs with project `baseUrl` (`/Megacubo/`):
- English: `http://localhost:3000/Megacubo/`
- Portuguese: `http://localhost:3000/Megacubo/pt-BR/`

Do not validate Portuguese at `http://localhost:3000/pt-BR/` in this project, because production is deployed as a GitHub Pages project site under `/Megacubo/`.

Quick distinction:
- `start`: fast editing loop, default locale behavior in dev.
- `build + serve`: production-like output, correct multilingual validation.

One-command local validation:

```bash
cd website
npm run validate:ghpages
```

## Deployment

Using SSH:

```bash
USE_SSH=true yarn deploy
```

Not using SSH:

```bash
GIT_USER=<Your GitHub username> yarn deploy
```

If you are using GitHub pages for hosting, this command is a convenient way to build the website and push to the `gh-pages` branch.
