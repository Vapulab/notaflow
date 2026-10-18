# Malphas theme (copied)

These files are copies from the Malphas design system in `Vapulab/malphas` (MIT license):

| Here                                                      | There                             |
| --------------------------------------------------------- | --------------------------------- |
| `tokens.css`                                              | `theme/tokens.css`                |
| `preset.cjs`                                              | `theme/preset.js`                 |
| `apps/web/public/malphas-assets/fonts/SpaceGrotesk.woff2` | `assets/fonts/SpaceGrotesk.woff2` |

Copied at commit `961996bf109feaa77010b7e8910f4b81961334ca`. The preset loads `tokens.css` into the Tailwind base layer, so `index.css` does not import it. Do not edit them here: change Malphas, then copy again. `pnpm malphas:check` tells whether the copies still match.

The React components in `src/ui/` repeat the class strings of `components/*.templ` in `Vapulab/malphas`.
