<?php
declare(strict_types=1);

namespace Scopevisio\Connector\Model;

use Magento\Framework\HTTP\Client\CurlFactory;
use Magento\Framework\Lock\LockManagerInterface;
use Magento\Store\Model\StoreManagerInterface;
use Psr\Log\LoggerInterface;

/**
 * Delivers due outbox rows to the connector.
 *
 * The payload names the entity and nothing else of substance. The connector
 * fetches the invoice and order over the REST API with its own integration
 * token, so what it books is always Magento's current, authoritative record —
 * never a snapshot that a signature merely vouches for.
 */
class Delivery
{
    private const LOCK = 'scopevisio_outbox_delivery';

    public function __construct(
        private readonly Outbox $outbox,
        private readonly Config $config,
        private readonly IntegrationLocator $integrations,
        private readonly Signer $signer,
        private readonly CurlFactory $curlFactory,
        private readonly StoreManagerInterface $storeManager,
        private readonly LockManagerInterface $locks,
        private readonly LoggerInterface $logger
    ) {
    }

    /**
     * @return array{delivered: int, failed: int, skipped: ?string}
     */
    public function run(int $limit = 50): array
    {
        $result = ['delivered' => 0, 'failed' => 0, 'skipped' => null];

        if (!$this->config->isEnabled()) {
            $result['skipped'] = 'disabled';
            return $result;
        }
        $url = $this->config->getConnectorUrl();
        if ($url === '') {
            $result['skipped'] = 'no_connector_url';
            return $result;
        }
        $consumer = $this->integrations->consumer();
        if ($consumer === null || !$this->integrations->isConnected()) {
            // Rows stay pending. Once the merchant activates the integration
            // they go out in order, with nothing lost in between.
            $result['skipped'] = 'integration_not_active';
            return $result;
        }

        // Cron and the admin "send now" button must not deliver the same row twice.
        if (!$this->locks->lock(self::LOCK, 0)) {
            $result['skipped'] = 'locked';
            return $result;
        }

        try {
            $storeBaseUrl = (string)$this->storeManager->getDefaultStoreView()?->getBaseUrl();
            foreach ($this->outbox->due($limit) as $row) {
                $body = json_encode(
                    [
                        'event' => $row['event'],
                        'entityId' => (int)$row['entity_id'],
                        'orderId' => $row['order_id'] !== null ? (int)$row['order_id'] : null,
                        'outboxId' => (int)$row['outbox_id'],
                        'storeBaseUrl' => $storeBaseUrl,
                        'createdAt' => $row['created_at'],
                    ],
                    JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR
                );
                $timestamp = (string)time();

                try {
                    $curl = $this->curlFactory->create();
                    $curl->setTimeout(15);
                    $curl->addHeader('Content-Type', 'application/json');
                    $curl->addHeader('X-Scopevisio-Consumer-Key', (string)$consumer->getKey());
                    $curl->addHeader('X-Scopevisio-Timestamp', $timestamp);
                    $curl->addHeader(
                        'X-Scopevisio-Signature',
                        $this->signer->signWebhook((string)$consumer->getSecret(), $timestamp, $body)
                    );
                    $curl->post($url . '/magento/webhook', $body);
                    $status = $curl->getStatus();

                    if ($status >= 200 && $status < 300) {
                        $this->outbox->markDelivered((int)$row['outbox_id']);
                        $result['delivered']++;
                        continue;
                    }
                    $error = sprintf('HTTP %d: %s', $status, mb_substr((string)$curl->getBody(), 0, 500));
                } catch (\Throwable $e) {
                    $error = $e->getMessage();
                }

                $this->outbox->markAttemptFailed((int)$row['outbox_id'], (int)$row['attempts'], $error);
                $result['failed']++;
                $this->logger->warning('Scopevisio outbox delivery failed', [
                    'outbox_id' => $row['outbox_id'],
                    'error' => $error,
                ]);
            }
        } finally {
            $this->locks->unlock(self::LOCK);
        }

        return $result;
    }
}
