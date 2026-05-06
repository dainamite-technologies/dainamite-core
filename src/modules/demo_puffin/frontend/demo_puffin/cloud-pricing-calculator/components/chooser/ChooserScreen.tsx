'use client'

import * as React from 'react'

type Props = {
  onChoose: (flow: 'solutions' | 'custom') => void
}

export function ChooserScreen({ onChoose }: Props) {
  return (
    <section className="mx-auto max-w-5xl px-4 sm:px-6 py-12">
      <div className="text-center space-y-3 mb-10">
        <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight">
          Build a price for your Puffin Cloud setup
        </h1>
        <p className="text-base text-muted-foreground max-w-2xl mx-auto">
          Pick a use-case bundle to get a curated stack in seconds, or build a custom setup
          from our full catalog. Live pricing updates as you tweak.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <button
          type="button"
          data-testid="chooser-solutions"
          onClick={() => onChoose('solutions')}
          className="group text-left rounded-xl border bg-card hover:border-primary hover:shadow-md transition-all p-6"
        >
          <div className="text-xs uppercase tracking-wider text-primary font-medium mb-2">
            Predefined Solution
          </div>
          <div className="text-xl font-semibold mb-2">Use a curated bundle</div>
          <p className="text-sm text-muted-foreground mb-4">
            Three sized packages per use case (Dev App, eCommerce, Business Office).
            Adjust seats, storage, and term — keep the rest of the bundle as-is.
          </p>
          <div className="text-sm font-medium text-primary group-hover:underline">
            Browse 9 packages →
          </div>
        </button>

        <button
          type="button"
          data-testid="chooser-custom"
          onClick={() => onChoose('custom')}
          className="group text-left rounded-xl border bg-card hover:border-primary hover:shadow-md transition-all p-6"
        >
          <div className="text-xs uppercase tracking-wider text-primary font-medium mb-2">
            Custom Solution
          </div>
          <div className="text-xl font-semibold mb-2">Build from the catalog</div>
          <p className="text-sm text-muted-foreground mb-4">
            VPS, compute, managed databases, CDN, DDoS, workspaces, and more.
            Full control with live pricing on every change.
          </p>
          <div className="text-sm font-medium text-primary group-hover:underline">
            Open the catalog →
          </div>
        </button>
      </div>
    </section>
  )
}
