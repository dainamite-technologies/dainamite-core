// Static reference data for the GIX use case (XD-276). No DB entity —
// surfaced as enum options on a CpqProductAttribute by the seeder.
//
// Migrated verbatim from src/modules/cpq/setup.ts (XD-210).

export const DATA_CENTRE_OPTIONS = [
  { value: 'equinix-ld5', label: 'Equinix LD5' },
  { value: 'equinix-ld8', label: 'Equinix LD8' },
  { value: 'telehouse-ldn-south', label: 'TELEHOUSE London Docklands (South)' },
  { value: 'equinix-fr5', label: 'Equinix FR5' },
  { value: 'digital-realty-fra8', label: 'Digital Realty FRA8' },
  { value: 'equinix-md2', label: 'Equinix MD2' },
  { value: 'digital-realty-mad1', label: 'Digital Realty MAD1' },
  { value: 'equinix-am1', label: 'Equinix AM1' },
  { value: 'digital-realty-ams11', label: 'Digital Realty AMS11' },
  { value: 'equinix-dc3', label: 'Equinix DC3' },
  { value: 'equinix-dc11', label: 'Equinix DC11' },
  { value: 'equinix-dx1', label: 'Equinix DX1' },
  { value: 'datamena-al-salam', label: 'Datamena Al Salam Tower Datacenter' },
  { value: 'equinix-sg1', label: 'Equinix SG1' },
  { value: 'digital-realty-sin10', label: 'Digital Realty SIN10' },
] as const

export const PRODUCTS = [
  {
    sku: 'GIX-ACCESS-PORT',
    title: 'GIX Access Port',
    description: 'Physical port at a data centre for network interconnection',
  },
  {
    sku: 'GIX-INTERNET-PEERING',
    title: 'GIX Internet Peering',
    description: 'Virtual peering service for internet traffic exchange',
  },
  {
    sku: 'GIX-MOBILE-PEERING',
    title: 'GIX Mobile Peering',
    description: 'Virtual peering service for mobile roaming traffic',
  },
  {
    sku: 'GIX-CLOUD-CONNECT',
    title: 'GIX Cloud Connect',
    description: 'Direct cloud connectivity service to major providers',
  },
  {
    sku: 'GIX-CONNECTIVITY-BUNDLE',
    title: 'GIX Connectivity Bundle',
    description: 'All-in-one connectivity package: Access Port + peering/cloud services',
  },
] as const
