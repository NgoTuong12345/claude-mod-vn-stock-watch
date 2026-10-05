import { describe, expect, test } from 'claude-code/testing'

const PANE = {
  component: 'Pane', requestId: 'vn-heatmap',
  props: { title: 'VN heatmap', isFocused: true, bodyColumns: 100, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} },
} as any

describe('watchlist strip', () => {
  test('search input takes letters that are also pane hotkeys', async $ => {
    const ui = await $.ui.mount({ plugin: 'vn-stockmarket-heatmap', surface: 'terminal', ...PANE })
    expect(await ui.find({ key: 'ticker' })).toBeDefined()
    expect(await ui.find({ key: 'tab-port' })).toBeDefined()
    await ui.input({ key: 'ticker', text: 'e' })
    expect((await ui.find({ key: 'by-exchange' }))?.props?.variant).toBeUndefined() // 'e' did not switch view
    await ui.press({ key: 'by-exchange' }) // positive control: props.variant is observable
    expect((await ui.find({ key: 'by-exchange' }))?.props?.variant).toBe('primary')
    await ui.press({ key: 'tab-port' })
    expect(await ui.find({ type: 'Text', text: /P&L/ })).toBeDefined()
    await ui.unmount()
  })
})
