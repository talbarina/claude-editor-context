// The "Sent with" row above your message on the desktop: what the mods attached to it,
// as small chips. The same file in every mod that draws chips; keep the copies in sync.
//
// Each mod's UserMessage hook wraps the row beneath it. The outer one finds the inner
// one's row (keyed "sent-with") and lays every chip out in one row, in the order the
// chips' keys give. Text has no size setting, so the label and chips are SVGs with 11px text.

export type Chip = {
  /** "<rank>:<plugin>:<n>": the rank is the chip's place in the row, lowest first. */
  key: string
  /** Tabler path markup for the chip's icon. */
  icon: string
  label: string
}

export const CHIP_HEIGHT = 18
const CHIP_FONT = 11
const CHIP_TEXT = '#8A8A8A'
const FONT = `font-family="-apple-system,BlinkMacSystemFont,system-ui,sans-serif" font-size="${CHIP_FONT}"`

// About how wide the app's 11px system font draws a label, in px.
function textWidth(text: string) {
  let w = 0
  for (const ch of text) w += /[il.,:·'|1 ]/.test(ch) ? 3.4 : /[A-Z0-9mw–_]/.test(ch) ? 7.2 : 5.7
  return Math.ceil(w)
}

const escapeXml = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

function labelWidth(text: string) {
  return textWidth(text) + 2
}

function labelSvg(text: string) {
  const w = labelWidth(text)
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${CHIP_HEIGHT}" viewBox="0 0 ${w} ${CHIP_HEIGHT}"><text x="0" y="${CHIP_HEIGHT / 2}" dy="0.35em" ${FONT} fill="#6E6C67">${escapeXml(text)}</text></svg>`
}

function chipWidth(label: string) {
  return 7 + 11 + 4 + textWidth(label) + 8
}

function chipSvg(icon: string, label: string) {
  const w = chipWidth(label)
  const glyph = `<g transform="translate(7 3.5) scale(${11 / 24})" fill="none" stroke="${CHIP_TEXT}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">${icon}</g>`
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${CHIP_HEIGHT}" viewBox="0 0 ${w} ${CHIP_HEIGHT}"><rect width="${w}" height="${CHIP_HEIGHT}" rx="6" fill="#FFFFFF" fill-opacity="0.07"/>${glyph}<text x="22" y="${CHIP_HEIGHT / 2}" dy="0.35em" ${FONT} fill="${CHIP_TEXT}">${escapeXml(label)}</text></svg>`
}

const keyOf = (node: any): string => (typeof node?.props?.key === 'string' ? node.props.key : '')
const rankOf = (key: string) => Number(key.match(/^chip:(\d+):/)?.[1] ?? 9)

/** The message row with this mod's chips added to any the mods beneath it drew. */
export function sentWith(elements: any, below: any, mine: Chip[]) {
  const { Box, Svg } = elements
  let chips: any[] = []
  let row = below
  if (keyOf(below) === 'sent-with') {
    const [chipRow, inner] = below.children ?? []
    chips = (chipRow?.children ?? []).filter((c: any) => keyOf(c).startsWith('chip:'))
    row = inner
  }
  const drawn = mine.map(c => (
    <Box key={`chip:${c.key}`} flexDirection="row">
      <Svg source={chipSvg(c.icon, c.label)} alt={c.label} width={chipWidth(c.label)} height={CHIP_HEIGHT} />
    </Box>
  ))
  const all = [...chips, ...drawn]
    .map((node, i) => ({ node, i, rank: rankOf(keyOf(node)) }))
    .sort((a, b) => a.rank - b.rank || a.i - b.i)
    .map(x => x.node)
  // Above the bubble: under it is the app's own hover bar (time, copy, retry).
  return (
    <Box key="sent-with" flexDirection="column" rowGap={0.5}>
      <Box key="sent-with-chips" flexDirection="row" justifyContent="flex-end" alignItems="center" columnGap={0.5} rowGap={0.5} flexWrap="wrap">
        <Svg source={labelSvg('Sent with')} alt="Sent with" width={labelWidth('Sent with')} height={CHIP_HEIGHT} />
        {all}
      </Box>
      {row}
    </Box>
  )
}
