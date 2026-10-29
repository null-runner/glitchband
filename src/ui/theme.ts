// Every colour and measure of the band and the card, in one place.

export type Mode = 'warm' | 'cold'
export type Kind = 'wide' | 'stacked' | 'tight'

// The palette: purple cyberpunk. Every colour of the band, the card, the mascot and the
// chips lives here; nothing else in src/ui carries a hex value (tests/theme.test.ts checks).
export const BG = '#15101f'
/** The cache card's own surface, a step lighter than the band. */
export const CARD_BG = '#1b1428'
export const LINE = '#2d2342'
export const TEXT = '#ece6ff'
export const MUTED = '#8a7fa8'
/** Empty dots: decoration, not text, so outside the contrast check. */
export const EMPTY = '#3a2f52'
export const SEVEN_DAY = '#b388ff'
export const FIVE_HOUR = '#ff4fd8'
export const AMBER = '#ffb84d'
/** The LOW tag of a window under LOW_AT percent. */
export const LOW_COLOR = '#ff3b5c'
/** Text on a filled chip. */
export const INK = '#15101f'

/** The cache's two states: neon magenta while warm, ice cyan while cold. */
export const HUE: Record<Mode, string> = { warm: '#ff2bd6', cold: '#5ce1ff' }
/** The thin neon edge of a chip, a pale tint of its fill. */
export const CHIP_EDGE: Record<Mode, string> = { warm: '#ff9cec', cold: '#c4f3ff' }
/** The neon of the card's divider lines. */
export const NEON_LINE = SEVEN_DAY

/** The netrunner mascot's pixels: hood, its rim, the shadow under the visor, the dark visor of a cold cache, the jack, the ice. */
export const MASCOT = { hood: '#33265c', rim: '#7c5fd1', shadow: '#0d0918', visorOff: '#5b5275', jack: '#b388ff', ice: '#c4f3ff' } as const
export const GLINT = '#ffffff'

/** Colour of each usage window's dots. */
export const WINDOW_COLORS: Record<string, string> = { seven_day: SEVEN_DAY, five_hour: FIVE_HOUR }
/** keepwarm's state in the band's text. */
export const KW_COLORS = { on: HUE.warm, stopped: AMBER } as const
/** Button labels: neon while keepwarm holds the cache, amber once stopped, ice while it is off. */
export const KW_BUTTON_COLORS = { on: HUE.warm, stopped: AMBER, off: HUE.cold } as const

// ---------- Band layout ----------
export const CELLS = 10
export const TIGHT_CELLS = 6
/** A window under this percent left adds LOW. */
export const LOW_AT = 15
/** Columns a wide row needs to spell keepwarm out in full; under that it stays on the row in short form. */
export const KW_LONG_AT = 150
export const KW_LONG_AT_TERMINAL = 125
/** The default of the compactBelow option: under this a wide row drops "left", tightens its gaps and folds keepwarm into its button (the desktop font runs wider than the cell estimate). */
export const DEFAULT_COMPACT_BELOW = 110
/** The default of the cardScale option: the card is laid out this much narrower and drawn back at full width, so its text reads larger. */
export const DEFAULT_CARD_SCALE = 1.3
/** How often the band redraws, so the countdown and the warm-to-cold flip stay current. */
export const TICK_MS = 30_000

/** One row needs about 78 columns for two windows; under that, each window stacks. */
export const WIDE_AT = 78
/** Under this the dot bars shrink and the cache gets its own row. */
export const TIGHT_AT = 42

export const kindOf = (columns: number): Kind => (columns >= WIDE_AT ? 'wide' : columns >= TIGHT_AT ? 'stacked' : 'tight')

/**
 * The band's width in CSS pixels for a column count: the engine keeps 5 cells
 * for its [-], and a cell is 12 px (the app's code font advance). Rounds down,
 * so the card never runs past the slot; the few pixels left are band colour.
 */
export const bandPx = (columns: number): number => (columns + 5) * 12

// ---------- Card layout ----------
/** The mascot beside the chip in the band's row, in pixels. */
export const MASCOT_SIZE = 26
/** The mascot in the card's header. */
export const CARD_MASCOT_SIZE = 22
/** A ping this recent makes the mascot glitch. */
export const PING_GLITCH_WINDOW_MS = 60_000
/** The card's scanline: its opacity (kept faint) and the seconds it takes to cross the card. */
export const CARD_SCAN_OPACITY = 0.05
export const CARD_SCAN_S = 8
/** The cost bars fill one after the other when the card opens: the gap between bars and the time each takes. */
export const CARD_BAR_STAGGER_MS = 80
export const CARD_BAR_MS = 420
/** The gap between the row and the card, drawn inside the card. */
export const CARD_TOP = 6
/** The keepwarm strip's height: one row of three columns, or three stacked rows (plus a line for a stop reason) when narrow. */
export const KW_H = 62
export const KW_H_ROWS = 78
export const KW_NOTE_H = 16
