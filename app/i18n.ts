/**
 * Translations for the merchant-facing UI.
 *
 * German is the default, not an afterthought: every user of this app is a
 * German-market bookkeeper, and the App Store rule is that a listing may only
 * claim languages the UI actually supports. The domain terms (Erlöskonto,
 * Steuerschlüssel, Abrechnungsbelege) were already German because they have no
 * useful English equivalent in this context — now the sentences around them
 * match.
 *
 * Deliberately a plain dictionary rather than an i18n framework: the string
 * count is small, it needs no pluralisation rules beyond one/many, and a
 * missing key should be a type error rather than a silent fallback.
 */

export const LOCALES = ["de", "en"] as const;
export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = "de";

/** Shopify passes `locale` in the URL; anything unsupported falls back. */
export function resolveLocale(input: string | null | undefined): Locale {
  if (!input) return DEFAULT_LOCALE;
  const base = input.toLowerCase().split("-")[0];
  return (LOCALES as readonly string[]).includes(base)
    ? (base as Locale)
    : DEFAULT_LOCALE;
}

const de = {
  // --- navigation ---
  "nav.overview": "Übersicht",
  "nav.connection": "Verbindung",
  "nav.mapping": "Zuordnung",
  "nav.orders": "Aufträge",
  "nav.export": "Export",
  "nav.journal": "Protokoll",

  // --- overview ---
  "overview.title": "Scopevisio ERP",
  "overview.subtitle.connected": "Shop-Aufträge werden nach {org} gebucht",
  "overview.subtitle.disconnected": "Noch nicht verbunden",
  "overview.onboarding.title": "In drei Schritten einsatzbereit",
  "overview.onboarding.done": "Einrichtung abgeschlossen",
  "overview.onboarding.progress": "{done} von 3 erledigt",
  "overview.onboarding.dismiss": "Ausblenden",
  "overview.onboarding.step1": "Scopevisio-Organisation verbinden",
  "overview.onboarding.step1.detail":
    "Melden Sie sich mit Ihren gewohnten Zugangsdaten an.",
  "overview.onboarding.step2": "Zuordnung zu Ihren Konten prüfen",
  "overview.onboarding.step2.detail":
    "Kundengruppen und je Steuerfall ein Steuersachverhalt — aus Ihren eigenen Stammdaten.",
  "overview.onboarding.step3": "Synchronisierung einschalten",
  "overview.onboarding.step3.detail":
    "Vorher wird nichts an Scopevisio übertragen.",
  "overview.step.done": "Erledigt",
  "overview.connection.broken": "Die Verbindung zu Scopevisio funktioniert nicht",
  "overview.connection.broken.detail":
    "Aufträge werden zwischengespeichert, nicht verworfen. Nach dem Wiederverbinden werden sie verarbeitet.",
  "overview.connection.fix": "Verbindung reparieren",
  "overview.stat.booked": "Gebucht",
  "overview.stat.attention": "Erfordert Ihre Entscheidung",
  "overview.stat.toExport": "Bereit zum Export",
  "overview.stat.awaiting": "Wartet auf Bestätigung",
  "overview.mode.title": "Aktueller Modus",
  "overview.mode.syncOn": "Synchronisierung ein",
  "overview.mode.syncOff": "Synchronisierung aus",
  "overview.mode.autoPost": "Automatisches Buchen",
  "overview.mode.manualPost": "Nur anlegen, Sie buchen",
  "overview.mode.autoPost.detail":
    "Rechnungen werden nach erfolgreicher Steuerprüfung automatisch gebucht. Gebuchte Belege lassen sich nicht zurücknehmen.",
  "overview.mode.manualPost.detail":
    "Rechnungen werden angelegt und geprüft, das Buchen bleibt bei Ihnen. So fängt man am besten an.",
  "overview.export.ready": "{n} Rechnung(en) bereit zum Import",
  "overview.export.awaiting": "{n} Rechnung(en) warten auf Bestätigung",
  "overview.export.ready.detail":
    "Kunde, Debitorenkonto und Steuer sind bereits ermittelt. Datei herunterladen und in Scopevisio importieren.",
  "overview.export.awaiting.detail":
    "Ein heruntergeladener Stapel ist noch nicht bestätigt. Teilen Sie mit, ob der Import geklappt hat.",
  "overview.export.open": "Export öffnen",
  "overview.attention.title": "{n} Auftrag/Aufträge warten auf Sie",
  "overview.attention.detail":
    "Diese wurden nicht gebucht, weil etwas nicht automatisch entschieden werden konnte. Jeder Eintrag erklärt, was fehlt.",
  "overview.attention.open": "Prüfliste öffnen",
  "overview.activity.title": "Letzte Aktivität",
  "overview.activity.all": "Vollständiges Protokoll",
  "overview.footer.help": "Hilfe zu einem zurückgehaltenen Auftrag oder einer Einstellung?",
  "overview.footer.support": "Support kontaktieren",
  "overview.footer.privacy": "Datenschutzerklärung",

  // --- connection ---
  "conn.title": "Scopevisio-Verbindung",
  "conn.subtitle": "Woher diese App ihre Buchhaltungsdaten bezieht",
  "conn.status.notConnected": "Nicht verbunden",
  "conn.status.connected": "Verbunden",
  "conn.status.error": "Erfordert Aufmerksamkeit",
  "conn.status.unverified": "Ungeprüft",
  "conn.credentials": "Scopevisio-Zugangsdaten",
  "conn.credentials.detail":
    "Dieselben Zugangsdaten, mit denen Sie sich bei Scopevisio anmelden. Sie werden verschlüsselt gespeichert; sobald Scopevisio ein Refresh-Token ausstellt, wird das Passwort gelöscht. Den Zugriff können Sie jederzeit im Scopevisio-Kundenportal unter Schnittstelle (OpenScope) → API-Token widerrufen.",
  "conn.field.customer": "Kundennummer",
  "conn.field.customer.help":
    "Siebenstellig, aus Ihrem Scopevisio-Kundenportal.",
  "conn.field.organisation": "Organisation (optional)",
  "conn.field.organisation.help":
    "Können Sie leer lassen — Scopevisio ermittelt sie aus Kundennummer und Benutzer, und wir zeigen Ihnen, welche gewählt wurde. Nur nötig, wenn Ihr Benutzer zu mehreren Organisationen gehört.",
  "conn.field.username": "Benutzer (E-Mail)",
  "conn.field.username.help":
    "Wir empfehlen einen eigenen Schnittstellen-Benutzer statt eines persönlichen Zugangs.",
  "conn.field.password": "Passwort",
  "conn.field.password.help.new":
    "Verschlüsselt gespeichert und gelöscht, sobald ein Refresh-Token vorliegt.",
  "conn.field.password.help.existing":
    "Nur leer lassen, wenn Sie es nicht ändern — eine erneute Eingabe autorisiert die Verbindung neu.",
  "conn.field.baseUrl": "API-Basis-URL",
  "conn.field.baseUrl.help":
    "Nur ändern, wenn Scopevisio Ihnen eine andere Adresse genannt hat.",
  "conn.submit.new": "Verbinden",
  "conn.submit.existing": "Speichern und neu verbinden",
  "conn.health": "Verbindungsstatus",
  "conn.health.lastCheck": "Letzte Prüfung: {when}",
  "conn.health.never": "noch nie",
  "conn.health.check": "Jetzt prüfen",
  "conn.health.disconnect": "Verbindung trennen",
  "conn.health.disconnect.detail":
    "Das Trennen stoppt jede Synchronisierung. Bereits in Scopevisio gebuchte Belege bleiben unberührt — gebuchte Belege sind nach GoBD unveränderlich.",
  "conn.error.title": "Verbindung konnte nicht hergestellt werden",
  "conn.ok.title": "Verbunden",
  "conn.broken.title": "Die Verbindung funktioniert nicht mehr",
  "conn.broken.detail":
    "Aufträge werden zwischengespeichert, solange die Verbindung unterbrochen ist — es geht nichts verloren. Passwort erneut eingeben, um neu zu verbinden.",
  "conn.key.title": "Verschlüsselung der Zugangsdaten ist nicht konfiguriert",
  "conn.field.customer.required": "Bitte geben Sie Ihre Scopevisio-Kundennummer ein.",
  "conn.field.customer.format":
    "Die Kundennummer ist siebenstellig — Sie finden sie in Ihrem Scopevisio-Kundenportal.",
  "conn.field.username.required": "Bitte geben Sie den Benutzer an, mit dem sich die App anmeldet.",
  "conn.field.username.format": "Bitte geben Sie eine gültige E-Mail-Adresse ein.",
  "conn.field.password.required": "Bitte geben Sie das Passwort dieses Benutzers ein.",
  "conn.profiles.title": "Welche Scopevisio-Rechte braucht die Schnittstelle?",
  "conn.profiles.detail":
    "Der Benutzer benötigt mindestens: Kontakte (Bearbeiten), Datenimport (Bearbeiten), Angebote/Aufträge/Lieferscheine/Rechnungen (Bearbeiten) sowie Stammdaten · Steuermatrix (Anzeigen). Fehlt ein Recht, benennt die Fehlermeldung das fehlende Profil.",

  // --- shared ---
  "common.notConfigured": "— nicht konfiguriert —",
  "common.save": "Speichern",
  "common.cancel": "Abbrechen",
} as const;

export type TranslationKey = keyof typeof de;

const en: Record<TranslationKey, string> = {
  "nav.overview": "Overview",
  "nav.connection": "Connection",
  "nav.mapping": "Mapping",
  "nav.orders": "Orders",
  "nav.export": "Export",
  "nav.journal": "Journal",

  "overview.title": "Scopevisio ERP",
  "overview.subtitle.connected": "Booking shop orders into {org}",
  "overview.subtitle.disconnected": "Not connected yet",
  "overview.onboarding.title": "Three steps to get started",
  "overview.onboarding.done": "You are set up",
  "overview.onboarding.progress": "{done} of 3 done",
  "overview.onboarding.dismiss": "Dismiss",
  "overview.onboarding.step1": "Connect your Scopevisio organisation",
  "overview.onboarding.step1.detail":
    "Sign in with the credentials you already use.",
  "overview.onboarding.step2": "Confirm how shop data maps onto your accounts",
  "overview.onboarding.step2.detail":
    "Customer groups and a Steuersachverhalt per tax case, from your own master data.",
  "overview.onboarding.step3": "Switch sync on",
  "overview.onboarding.step3.detail":
    "Nothing is sent to Scopevisio until you do.",
  "overview.step.done": "Done",
  "overview.connection.broken": "The Scopevisio connection is not working",
  "overview.connection.broken.detail":
    "Orders are queued, not lost. Reconnect and they will be processed.",
  "overview.connection.fix": "Fix the connection",
  "overview.stat.booked": "Booked",
  "overview.stat.attention": "Needs your decision",
  "overview.stat.toExport": "Ready to export",
  "overview.stat.awaiting": "Awaiting confirmation",
  "overview.mode.title": "Current mode",
  "overview.mode.syncOn": "Sync on",
  "overview.mode.syncOff": "Sync off",
  "overview.mode.autoPost": "Posting automatically",
  "overview.mode.manualPost": "Create only, you post",
  "overview.mode.autoPost.detail":
    "Invoices are posted automatically once the tax cross-check passes. Posted documents cannot be withdrawn.",
  "overview.mode.manualPost.detail":
    "Invoices are created and cross-checked, then left for you to post. This is the safe way to start.",
  "overview.export.ready": "{n} invoice(s) ready to import",
  "overview.export.awaiting": "{n} invoice(s) awaiting confirmation",
  "overview.export.ready.detail":
    "Customer, debitor account and VAT are already resolved. Download the file and import it in Scopevisio.",
  "overview.export.awaiting.detail":
    "A downloaded batch has not been confirmed yet. Tell the connector whether the import went through.",
  "overview.export.open": "Open Export",
  "overview.attention.title": "{n} order(s) waiting for you",
  "overview.attention.detail":
    "These were not booked because something could not be decided automatically. Each one explains what it needs.",
  "overview.attention.open": "Open the review queue",
  "overview.activity.title": "Latest activity",
  "overview.activity.all": "See the full journal",
  "overview.footer.help":
    "Need help with a held order or a Scopevisio setting?",
  "overview.footer.support": "Contact support",
  "overview.footer.privacy": "Privacy policy",

  "conn.title": "Scopevisio connection",
  "conn.subtitle": "Where this app gets its accounting data",
  "conn.status.notConnected": "Not connected",
  "conn.status.connected": "Connected",
  "conn.status.error": "Needs attention",
  "conn.status.unverified": "Unverified",
  "conn.credentials": "Scopevisio credentials",
  "conn.credentials.detail":
    "These are the same credentials you use to sign in to Scopevisio. They are encrypted before being stored, and once Scopevisio issues a refresh token the password is deleted. You can revoke access at any time from your Scopevisio customer portal under Schnittstelle (OpenScope) → API Token.",
  "conn.field.customer": "Customer number",
  "conn.field.customer.help":
    "Seven digits, from your Scopevisio customer portal.",
  "conn.field.organisation": "Organisation (optional)",
  "conn.field.organisation.help":
    "Leave blank — Scopevisio works it out from your customer number and user, and we show you which one it picked. Only fill this in if your user belongs to more than one organisation.",
  "conn.field.username": "User (e-mail)",
  "conn.field.username.help":
    "We recommend a dedicated integration user rather than a personal login.",
  "conn.field.password": "Password",
  "conn.field.password.help.new":
    "Stored encrypted, then discarded once a refresh token is issued.",
  "conn.field.password.help.existing":
    "Leave blank only if you are not changing it — re-entering it re-authorises the connection.",
  "conn.field.baseUrl": "API base URL",
  "conn.field.baseUrl.help":
    "Only change this if Scopevisio has given you a different endpoint.",
  "conn.submit.new": "Connect",
  "conn.submit.existing": "Save and reconnect",
  "conn.health": "Connection health",
  "conn.health.lastCheck": "Last checked: {when}",
  "conn.health.never": "never",
  "conn.health.check": "Check now",
  "conn.health.disconnect": "Disconnect",
  "conn.health.disconnect.detail":
    "Disconnecting stops all syncing. Documents already booked in Scopevisio are untouched — posted documents are immutable under GoBD.",
  "conn.error.title": "Could not connect",
  "conn.ok.title": "Connected",
  "conn.broken.title": "The connection stopped working",
  "conn.broken.detail":
    "Orders are queued while the connection is down — nothing is lost. Re-enter the password below to reconnect.",
  "conn.key.title": "Credential encryption is not configured",
  "conn.field.customer.required": "Enter your Scopevisio customer number.",
  "conn.field.customer.format":
    "This is seven digits — you will find it in your Scopevisio customer portal.",
  "conn.field.username.required": "Enter the user this app should sign in as.",
  "conn.field.username.format": "Enter a valid e-mail address.",
  "conn.field.password.required": "Enter the password for that user.",
  "conn.profiles.title": "Which Scopevisio permissions does the connector need?",
  "conn.profiles.detail":
    "The connector user needs at least: Kontakte (Bearbeiten), Datenimport (Bearbeiten), Angebote/Aufträge/Lieferscheine/Rechnungen (Bearbeiten), and Stammdaten · Steuermatrix (Anzeigen). If a sync fails with a permissions error, the message will name the profile that is missing.",

  "common.notConfigured": "— not configured —",
  "common.save": "Save",
  "common.cancel": "Cancel",
};

const DICTIONARIES: Record<Locale, Record<TranslationKey, string>> = {
  de,
  en,
};

/**
 * Look up a string, substituting `{name}` placeholders. A missing key returns
 * the key itself, which is loud in the UI rather than silently blank.
 */
export function translate(
  locale: Locale,
  key: TranslationKey,
  vars?: Record<string, string | number>,
): string {
  const value = DICTIONARIES[locale]?.[key] ?? DICTIONARIES[DEFAULT_LOCALE][key];
  if (!value) return key;
  if (!vars) return value;
  return value.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in vars ? String(vars[name]) : match,
  );
}

/** Curried form, so a component can do `const t = makeT(locale)`. */
export function makeT(locale: Locale) {
  return (key: TranslationKey, vars?: Record<string, string | number>) =>
    translate(locale, key, vars);
}
