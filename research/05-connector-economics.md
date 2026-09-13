# Connector economics and the competitive field

## What already exists for Shopify

| Target | Built by | Price | Signal |
|---|---|---|---|
| lexoffice | third party (Appify) | $10–22/mo | 4.8★, 40 reviews — saturated |
| sevDesk | third party (Eshop Guide) | $13–27/mo + $114 one-off | 4.7★, 88 reviews — saturated |
| DATEV | third party (Pathway) | Enterprise **from €2,000/mo** | Sales-led, entrenched |
| SAP Business One | third party (eShopSync) | $99/mo | Product sync only — shallow |
| JTL | the ERP vendor | free + usage | **2.1–2.6★** — served badly, not served well |
| weclapp, Xentral, Dynamics BC | the vendor | free, bundled | Thin; hard to compete on price |
| **Scopevisio** | — | — | **Nothing exists, anywhere** |

DATEV, lexoffice and sevDesk **did not build their own Shopify apps**.
Independent developers did, and monetised the gap. That is the precedent.

## Middleware is not the competition

Celigo ($12,800–73,300/yr) and Workato are the wrong price point and the wrong
buyer — enterprise IT, not an SMB bookkeeper. Make, n8n and Zapier provide
plumbing but not the compliance logic; n8n's own community flags DATEV as
unusually hard to wire generically ("six different interfaces… no simple API
key"). sevDesk has no official Zapier integration at all.

The defensibility argument is therefore not "we have a connector" but "the
booking is legally correct, and stays correct as the rules change".

## Pricing is bimodal, and there is an empty rung

Cheap self-serve apps exist where the target is a simple SaaS invoicing tool
with a clean API. The moment the target is a real multi-module ERP, the market
reverts to free-but-shallow vendor connectors, or bespoke projects:

- German integration consulting: €1,000–2,500/day; €3,000–15,000 per interface;
  €30,000–150,000 for a mid-size project.

**Nothing credible occupies €50–500/month with real invoicing depth.** That gap
in the ladder may be more durable than any single ERP pairing.

## Scopevisio

~7,500 customers, ~300 staff, €32M revenue (2023), Bonn. **Hg Capital took a
minority stake in March 2025** to fund DACH growth. WirtschaftsWoche ranked it
#2 in ERP among *Beste Mittelstandsdienstleister 2025*.

No Shopify connector existed from anyone. Shopware and Magento integrations
exist only as bespoke agency builds (DATANAUT, Y1) — which is demand evidence
for Shopware specifically: someone is paying agency rates for it today.

An independent developer maintains a .NET OpenScope client on NuGet (~18k
downloads), so outside developers do use the API.

## Caveat

Shopify publishes no install counts; review counts are a weak proxy. Revenue
figures for private vendors are not public. Treat the table as shape, not size.
