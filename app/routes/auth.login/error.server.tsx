import type { LoginError } from "@shopify/shopify-app-remix/server";
import { LoginErrorType } from "@shopify/shopify-app-remix/server";

interface LoginErrorMessage {
  shop?: string;
}

/**
 * App Store 2.3.1 forbids prompting for a shop domain, so these messages no
 * longer ask the merchant to enter one — the shop always comes from Shopify.
 * A missing or invalid shop means the app was opened outside Shopify, which is
 * what the message now says.
 */
export function loginErrorMessage(loginErrors: LoginError): LoginErrorMessage {
  if (
    loginErrors?.shop === LoginErrorType.MissingShop ||
    loginErrors?.shop === LoginErrorType.InvalidShop
  ) {
    return {
      shop: "Open this app from your Shopify admin under Apps.",
    };
  }

  return {};
}
