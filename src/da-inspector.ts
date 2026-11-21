import type {Item} from './data'
import {applicationDetailsContent, loadApplicationDetails, type ApplicationBlocks} from './planning'

function blockLabel(block: Item): string {
  return `Section ${block.properties.SECTION_NUMBER} · Block ${block.properties.BLOCK_NUMBER}`
}

function renderDetails(container: HTMLElement, numbers: readonly string[], current: () => boolean) {
  const request = loadApplicationDetails()
  container.innerHTML = applicationDetailsContent(numbers, !!request)
  if (request) void request.then(() => {
    if (container.isConnected && current()) container.innerHTML = applicationDetailsContent(numbers, false)
  })
}

export function applicationInspector(area: HTMLElement) {
  let blocks: ApplicationBlocks = new Map()
  let parcelByKey = new Map<string, Item>()
  let shown: string | undefined
  let pinned = false
  const card = document.createElement('section')
  card.className = 'daInspector'
  card.hidden = true
  card.setAttribute('aria-labelledby', 'daInspectorTitle')
  card.innerHTML = '<div class="daInspectorHeading"><div><h3 id="daInspectorTitle">Development applications</h3>' +
    '<p class="daParcelLabel"></p></div><button type="button" class="daClose" aria-label="Close application details">×</button></div>' +
    '<div class="daInspectorBody"></div><button type="button" class="daKeep">Keep details open</button>'
  area.append(card)

  const label = card.querySelector<HTMLElement>('.daParcelLabel')!
  const content = card.querySelector<HTMLElement>('.daInspectorBody')!
  const keep = card.querySelector<HTMLButtonElement>('.daKeep')!
  const dismiss = card.querySelector<HTMLButtonElement>('.daClose')!

  function close(restoreFocus = false) {
    if (restoreFocus && card.contains(document.activeElement)) area.querySelector<HTMLElement>('.maplibregl-canvas')?.focus({preventScroll: true})
    shown = undefined
    pinned = false
    card.hidden = true
  }

  function show(key: string, pin: boolean) {
    const numbers = blocks.get(key)
    const parcel = parcelByKey.get(key)
    if (!numbers?.length || !parcel || (pinned && !pin)) return
    const changed = shown !== key
    shown = key
    pinned = pin
    keep.hidden = pin
    card.hidden = false
    if (changed) {
      label.textContent = blockLabel(parcel)
      card.scrollTop = 0
      renderDetails(content, numbers, () => shown === key)
    }
  }

  keep.onclick = () => {
    if (shown) show(shown, true)
    dismiss.focus({preventScroll: true})
  }
  dismiss.onclick = () => close(true)
  area.addEventListener('pointerleave', () => { if (!pinned && !card.contains(document.activeElement)) close() })
  card.addEventListener('focusin', () => {
    if (shown) pinned = true
  })
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !card.hidden && !event.defaultPrevented) close(true)
  })

  return {
    show,
    close,
    setBlocks(matches: ApplicationBlocks, parcels: readonly Item[], list: HTMLElement | null) {
      blocks = matches
      parcelByKey = new Map(parcels.filter(parcel => matches.has(String(parcel.properties.BLOCK_KEY)))
        .map(parcel => [String(parcel.properties.BLOCK_KEY), parcel]))
      if (shown && !parcelByKey.has(shown)) close()
      if (!list || !parcelByKey.size) return

      const picker = document.createElement('details')
      picker.className = 'daBlockPicker'
      picker.innerHTML = `<summary>Highlighted blocks (${parcelByKey.size})</summary>` +
        '<label class="field">Choose a highlighted block<select></select></label><div class="daPickerResults" aria-live="polite"></div>'
      const select = picker.querySelector('select')!
      const result = picker.querySelector<HTMLElement>('.daPickerResults')!
      const order = new Intl.Collator('en-AU', {numeric: true})
      const choices = [...parcelByKey].map(([key, parcel]) => new Option(blockLabel(parcel), key))
      choices.sort((a, b) => order.compare(a.text, b.text))
      select.append(new Option('Choose a block', ''), ...choices)
      select.onchange = () => {
        const key = select.value
        const numbers = matches.get(key)
        if (numbers) renderDetails(result, numbers, () => select.value === key)
        else result.replaceChildren()
      }
      list.append(picker)
    },
  }
}
