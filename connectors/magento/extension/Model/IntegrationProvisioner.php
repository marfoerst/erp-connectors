<?php
declare(strict_types=1);

namespace Scopevisio\Connector\Model;

use Magento\Framework\Exception\LocalizedException;
use Magento\Integration\Api\IntegrationServiceInterface;
use Magento\Integration\Api\OauthServiceInterface;
use Magento\Integration\Model\Integration;

/**
 * Creates and activates the Scopevisio integration.
 *
 * Created programmatically rather than from etc/integration.xml because its
 * endpoint and identity URLs are the merchant's connector host, which is
 * configuration, not code.
 */
class IntegrationProvisioner
{
    /**
     * Exactly what the connector reads, and nothing it could write with:
     * orders (GET /V1/orders/:id), invoices (GET /V1/invoices, /V1/invoices/:id)
     * and credit memos (GET /V1/creditmemo/:id, /V1/creditmemos). Parents are
     * listed because the admin role editor shows a child without its parent
     * as unchecked.
     */
    public const RESOURCES = [
        'Magento_Sales::sales',
        'Magento_Sales::sales_operation',
        'Magento_Sales::sales_order',
        'Magento_Sales::actions',
        'Magento_Sales::actions_view',
        'Magento_Sales::sales_invoice',
        'Magento_Sales::sales_creditmemo',
    ];

    public function __construct(
        private readonly IntegrationServiceInterface $integrationService,
        private readonly OauthServiceInterface $oauthService,
        private readonly IntegrationLocator $locator
    ) {
    }

    public function provision(string $connectorUrl): Integration
    {
        $connectorUrl = rtrim($connectorUrl, '/');
        $data = [
            Integration::NAME => IntegrationLocator::NAME,
            Integration::EMAIL => '',
            Integration::ENDPOINT => $connectorUrl . '/magento/integration/endpoint',
            Integration::IDENTITY_LINK_URL => $connectorUrl . '/magento/integration/identity',
            Integration::SETUP_TYPE => Integration::TYPE_MANUAL,
            'resource' => self::RESOURCES,
        ];

        $existing = $this->locator->find();
        if ($existing === null) {
            return $this->integrationService->create($data);
        }
        $data[Integration::ID] = $existing->getId();
        $data[Integration::STATUS] = $existing->getStatus();
        return $this->integrationService->update($data);
    }

    /**
     * What the admin's Activate → Allow does, for headless installs: post the
     * consumer credentials to the connector and wait for it to finish the OAuth
     * exchange.
     */
    public function activate(bool $reauthorize = false, int $waitSeconds = 30): bool
    {
        $integration = $this->locator->find();
        if ($integration === null) {
            throw new LocalizedException(__('The Scopevisio integration does not exist yet.'));
        }
        $consumerId = (int)$integration->getConsumerId();

        if ($reauthorize) {
            $this->oauthService->deleteIntegrationToken($consumerId);
            $integration->setStatus(Integration::STATUS_INACTIVE)->save();
        }

        $this->oauthService->postToConsumer($consumerId, $integration->getEndpoint());

        $deadline = time() + $waitSeconds;
        do {
            if ($this->oauthService->getAccessToken($consumerId) !== false) {
                $integration->setStatus(Integration::STATUS_ACTIVE)->save();
                return true;
            }
            sleep(1);
        } while (time() < $deadline);

        return false;
    }
}
