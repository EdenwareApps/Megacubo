// @ts-check
// `@type` JSDoc annotations allow editor autocompletion and type checking
// (when paired with `@ts-check`).
// There are various equivalent ways to declare your Docusaurus config.
// See: https://docusaurus.io/docs/api/docusaurus-config

import {themes as prismThemes} from 'prism-react-renderer';

// This runs in Node.js - Don't use client-side code here (browser APIs, JSX...)

const isDev = process.env.NODE_ENV !== 'production';
// Dev server must run at root so local authoring uses simple routes.
// Production (GitHub Pages project site) must use /Megacubo/.
const baseUrl = process.env.DOCUSAURUS_BASE_URL ?? (isDev ? '/' : '/Megacubo/');

/** @type {import('@docusaurus/types').Config} */
const config = {
  title: 'Megacubo',
  tagline: 'Cross-platform IPTV player documentation',
  favicon: 'img/project-icon.png',

  url: 'https://edenwareapps.github.io',
  baseUrl,

  organizationName: 'EdenwareApps',
  projectName: 'Megacubo',

  onBrokenLinks: 'warn',
  onBrokenAnchors: 'warn',
  markdown: {
    hooks: {
      onBrokenMarkdownLinks: 'warn',
    },
  },

  i18n: {
    // Docusaurus `start` serves only defaultLocale in dev mode by design.
    // Validate non-default locales with `build` + `serve`.
    defaultLocale: 'en',
    locales: ['en', 'pt-BR'],
    localeConfigs: {
      en: {
        label: 'English',
        htmlLang: 'en',
      },
      'pt-BR': {
        label: 'Português',
        htmlLang: 'pt-BR',
        path: 'pt-BR',
        translate: true,
      },
    },
  },

  presets: [
    [
      'classic',
      /** @type {import('@docusaurus/preset-classic').Options} */
      ({
        docs: {
          sidebarPath: require.resolve('./sidebars.js'),
          routeBasePath: 'docs',
          editUrl: 'https://github.com/EdenwareApps/Megacubo/tree/main/website/',
        },
        blog: false,
        theme: {
          customCss: require.resolve('./src/css/custom.css'),
        },
      }),
    ],
  ],

  plugins: [],

  themeConfig:
    /** @type {import('@docusaurus/preset-classic').ThemeConfig} */
    ({
      image: 'img/docusaurus-social-card.jpg',
      metadata: [
        {
          name: 'description',
          content: 'Megacubo technical documentation for installation, usage, and troubleshooting of the cross-platform IPTV player.',
        },
        {
          name: 'keywords',
          content: 'Megacubo, IPTV, documentation, installation, troubleshooting, setup, community mode, streaming',
        },
        {
          name: 'robots',
          content: 'index, follow',
        },
      ],
      colorMode: {
        defaultMode: 'dark',
        disableSwitch: false,
        respectPrefersColorScheme: true,
      },
      navbar: {
        title: 'Megacubo',
        logo: {
          alt: 'Megacubo Logo',
          src: 'img/project-icon.png',
        },
        items: [
          {
            type: 'docSidebar',
            sidebarId: 'tutorialSidebar',
            position: 'left',
            label: 'Documentation',
          },
          {
            href: 'https://github.com/EdenwareApps/Megacubo',
            label: 'GitHub',
            position: 'right',
            target: '_blank',
            rel: 'noopener noreferrer',
          },
          {
            href: 'https://megacubo.tv',
            label: 'Website',
            position: 'right',
            target: '_blank',
            rel: 'noopener noreferrer',
          },
          {
            type: 'localeDropdown',
            position: 'right',
          },
        ],
      },
      footer: {
        style: 'dark',
        links: [
          {
            title: 'Docs',
            items: [
              {
                label: 'Introduction',
                to: '/docs/introduction',
              },
            ],
          },
          {
            title: 'Community',
            items: [
              {
                label: 'GitHub',
                href: 'https://github.com/EdenwareApps/Megacubo',
                target: '_blank',
                rel: 'noopener noreferrer',
              },
              {
                label: 'Website',
                href: 'https://megacubo.tv',
                target: '_blank',
                rel: 'noopener noreferrer',
              },
            ],
          },
        ],
        copyright: `Copyright © ${new Date().getFullYear()} EdenwareApps.`,
      },
      prism: {
        theme: prismThemes.github,
        darkTheme: prismThemes.dracula,
      },
    }),
};

export default config;
