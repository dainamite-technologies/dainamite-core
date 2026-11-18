import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { I18nProvider } from '@open-mercato/shared/lib/i18n/context'
import { ArcLineDiff } from '../ArcLineDiff'

const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
const render = (node: React.ReactNode) => renderToStaticMarkup(<I18nProvider locale="en" dict={{}}>{node}</I18nProvider>)

const line = { action: 'modify', quantity: 1, nrcTotal: 0, mrcTotal: 400, arcSource: { mrcAmount: 500, nrcAmount: 0, quantity: 1 } }
const costs = { before: { mrcCost: 270, nrcCost: 10 }, after: { mrcCost: 240, nrcCost: 10 } }

describe('ArcLineDiff cost rows', () => {
  it('hides the cost and margin rows without the costs prop', () => {
    const html = render(<ArcLineDiff line={line} currency="EUR" />)
    expect(html).toContain('cpq-arc-line-diff')
    expect(text(html)).not.toContain('MRC cost')
    expect(text(html)).not.toContain('MRC margin')
    expect(text(html)).not.toContain('NRC cost')
  })

  it('hides them for a null costs prop too', () => {
    expect(text(render(<ArcLineDiff line={line} currency="EUR" costs={null} />))).not.toContain('MRC cost')
  })

  it('renders MRC cost, MRC margin and NRC cost with before, after and delta when costs are present', () => {
    const html = render(<ArcLineDiff line={line} currency="EUR" costs={costs} />)
    const content = text(html)
    expect(content).toContain('MRC cost')
    expect(content).toContain('MRC margin')
    expect(content).toContain('NRC cost')
    // Cost 270 -> 240; margin (500 - 270) = 230 -> (400 - 240) = 160.
    expect(html).toMatch(/cpq-arc-diff-mrcCost[\s\S]*?€270\.00[\s\S]*?€240\.00[\s\S]*?-€30\.00/)
    expect(html).toMatch(/cpq-arc-diff-mrcMargin[\s\S]*?€230\.00[\s\S]*?€160\.00[\s\S]*?-€70\.00/)
  })

  it('shows zero cost and zero margin after a cancel line', () => {
    const html = render(<ArcLineDiff line={{ ...line, action: 'cancel' }} currency="EUR" costs={{ before: costs.before, after: { mrcCost: 0, nrcCost: 0 } }} />)
    expect(html).toMatch(/cpq-arc-diff-mrcMargin[\s\S]*?€230\.00[\s\S]*?€0\.00/)
  })

  it('renders nothing without an arcSource, with or without costs', () => {
    expect(render(<ArcLineDiff line={{ ...line, arcSource: null }} currency="EUR" costs={costs} />)).toBe('')
  })
})
