// Every colour and measure of the band and the card, in one place.

export type Mode = 'warm' | 'cold'
export type Kind = 'wide' | 'stacked' | 'tight'

// The band's own colours, measured from the app.
export const BG = '#24221c'
export const TEXT = '#e8e2d2'
export const MUTED = '#8d8775'
export const EMPTY = '#4a463b'
export const LINE = '#36332b'
export const ORANGE = '#ff6b1a'
export const YELLOW = '#f5a623'
/** Text on a filled chip. */
export const INK = '#1c1a16'

// The cache's two states in a muted shade: desaturated so they sit
// beside the band's own orange and yellow.
export const HUE: Record<Mode, string> = { warm: '#cc6363', cold: '#6aaabd' }

/** The mascot's shadow, glints and the ice's white. */
export const SHADOW = '#000'
export const GLINT = '#fff'
export const WHITE = '#ffffff'

/** Colour of each usage window's dots. */
export const WINDOW_COLORS: Record<string, string> = { seven_day: ORANGE, five_hour: YELLOW }
/** keepwarm's state in the band's text. */
export const KW_COLORS = { on: HUE.warm, stopped: YELLOW } as const
/** Button labels: warm red while keepwarm holds the cache, cold blue while it is off. */
export const KW_BUTTON_COLORS = { on: HUE.warm, stopped: YELLOW, off: HUE.cold } as const

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
export const ROBO_SIZE = 26
/** The gap between the row and the card, drawn inside the card. */
export const CARD_TOP = 6
/** The keepwarm strip's height: one row of three columns, or three stacked rows (plus a line for a stop reason) when narrow. */
export const KW_H = 62
export const KW_H_ROWS = 78
export const KW_NOTE_H = 16
