'use client'

import * as React from 'react'

type Props = {
  message?: string
  missing?: string[]
}

export function OpsBanner({ message, missing }: Props) {
  return (
    <main className="min-h-screen flex items-center justify-center px-4">
      <div className="max-w-md text-center space-y-3">
        <div className="text-2xl">⚠</div>
        <h1 className="text-xl font-semibold">Calculator unavailable</h1>
        <p className="text-sm text-muted-foreground">
          {message ?? 'The Puffin pricing calculator is temporarily unavailable. Please check back soon.'}
        </p>
        {missing && missing.length > 0 && (
          <details className="text-xs text-muted-foreground text-left rounded-md border p-3">
            <summary className="cursor-pointer font-medium">Operator details</summary>
            <p className="mt-2">
              The following environment variables are missing or invalid in this deployment:
            </p>
            <ul className="mt-1 list-disc list-inside font-mono text-[11px]">
              {missing.map((m) => (
                <li key={m}>{m}</li>
              ))}
            </ul>
          </details>
        )}
      </div>
    </main>
  )
}
