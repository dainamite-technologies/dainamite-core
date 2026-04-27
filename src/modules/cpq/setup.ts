import type { EntityManager } from '@mikro-orm/postgresql'
import type { ModuleSetupConfig } from '@open-mercato/shared/modules/setup'
import { seedCpqDefaults } from './lib/seeds'
import { seedCpqExamples } from './lib/example-seeds'

type SeedScope = { tenantId: string; organizationId: string }

// --- Data Centre options (static, no DB entity after XD-213 cleanup) ------

const DATA_CENTRE_OPTIONS = [
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
]

// --- Product definitions --------------------------------------------------

const PRODUCTS = [
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

// --- Access Port pricing (DC x port size) ---------------------------------

const ACCESS_PORT_PRICES: Record<string, Record<string, { nrc: number; mrc: number }>> = {
  'equinix-ld5': { '1G': { nrc: 290, mrc: 250 }, '10G': { nrc: 490, mrc: 450 }, '100G': { nrc: 890, mrc: 1200 } },
  'equinix-ld8': { '1G': { nrc: 290, mrc: 265 }, '10G': { nrc: 490, mrc: 475 }, '100G': { nrc: 890, mrc: 1250 } },
  'telehouse-ldn-south': {
    '1G': { nrc: 290, mrc: 245 },
    '10G': { nrc: 490, mrc: 460 },
    '100G': { nrc: 890, mrc: 1180 },
  },
  'equinix-fr5': { '1G': { nrc: 290, mrc: 220 }, '10G': { nrc: 490, mrc: 410 }, '100G': { nrc: 890, mrc: 1100 } },
  'digital-realty-fra8': {
    '1G': { nrc: 290, mrc: 215 },
    '10G': { nrc: 490, mrc: 400 },
    '100G': { nrc: 890, mrc: 1080 },
  },
  'equinix-md2': { '1G': { nrc: 290, mrc: 200 }, '10G': { nrc: 490, mrc: 380 }, '100G': { nrc: 890, mrc: 1050 } },
  'digital-realty-mad1': {
    '1G': { nrc: 290, mrc: 195 },
    '10G': { nrc: 490, mrc: 370 },
    '100G': { nrc: 890, mrc: 1030 },
  },
  'equinix-am1': { '1G': { nrc: 290, mrc: 230 }, '10G': { nrc: 490, mrc: 425 }, '100G': { nrc: 890, mrc: 1150 } },
  'digital-realty-ams11': {
    '1G': { nrc: 290, mrc: 225 },
    '10G': { nrc: 490, mrc: 415 },
    '100G': { nrc: 890, mrc: 1130 },
  },
  'equinix-dc3': { '1G': { nrc: 290, mrc: 210 }, '10G': { nrc: 490, mrc: 395 }, '100G': { nrc: 890, mrc: 1090 } },
  'equinix-dc11': { '1G': { nrc: 290, mrc: 205 }, '10G': { nrc: 490, mrc: 385 }, '100G': { nrc: 890, mrc: 1070 } },
  'equinix-dx1': { '1G': { nrc: 290, mrc: 280 }, '10G': { nrc: 490, mrc: 510 }, '100G': { nrc: 890, mrc: 1350 } },
  'datamena-al-salam': {
    '1G': { nrc: 290, mrc: 275 },
    '10G': { nrc: 490, mrc: 500 },
    '100G': { nrc: 890, mrc: 1320 },
  },
  'equinix-sg1': { '1G': { nrc: 290, mrc: 290 }, '10G': { nrc: 490, mrc: 520 }, '100G': { nrc: 890, mrc: 1380 } },
  'digital-realty-sin10': {
    '1G': { nrc: 290, mrc: 285 },
    '10G': { nrc: 490, mrc: 515 },
    '100G': { nrc: 890, mrc: 1360 },
  },
}

// --- Tiered bandwidth pricing ---------------------------------------------

const INTERNET_PEERING_TIERS = [
  { tier: 0, from: 0, to: 50, per_mb: 0.52 },
  { tier: 1, from: 51, to: 100, per_mb: 0.49 },
  { tier: 2, from: 101, to: 250, per_mb: 0.47 },
  { tier: 3, from: 251, to: 500, per_mb: 0.45 },
  { tier: 4, from: 501, to: 1000, per_mb: 0.43 },
  { tier: 5, from: 1001, to: null, per_mb: 0.4 },
]

const MOBILE_PEERING_TIERS = [
  { tier: 0, from: 0, to: 50, per_mb: 1.23 },
  { tier: 1, from: 51, to: 100, per_mb: 1.11 },
  { tier: 2, from: 101, to: 250, per_mb: 1.0 },
  { tier: 3, from: 251, to: 500, per_mb: 0.85 },
  { tier: 4, from: 501, to: 1000, per_mb: 0.74 },
  { tier: 5, from: 1001, to: null, per_mb: 0.63 },
]

// --- Cloud Connect pricing (location x provider x region) -----------------

type CloudRow = [string, string, string, number, number, number]

const CLOUD_CONNECT_ENTRIES: CloudRow[] = [
  // London
  ['London', 'AWS', 'eu-west-2', 0.52, 0.46, 0.69],
  ['London', 'AWS', 'eu-west-1', 0.53, 0.47, 0.7],
  ['London', 'AWS', 'eu-central-1', 0.54, 0.48, 0.71],
  ['London', 'AWS', 'eu-south-2', 0.55, 0.48, 0.73],
  ['London', 'AWS', 'us-east-1', 0.68, 0.6, 0.9],
  ['London', 'AWS', 'us-west-2', 0.72, 0.63, 0.95],
  ['London', 'AWS', 'me-central-1', 0.78, 0.69, 1.03],
  ['London', 'AWS', 'ap-southeast-1', 0.82, 0.72, 1.08],
  ['London', 'AWS', 'ap-south-1', 0.8, 0.7, 1.06],
  ['London', 'AWS', 'ap-northeast-1', 0.84, 0.74, 1.11],
  ['London', 'GCP', 'europe-west2', 0.54, 0.48, 0.71],
  ['London', 'GCP', 'europe-west1', 0.55, 0.48, 0.73],
  ['London', 'GCP', 'europe-west3', 0.56, 0.49, 0.74],
  ['London', 'GCP', 'europe-west4', 0.57, 0.5, 0.75],
  ['London', 'GCP', 'us-east1', 0.7, 0.62, 0.92],
  ['London', 'GCP', 'us-east4', 0.71, 0.62, 0.94],
  ['London', 'GCP', 'us-west1', 0.74, 0.65, 0.98],
  ['London', 'GCP', 'me-west1', 0.81, 0.71, 1.07],
  ['London', 'GCP', 'asia-southeast1', 0.85, 0.75, 1.12],
  ['London', 'GCP', 'asia-south1', 0.83, 0.73, 1.1],
  ['London', 'MS Azure', 'UK South', 0.53, 0.47, 0.7],
  ['London', 'MS Azure', 'West Europe', 0.54, 0.48, 0.71],
  ['London', 'MS Azure', 'Germany West Central', 0.55, 0.48, 0.73],
  ['London', 'MS Azure', 'Spain Central', 0.56, 0.49, 0.74],
  ['London', 'MS Azure', 'East US', 0.69, 0.61, 0.91],
  ['London', 'MS Azure', 'West US', 0.73, 0.64, 0.96],
  ['London', 'MS Azure', 'UAE North', 0.79, 0.7, 1.04],
  ['London', 'MS Azure', 'Southeast Asia', 0.83, 0.73, 1.1],
  ['London', 'MS Azure', 'Central India', 0.81, 0.71, 1.07],
  // Frankfurt
  ['Frankfurt', 'AWS', 'eu-central-1', 0.48, 0.42, 0.63],
  ['Frankfurt', 'AWS', 'eu-west-1', 0.5, 0.44, 0.66],
  ['Frankfurt', 'AWS', 'eu-west-2', 0.51, 0.45, 0.67],
  ['Frankfurt', 'AWS', 'eu-south-2', 0.52, 0.46, 0.69],
  ['Frankfurt', 'AWS', 'us-east-1', 0.64, 0.56, 0.84],
  ['Frankfurt', 'AWS', 'us-west-2', 0.68, 0.6, 0.9],
  ['Frankfurt', 'AWS', 'me-central-1', 0.74, 0.65, 0.98],
  ['Frankfurt', 'AWS', 'ap-southeast-1', 0.78, 0.69, 1.03],
  ['Frankfurt', 'AWS', 'ap-south-1', 0.76, 0.67, 1.0],
  ['Frankfurt', 'AWS', 'ap-northeast-1', 0.8, 0.7, 1.06],
  ['Frankfurt', 'GCP', 'europe-west3', 0.5, 0.44, 0.66],
  ['Frankfurt', 'GCP', 'europe-west1', 0.52, 0.46, 0.69],
  ['Frankfurt', 'GCP', 'europe-west2', 0.53, 0.47, 0.7],
  ['Frankfurt', 'GCP', 'europe-west4', 0.54, 0.48, 0.71],
  ['Frankfurt', 'GCP', 'us-east1', 0.66, 0.58, 0.87],
  ['Frankfurt', 'GCP', 'us-east4', 0.67, 0.59, 0.88],
  ['Frankfurt', 'GCP', 'us-west1', 0.7, 0.62, 0.92],
  ['Frankfurt', 'GCP', 'me-west1', 0.77, 0.68, 1.02],
  ['Frankfurt', 'GCP', 'asia-southeast1', 0.81, 0.71, 1.07],
  ['Frankfurt', 'GCP', 'asia-south1', 0.79, 0.7, 1.04],
  ['Frankfurt', 'MS Azure', 'Germany West Central', 0.49, 0.43, 0.65],
  ['Frankfurt', 'MS Azure', 'West Europe', 0.51, 0.45, 0.67],
  ['Frankfurt', 'MS Azure', 'UK South', 0.52, 0.46, 0.69],
  ['Frankfurt', 'MS Azure', 'Spain Central', 0.53, 0.47, 0.7],
  ['Frankfurt', 'MS Azure', 'East US', 0.65, 0.57, 0.86],
  ['Frankfurt', 'MS Azure', 'West US', 0.69, 0.61, 0.91],
  ['Frankfurt', 'MS Azure', 'UAE North', 0.75, 0.66, 0.99],
  ['Frankfurt', 'MS Azure', 'Southeast Asia', 0.79, 0.7, 1.04],
  ['Frankfurt', 'MS Azure', 'Central India', 0.77, 0.68, 1.02],
  // Madrid
  ['Madrid', 'AWS', 'eu-south-2', 0.46, 0.4, 0.61],
  ['Madrid', 'AWS', 'eu-west-1', 0.48, 0.42, 0.63],
  ['Madrid', 'AWS', 'eu-west-2', 0.49, 0.43, 0.65],
  ['Madrid', 'AWS', 'eu-central-1', 0.5, 0.44, 0.66],
  ['Madrid', 'AWS', 'us-east-1', 0.62, 0.55, 0.82],
  ['Madrid', 'AWS', 'us-west-2', 0.66, 0.58, 0.87],
  ['Madrid', 'AWS', 'me-central-1', 0.72, 0.63, 0.95],
  ['Madrid', 'AWS', 'ap-southeast-1', 0.76, 0.67, 1.0],
  ['Madrid', 'AWS', 'ap-south-1', 0.74, 0.65, 0.98],
  ['Madrid', 'AWS', 'ap-northeast-1', 0.78, 0.69, 1.03],
  ['Madrid', 'GCP', 'europe-southwest1', 0.47, 0.41, 0.62],
  ['Madrid', 'GCP', 'europe-west1', 0.49, 0.43, 0.65],
  ['Madrid', 'GCP', 'europe-west2', 0.5, 0.44, 0.66],
  ['Madrid', 'GCP', 'europe-west3', 0.51, 0.45, 0.67],
  ['Madrid', 'GCP', 'us-east1', 0.64, 0.56, 0.84],
  ['Madrid', 'GCP', 'us-east4', 0.65, 0.57, 0.86],
  ['Madrid', 'GCP', 'us-west1', 0.68, 0.6, 0.9],
  ['Madrid', 'GCP', 'me-west1', 0.75, 0.66, 0.99],
  ['Madrid', 'GCP', 'asia-southeast1', 0.79, 0.7, 1.04],
  ['Madrid', 'GCP', 'asia-south1', 0.77, 0.68, 1.02],
  ['Madrid', 'MS Azure', 'Spain Central', 0.45, 0.4, 0.59],
  ['Madrid', 'MS Azure', 'West Europe', 0.47, 0.41, 0.62],
  ['Madrid', 'MS Azure', 'UK South', 0.48, 0.42, 0.63],
  ['Madrid', 'MS Azure', 'Germany West Central', 0.49, 0.43, 0.65],
  ['Madrid', 'MS Azure', 'East US', 0.63, 0.55, 0.83],
  ['Madrid', 'MS Azure', 'West US', 0.67, 0.59, 0.88],
  ['Madrid', 'MS Azure', 'UAE North', 0.73, 0.64, 0.96],
  ['Madrid', 'MS Azure', 'Southeast Asia', 0.77, 0.68, 1.02],
  ['Madrid', 'MS Azure', 'Central India', 0.75, 0.66, 0.99],
  // Amsterdam
  ['Amsterdam', 'AWS', 'eu-west-1', 0.51, 0.45, 0.67],
  ['Amsterdam', 'AWS', 'eu-west-2', 0.52, 0.46, 0.69],
  ['Amsterdam', 'AWS', 'eu-central-1', 0.53, 0.47, 0.7],
  ['Amsterdam', 'AWS', 'eu-south-2', 0.54, 0.48, 0.71],
  ['Amsterdam', 'AWS', 'us-east-1', 0.67, 0.59, 0.88],
  ['Amsterdam', 'AWS', 'us-west-2', 0.71, 0.62, 0.94],
  ['Amsterdam', 'AWS', 'me-central-1', 0.77, 0.68, 1.02],
  ['Amsterdam', 'AWS', 'ap-southeast-1', 0.81, 0.71, 1.07],
  ['Amsterdam', 'AWS', 'ap-south-1', 0.79, 0.7, 1.04],
  ['Amsterdam', 'AWS', 'ap-northeast-1', 0.83, 0.73, 1.1],
  ['Amsterdam', 'GCP', 'europe-west4', 0.53, 0.47, 0.7],
  ['Amsterdam', 'GCP', 'europe-west1', 0.54, 0.48, 0.71],
  ['Amsterdam', 'GCP', 'europe-west2', 0.55, 0.48, 0.73],
  ['Amsterdam', 'GCP', 'europe-west3', 0.56, 0.49, 0.74],
  ['Amsterdam', 'GCP', 'us-east1', 0.69, 0.61, 0.91],
  ['Amsterdam', 'GCP', 'us-east4', 0.7, 0.62, 0.92],
  ['Amsterdam', 'GCP', 'us-west1', 0.73, 0.64, 0.96],
  ['Amsterdam', 'GCP', 'me-west1', 0.8, 0.7, 1.06],
  ['Amsterdam', 'GCP', 'asia-southeast1', 0.84, 0.74, 1.11],
  ['Amsterdam', 'GCP', 'asia-south1', 0.82, 0.72, 1.08],
  ['Amsterdam', 'MS Azure', 'West Europe', 0.52, 0.46, 0.69],
  ['Amsterdam', 'MS Azure', 'UK South', 0.53, 0.47, 0.7],
  ['Amsterdam', 'MS Azure', 'Germany West Central', 0.54, 0.48, 0.71],
  ['Amsterdam', 'MS Azure', 'Spain Central', 0.55, 0.48, 0.73],
  ['Amsterdam', 'MS Azure', 'East US', 0.68, 0.6, 0.9],
  ['Amsterdam', 'MS Azure', 'West US', 0.72, 0.63, 0.95],
  ['Amsterdam', 'MS Azure', 'UAE North', 0.78, 0.69, 1.03],
  ['Amsterdam', 'MS Azure', 'Southeast Asia', 0.82, 0.72, 1.08],
  ['Amsterdam', 'MS Azure', 'Central India', 0.8, 0.7, 1.06],
  // Ashburn
  ['Ashburn', 'AWS', 'us-east-1', 0.49, 0.43, 0.65],
  ['Ashburn', 'AWS', 'us-west-2', 0.52, 0.46, 0.69],
  ['Ashburn', 'AWS', 'eu-west-1', 0.66, 0.58, 0.87],
  ['Ashburn', 'AWS', 'eu-west-2', 0.67, 0.59, 0.88],
  ['Ashburn', 'AWS', 'eu-central-1', 0.68, 0.6, 0.9],
  ['Ashburn', 'AWS', 'eu-south-2', 0.69, 0.61, 0.91],
  ['Ashburn', 'AWS', 'me-central-1', 0.75, 0.66, 0.99],
  ['Ashburn', 'AWS', 'ap-southeast-1', 0.79, 0.7, 1.04],
  ['Ashburn', 'AWS', 'ap-south-1', 0.77, 0.68, 1.02],
  ['Ashburn', 'AWS', 'ap-northeast-1', 0.81, 0.71, 1.07],
  ['Ashburn', 'GCP', 'us-east4', 0.51, 0.45, 0.67],
  ['Ashburn', 'GCP', 'us-east1', 0.52, 0.46, 0.69],
  ['Ashburn', 'GCP', 'us-west1', 0.54, 0.48, 0.71],
  ['Ashburn', 'GCP', 'europe-west1', 0.68, 0.6, 0.9],
  ['Ashburn', 'GCP', 'europe-west2', 0.69, 0.61, 0.91],
  ['Ashburn', 'GCP', 'europe-west3', 0.7, 0.62, 0.92],
  ['Ashburn', 'GCP', 'europe-west4', 0.71, 0.62, 0.94],
  ['Ashburn', 'GCP', 'me-west1', 0.78, 0.69, 1.03],
  ['Ashburn', 'GCP', 'asia-southeast1', 0.82, 0.72, 1.08],
  ['Ashburn', 'GCP', 'asia-south1', 0.8, 0.7, 1.06],
  ['Ashburn', 'MS Azure', 'East US', 0.5, 0.44, 0.66],
  ['Ashburn', 'MS Azure', 'West US', 0.53, 0.47, 0.7],
  ['Ashburn', 'MS Azure', 'West Europe', 0.67, 0.59, 0.88],
  ['Ashburn', 'MS Azure', 'UK South', 0.68, 0.6, 0.9],
  ['Ashburn', 'MS Azure', 'Germany West Central', 0.69, 0.61, 0.91],
  ['Ashburn', 'MS Azure', 'Spain Central', 0.7, 0.62, 0.92],
  ['Ashburn', 'MS Azure', 'UAE North', 0.76, 0.67, 1.0],
  ['Ashburn', 'MS Azure', 'Southeast Asia', 0.8, 0.7, 1.06],
  ['Ashburn', 'MS Azure', 'Central India', 0.78, 0.69, 1.03],
  // Dubai
  ['Dubai', 'AWS', 'me-central-1', 0.72, 0.63, 0.95],
  ['Dubai', 'AWS', 'eu-central-1', 0.86, 0.76, 1.14],
  ['Dubai', 'AWS', 'eu-west-1', 0.87, 0.77, 1.15],
  ['Dubai', 'AWS', 'eu-west-2', 0.88, 0.77, 1.16],
  ['Dubai', 'AWS', 'us-east-1', 0.94, 0.83, 1.24],
  ['Dubai', 'AWS', 'us-west-2', 0.98, 0.86, 1.29],
  ['Dubai', 'AWS', 'ap-southeast-1', 0.9, 0.79, 1.19],
  ['Dubai', 'AWS', 'ap-south-1', 0.88, 0.77, 1.16],
  ['Dubai', 'AWS', 'ap-northeast-1', 0.95, 0.84, 1.25],
  ['Dubai', 'GCP', 'me-west1', 0.75, 0.66, 0.99],
  ['Dubai', 'GCP', 'europe-west1', 0.89, 0.78, 1.17],
  ['Dubai', 'GCP', 'europe-west2', 0.9, 0.79, 1.19],
  ['Dubai', 'GCP', 'europe-west3', 0.91, 0.8, 1.2],
  ['Dubai', 'GCP', 'us-east1', 0.97, 0.85, 1.28],
  ['Dubai', 'GCP', 'us-west1', 1.01, 0.89, 1.33],
  ['Dubai', 'GCP', 'asia-southeast1', 0.93, 0.82, 1.23],
  ['Dubai', 'GCP', 'asia-south1', 0.91, 0.8, 1.2],
  ['Dubai', 'MS Azure', 'UAE North', 0.73, 0.64, 0.96],
  ['Dubai', 'MS Azure', 'Germany West Central', 0.87, 0.77, 1.15],
  ['Dubai', 'MS Azure', 'West Europe', 0.88, 0.77, 1.16],
  ['Dubai', 'MS Azure', 'UK South', 0.89, 0.78, 1.17],
  ['Dubai', 'MS Azure', 'East US', 0.95, 0.84, 1.25],
  ['Dubai', 'MS Azure', 'West US', 0.99, 0.87, 1.31],
  ['Dubai', 'MS Azure', 'Southeast Asia', 0.91, 0.8, 1.2],
  ['Dubai', 'MS Azure', 'Central India', 0.89, 0.78, 1.17],
  // Singapore
  ['Singapore', 'AWS', 'ap-southeast-1', 0.78, 0.69, 1.03],
  ['Singapore', 'AWS', 'ap-south-1', 0.82, 0.72, 1.08],
  ['Singapore', 'AWS', 'ap-northeast-1', 0.84, 0.74, 1.11],
  ['Singapore', 'AWS', 'eu-central-1', 0.96, 0.84, 1.27],
  ['Singapore', 'AWS', 'eu-west-1', 0.97, 0.85, 1.28],
  ['Singapore', 'AWS', 'eu-west-2', 0.98, 0.86, 1.29],
  ['Singapore', 'AWS', 'us-east-1', 1.04, 0.92, 1.37],
  ['Singapore', 'AWS', 'us-west-2', 1.02, 0.9, 1.35],
  ['Singapore', 'AWS', 'me-central-1', 0.94, 0.83, 1.24],
  ['Singapore', 'GCP', 'asia-southeast1', 0.8, 0.7, 1.06],
  ['Singapore', 'GCP', 'asia-south1', 0.84, 0.74, 1.11],
  ['Singapore', 'GCP', 'asia-northeast1', 0.86, 0.76, 1.14],
  ['Singapore', 'GCP', 'europe-west1', 0.99, 0.87, 1.31],
  ['Singapore', 'GCP', 'europe-west2', 1.0, 0.88, 1.32],
  ['Singapore', 'GCP', 'europe-west3', 1.01, 0.89, 1.33],
  ['Singapore', 'GCP', 'us-east1', 1.07, 0.94, 1.41],
  ['Singapore', 'GCP', 'us-west1', 1.05, 0.92, 1.39],
  ['Singapore', 'GCP', 'me-west1', 0.97, 0.85, 1.28],
  ['Singapore', 'MS Azure', 'Southeast Asia', 0.79, 0.7, 1.04],
  ['Singapore', 'MS Azure', 'Central India', 0.83, 0.73, 1.1],
  ['Singapore', 'MS Azure', 'Japan East', 0.85, 0.75, 1.12],
  ['Singapore', 'MS Azure', 'Germany West Central', 0.97, 0.85, 1.28],
  ['Singapore', 'MS Azure', 'West Europe', 0.98, 0.86, 1.29],
  ['Singapore', 'MS Azure', 'UK South', 0.99, 0.87, 1.31],
  ['Singapore', 'MS Azure', 'East US', 1.05, 0.92, 1.39],
  ['Singapore', 'MS Azure', 'West US', 1.03, 0.91, 1.36],
  ['Singapore', 'MS Azure', 'UAE North', 0.95, 0.84, 1.25],
]

// --- Seed helpers ---------------------------------------------------------

async function seedProducts(em: EntityManager, scope: SeedScope): Promise<void> {
  const { CatalogProduct } = await import('@open-mercato/core/modules/catalog/data/entities')
  for (const p of PRODUCTS) {
    const exists = await em.findOne(CatalogProduct, { ...scope, sku: p.sku, deletedAt: null })
    if (!exists) {
      em.persist(
        em.create(CatalogProduct, {
          ...scope,
          title: p.title,
          sku: p.sku,
          handle: p.sku.toLowerCase(),
          productType: 'configurable',
          description: p.description,
          isConfigurable: true,
          isActive: true,
        }),
      )
    }
  }
  await em.flush()
}

async function seedProductAttributes(em: EntityManager, scope: SeedScope): Promise<void> {
  const { CpqProductAttribute } = await import('./data/entities')
  const { CatalogProduct } = await import('@open-mercato/core/modules/catalog/data/entities')

  const productBySku = async (sku: string) => {
    let p = await em.findOne(CatalogProduct, { ...scope, sku, deletedAt: null })
    if (!p) {
      const handle = sku.toLowerCase()
      p = await em.findOne(CatalogProduct, { ...scope, handle, deletedAt: null })
      if (!p) {
        console.warn(`[CPQ seed] Product not found for SKU "${sku}" or handle "${handle}" — skipping attributes`)
        return undefined
      }
    }
    return p.id
  }

  const ensure = async (
    productId: string,
    attr: {
      code: string
      name: string
      attributeType: string
      options?: Array<{ value: string; label: string }> | null
      constraints?: Record<string, unknown> | null
      sortOrder: number
      isRequired?: boolean
    },
  ) => {
    const exists = await em.findOne(CpqProductAttribute, { ...scope, productId, code: attr.code })
    if (!exists) {
      em.persist(
        em.create(CpqProductAttribute, {
          ...scope,
          productId,
          code: attr.code,
          name: attr.name,
          attributeType: attr.attributeType,
          options: attr.options ?? null,
          constraints: attr.constraints ?? null,
          sortOrder: attr.sortOrder,
          isRequired: attr.isRequired ?? true,
        }),
      )
    }
  }

  // GIX Access Port
  const accessPortId = await productBySku('GIX-ACCESS-PORT')
  if (accessPortId) {
    await ensure(accessPortId, {
      code: 'data_centre',
      name: 'Data Centre',
      attributeType: 'enum',
      options: DATA_CENTRE_OPTIONS,
      sortOrder: 0,
      isRequired: true,
    })
    await ensure(accessPortId, {
      code: 'port_size',
      name: 'Port Size',
      attributeType: 'enum',
      options: [
        { value: '1G', label: '1G' },
        { value: '10G', label: '10G' },
        { value: '100G', label: '100G' },
      ],
      constraints: { dependsOn: { attributeCode: 'data_centre', effect: 'filter_options' } },
      sortOrder: 1,
      isRequired: true,
    })
  }

  // GIX Internet Peering
  const internetPeeringId = await productBySku('GIX-INTERNET-PEERING')
  if (internetPeeringId) {
    await ensure(internetPeeringId, {
      code: 'bandwidth_mb',
      name: 'Bandwidth (MB)',
      attributeType: 'number',
      constraints: { min: 1, step: 1 },
      sortOrder: 0,
      isRequired: true,
    })
  }

  // GIX Mobile Peering
  const mobilePeeringId = await productBySku('GIX-MOBILE-PEERING')
  if (mobilePeeringId) {
    await ensure(mobilePeeringId, {
      code: 'bandwidth_mb',
      name: 'Bandwidth (MB)',
      attributeType: 'number',
      constraints: { min: 1, step: 1 },
      sortOrder: 0,
      isRequired: true,
    })
  }

  // GIX Cloud Connect
  const cloudConnectId = await productBySku('GIX-CLOUD-CONNECT')
  if (cloudConnectId) {
    await ensure(cloudConnectId, {
      code: 'cloud_provider',
      name: 'Cloud Provider',
      attributeType: 'enum',
      options: [
        { value: 'AWS', label: 'AWS' },
        { value: 'GCP', label: 'GCP' },
        { value: 'MS Azure', label: 'MS Azure' },
      ],
      sortOrder: 0,
    })
    await ensure(cloudConnectId, {
      code: 'cloud_region',
      name: 'Cloud Region',
      attributeType: 'enum',
      options: null,
      constraints: {
        dependsOn: { attributeCode: 'cloud_provider', effect: 'filter_options' },
        dynamicOptionsSource: {
          type: 'pricing_table',
          tableCode: 'gix_cloud_connect_pricing',
          dimensionKey: 'cloud_region',
          filterByDimension: { cloud_provider: '$cloud_provider' },
        },
      },
      sortOrder: 1,
    })
    await ensure(cloudConnectId, {
      code: 'pricing_model',
      name: 'Pricing Model',
      attributeType: 'enum',
      options: [
        { value: 'flat', label: 'Flat' },
        { value: 'burstable', label: 'Burstable' },
      ],
      sortOrder: 2,
    })
    await ensure(cloudConnectId, {
      code: 'bandwidth_mb',
      name: 'Bandwidth (MB)',
      attributeType: 'number',
      constraints: { min: 1, step: 1 },
      sortOrder: 3,
    })
  }

  await em.flush()
}

async function seedPricingTables(em: EntityManager, scope: SeedScope): Promise<void> {
  const { CpqPricingTable, CpqPricingTableEntry } = await import('./data/entities')

  const ensureTable = async (data: {
    code: string
    name: string
    dimensions: Array<{ key: string; label: string }>
    priceColumns: Array<{ key: string; label: string }>
    currencyCodeList: string[]
  }): Promise<string> => {
    let table = await em.findOne(CpqPricingTable, { ...scope, code: data.code })
    if (!table) {
      table = em.create(CpqPricingTable, { ...scope, ...data })
      em.persist(table)
      await em.flush()
    }
    return table.id
  }

  const ensureEntry = async (
    tableId: string,
    lookup: Record<string, unknown>,
    data: Record<string, unknown>,
  ) => {
    const exists = await em.findOne(CpqPricingTableEntry, { ...scope, pricingTableId: tableId, ...lookup })
    if (!exists) {
      em.persist(em.create(CpqPricingTableEntry, { ...scope, pricingTableId: tableId, currencyCode: 'USD', ...data }))
    }
  }

  // Table 1: Access Port pricing
  const accessPortTableId = await ensureTable({
    code: 'gix_access_port_pricing',
    name: 'GIX Access Port Pricing',
    dimensions: [
      { key: 'data_centre', label: 'Data Centre' },
      { key: 'port_size', label: 'Port Size' },
    ],
    priceColumns: [
      { key: 'nrc', label: 'Setup Price (NRC)' },
      { key: 'mrc', label: 'Monthly Recurring (MRC)' },
    ],
    currencyCodeList: ['USD'],
  })

  for (const [dcCode, portSizes] of Object.entries(ACCESS_PORT_PRICES)) {
    for (const [portSize, prices] of Object.entries(portSizes)) {
      const dimValues = { data_centre: dcCode, port_size: portSize }
      await ensureEntry(accessPortTableId, { dimensionValues: dimValues }, {
        dimensionValues: dimValues,
        prices: { nrc: prices.nrc, mrc: prices.mrc },
      })
    }
  }
  await em.flush()

  // Table 2: Internet Peering pricing
  const internetPeeringTableId = await ensureTable({
    code: 'gix_internet_peering_pricing',
    name: 'GIX Internet Peering Pricing',
    dimensions: [],
    priceColumns: [{ key: 'per_mb', label: 'Price per MB' }],
    currencyCodeList: ['USD'],
  })

  for (const t of INTERNET_PEERING_TIERS) {
    await ensureEntry(internetPeeringTableId, { tierNumber: t.tier }, {
      dimensionValues: {},
      tierNumber: t.tier,
      rangeFrom: String(t.from),
      rangeTo: t.to != null ? String(t.to) : null,
      prices: { per_mb: t.per_mb },
    })
  }
  await em.flush()

  // Table 3: Mobile Peering pricing
  const mobilePeeringTableId = await ensureTable({
    code: 'gix_mobile_peering_pricing',
    name: 'GIX Mobile Peering Pricing',
    dimensions: [],
    priceColumns: [{ key: 'per_mb', label: 'Price per MB' }],
    currencyCodeList: ['USD'],
  })

  for (const t of MOBILE_PEERING_TIERS) {
    await ensureEntry(mobilePeeringTableId, { tierNumber: t.tier }, {
      dimensionValues: {},
      tierNumber: t.tier,
      rangeFrom: String(t.from),
      rangeTo: t.to != null ? String(t.to) : null,
      prices: { per_mb: t.per_mb },
    })
  }
  await em.flush()

  // Table 4: Cloud Connect pricing
  const cloudConnectTableId = await ensureTable({
    code: 'gix_cloud_connect_pricing',
    name: 'GIX Cloud Connect Pricing',
    dimensions: [
      { key: 'data_centre_location', label: 'Data Centre Location' },
      { key: 'cloud_provider', label: 'Cloud Provider' },
      { key: 'cloud_region', label: 'Cloud Region' },
    ],
    priceColumns: [
      { key: 'flat_per_mb', label: 'Flat Price per MB' },
      { key: 'commit_per_mb', label: 'Commit Price per MB' },
      { key: 'overage_per_mb', label: 'Overage Price per MB' },
    ],
    currencyCodeList: ['USD'],
  })

  for (const [location, provider, region, flat, commit, overage] of CLOUD_CONNECT_ENTRIES) {
    const dimValues = { data_centre_location: location, cloud_provider: provider, cloud_region: region }
    await ensureEntry(cloudConnectTableId, { dimensionValues: dimValues }, {
      dimensionValues: dimValues,
      prices: { flat_per_mb: flat, commit_per_mb: commit, overage_per_mb: overage },
    })
  }
  await em.flush()
}

async function seedProductCharges(em: EntityManager, scope: SeedScope): Promise<void> {
  const { CpqProductCharge, CpqPricingTable } = await import('./data/entities')
  const { CatalogProduct } = await import('@open-mercato/core/modules/catalog/data/entities')

  const tableId = async (code: string) => {
    const t = await em.findOne(CpqPricingTable, { ...scope, code })
    return t?.id ?? null
  }

  const productId = async (sku: string) => {
    let p = await em.findOne(CatalogProduct, { ...scope, sku, deletedAt: null })
    if (!p) {
      const handle = sku.toLowerCase()
      p = await em.findOne(CatalogProduct, { ...scope, handle, deletedAt: null })
      if (!p) {
        console.warn(`[CPQ seed] Product not found for SKU "${sku}" or handle "${handle}" — skipping charges`)
        return undefined
      }
    }
    return p.id
  }

  const ensure = async (
    pid: string,
    charge: {
      code: string
      name: string
      chargeType: string
      pricingMethod: string
      pricingTableId?: string | null
      priceColumnKey?: string | null
      quantityAttributeCode?: string | null
      applicabilityCondition?: Record<string, unknown> | null
      sortOrder: number
    },
  ) => {
    const exists = await em.findOne(CpqProductCharge, { ...scope, productId: pid, code: charge.code })
    if (!exists) {
      em.persist(em.create(CpqProductCharge, { ...scope, productId: pid, ...charge }))
    }
  }

  const accessPortTableId = await tableId('gix_access_port_pricing')
  const internetPeeringTableId = await tableId('gix_internet_peering_pricing')
  const mobilePeeringTableId = await tableId('gix_mobile_peering_pricing')
  const cloudConnectTableId = await tableId('gix_cloud_connect_pricing')

  // GIX Access Port charges
  const accessPortId = await productId('GIX-ACCESS-PORT')
  if (accessPortId) {
    await ensure(accessPortId, {
      code: 'setup_fee',
      name: 'Setup Fee',
      chargeType: 'nrc',
      pricingMethod: 'flat',
      pricingTableId: accessPortTableId,
      priceColumnKey: 'nrc',
      sortOrder: 0,
    })
    await ensure(accessPortId, {
      code: 'monthly_port_fee',
      name: 'Monthly Port Fee',
      chargeType: 'mrc',
      pricingMethod: 'flat',
      pricingTableId: accessPortTableId,
      priceColumnKey: 'mrc',
      sortOrder: 1,
    })
  }

  // GIX Internet Peering charges
  const internetPeeringId = await productId('GIX-INTERNET-PEERING')
  if (internetPeeringId) {
    await ensure(internetPeeringId, {
      code: 'bandwidth_fee',
      name: 'Bandwidth Fee',
      chargeType: 'mrc',
      pricingMethod: 'tiered',
      pricingTableId: internetPeeringTableId,
      priceColumnKey: 'per_mb',
      quantityAttributeCode: 'bandwidth_mb',
      sortOrder: 0,
    })
  }

  // GIX Mobile Peering charges
  const mobilePeeringId = await productId('GIX-MOBILE-PEERING')
  if (mobilePeeringId) {
    await ensure(mobilePeeringId, {
      code: 'bandwidth_fee',
      name: 'Bandwidth Fee',
      chargeType: 'mrc',
      pricingMethod: 'tiered',
      pricingTableId: mobilePeeringTableId,
      priceColumnKey: 'per_mb',
      quantityAttributeCode: 'bandwidth_mb',
      sortOrder: 0,
    })
  }

  // GIX Cloud Connect charges
  const cloudConnectId = await productId('GIX-CLOUD-CONNECT')
  if (cloudConnectId) {
    await ensure(cloudConnectId, {
      code: 'flat_bandwidth_fee',
      name: 'Flat Bandwidth Fee',
      chargeType: 'mrc',
      pricingMethod: 'per_unit',
      pricingTableId: cloudConnectTableId,
      priceColumnKey: 'flat_per_mb',
      quantityAttributeCode: 'bandwidth_mb',
      applicabilityCondition: { attribute: 'pricing_model', operator: 'eq', value: 'flat' },
      sortOrder: 0,
    })
    await ensure(cloudConnectId, {
      code: 'commit_bandwidth_fee',
      name: 'Committed Bandwidth Fee',
      chargeType: 'mrc',
      pricingMethod: 'per_unit',
      pricingTableId: cloudConnectTableId,
      priceColumnKey: 'commit_per_mb',
      quantityAttributeCode: 'bandwidth_mb',
      applicabilityCondition: { attribute: 'pricing_model', operator: 'eq', value: 'burstable' },
      sortOrder: 1,
    })
    await ensure(cloudConnectId, {
      code: 'overage_fee',
      name: 'Overage Fee',
      chargeType: 'usage',
      pricingMethod: 'per_unit',
      pricingTableId: cloudConnectTableId,
      priceColumnKey: 'overage_per_mb',
      quantityAttributeCode: 'bandwidth_mb',
      applicabilityCondition: { attribute: 'pricing_model', operator: 'eq', value: 'burstable' },
      sortOrder: 2,
    })
  }

  await em.flush()
}

async function seedProductSpecsAndOfferings(em: EntityManager, scope: SeedScope): Promise<void> {
  const { CpqProductSpecification, CpqProductOffering, CpqProductAttribute, CpqProductCharge } = await import(
    './data/entities'
  )
  const { CatalogProduct } = await import('@open-mercato/core/modules/catalog/data/entities')

  const SPEC_OFFERING_MAP = [
    { sku: 'GIX-ACCESS-PORT', specCode: 'SPEC-GIX-ACCESS-PORT', offerCode: 'OFFER-GIX-ACCESS-PORT' },
    { sku: 'GIX-INTERNET-PEERING', specCode: 'SPEC-GIX-INTERNET-PEERING', offerCode: 'OFFER-GIX-INTERNET-PEERING' },
    { sku: 'GIX-MOBILE-PEERING', specCode: 'SPEC-GIX-MOBILE-PEERING', offerCode: 'OFFER-GIX-MOBILE-PEERING' },
    { sku: 'GIX-CLOUD-CONNECT', specCode: 'SPEC-GIX-CLOUD-CONNECT', offerCode: 'OFFER-GIX-CLOUD-CONNECT' },
  ]

  for (const entry of SPEC_OFFERING_MAP) {
    const product = await em.findOne(CatalogProduct, { ...scope, sku: entry.sku, deletedAt: null })
    if (!product) continue

    let spec = await em.findOne(CpqProductSpecification, { ...scope, code: entry.specCode })
    if (!spec) {
      spec = em.create(CpqProductSpecification, {
        ...scope,
        productId: product.id,
        code: entry.specCode,
        name: `${product.title} Specification`,
        description: product.description ?? null,
        lifecycleStatus: 'active',
        version: 1,
      })
      em.persist(spec)
      await em.flush()
    }

    let offering = await em.findOne(CpqProductOffering, { ...scope, code: entry.offerCode })
    if (!offering) {
      offering = em.create(CpqProductOffering, {
        ...scope,
        specId: spec.id,
        code: entry.offerCode,
        name: `${product.title} Standard Offering`,
        description: `Standard offering for ${product.title}`,
        lifecycleStatus: 'active',
      })
      em.persist(offering)
      await em.flush()
    }

    const attrs = await em.find(CpqProductAttribute, { ...scope, productId: product.id, specId: null })
    for (const attr of attrs) {
      attr.specId = spec.id
    }

    const charges = await em.find(CpqProductCharge, { ...scope, productId: product.id, offeringId: null })
    for (const charge of charges) {
      charge.offeringId = offering.id
    }
  }
  await em.flush()
}

async function seedPriceRules(em: EntityManager, scope: SeedScope): Promise<void> {
  const { CpqPriceRule, CpqProductOffering } = await import('./data/entities')

  const offeringId = async (code: string): Promise<string | undefined> => {
    const o = await em.findOne(CpqProductOffering, { ...scope, code, deletedAt: null })
    return o?.id
  }

  const ensure = async (data: {
    code: string
    name: string
    description?: string
    productOfferingId?: string | null
    ruleType: string
    value: string
    chargeTypeFilter?: string | null
    chargeCodeFilter?: string | null
    applicabilityCondition?: Record<string, unknown> | null
    sortOrder: number
    isActive?: boolean
  }) => {
    const exists = await em.findOne(CpqPriceRule, { ...scope, code: data.code })
    if (!exists) {
      em.persist(em.create(CpqPriceRule, { ...scope, ...data }))
    }
  }

  await ensure({
    code: 'early-adopter-nrc-waiver',
    name: 'Early Adopter — NRC Waiver',
    description: 'Waive all setup fees for early-adopter customers',
    ruleType: 'discount_percent',
    value: '100',
    chargeTypeFilter: 'nrc',
    sortOrder: 10,
    isActive: false,
  })

  await ensure({
    code: 'volume-mrc-10pct',
    name: 'Volume Discount — 10% MRC',
    description: 'Standard 10% recurring discount for volume commitments',
    ruleType: 'discount_percent',
    value: '10',
    chargeTypeFilter: 'mrc',
    sortOrder: 20,
    isActive: true,
  })

  await ensure({
    code: 'setup-fee-cap-200',
    name: 'Setup Fee Cap at $200',
    description: 'Override any setup fee above $200 to a flat $200',
    ruleType: 'price_override',
    value: '200',
    chargeCodeFilter: 'setup_fee',
    sortOrder: 5,
    isActive: false,
  })

  await ensure({
    code: 'premium-100g-surcharge',
    name: '100G Port Premium Surcharge',
    description: '$50 surcharge on monthly port fee for 100G ports',
    ruleType: 'surcharge_absolute',
    value: '50',
    chargeCodeFilter: 'monthly_port_fee',
    applicabilityCondition: { attribute: 'port_size', operator: 'eq', value: '100G' },
    sortOrder: 30,
    isActive: true,
  })

  await ensure({
    code: 'cloud-connect-5pct-off',
    name: 'Cloud Connect Promo — 5% Off',
    description: '5% discount on all Cloud Connect charges',
    ruleType: 'discount_percent',
    value: '5',
    chargeCodeFilter: null,
    chargeTypeFilter: null,
    applicabilityCondition: { attribute: 'cloud_provider', operator: 'neq', value: '' },
    sortOrder: 40,
    isActive: true,
  })

  const accessPortOfferingId = await offeringId('OFFER-GIX-ACCESS-PORT')
  if (accessPortOfferingId) {
    await ensure({
      code: 'access-port-nrc-15pct-off',
      name: 'Access Port — 15% Setup Discount',
      description: '15% discount on Access Port setup fees only',
      productOfferingId: accessPortOfferingId,
      ruleType: 'discount_percent',
      value: '15',
      chargeCodeFilter: 'setup_fee',
      sortOrder: 15,
      isActive: true,
    })
  }

  const internetPeeringOfferingId = await offeringId('OFFER-GIX-INTERNET-PEERING')
  if (internetPeeringOfferingId) {
    await ensure({
      code: 'internet-peering-bandwidth-surcharge',
      name: 'Internet Peering — Bandwidth Surcharge',
      description: '$25 flat surcharge on Internet Peering bandwidth fee',
      productOfferingId: internetPeeringOfferingId,
      ruleType: 'surcharge_absolute',
      value: '25',
      chargeCodeFilter: 'bandwidth_fee',
      sortOrder: 35,
      isActive: true,
    })
  }

  const cloudConnectOfferingId = await offeringId('OFFER-GIX-CLOUD-CONNECT')
  if (cloudConnectOfferingId) {
    await ensure({
      code: 'cloud-connect-commit-override',
      name: 'Cloud Connect — Committed Rate Override',
      description: 'Override committed bandwidth rate to $0.40/MB for promotional period',
      productOfferingId: cloudConnectOfferingId,
      ruleType: 'price_override',
      value: '0.40',
      chargeCodeFilter: 'commit_bandwidth_fee',
      applicabilityCondition: { attribute: 'pricing_model', operator: 'eq', value: 'burstable' },
      sortOrder: 25,
      isActive: false,
    })
  }

  await em.flush()
}

async function seedBundleData(em: EntityManager, scope: SeedScope): Promise<void> {
  const { CpqProductSpecification, CpqProductOffering, CpqProductCharge, CpqBundleSlot, CpqOfferingComponent } = await import(
    './data/entities'
  )
  const { CatalogProduct } = await import('@open-mercato/core/modules/catalog/data/entities')

  const bundleProduct = await em.findOne(CatalogProduct, { ...scope, sku: 'GIX-CONNECTIVITY-BUNDLE', deletedAt: null })
  if (!bundleProduct) return

  let bundleSpec = await em.findOne(CpqProductSpecification, { ...scope, code: 'SPEC-GIX-CONNECTIVITY-BUNDLE' })
  if (!bundleSpec) {
    bundleSpec = em.create(CpqProductSpecification, {
      ...scope,
      productId: bundleProduct.id,
      code: 'SPEC-GIX-CONNECTIVITY-BUNDLE',
      name: 'GIX Connectivity Bundle Specification',
      description: 'Bundle specification: Access Port + peering/cloud services',
      specType: 'bundle',
      lifecycleStatus: 'active',
      version: 1,
    })
    em.persist(bundleSpec)
    await em.flush()
  }

  const childSpecs = {
    accessPort: await em.findOne(CpqProductSpecification, { ...scope, code: 'SPEC-GIX-ACCESS-PORT' }),
    internetPeering: await em.findOne(CpqProductSpecification, { ...scope, code: 'SPEC-GIX-INTERNET-PEERING' }),
    mobilePeering: await em.findOne(CpqProductSpecification, { ...scope, code: 'SPEC-GIX-MOBILE-PEERING' }),
    cloudConnect: await em.findOne(CpqProductSpecification, { ...scope, code: 'SPEC-GIX-CLOUD-CONNECT' }),
  }
  if (!childSpecs.accessPort || !childSpecs.internetPeering || !childSpecs.mobilePeering || !childSpecs.cloudConnect) {
    console.warn('[CPQ seed] Missing child specs for bundle — skipping')
    return
  }

  const slotDefs = [
    { key: 'access', targetSpecId: childSpecs.accessPort.id, name: 'Access Port', min: 1, max: 1, sort: 0 },
    { key: 'peering-ip', targetSpecId: childSpecs.internetPeering.id, name: 'Internet Peering', min: 0, max: 1, sort: 1 },
    { key: 'peering-mp', targetSpecId: childSpecs.mobilePeering.id, name: 'Mobile Peering', min: 0, max: 1, sort: 2 },
    { key: 'cloud', targetSpecId: childSpecs.cloudConnect.id, name: 'Cloud Connect', min: 0, max: 2, sort: 3 },
  ]
  const slots = new Map<string, InstanceType<typeof CpqBundleSlot>>()
  for (const sd of slotDefs) {
    let slot = await em.findOne(CpqBundleSlot, { ...scope, specId: bundleSpec.id, targetSpecId: sd.targetSpecId })
    if (!slot) {
      slot = em.create(CpqBundleSlot, {
        ...scope, specId: bundleSpec.id, targetSpecId: sd.targetSpecId,
        componentGroup: sd.key.split('-')[0], name: sd.name,
        cardinalityMin: sd.min, cardinalityMax: sd.max, sortOrder: sd.sort,
      })
      em.persist(slot)
    }
    slots.set(sd.key, slot)
  }
  await em.flush()

  let bundleOffering = await em.findOne(CpqProductOffering, { ...scope, code: 'OFFER-GIX-CONNECTIVITY-BUNDLE' })
  if (!bundleOffering) {
    bundleOffering = em.create(CpqProductOffering, {
      ...scope, specId: bundleSpec.id,
      code: 'OFFER-GIX-CONNECTIVITY-BUNDLE',
      name: 'GIX Connectivity Bundle — Standard',
      description: 'All-in-one connectivity package with Access Port, peering, and cloud services',
      offeringType: 'bundle', lifecycleStatus: 'active',
    })
    em.persist(bundleOffering)
    await em.flush()
  }

  // Bundle-level charges (discounts are handled via Price Rules, not negative charges)
  const bundleChargeDefs = [
    {
      code: 'bundle_setup_fee', name: 'Bundle Setup Fee',
      chargeType: 'nrc', pricingMethod: 'fixed', fixedPrice: '150', currencyCode: 'USD', sortOrder: 0,
    },
    {
      code: 'bundle_monthly_fee', name: 'Bundle Monthly Platform Fee',
      chargeType: 'mrc', pricingMethod: 'fixed', fixedPrice: '49.99', currencyCode: 'USD', sortOrder: 1,
    },
  ]
  for (const ch of bundleChargeDefs) {
    const exists = await em.findOne(CpqProductCharge, { ...scope, productId: bundleProduct.id, code: ch.code })
    if (!exists) {
      em.persist(em.create(CpqProductCharge, {
        ...scope, productId: bundleProduct.id, offeringId: bundleOffering.id, ...ch,
      }))
    }
  }
  await em.flush()

  const childOfferings = {
    accessPort: await em.findOne(CpqProductOffering, { ...scope, code: 'OFFER-GIX-ACCESS-PORT' }),
    internetPeering: await em.findOne(CpqProductOffering, { ...scope, code: 'OFFER-GIX-INTERNET-PEERING' }),
    mobilePeering: await em.findOne(CpqProductOffering, { ...scope, code: 'OFFER-GIX-MOBILE-PEERING' }),
    cloudConnect: await em.findOne(CpqProductOffering, { ...scope, code: 'OFFER-GIX-CLOUD-CONNECT' }),
  }
  if (!childOfferings.accessPort || !childOfferings.internetPeering || !childOfferings.mobilePeering || !childOfferings.cloudConnect) return

  const compDefs = [
    { slotKey: 'access', child: childOfferings.accessPort, isDefault: true, sort: 0 },
    { slotKey: 'peering-ip', child: childOfferings.internetPeering, isDefault: true, sort: 1 },
    { slotKey: 'peering-mp', child: childOfferings.mobilePeering, isDefault: false, sort: 2 },
    { slotKey: 'cloud', child: childOfferings.cloudConnect, isDefault: false, sort: 3 },
  ]
  for (const cd of compDefs) {
    const slot = slots.get(cd.slotKey)
    if (!slot) continue
    const exists = await em.findOne(CpqOfferingComponent, { ...scope, offeringId: bundleOffering.id, childOfferingId: cd.child.id })
    if (!exists) {
      em.persist(em.create(CpqOfferingComponent, {
        ...scope, offeringId: bundleOffering.id, slotId: slot.id,
        childOfferingId: cd.child.id, isDefault: cd.isDefault, sortOrder: cd.sort,
      }))
    }
  }
  await em.flush()
  console.log('    Bundle seed complete: GIX Connectivity Bundle (4 slots, 4 components, 2 charges)')
}

// --- Module setup config --------------------------------------------------

export const setup: ModuleSetupConfig = {
  defaultRoleFeatures: {
    admin: [
      'cpq.quotes.view',
      'cpq.quotes.manage',
      'cpq.pricing.view',
      'cpq.pricing.manage',
      'cpq.products.view',
      'cpq.products.manage',
      'cpq.specifications.view',
      'cpq.specifications.manage',
      'cpq.offerings.view',
      'cpq.offerings.manage',
      'cpq.wizards.view',
      'cpq.wizards.manage',
      'cpq.inventory.view',
      'cpq.inventory.manage',
      'cpq.orders.view',
      'cpq.orders.manage',
    ],
    employee: [
      'cpq.quotes.view',
      'cpq.quotes.manage',
      'cpq.pricing.view',
      'cpq.products.view',
      'cpq.specifications.view',
      'cpq.offerings.view',
      'cpq.wizards.view',
      'cpq.inventory.view',
      'cpq.orders.view',
    ],
  },

  async seedDefaults({ em, tenantId, organizationId }) {
    const scope = { tenantId, organizationId }
    await seedProducts(em, scope)
    await em.flush()
    await seedPricingTables(em, scope)
    await seedProductAttributes(em, scope)
    await seedProductCharges(em, scope)
    await seedProductSpecsAndOfferings(em, scope)
    await seedPriceRules(em, scope)
    await seedBundleData(em, scope)
    await seedCpqDefaults(em, scope)
  },

  async seedExamples({ em, container, tenantId, organizationId }) {
    await seedCpqExamples(em, container, { tenantId, organizationId })
  },
}

export default setup
