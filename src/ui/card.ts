// The cache card: an SVG laid out for the band's width. Pure; nothing here touches the engine.
// Layout from ribbon 1.0.0 (Jay E | RoboNuggets, MIT); the keepwarm strip is glitchband's.

import { MODELS, TTL_MIN, coldCost, costOf, tok, usd } from '../cache/cache'
import type { CacheView } from '../cache/cache'
import { t } from '../i18n'
import { chipShapes, roboShapes, svgDoc, wordOf } from './art'
import { BG, CARD_TOP, EMPTY, HUE, KW_H, KW_H_ROWS, KW_NOTE_H, LINE, MUTED, TEXT } from './theme'
import type { Kind } from './theme'

// ---------- The card, laid out for the band's width ----------
type TextOpts = { size?: number; w?: number; fill?: string; ls?: number; anchor?: string }

/** What the card's keepwarm strip says, already worded: the state, its stop reason if any, the ping and cold-write tallies. */
export type KeepwarmCard = { state: string; note: string; pings: string; cold: string }

const esc = (str: string): string => str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const clip = (str: string, n: number): string => (str.length > n ? `${str.slice(0, n - 1)}…` : str)

export const cardSvg = (v: CacheView, kind: Kind, W: number, kw: KeepwarmCard): { source: string; w: number; h: number; alt: string } => {
  const mode = v.mode
  const cold = mode === 'cold'
  const HUEM = HUE[mode]
  const FIRE = HUE.warm
  const ICE = HUE.cold
  const txt = (x: number, y: number, str: string, o: TextOpts = {}) =>
    `<text x="${x}" y="${y}" font-size="${o.size || 11}" font-weight="${o.w || 700}" fill="${o.fill || MUTED}"` +
    ` letter-spacing="${o.ls ?? 0}" text-anchor="${o.anchor || 'start'}">${str}</text>`
  const vline = (x: number, y: number, h: number) => `<rect x="${x}" y="${y}" width="1" height="${h}" fill="${LINE}"/>`
  const hline = (y: number) => `<rect x="13" y="${y}" width="${W - 26}" height="1" fill="${LINE}"/>`

  // How long since the last reply, with Robo and the chip in the header.
  const zoneIdle = (x: number, y: number, w: number, o: { compact?: boolean; header?: boolean } = {}) => {
    const k = o.compact ? { lab: 24, big: 60, bs: 30, line: 80, cap: 100 } : { lab: 30, big: 72, bs: 38, line: 96, cap: 120 }
    let g = ''
    if (o.header) {
      g += roboShapes(x - 2, y + k.lab - 17, 22, mode)
      const c = chipShapes(x + 26, y + k.lab - 13, wordOf(mode), HUEM, 11, 1)
      g += c.svg + txt(x + 26 + c.w + 8, y + k.lab, t('card.idle'), { ls: 1.4 })
    } else {
      g += txt(x, y + k.lab, t('card.idle'), { ls: 1.4 })
    }
    g += txt(x, y + k.big, v.idle, { size: k.bs, w: 600, fill: TEXT })
    const ly = y + k.line
    const x0 = x + 3
    const x1 = x + w - 14
    if (cold) {
      g += `<line x1="${x0}" y1="${ly}" x2="${x0 + 18}" y2="${ly}" stroke="${FIRE}" stroke-width="5" stroke-linecap="round"/>`
      for (let cx = x0 + 30; cx <= x1 - 14; cx += 9) g += `<circle cx="${cx}" cy="${ly}" r="2.2" fill="${ICE}"/>`
      g += `<circle cx="${x1}" cy="${ly}" r="5.5" fill="${ICE}"/>`
      g += txt(x, y + k.cap, t('card.warmHour'), { size: 12, w: 600, fill: FIRE })
      g += txt(x1 + 5, y + k.cap, t('card.coldNow'), { size: 12, w: 600, fill: ICE, anchor: 'end' })
    } else {
      const now = x0 + (x1 - x0) * Math.min(1, v.idleMin / TTL_MIN)
      g += `<line x1="${x0}" y1="${ly}" x2="${now}" y2="${ly}" stroke="${FIRE}" stroke-width="5" stroke-linecap="round"/>`
      for (let cx = now + 12; cx <= x1 - 12; cx += 9) g += `<circle cx="${cx}" cy="${ly}" r="2.2" fill="${EMPTY}"/>`
      g += `<circle cx="${x1}" cy="${ly}" r="4.5" fill="none" stroke="${ICE}" stroke-width="2"/>`
      g += txt(x, y + k.cap, t('card.lastReply'), { size: 12, w: 500 })
      g += txt(x1 + 5, y + k.cap, t('card.coldIn', { time: `${Math.max(0, TTL_MIN - v.idleMin)}${t('unit.m')}` }), { size: 12, w: 600, fill: ICE, anchor: 'end' })
    }
    return g
  }

  // The conversation's size, as a dot grid of the context window.
  const zoneSize = (x: number, y: number, w: number, o: { compact?: boolean } = {}) => {
    const share = v.window > 0 ? Math.min(1, v.tokens / v.window) : 0
    let g = txt(x, y + (o.compact ? 24 : 30), t(cold ? 'card.recache' : 'card.inCache'), { ls: 1.4 })
    const big = (yy: number, bs: number, ts: number) =>
      `<text x="${x}" y="${yy}" font-weight="600" fill="${TEXT}"><tspan font-size="${bs}">${tok(v.tokens)}</tspan><tspan font-size="${ts}" font-weight="500" fill="${MUTED}" dx="7">${t('card.tokens')}</tspan></text>`
    const grid = (gx: number, gy: number, cols: number, step: number) => {
      let d = ''
      const lit = Math.round(share * cols * 2)
      for (let r = 0; r < 2; r++)
        for (let c = 0; c < cols; c++) d += `<circle cx="${gx + 3 + c * step}" cy="${gy + r * 9}" r="3" fill="${r * cols + c < lit ? HUEM : EMPTY}"/>`
      return d
    }
    if (o.compact) {
      const cols = 20
      const gx = x + w - (cols - 1) * 9.6 - 6
      return g + big(y + 56, 26, 14) + grid(gx, y + 42, cols, 9.6)
    }
    // 25 dots a row on the page; fewer only where the band is too narrow for them.
    const cols = Math.max(10, Math.min(25, Math.floor(w / 9.6)))
    return g + big(y + 72, 38, 15) + grid(x, y + 90, cols, 9.6) + txt(x, y + 120, t('card.context', { pct: Math.round(share * 100), size: tok(v.window) }), { size: 12, w: 500 })
  }

  // What the next message costs, by model. One scale for both states (the cold
  // write's top price), so a warm read shows as the tiny bar it is.
  const zoneCost = (x: number, y: number, colW: number, o: { compact?: boolean } = {}) => {
    const k = o.compact
      ? { lab: 24, base: 100, rows: 6, step: 7, chip: 58, price: 88, name: 102 }
      : { lab: 30, base: 116, rows: 8, step: 8, chip: 70, price: 104, name: 120 }
    let g = txt(x, y + k.lab, t(cold ? 'card.cost' : 'card.costCached'), { ls: 1.4 })
    const top = Math.max(...MODELS.map(m => coldCost(m, v.tokens)))
    MODELS.forEach((m, i) => {
      const mine = m.id === v.mine
      const n = top > 0 ? Math.max(1, Math.round((costOf(m, mode, v.tokens) / top) * k.rows)) : 1
      const bx = x + i * colW
      for (let r = 0; r < k.rows; r++)
        for (let c = 0; c < 3; c++)
          g += `<circle cx="${bx + 3 + c * 8}" cy="${y + k.base - r * k.step}" r="2.8" fill="${r < n ? (mine ? HUEM : MUTED) : EMPTY}"/>`
      if (mine) g += chipShapes(bx + 30, y + k.chip, t('card.you'), HUEM, 10, 0.8).svg
      g += txt(bx + 30, y + k.price, usd(costOf(m, mode, v.tokens)), { size: 17, w: mine ? 700 : 500, fill: mine ? TEXT : MUTED })
      g += txt(bx + 30, y + k.name, m.NAME, { size: 11, w: 700, fill: mine ? HUEM : MUTED, ls: 0.8 })
    })
    return g
  }

  const kwItems: Array<[string, string]> = [[t('card.keepwarm'), kw.state], [t('card.pings'), kw.pings], [t('card.coldWrites'), kw.cold]]
  const note = (x: number, y: number) => (kw.note ? txt(x, y, esc(clip(kw.note, 44)), { size: 11, w: 500 }) : '')

  // The strip under the zones: the keepwarm state and the two tallies, in columns where there is room.
  const stripColumns = (y: number, xs: number[]) =>
    kwItems.map(([label, value], i) => txt(xs[i] ?? 0, y + 22, label, { ls: 1.4 }) + txt(xs[i] ?? 0, y + 44, esc(value), { size: 17, w: 600, fill: TEXT })).join('') +
    note(xs[0] ?? 0, y + 58)

  const stripRows = (y: number) =>
    kwItems.map(([label, value], i) => txt(13, y + 20 + i * 26, label, { ls: 1.4 }) + txt(W - 13, y + 20 + i * 26, esc(value), { size: 15, w: 600, fill: TEXT, anchor: 'end' })).join('') +
    note(13, y + KW_H_ROWS)

  let H: number
  let g: string
  if (kind === 'wide') {
    H = 132
    // 92 px a model column on the page's full width; tighter near the switch point,
    // where the last column still needs about 90 px for its price.
    const colW = Math.min(92, Math.floor((W - 640 - 103) / 3))
    g = zoneIdle(13, 0, 290, { header: true }) + vline(314, 18, H - 36) + zoneSize(340, 0, 260) + vline(614, 18, H - 36) + zoneCost(640, 0, colW)
    g += hline(H) + stripColumns(H, [13, 340, 640])
    H += KW_H
  } else if (kind === 'stacked') {
    H = 266
    g =
      zoneIdle(13, 0, 290, { header: true }) +
      vline(314, 18, 96) +
      zoneSize(340, 0, W - 340 - 13) +
      hline(134) +
      zoneCost(13, 134, Math.min(160, (W - 26) / 4)) +
      hline(H) +
      stripColumns(H, [13, 13 + Math.round((W - 26) / 3), 13 + Math.round(((W - 26) * 2) / 3)])
    H += KW_H
  } else {
    // Narrow: the cache row above already shows Robo and the chip.
    H = 296
    g =
      zoneIdle(13, 0, W - 26, { compact: true }) +
      hline(110) +
      zoneSize(13, 110, W - 26, { compact: true }) +
      hline(180) +
      zoneCost(13, 182, (W - 26) / 4, { compact: true }) +
      hline(H) +
      stripRows(H)
    H += KW_H_ROWS + (kw.note ? KW_NOTE_H : 0)
  }
  const h = H + CARD_TOP
  const body = `<rect width="${W}" height="${h}" fill="${BG}"/><g transform="translate(0 ${CARD_TOP})">` + hline(0) + g + '</g>'
  const alt = cold
    ? t('card.altCold', { idle: v.idle, tokens: tok(v.tokens) })
    : t('card.altWarm', { minutes: Math.max(0, TTL_MIN - v.idleMin), tokens: tok(v.tokens) })
  return { source: svgDoc(W, h, body, true), w: W, h, alt: `${alt} ${t('card.altKeepwarm', { state: kw.state })}` }
}
