# CPQ Requirements Specification — Wholesale Carrier
This file outlines requirements and specification for the CPQ module based on a wholesale telecommunications carrier use case.


# Use Case Description
The objective is to model the quoting domain of a wholesale telecommunications carrier that sells network connectivity and infrastructure services to other carriers, enterprises, and service providers.

Our wholesale carrier — **NovaNET** — operates a pan-European fibre network with strategic global Points of Presence (PoPs). NovaNET sells Layer 1 (physical), Layer 2, and Layer 3 connectivity, alongside managed services and colocation.


## Network Footprint

NovaNET operates 50 on-net PoPs across Europe and select global locations. Each PoP is located in a carrier-neutral data centre.

### On-Net PoPs

| # | City | Country | PoP Code | Data Centre | Tier |
|---|------|---------|----------|-------------|------|
| 1 | London | GB | LON1 | Equinix LD8 (Docklands) | Major |
| 2 | London | GB | LON2 | Telehouse North (Docklands) | Major |
| 3 | London | GB | LON3 | LINX / Equinix LD5 (Slough) | Major |
| 4 | Frankfurt | DE | FRA1 | Equinix FR5 (Kleyerstr.) | Major |
| 5 | Frankfurt | DE | FRA2 | DE-CIX / Interxion FRA1 | Major |
| 6 | Frankfurt | DE | FRA3 | Digital Realty FRA8 | Standard |
| 7 | Amsterdam | NL | AMS1 | Equinix AM5 (Schiphol) | Major |
| 8 | Amsterdam | NL | AMS2 | Interxion AMS3 (Science Park) | Major |
| 9 | Amsterdam | NL | AMS3 | Digital Realty AMS11 | Standard |
| 10 | Paris | FR | PAR1 | Equinix PA3 (Saint-Denis) | Major |
| 11 | Paris | FR | PAR2 | Interxion PAR7 (La Courneuve) | Major |
| 12 | Madrid | ES | MAD1 | Equinix MD2 (Alcobendas) | Standard |
| 13 | Madrid | ES | MAD2 | Interxion MAD1 | Standard |
| 14 | Barcelona | ES | BCN1 | Equinix BC1 | Standard |
| 15 | Milan | IT | MIL1 | Equinix ML2 (Assago) | Standard |
| 16 | Rome | IT | ROM1 | Aruba IT3 (Ponte San Pietro) | Standard |
| 17 | Stockholm | SE | STO1 | Equinix SK1 (Bromma) | Standard |
| 18 | Stockholm | SE | STO2 | Interxion STO1 (Akalla) | Standard |
| 19 | Copenhagen | DK | CPH1 | Interxion CPH1 | Standard |
| 20 | Oslo | NO | OSL1 | Digiplex Oslo (Rosenholm) | Standard |
| 21 | Helsinki | FI | HEL1 | Equinix HE6 (Pitäjänmäki) | Standard |
| 22 | Warsaw | PL | WAW1 | Equinix WA1 | Standard |
| 23 | Warsaw | PL | WAW2 | Atman Data Centre (Warsaw) | Standard |
| 24 | Prague | CZ | PRG1 | CE Colo (Prague) | Standard |
| 25 | Vienna | AT | VIE1 | Interxion VIE1 (Floridsdorf) | Standard |
| 26 | Zurich | CH | ZRH1 | Equinix ZH4 (Zurich) | Standard |
| 27 | Geneva | CH | GVA1 | Equinix GV1 | Standard |
| 28 | Dublin | IE | DUB1 | Equinix DB3 (Profile Park) | Standard |
| 29 | Brussels | BE | BRU1 | Interxion BRU1 (Zaventem) | Standard |
| 30 | Luxembourg | LU | LUX1 | LuxConnect DC1 | Standard |
| 31 | Lisbon | PT | LIS1 | Equinix LS1 (Prior Velho) | Standard |
| 32 | Bucharest | RO | BUH1 | Nxdata BUH1 | Standard |
| 33 | Budapest | HU | BUD1 | Invitech DC (Budapest) | Standard |
| 34 | Sofia | BG | SOF1 | Telepoint (Sofia) | Standard |
| 35 | Athens | GR | ATH1 | Lamda Hellix (Athens) | Standard |
| 36 | Istanbul | TR | IST1 | Equinix IS1 | Standard |
| 37 | Marseille | FR | MRS1 | Interxion MRS1 (Marseille) | Major |
| 38 | Hamburg | DE | HAM1 | e-shelter Hamburg | Standard |
| 39 | Düsseldorf | DE | DUS1 | Equinix DU1 | Standard |
| 40 | Munich | DE | MUC1 | Equinix MU1 | Standard |
| 41 | Berlin | DE | BER1 | e-shelter Berlin | Standard |
| 42 | Gothenburg | SE | GOT1 | GleSYS Falkenberg | Standard |
| 43 | Manchester | GB | MAN1 | Equinix MA1 (Williams Gate) | Standard |
| 44 | Edinburgh | GB | EDI1 | Pulsant Edinburgh | Standard |
| 45 | Lyon | FR | LYO1 | Digital Realty LYO1 | Standard |
| 46 | Ashburn | US | ASH1 | Equinix DC3 (Ashburn) | Major |
| 47 | Ashburn | US | ASH2 | Equinix DC11 | Standard |
| 48 | Dubai | AE | DXB1 | Equinix DX1 (IMPZ) | Standard |
| 49 | Singapore | SG | SIN1 | Equinix SG1 (Ayer Rajah) | Major |
| 50 | Singapore | SG | SIN2 | Digital Realty SIN10 | Standard |

**PoP Tiers:**
- **Major** (12 PoPs): Full product availability, multiple backbone connections, IX presence. All products available.
- **Standard** (38 PoPs): Standard product availability, single/dual backbone connection. Some products may have limited capacity options.


## Location Model

Services require endpoints — the locations where connectivity is delivered. The location model is central to quoting.

### Location Types

| Type | Code | Description | NRC Impact |
|------|------|-------------|------------|
| **On-Net PoP** | `on_net` | NovaNET data centre / PoP. Customer has presence or orders cross-connect. | Lowest NRC. Cross-connect only. |
| **On-Net Building** | `on_net_building` | Third-party building where NovaNET has existing fibre/equipment. | Low NRC. In-building wiring. |
| **Near-Net** | `near_net` | Within 500m of NovaNET fibre. Short lateral build required. | Moderate NRC. Construction needed. |
| **Off-Net** | `off_net` | No NovaNET presence. Requires local tail from 3rd-party supplier. | Highest NRC. Supplier tail cost + management fee. |

### Circuit Topology & Segmentation

Every circuit is decomposed into segments:

```
[Customer Site A] ──local tail──> [Nearest PoP A] ══backbone══ [Nearest PoP Z] <──local tail── [Customer Site Z]
```

| Topology | A-End | Backbone | Z-End | Segments |
|----------|-------|----------|-------|----------|
| **PoP-to-PoP** | On-Net PoP | PoP A ↔ PoP Z | On-Net PoP | 1 (backbone only) |
| **PoP-to-End** | On-Net PoP | PoP A ↔ PoP nearest to Z | Off-net address | 2 (backbone + Z-end local tail) |
| **End-to-End** | Off-net address | PoP nearest to A ↔ PoP nearest to Z | Off-net address | 3 (A-end local tail + backbone + Z-end local tail) |
| **Multi-Site** | N sites (each on/off-net) | Hub PoP ↔ each site's nearest PoP | — | N × (backbone + optional local tail) |

### Local Tail (Off-Net Access)

When a customer site is off-net, a local tail must be provisioned from a 3rd-party local access supplier to connect the customer to the nearest NovaNET PoP.

**Local tail cost estimation:**
- Pre-loaded supplier price lists exist for major countries/cities — these provide estimated NRC + MRC based on country, city, bandwidth, and access technology.
- For locations not in the pre-loaded list, the system flags "requires survey" and uses country-level average estimates.
- After survey/sourcing, the actual supplier cost is updated, and the quote is re-priced.

### Local Tail Supplier Price Estimates (per country, MRC per tail)

| Country | Access Technology | Bandwidth | Estimated MRC | Estimated NRC |
|---------|------------------|-----------|---------------|---------------|
| GB | Ethernet (fibre) | 100 Mbps | 180.00 | 750.00 |
| GB | Ethernet (fibre) | 1 Gbps | 320.00 | 750.00 |
| GB | Ethernet (fibre) | 10 Gbps | 1,200.00 | 1,500.00 |
| DE | Ethernet (fibre) | 100 Mbps | 160.00 | 600.00 |
| DE | Ethernet (fibre) | 1 Gbps | 290.00 | 600.00 |
| DE | Ethernet (fibre) | 10 Gbps | 1,050.00 | 1,200.00 |
| FR | Ethernet (fibre) | 100 Mbps | 170.00 | 700.00 |
| FR | Ethernet (fibre) | 1 Gbps | 310.00 | 700.00 |
| FR | Ethernet (fibre) | 10 Gbps | 1,150.00 | 1,400.00 |
| NL | Ethernet (fibre) | 100 Mbps | 150.00 | 550.00 |
| NL | Ethernet (fibre) | 1 Gbps | 270.00 | 550.00 |
| NL | Ethernet (fibre) | 10 Gbps | 980.00 | 1,100.00 |
| ES | Ethernet (fibre) | 100 Mbps | 190.00 | 800.00 |
| ES | Ethernet (fibre) | 1 Gbps | 350.00 | 800.00 |
| ES | Ethernet (fibre) | 10 Gbps | 1,280.00 | 1,600.00 |
| IT | Ethernet (fibre) | 100 Mbps | 200.00 | 850.00 |
| IT | Ethernet (fibre) | 1 Gbps | 370.00 | 850.00 |
| IT | Ethernet (fibre) | 10 Gbps | 1,350.00 | 1,700.00 |
| SE | Ethernet (fibre) | 100 Mbps | 165.00 | 650.00 |
| SE | Ethernet (fibre) | 1 Gbps | 300.00 | 650.00 |
| SE | Ethernet (fibre) | 10 Gbps | 1,100.00 | 1,300.00 |
| PL | Ethernet (fibre) | 100 Mbps | 130.00 | 500.00 |
| PL | Ethernet (fibre) | 1 Gbps | 240.00 | 500.00 |
| PL | Ethernet (fibre) | 10 Gbps | 880.00 | 1,000.00 |
| CH | Ethernet (fibre) | 100 Mbps | 210.00 | 900.00 |
| CH | Ethernet (fibre) | 1 Gbps | 380.00 | 900.00 |
| CH | Ethernet (fibre) | 10 Gbps | 1,400.00 | 1,800.00 |
| AT | Ethernet (fibre) | 100 Mbps | 175.00 | 700.00 |
| AT | Ethernet (fibre) | 1 Gbps | 315.00 | 700.00 |
| AT | Ethernet (fibre) | 10 Gbps | 1,150.00 | 1,400.00 |
| IE | Ethernet (fibre) | 100 Mbps | 195.00 | 800.00 |
| IE | Ethernet (fibre) | 1 Gbps | 360.00 | 800.00 |
| IE | Ethernet (fibre) | 10 Gbps | 1,300.00 | 1,600.00 |
| US | Ethernet (fibre) | 100 Mbps | 220.00 | 950.00 |
| US | Ethernet (fibre) | 1 Gbps | 400.00 | 950.00 |
| US | Ethernet (fibre) | 10 Gbps | 1,500.00 | 2,000.00 |
| AE | Ethernet (fibre) | 100 Mbps | 280.00 | 1,200.00 |
| AE | Ethernet (fibre) | 1 Gbps | 520.00 | 1,200.00 |
| AE | Ethernet (fibre) | 10 Gbps | 1,900.00 | 2,500.00 |
| SG | Ethernet (fibre) | 100 Mbps | 250.00 | 1,100.00 |
| SG | Ethernet (fibre) | 1 Gbps | 460.00 | 1,100.00 |
| SG | Ethernet (fibre) | 10 Gbps | 1,700.00 | 2,200.00 |

> Note: These are cost estimates for internal margin calculation. The customer-facing quote includes a NovaNET management fee (typically 15-25% markup) on top of the supplier tail cost.


# Products

## 1. Dark Fibre

Physical fibre pair rental between two locations. Customer provides own equipment and lighting.

**Configurable Attributes:**

| Attribute | Type | Options / Constraints |
|-----------|------|----------------------|
| `a_end_location` | reference | PoP or address |
| `z_end_location` | reference | PoP or address |
| `fibre_pair_count` | select | 1, 2, 4, 12, 24, 48 |
| `route_diversity` | select | standard, diverse (physically separate routes) |
| `commercial_model` | select | lease, iru |
| `contract_term` | select | If lease: 3yr, 5yr, 10yr. If IRU: 15yr, 20yr, 25yr |

**Charges:**

| Charge | Type | Model | Notes |
|--------|------|-------|-------|
| Installation | NRC | flat | Per-circuit setup |
| Monthly Fibre Rental | MRC | per_unit | Per fibre pair × distance factor (lease model only) |
| IRU Fee | NRC | per_unit | Lump-sum per fibre pair × distance factor (IRU model only) |
| Annual O&M Fee | MRC | per_unit | 3% of IRU value, annualised monthly (IRU model only) |
| Cross-Connect (per end) | NRC | flat | Per on-net PoP termination |
| Local Tail A-End | NRC + MRC | flat | If A-end is off-net (sourced from supplier) |
| Local Tail Z-End | NRC + MRC | flat | If Z-end is off-net (sourced from supplier) |


## 2. Wavelengths (DWDM)

Managed or unmanaged optical wavelength transport between two PoPs.

**Configurable Attributes:**

| Attribute | Type | Options / Constraints |
|-----------|------|----------------------|
| `a_end_pop` | reference | On-net PoP |
| `z_end_pop` | reference | On-net PoP |
| `capacity` | select | 10G, 100G, 400G |
| `service_type` | select | managed (NovaNET transponders), unmanaged (customer optics) |
| `protection` | select | unprotected, protected_1plus1 (diverse path) |
| `interface_type` | select | Depends on capacity — 10G: SFP+; 100G: QSFP28; 400G: QSFP-DD |
| `contract_term` | select | 1yr, 3yr, 5yr |

**Charges:**

| Charge | Type | Model | Notes |
|--------|------|-------|-------|
| Installation | NRC | flat | Provisioning and testing |
| Wavelength Service | MRC | flat | Lookup by capacity × route-group × protection |
| Cross-Connect (per end) | NRC | flat | Per PoP termination |

### Wavelength Pricing (MRC, by capacity and route group)

Route groups are determined by distance between PoPs:

| Route Group | Description | Example Routes |
|-------------|-------------|----------------|
| Metro | Same city, <50km | LON1↔LON2, FRA1↔FRA2, AMS1↔AMS2 |
| Regional | Same region, 50-500km | LON1↔MAN1, FRA1↔MUC1, PAR1↔LYO1 |
| Long-Haul | Cross-border, 500-2000km | LON1↔FRA1, AMS1↔PAR1, FRA1↔WAW1 |
| Intercontinental | >2000km | LON1↔ASH1, FRA1↔SIN1, MRS1↔DXB1 |

| Capacity | Protection | Metro MRC | Regional MRC | Long-Haul MRC | Intercontinental MRC |
|----------|-----------|-----------|-------------|---------------|---------------------|
| 10G | Unprotected | 500.00 | 1,200.00 | 2,500.00 | 6,000.00 |
| 10G | Protected 1+1 | 850.00 | 2,000.00 | 4,200.00 | 10,000.00 |
| 100G | Unprotected | 1,500.00 | 3,500.00 | 7,000.00 | 18,000.00 |
| 100G | Protected 1+1 | 2,500.00 | 5,800.00 | 11,500.00 | 30,000.00 |
| 400G | Unprotected | 4,000.00 | 9,000.00 | 18,000.00 | 45,000.00 |
| 400G | Protected 1+1 | 6,500.00 | 14,500.00 | 29,000.00 | 72,000.00 |

Unmanaged wavelength discount: 15% off managed MRC (customer provides optics).

| Charge | NRC Amount |
|--------|-----------|
| Installation (10G) | 500.00 |
| Installation (100G) | 1,000.00 |
| Installation (400G) | 2,000.00 |
| Cross-Connect (per end) | 250.00 |

### Contract Term Discounts

| Term | Discount vs 1yr |
|------|-----------------|
| 1 year | 0% (list price) |
| 3 year | 12% |
| 5 year | 20% |


## 3. Ethernet (EPL / EVPL / E-LAN)

Layer 2 Carrier Ethernet services conforming to MEF standards.

**Configurable Attributes:**

| Attribute | Type | Options / Constraints |
|-----------|------|----------------------|
| `service_type` | select | EPL (point-to-point dedicated), EVPL (point-to-point virtual), E-LAN (multipoint) |
| `a_end_location` | reference | PoP or address |
| `z_end_location` | reference | PoP or address (for EPL/EVPL). Multiple for E-LAN. |
| `a_end_port_speed` | select | 1GE, 10GE, 100GE |
| `z_end_port_speed` | select | 1GE, 10GE, 100GE |
| `cir_bandwidth` | select | 10M, 50M, 100M, 200M, 500M, 1G, 2G, 5G, 10G, 100G |
| `qos_class` | select | standard (best-effort), business (assured forwarding), premium (real-time) |
| `sla_tier` | select | standard, enhanced, premium |
| `contract_term` | select | 1yr, 3yr, 5yr |

**Charges:**

| Charge | Type | Model | Notes |
|--------|------|-------|-------|
| Installation | NRC | flat | Per circuit |
| A-End Port | MRC | flat | Lookup by port speed |
| Z-End Port | MRC | flat | Lookup by port speed |
| Bandwidth | MRC | flat | Lookup by CIR × route-group |
| QoS Uplift | MRC | flat | Premium/Business uplift on bandwidth charge |
| SLA Uplift | MRC | flat | Enhanced/Premium SLA uplift |
| Cross-Connect (per end) | NRC | flat | Per on-net PoP termination |
| Local Tail A-End | NRC + MRC | flat | If A-end is off-net |
| Local Tail Z-End | NRC + MRC | flat | If Z-end is off-net |

### Ethernet Port Pricing (MRC per port)

| Port Speed | MRC |
|-----------|-----|
| 1GE | 150.00 |
| 10GE | 450.00 |
| 100GE | 2,000.00 |

### Ethernet Bandwidth Pricing (MRC by CIR and route group)

| CIR | Metro | Regional | Long-Haul | Intercontinental |
|-----|-------|----------|-----------|------------------|
| 10M | 80.00 | 150.00 | 280.00 | 650.00 |
| 50M | 180.00 | 350.00 | 650.00 | 1,500.00 |
| 100M | 280.00 | 520.00 | 980.00 | 2,200.00 |
| 200M | 420.00 | 780.00 | 1,450.00 | 3,300.00 |
| 500M | 700.00 | 1,300.00 | 2,400.00 | 5,500.00 |
| 1G | 950.00 | 1,800.00 | 3,400.00 | 7,800.00 |
| 2G | 1,500.00 | 2,800.00 | 5,200.00 | 12,000.00 |
| 5G | 2,800.00 | 5,200.00 | 9,500.00 | 22,000.00 |
| 10G | 4,200.00 | 7,800.00 | 14,500.00 | 33,000.00 |
| 100G | 18,000.00 | 33,000.00 | 62,000.00 | 140,000.00 |

### QoS Uplift (% of bandwidth MRC)

| QoS Class | Uplift |
|-----------|--------|
| Standard (best-effort) | 0% |
| Business (assured forwarding) | 15% |
| Premium (real-time) | 30% |

### SLA Tiers

| SLA Tier | Availability | Latency (metro) | MTTR | Uplift (% of total MRC) |
|----------|-------------|-----------------|------|------------------------|
| Standard | 99.5% | <10ms | 8h | 0% |
| Enhanced | 99.9% | <5ms | 4h | 10% |
| Premium | 99.99% | <2ms | 2h | 25% |

### Ethernet NRC

| Charge | Amount |
|--------|--------|
| Installation (EPL/EVPL) | 500.00 |
| Installation (E-LAN, per site) | 400.00 |
| Cross-Connect (per end) | 250.00 |


## 4. IP Transit

Wholesale BGP transit — full routing table to the customer's router. Tier 1 network.

**Configurable Attributes:**

| Attribute | Type | Options / Constraints |
|-----------|------|----------------------|
| `delivery_pop` | reference | On-net PoP (Major tier only) |
| `port_size` | select | 1GE, 10GE, 100GE, 400GE |
| `committed_data_rate` | number | CDR in Mbps. Min: 100 Mbps. Max: port size. |
| `billing_model` | select | flat (fixed CDR), burstable (95th percentile) |
| `ipv6` | boolean | Include IPv6 (default: yes, no extra charge) |
| `ddos_protection` | select | none, basic (included thresholds), advanced (dedicated scrubbing) |
| `contract_term` | select | 1yr, 2yr, 3yr |

**Charges:**

| Charge | Type | Model | Notes |
|--------|------|-------|-------|
| Port Fee | MRC | flat | Lookup by port size. Waived if CDR ≥ 50% of port capacity. |
| CDR Bandwidth | MRC | tiered | Per-Mbps tiered pricing × CDR |
| Burstable Overage | Usage | per_unit | 95th percentile above CDR. Informational at quote time. |
| DDoS Advanced | MRC | flat | If advanced DDoS selected |
| Installation | NRC | flat | Per port |
| Cross-Connect | NRC | flat | Per PoP |

### IP Transit Port Pricing (MRC)

| Port Size | Port MRC | Waived When CDR ≥ |
|-----------|----------|-------------------|
| 1GE | 300.00 | 500 Mbps |
| 10GE | 800.00 | 5,000 Mbps |
| 100GE | 2,500.00 | 50,000 Mbps |
| 400GE | 6,000.00 | 200,000 Mbps |

### IP Transit Per-Mbps Pricing (MRC, tiered by committed volume)

| Tier | CDR From (Mbps) | CDR To (Mbps) | Price per Mbps |
|------|-----------------|---------------|---------------|
| 0 | 100 | 1,000 | 0.45 |
| 1 | 1,001 | 5,000 | 0.32 |
| 2 | 5,001 | 10,000 | 0.22 |
| 3 | 10,001 | 50,000 | 0.14 |
| 4 | 50,001 | 100,000 | 0.08 |
| 5 | 100,001 | ∞ | 0.05 |

### Burstable (95th Percentile) Overage Rate

Overage rate = 1.5× the applicable CDR tier rate. Charged on usage exceeding CDR.
> Example: Customer with 5,000 Mbps CDR bursts to 7,000 Mbps (95th percentile). Overage = 2,000 Mbps × (0.22 × 1.5) = 2,000 × 0.33 = EUR 660/month.

This is **informational at quote time** — actual overage depends on traffic patterns.

### DDoS Protection

| Tier | Clean BW | MRC | Notes |
|------|----------|-----|-------|
| Basic | Up to 2× CDR | Included | Automatic threshold-based mitigation |
| Advanced | Up to 10× CDR | 500.00 | Dedicated scrubbing, 24/7 SOC, custom rules |

### IP Transit NRC

| Charge | Amount |
|--------|--------|
| Installation (1GE/10GE) | 500.00 |
| Installation (100GE/400GE) | 1,500.00 |
| Cross-Connect | 250.00 |

### Contract Term Discounts

| Term | Discount vs 1yr |
|------|-----------------|
| 1 year | 0% |
| 2 year | 8% |
| 3 year | 15% |


## 5. Dedicated Internet Access (DIA)

Symmetric, dedicated internet access delivered to a customer site with SLA.

**Configurable Attributes:**

| Attribute | Type | Options / Constraints |
|-----------|------|----------------------|
| `site_location` | reference | PoP or address |
| `delivery_pop` | reference | Nearest NovaNET PoP (auto-selected or manual) |
| `bandwidth` | select | 50M, 100M, 200M, 500M, 1G, 2G, 5G, 10G |
| `sla_tier` | select | standard, enhanced, premium |
| `managed_cpe` | boolean | NovaNET-managed router |
| `cpe_model` | select | If managed: small (up to 1G), medium (up to 5G), large (up to 10G) |
| `ip_allocation` | select | /30, /29, /28, /27, /26 |
| `contract_term` | select | 1yr, 3yr, 5yr |

**Charges:**

| Charge | Type | Model | Notes |
|--------|------|-------|-------|
| Installation | NRC | flat | Per service |
| Internet Access | MRC | flat | Lookup by bandwidth |
| SLA Uplift | MRC | flat | Enhanced/Premium uplift |
| Managed CPE | MRC | flat | Per CPE model |
| IP Allocation | MRC | flat | Per block size (above /29) |
| Local Tail | NRC + MRC | flat | If site is off-net |

### DIA Bandwidth Pricing (MRC)

| Bandwidth | MRC |
|-----------|-----|
| 50M | 250.00 |
| 100M | 380.00 |
| 200M | 580.00 |
| 500M | 1,050.00 |
| 1G | 1,600.00 |
| 2G | 2,600.00 |
| 5G | 5,000.00 |
| 10G | 8,000.00 |

### Managed CPE Pricing (MRC)

| Model | Throughput | MRC |
|-------|-----------|-----|
| Small | Up to 1G | 45.00 |
| Medium | Up to 5G | 95.00 |
| Large | Up to 10G | 180.00 |

### IP Allocation (MRC, for blocks larger than /30)

| Block | Addresses | MRC |
|-------|-----------|-----|
| /30 | 4 | Included |
| /29 | 8 | 10.00 |
| /28 | 16 | 25.00 |
| /27 | 32 | 50.00 |
| /26 | 64 | 100.00 |

### DIA NRC

| Charge | Amount |
|--------|--------|
| Installation | 500.00 |
| Cross-Connect (if on-net) | 250.00 |

SLA tiers and contract term discounts follow the same tables as Ethernet.


## 6. IP VPN (MPLS)

Managed Layer 3 VPN service. **Multi-site product** — each site is independently configured with its own access parameters.

**Quote-Level Attributes:**

| Attribute | Type | Options / Constraints |
|-----------|------|----------------------|
| `vpn_topology` | select | full_mesh, hub_spoke, partial_mesh |
| `cos_profile` | select | 2_class (standard + realtime), 3_class (+ business), 4_class (+ best effort) |
| `internet_breakout` | select | central (via hub), local (per site), both |
| `contract_term` | select | 3yr, 5yr |

**Per-Site Attributes:**

| Attribute | Type | Options / Constraints |
|-----------|------|----------------------|
| `site_role` | select | hub, spoke (for hub-spoke topology) |
| `site_location` | reference | PoP or address |
| `access_speed` | select | 100M, 1G, 10G |
| `cir_bandwidth` | select | 10M, 50M, 100M, 200M, 500M, 1G, 2G, 5G, 10G |
| `managed_cpe` | boolean | NovaNET-managed router |
| `cpe_model` | select | If managed: small, medium, large |

**Per-Site Charges:**

| Charge | Type | Model | Notes |
|--------|------|-------|-------|
| Site Installation | NRC | flat | Per site |
| Access Port | MRC | flat | Lookup by access speed |
| Site Bandwidth | MRC | flat | Lookup by CIR |
| Managed CPE | MRC | flat | Per CPE model |
| Local Tail | NRC + MRC | flat | If site is off-net |

### IP VPN Access Port Pricing (MRC per site)

| Access Speed | MRC |
|-------------|-----|
| 100M | 120.00 |
| 1G | 280.00 |
| 10G | 900.00 |

### IP VPN Site Bandwidth Pricing (MRC per site)

| CIR | MRC |
|-----|-----|
| 10M | 90.00 |
| 50M | 200.00 |
| 100M | 320.00 |
| 200M | 500.00 |
| 500M | 900.00 |
| 1G | 1,400.00 |
| 2G | 2,200.00 |
| 5G | 4,000.00 |
| 10G | 6,500.00 |

### IP VPN Volume Discount (by total number of sites on the VPN)

| Sites | Discount on site MRC |
|-------|---------------------|
| 1-5 | 0% |
| 6-20 | 5% |
| 21-50 | 10% |
| 51-100 | 15% |
| 101+ | 20% |

### IP VPN NRC (per site)

| Charge | Amount |
|--------|--------|
| Site Installation | 350.00 |
| Cross-Connect (if on-net) | 250.00 |

### Contract Term Discounts

| Term | Discount |
|------|----------|
| 3 year | 0% (base) |
| 5 year | 12% |


## 7. Cloud Connect

Direct private connectivity to hyperscaler cloud platforms.

**Configurable Attributes:**

| Attribute | Type | Options / Constraints |
|-----------|------|----------------------|
| `delivery_pop` | reference | On-net PoP with cloud on-ramp presence |
| `cloud_provider` | select | AWS, Microsoft Azure, Google Cloud, Oracle Cloud |
| `cloud_region` | select | Dependent on cloud provider (filtered by PoP proximity) |
| `bandwidth` | select | 50M, 100M, 200M, 500M, 1G, 2G, 5G, 10G |
| `redundancy` | select | single, redundant (dual connections, diverse paths) |
| `contract_term` | select | 1yr, 3yr, 5yr |

**Cloud On-Ramp Availability (PoPs with cloud presence):**

| PoP | AWS Direct Connect | Azure ExpressRoute | Google Interconnect | Oracle FastConnect |
|-----|------|-------|--------|--------|
| LON1 | ✓ | ✓ | ✓ | ✓ |
| LON2 | ✓ | ✓ | ✗ | ✗ |
| FRA1 | ✓ | ✓ | ✓ | ✓ |
| FRA2 | ✓ | ✓ | ✓ | ✗ |
| AMS1 | ✓ | ✓ | ✓ | ✓ |
| PAR1 | ✓ | ✓ | ✓ | ✗ |
| MIL1 | ✗ | ✓ | ✗ | ✗ |
| STO1 | ✗ | ✓ | ✗ | ✗ |
| DUB1 | ✓ | ✓ | ✓ | ✗ |
| MRS1 | ✓ | ✗ | ✓ | ✗ |
| ASH1 | ✓ | ✓ | ✓ | ✓ |
| ASH2 | ✓ | ✓ | ✗ | ✗ |
| SIN1 | ✓ | ✓ | ✓ | ✓ |
| DXB1 | ✓ | ✓ | ✗ | ✗ |

**Charges:**

| Charge | Type | Model | Notes |
|--------|------|-------|-------|
| Installation | NRC | flat | Per connection |
| Cloud Port | MRC | flat | Lookup by bandwidth × cloud provider |
| Redundancy Uplift | MRC | flat | 80% of port MRC for redundant pair |
| Cross-Connect | NRC | flat | Per PoP |

### Cloud Connect Pricing (MRC by bandwidth and cloud provider)

| Bandwidth | AWS | Azure | Google | Oracle |
|-----------|-----|-------|--------|--------|
| 50M | 120.00 | 110.00 | 125.00 | 115.00 |
| 100M | 200.00 | 185.00 | 210.00 | 195.00 |
| 200M | 340.00 | 310.00 | 360.00 | 330.00 |
| 500M | 650.00 | 600.00 | 680.00 | 620.00 |
| 1G | 1,000.00 | 920.00 | 1,050.00 | 960.00 |
| 2G | 1,700.00 | 1,560.00 | 1,780.00 | 1,630.00 |
| 5G | 3,200.00 | 2,950.00 | 3,350.00 | 3,050.00 |
| 10G | 5,000.00 | 4,600.00 | 5,250.00 | 4,800.00 |

> Note: Customer additionally pays the cloud provider's own port/data transfer charges. These are informational at quote time — not included in NovaNET's quote total.

### Cloud Connect NRC

| Charge | Amount |
|--------|--------|
| Installation | 500.00 |
| Cross-Connect | 250.00 |


## 8. SD-WAN (Managed)

Managed SD-WAN overlay service. **Multi-site product** — each site is independently configured.

**Quote-Level Attributes:**

| Attribute | Type | Options / Constraints |
|-----------|------|----------------------|
| `management_model` | select | fully_managed (NovaNET operates), co_managed (shared responsibility) |
| `security_tier` | select | basic (stateful FW), advanced (NGFW + UTM), premium (SASE integration) |
| `contract_term` | select | 3yr, 5yr |

**Per-Site Attributes:**

| Attribute | Type | Options / Constraints |
|-----------|------|----------------------|
| `site_type` | select | hub, branch_small, branch_medium, branch_large, data_centre |
| `site_location` | reference | Address |
| `underlay_type` | select | dia (NovaNET DIA), broadband (customer-provided), lte (4G/5G backup) |
| `underlay_bandwidth` | select | If DIA: same as DIA bandwidth options. If broadband/LTE: informational only. |
| `secondary_underlay` | boolean | Dual-WAN (adds second link) |

**Per-Site Charges:**

| Charge | Type | Model | Notes |
|--------|------|-------|-------|
| Site Installation | NRC | flat | Shipping, provisioning, install |
| CPE Device | MRC | flat | Lookup by site type |
| SD-WAN License | MRC | flat | Per site |
| Management Fee | MRC | flat | Lookup by management model |
| Security Uplift | MRC | flat | Lookup by security tier |
| Underlay (DIA) | MRC | flat | If underlay_type = DIA, priced as per DIA product |
| LTE Backup | MRC | flat | If secondary_underlay with LTE |

### SD-WAN CPE Pricing (MRC per site)

| Site Type | CPE Model | Max Throughput | MRC |
|-----------|-----------|---------------|-----|
| Branch Small | Edge 100 | 250 Mbps | 35.00 |
| Branch Medium | Edge 500 | 1 Gbps | 75.00 |
| Branch Large | Edge 1000 | 5 Gbps | 150.00 |
| Hub | Edge 2000 | 10 Gbps | 280.00 |
| Data Centre | Edge DC | 20 Gbps | 450.00 |

### SD-WAN License (MRC per site)

| Fee | MRC |
|-----|-----|
| SD-WAN License | 25.00 |

### SD-WAN Management Fee (MRC per site)

| Model | MRC |
|-------|-----|
| Fully Managed | 80.00 |
| Co-Managed | 45.00 |

### SD-WAN Security Uplift (MRC per site)

| Tier | MRC |
|------|-----|
| Basic (Stateful FW) | 0.00 (included) |
| Advanced (NGFW + UTM) | 30.00 |
| Premium (SASE) | 65.00 |

### SD-WAN Other Charges

| Charge | Type | Amount |
|--------|------|--------|
| Site Installation (branch) | NRC | 350.00 |
| Site Installation (hub/DC) | NRC | 750.00 |
| LTE Backup Module | MRC | 25.00 |

### SD-WAN Volume Discount

Same volume discount table as IP VPN (by total site count).


## 9. DDoS Protection (Standalone)

Standalone DDoS mitigation service (not bundled with IP Transit).

**Configurable Attributes:**

| Attribute | Type | Options / Constraints |
|-----------|------|----------------------|
| `delivery_pop` | reference | On-net PoP (Major tier only) |
| `protection_mode` | select | always_on (inline scrubbing), on_demand (diversion on attack) |
| `clean_bandwidth` | select | 1G, 5G, 10G, 50G, 100G |
| `protected_prefixes` | number | Number of IP prefixes protected. Min: 1, Max: 50. |
| `contract_term` | select | 1yr, 3yr |

**Charges:**

| Charge | Type | Model | Notes |
|--------|------|-------|-------|
| Installation | NRC | flat | Setup, BGP config, tuning |
| Clean Bandwidth | MRC | flat | Lookup by tier and mode |
| Additional Prefixes | MRC | per_unit | Per prefix above included allowance |

### DDoS Pricing (MRC by clean bandwidth and mode)

| Clean BW | Always-On MRC | On-Demand MRC |
|----------|--------------|--------------|
| 1G | 800.00 | 400.00 |
| 5G | 2,500.00 | 1,200.00 |
| 10G | 4,000.00 | 2,000.00 |
| 50G | 12,000.00 | 6,000.00 |
| 100G | 20,000.00 | 10,000.00 |

Included prefixes: 5 per service. Additional: EUR 25.00/prefix/month.

### DDoS NRC

| Charge | Amount |
|--------|--------|
| Installation (1G-10G) | 500.00 |
| Installation (50G-100G) | 1,500.00 |


## 10. Colocation

Rack space, power, and cross-connects in NovaNET PoP data centres.

**Configurable Attributes:**

| Attribute | Type | Options / Constraints |
|-----------|------|----------------------|
| `data_centre` | reference | On-net PoP (with colo availability) |
| `space_type` | select | quarter_rack (10U), half_rack (21U), full_rack (42U), cage |
| `power_kw` | number | Committed power in kW. Min: 1, Max: 20 per rack. |
| `power_redundancy` | select | N (single feed), N_plus_1 (redundant), two_N (fully redundant) |
| `cross_connects` | number | Number of fibre cross-connects. Min: 0. |
| `remote_hands_hours` | number | Included monthly remote hands hours. Min: 0. |
| `contract_term` | select | 1yr, 3yr, 5yr |

**Charges:**

| Charge | Type | Model | Notes |
|--------|------|-------|-------|
| Rack Installation | NRC | flat | Per space unit |
| Rack Space | MRC | flat | Lookup by space type × DC location tier |
| Power | MRC | per_unit | Per kW × power redundancy |
| Cross-Connects | MRC | per_unit | Per cross-connect |
| Remote Hands | MRC | per_unit | Per hour included |

### Colocation Space Pricing (MRC by space type and DC tier)

DC Location Tiers:

| Tier | PoPs | Description |
|------|------|-------------|
| Tier 1 (Premium) | LON1, LON2, FRA1, FRA2, AMS1, PAR1, ASH1, SIN1 | High-demand locations |
| Tier 2 (Standard) | All other PoPs | Standard locations |

| Space Type | Tier 1 MRC | Tier 2 MRC |
|-----------|-----------|-----------|
| Quarter Rack (10U) | 350.00 | 250.00 |
| Half Rack (21U) | 600.00 | 430.00 |
| Full Rack (42U) | 1,000.00 | 720.00 |
| Cage (per m²) | 250.00/m² | 180.00/m² |

### Power Pricing (MRC per kW)

| Redundancy | MRC per kW |
|-----------|-----------|
| N (single) | 120.00 |
| N+1 (redundant) | 155.00 |
| 2N (fully redundant) | 195.00 |

### Other Colocation Charges

| Charge | Type | Amount |
|--------|------|--------|
| Cross-Connect (fibre, per cc) | MRC | 150.00 |
| Cross-Connect (copper, per cc) | MRC | 100.00 |
| Remote Hands (per hour included) | MRC | 90.00 |
| Remote Hands (ad-hoc, per hour) | Usage | 120.00 |
| Rack Installation (quarter/half) | NRC | 350.00 |
| Rack Installation (full) | NRC | 500.00 |
| Cage Build-Out | NRC | Custom |


# Quoting Journey

## Standard Flow (Point-to-Point and Single-Site Products)

1. **Select Customer** — Select existing customer or create new.

2. **Select Products** — Choose one or more products to quote. Multiple products can be on a single quote. Products: Dark Fibre, Wavelengths, Ethernet, IP Transit, DIA, IP VPN, Cloud Connect, SD-WAN, DDoS Protection, Colocation.

3. **Select Contract Term** — Choose contract duration. Available terms vary by product. Longer terms apply automatic discounts.

4. **Configure Locations** — For each product:
   - Specify A-end and Z-end locations (or single site for DIA, IP Transit, Colocation, DDoS).
   - For on-net PoPs: select from PoP list.
   - For off-net locations: enter address. System identifies nearest PoP and flags local tail requirement.
   - System calculates route group (metro/regional/long-haul/intercontinental) based on endpoint PoPs.

5. **Configure Product Parameters** — Per product: select capacity/bandwidth, protection, QoS, SLA, add-ons, etc. (attributes per product as defined above).

6. **Review & Price** — System calculates:
   - NRC: installation, cross-connects, local tail setup.
   - MRC: service charges, port fees, SLA/QoS uplifts, local tail recurring, managed CPE.
   - Usage: burstable overage (informational), ad-hoc charges.
   - Term discounts applied.
   - Margin calculated (selling price vs. internal cost including supplier tail costs).

## Multi-Site Flow (IP VPN, SD-WAN)

1. **Select Customer** — Same as standard.
2. **Select Product** — IP VPN or SD-WAN.
3. **Select Quote-Level Parameters** — Topology, CoS profile, management model, security tier, contract term.
4. **Add Sites** — Two options:
   - **Manual**: Add sites one by one. Per site: enter location, select access speed, bandwidth, CPE options.
   - **CSV Upload**: Upload a spreadsheet of sites with columns: site name, address, city, country, access speed, CIR bandwidth, CPE option. System parses, validates, and identifies on-net/off-net status per site.
5. **Review Sites** — Table view of all sites with:
   - On-net / off-net status per site
   - Estimated local tail cost for off-net sites
   - Per-site MRC and NRC breakdown
   - Volume discount tier applied based on total site count
6. **Review & Price** — Aggregate quote with total NRC, total MRC, per-site breakdown, volume discount, and margin analysis.


# Business Rules

### Rule 1: Route Group Classification
PoP-to-PoP routes must be automatically classified into route groups (metro, regional, long-haul, intercontinental) based on the distance or pre-defined route group mapping between PoP pairs. This classification drives pricing table lookups for wavelengths and Ethernet.

### Rule 2: Off-Net Local Tail Detection
When a customer specifies a location that is not an on-net PoP, the system must:
1. Identify the nearest on-net PoP (or let the user select one).
2. Flag the endpoint as off-net.
3. Look up estimated local tail costs from the supplier price list (by country, bandwidth).
4. Add local tail NRC + MRC charges to the quote.
5. If no supplier pricing exists for that location, flag "requires survey" with country-level estimates.

### Rule 3: Wavelength PoP-to-PoP Only
Wavelength services are only available between on-net PoPs (no off-net endpoints). The location selection must be restricted to the PoP list.

### Rule 4: IP Transit — Major PoPs Only
IP Transit is only available at Major-tier PoPs (12 PoPs). The delivery PoP selection must be filtered accordingly.

### Rule 5: Cloud On-Ramp Availability
Cloud Connect must filter available cloud providers based on the selected delivery PoP. Not all PoPs have on-ramps for all cloud providers (see Cloud On-Ramp Availability table).

### Rule 6: Port Fee Waiver (IP Transit)
IP Transit port MRC is waived when the committed data rate (CDR) reaches or exceeds 50% of the port capacity. The system must automatically detect this and zero-out the port charge.

### Rule 7: Bandwidth Cannot Exceed Port Speed
For Ethernet and IP Transit, the selected CIR bandwidth cannot exceed the port speed. The bandwidth selector must be constrained by the port speed selection.

### Rule 8: CIR Cannot Exceed Access Speed (IP VPN)
For IP VPN sites, the CIR bandwidth cannot exceed the access speed.

### Rule 9: Multi-Site Volume Discount
For IP VPN and SD-WAN, a volume discount applies based on the total number of sites. The discount is applied to all per-site MRC charges uniformly.

### Rule 10: Dark Fibre Commercial Model → Term Options
If `commercial_model = lease`, available terms are 3yr, 5yr, 10yr. If `commercial_model = iru`, available terms are 15yr, 20yr, 25yr. The term selector must update based on commercial model.

### Rule 11: DDoS — Major PoPs Only
Standalone DDoS Protection is only available at Major-tier PoPs.

### Rule 12: Colocation Availability
Not all PoPs offer colocation. Colocation is available at a defined subset of PoPs (typically larger facilities). The data centre selector must be filtered accordingly.

### Rule 13: CPE Model Throughput Validation (SD-WAN)
The selected CPE model must support the required throughput. If the underlay bandwidth exceeds the CPE model's max throughput, the system must flag a warning and suggest upgrading.

### Rule 14: Contract Term Discount Application
Contract term discounts apply as a percentage reduction on MRC charges. The discount percentage varies by product (see individual product term discount tables). NRC charges are not discounted.

### Rule 15: CSV Site Validation (Mass Quoting)
When sites are uploaded via CSV for IP VPN / SD-WAN:
1. Validate required fields (site name, address, country, bandwidth).
2. Attempt on-net PoP matching for each site address.
3. Flag off-net sites and estimate local tail costs.
4. Report validation errors (missing fields, invalid bandwidth values, unknown countries) before proceeding.


# Specification / Design

1. **Standard Quote / Order objects** — Use `SalesQuote` / `SalesQuoteLine` from Open Mercato. CPQ extends via companion entities.

2. **Location model as first-class entity** — PoPs and route groups need their own entities (similar to GIX data centres but more complex). A `CpqPoP` entity with city, country, tier, coordinates. A `CpqRouteGroup` mapping or calculation between PoP pairs.

3. **Circuit segmentation** — A quote item for a point-to-point product (Dark Fibre, Wavelength, Ethernet) should decompose into segments: backbone (PoP-to-PoP) + optional local tails (per off-net end). Each segment generates its own charge lines. The backbone segment prices from the product's pricing table; local tail segments price from the supplier price list.

4. **Multi-site products** — IP VPN and SD-WAN are fundamentally different from point-to-point products. A single quote item represents the VPN/SD-WAN service, but it contains N site configurations. Each site generates its own set of charge lines. Quote-level attributes (topology, contract term) apply across all sites. Per-site charges are aggregated with volume discount.

5. **Mass quoting / CSV import** — The quoting wizard should support CSV upload for multi-site products. The system parses, validates, performs on-net/off-net detection, and creates site configurations. This extends the workflow domain with a `csv_upload` step type.

6. **Supplier cost model** — Local tail costs from supplier price lists represent the **cost** to NovaNET, not the selling price. The selling price includes a markup (configurable, default 20%). This feeds into the Cost Domain for margin calculation. The supplier price list is a separate pricing table used for cost, not for customer-facing pricing.

7. **Route group as pricing dimension** — Rather than pricing every PoP pair individually, route groups (metro/regional/long-haul/intercontinental) serve as the pricing dimension. The system must resolve the route group for any PoP pair — either from a pre-defined mapping table or a distance-based calculation.

8. **Burstable billing (IP Transit)** — The 95th percentile overage charge is informational at quote time (same pattern as GIX Cloud Connect burstable). Quote displays the overage rate; actual usage charges are calculated post-delivery.

9. **Conditional charges** — Several charges are conditional on configuration: port fee waiver (IP Transit CDR threshold), local tail (off-net only), DDoS add-on, managed CPE, redundancy uplift. These use the applicability condition mechanism.

10. **Product availability rules** — Several products are restricted by PoP tier (IP Transit, DDoS = Major only), cloud provider availability, or colocation availability. These are eligibility rules bound to the respective products.

11. **The implementation should be generic** — Not tied to NovaNET specifically. PoPs, route groups, supplier price lists, and product configurations are seed data. The CPQ engine handles any carrier with different PoP footprints and pricing.
