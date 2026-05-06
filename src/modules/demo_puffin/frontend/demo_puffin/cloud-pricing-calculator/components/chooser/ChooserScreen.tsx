'use client'

import * as React from 'react'
import { ArrowRight, Sparkles, Wrench } from 'lucide-react'

type Props = {
  onChoose: (flow: 'solutions' | 'custom') => void
}

export function ChooserScreen({ onChoose }: Props) {
  return (
    <main className="pf-landing">
      <div className="pf-landing-inner">
        <div className="pf-eyebrow">Pricing</div>
        <h1 className="pf-h1">
          Build a price for your<br />
          <em>Puffin Cloud</em> setup.
        </h1>
        <p className="pf-lede">
          Pick a use-case bundle to get a curated stack in seconds, or build a custom setup
          from our full catalog. Live pricing updates as you tweak — no sign-up.
        </p>

        <div className="pf-chooser">
          <button
            type="button"
            data-testid="chooser-solutions"
            className="pf-choice"
            onClick={() => onChoose('solutions')}
          >
            <div className="pf-choice-mark">
              <Sparkles size={18} aria-hidden />
            </div>
            <div className="pf-choice-eyebrow">Predefined Solution</div>
            <div className="pf-choice-title">Use a curated bundle</div>
            <div className="pf-choice-body">
              Three sized packages per use case (Dev App, eCommerce, Business Office).
              Adjust seats, storage, and term — keep the rest of the bundle as-is.
            </div>
            <div className="pf-choice-cta">
              Browse packages <ArrowRight size={14} aria-hidden />
            </div>
            <span className="pf-choice-deco" aria-hidden>
              <span className="pf-deco-dot" />
              <span className="pf-deco-dot" />
              <span className="pf-deco-dot" />
            </span>
          </button>

          <button
            type="button"
            data-testid="chooser-custom"
            className="pf-choice pf-choice--alt"
            onClick={() => onChoose('custom')}
          >
            <div className="pf-choice-mark">
              <Wrench size={18} aria-hidden />
            </div>
            <div className="pf-choice-eyebrow">Custom Solution</div>
            <div className="pf-choice-title">Build from the catalog</div>
            <div className="pf-choice-body">
              VPS, compute, managed databases, CDN, DDoS, workspaces, and more.
              Full control with live pricing on every change.
            </div>
            <div className="pf-choice-cta">
              Open the catalog <ArrowRight size={14} aria-hidden />
            </div>
            <span className="pf-choice-deco pf-choice-deco--grid" aria-hidden>
              {Array.from({ length: 9 }).map((_, i) => (
                <span key={i} className="pf-deco-cell" />
              ))}
            </span>
          </button>
        </div>

        <p className="pf-landing-hint">
          Not sure? Start with a solution — you can customise everything afterwards.
        </p>
      </div>
    </main>
  )
}
