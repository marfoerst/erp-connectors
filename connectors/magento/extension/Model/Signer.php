<?php
declare(strict_types=1);

namespace Scopevisio\Connector\Model;

/**
 * Signatures the connector verifies (connectors/magento/src/signature.ts).
 *
 * Keyed with the integration's OAuth consumer secret, which Magento already
 * shared with the connector during activation — so there is no second secret
 * to configure, and deactivating the integration revokes both at once.
 */
class Signer
{
    public function signWebhook(string $consumerSecret, string $timestamp, string $body): string
    {
        return hash_hmac('sha256', $timestamp . '.' . $body, $consumerSecret);
    }

    public function signAdminLink(string $consumerSecret, string $consumerKey, string $timestamp, string $user): string
    {
        return hash_hmac('sha256', 'admin|' . $consumerKey . '|' . $timestamp . '|' . $user, $consumerSecret);
    }
}
