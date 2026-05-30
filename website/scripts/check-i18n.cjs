const path = require('path');
const { createRequire } = require('module');
const requireFromSite = createRequire(path.resolve(process.cwd(), 'package.json'));
const config = requireFromSite('./docusaurus.config.js').default;
const { getPluginI18nPath } = requireFromSite('./node_modules/@docusaurus/utils/lib/i18nUtils');

const locale = 'pt-BR';
const localizationDir = path.resolve(process.cwd(), 'i18n', locale);
const docsLocalized = getPluginI18nPath({ localizationDir, pluginName: 'docusaurus-plugin-content-docs', pluginId: 'default', subPaths: ['current'] });
const pluginDirLocalized = getPluginI18nPath({ localizationDir, pluginName: 'docusaurus-plugin-content-docs', pluginId: 'default', subPaths: [] });

console.log('config pt-BR', config.i18n.localeConfigs['pt-BR']);
console.log('localizationDir', localizationDir);
console.log('docsLocalized', docsLocalized, require('fs').existsSync(docsLocalized));
console.log('pluginDirLocalized', pluginDirLocalized, require('fs').existsSync(pluginDirLocalized));
console.log('docsLocalized files', require('fs').existsSync(docsLocalized) ? require('fs').readdirSync(docsLocalized) : []);
console.log('pluginDirLocalized files', require('fs').existsSync(pluginDirLocalized) ? require('fs').readdirSync(pluginDirLocalized) : []);
