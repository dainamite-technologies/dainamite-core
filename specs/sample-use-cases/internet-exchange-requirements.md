# CPQ Requirements Specification
This is a file that outlines requirements and specification for CPQ module on top of Open Mercato based on some sample use-case.


# Use Case Description
The objective is to model a sample Internet Exchange operator and it's quoting domain.
Internet Exchanges are quasi-telecommunications service providers that provide interconnection points for other telecom service providers - where their networks can peer with each other.

Our Internet Exchange provider - GIX (Global IX) operates in few different markets:
- United Kindgdom (London) - key hub
- Germany (Frankfurt)
- Spain (Madrid)
- Netherlands (Amsterdam)
- United States (Ashburn)
- UAE (Dubai)
- Singapore


## Products
GIX offers several key products:
- **GIX Access Port** - a physical port that needs to be purchased at a given Data Centre (list of on-net GIX data centres below). Access Port is a prerequisite for other services. Ports can have different capacity: 1G, 10G, 100G. 
- **GIX Internet Peering** - a virtual service that can be spun on GIX Access Port, allowing to peer internet traffic. Configured with given bandwidth (in MB, can not exceed port size). Multiple services can be spun on the same port.
- **GIX Mobile Peering** - same as internet peering, but for mobile roaming traffic. Configured with given bandwidth (in MB, can not exceed port size). Mobile & Internet Peering can coexist on the same Access Port.
- **GIX Cloud Connect** - a virtual service providing direct cloud connectivity towards major Cloud Providers - AWS, GCP, MS Azure. Same as peering services, configured with given bandwidth, can coexist with other services on the same Access Port.


## Data Centres
- **London**
   - **Equinix LD5** - 8 Buckingham Avenue, Slough Trading Estate, Slough, United Kingdom, SL1 4AX
   - **Equinix LD8** - 6/7/8/9 Harbour Exchange Square, Limeharbour, London, United Kingdom, E14 9GE
   - **TELEHOUSE London Docklands (South)** - TELEHOUSE Europe - 1 Blackwall Way, E14 2EH London, United Kingdom
- **Frankfurt**
   - **Equinix FR5** - Kleyerstrasse 90, Frankfurt, Germany, 60326
   - **Digital Realty FRA8** - Weismüllerstrasse 36, 60314 Frankfurt am Main, Germany
- **Madrid**
   - **Equinix MD2** - Calle Valgrande 6, Alcobendas, Madrid, Spain, 28108
   - **Digital Realty MAD1** - Calle Albasanz 71 Madrid, 28037, Spain
- **Amsterdam**
   - **Equinix AM1** - Luttenbergweg 4, Amsterdam, Netherlands, 1101 EC
   - **Digital Realty AMS11** - Koolhovenlaan 35‑45, 1119 NB Schiphol‑Rijk
- **Ashburn**
   - **Equinix DC3** - 44470 Chilum Place, Ashburn, Virginia, United States of America, 20147
   - **Equinix DC11** - 21721 Filigree Court, Suite B, Ashburn, Virginia, United States of America, 20147
- **Dubai**
   - **Equnix DX1** - International Media Production Zone (IMPZ), Units F90, F91 & F92, Dubai, United Arab Emirates, 500389
   - **Datamena Al Salam Tower Datacenter** - Al Salam Tower, Dubai Media City, 23rd floor, 00000 Dubai, United Arab Emirates
- **Singapore**
   - **Equinix SG1** - 20 Ayer Rajah Crescent, Singapore, Singapore, 139964
   - **Digital Realty SIN10** - 29A International Business Park Jurong East, 609934


## Pricing
- GIX Access Port pricing depends on port size (1G, 10G, 100G) and data centre. There is a one-time (non-recurring -> NRC) charge and monthly recurring charge to that.
- GIX Internet Peering pricing is per MB following a tiered pricing model
- GIX Mobile Peering pricing is per MB following a tiered pricing model
- GIX Cloud Connect pricing is per MB and depends on cloud service provider and region we're connecting to. It can be purchased in either flat or burstable pricing model. For flat - price is calculated based on selected bandwidth. For burstable - customer declares a committed bandwidth fee - and overage (measured using 95 percentile) is charged on a burstable model.

Pricing tables are below:

### GIX Access Port

| Data Centre | Port Size | Setup Price (NRC) | Monthly Recurring Price (MRC) |
|-------------|-----------|-------------------|-------------------------------|
| Equinix LD5 | 1G | 290.00 | 250.00 |
| Equinix LD5 | 10G | 490.00 | 450.00 |
| Equinix LD5 | 100G | 890.00 | 1200.00 |
| Equinix LD8 | 1G | 290.00 | 265.00 |
| Equinix LD8 | 10G | 490.00 | 475.00 |
| Equinix LD8 | 100G | 890.00 | 1250.00 |
| TELEHOUSE London Docklands (South) | 1G | 290.00 | 245.00 |
| TELEHOUSE London Docklands (South) | 10G | 490.00 | 440.00 |
| TELEHOUSE London Docklands (South) | 100G | 890.00 | 1180.00 |
| Equinix FR5 | 1G | 290.00 | 220.00 |
| Equinix FR5 | 10G | 490.00 | 410.00 |
| Equinix FR5 | 100G | 890.00 | 1100.00 |
| Digital Realty FRA8 | 1G | 290.00 | 215.00 |
| Digital Realty FRA8 | 10G | 490.00 | 400.00 |
| Digital Realty FRA8 | 100G | 890.00 | 1080.00 |
| Equinix MD2 | 1G | 290.00 | 200.00 |
| Equinix MD2 | 10G | 490.00 | 380.00 |
| Equinix MD2 | 100G | 890.00 | 1050.00 |
| Digital Realty MAD1 | 1G | 290.00 | 195.00 |
| Digital Realty MAD1 | 10G | 490.00 | 370.00 |
| Digital Realty MAD1 | 100G | 890.00 | 1030.00 |
| Equinix AM1 | 1G | 290.00 | 230.00 |
| Equinix AM1 | 10G | 490.00 | 425.00 |
| Equinix AM1 | 100G | 890.00 | 1150.00 |
| Digital Realty AMS11 | 1G | 290.00 | 225.00 |
| Digital Realty AMS11 | 10G | 490.00 | 415.00 |
| Digital Realty AMS11 | 100G | 890.00 | 1130.00 |
| Equinix DC3 | 1G | 290.00 | 210.00 |
| Equinix DC3 | 10G | 490.00 | 395.00 |
| Equinix DC3 | 100G | 890.00 | 1090.00 |
| Equinix DC11 | 1G | 290.00 | 205.00 |
| Equinix DC11 | 10G | 490.00 | 385.00 |
| Equinix DC11 | 100G | 890.00 | 1070.00 |
| Equinix DX1 | 1G | 290.00 | 280.00 |
| Equinix DX1 | 10G | 490.00 | 510.00 |
| Equinix DX1 | 100G | 890.00 | 1350.00 |
| Datamena Al Salam Tower Datacenter | 1G | 290.00 | 275.00 |
| Datamena Al Salam Tower Datacenter | 10G | 490.00 | 500.00 |
| Datamena Al Salam Tower Datacenter | 100G | 890.00 | 1320.00 |
| Equinix SG1 | 1G | 290.00 | 290.00 |
| Equinix SG1 | 10G | 490.00 | 525.00 |
| Equinix SG1 | 100G | 890.00 | 1380.00 |
| Digital Realty SIN10 | 1G | 290.00 | 285.00 |
| Digital Realty SIN10 | 10G | 490.00 | 515.00 |
| Digital Realty SIN10 | 100G | 890.00 | 1360.00 |


### GIX Internet Peering Pricing

| Tier # | Range from (MB) | Range to (MB) | Price per MB |
|--------|----------------|---------------|--------------|
| 0 | 0 | 50 | 0.52 |
| 1 | 51 | 100 | 0.49 |
| 2 | 101 | 250 | 0.47 |
| 3 | 251 | 500 | 0.45 |
| 4 | 501 | 1000 | 0.43 |
| 5 | 1001 | ∞ | 0.40 | 


### GIX Mobile Peering Pricing

| Tier # | Range from (MB) | Range to (MB) | Price per MB |
|--------|----------------|---------------|--------------|
| 0 | 0 | 50 | 1.23 |
| 1 | 51 | 100 | 1.11 |
| 2 | 101 | 250 | 1.00 |
| 3 | 251 | 500 | 0.85 |
| 4 | 501 | 1000 | 0.74 |
| 5 | 1001 | ∞ | 0.63 |


### GIX Cloud Connect Pricing

| Data Center Location | Cloud Provider | Region | Flat Price per MB | Commit Price per MB | Overage Price per MB |
|---------------------|----------------|--------|-------------------|---------------------|----------------------|
| London | AWS | eu-west-2 | 0.52 | 0.46 | 0.69 |
| London | AWS | eu-west-1 | 0.53 | 0.47 | 0.70 |
| London | AWS | eu-central-1 | 0.54 | 0.48 | 0.71 |
| London | AWS | eu-south-2 | 0.55 | 0.48 | 0.73 |
| London | AWS | us-east-1 | 0.68 | 0.60 | 0.90 |
| London | AWS | us-west-2 | 0.72 | 0.63 | 0.95 |
| London | AWS | me-central-1 | 0.78 | 0.69 | 1.03 |
| London | AWS | ap-southeast-1 | 0.82 | 0.72 | 1.08 |
| London | AWS | ap-south-1 | 0.80 | 0.70 | 1.06 |
| London | AWS | ap-northeast-1 | 0.84 | 0.74 | 1.11 |
| London | GCP | europe-west2 | 0.54 | 0.48 | 0.71 |
| London | GCP | europe-west1 | 0.55 | 0.48 | 0.73 |
| London | GCP | europe-west3 | 0.56 | 0.49 | 0.74 |
| London | GCP | europe-west4 | 0.57 | 0.50 | 0.75 |
| London | GCP | us-east1 | 0.70 | 0.62 | 0.92 |
| London | GCP | us-east4 | 0.71 | 0.62 | 0.94 |
| London | GCP | us-west1 | 0.74 | 0.65 | 0.98 |
| London | GCP | me-west1 | 0.81 | 0.71 | 1.07 |
| London | GCP | asia-southeast1 | 0.85 | 0.75 | 1.12 |
| London | GCP | asia-south1 | 0.83 | 0.73 | 1.10 |
| London | MS Azure | UK South | 0.53 | 0.47 | 0.70 |
| London | MS Azure | West Europe | 0.54 | 0.48 | 0.71 |
| London | MS Azure | Germany West Central | 0.55 | 0.48 | 0.73 |
| London | MS Azure | Spain Central | 0.56 | 0.49 | 0.74 |
| London | MS Azure | East US | 0.69 | 0.61 | 0.91 |
| London | MS Azure | West US | 0.73 | 0.64 | 0.96 |
| London | MS Azure | UAE North | 0.79 | 0.70 | 1.04 |
| London | MS Azure | Southeast Asia | 0.83 | 0.73 | 1.10 |
| London | MS Azure | Central India | 0.81 | 0.71 | 1.07 |
| Frankfurt | AWS | eu-central-1 | 0.48 | 0.42 | 0.63 |
| Frankfurt | AWS | eu-west-1 | 0.50 | 0.44 | 0.66 |
| Frankfurt | AWS | eu-west-2 | 0.51 | 0.45 | 0.67 |
| Frankfurt | AWS | eu-south-2 | 0.52 | 0.46 | 0.69 |
| Frankfurt | AWS | us-east-1 | 0.64 | 0.56 | 0.84 |
| Frankfurt | AWS | us-west-2 | 0.68 | 0.60 | 0.90 |
| Frankfurt | AWS | me-central-1 | 0.74 | 0.65 | 0.98 |
| Frankfurt | AWS | ap-southeast-1 | 0.78 | 0.69 | 1.03 |
| Frankfurt | AWS | ap-south-1 | 0.76 | 0.67 | 1.00 |
| Frankfurt | AWS | ap-northeast-1 | 0.80 | 0.70 | 1.06 |
| Frankfurt | GCP | europe-west3 | 0.50 | 0.44 | 0.66 |
| Frankfurt | GCP | europe-west1 | 0.52 | 0.46 | 0.69 |
| Frankfurt | GCP | europe-west2 | 0.53 | 0.47 | 0.70 |
| Frankfurt | GCP | europe-west4 | 0.54 | 0.48 | 0.71 |
| Frankfurt | GCP | us-east1 | 0.66 | 0.58 | 0.87 |
| Frankfurt | GCP | us-east4 | 0.67 | 0.59 | 0.88 |
| Frankfurt | GCP | us-west1 | 0.70 | 0.62 | 0.92 |
| Frankfurt | GCP | me-west1 | 0.77 | 0.68 | 1.02 |
| Frankfurt | GCP | asia-southeast1 | 0.81 | 0.71 | 1.07 |
| Frankfurt | GCP | asia-south1 | 0.79 | 0.70 | 1.04 |
| Frankfurt | MS Azure | Germany West Central | 0.49 | 0.43 | 0.65 |
| Frankfurt | MS Azure | West Europe | 0.51 | 0.45 | 0.67 |
| Frankfurt | MS Azure | UK South | 0.52 | 0.46 | 0.69 |
| Frankfurt | MS Azure | Spain Central | 0.53 | 0.47 | 0.70 |
| Frankfurt | MS Azure | East US | 0.65 | 0.57 | 0.86 |
| Frankfurt | MS Azure | West US | 0.69 | 0.61 | 0.91 |
| Frankfurt | MS Azure | UAE North | 0.75 | 0.66 | 0.99 |
| Frankfurt | MS Azure | Southeast Asia | 0.79 | 0.70 | 1.04 |
| Frankfurt | MS Azure | Central India | 0.77 | 0.68 | 1.02 |
| Madrid | AWS | eu-south-2 | 0.46 | 0.40 | 0.61 |
| Madrid | AWS | eu-west-1 | 0.48 | 0.42 | 0.63 |
| Madrid | AWS | eu-west-2 | 0.49 | 0.43 | 0.65 |
| Madrid | AWS | eu-central-1 | 0.50 | 0.44 | 0.66 |
| Madrid | AWS | us-east-1 | 0.62 | 0.55 | 0.82 |
| Madrid | AWS | us-west-2 | 0.66 | 0.58 | 0.87 |
| Madrid | AWS | me-central-1 | 0.72 | 0.63 | 0.95 |
| Madrid | AWS | ap-southeast-1 | 0.76 | 0.67 | 1.00 |
| Madrid | AWS | ap-south-1 | 0.74 | 0.65 | 0.98 |
| Madrid | AWS | ap-northeast-1 | 0.78 | 0.69 | 1.03 |
| Madrid | GCP | europe-southwest1 | 0.47 | 0.41 | 0.62 |
| Madrid | GCP | europe-west1 | 0.49 | 0.43 | 0.65 |
| Madrid | GCP | europe-west2 | 0.50 | 0.44 | 0.66 |
| Madrid | GCP | europe-west3 | 0.51 | 0.45 | 0.67 |
| Madrid | GCP | us-east1 | 0.64 | 0.56 | 0.84 |
| Madrid | GCP | us-east4 | 0.65 | 0.57 | 0.86 |
| Madrid | GCP | us-west1 | 0.68 | 0.60 | 0.90 |
| Madrid | GCP | me-west1 | 0.75 | 0.66 | 0.99 |
| Madrid | GCP | asia-southeast1 | 0.79 | 0.70 | 1.04 |
| Madrid | GCP | asia-south1 | 0.77 | 0.68 | 1.02 |
| Madrid | MS Azure | Spain Central | 0.45 | 0.40 | 0.59 |
| Madrid | MS Azure | West Europe | 0.47 | 0.41 | 0.62 |
| Madrid | MS Azure | UK South | 0.48 | 0.42 | 0.63 |
| Madrid | MS Azure | Germany West Central | 0.49 | 0.43 | 0.65 |
| Madrid | MS Azure | East US | 0.63 | 0.55 | 0.83 |
| Madrid | MS Azure | West US | 0.67 | 0.59 | 0.88 |
| Madrid | MS Azure | UAE North | 0.73 | 0.64 | 0.96 |
| Madrid | MS Azure | Southeast Asia | 0.77 | 0.68 | 1.02 |
| Madrid | MS Azure | Central India | 0.75 | 0.66 | 0.99 |
| Amsterdam | AWS | eu-west-1 | 0.51 | 0.45 | 0.67 |
| Amsterdam | AWS | eu-west-2 | 0.52 | 0.46 | 0.69 |
| Amsterdam | AWS | eu-central-1 | 0.53 | 0.47 | 0.70 |
| Amsterdam | AWS | eu-south-2 | 0.54 | 0.48 | 0.71 |
| Amsterdam | AWS | us-east-1 | 0.67 | 0.59 | 0.88 |
| Amsterdam | AWS | us-west-2 | 0.71 | 0.62 | 0.94 |
| Amsterdam | AWS | me-central-1 | 0.77 | 0.68 | 1.02 |
| Amsterdam | AWS | ap-southeast-1 | 0.81 | 0.71 | 1.07 |
| Amsterdam | AWS | ap-south-1 | 0.79 | 0.70 | 1.04 |
| Amsterdam | AWS | ap-northeast-1 | 0.83 | 0.73 | 1.10 |
| Amsterdam | GCP | europe-west4 | 0.53 | 0.47 | 0.70 |
| Amsterdam | GCP | europe-west1 | 0.54 | 0.48 | 0.71 |
| Amsterdam | GCP | europe-west2 | 0.55 | 0.48 | 0.73 |
| Amsterdam | GCP | europe-west3 | 0.56 | 0.49 | 0.74 |
| Amsterdam | GCP | us-east1 | 0.69 | 0.61 | 0.91 |
| Amsterdam | GCP | us-east4 | 0.70 | 0.62 | 0.92 |
| Amsterdam | GCP | us-west1 | 0.73 | 0.64 | 0.96 |
| Amsterdam | GCP | me-west1 | 0.80 | 0.70 | 1.06 |
| Amsterdam | GCP | asia-southeast1 | 0.84 | 0.74 | 1.11 |
| Amsterdam | GCP | asia-south1 | 0.82 | 0.72 | 1.08 |
| Amsterdam | MS Azure | West Europe | 0.52 | 0.46 | 0.69 |
| Amsterdam | MS Azure | UK South | 0.53 | 0.47 | 0.70 |
| Amsterdam | MS Azure | Germany West Central | 0.54 | 0.48 | 0.71 |
| Amsterdam | MS Azure | Spain Central | 0.55 | 0.48 | 0.73 |
| Amsterdam | MS Azure | East US | 0.68 | 0.60 | 0.90 |
| Amsterdam | MS Azure | West US | 0.72 | 0.63 | 0.95 |
| Amsterdam | MS Azure | UAE North | 0.78 | 0.69 | 1.03 |
| Amsterdam | MS Azure | Southeast Asia | 0.82 | 0.72 | 1.08 |
| Amsterdam | MS Azure | Central India | 0.80 | 0.70 | 1.06 |
| Ashburn | AWS | us-east-1 | 0.49 | 0.43 | 0.65 |
| Ashburn | AWS | us-west-2 | 0.52 | 0.46 | 0.69 |
| Ashburn | AWS | eu-west-1 | 0.66 | 0.58 | 0.87 |
| Ashburn | AWS | eu-west-2 | 0.67 | 0.59 | 0.88 |
| Ashburn | AWS | eu-central-1 | 0.68 | 0.60 | 0.90 |
| Ashburn | AWS | eu-south-2 | 0.69 | 0.61 | 0.91 |
| Ashburn | AWS | me-central-1 | 0.75 | 0.66 | 0.99 |
| Ashburn | AWS | ap-southeast-1 | 0.79 | 0.70 | 1.04 |
| Ashburn | AWS | ap-south-1 | 0.77 | 0.68 | 1.02 |
| Ashburn | AWS | ap-northeast-1 | 0.81 | 0.71 | 1.07 |
| Ashburn | GCP | us-east4 | 0.51 | 0.45 | 0.67 |
| Ashburn | GCP | us-east1 | 0.52 | 0.46 | 0.69 |
| Ashburn | GCP | us-west1 | 0.54 | 0.48 | 0.71 |
| Ashburn | GCP | europe-west1 | 0.68 | 0.60 | 0.90 |
| Ashburn | GCP | europe-west2 | 0.69 | 0.61 | 0.91 |
| Ashburn | GCP | europe-west3 | 0.70 | 0.62 | 0.92 |
| Ashburn | GCP | europe-west4 | 0.71 | 0.62 | 0.94 |
| Ashburn | GCP | me-west1 | 0.78 | 0.69 | 1.03 |
| Ashburn | GCP | asia-southeast1 | 0.82 | 0.72 | 1.08 |
| Ashburn | GCP | asia-south1 | 0.80 | 0.70 | 1.06 |
| Ashburn | MS Azure | East US | 0.50 | 0.44 | 0.66 |
| Ashburn | MS Azure | West US | 0.53 | 0.47 | 0.70 |
| Ashburn | MS Azure | West Europe | 0.67 | 0.59 | 0.88 |
| Ashburn | MS Azure | UK South | 0.68 | 0.60 | 0.90 |
| Ashburn | MS Azure | Germany West Central | 0.69 | 0.61 | 0.91 |
| Ashburn | MS Azure | Spain Central | 0.70 | 0.62 | 0.92 |
| Ashburn | MS Azure | UAE North | 0.76 | 0.67 | 1.00 |
| Ashburn | MS Azure | Southeast Asia | 0.80 | 0.70 | 1.06 |
| Ashburn | MS Azure | Central India | 0.78 | 0.69 | 1.03 |
| Dubai | AWS | me-central-1 | 0.72 | 0.63 | 0.95 |
| Dubai | AWS | eu-central-1 | 0.86 | 0.76 | 1.14 |
| Dubai | AWS | eu-west-1 | 0.87 | 0.77 | 1.15 |
| Dubai | AWS | eu-west-2 | 0.88 | 0.77 | 1.16 |
| Dubai | AWS | us-east-1 | 0.94 | 0.83 | 1.24 |
| Dubai | AWS | us-west-2 | 0.98 | 0.86 | 1.29 |
| Dubai | AWS | ap-southeast-1 | 0.90 | 0.79 | 1.19 |
| Dubai | AWS | ap-south-1 | 0.88 | 0.77 | 1.16 |
| Dubai | AWS | ap-northeast-1 | 0.95 | 0.84 | 1.25 |
| Dubai | GCP | me-west1 | 0.75 | 0.66 | 0.99 |
| Dubai | GCP | europe-west1 | 0.89 | 0.78 | 1.17 |
| Dubai | GCP | europe-west2 | 0.90 | 0.79 | 1.19 |
| Dubai | GCP | europe-west3 | 0.91 | 0.80 | 1.20 |
| Dubai | GCP | us-east1 | 0.97 | 0.85 | 1.28 |
| Dubai | GCP | us-west1 | 1.01 | 0.89 | 1.33 |
| Dubai | GCP | asia-southeast1 | 0.93 | 0.82 | 1.23 |
| Dubai | GCP | asia-south1 | 0.91 | 0.80 | 1.20 |
| Dubai | MS Azure | UAE North | 0.73 | 0.64 | 0.96 |
| Dubai | MS Azure | Germany West Central | 0.87 | 0.77 | 1.15 |
| Dubai | MS Azure | West Europe | 0.88 | 0.77 | 1.16 |
| Dubai | MS Azure | UK South | 0.89 | 0.78 | 1.17 |
| Dubai | MS Azure | East US | 0.95 | 0.84 | 1.25 |
| Dubai | MS Azure | West US | 0.99 | 0.87 | 1.31 |
| Dubai | MS Azure | Southeast Asia | 0.91 | 0.80 | 1.20 |
| Dubai | MS Azure | Central India | 0.89 | 0.78 | 1.17 |
| Singapore | AWS | ap-southeast-1 | 0.78 | 0.69 | 1.03 |
| Singapore | AWS | ap-south-1 | 0.82 | 0.72 | 1.08 |
| Singapore | AWS | ap-northeast-1 | 0.84 | 0.74 | 1.11 |
| Singapore | AWS | eu-central-1 | 0.96 | 0.84 | 1.27 |
| Singapore | AWS | eu-west-1 | 0.97 | 0.85 | 1.28 |
| Singapore | AWS | eu-west-2 | 0.98 | 0.86 | 1.29 |
| Singapore | AWS | us-east-1 | 1.04 | 0.92 | 1.37 |
| Singapore | AWS | us-west-2 | 1.02 | 0.90 | 1.35 |
| Singapore | AWS | me-central-1 | 0.94 | 0.83 | 1.24 |
| Singapore | GCP | asia-southeast1 | 0.80 | 0.70 | 1.06 |
| Singapore | GCP | asia-south1 | 0.84 | 0.74 | 1.11 |
| Singapore | GCP | asia-northeast1 | 0.86 | 0.76 | 1.14 |
| Singapore | GCP | europe-west1 | 0.99 | 0.87 | 1.31 |
| Singapore | GCP | europe-west2 | 1.00 | 0.88 | 1.32 |
| Singapore | GCP | europe-west3 | 1.01 | 0.89 | 1.33 |
| Singapore | GCP | us-east1 | 1.07 | 0.94 | 1.41 |
| Singapore | GCP | us-west1 | 1.05 | 0.92 | 1.39 |
| Singapore | GCP | me-west1 | 0.97 | 0.85 | 1.28 |
| Singapore | MS Azure | Southeast Asia | 0.79 | 0.70 | 1.04 |
| Singapore | MS Azure | Central India | 0.83 | 0.73 | 1.10 |
| Singapore | MS Azure | Japan East | 0.85 | 0.75 | 1.12 |
| Singapore | MS Azure | Germany West Central | 0.97 | 0.85 | 1.28 |
| Singapore | MS Azure | West Europe | 0.98 | 0.86 | 1.29 |
| Singapore | MS Azure | UK South | 0.99 | 0.87 | 1.31 |
| Singapore | MS Azure | East US | 1.05 | 0.92 | 1.39 |
| Singapore | MS Azure | West US | 1.03 | 0.91 | 1.36 |
| Singapore | MS Azure | UAE North | 0.95 | 0.84 | 1.25 |


# Quoting Journey

1. Quoting journey begins with selecting customer
2. After selecting customer - the flow should check if the customer already has purchased access ports 
   - if yes -> customer can choose whether he wants to add services on the existing port or buy a new access port
   - if no -> customer should purchase a new access port
3. Configuring new access port
   - port configuration flow works as follows -> customer need to select data centre location (one of the available datacentres) and port speed. Business Rule #1 specifies which datacenters support which port sizes 
4. Configuring service
   - after configuring port - the user configures service - selecting one of the GIX Internet Peering, GIX Mobile Peering, GIX Cloud Connect and then configuring it's parameters:
      - for GIX Internet Peering - service bandwidth
      - for GIX Mobile Peering - service bandwidth
      - for GIX Cloud Connect - cloud provider (AWS, GCP, MS Azure), region (dependent on cloud provider, values can be derived from the pricing table above) and pricing model (flat, burstable)
5. User can stick multiple services on the same Access Port, but business rule #3 must be respected - Total Bandwidth of services can not exceed Access Port size 


## Business Rules
1. Data centres can only support following port sizes:

| Data Centre | Supported Port Sizes |
|-------------|---------------------|
| Equinix LD5 | 1G, 10G, 100G |
| Equinix LD8 | 1G, 10G |
| TELEHOUSE London Docklands (South) | 1G |
| Equinix FR5 | 1G, 10G, 100G |
| Digital Realty FRA8 | 1G, 10G |
| Equinix MD2 | 1G, 10G |
| Digital Realty MAD1 | 1G, 10G |
| Equinix AM1 | 1G, 10G |
| Digital Realty AMS11 | 1G, 10G |
| Equinix DC3 | 1G, 10G |
| Equinix DC11 | 1G, 10G, 100G |
| Equinix DX1 | 1G, 10G |
| Datamena Al Salam Tower Datacenter | 1G, 10G |
| Equinix SG1 | 1G |
| Digital Realty SIN10 | 1G, 10G, 100G |

2. Service (GIX Internet Peering, GIX Mobile Peering, GIX Cloud Connect) must be related to GIX Access Port

3. Total Bandwidth of services can not exceed Access Port size 


# Specificaction / Design

1. Try to utilise standard Quote / Order objects

2. We need to add Inventory object. Inventory represents products / services purchased by customer.
Inventory should be visible as a tab under customer (next to Deals)
It should also have dedicated menu item in customers section

3. We need to setup 4 Products according to use-case description above

4. We need to extend products to have configurable attributes (with values). Products should also have charge definitions (one product - multiple charges - non recurring, recurring, usage)

5. We need a pricing table object - to hold multi-dimensional pricing tables

6. We need to create a custom quoting flow according to Quoting Journey description

7. We need to override pricing logic to calculate pricing properly 

8. We want the whole implementation not to be limited to GIX and four products described in use-case, but rather be quite generic for any products