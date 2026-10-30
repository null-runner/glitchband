// Every colour and measure of the band and the card, in one place.

export type Mode = 'warm' | 'cold'
export type Kind = 'wide' | 'stacked' | 'tight'

// The palette: neutral, in step with Claude Desktop, with one clean violet. Every colour of the band,
// the card, the mascot and the chips lives here; nothing else in src/ui carries a hex value (tests/theme.test.ts checks).
export const BG = '#1f1e1d'
export const LINE = '#3e3e38'
export const TEXT = '#faf9f5'
export const MUTED = '#9c9a92'
/** The empty part of a bar or a dot row: decoration, not text, so outside the contrast check. */
export const EMPTY = '#3a3936'
/** The one accent: the 7-day bar and the card's divider lines. */
export const SEVEN_DAY = '#8f80f5'
/** The 5-hour bar: teal, apart from the violet, the coral and the ice blue. */
export const FIVE_HOUR = '#3fb6a0'
export const AMBER = '#e0a84e'
/** The LOW tag, and the bar, of a window under LOW_AT percent. */
export const LOW_COLOR = '#ee645c'
/** Text on a filled chip. */
export const INK = '#1f1e1d'

/** The cache's two states: Claude coral while warm, ice blue while cold. */
export const HUE: Record<Mode, string> = { warm: '#d97757', cold: '#7cc4e8' }
/** The thin edge of a chip, a pale tint of its fill. */
export const CHIP_EDGE: Record<Mode, string> = { warm: '#f0a98f', cold: '#c9e8f7' }
/** The card's divider lines carry a thin touch of the accent in the middle. */
export const NEON_LINE = SEVEN_DAY

/** The netrunner's pixels, by state: hood, its rim, the shadow under the visor, the visor, the jack. A warm one is an orange body with a red visor; a cold one is all ice and grey. */
export const MASCOT = {
  warm: { hood: '#e07a3c', rim: '#9c4a1e', shadow: '#3a1a0c', visor: '#e5352b', jack: '#9c4a1e' },
  cold: { hood: '#3b4852', rim: '#8fb8cf', shadow: '#10161b', visor: '#27313a', jack: '#6e97ad' },
} as const
/** The sheet of ice over a cold netrunner: its body, its bright edge, the icicles. */
export const ICE = { body: '#cfeaf8', edge: '#eaf7fd', icicle: '#dff2fb' } as const
/** A spark of the warm netrunner. */
export const SPARK = '#ffd27a'
export const GLINT = '#ffffff'

/** Colour of each usage window's bar. */
export const WINDOW_COLORS: Record<string, string> = { seven_day: SEVEN_DAY, five_hour: FIVE_HOUR }
/** keepwarm's state in the band's text. */
export const KW_COLORS = { on: HUE.warm, stopped: AMBER } as const

// ---------- Band layout ----------
/** The usage bars of the desktop: size in pixels, and the one-time grow and the sweep of the shine across the fill. */
export const BAR_W = 96
/** The shorter bar a crowded row falls back to. */
export const BAR_W_SHORT = 64
export const BAR_H = 10
export const BAR_GROW_MS = 900
export const BAR_SHINE_S = 2.8
export const BAR_SHINE_OPACITY = 0.4
/** Light dots drifting along the filled part: how many, their radius and the seconds a drift takes. */
export const BAR_DOTS = 5
export const BAR_DOT_R = 1
export const BAR_DOT_S = 3
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
export const DEFAULT_CARD_SCALE = 1
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
export const CARD_MASCOT_SIZE = 26
/** A ping this recent makes the mascot glitch. */
export const PING_GLITCH_WINDOW_MS = 60_000
/** The card's scanline: its opacity (kept faint) and the seconds it takes to cross the card. */
export const CARD_SCAN_OPACITY = 0.025
export const CARD_SCAN_S = 8
/** The cost bars fill one after the other when the card opens: the gap between bars and the time each takes. */
export const CARD_BAR_STAGGER_MS = 80
export const CARD_BAR_MS = 420
/** The gap above the card's content, drawn inside the card. With CARD_BOTTOM and KW_H_SLIM it is sized so the wide card fills 7 whole rows (175 px), not 8. */
export const CARD_TOP = 4
/** The room under the card's content. */
export const CARD_BOTTOM = 4
/** The keepwarm strip's height: one row of three columns, or three stacked rows (plus a line for a stop reason) when narrow. */
export const KW_H = 62
export const KW_H_ROWS = 78
export const KW_NOTE_H = 16
/** The strip as one line, when the room above the prompt is short. */
export const KW_H_SLIM = 26

// ---------- Width: what a wide row is estimated to take, in pixels ----------
/** A character of the desktop's text in the band (a real screenshot measured about 8.4 px; 11 dropped USAGE from a row with room to spare), and the cell the engine counts (12 px, the code font's advance). */
export const CHAR_PX = 9
export const CELL_PX = 12
/** What a native button adds around its label: a desktop screenshot (30/10) measured Hide at ~60 px for a ~34 px label; kept a little over. */
export const BTN_CHROME = 40
/** A select around its value: the same screenshot measured "KW 6h" with its arrow at ~100 px; sized here on the longest value plus this. */
export const SELECT_CHROME = 50
/** Kept free at the end of a wide row on top of the estimate. */
export const SAFETY_PX = 24
export const PAD_PX = 12

// ---------- Height ----------
/** The desktop's pixels a band row stands for, read off a real screenshot (a 2-row band measured about 50 px; no doc gives it). A card is padded to whole rows and kept under maxRows with this. */
export const ROW_PX = 25
/** Rows the band's own lines take above the card, by layout: the row with the mascot, plus the keepwarm row and the stacked blocks of the narrower ones. */
/** Rows always kept free for other mods' bands: one stacked by a mod loaded before glitchband sits outside its tree, unseen, so the room is kept whether or not a band shows. */
export const BELOW_ROWS = 2
export const HEAD_ROWS: Record<Kind, number> = { wide: 2, stacked: 6, tight: 8 }

/** The desktop prompt column tops out near 960 px whatever the column count says, so a wider card is only shrunk with its text (ponytail: measured on one screen; a real slot width from the engine would replace it). */
export const CARD_MAX_PX = 950
