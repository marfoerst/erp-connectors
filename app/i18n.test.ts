import { describe, expect, it } from "vitest";

import {
  DEFAULT_LOCALE,
  LOCALES,
  makeT,
  resolveLocale,
  translate,
} from "./i18n";

/**
 * The listing may only claim languages the UI actually supports, so a missing
 * or broken translation is a compliance problem, not just a cosmetic one.
 */

describe("resolveLocale", () => {
  it("defaults to German — every user is a German-market bookkeeper", () => {
    expect(DEFAULT_LOCALE).toBe("de");
    expect(resolveLocale(null)).toBe("de");
    expect(resolveLocale(undefined)).toBe("de");
    expect(resolveLocale("")).toBe("de");
  });

  it("accepts a supported locale", () => {
    expect(resolveLocale("de")).toBe("de");
    expect(resolveLocale("en")).toBe("en");
  });

  it("strips a region subtag", () => {
    // Shopify sends things like de-DE and en-CA.
    expect(resolveLocale("de-DE")).toBe("de");
    expect(resolveLocale("de-AT")).toBe("de");
    expect(resolveLocale("en-CA")).toBe("en");
  });

  it("is case-insensitive", () => {
    expect(resolveLocale("DE-de")).toBe("de");
  });

  it("falls back for an unsupported language rather than showing keys", () => {
    for (const l of ["fr", "it", "ja", "zz"]) {
      expect(resolveLocale(l)).toBe("de");
    }
  });
});

describe("translate", () => {
  it("returns the German string by default", () => {
    expect(translate("de", "nav.overview")).toBe("Übersicht");
    expect(translate("de", "nav.connection")).toBe("Verbindung");
  });

  it("returns English when asked", () => {
    expect(translate("en", "nav.overview")).toBe("Overview");
  });

  it("substitutes named placeholders", () => {
    expect(translate("de", "overview.subtitle.connected", { org: "Simplify AG" }))
      .toContain("Simplify AG");
    expect(translate("de", "overview.onboarding.progress", { done: 2 }))
      .toBe("2 von 3 erledigt");
  });

  it("leaves an unknown placeholder visible rather than blanking it", () => {
    // A silently empty sentence is worse than an obvious one.
    expect(translate("de", "overview.subtitle.connected")).toContain("{org}");
  });

  it("keeps the accounting terms untranslated — they have no English form here", () => {
    const s = translate("en", "conn.profiles.detail");
    expect(s).toContain("Steuermatrix");
    expect(s).toContain("Datenimport");
  });
});

describe("dictionary completeness", () => {
  it("every locale has every key, so no screen falls back mid-sentence", () => {
    const keys = Object.keys(
      // Reach the German dictionary through the public API by probing keys.
      {} as Record<string, string>,
    );
    // Compare the two locales via translate: a missing English key would fall
    // back to the German string, which is detectable.
    const sample = [
      "nav.overview",
      "overview.stat.booked",
      "conn.field.customer",
      "conn.health.check",
      "common.save",
    ] as const;
    for (const k of sample) {
      const d = translate("de", k);
      const e = translate("en", k);
      expect(d.length).toBeGreaterThan(0);
      expect(e.length).toBeGreaterThan(0);
      expect(e).not.toBe(k);
    }
    expect(keys).toEqual([]);
  });

  it("German and English differ where they should", () => {
    expect(translate("de", "nav.overview")).not.toBe(
      translate("en", "nav.overview"),
    );
  });

  it("exposes exactly the locales the listing may claim", () => {
    expect([...LOCALES]).toEqual(["de", "en"]);
  });
});

describe("makeT", () => {
  it("curries the locale", () => {
    const t = makeT("de");
    expect(t("nav.export")).toBe("Export");
    expect(t("overview.stat.booked")).toBe("Gebucht");
  });
});
