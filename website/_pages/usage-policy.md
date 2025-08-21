---
title: Usage Policy
last_updated: 2025-08-18
---

This Usage Policy governs access to and use of the OpenStreetMap US Tileservice by developers who integrate it into their applications.

## Acceptance of Terms

By integrating the OpenStreetMap US Tileservice (the "Service") into your Application, you agree to be bound by this Usage Policy as a Developer. If you do not agree to these terms, you may not integrate or use the Service. This Policy applies only to Developers who integrate the Service - End Users of Applications are not subject to this Policy. Continued use constitutes ongoing acceptance of any updated terms.

## Definitions

- **"Service"** means the OpenStreetMap US Tileservice and related infrastructure located at [https://tiles.openstreetmap.us](https://tiles.openstreetmap.us)
- **"Application"** means any software, website, or service that makes requests to the Service
- **"Developer"** means any individual or entity that integrates the Service into an Application
- **"End User"** means any person who uses an Application
- **"OSM US"** means OpenStreetMap US, the operator of the Service

## Permitted Use

The Service provides public access to map tiles and related resources for non-commercial use. Any revenue-generating use requires written permission from OSM US. The Service is provided on an experimental basis and is subject to change or discontinuation without notice.

## Prohibited Use

Developers may not:
1. Use the Service for any revenue-generating purpose without written permission
2. Sell, redistribute, or sublicense tiles from the Service
3. Use the Service for illegal purposes or in violation of applicable laws, including US export control laws
4. Access the Service from countries subject to US sanctions

## Attribution Requirements

All Applications using the Service must display proper attribution, typically in a corner of the map:
1. All Developers must attribute OpenStreetMap US and link to the Service: "Tiles by [OSM US](https://tiles.openstreetmap.us)"
2. Applications using OSM-derived tilesets must comply with the [OpenStreetMap license](https://www.openstreetmap.org/copyright): "© [OpenStreetMap](https://www.openstreetmap.org/copyright)"
3. Applications using OpenMapTiles must comply with the [OpenMapTiles license](https://github.com/openmaptiles/openmaptiles/blob/master/LICENSE.md): "© [OpenMapTiles](https://openmaptiles.org)"
4. Full example: "Tiles by [OSM US](https://tiles.openstreetmap.us) © [OpenStreetMap](https://www.openstreetmap.org/copyright) © [OpenMapTiles](https://openmaptiles.org)"

## Access Limitations

Access to the Service is provided through different tiers with usage limits set at OSM US's sole discretion:
- **Development Tier**: Unrestricted access for development on loopback hosts (e.g., localhost)
- **Starter Tier**: Limited daily requests for Applications with modest usage
- **Partner Tier**: Enhanced access for OSM US partners, available by application

Usage limits may vary by Application and are typically identified through HTTP Origin headers. OSM US will automatically suspend access when limits are exceeded.

## Technical Requirements

Applications must:
1. Send accurate Origin, Referrer, and User-Agent headers
2. Follow Cache-Control response headers and avoid unnecessary requests
3. Respect HTTP 429 (Too Many Requests) responses by reducing request rate

Applications must **NOT**:
1. Spoof or misrepresent client identifying information
2. Use excessive clients or origins to circumvent usage limits
3. Systematically download or scrape large numbers of tiles for offline storage or redistribution
4. Use the Service in a manner that constitutes a denial-of-service attack or places unreasonable load on infrastructure

## Termination

OSM US will suspend or terminate a Developer's access to the Service immediately upon violation of this Policy or excessive usage. OSM US may also terminate access at any time for any reason without notice and without refund.

## Disclaimers and Limitation of Liability

THE SERVICE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. OSM US MAKES NO GUARANTEES REGARDING AVAILABILITY, PERFORMANCE, OR CONTENT ACCURACY. DEVELOPER ASSUMES ALL RISKS ASSOCIATED WITH USE OF THE SERVICE.

TO THE MAXIMUM EXTENT PERMITTED BY LAW, OSM US SHALL NOT BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR PUNITIVE DAMAGES ARISING FROM USE OF THE SERVICE. OSM US'S TOTAL LIABILITY SHALL NOT EXCEED ZERO DOLLARS.

## Indemnification

Developer agrees to indemnify, defend, and hold harmless OSM US from any claims, damages, losses, or expenses arising from Developer's use of the Service or violation of this Policy.

## Data Collection

OSM US collects limited technical data necessary to operate the Service, including aggregated usage statistics and HTTP headers for abuse prevention and monitoring. Client IP addresses may be temporarily processed by third-party infrastructure providers for rate limiting but are not stored by OSM US. No personal information about End Users is collected. We do not and will never attempt to identify or track End Users.

## General Terms

This Policy constitutes the entire agreement between the parties. OSM US may modify this Policy at any time. Continued use of the Service constitutes acceptance of any changes. If any provision is unenforceable, the remaining provisions remain in effect. This Policy is governed by the laws of Washington, DC and any disputes shall be resolved in Washington, DC. OSM US reserves the right to deny, limit, or modify access to the Service for any reason at its sole discretion.
