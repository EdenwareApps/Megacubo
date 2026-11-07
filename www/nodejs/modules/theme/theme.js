import lang from "../lang/lang.js";
import { EventEmitter } from "events";
import renderer from '../bridge/bridge.js'

// Appearance settings that still work with the fixed dark layout. Colors,
// wallpapers and theme packs were dropped from here: they overrode the surface
// palette defined in App.svelte and broke contrast.
class Theme extends EventEmitter {
    constructor() {
        super();
        renderer.ready(() => this.refresh())
    }
    async gridLayoutEntries() {
        return [
            {
                name: lang.LANDSCAPE_MODE,
                type: 'group',
                fa: 'fas fa-grip-horizontal',
                entries: [
                    {
                        name: lang.HORIZONTAL,
                        type: 'slider',
                        fa: 'fas fa-ruler-horizontal',
                        value: () => {
                            return global.config.get('view-size').landscape.x;
                        },
                        range: { start: 1, end: 10 },
                        action: async (data, value) => {
                            const metrics = global.config.get('view-size')
                            if (metrics.landscape.x != value) {
                                metrics.landscape.x = value
                                global.config.set('view-size', metrics)
                                await this.update()
                            }
                        }
                    },
                    {
                        name: lang.VERTICAL,
                        type: 'slider',
                        fa: 'fas fa-ruler-vertical',
                        value: () => {
                            return global.config.get('view-size').landscape.y;
                        },
                        range: { start: 1, end: 8 },
                        action: async (data, value) => {
                            const metrics = global.config.get('view-size')
                            if (metrics.landscape.y != value) {
                                metrics.landscape.y = value
                                global.config.set('view-size', metrics)
                                await this.update()
                            }
                        }
                    }
                ]
            },
            {
                name: lang.PORTRAIT_MODE,
                type: 'group',
                fa: 'fas fa-grip-vertical',
                entries: [
                    {
                        name: lang.HORIZONTAL,
                        type: 'slider',
                        fa: 'fas fa-ruler-horizontal',
                        range: { start: 1, end: 4 },
                        value: () => {
                            return global.config.get('view-size').portrait.x;
                        },
                        action: async (data, value) => {
                            const metrics = global.config.get('view-size')
                            if (metrics.portrait.x != value) {
                                metrics.portrait.x = value
                                global.config.set('view-size', metrics)
                                await this.update();
                            }
                        }
                    },
                    {
                        name: lang.VERTICAL,
                        type: 'slider',
                        fa: 'fas fa-ruler-vertical',
                        range: { start: 1, end: 10 },
                        value: () => {
                            return global.config.get('view-size').portrait.y;
                        },
                        action: async (data, value) => {
                            const metrics = global.config.get('view-size')
                            if (metrics.portrait.y != value) {
                                metrics.portrait.y = value
                                global.config.set('view-size', metrics);
                                await this.update();
                            }
                        }
                    }
                ]
            }
        ];
    }
    async entries() {
        return [
            {
                name: lang.FONT,
                type: 'group',
                fa: 'fas fa-font',
                entries: [
                    {
                        name: lang.FONT_FAMILY,
                        type: 'select',
                        fa: 'fas fa-font',
                        renderer: () => {
                            return new Promise(resolve => {
                                renderer.ui.once('fontlist', list => {
                                    resolve(list.map(name => {
                                        return {
                                            name, type: 'action',
                                            action: async () => {
                                                global.config.set('font-family', name);
                                                await this.update()
                                            }
                                        }
                                    }))
                                })
                                renderer.ui.emit('fontlist')
                            });
                        },
                        value: () => {
                            return global.config.get('font-family');
                        }
                    },
                    {
                        name: lang.UPPERCASE_LETTERS_MENU,
                        type: 'check',
                        action: async (data, value) => {
                            global.config.set('uppercase-menu', value)
                            await this.update()
                        },
                        checked: () => {
                            return global.config.get('uppercase-menu');
                        }
                    },
                    {
                        name: lang.FONT_SIZE,
                        type: 'slider',
                        fa: 'fas fa-text-width',
                        range: { start: 1, end: 10 },
                        action: async (data, value) => {
                            global.config.set('font-size', value);
                            await this.update()
                        },
                        value: () => {
                            return global.config.get('font-size');
                        }
                    }
                ]
            },
            { name: lang.LAYOUT_GRID_SIZE, fa: 'fas fa-th', type: 'group', renderer: this.gridLayoutEntries.bind(this) },
            {
                name: 'FX Navigation Intensity',
                fa: 'fas fa-film',
                type: 'slider',
                range: { start: 0, end: 10 },
                action: async (data, value) => {
                    global.config.set('fx-nav-intensity', value);
                    await this.update();
                },
                value: () => {
                    return global.config.get('fx-nav-intensity');
                }
            }
        ]
    }
    refresh() {
        renderer.ui.emit('theme-update')
    }
    async update() {
        this.refresh()
    }
    async hook(entries, path) {
        if (path == lang.TOOLS) {
            entries.splice(2, 0, { name: lang.CUSTOMIZE, fa: 'fas fa-palette', type: 'group', renderer: this.entries.bind(this) });
        }
        return entries
    }
}
export default Theme;
