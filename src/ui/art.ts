// The mascot and the chips: pure functions returning SVG strings the band hands to Svg.
// Nothing here touches the engine except the two things the drawing remembers (the last chip state).
// Drawing style from ribbon 1.0.0 (Jay E | RoboNuggets, MIT).

import type { KeepwarmFacts } from '../../types'
import { t } from '../i18n'
import { SANS } from './font'
import { CHIP_EDGE, GLINT, HUE, INK, MASCOT, MASCOT_SIZE, PING_GLITCH_WINDOW_MS } from './theme'
import type { Mode } from './theme'

/** The chip's word for a state, in the language in use. */
export const wordOf = (mode: Mode): string => t(mode === 'warm' ? 'chip.warm' : 'chip.cold')

// ---------- SVG helpers ----------
/** Every animation stops under a reduced-motion preference: the drawing then rests in its clean state. */
export const REDUCED_MOTION = '@media (prefers-reduced-motion: reduce){*{animation:none !important}}'

/** An SVG document. `css` is the drawing's animations; given any, the reduced-motion rule goes with it. */
export const svgDoc = (w: number, h: number, body: string, font: boolean, css = ''): string =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">` +
  (font || css
    ? '<style>' +
      (font ? `@font-face{font-family:RS;font-weight:100 900;src:url(data:font/woff2;base64,${SANS}) format('woff2')} text{font-family:RS,system-ui,'Segoe UI',sans-serif}` : '') +
      css +
      (css ? REDUCED_MOTION : '') +
      '</style>'
    : '') +
  body +
  '</svg>'

// ---------- Rounded chips (WARM, COLD, YOU) ----------
// A text background can't be rounded, so a chip is a small drawing. The mod can't
// measure text, so each chip's size was measured once, in the embedded font:
// width = the word plus 0.62 em of padding each side (and a little slack for its letter-spacing),
// height 1.65 em. Both languages are measured: WARM and COLD, CALDA and FREDDA, YOU and TU.
export const CHIP_WIDTHS: Record<string, { w: number; h: number }> = {
  'WARM@13': { w: 63, h: 21 },
  'COLD@13': { w: 58, h: 21 },
  'CALDA@13': { w: 67, h: 21 },
  'FREDDA@13': { w: 77, h: 21 },
  'WARM@11': { w: 54, h: 18 },
  'COLD@11': { w: 50, h: 18 },
  'CALDA@11': { w: 59, h: 18 },
  'FREDDA@11': { w: 66, h: 18 },
  'YOU@10': { w: 36, h: 17 },
  'TU@10': { w: 27, h: 17 },
}

const GHOST_OFFSET = 1.6
/** The glitch when a chip changes state: its length, in milliseconds. */
const CHIP_GLITCH_MS = 400

const CHIP_CSS =
  `.c-j{animation:c-jit ${CHIP_GLITCH_MS}ms steps(1,end) 1}` +
  '@keyframes c-jit{0%{transform:translate(2px,0)}20%{transform:translate(-2px,0)}40%{transform:translate(1px,0)}60%{transform:translate(-1px,0)}80%{transform:translate(1px,0)}100%{transform:none}}' +
  `.c-gm,.c-gc{opacity:0;clip-path:inset(0 0 100% 0) fill-box}.c-gm{animation:c-gm ${CHIP_GLITCH_MS}ms steps(1,end) 1}.c-gc{animation:c-gc ${CHIP_GLITCH_MS}ms steps(1,end) 1}` +
  '@keyframes c-gm{0%{opacity:.95;clip-path:inset(0 0 60% 0) fill-box}25%{opacity:.95;clip-path:inset(40% 0 20% 0) fill-box}50%{opacity:.95;clip-path:inset(15% 0 55% 0) fill-box}75%{opacity:.95;clip-path:inset(65% 0 0 0) fill-box}100%{opacity:0}}' +
  '@keyframes c-gc{0%{opacity:.95;clip-path:inset(55% 0 10% 0) fill-box}25%{opacity:.95;clip-path:inset(5% 0 70% 0) fill-box}50%{opacity:.95;clip-path:inset(50% 0 25% 0) fill-box}75%{opacity:.95;clip-path:inset(20% 0 40% 0) fill-box}100%{opacity:0}}'

/**
 * A chip with a neon edge, dark text on the full colour. With `glitch`, two copies of the word
 * (magenta and ice, offset, cut into bands) flicker once over it; the doc must carry CHIP_CSS.
 */
export const chipShapes = (x: number, y: number, word: string, mode: Mode, size: number, ls: number, glitch = false): { w: number; h: number; svg: string } => {
  const { w, h } = CHIP_WIDTHS[`${word}@${size}`] ?? { w: Math.round(word.length * size * 0.8 + size * 1.24), h: Math.round(size * 1.65) }
  const fill = HUE[mode]
  const rx = Math.round(h * 0.32)
  const tx = x + w / 2
  const ty = y + h / 2 + size * 0.36
  const label = (extra: string, fillText: string, dx = 0) =>
    `<text x="${tx + dx}" y="${ty}" font-size="${size}" font-weight="700" letter-spacing="${ls}" text-anchor="middle" fill="${fillText}"${extra}>${word}</text>`
  return {
    w,
    h,
    svg:
      (glitch ? '<g class="c-j">' : '') +
      `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${rx}" fill="${fill}"/>` +
      // The neon edge and its glow, drawn inside the chip's own box.
      `<rect x="${x + 1.5}" y="${y + 1.5}" width="${w - 3}" height="${h - 3}" rx="${Math.max(1, rx - 1.5)}" fill="none" stroke="${CHIP_EDGE[mode]}" stroke-width="2.6" opacity=".3"/>` +
      `<rect x="${x + 0.6}" y="${y + 0.6}" width="${w - 1.2}" height="${h - 1.2}" rx="${rx - 0.6}" fill="none" stroke="${CHIP_EDGE[mode]}" stroke-width="1.1" opacity=".95"/>` +
      label('', INK) +
      (glitch ? label(' class="c-gm"', HUE.warm, -GHOST_OFFSET) + label(' class="c-gc"', HUE.cold, GHOST_OFFSET) + '</g>' : ''),
  }
}

/** The last state the band's chip drew; a draw with the other state is a state change. */
let lastChipMode: Mode | null = null

/** The WARM or COLD chip beside the mascot in the band's row; it glitches once when the state changes. */
export const chipSvg = (mode: Mode): { source: string; w: number; h: number; glitch: boolean } => {
  const glitch = lastChipMode !== null && lastChipMode !== mode
  lastChipMode = mode
  const c = chipShapes(0, 0, wordOf(mode), mode, 13, 1, glitch)
  return { source: svgDoc(c.w, c.h, c.svg, true, glitch ? CHIP_CSS : ''), w: c.w, h: c.h, glitch }
}

// ---------- The netrunner: visor lit and scanning when warm, dark and iced over when cold ----------
// 16 x 16, one letter a pixel: H hood, E its rim, S shadow, V visor, J jack, A antenna tip, a its stem.
export const MASCOT_PIX = [
  '..........A.....',
  '..........a.....',
  '....EEEEEEEE....',
  '...EHHHHHHHHE...',
  '..EHHHHHHHHHHE..',
  '..EHHHHHHHHHHE..',
  'JJEVVVVVVVVVVE..',
  'JJEVVVVVVVVVVE..',
  '..EHHHHHHHHHHE..',
  '..EHHHHHHHHHHE..',
  '...EHHSSSSHHE...',
  '....EHHHHHHE....',
  '....EEEEEEEE....',
  '..HHHHHHHHHHHH..',
  '.HHHEHHHHHHEHHH.',
  '.HHHHHHHHHHHHHH.',
]
const GRID = 16
/** Where the ice sits on a cold mascot: crystals on the hood and frost on the visor. */
const ICE_SPIKES: Array<[number, number]> = [[4, 1], [5, 2], [11, 1], [12, 2], [2, 4], [13, 5], [3, 13]]
const ICE_FROST: Array<[number, number]> = [[5, 6], [6, 6], [9, 7], [10, 7]]
const ICE_GLINTS: Array<[number, number]> = [[4, 1], [12, 2], [13, 5]]

const MASCOT_COLORS: Record<string, string> = { H: MASCOT.hood, E: MASCOT.rim, S: MASCOT.shadow, J: MASCOT.jack, a: MASCOT.rim }

// One path per colour, not a rect per pixel: separate rects at fractional sizes leave faint
// seams between them, while one path fills the shared edges solid.
const pixels = (u: number, chars: string, fill: string): string => {
  let d = ''
  MASCOT_PIX.forEach((row, y) =>
    [...row].forEach((ch, x) => {
      if (chars.includes(ch)) d += `M${x * u} ${y * u}h${u}v${u}h${-u}z`
    }),
  )
  return `<path d="${d}" fill="${fill}"/>`
}

const cells = (list: Array<[number, number]>, u: number, fill: string, cls = '', opacity = 1): string =>
  list.map(([x, y]) => `<rect${cls ? ` class="${cls}"` : ''} x="${x * u}" y="${y * u}" width="${u}" height="${u}" fill="${fill}"${opacity < 1 ? ` opacity="${opacity}"` : ''}/>`).join('')

/** The mascot's animations for a box `size` wide: the visor pulse and scan, the ice's twinkle, the ping glitch. */
export const mascotCss = (size: number): string => {
  const u = size / GRID
  const glow = (r: number) => `filter:drop-shadow(0 0 ${(r * u).toFixed(2)}px ${HUE.warm})`
  return (
    `.m-visor{animation:m-pulse 2.4s ease-in-out infinite;${glow(0.6)}}` +
    `@keyframes m-pulse{0%,100%{opacity:.78;${glow(0.6)}}50%{opacity:1;${glow(1.8)}}}` +
    `.m-scan{opacity:0;animation:m-scan 3s linear infinite}` +
    `@keyframes m-scan{0%{transform:translateX(0);opacity:0}8%{opacity:.85}92%{opacity:.85}100%{transform:translateX(${(9 * u).toFixed(2)}px);opacity:0}}` +
    '.m-g{opacity:0;animation:m-twinkle 5s ease-in-out infinite}.m-g2{animation-delay:1.7s}.m-g3{animation-delay:3.3s}' +
    '@keyframes m-twinkle{0%,60%,100%{opacity:0}75%{opacity:1}}' +
    '.m-glitch{animation:m-jit .12s steps(1,end) 3}' +
    '@keyframes m-jit{0%{transform:translate(1px,0)}34%{transform:translate(-1px,1px)}67%{transform:translate(0,-1px)}100%{transform:none}}' +
    '.m-gm,.m-gc{opacity:0}.m-gm{animation:m-gm .12s steps(1,end) 3}.m-gc{animation:m-gc .12s steps(1,end) 3}' +
    '@keyframes m-gm{0%{opacity:.85;transform:translate(-1px,0)}50%{opacity:.85;transform:translate(1px,0)}100%{opacity:0}}' +
    '@keyframes m-gc{0%{opacity:.85;transform:translate(1px,0)}50%{opacity:.85;transform:translate(-1px,0)}100%{opacity:0}}'
  )
}

/**
 * The netrunner in a box `size` pixels square, top-left at x, y. Its animations are CSS (mascotCss),
 * so the Svg needs isInteractive and the doc must carry them. `glitch` adds the ping's RGB split.
 */
export const mascotShapes = (x: number, y: number, size: number, mode: Mode, glitch = false): string => {
  const warm = mode === 'warm'
  const u = size / GRID
  const silhouette = (fill: string, cls: string) => `<g class="${cls}">${pixels(u, 'HESV', fill)}</g>`
  let s = `<g transform="translate(${x} ${y})" shape-rendering="crispEdges">`
  if (glitch) s += '<g class="m-glitch">' + silhouette(HUE.warm, 'm-gm') + silhouette(HUE.cold, 'm-gc')
  for (const [chars, fill] of Object.entries(MASCOT_COLORS)) s += pixels(u, chars, fill)
  s += pixels(u, 'A', HUE[mode])
  if (warm) {
    s += `<g class="m-visor"><rect x="${3 * u}" y="${6 * u}" width="${10 * u}" height="${2 * u}" fill="${HUE.warm}"/></g>`
    s += `<rect class="m-scan" x="${3 * u}" y="${6 * u}" width="${u}" height="${2 * u}" fill="${GLINT}"/>`
  } else {
    // Cold: the visor is dark, the hood and the visor wear ice, and a few glints twinkle slowly. The body never moves.
    s += `<rect x="${3 * u}" y="${6 * u}" width="${10 * u}" height="${2 * u}" fill="${MASCOT.visorOff}"/>`
    s += cells(ICE_FROST, u, HUE.cold, '', 0.55)
    s += cells(ICE_SPIKES, u, MASCOT.ice)
    ICE_GLINTS.forEach(([gx, gy], i) => (s += cells([[gx, gy]], u, GLINT, `m-g m-g${i + 1}`)))
  }
  if (glitch) s += '</g>'
  return s + '</g>'
}

/** Whether keepwarm sent a ping in the last minute: the mascot glitches for it. */
export const justPinged = (f: Pick<KeepwarmFacts, 'last'> | null, now: number): boolean => {
  const at = f?.last?.at
  return at !== undefined && now >= at && now - at < PING_GLITCH_WINDOW_MS
}

/** The mascot beside the chip in the band's row. */
export const mascotSvg = (mode: Mode, glitch = false): string =>
  svgDoc(MASCOT_SIZE, MASCOT_SIZE, mascotShapes(0, 0, MASCOT_SIZE, mode, glitch), false, mascotCss(MASCOT_SIZE))
