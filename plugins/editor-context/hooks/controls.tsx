// One custom control, drawn by the desktop app: a launcher tab (clay while on), a switch
// row for a popover (icon, label, hint and an on/off switch at the right end), or the
// launcher pet, a picture that shows its petted mood while the pointer is on it and is
// never pressed. Buttons are the app's own (Button); only these three are drawn here.
// Each control is its own Client, so a click anywhere in it is a press of it: no
// hit-testing. The module posts { press: true } and the hooks module (register.tsx,
// `ui.message`) runs the action by the Client's key.
//
// Inside a Client one padding row is a full line (--engine-row-unit: 1lh), not half a
// line as elsewhere in the band: paddingY 0.2 is about 4pt a side, a ~30pt control.
//
// Svg is not in surface.elements, but the engine passes an `h('Svg', …)` node
// through and the desktop draws it (width and height are required there).

type ControlProps = {
  kind: 'tab' | 'switch' | 'pet'
  label: string
  /** Tabler path markup for the icon; drawn in the state's color. */
  icon?: string
  /** A whole SVG drawn in the icon's place, for a tab whose icon shows a value (a context ring). */
  iconSvg?: string
  /** A tab's status beside its label, or a switch row's hint after its label, drawn quieter. */
  note?: string
  /** A tab's small status dot, in this color. */
  dot?: string
  /** A switch's state; for a tab, whether it is lit. */
  isOn?: boolean
  /** The pet's picture now, the one while petted, and its size in px. */
  pet?: { svg: string; petted: string; width: number; height: number }
}

type PointerState = { isHover: boolean; isDown: boolean }

// The Claude app's own dark palette, plus the clay accent.
const TEXT = '#F0EFEC'
const MUTED = '#8A8A8A'
const ACCENT = '#D97757'
const ACCENT_INK = '#1A0F0A'
const ACCENT_TEXT = '#F2A98E'

const ICON_PX = 15

function iconSource(paths: string, color: string, strokeWidth = 2) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`
}

const svg = (source: string, alt: string, size = ICON_PX) => h('Svg', { source, alt, width: size, height: size })

const Control = (props: ControlProps, surface: any) => {
  const { Box, Text } = surface.elements
  const state: PointerState = surface.state ?? { isHover: false, isDown: false }

  surface.onPointer((ev: { type: string; x: number; y: number; button?: string }) => {
    const now: PointerState = surface.state ?? { isHover: false, isDown: false }
    const isInside = ev.x >= 0 && ev.y >= 0 && ev.x < surface.columns && ev.y < surface.rows
    if (ev.type === 'enter' || ev.type === 'move') {
      if (now.isHover !== isInside) surface.setState({ ...now, isHover: isInside })
    } else if (ev.type === 'leave') {
      if (now.isHover || now.isDown) surface.setState({ isHover: false, isDown: false })
    } else if (ev.type === 'down' && ev.button === 'left') {
      surface.setState({ isHover: true, isDown: true })
    } else if (ev.type === 'up') {
      if (now.isDown && isInside && props.kind !== 'pet') surface.post({ press: true })
      surface.setState({ isHover: isInside, isDown: false })
    }
  })

  if (props.kind === 'pet' && props.pet) {
    const { svg: now, petted, width, height } = props.pet
    return Box({ flexDirection: 'row', children: [h('Svg', { source: state.isHover ? petted : now, alt: props.label || 'pet', width, height })] })
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

  // A switch row.
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
      Text({ color: isOn ? ACCENT_TEXT : TEXT, children: props.label }),
      ...(props.note ? [Text({ color: MUTED, wrap: 'truncate-end', children: props.note })] : []),
      Box({ flexGrow: 1 }),
      h('Svg', { source: track, alt: isOn ? 'on' : 'off', width: 30, height: 18 }),
    ],
  })
}

export default Control
