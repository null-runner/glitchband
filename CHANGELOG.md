# Changelog

## 0.2.1

- The 5-hour bar no longer vanishes after its reset: until the next reading it shows as a fresh window, 100% left.

## 0.2.0

- Handoff: from `handoffAt` tokens of context (default 600000, 0 is off) the band shows a Refresh button before Show. It has the model write a handoff over the chat's own transcript, saves it to `~/.claude/handoffs/`, clears the chat and sends it as the first message of the new one (or fills the prompt when the chat cannot be cleared). `/glitchband` prints the threshold.
- The usage reset times are never dropped from the row. A crowded wide row now sheds, in order: the handoff count, the USAGE word, bar length, keepwarm's text, the handoff button; with nothing to drop, the reset times shorten to their first unit.

## 0.1.6

- The wide cache card fits 7 rows instead of 8 (tighter top, bottom and keepwarm strip), and a small gap separates the panel from a band stacked under it.
- A /reload-plugins no longer shows the "resumed ... the cache may be cold" notice: the last request's time is taken back from the session's cache facts.

## 0.1.5

- The cache card always keeps two rows free: a mod loaded before glitchband can stack its row under the card where glitchband can't see it, and the band scrolled.

## 0.1.4

- With another mod's band stacked beneath, the cache card keeps two rows free for it and folds when it can't, so the band no longer scrolls.

## 0.1.3

- Next message costs no longer run into each other: the four model columns share the width, each with two dot columns, and a price of $10 or more drops its cents.

## 0.1.2

- The cache's lifetime (1 hour or 5 minutes) is read from the chat's transcript, and the WARM/COLD countdown, the re-cache price (2x or 1.25x input) and the keepwarm ping timing follow it. When it can't be read, 1 hour is assumed, as before.
- `/glitchband` shows the lifetime and whether it was read or assumed.

## 0.1.1

- Other mods' bands above the prompt now draw beneath glitchband instead of being hidden by it.

## 0.1.0

- Restyle in step with Claude Desktop: a neutral warm-grey palette with one violet, Claude coral for WARM and ice blue for COLD. No magenta, pink or lilac.
- Usage bars instead of dots on the desktop: a rounded bar of what is left with a faint shine and a one-time grow. The terminal keeps dots.
- One dark panel: the card shares the band's colour (no grey card), sits in one dark box with the row (no grey strip between, no rounded corners: the box can't round them), and the row has room around its contents. The wide row is sized in pixels from its text and gives up the reset times, then the USAGE word, then shortens its bars, before the select or Show is ever cut.
- Keepwarm is a `Select` (Off, 90m, your window, 12h, Always) in place of the arm/disarm button; the row no longer shows keepwarm text when compact. The card shows the state in colour with the next ping. Show / Hide stays a secondary button with a hover in the cache colour.
- 5H is teal; the bars have a visible shine and a few drifting light dots; the card scanline is almost gone.
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
