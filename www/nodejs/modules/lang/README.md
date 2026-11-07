# Language Module

A comprehensive internationalization (i18n) system that provides multi-language support, locale detection, and text translation capabilities.

## Features

- **Multi-Language Support**: Support for 20+ languages
- **Automatic Detection**: Detect user's preferred language
- **Dynamic Loading**: Load language files on demand
- **Country Support**: Country-specific language variants
- **Fallback System**: Graceful fallback to default language

## Detection

`lang.load(languageHint, explicitLanguage, folder, timezone, systemRegion)` receives an
ordered list of language hints (a comma separated string or an array) plus the country
configured in the operating system, and resolves both the UI locale and the country code,
without asking the user:

1. `explicitLanguage` (the locale chosen in the options screen, `config.get('locale')`), when set
2. `getSystemLocaleInfo()`, the OS region/language settings, see `system-locale.js` below
3. `electron.app.getPreferredSystemLanguages()` and `app.getLocale()`, the OS list, see `main.mjs`
4. `navigator.languages`, `navigator.language`, `navigator.userLanguage` and
   `Intl.DateTimeFormat().resolvedOptions().locale`, see `modules/bridge/renderer.js`

The first hint that matches an available language file becomes `locale`. For the country,
every hint contributes a score (`rankCountryCandidates`): the OS region weighs the most,
a region subtag such as `pt-BR` weighs much more than the language alone, and earlier hints
weigh more than later ones. When the OS region is known it always wins, even if the first
language or the timezone points elsewhere — the region is a setting the user picked
deliberately. Otherwise candidates that do not share the timezone offset are dropped when a
compatible one exists, and remaining ties are broken by population. `isTrusted` is set when
the country comes from the OS region, when the best candidate is unambiguous, or when it is
the region of the top system language — which lets the wizard skip the language/country
question. A best candidate whose score is within 3 points of the runner-up counts as
ambiguous (for example `en-US` first with `pt-BR` second and no OS region), so the wizard
asks the country instead of silently keeping a guess. A country chosen by the user
(`config.get('country')`) always wins.

```javascript
// Detect language and country
const lang = new Language()
await lang.load(['pt-BR', 'en-US'], null, folder, { name: 'America/Sao_Paulo', minutes: -180 }, 'BR')
console.log(lang.locale, lang.countryCode) // 'pt' 'br'
```

### Operating system region (`system-locale.js`)

Every desktop OS stores the country separately from the display language, so a user may run
the system in English while still living in Brazil. `getSystemLocaleInfo()` reads that setting
once (result cached, ~1 s on Windows) and returns
`{ languages: string[], region: string|null, formatLocale: string|null, source: string }`:

| OS | Source | Notes |
|----|--------|-------|
| Windows | `reg query "HKCU\Control Panel\International\Geo" /v Name`, `...\International` `/v LocaleName` and `...\International\User Profile` `/v Languages`, run in parallel | `Geo\Name` is "Country or region" and does not follow the display language; falls back to the region of `LocaleName`. `User Profile\Languages` is the display language list. The queries are targeted on purpose: each `/v` lookup takes 30-50 ms, while a recursive `/s` walk of the key measured anywhere from 150 ms to 13 s (cold start / antivirus scanning `reg.exe`) and used to blow the command timeout, leaving the region empty. The timeout is 10 s now, so a slow `reg.exe` start still yields the country |
| macOS | `defaults read -g AppleLocale` + `AppleLanguages` | region from the format locale (`pt_BR`), languages from the ordered list |
| Linux | `LANGUAGE`, `LC_TIME`/`LC_MONETARY`/`LANG`, `locale` | `LANGUAGE` is the translation list, `LC_TIME` the region; GNOME's `org.gnome.system.locale region` is used when set |
| Android | `getprop persist.sys.locale` (`ro.product.locale` as fallback) | detected with `process.platform == 'android'`; Android exports no POSIX locale variables, and the WebView hints (`navigator.languages`) remain the primary language source |

The IANA timezone name is not used to infer the country because there is no offline
timezone→country table shipped with the app; only the numeric UTC offset is available.

## Usage

```javascript
import lang from './lang.js';

// Load language
await lang.load('en');

// Get translated text
const text = lang.getText('CHANNELS');
console.log(text); // "Channels"

// Get available languages
const languages = await lang.availableLocalesMap();

// Detect user language
const detected = await lang.findCountryCode();
``` 