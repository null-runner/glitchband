# Changelog

## Unreleased

- Restyle in step with Claude Desktop: a neutral warm-grey palette with one violet, Claude coral for WARM and ice blue for COLD. No magenta, pink or lilac.
- Usage bars instead of dots on the desktop: a rounded bar of what is left with a faint shine and a one-time grow. The terminal keeps dots.
- Buttons: keepwarm is a primary button while armed, secondary with a coral hover otherwise; Show / Hide is secondary with a hover in the cache colour.
- A new mascot: a lit netrunner with rising sparks when warm, frozen under a sheet of ice with icicles when cold.
- The open card is sized in rows and kept inside `maxRows`: it drops to a one-line keepwarm strip, then stays folded, rather than make the band scroll. It is drawn with an explicit width and height.
- The `language` option now defaults to `en` (`auto` and `it` stay).
- Earlier in this cycle, a purple cyberpunk look: a new palette, a netrunner mascot (visor pulse and scan when warm, iced over when cold, an RGB glitch on a keepwarm ping), neon chips that glitch once when the state flips, and a card with a faint scanline and cost bars that fill in when it opens. Animations stop under a reduced-motion preference.
- The plugin has an icon.

## 0.1.0

- First release: the usage and cache band, the cache card and keepwarm with its cold-send guard, in one mod.
- Every visible string goes through an English and Italian dictionary; the `language` option picks one, `auto` follows Claude Code's language setting.
- Options: `language`, `compactBelow`, `cardScale`, `keepwarmWindow`, `coldGuard`.
- Commands: `/keepwarm` and `/glitchband`.
