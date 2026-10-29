// The mascot and the chips: pure functions returning SVG strings the band hands to Svg.
// Nothing here touches the engine except the two things the drawing remembers (the last chip state).
// Drawing style from ribbon 1.0.0 (Jay E | RoboNuggets, MIT).

import type { KeepwarmFacts } from '../../types'
import { t } from '../i18n'
import { SANS } from './font'
import { BAR_DOTS, BAR_DOT_R, BAR_DOT_S, BAR_GROW_MS, BAR_H, BAR_SHINE_OPACITY, BAR_SHINE_S, BAR_W, CHIP_EDGE, EMPTY, GLINT, HUE, ICE, INK, MASCOT, MASCOT_SIZE, PING_GLITCH_WINDOW_MS, SPARK } from './theme'
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
 * A chip with a pale edge, dark text on the full colour. With `glitch`, two copies of the word
 * (coral and ice, offset, cut into bands) flicker once over it; the doc must carry CHIP_CSS.
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
      // The pale edge and its glow, drawn inside the chip's own box.
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

// ---------- The netrunner: warm and lit with a few sparks, or frozen under a sheet of ice ----------
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
/** Where the warm netrunner's heat sparks start (they rise four pixels and fade), each a beat after the last. */
const SPARKS: Array<[number, number]> = [[2, 3], [6, 1], [9, 2], [13, 3]]
/** A spark's side, in grid pixels: one and a half, so the heat reads at band size. */
const SPARK_PX = 1.5
/** The icicles under the chin: x of the base, the base's width and their length, in pixels of the grid. */
const ICICLES: Array<[number, number, number]> = [[5.3, 1.3, 2.7], [9.2, 1.1, 2.1]]

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

/** The mascot's animations for a box `size` wide: the warm visor pulse, scan and sparks; the cold sheen across the ice; the ping glitch. */
export const mascotCss = (size: number): string => {
  const u = size / GRID
  const glow = (r: number) => `filter:drop-shadow(0 0 ${(r * u).toFixed(2)}px ${MASCOT.warm.visor})`
  return (
    `.m-visor{animation:m-pulse 2.4s ease-in-out infinite;${glow(0.6)}}` +
    `@keyframes m-pulse{0%,100%{opacity:.8;${glow(0.6)}}50%{opacity:1;${glow(1.6)}}}` +
    `.m-scan{opacity:0;animation:m-scan 3s linear infinite}` +
    `@keyframes m-scan{0%{transform:translateX(0);opacity:0}8%{opacity:.7}92%{opacity:.7}100%{transform:translateX(${(9 * u).toFixed(2)}px);opacity:0}}` +
    '.m-sp{opacity:0;animation:m-spark 1.4s ease-out infinite}.m-sp2{animation-delay:.35s}.m-sp3{animation-delay:.7s}.m-sp4{animation-delay:1.05s}' +
    `@keyframes m-spark{0%{opacity:0;transform:translateY(0)}15%{opacity:1}100%{opacity:0;transform:translateY(${(-4 * u).toFixed(2)}px)}}` +
    '.m-sheen{opacity:0;animation:m-sheen 5s ease-in-out infinite}' +
    `@keyframes m-sheen{0%,62%{opacity:0;transform:translateX(${(-6 * u).toFixed(2)}px) skewX(-20deg)}72%{opacity:.55}88%{opacity:.55}100%{opacity:0;transform:translateX(${(18 * u).toFixed(2)}px) skewX(-20deg)}}` +
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
 * Warm: coral rim and jack, a pulsing visor, sparks rising. Cold: the whole figure in ice greys under a
 * sheet of ice with two icicles and a visor gone dark; only a sheen crosses the ice, the body never moves.
 */
export const mascotShapes = (x: number, y: number, size: number, mode: Mode, glitch = false): string => {
  const warm = mode === 'warm'
  const u = size / GRID
  const P = MASCOT[mode]
  const silhouette = (fill: string, cls: string) => `<g class="${cls}">${pixels(u, 'HESV', fill)}</g>`
  let s = `<g transform="translate(${x} ${y})" shape-rendering="crispEdges">`
  if (glitch) s += '<g class="m-glitch">' + silhouette(HUE.warm, 'm-gm') + silhouette(HUE.cold, 'm-gc')
  s += pixels(u, 'H', P.hood) + pixels(u, 'Ea', P.rim) + pixels(u, 'S', P.shadow) + pixels(u, 'J', P.jack) + pixels(u, 'A', warm ? SPARK : ICE.edge)
  if (warm) {
    s += `<g class="m-visor"><rect x="${3 * u}" y="${6 * u}" width="${10 * u}" height="${2 * u}" fill="${P.visor}"/></g>`
    s += `<rect class="m-scan" x="${3 * u}" y="${6 * u}" width="${u}" height="${2 * u}" fill="${GLINT}"/>`
    SPARKS.forEach(([sx, sy], i) => (s += `<rect class="m-sp m-sp${i + 1}" x="${sx * u}" y="${sy * u}" width="${SPARK_PX * u}" height="${SPARK_PX * u}" fill="${SPARK}"/>`))
  } else {
    const [bx, by, bw, bh] = [0.5 * u, 1.5 * u, 15 * u, 14 * u]
    s += `<rect x="${3 * u}" y="${6 * u}" width="${10 * u}" height="${2 * u}" fill="${P.visor}"/>`
    s += `<clipPath id="gb-ice"><rect x="${bx}" y="${by}" width="${bw}" height="${bh}" rx="${u}"/></clipPath>`
    s += `<rect x="${bx}" y="${by}" width="${bw}" height="${bh}" rx="${u}" fill="${ICE.body}" opacity=".24"/>`
    s += `<rect x="${bx}" y="${by}" width="${bw}" height="${bh}" rx="${u}" fill="none" stroke="${ICE.edge}" stroke-width="${(0.7 * u).toFixed(2)}"/>`
    s += `<g clip-path="url(#gb-ice)"><rect class="m-sheen" x="${2 * u}" y="${by}" width="${2.4 * u}" height="${bh}" fill="${GLINT}"/></g>`
    for (const [ix, iw, il] of ICICLES) s += `<path d="M${ix * u} ${12.6 * u}h${iw * u}l${(-iw / 2) * u} ${il * u}z" fill="${ICE.icicle}" stroke="${ICE.edge}" stroke-width="${(0.15 * u).toFixed(2)}"/>`
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

// ---------- The usage bar ----------
/**
 * A bar of how much of a window is left: a track, a fill of `left` percent in `color`, grown from
 * zero once when the band opens, and a faint shine that sweeps across the fill every few seconds.
 * The doc carries animations, so its Svg needs isInteractive.
 */
export const barSvg = (left: number, color: string, w = BAR_W): string => {
  const r = BAR_H / 2
  // Whole pixels, so the fill's end isn't a blended column; short of 100% the empty part is at least the
  // rounded cap, since a 1-2 px sliver of track there read as a dark line, not as what's left.
  const fill = left > 0 ? Math.max(BAR_H, Math.min(left < 100 ? w - r : w, Math.round((w * left) / 100))) : 0
  const drift = Math.min(fill * 0.3, 26)
  const css =
    `.b-fill{transform-box:fill-box;transform-origin:0 50%;animation:b-grow ${BAR_GROW_MS}ms cubic-bezier(.2,.8,.2,1) both}` +
    '@keyframes b-grow{from{transform:scaleX(0)}to{transform:scaleX(1)}}' +
    `.b-shine{opacity:0;animation:b-sweep ${BAR_SHINE_S}s ease-in-out ${BAR_GROW_MS}ms infinite}` +
    `@keyframes b-sweep{0%{opacity:0;transform:translateX(-40px)}10%{opacity:1}55%{opacity:1;transform:translateX(${w}px)}60%,100%{opacity:0;transform:translateX(${w}px)}}` +
    `.b-dot{opacity:0;animation:b-drift ${BAR_DOT_S}s ease-in-out ${BAR_GROW_MS}ms infinite}` +
    `@keyframes b-drift{0%{opacity:0;transform:translateX(0)}20%{opacity:.8}80%{opacity:.5}100%{opacity:0;transform:translateX(${drift.toFixed(1)}px)}}`
  let dots = ''
  if (fill >= 2 * BAR_H)
    for (let i = 0; i < BAR_DOTS; i++)
      dots += `<circle class="b-dot" style="animation-delay:${(((i * 0.61) % BAR_DOT_S) + BAR_GROW_MS / 1000).toFixed(2)}s" cx="${((fill * (i + 0.5)) / BAR_DOTS).toFixed(1)}" cy="${[3.2, 5, 6.8, 4.1, 5.9][i % 5]}" r="${BAR_DOT_R}" fill="${GLINT}"/>`
  const body =
    // Clip to the whole track, not a pill ending at the fill: a rounded end over the track let its grey
    // show through at the corners, a seam under the end of the fill.
    // The shine and the dots are clipped to the fill too: on the empty track the shine lit it up and left
    // the unlit strip right after the fill as a dark line.
    `<defs><clipPath id="gb-bar"><rect width="${w}" height="${BAR_H}" rx="${r}"/></clipPath><clipPath id="gb-fill"><rect width="${fill}" height="${BAR_H}"/></clipPath>` +
    `<linearGradient id="gb-shine"><stop offset="0" stop-color="${GLINT}" stop-opacity="0"/><stop offset=".5" stop-color="${GLINT}" stop-opacity="${BAR_SHINE_OPACITY}"/><stop offset="1" stop-color="${GLINT}" stop-opacity="0"/></linearGradient></defs>` +
    `<rect width="${w}" height="${BAR_H}" rx="${r}" fill="${EMPTY}"/>` +
    (fill > 0 ? `<g clip-path="url(#gb-bar)"><rect class="b-fill" width="${fill}" height="${BAR_H}" fill="${color}"/><g clip-path="url(#gb-fill)"><rect class="b-shine" x="0" width="40" height="${BAR_H}" fill="url(#gb-shine)"/>${dots}</g></g>` : '')
  return svgDoc(w, BAR_H, body, false, css)
}
