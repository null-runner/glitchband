import type { EngineInterface, MatchedHook } from 'claude-code'

import { costOf, mineModel, readCache, readFold, toggleFold, usd, viewOf } from '../cache/cache'
import { keepwarmCommand } from '../keepwarm/commands'
import { parseDuration, readKeepwarm } from '../keepwarm/engine'
import type { State } from '../keepwarm/engine'
import { kwCard, kwValue } from '../keepwarm/view'
import { t } from '../i18n'
import type { Options } from '../options'
import type { Window } from '../../types'
import { readWindows, windowParts } from '../usage/usage'
import { CHIP_WIDTHS, barSvg, chipSvg, justPinged, mascotSvg, wordOf } from './art'
import { cardSvg } from './card'
import {
  BAR_H, BAR_W, BAR_W_SHORT, BELOW_ROWS, BG, SAFETY_PX, SELECT_CHROME, BTN_CHROME, CELL_PX, CHAR_PX, PAD_PX, CELLS, CHIP_EDGE, EMPTY, HEAD_ROWS, HUE, INK, KW_COLORS, KW_LONG_AT, KW_LONG_AT_TERMINAL, LOW_AT, LOW_COLOR, MASCOT_SIZE, MUTED, ROW_PX,
  TEXT, CARD_MAX_PX, TIGHT_CELLS, bandPx, kindOf,
} from './theme'

// A band above the prompt in a neutral look that matches Claude Desktop: dark warm grey surface,
// off-white text, one violet. Shows how much of each usage window is LEFT, 7-day first, then
// 5-hour, as a bar (dots in the terminal); 7D is violet, 5H light grey; a window under 15% adds a red LOW.
//
// After the first reply it also shows the prompt cache: WARM (coral, netrunner
// lit with sparks) until the cache's lifetime (1 hour or 5 minutes) passes, then COLD (ice blue, netrunner frozen) with what the
// next message costs to re-cache. Hide / Show folds the card; warm starts folded,
// cold starts open, and a choice holds until the cache flips. Zero token cost:
// it reads the engine's own figures and draws.
//
// Beside the cache chip, KEEPWARM says until when the cache is held warm (or always,
// or off), a button arms it or disarms it, and the card gains the ping and cold-write
// tallies. A narrow band and the terminal say it in short form.

/** Whether the last draw had the card open, to tell an opening from a redraw. */
let cardWasOpen = false

type RenderHook = MatchedHook<'ui.render', { readonly component: 'AbovePrompt' }>
type RenderArgs = Parameters<RenderHook>

export async function renderBand($: RenderArgs[0], e: RenderArgs[1], next: RenderArgs[2], kwState: State, options: Options): Promise<Awaited<ReturnType<RenderHook>>> {
  if (e.props.hasSurvey) return next(e)

  const ui = $.ui.resolve(e)
  const { Box, Button, Text } = ui
  // The band is raised on the terminal and the desktop, and both draw a Select.
  const Select = 'Select' in ui ? ui.Select : null
  // Svg draws on desktop, mobile and VS Code; the terminal gets the text form.
  // Ask the surface, not the table: the terminal's table still lists Svg.
  const Svg = e.surface !== 'terminal' && 'Svg' in ui ? ui.Svg : null
  const list = await readWindows($)
  const now = await $.clock.now()
  const view = viewOf(await readCache($), now)
  const facts = await readKeepwarm($)

  if (list.length === 0 && !view) {
    return (
      <Box backgroundColor={BG} paddingX="md" paddingTop="md" paddingBottom="md">
        <Text color={MUTED}>{`${t('band.usage')} · ${t('band.waiting')}`}</Text>
      </Box>
    )
  }

  const columns = e.props.bodyColumns ?? e.viewport?.columns ?? 100
  const kind = kindOf(columns)
  const isWide = kind === 'wide'
  const compact = isWide && columns < options.compactBelow
  const isShort = kind === 'tight' || e.surface === 'terminal' || (isWide && columns < (Svg ? KW_LONG_AT : KW_LONG_AT_TERMINAL))
  const cells = kind === 'tight' ? TIGHT_CELLS : CELLS

  const parts = (w: Window) => windowParts(w, cells, now)

  // The bar of a window on the desktop (a drawing), the dots of the terminal (text). Under LOW the bar turns red.
  const meter = (p: ReturnType<typeof parts>, barW = BAR_W) =>
    Svg ? (
      <Svg key="bar" source={barSvg(p.left, p.left < LOW_AT ? LOW_COLOR : p.col, barW)} alt={`${p.name} ${p.left}%`} width={barW} height={BAR_H} isInteractive />
    ) : (
      [<Text key="on" color={p.col}>{p.d.on}</Text>, <Text key="off" color={EMPTY}>{p.d.off}</Text>]
    )

  // Wide: every window on one row. Narrow: each window is a block of three
  // lines (name and dots, percent left, reset time) so nothing wraps or clips.
  // `lvl` is how crowded the row is: 0 as drawn, 1 without the reset times, 2 also without the USAGE word, 3 also with shorter bars.
  const wide = (w: Window, i: number, lvl = 0) => {
    const p = parts(w)
    return (
      <Box key={`w-${i}`} flexDirection="row" flexShrink={0} alignItems="center" marginRight={compact ? 2 : 3}>
        <Text color={MUTED} bold>{p.name} </Text>
        {meter(p, lvl > 2 ? BAR_W_SHORT : BAR_W)}
        <Text color={p.col} bold> {p.left}%{compact ? '' : ` ${t('band.left')}`}</Text>
        {p.left < LOW_AT ? <Text color={LOW_COLOR} bold>{` ${t('band.low')}`}</Text> : null}
        {p.reset && lvl === 0 ? <Text color={MUTED}> · {p.reset}</Text> : null}
      </Box>
    )
  }

  const stacked = (w: Window, i: number) => {
    const p = parts(w)
    return (
      <Box key={`w-${i}`} flexDirection="column" flexShrink={0} marginRight={3}>
        <Box flexDirection="row" alignItems="center">
          <Text color={MUTED} bold>{p.name} </Text>
          {meter(p)}
        </Box>
        <Box flexDirection="row">
          <Text color={p.col} bold>{`${p.left}% ${t('band.left')}`}</Text>
          {p.left < LOW_AT ? <Text color={LOW_COLOR} bold>{` ${t('band.low')}`}</Text> : null}
        </Box>
        {p.reset ? <Text color={MUTED}>{t('band.resets', { time: p.reset })}</Text> : null}
      </Box>
    )
  }

  const label = (
    <Box key="label" flexShrink={0} marginRight={isWide ? 2 : 3}>
      <Text color={TEXT} bold>{t('band.usage')}</Text>
    </Box>
  )
  const usageAt = (lvl: number) => list.length > 0
    ? list.map((w, i) => (isWide ? wide(w, i, lvl) : stacked(w, i)))
    : [<Box key="wait" flexShrink={0} marginRight={3}><Text color={MUTED}>{t('band.waiting')}</Text></Box>]

  const usage = usageAt(0)
  const grow = <Box key="grow" flexGrow={1} />
  const value = kwValue(facts, now)
  const kwIndicator = (
    <Box key="kw" flexDirection="row" flexShrink={0} marginRight={2}>
      {value.tone === 'off' ? (
        <Text color={MUTED}>{isShort ? t('kw.offShort') : t('kw.off')}</Text>
      ) : (
        [
          <Text key="name" color={MUTED} bold>{`${isShort ? t('kw.nameShort') : t('kw.name')} `}</Text>,
          <Text key="value" color={KW_COLORS[value.tone]} bold>{isShort ? value.short : value.text}</Text>,
        ]
      )}
    </Box>
  )
  // The keepwarm control: a Select of the same choices as /keepwarm, short and of fixed width ("KW 6h"), so a label can never
  // outgrow the row. A pick runs the command itself. `value` follows the state, whoever changed it.
  const windows = [...new Set(['90m', options.keepwarmWindow.text, '12h'])]
  const remaining = value.tone === 'on' && facts && !facts.always ? facts.deadline - now : 0
  const picked = windows.find(w => (parseDuration(w) ?? 0) >= remaining)
  const kwSelect = Select && (
    <Box key="kw-select" flexShrink={0} alignItems="center" marginLeft={1}>
      <Select
        key="keepwarm-select"
        label={t('kw.nameShort')}
        options={[
          { value: 'off', label: t('kw.offButton') },
          ...windows.map(w => ({ value: w, label: w })),
          { value: 'always', label: t('kw.select.always') },
          ...(remaining > 0 && !picked ? [{ value: 'on', label: t('kw.on') }] : []),
        ]}
        value={value.tone !== 'on' ? 'off' : facts?.always ? 'always' : (picked ?? 'on')}
        onSelect={(choice: string) => (choice === 'on' ? undefined : keepwarmCommand(kwState, $, { args: choice } as Parameters<typeof keepwarmCommand>[2]))}
      />
    </Box>
  )
  const kwRowOf = (padB: 'xs' | 'md') => (
    <Box key="kwrow" flexDirection="row" paddingX="md" paddingTop="md" paddingBottom={padB} alignItems="center">
      {kwIndicator}
      {grow}
      {kwSelect}
    </Box>
  )

  // Before the first reply there is no cache to show: today's band, as it was,
  // plus the keepwarm row once keepwarm is armed or has stopped.
  if (!view) {
    const row = (
      <Box key="row" flexDirection="row" paddingX="md" paddingTop="md" paddingBottom="md">
        {label}
        {usage}
      </Box>
    )
    return (
      <Box flexDirection="column" width="100%" backgroundColor={BG}>
        {row}
        {value.tone === 'off' ? null : kwRowOf('md')}
      </Box>
    )
  }

  const mode = view.mode
  const cold = mode === 'cold'
  const hue = HUE[mode]
  const mine = mineModel(view)
  const stored = await readFold($)
  // Folding needs the card, and the card is a drawing: the terminal stays folded.
  // The card must fit the rows the band may take, or the engine scrolls it: the desktop measured a hair over its
  // window with the full strip, so the card always takes the one-line strip; no fit, no card (and no Show button).
  const px = Math.min(bandPx(columns), CARD_MAX_PX)
  const budget = (e.props.maxRows - HEAD_ROWS[kind] - BELOW_ROWS) * ROW_PX
  const kwText = kwCard(facts, now)
  const drawCard = (intro: boolean) => {
    const c = cardSvg(view, kind, Math.floor(px / options.cardScale), kwText, intro, true)
    const h = Math.round((c.h * px) / c.w)
    return h <= budget ? { ...c, h } : null
  }
  const fits = Svg !== null && drawCard(false) !== null
  const open = fits && (stored && stored.mode === mode ? stored.open : cold)
  // Open, the card follows at once: the row keeps less room under it.
  const padB = open ? 'xs' : 'md'
  const toggle = () => toggleFold($, mode)

  const badge = Svg
    ? [
        <Svg key="mascot" source={mascotSvg(mode, justPinged(facts, now))} alt={t(cold ? 'mascot.frozen' : 'mascot.online')} width={MASCOT_SIZE} height={MASCOT_SIZE} isInteractive />,
        <Text key="gap"> </Text>,
        (() => {
          const c = chipSvg(mode)
          return <Svg key="chip" source={c.source} alt={wordOf(mode)} width={c.w} height={c.h} isInteractive />
        })(),
      ]
    : [<Text key="chip" backgroundColor={hue} color={INK} bold>{` ${wordOf(mode)} `}</Text>]

  const summary = cold
    ? [
        <Text key="idle" color={hue} bold>{` ${view.idle}`}</Text>,
        mine ? <Text key="dot" color={MUTED}> · </Text> : null,
        mine ? <Text key="cost" color={TEXT} bold>{usd(costOf(mine, mode, view.tokens, view.ttlMin * 60000))}</Text> : null,
      ]
    : [<Text key="left" color={hue} bold>{` ${Math.max(0, view.ttlMin - view.idleMin)}${t('unit.m')}${compact ? '' : ` ${t('band.left')}`}`}</Text>]

  const button = fits ? (
    <Box key="fold" flexShrink={0} alignItems="center">
      <Button key="cache-fold" label={t(open ? 'band.hide' : 'band.show')} variant="secondary" hover={{ color: CHIP_EDGE[mode] }} onPress={toggle}>
        <Text color={hue} bold>{t(open ? 'band.hide' : 'band.show')}</Text>
      </Button>
    </Box>
  ) : null
  const isInline = kind === 'wide'

  // The wide row's room, estimated in pixels from its characters: the keepwarm button is sized for its
  // longest label, and what gives way first is the reset times, then the bar length, never a button.
  const textPx = (str: string) => str.length * CHAR_PX
  const rowPx = (lvl: number): number => {
    const clock = '00/00 00:00'
    let px = lvl < 2 ? textPx(t('band.usage')) + (isWide ? 2 : 3) * CELL_PX : 0
    for (const w of list) {
      const p = parts(w)
      const text = `${p.name}  ${p.left}%${compact ? '' : ` ${t('band.left')}`}${p.left < LOW_AT ? ` ${t('band.low')}` : ''}${p.reset && lvl === 0 ? ` · ${p.reset}` : ''}`
      px += textPx(text) + (Svg ? (lvl > 2 ? BAR_W_SHORT : BAR_W) : 0) + (compact ? 2 : 3) * CELL_PX
    }
    if (!open) {
      const word = CHIP_WIDTHS[`${wordOf(mode)}@13`]?.w ?? 70
      const tail = cold ? ` ${view.idle}${mine ? ' · $00.00' : ''}` : ` 00${t('unit.m')}${compact ? '' : ` ${t('band.left')}`}`
      px += (Svg ? MASCOT_SIZE + CHAR_PX + word : 0) + textPx(tail) + (compact ? 1 : 2) * CELL_PX
    }
    if (!compact) px += textPx(`${isShort ? t('kw.nameShort') : t('kw.name')} ${isShort ? clock : t('kw.until', { time: clock })}`) + 2 * CELL_PX
    px += Math.max(...[t('band.show'), t('band.hide')].map(textPx)) + BTN_CHROME + 2 * CELL_PX
    return px + textPx(`${t('kw.nameShort')} ${t('kw.select.always')}`) + SELECT_CHROME + CELL_PX + SAFETY_PX
  }
  // The column count overstates the desktop slot; the dark panel measured ~950 px, so the row budgets from the same cap as the card.
  const room = Math.min(columns * CELL_PX, CARD_MAX_PX) - 2 * PAD_PX
  const level = !Svg || !isWide ? 0 : [0, 1, 2].find(l => rowPx(l) <= room) ?? 3

  let rows
  if (kind === 'wide') {
    rows = (
      <Box key="row" flexDirection="row" paddingX="md" paddingTop="md" paddingBottom={padB} alignItems="center">
        {level < 2 ? label : null}
        {usageAt(level)}
        {open ? null : (
          <Box key="inline" flexDirection="row" flexShrink={0} marginRight={compact ? 1 : 2} alignItems="center">
            {badge}
            {summary}
          </Box>
        )}
        {isInline && !compact ? kwIndicator : null}
        {grow}
        {button}
        {isInline ? kwSelect : null}
      </Box>
    )
  } else if (kind === 'stacked') {
    // The cache becomes a third stacked block, the same shape as 7D and 5H.
    rows = (
      <Box key="row" flexDirection="row" paddingX="md" paddingTop="md" paddingBottom={padB}>
        {label}
        {usage}
        {open ? null : (
          <Box key="block" flexDirection="column" flexShrink={0} marginRight={2}>
            <Box flexDirection="row" alignItems="center">{badge}</Box>
            <Text color={hue} bold>{cold ? t('band.idle', { time: view.idle }) : `${Math.max(0, view.ttlMin - view.idleMin)}${t('unit.m')} ${t('band.left')}`}</Text>
            {mine ? (
              <Box flexDirection="row">
                <Text color={TEXT} bold>{usd(costOf(mine, mode, view.tokens, view.ttlMin * 60000))}</Text>
                <Text color={MUTED}>{` ${t('band.next')}`}</Text>
              </Box>
            ) : null}
          </Box>
        )}
        {grow}
        {button}
      </Box>
    )
  } else {
    // Narrow: the cache gets its own row under the usage blocks.
    rows = [
      <Box key="row" flexDirection="row" paddingX="md" paddingTop="md" paddingBottom={padB}>
        {label}
        {usage}
      </Box>,
      <Box key="cache" flexDirection="row" paddingX="md" paddingTop="md" paddingBottom={padB} alignItems="center">
        {badge}
        {summary}
        {grow}
        {button}
      </Box>,
    ]
  }

  // The card's bars fill in once, on the draw that opens it.
  const intro = open && !cardWasOpen
  cardWasOpen = open
  let card = null
  const c = open ? drawCard(intro) : null
  if (c && Svg) {
    card = (
      <Box key="card" flexDirection="row">
        <Svg source={c.source} alt={c.alt} width={px} height={c.h} isInteractive={kind !== 'tight'} />
      </Box>
    )
  }

  return (
    // marginBottom: a gap before another mod's band stacked under the panel.
    <Box flexDirection="column" width="100%" backgroundColor={BG} marginBottom="sm">
      {rows}
      {isInline ? null : kwRowOf(padB)}
      {card}
    </Box>
  )
}
