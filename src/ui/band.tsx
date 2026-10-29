import type { EngineInterface, MatchedHook } from 'claude-code'

import { TTL_MIN, costOf, mineModel, readCache, readFold, toggleFold, usd, viewOf } from '../cache/cache'
import { armKeepwarm, disarmKeepwarm, readKeepwarm } from '../keepwarm/engine'
import type { State } from '../keepwarm/engine'
import { isArmed, kwCard, kwValue } from '../keepwarm/view'
import { t } from '../i18n'
import type { Options } from '../options'
import type { Window } from '../../types'
import { readWindows, windowParts } from '../usage/usage'
import { chipSvg, justPinged, mascotSvg, wordOf } from './art'
import { cardSvg } from './card'
import {
  BG, CELLS, EMPTY, HUE, INK, KW_BUTTON_COLORS, KW_COLORS, KW_LONG_AT, KW_LONG_AT_TERMINAL, LOW_AT, LOW_COLOR, MASCOT_SIZE, MUTED, TEXT,
  TIGHT_CELLS, bandPx, kindOf,
} from './theme'

// A band above the prompt in a purple cyberpunk look: dark violet surface, pale
// lavender text, dot-matrix bars. Shows how much of each usage window is LEFT, 7-day
// first, then 5-hour; 7D is violet, 5H is magenta; a window under 15% adds a bold red LOW.
//
// After the first reply it also shows the prompt cache: WARM (neon magenta, netrunner
// online) for an hour after the last request, then COLD (ice cyan, netrunner frozen) with what the
// next message costs to re-cache. Hide / Show folds the card; warm starts folded,
// cold starts open, and a choice holds until the cache flips. Zero token cost:
// it reads the engine's own figures and draws.
//
// Beside the cache chip, KEEPWARM says until when the cache is held warm (or always,
// or off), a button arms it or disarms it, and the card gains the ping and cold-write
// tallies. A narrow band and the terminal say it in short form.

// Same as typing /keepwarm or /keepwarm off. A press reads the window fresh: the one drawn may be a redraw behind.
async function toggleKeepwarm($: EngineInterface, s: State): Promise<void> {
  const armed = isArmed(s, await $.clock.now())
  await (armed ? disarmKeepwarm($, s) : armKeepwarm($, s))
}

/** Whether the last draw had the card open, to tell an opening from a redraw. */
let cardWasOpen = false

type RenderHook = MatchedHook<'ui.render', { readonly component: 'AbovePrompt' }>
type RenderArgs = Parameters<RenderHook>

export async function renderBand($: RenderArgs[0], e: RenderArgs[1], next: RenderArgs[2], kwState: State, options: Options): Promise<Awaited<ReturnType<RenderHook>>> {
  if (e.props.hasSurvey) return next(e)

  const ui = $.ui.resolve(e)
  const { Box, Button, Text } = ui
  // Svg draws on desktop, mobile and VS Code; the terminal gets the text form.
  // Ask the surface, not the table: the terminal's table still lists Svg.
  const Svg = e.surface !== 'terminal' && 'Svg' in ui ? ui.Svg : null
  const list = await readWindows($)
  const now = await $.clock.now()
  const view = viewOf(await readCache($), now)
  const facts = await readKeepwarm($)

  if (list.length === 0 && !view) {
    return (
      <Box backgroundColor={BG} paddingX={1}>
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

  // Wide: every window on one row. Narrow: each window is a block of three
  // lines (name and dots, percent left, reset time) so nothing wraps or clips.
  const wide = (w: Window, i: number) => {
    const p = parts(w)
    return (
      <Box key={`w-${i}`} flexDirection="row" flexShrink={0} marginRight={compact ? 2 : 3}>
        <Text color={MUTED} bold>{p.name} </Text>
        <Text color={p.col}>{p.d.on}</Text>
        <Text color={EMPTY}>{p.d.off}</Text>
        <Text color={p.col} bold> {p.left}%{compact ? '' : ` ${t('band.left')}`}</Text>
        {p.left < LOW_AT ? <Text color={LOW_COLOR} bold>{` ${t('band.low')}`}</Text> : null}
        {p.reset ? <Text color={MUTED}> · {p.reset}</Text> : null}
      </Box>
    )
  }

  const stacked = (w: Window, i: number) => {
    const p = parts(w)
    return (
      <Box key={`w-${i}`} flexDirection="column" flexShrink={0} marginRight={3}>
        <Box flexDirection="row">
          <Text color={MUTED} bold>{p.name} </Text>
          <Text color={p.col}>{p.d.on}</Text>
          <Text color={EMPTY}>{p.d.off}</Text>
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
  const usage = list.length > 0
    ? list.map(isWide ? wide : stacked)
    : [<Box key="wait" flexShrink={0} marginRight={3}><Text color={MUTED}>{t('band.waiting')}</Text></Box>]

  const grow = <Box key="grow" flexGrow={1} />
  const armed = isArmed(facts, now)
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
  const kwLabel = isShort ? t(armed ? 'kw.offButton' : 'kw.on') : armed ? t('kw.disarm') : t('kw.arm', { window: options.keepwarmWindow.text })
  const kwButton = (
    <Box key="kw-button" flexShrink={0} alignItems="center" marginLeft={1}>
      <Button key="keepwarm-toggle" label={kwLabel} onPress={() => toggleKeepwarm($, kwState)}>
        <Text color={KW_BUTTON_COLORS[value.tone]} bold>{kwLabel}</Text>
      </Button>
    </Box>
  )
  // Compact: the button says the state itself, so one element holds what two did.
  const kwChipLabel = value.tone === 'off' ? t('kw.offShort') : `${t('kw.nameShort')} ${value.short}`
  const kwChip = (
    <Box key="kw-button" flexShrink={0} alignItems="center" marginLeft={1}>
      <Button key="keepwarm-toggle" label={kwChipLabel} onPress={() => toggleKeepwarm($, kwState)}>
        <Text color={KW_BUTTON_COLORS[value.tone]} bold>{kwChipLabel}</Text>
      </Button>
    </Box>
  )
  const kwRow = (
    <Box key="kwrow" flexDirection="row" paddingX={1} alignItems="center">
      {kwIndicator}
      {grow}
      {kwButton}
    </Box>
  )

  // Before the first reply there is no cache to show: today's band, as it was,
  // plus the keepwarm row once keepwarm is armed or has stopped.
  if (!view) {
    const row = (
      <Box key="row" flexDirection="row" paddingX={1}>
        {label}
        {usage}
      </Box>
    )
    return (
      <Box flexDirection="column" backgroundColor={BG}>
        {row}
        {value.tone === 'off' ? null : kwRow}
      </Box>
    )
  }

  const mode = view.mode
  const cold = mode === 'cold'
  const hue = HUE[mode]
  const mine = mineModel(view)
  const stored = await readFold($)
  // Folding needs the card, and the card is a drawing: the terminal stays folded.
  const open = Svg !== null && (stored && stored.mode === mode ? stored.open : cold)
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
        mine ? <Text key="cost" color={TEXT} bold>{usd(costOf(mine, mode, view.tokens))}</Text> : null,
      ]
    : [<Text key="left" color={hue} bold>{` ${Math.max(0, TTL_MIN - view.idleMin)}${t('unit.m')}${compact ? '' : ` ${t('band.left')}`}`}</Text>]

  const button = Svg ? (
    <Box key="fold" flexShrink={0} alignItems="center">
      <Button key="cache-fold" label={t(open ? 'band.hide' : 'band.show')} onPress={toggle}>
        <Text color={hue} bold>{t(open ? 'band.hide' : 'band.show')}</Text>
      </Button>
    </Box>
  ) : null
  const isInline = kind === 'wide'

  let rows
  if (kind === 'wide') {
    rows = (
      <Box key="row" flexDirection="row" paddingX={1} alignItems="center">
        {label}
        {usage}
        {open ? null : (
          <Box key="inline" flexDirection="row" flexShrink={0} marginRight={compact ? 1 : 2} alignItems="center">
            {badge}
            {summary}
          </Box>
        )}
        {isInline && !compact ? kwIndicator : null}
        {grow}
        {button}
        {isInline ? (compact ? kwChip : kwButton) : null}
      </Box>
    )
  } else if (kind === 'stacked') {
    // The cache becomes a third stacked block, the same shape as 7D and 5H.
    rows = (
      <Box key="row" flexDirection="row" paddingX={1}>
        {label}
        {usage}
        {open ? null : (
          <Box key="block" flexDirection="column" flexShrink={0} marginRight={2}>
            <Box flexDirection="row" alignItems="center">{badge}</Box>
            <Text color={hue} bold>{cold ? t('band.idle', { time: view.idle }) : `${Math.max(0, TTL_MIN - view.idleMin)}${t('unit.m')} ${t('band.left')}`}</Text>
            {mine ? (
              <Box flexDirection="row">
                <Text color={TEXT} bold>{usd(costOf(mine, mode, view.tokens))}</Text>
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
      <Box key="row" flexDirection="row" paddingX={1}>
        {label}
        {usage}
      </Box>,
      <Box key="cache" flexDirection="row" paddingX={1} alignItems="center">
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
  if (open && Svg) {
    const px = bandPx(columns)
    const c = cardSvg(view, kind, Math.floor(px / options.cardScale), kwCard(facts, now), intro)
    card = (
      <Box key="card" flexDirection="row">
        <Svg source={c.source} alt={c.alt} width={px} height={Math.round((c.h * px) / c.w)} isInteractive={kind !== 'tight'} />
      </Box>
    )
  }

  return (
    <Box flexDirection="column" backgroundColor={BG}>
      {rows}
      {isInline ? null : kwRow}
      {card}
    </Box>
  )
}
