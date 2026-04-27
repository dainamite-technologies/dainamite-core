# CPQ Requirements Specification — CPaaS Provider
This file outlines requirements and specification for the CPQ module based on a CPaaS (Communications Platform as a Service) use case.


# Use Case Description
The objective is to model a CPaaS provider's quoting domain — a company that sells communications APIs to developers and enterprises.

Our CPaaS provider — **Nexio Communications** — offers programmable communications APIs that customers integrate into their applications. Nexio operates globally and supports messaging, voice, and video capabilities across 30 countries.

## Target Markets (Countries)

Nexio supports the following 30 countries for its services:

| # | Country | ISO Code |
|---|---------|----------|
| 1 | United States | US |
| 2 | United Kingdom | GB |
| 3 | Canada | CA |
| 4 | Germany | DE |
| 5 | France | FR |
| 6 | Spain | ES |
| 7 | Poland | PL |
| 8 | Sweden | SE |
| 9 | Netherlands | NL |
| 10 | Italy | IT |
| 11 | Ireland | IE |
| 12 | Belgium | BE |
| 13 | Switzerland | CH |
| 14 | Austria | AT |
| 15 | Portugal | PT |
| 16 | Norway | NO |
| 17 | Denmark | DK |
| 18 | Finland | FI |
| 19 | Australia | AU |
| 20 | New Zealand | NZ |
| 21 | Japan | JP |
| 22 | South Korea | KR |
| 23 | Singapore | SG |
| 24 | India | IN |
| 25 | Brazil | BR |
| 26 | Mexico | MX |
| 27 | South Africa | ZA |
| 28 | United Arab Emirates | AE |
| 29 | Saudi Arabia | SA |
| 30 | Israel | IL |


## Products

Nexio offers the following products:

- **Nexio SMS API** — Programmable SMS sending and receiving. Supports outbound (application-to-person) and inbound (person-to-application) messaging. Priced per message with rates varying by origin country, destination country, and direction (inbound/outbound). Volume tiers apply.

- **Nexio Messaging API** — Multi-channel messaging platform supporting WhatsApp, Viber, and Facebook Messenger. Each channel has its own pricing structure. WhatsApp has a composite fee: channel fee (passed through from Meta) + Nexio platform fee. Priced per message.

- **Nexio Voice API** — Programmable voice calls — inbound and outbound. Supports PSTN and SIP connectivity. Priced per minute (billed per second) with rates varying by direction, origin/destination country, and connection type. SIP outbound does not require a phone number.

- **Nexio Video API** — Programmable video sessions. Priced per participant per minute. Supports add-ons: archiving (SD/HD/Full HD), live captions, and live streaming (RTMP). Add-ons are priced as separate per-minute charges.

- **Nexio Phone Numbers** — Virtual phone number rental. Required for inbound SMS and inbound Voice. Available number types: geographic (local), mobile, toll-free, short code. Priced as a monthly recurring rental per number. Not all number types are available in all countries.

- **Nexio Verify API** *(optional)* — Two-factor authentication API. Priced per successful verification. Rates vary by country and verification channel (SMS, Voice, WhatsApp).


## Product Relationships

```
Nexio Phone Numbers ←── required for inbound ──→ Nexio SMS API (inbound)
Nexio Phone Numbers ←── required for inbound ──→ Nexio Voice API (inbound)
Nexio SMS API ←── independent ──→ Nexio Voice API
Nexio Messaging API ←── independent ──→ Nexio SMS API
Nexio Video API ←── fully independent ──→ (no dependencies)
```

- Phone Numbers are a **standalone** product but are a **prerequisite** for inbound SMS and inbound Voice.
- All API products are standalone — they can be purchased independently.
- A single quote can contain multiple products (e.g., SMS API + Voice API + Phone Numbers).
- **US 10DLC compliance**: Purchasing a **mobile** number in the **United States** requires 10DLC Brand Registration and Campaign Registration (one-time setup charges).


# Pricing

## Pricing Models

All products support two contract models:

| Model | Code | Description |
|-------|------|-------------|
| **Pay-As-You-Go (PAYG)** | `payg` | No commitment. Standard list prices. Month-to-month. |
| **Commitment Contract** | `commit` | 12 or 24 month term. Customer commits to a minimum monthly spend. Lower per-unit rates. |

Commitment contract terms:

| Term | Code | Discount vs PAYG |
|------|------|-------------------|
| 12 months | `commit_12` | ~10% discount on per-unit rates |
| 24 months | `commit_24` | ~18% discount on per-unit rates |

Minimum monthly spend for commitment contracts: $500/month.


## Nexio SMS API Pricing

SMS pricing varies by direction and country combination. Tiered volume discounts apply to monthly message volume (across all countries combined).

### Volume Tiers

| Tier | Range From | Range To | Tier Discount |
|------|-----------|----------|---------------|
| 0 | 0 | 10,000 | 0% (list price) |
| 1 | 10,001 | 100,000 | 5% |
| 2 | 100,001 | 500,000 | 12% |
| 3 | 500,001 | 2,000,000 | 20% |
| 4 | 2,000,001 | ∞ | 28% |

### Outbound SMS Rates (PAYG, per message)

| Origin | Destination | Price per SMS |
|--------|-------------|-------------|
| US | US | 0.0068 |
| US | CA | 0.0072 |
| US | GB | 0.0340 |
| US | DE | 0.0520 |
| US | FR | 0.0490 |
| US | ES | 0.0470 |
| US | PL | 0.0380 |
| US | SE | 0.0440 |
| US | NL | 0.0460 |
| US | IT | 0.0510 |
| US | IE | 0.0350 |
| US | BE | 0.0480 |
| US | CH | 0.0450 |
| US | AT | 0.0500 |
| US | PT | 0.0430 |
| US | NO | 0.0420 |
| US | DK | 0.0410 |
| US | FI | 0.0440 |
| US | AU | 0.0390 |
| US | NZ | 0.0420 |
| US | JP | 0.0650 |
| US | KR | 0.0580 |
| US | SG | 0.0310 |
| US | IN | 0.0085 |
| US | BR | 0.0250 |
| US | MX | 0.0180 |
| US | ZA | 0.0220 |
| US | AE | 0.0280 |
| US | SA | 0.0350 |
| US | IL | 0.0320 |
| GB | US | 0.0350 |
| GB | GB | 0.0420 |
| GB | CA | 0.0380 |
| GB | DE | 0.0280 |
| GB | FR | 0.0260 |
| GB | ES | 0.0300 |
| GB | PL | 0.0250 |
| GB | SE | 0.0310 |
| GB | NL | 0.0270 |
| GB | IT | 0.0320 |
| GB | IE | 0.0240 |
| GB | AU | 0.0410 |
| GB | IN | 0.0090 |
| GB | SG | 0.0330 |
| DE | US | 0.0520 |
| DE | GB | 0.0290 |
| DE | DE | 0.0390 |
| DE | FR | 0.0270 |
| DE | PL | 0.0230 |
| DE | NL | 0.0250 |
| DE | AT | 0.0220 |
| DE | CH | 0.0260 |
| CA | US | 0.0070 |
| CA | CA | 0.0065 |
| CA | GB | 0.0360 |
| FR | US | 0.0490 |
| FR | FR | 0.0380 |
| FR | GB | 0.0280 |
| FR | DE | 0.0270 |
| FR | ES | 0.0290 |
| FR | BE | 0.0250 |
| PL | US | 0.0380 |
| PL | PL | 0.0280 |
| PL | GB | 0.0260 |
| PL | DE | 0.0230 |
| AU | US | 0.0400 |
| AU | AU | 0.0350 |
| AU | GB | 0.0420 |
| AU | NZ | 0.0280 |
| AU | SG | 0.0310 |
| AU | IN | 0.0095 |
| AU | JP | 0.0620 |
| IN | US | 0.0085 |
| IN | IN | 0.0025 |
| IN | GB | 0.0090 |
| SG | US | 0.0320 |
| SG | SG | 0.0180 |
| SG | AU | 0.0310 |
| SG | IN | 0.0070 |
| SG | JP | 0.0550 |
| BR | US | 0.0260 |
| BR | BR | 0.0190 |

### Inbound SMS Rates (PAYG, per message)

| Destination (receiving country) | Price per SMS |
|--------------------------------|-------------|
| US | 0.0057 |
| GB | 0.0062 |
| CA | 0.0055 |
| DE | 0.0075 |
| FR | 0.0072 |
| ES | 0.0068 |
| PL | 0.0058 |
| SE | 0.0070 |
| NL | 0.0065 |
| IT | 0.0078 |
| IE | 0.0060 |
| BE | 0.0073 |
| CH | 0.0082 |
| AT | 0.0076 |
| PT | 0.0064 |
| NO | 0.0071 |
| DK | 0.0069 |
| FI | 0.0070 |
| AU | 0.0080 |
| NZ | 0.0085 |
| JP | 0.0095 |
| KR | 0.0088 |
| SG | 0.0060 |
| IN | 0.0025 |
| BR | 0.0045 |
| MX | 0.0042 |
| ZA | 0.0038 |
| AE | 0.0055 |
| SA | 0.0058 |
| IL | 0.0052 |


## Nexio Messaging API Pricing

Messaging API has a composite pricing structure: **channel fee + Nexio platform fee** per message.

### Nexio Platform Fee

Flat fee applied on top of every message regardless of channel:

| Fee Type | Price per message |
|----------|------------------|
| Nexio Platform Fee | 0.0004 |

### WhatsApp Channel Fees (per message, by message category and region)

| Region | Utility | Authentication | Marketing | Service |
|--------|---------|---------------|-----------|---------|
| North America | 0.0147 | 0.0135 | 0.0250 | 0.0088 |
| Western Europe | 0.0180 | 0.0165 | 0.0350 | 0.0102 |
| Central & Eastern Europe | 0.0153 | 0.0140 | 0.0280 | 0.0090 |
| Asia Pacific | 0.0110 | 0.0100 | 0.0190 | 0.0070 |
| Latin America | 0.0095 | 0.0087 | 0.0165 | 0.0060 |
| Middle East & Africa | 0.0120 | 0.0110 | 0.0210 | 0.0078 |
| Rest of World | 0.0130 | 0.0120 | 0.0230 | 0.0085 |

Country-to-region mapping:

| Region | Countries |
|--------|-----------|
| North America | US, CA |
| Western Europe | GB, DE, FR, ES, NL, IT, IE, BE, CH, AT, PT, SE, NO, DK, FI |
| Central & Eastern Europe | PL |
| Asia Pacific | AU, NZ, JP, KR, SG, IN |
| Latin America | BR, MX |
| Middle East & Africa | ZA, AE, SA, IL |

### Viber Channel Fees (per message)

| Region | Transactional | Promotional |
|--------|--------------|-------------|
| Europe | 0.0200 | 0.0350 |
| Asia Pacific | 0.0150 | 0.0280 |
| Americas | 0.0180 | 0.0320 |
| Middle East & Africa | 0.0170 | 0.0300 |

### Facebook Messenger Fees (per message)

| Fee Type | Price per message |
|----------|------------------|
| Standard message | 0.0080 |
| Template message | 0.0120 |

(Facebook Messenger pricing is global — no regional variation.)


## Nexio Voice API Pricing

Voice is priced per minute, billed per second. Rates vary by direction, country pair, and connection type.

### Outbound Voice Rates (PAYG, per minute, PSTN)

| Origin | Destination | Price per minute |
|--------|-------------|-----------------|
| US | US | 0.0100 |
| US | CA | 0.0120 |
| US | GB | 0.0150 |
| US | DE | 0.0180 |
| US | FR | 0.0170 |
| US | ES | 0.0190 |
| US | PL | 0.0220 |
| US | SE | 0.0200 |
| US | NL | 0.0160 |
| US | IT | 0.0210 |
| US | IE | 0.0140 |
| US | AU | 0.0250 |
| US | JP | 0.0420 |
| US | SG | 0.0280 |
| US | IN | 0.0180 |
| US | BR | 0.0350 |
| US | MX | 0.0220 |
| US | AE | 0.0380 |
| US | IL | 0.0290 |
| GB | US | 0.0155 |
| GB | GB | 0.0120 |
| GB | DE | 0.0140 |
| GB | FR | 0.0135 |
| GB | IE | 0.0100 |
| GB | AU | 0.0260 |
| GB | IN | 0.0190 |
| DE | US | 0.0185 |
| DE | DE | 0.0110 |
| DE | GB | 0.0145 |
| DE | FR | 0.0130 |
| DE | PL | 0.0170 |
| DE | AT | 0.0105 |
| DE | CH | 0.0125 |
| CA | US | 0.0105 |
| CA | CA | 0.0095 |
| CA | GB | 0.0160 |
| AU | US | 0.0260 |
| AU | AU | 0.0140 |
| AU | NZ | 0.0180 |
| AU | SG | 0.0250 |
| AU | JP | 0.0400 |
| IN | US | 0.0180 |
| IN | IN | 0.0060 |
| IN | GB | 0.0195 |
| SG | US | 0.0290 |
| SG | SG | 0.0080 |
| SG | AU | 0.0260 |

### Inbound Voice Rates (PAYG, per minute)

| Receiving Country | Price per minute |
|-------------------|-----------------|
| US | 0.0100 |
| GB | 0.0120 |
| CA | 0.0095 |
| DE | 0.0140 |
| FR | 0.0135 |
| ES | 0.0150 |
| PL | 0.0120 |
| SE | 0.0145 |
| NL | 0.0130 |
| IT | 0.0155 |
| IE | 0.0110 |
| AU | 0.0160 |
| JP | 0.0200 |
| SG | 0.0140 |
| IN | 0.0060 |
| BR | 0.0170 |

### SIP Outbound Rates

SIP outbound rates are **identical to PSTN outbound rates**. No phone number is required for SIP outbound.


## Nexio Video API Pricing

Video is priced per participant per minute.

### Base Rate

| Charge | Price per participant-minute |
|--------|----------------------------|
| Video session | 0.0040 |

### Add-On Charges (per minute)

| Add-On | Code | Price per minute | Notes |
|--------|------|-----------------|-------|
| SD Archiving | `archive_sd` | 0.0250 | Per session-minute of recording |
| HD Archiving | `archive_hd` | 0.0350 | Per session-minute of recording |
| Full HD Archiving | `archive_fullhd` | 0.0450 | Per session-minute of recording |
| Live Captions | `captions` | 0.0200 | Per audio stream per minute |
| Live Streaming (RTMP) | `livestream` | 0.0040 | Per participant-minute |

### Volume Tiers (participant-minutes per month)

| Tier | Range From | Range To | Price per participant-minute |
|------|-----------|----------|----------------------------|
| 0 | 0 | 5,000 | 0.0040 |
| 1 | 5,001 | 50,000 | 0.0038 |
| 2 | 50,001 | 200,000 | 0.0034 |
| 3 | 200,001 | ∞ | 0.0030 |


## Nexio Phone Numbers Pricing

Phone numbers are billed as a monthly recurring charge (MRC) per number. Some number types have a one-time setup fee (NRC).

### Number Availability by Country

| Country | Geographic | Mobile | Toll-Free | Short Code |
|---------|-----------|--------|-----------|------------|
| US | ✓ | ✓ | ✓ | ✓ |
| GB | ✓ | ✓ | ✓ | ✗ |
| CA | ✓ | ✓ | ✓ | ✗ |
| DE | ✓ | ✓ | ✓ | ✗ |
| FR | ✓ | ✓ | ✗ | ✗ |
| ES | ✓ | ✓ | ✗ | ✗ |
| PL | ✓ | ✓ | ✗ | ✗ |
| SE | ✓ | ✗ | ✓ | ✗ |
| NL | ✓ | ✓ | ✓ | ✗ |
| IT | ✓ | ✓ | ✗ | ✗ |
| IE | ✓ | ✗ | ✓ | ✗ |
| BE | ✓ | ✗ | ✗ | ✗ |
| CH | ✓ | ✗ | ✗ | ✗ |
| AT | ✓ | ✗ | ✗ | ✗ |
| PT | ✓ | ✗ | ✗ | ✗ |
| NO | ✓ | ✗ | ✓ | ✗ |
| DK | ✓ | ✗ | ✗ | ✗ |
| FI | ✓ | ✗ | ✗ | ✗ |
| AU | ✓ | ✓ | ✓ | ✗ |
| NZ | ✓ | ✗ | ✓ | ✗ |
| JP | ✓ | ✗ | ✓ | ✗ |
| KR | ✓ | ✗ | ✗ | ✗ |
| SG | ✓ | ✗ | ✗ | ✗ |
| IN | ✓ | ✗ | ✓ | ✗ |
| BR | ✓ | ✓ | ✗ | ✗ |
| MX | ✓ | ✓ | ✓ | ✗ |
| ZA | ✓ | ✗ | ✗ | ✗ |
| AE | ✓ | ✗ | ✗ | ✗ |
| SA | ✗ | ✗ | ✗ | ✗ |
| IL | ✓ | ✗ | ✗ | ✗ |

### Number Rental Pricing (per number, per month)

| Number Type | Setup Fee (NRC) | Monthly Rental (MRC) |
|------------|----------------|---------------------|
| Geographic | 0.00 | 1.00 |
| Mobile | 0.00 | 1.50 |
| Toll-Free | 5.00 | 3.50 |
| Short Code (US) | 1,000.00 | 1,000.00 |

### US 10DLC Compliance Charges

Purchasing a **mobile** number in the **United States** requires 10DLC registration:

| Charge | Type | Amount | Notes |
|--------|------|--------|-------|
| Brand Registration | NRC | 4.00 | One-time per brand |
| Brand Vetting | NRC | 40.00 | One-time, optional enhanced vetting |
| Campaign Registration | NRC | 15.00 | One-time per campaign |
| Monthly Campaign Fee | MRC | 10.00 | Per registered campaign |

### Carrier Surcharges (US 10DLC, per SMS)

| Carrier | Registered | Unregistered |
|---------|-----------|-------------|
| AT&T | 0.0020 | 0.0400 |
| T-Mobile | 0.0030 | 0.0040 |
| Verizon | 0.0025 | 0.0035 |

> Note: Carrier surcharges are pass-through costs added on top of SMS API pricing for US mobile numbers. They are informational at quote time — actual charges depend on destination carrier mix.


## Nexio Verify API Pricing (Optional)

| Country | SMS Verification | Voice Verification | WhatsApp Verification |
|---------|-----------------|-------------------|----------------------|
| US | 0.0530 | 0.0710 | 0.0450 |
| GB | 0.0580 | 0.0780 | 0.0490 |
| CA | 0.0520 | 0.0700 | 0.0440 |
| DE | 0.0640 | 0.0850 | 0.0540 |
| FR | 0.0610 | 0.0820 | 0.0520 |
| ES | 0.0570 | 0.0760 | 0.0480 |
| PL | 0.0480 | 0.0640 | 0.0400 |
| AU | 0.0620 | 0.0830 | 0.0530 |
| IN | 0.0250 | 0.0340 | 0.0210 |
| BR | 0.0420 | 0.0560 | 0.0350 |
| SG | 0.0500 | 0.0670 | 0.0420 |
| JP | 0.0750 | 0.1000 | 0.0630 |


# Quoting Journey

1. **Select Customer** — Quoting journey begins with selecting an existing customer or creating a new one.

2. **Select Products** — Customer selects which API products they want to quote: SMS API, Messaging API, Voice API, Video API, Phone Numbers, Verify API. Multiple products can be selected.

3. **Select Contract Model** — Choose between PAYG or Commitment Contract (12 or 24 months). If commitment, specify minimum monthly spend.

4. **Configure SMS API** *(if selected)*
   - Select direction(s): Outbound, Inbound, or Both
   - If **Outbound**: select origin countries and destination countries
   - If **Inbound**: select receiving countries (requires phone number in those countries)
   - Provide estimated monthly volume (messages/month) per origin-destination pair (outbound) or per country (inbound)

5. **Configure Messaging API** *(if selected)*
   - Select channels: WhatsApp, Viber, Facebook Messenger
   - For **WhatsApp**: select message categories (Utility, Authentication, Marketing, Service), select destination countries, provide estimated monthly volume per category per country
   - For **Viber**: select message types (Transactional, Promotional), select destination regions, provide estimated volume
   - For **Facebook Messenger**: select message types (Standard, Template), provide estimated volume

6. **Configure Voice API** *(if selected)*
   - Select direction(s): Outbound, Inbound, or Both
   - Select connection type: PSTN or SIP (outbound only; SIP does not require phone number)
   - If **Outbound**: select origin and destination countries
   - If **Inbound**: select receiving countries (requires phone number in those countries)
   - Provide estimated monthly volume (minutes/month) per country pair (outbound) or per country (inbound)

7. **Configure Video API** *(if selected)*
   - Provide estimated monthly participant-minutes
   - Select add-ons: archiving (SD/HD/Full HD — mutually exclusive), live captions, live streaming
   - Add-ons are priced per minute on top of base participant-minute charge

8. **Configure Phone Numbers** *(if selected or required by inbound SMS/Voice)*
   - For each inbound country selected in SMS/Voice, ensure at least one number is configured
   - Select country, number type (filtered by availability), and quantity (default: 1)
   - If **US + Mobile**: 10DLC registration charges are automatically added

9. **Configure Verify API** *(if selected)*
   - Select verification channels: SMS, Voice, WhatsApp
   - Select countries
   - Provide estimated monthly verifications per country per channel

10. **Review & Price** — System calculates all charges:
    - Per-unit usage charges with volume tier discounts applied
    - Commitment contract discounts applied if applicable
    - Phone number recurring and one-time charges
    - 10DLC compliance charges if applicable
    - Carrier surcharges listed as informational
    - Summary: total estimated MRC, total NRC, per-unit usage rates


# Business Rules

### Rule 1: Number Required for Inbound
If a customer configures **inbound SMS** or **inbound Voice** for a country, they must have a phone number in that country. The system should prompt to add a Phone Number if one isn't configured.

### Rule 2: Number Type Availability
Not all number types are available in all countries. The number type selection must be filtered based on the selected country (see Number Availability table).

### Rule 3: US 10DLC Compliance
Purchasing a **mobile** number in the **United States** requires 10DLC Brand Registration and Campaign Registration. These charges must be automatically added to the quote.

### Rule 4: Video Archiving Mutual Exclusivity
Only one archiving tier can be selected per quote: SD, HD, or Full HD. They are mutually exclusive.

### Rule 5: Commitment Contract Minimum Spend
If the commitment contract model is selected, the estimated monthly total (usage charges + recurring charges) must meet or exceed the minimum monthly spend threshold ($500/month).

### Rule 6: SIP Outbound — No Number Required
Outbound Voice via SIP does not require a phone number. The system must not enforce the number requirement for SIP outbound.

### Rule 7: Volume Tier Application
SMS and Video volume tiers apply to the **total monthly volume across all country pairs** for a product, not per individual country pair. The tier discount is applied to each unit uniformly based on the total volume tier.


# Specification / Design

1. Utilise standard Quote / Order objects from Open Mercato (`SalesQuote` / `SalesQuoteLine`).

2. Products should be modelled as **standalone** products (no parent-child hierarchy like GIX). Relationships between products (number required for inbound) are enforced via business rules, not product type.

3. The pricing model is predominantly **usage-based** — most charges are `usage` type with `per_unit` charge model. Volume tiers apply as a **pricing rule** (post-calculation discount) rather than a tiered charge model, since the tier is determined by total volume across all country pairs.

4. Pricing tables will be large (many country combinations). The pricing table structure must handle 800+ entries efficiently (e.g., SMS outbound: 30 origins × 30 destinations = 900 combinations).

5. WhatsApp's composite pricing (channel fee + platform fee) should be modelled as **two separate charges** on the same product configuration: one charge for the channel fee (lookup by region × category) and one for the platform fee (flat).

6. 10DLC compliance charges should be modelled as **conditional charges** on the Phone Numbers product — activated when country = US and number type = mobile.

7. Commitment contract discounts should be implemented as a **pricing rule** that applies a percentage discount to all usage charges based on the contract term (12 or 24 months).

8. Carrier surcharges (US 10DLC) are **informational** at quote time — displayed but not included in totals, similar to the GIX burstable overage model.

9. The implementation should be generic — not tied to Nexio specifically. The product catalog, pricing tables, and business rules are seed data for the use case.
