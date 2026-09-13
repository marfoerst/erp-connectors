# German and EU e-invoicing

**Not a roadmap item.** Scopevisio already sends e-invoices. Kept because the
dates are useful context for any German finance integration, and because the
statutory ones were verified against primary sources.

## The mandate

Legal basis: Wachstumschancengesetz, BGBl. 2024 I Nr. 108, amending §14 UStG.
Two BMF-Schreiben govern the detail:

- **15.10.2024** — III C 2 – S 7287-a/23/10001 :007 (BStBl I 2024 S. 1320)
- **15.10.2025** — III C 2 – S 7287-a/00019/007/243

The second adds a validation expectation, a three-tier error taxonomy, and the
rule that in a hybrid ZUGFeRD file **the XML layer is legally authoritative** —
a PDF disagreeing with it creates §14c exposure.

## Dates — read directly from §27 Abs. 38 UStG

| Date | Requirement |
|---|---|
| 1 Jan 2025 | Every German business must be able to **receive** structured e-invoices |
| 31 Dec 2026 | Paper and non-conforming formats stop being available to everyone |
| 1 Jan 2027 | **Issuing** mandatory where the issuer's *preceding* calendar-year `Gesamtumsatz (§19 Abs. 2)` exceeded **€800,000** |
| 1 Jan 2028 | Universal; the threshold falls away |
| 1 Jul 2030 | EU ViDA adds cross-border digital reporting — a separate instrument |

Permanently exempt from *issuing*: B2C, Kleinbetragsrechnungen ≤ €250 (§33
UStDV), Fahrausweise (§34 UStDV), §4 Nrn. 8–29 supplies, and Kleinunternehmer
(§34a UStDV) — who must still be able to receive.

## Formats

EN 16931 is the semantic model; XRechnung (KoSIT) and ZUGFeRD/Factur-X (FeRD)
are German realizations, and since ~April 2025 Peppol BIS Billing 3.0 is
interchangeable with XRechnung in Germany via a national ruleset.

No mandatory certification exists for invoice-*generating* software. KoSIT's
free validator is the de facto conformance check.

## Flagged as unverified

- German Wikipedia's ZUGFeRD 2.5 / 10.06.2026 date was not confirmed at FeRD.
- XRechnung 4.0 "mid-2026" came from a single vendor blog.
- The national real-time **Meldesystem** for 2028 is **policy intention, not
  enacted law**. No bill or BGBl reference exists. It must not appear in a pitch
  as fact.
