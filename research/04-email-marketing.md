# E-mail marketing integrations

**Verdict: don't.** Investigated as a candidate and rejected on the evidence.

## Why

- **Every major ESP ships and maintains its own first-party app** on Shopify and
  Shopware: Klaviyo, Omnisend, Brevo, ActiveCampaign, Attentive, Mailchimp,
  HubSpot. The integration *is* their core product.
- **Klaviyo alone holds ~37% of Shopify's e-mail-marketing installs** (272k of
  730k tracked by StoreCensus).
- **The platform is not neutral.** Shopify invested $100M in Klaviyo in 2022 and
  held ~11% directly, up to ~21% fully diluted, per Klaviyo's S-1 (SEC-filed).
- **Pricing is structurally worse**: marketing apps cluster at $9–49/month,
  integration apps sustain $600–2,000+. Same engineering, an order of magnitude
  less revenue per customer.

## The one real gap, and why it is still not a market

German double opt-in. Not statutory, but functionally mandatory: BGH
(10.02.2011, I ZR 164/09) held single opt-in "keinesfalls ausreicht", and the
DSK's 2022 *Orientierungshilfe Werbung* names double opt-in as the required
proof. Shopify's consent model has **no first-class "pending confirmation"
state**, and Shopify's own docs defer German requirements to third-party apps.

German courts tightened through 2025–26: LG Berlin II (102 O 61/24), OLG München
(29 U 599/24, making coupled consent actionable by *competitors* under UWG §3a),
LG Hamburg on pre-ticked boxes.

That is a compliance feature, sold on Abmahnung risk — not a market. It is also
the same shape as the rest of this work: correctness under German law that the
platform will not handle for you.

## Caveat

App-revenue and install-to-revenue figures came from SEO blogs with undisclosed
methodology. The legal citations and the Klaviyo stake are the solid parts.
