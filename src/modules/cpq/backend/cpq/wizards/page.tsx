"use client"
import * as React from 'react'
import { useRouter } from 'next/navigation'

type WizardDefinition = {
  id: string
  code: string
  name: string
  description: string | null
  version: number
  surface: string
  isActive: boolean
  steps: Array<{ stepId: string; type: string; title: string }>
  createdAt: string
}

async function apiJson<T>(url: string): Promise<T> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`API error ${res.status}`)
  return res.json() as Promise<T>
}

export default function CpqWizardsPage() {
  const router = useRouter()
  const [definitions, setDefinitions] = React.useState<WizardDefinition[]>([])
  const [loading, setLoading] = React.useState(true)

  React.useEffect(() => {
    async function load() {
      setLoading(true)
      try {
        const defData = await apiJson<{ items: WizardDefinition[] }>('/api/cpq/wizards?pageSize=100')
        setDefinitions(defData.items ?? [])
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  const handleStartWizard = React.useCallback((definitionCode: string) => {
    router.push(`/backend/cpq/wizards/${definitionCode}`)
  }, [router])

  if (loading) {
    return <div className="text-sm text-muted-foreground">Loading...</div>
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Wizards</h1>
      </div>

      {definitions.length === 0 ? (
        <div className="rounded-lg border bg-card p-6 text-center text-sm text-muted-foreground">
          No wizard definitions yet. Create one via the API.
        </div>
      ) : (
        <div className="rounded-lg border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="px-4 py-3 text-left font-medium">Name</th>
                <th className="px-4 py-3 text-left font-medium">Code</th>
                <th className="px-4 py-3 text-left font-medium">Surface</th>
                <th className="px-4 py-3 text-left font-medium">Steps</th>
                <th className="px-4 py-3 text-left font-medium">Version</th>
                <th className="px-4 py-3 text-left font-medium">Active</th>
                <th className="px-4 py-3 text-right font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {definitions.map((def) => (
                <tr key={def.id} className="border-b hover:bg-muted/30 transition-colors">
                  <td className="px-4 py-3 font-medium">{def.name}</td>
                  <td className="px-4 py-3 font-mono text-xs">{def.code}</td>
                  <td className="px-4 py-3">{def.surface}</td>
                  <td className="px-4 py-3">{def.steps.length}</td>
                  <td className="px-4 py-3">v{def.version}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${def.isActive ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-700'}`}>
                      {def.isActive ? 'Yes' : 'No'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => router.push(`/backend/cpq/wizards/${def.code}/detail`)}
                        className="inline-flex items-center justify-center rounded-md border px-3 py-1.5 text-xs font-medium hover:bg-muted"
                      >
                        View
                      </button>
                      <button
                        type="button"
                        onClick={() => handleStartWizard(def.code)}
                        disabled={!def.isActive}
                        className="inline-flex items-center justify-center rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        Start
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
