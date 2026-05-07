import type { EntityManager } from '@mikro-orm/postgresql'
import type { SeedScope } from './_types'

type BundleSlotDef = {
  key: string
  name: string
  componentGroup: string
  /** Spec code of the slot's target product. Resolved to spec.id at seed time. */
  targetSpecCode: string
  min: number
  max: number
  sort: number
}

type BundleDef = {
  bundleSpecCode: string
  slots: BundleSlotDef[]
  /**
   * For each (slotKey → offering code) pair, ensure a CpqOfferingComponent
   * exists between the bundle's package offerings and the child offering.
   * This is the static side of "what packages can fill this slot".
   */
  defaultComponents: Array<{ slotKey: string; childOfferingCode: string; isDefault: boolean }>
}

const BUNDLE_DEV_APP: BundleDef = {
  bundleSpecCode: 'SPEC-PUFFIN-BUNDLE-DEV-APP',
  slots: [
    { key: 'app_host', name: 'App Host', componentGroup: 'compute', targetSpecCode: 'SPEC-PUFFIN-VPS', min: 1, max: 1, sort: 0 },
    { key: 'database', name: 'Database', componentGroup: 'database', targetSpecCode: 'SPEC-PUFFIN-MANAGED-DB', min: 1, max: 1, sort: 1 },
    { key: 'static_assets', name: 'Static Assets', componentGroup: 'storage', targetSpecCode: 'SPEC-PUFFIN-OBJECT-STORAGE', min: 1, max: 1, sort: 2 },
    { key: 'cdn', name: 'CDN', componentGroup: 'edge', targetSpecCode: 'SPEC-PUFFIN-CDN', min: 0, max: 1, sort: 3 },
    { key: 'support', name: 'Support', componentGroup: 'support', targetSpecCode: 'SPEC-PUFFIN-SUPPORT', min: 1, max: 1, sort: 4 },
  ],
  // VPS plans differ between packages — encoded in offering designTimeValues, not as static components.
  // We still seed sane defaults so the calculator preview has something to render.
  defaultComponents: [
    { slotKey: 'app_host', childOfferingCode: 'vps_small', isDefault: true },
    { slotKey: 'database', childOfferingCode: 'OFFER-PUFFIN-MANAGED-DB', isDefault: true },
    { slotKey: 'static_assets', childOfferingCode: 'OFFER-PUFFIN-OBJECT-STORAGE', isDefault: true },
    { slotKey: 'cdn', childOfferingCode: 'OFFER-PUFFIN-CDN', isDefault: false },
    { slotKey: 'support', childOfferingCode: 'support_developer', isDefault: true },
  ],
}

const BUNDLE_ECOMMERCE: BundleDef = {
  bundleSpecCode: 'SPEC-PUFFIN-BUNDLE-ECOMMERCE',
  slots: [
    { key: 'storefront_host', name: 'Storefront Host', componentGroup: 'compute', targetSpecCode: 'SPEC-PUFFIN-VPS', min: 1, max: 2, sort: 0 },
    { key: 'database', name: 'Database', componentGroup: 'database', targetSpecCode: 'SPEC-PUFFIN-MANAGED-DB', min: 1, max: 1, sort: 1 },
    { key: 'cache', name: 'Cache', componentGroup: 'database', targetSpecCode: 'SPEC-PUFFIN-MANAGED-DB', min: 0, max: 1, sort: 2 },
    { key: 'media', name: 'Media', componentGroup: 'storage', targetSpecCode: 'SPEC-PUFFIN-OBJECT-STORAGE', min: 1, max: 1, sort: 3 },
    { key: 'cdn', name: 'CDN', componentGroup: 'edge', targetSpecCode: 'SPEC-PUFFIN-CDN', min: 1, max: 1, sort: 4 },
    { key: 'ddos', name: 'DDoS Shield', componentGroup: 'security', targetSpecCode: 'SPEC-PUFFIN-DDOS', min: 1, max: 1, sort: 5 },
    { key: 'bandwidth', name: 'Bandwidth', componentGroup: 'network', targetSpecCode: 'SPEC-PUFFIN-BANDWIDTH', min: 1, max: 1, sort: 6 },
    { key: 'support', name: 'Support', componentGroup: 'support', targetSpecCode: 'SPEC-PUFFIN-SUPPORT', min: 1, max: 1, sort: 7 },
  ],
  defaultComponents: [
    { slotKey: 'storefront_host', childOfferingCode: 'vps_small', isDefault: true },
    { slotKey: 'database', childOfferingCode: 'OFFER-PUFFIN-MANAGED-DB', isDefault: true },
    { slotKey: 'media', childOfferingCode: 'OFFER-PUFFIN-OBJECT-STORAGE', isDefault: true },
    { slotKey: 'cdn', childOfferingCode: 'OFFER-PUFFIN-CDN', isDefault: true },
    { slotKey: 'ddos', childOfferingCode: 'OFFER-PUFFIN-DDOS-STD', isDefault: true },
    { slotKey: 'bandwidth', childOfferingCode: 'OFFER-PUFFIN-BANDWIDTH', isDefault: true },
    { slotKey: 'support', childOfferingCode: 'support_developer', isDefault: true },
  ],
}

const BUNDLE_BUSINESS: BundleDef = {
  bundleSpecCode: 'SPEC-PUFFIN-BUNDLE-BUSINESS-OFFICE',
  slots: [
    { key: 'public_website', name: 'Public Website', componentGroup: 'compute', targetSpecCode: 'SPEC-PUFFIN-VPS', min: 1, max: 1, sort: 0 },
    { key: 'apps_host', name: 'Apps Host', componentGroup: 'compute', targetSpecCode: 'SPEC-PUFFIN-VPS', min: 0, max: 2, sort: 1 },
    { key: 'shared_database', name: 'Shared Database', componentGroup: 'database', targetSpecCode: 'SPEC-PUFFIN-MANAGED-DB', min: 1, max: 1, sort: 2 },
    { key: 'file_storage', name: 'File Storage', componentGroup: 'storage', targetSpecCode: 'SPEC-PUFFIN-OBJECT-STORAGE', min: 1, max: 1, sort: 3 },
    { key: 'ddos', name: 'DDoS Shield', componentGroup: 'security', targetSpecCode: 'SPEC-PUFFIN-DDOS', min: 1, max: 1, sort: 4 },
    { key: 'workspace_seats', name: 'Workspace Seats', componentGroup: 'workspace', targetSpecCode: 'SPEC-PUFFIN-WORKSPACE', min: 1, max: 1, sort: 5 },
    { key: 'workspace_archive', name: 'Workspace Archive Add-on', componentGroup: 'workspace', targetSpecCode: 'SPEC-PUFFIN-WORKSPACE', min: 0, max: 1, sort: 6 },
    { key: 'support', name: 'Support', componentGroup: 'support', targetSpecCode: 'SPEC-PUFFIN-SUPPORT', min: 1, max: 1, sort: 7 },
  ],
  defaultComponents: [
    { slotKey: 'public_website', childOfferingCode: 'vps_small', isDefault: true },
    { slotKey: 'apps_host', childOfferingCode: 'vps_medium', isDefault: false },
    { slotKey: 'shared_database', childOfferingCode: 'OFFER-PUFFIN-MANAGED-DB', isDefault: true },
    { slotKey: 'file_storage', childOfferingCode: 'OFFER-PUFFIN-OBJECT-STORAGE', isDefault: true },
    { slotKey: 'ddos', childOfferingCode: 'OFFER-PUFFIN-DDOS-STD', isDefault: true },
    { slotKey: 'workspace_seats', childOfferingCode: 'workspace_essentials', isDefault: true },
    { slotKey: 'workspace_archive', childOfferingCode: 'ws_email_archive', isDefault: false },
    { slotKey: 'support', childOfferingCode: 'support_developer', isDefault: true },
  ],
}

const BUNDLES: BundleDef[] = [BUNDLE_DEV_APP, BUNDLE_ECOMMERCE, BUNDLE_BUSINESS]

export async function seedPuffinBundles(em: EntityManager, scope: SeedScope): Promise<void> {
  const { CpqProductSpecification, CpqProductOffering, CpqBundleSlot, CpqOfferingComponent } = await import(
    '../../../cpq/data/entities'
  )

  for (const bundle of BUNDLES) {
    const bundleSpec = await em.findOne(CpqProductSpecification, { ...scope, code: bundle.bundleSpecCode })
    if (!bundleSpec) {
      console.warn(`[demo_puffin] bundle spec "${bundle.bundleSpecCode}" not found — skipping`)
      continue
    }

    // Ensure slots.
    const slotByKey = new Map<string, InstanceType<typeof CpqBundleSlot>>()
    for (const slotDef of bundle.slots) {
      const targetSpec = await em.findOne(CpqProductSpecification, { ...scope, code: slotDef.targetSpecCode })
      if (!targetSpec) {
        console.warn(`[demo_puffin] target spec "${slotDef.targetSpecCode}" not found for slot "${slotDef.key}" — skipping`)
        continue
      }
      // Include `name` in the lookup. (specId, targetSpecId, componentGroup)
      // alone collides whenever a bundle has two slots that share both target
      // spec and component group — ecommerce has `database` + `cache` (both
      // managed-db, group 'database'); business has `public_website` +
      // `apps_host` (both vps, group 'compute') and `workspace_seats` +
      // `workspace_archive` (both workspace, group 'workspace'). Without
      // disambiguating by name, the second slot upsert resolves to the first
      // slot and the second slot is never created — the calculator sees one
      // bundle slot where the data model intends two.
      let slot = await em.findOne(CpqBundleSlot, {
        ...scope,
        specId: bundleSpec.id,
        targetSpecId: targetSpec.id,
        componentGroup: slotDef.componentGroup,
        name: slotDef.name,
      })
      if (!slot) {
        slot = em.create(CpqBundleSlot, {
          ...scope,
          specId: bundleSpec.id,
          targetSpecId: targetSpec.id,
          componentGroup: slotDef.componentGroup,
          name: slotDef.name,
          cardinalityMin: slotDef.min,
          cardinalityMax: slotDef.max,
          sortOrder: slotDef.sort,
        })
        em.persist(slot)
      }
      slotByKey.set(slotDef.key, slot)
    }
    await em.flush()

    // For each package offering on the bundle, ensure components exist.
    const bundleOfferings = await em.find(CpqProductOffering, { ...scope, specId: bundleSpec.id, deletedAt: null })
    for (const bundleOffering of bundleOfferings) {
      let sortOffset = 0
      for (const comp of bundle.defaultComponents) {
        const slot = slotByKey.get(comp.slotKey)
        if (!slot) continue
        const child = await em.findOne(CpqProductOffering, { ...scope, code: comp.childOfferingCode, deletedAt: null })
        if (!child) {
          console.warn(`[demo_puffin] child offering "${comp.childOfferingCode}" missing for slot "${comp.slotKey}" — skipping`)
          continue
        }
        const exists = await em.findOne(CpqOfferingComponent, {
          ...scope,
          offeringId: bundleOffering.id,
          slotId: slot.id,
          childOfferingId: child.id,
        })
        if (!exists) {
          em.persist(
            em.create(CpqOfferingComponent, {
              ...scope,
              offeringId: bundleOffering.id,
              slotId: slot.id,
              childOfferingId: child.id,
              isDefault: comp.isDefault,
              sortOrder: sortOffset++,
            }),
          )
        }
      }
    }
    await em.flush()
  }
}
