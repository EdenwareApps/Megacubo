# Theme Module

Applies the fixed dark palette used by the current UI and exposes the few remaining
visual preferences (font, grid size, navigation effect) under **Tools › Customize**.

Colors, background images/videos and animations are no longer user-configurable — the
layout depends on a fixed dark background, so those options were removed.

## Structure

- `theme.js` — backend (main process): builds the "Customize" menu entries and keeps
  `font-family`, `font-size`, `uppercase-letters-menu`, `layout-grid-size` and
  `fx-nav-intensity` in sync with the renderer.
- `renderer.js` — renderer side: injects the CSS variables (`--background-color`,
  `--font-color`, `--alpha-background-color`, `--radius`, `--entries-per-row`, …) and
  handles the curtains effect shown while the player is open.

## Usage

```javascript
import theme from './theme.js'

// Rebuild the Customize menu (call after config changes done outside the menu)
theme.refresh()

// Warn the renderer to re-read the config and re-inject the CSS variables
theme.update()
```

Entries are exposed through `theme.entries()` and hooked into `lang.TOOLS` automatically,
so no manual registration is needed.
