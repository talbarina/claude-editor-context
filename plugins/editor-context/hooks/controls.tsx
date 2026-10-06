// One custom control, drawn by the desktop app: a button with its icon inside,
// a checkbox chip, a count badge (a clay circle and a label) that opens a list,
// a launcher tab (clay while on), or a menu row for a popover: icon, label and a
// quiet hint at the right end, filling the width, lit on hover; or a switch row: icon,
// label, hint and an on/off switch at the right end; or the launcher pet, a picture that
// shows its petted mood while the pointer is on it and is never pressed. Each control is its own Client, so a click anywhere in it
// is a press of it: no hit-testing. The module posts { press: true } and the
// hooks module (register.tsx, `ui.message`) runs the action by the Client's key.
//
// Inside a Client one padding row is a full line (--engine-row-unit: 1lh), not half a
// line as elsewhere in the band: paddingY 0.2 is about 4pt a side, a ~30pt control.
//
// Svg is not in surface.elements, but the engine passes an `h('Svg', …)` node
// through and the desktop draws it (width and height are required there).

type Variant = 'neutral' | 'accent' | 'ghost'

type ControlProps = {
  kind: 'button' | 'check' | 'badge' | 'tab' | 'row' | 'switch' | 'pet'
  label: string
  /** A badge's number, drawn in its circle. */
  count?: number
  /** Tabler path markup for the icon; drawn in the state's color. */
  icon?: string
  /** A whole SVG drawn in the icon's place, for a tab whose icon shows a value (a context ring). */
  iconSvg?: string
  variant?: Variant
  /** A button or checkbox that fills its region, its content centered. */
  isFull?: boolean
  /** A tab's status beside its label, or a row's hint at its right end, drawn quieter. */
  note?: string
  /** A tab's small status dot, in this color. */
  dot?: string
  /** A checkbox's state; for a badge, whether its list is open; for a tab, whether its pane is open. */
  isOn?: boolean
  /** Its message is still being worked on: drawn dim with a spinner, presses ignored. */
  isBusy?: boolean
  /** The pet's picture now, the one while petted, and its size in px. */
  pet?: { svg: string; petted: string; width: number; height: number }
}

type PointerState = { isHover: boolean; isDown: boolean }

// The Claude app's own dark palette, plus the clay accent.
const TEXT = '#F0EFEC'
const MUTED = '#8A8A8A'
const FAINT = '#5C5C5C'
const ACCENT = '#D97757'
const ACCENT_INK = '#1A0F0A'
const ACCENT_TEXT = '#F2A98E'

const FILL: Record<Variant, { rest: string; hover: string; down: string; edge: string; text: string; icon: string }> = {
  neutral: { rest: '#373737', hover: '#434343', down: '#2C2C2C', edge: '#373737', text: TEXT, icon: MUTED },
  accent: { rest: ACCENT, hover: '#E3876A', down: '#C4684A', edge: ACCENT, text: ACCENT_INK, icon: ACCENT_INK },
  ghost: { rest: '#212121', hover: '#2C2C2C', down: '#262626', edge: '#383838', text: MUTED, icon: MUTED },
}

const LOADER = '<path d="M12 3a9 9 0 1 0 9 9"/>'
const ICON_PX = 15

function iconSource(paths: string, color: string, strokeWidth = 2) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`
}

function boxSource(isOn: boolean) {
  const frame = isOn
    ? `<rect x="1" y="1" width="16" height="16" rx="4.5" fill="${ACCENT}"/>`
    : `<rect x="1.75" y="1.75" width="14.5" height="14.5" rx="4" fill="none" stroke="#6A6A6A" stroke-width="1.5"/>`
  const tick = isOn
    ? `<path d="M5 9.2l2.8 2.8l5.2 -5.6" fill="none" stroke="${ACCENT_INK}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>`
    : ''
  return `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 18 18">${frame}${tick}</svg>`
}

const svg = (source: string, alt: string, size = ICON_PX) => h('Svg', { source, alt, width: size, height: size })

const CHEVRON_DOWN = '<path d="M6 9l6 6l6 -6"/>'
const CHEVRON_UP = '<path d="M6 15l6 -6l6 6"/>'

// A badge's count: a clay circle, a pill from two digits.
const COUNT_PX = 20

function countWidth(n: number) {
  return COUNT_PX + Math.max(0, String(n).length - 1) * 8
}

function countSource(n: number) {
  const w = countWidth(n)
  const r = COUNT_PX / 2
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${COUNT_PX}" viewBox="0 0 ${w} ${COUNT_PX}"><rect width="${w}" height="${COUNT_PX}" rx="${r}" fill="${ACCENT}"/><text x="${w / 2}" y="${r}" dy="0.35em" text-anchor="middle" font-family="-apple-system, BlinkMacSystemFont, system-ui, sans-serif" font-size="12" font-weight="700" fill="${ACCENT_INK}">${n}</text></svg>`
}

const Control = (props: ControlProps, surface: any) => {
  const { Box, Text } = surface.elements
  const state: PointerState = surface.state ?? { isHover: false, isDown: false }
  const isBusy = props.isBusy === true

  surface.onPointer((ev: { type: string; x: number; y: number; button?: string }) => {
    const now: PointerState = surface.state ?? { isHover: false, isDown: false }
    const isInside = ev.x >= 0 && ev.y >= 0 && ev.x < surface.columns && ev.y < surface.rows
    if (ev.type === 'enter' || ev.type === 'move') {
      if (now.isHover !== isInside) surface.setState({ ...now, isHover: isInside })
    } else if (ev.type === 'leave') {
      if (now.isHover || now.isDown) surface.setState({ isHover: false, isDown: false })
    } else if (ev.type === 'down' && ev.button === 'left' && !isBusy) {
      surface.setState({ isHover: true, isDown: true })
    } else if (ev.type === 'up') {
      if (now.isDown && isInside && !isBusy && props.kind !== 'pet') surface.post({ press: true })
      surface.setState({ isHover: isInside, isDown: false })
    }
  })

  if (props.kind === 'pet' && props.pet) {
    const { svg: now, petted, width, height } = props.pet
    return Box({ flexDirection: 'row', children: [h('Svg', { source: state.isHover ? petted : now, alt: props.label || 'pet', width, height })] })
  }

  if (props.kind === 'badge') {
    const n = props.count ?? 0
    const bg = state.isDown ? '#36292499' : state.isHover || props.isOn ? '#4A3630' : '#3E2F2A'
    return Box({
      flexDirection: 'row',
      alignItems: 'center',
      columnGap: 1,
      paddingLeft: 0.6,
      paddingRight: 1.25,
      paddingY: 0.2,
      borderStyle: 'round',
      borderColor: props.isOn ? '#74483A' : bg,
      backgroundColor: bg,
      children: [
        h('Svg', { source: countSource(n), alt: String(n), width: countWidth(n), height: COUNT_PX }),
        Text({ color: ACCENT_TEXT, bold: true, children: props.label }),
        svg(iconSource(props.isOn ? CHEVRON_UP : CHEVRON_DOWN, ACCENT_TEXT), props.isOn ? 'hide' : 'show', 13),
      ],
    })
  }

  if (props.kind === 'tab') {
    const isOn = props.isOn === true
    const bg = isOn ? (state.isDown ? '#36292499' : state.isHover ? '#4A3630' : '#3E2F2A') : state.isDown ? '#2C2C2C' : state.isHover ? '#2A2A2A' : '#212121'
    return Box({
      flexDirection: 'row',
      alignItems: 'center',
      columnGap: 1,
      paddingX: 1.25,
      paddingY: 0.2,
      flexShrink: 0,
      borderStyle: 'round',
      borderColor: isOn ? '#74483A' : '#383838',
      backgroundColor: bg,
      children: [
        ...(props.iconSvg
          ? [h('Svg', { source: props.iconSvg, alt: props.label, width: ICON_PX, height: ICON_PX })]
          : props.icon ? [svg(iconSource(props.icon, isOn ? ACCENT : state.isHover ? TEXT : MUTED), props.label)] : []),
        Text({ color: isOn ? ACCENT_TEXT : TEXT, wrap: 'wrap', children: props.label }),
        ...(props.dot ? [h('Svg', { source: `<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 10 10"><circle cx="5" cy="5" r="4" fill="${props.dot}"/></svg>`, alt: 'status', width: 7, height: 7 })] : []),
        ...(props.note ? [Text({ color: isOn ? ACCENT_TEXT : MUTED, dimColor: isOn, wrap: 'wrap', children: props.note })] : []),
      ],
    })
  }

  if (props.kind === 'switch') {
    const isOn = props.isOn === true
    const bg = state.isDown ? '#262626' : state.isHover ? '#2A2A2A' : '#1F1F1F'
    const track = `<svg xmlns="http://www.w3.org/2000/svg" width="30" height="18" viewBox="0 0 30 18"><rect width="30" height="18" rx="9" fill="${isOn ? ACCENT : '#4A4A4A'}"/><circle cx="${isOn ? 21 : 9}" cy="9" r="7" fill="${isOn ? ACCENT_INK : '#BDBDBD'}"/></svg>`
    return Box({
      flexDirection: 'row',
      alignItems: 'center',
      columnGap: 1,
      paddingX: 1,
      paddingY: 0.2,
      borderStyle: 'round',
      borderColor: bg,
      backgroundColor: bg,
      children: [
        ...(props.icon ? [svg(iconSource(props.icon, isOn ? ACCENT : state.isHover ? TEXT : MUTED), props.label)] : []),
        Text({ color: isOn ? ACCENT_TEXT : TEXT, bold: props.variant === 'accent', children: props.label }),
        ...(props.note ? [Text({ color: MUTED, wrap: 'truncate-end', children: props.note })] : []),
        Box({ flexGrow: 1 }),
        h('Svg', { source: track, alt: isOn ? 'on' : 'off', width: 30, height: 18 }),
      ],
    })
  }

  if (props.kind === 'row') {
    const isAccent = props.variant === 'accent'
    // The popover card's own fill, so a row at rest sits flat on it.
    const bg = state.isDown ? '#262626' : state.isHover ? '#2A2A2A' : '#1F1F1F'
    const paths = isBusy ? LOADER : props.icon
    const iconColor = isBusy ? FAINT : isAccent ? ACCENT : state.isHover ? TEXT : MUTED
    return Box({
      flexDirection: 'row',
      alignItems: 'center',
      columnGap: 1,
      paddingX: 1,
      paddingY: 0.2,
      borderStyle: 'round',
      borderColor: bg,
      backgroundColor: bg,
      children: [
        ...(paths ? [svg(iconSource(paths, iconColor), isBusy ? 'working' : props.label)] : []),
        Text({ color: isBusy ? FAINT : isAccent ? ACCENT_TEXT : TEXT, children: isBusy ? `${props.label}…` : props.label }),
        Box({ flexGrow: 1 }),
        ...(props.note ? [Text({ color: MUTED, wrap: 'truncate-end', children: props.note })] : []),
      ],
    })
  }

  if (props.kind === 'check') {
    const isOn = props.isOn === true
    const bg = isOn ? (state.isDown ? '#36292499' : '#3E2F2A') : state.isHover ? '#2A2A2A' : '#212121'
    const edge = isOn ? '#74483A' : '#383838'
    return Box({
      flexDirection: 'row',
      alignItems: 'center',
      ...(props.isFull ? { justifyContent: 'center' } : {}),
      columnGap: 1,
      paddingX: 1.25,
      paddingY: 0.2,
      borderStyle: 'round',
      borderColor: edge,
      backgroundColor: bg,
      children: [
        svg(boxSource(isOn), isOn ? 'on' : 'off', 16),
        ...(props.icon ? [svg(iconSource(props.icon, isOn ? ACCENT : FAINT), props.label)] : []),
        Text({ color: isOn ? ACCENT_TEXT : state.isHover ? TEXT : MUTED, children: props.label }),
      ],
    })
  }

  const fill = FILL[props.variant ?? 'neutral']
  const bg = isBusy ? '#2A2A2A' : state.isDown ? fill.down : state.isHover ? fill.hover : fill.rest
  const textColor = isBusy ? FAINT : fill.text
  const iconColor = isBusy ? FAINT : state.isHover && props.variant !== 'accent' ? TEXT : fill.icon
  const paths = isBusy ? LOADER : props.icon
  return Box({
    flexDirection: 'row',
    alignItems: 'center',
    ...(props.isFull ? { justifyContent: 'center' } : {}),
    columnGap: 1,
    paddingX: !props.label ? 0.75 : paths ? 1.25 : 1.5,
    paddingY: 0.2,
    borderStyle: 'round',
    borderColor: isBusy ? '#2A2A2A' : fill.edge,
    backgroundColor: bg,
    children: [
      ...(paths ? [svg(iconSource(paths, iconColor), isBusy ? 'working' : props.label || 'icon')] : []),
      ...(props.label ? [Text({ color: textColor, bold: props.variant === 'accent', children: isBusy ? `${props.label}…` : props.label })] : []),
    ],
  })
}

export default Control
