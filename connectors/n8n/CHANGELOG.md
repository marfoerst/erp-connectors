# Changelog

## 0.1.0

First release.

- **Scopevisio** node with Account, Contact, Debitor, Product, Outgoing Invoice,
  Incoming Invoice, Tax and Report resources.
- **Scopevisio Trigger** polling node for new contacts, outgoing invoices,
  incoming invoices and products.
- **Scopevisio API** credential using a refresh token or username and password,
  with automatic access-token refresh.
- Contact updates are read back and fail when Scopevisio silently ignores a field.
- Posting an invoice to the ledger requires explicit confirmation.
