<?php
declare(strict_types=1);

namespace Scopevisio\Connector\Model;

use Magento\Integration\Api\IntegrationServiceInterface;
use Magento\Integration\Api\OauthServiceInterface;
use Magento\Integration\Model\Integration;
use Magento\Integration\Model\Oauth\Consumer;

/** Finds the Scopevisio integration and its OAuth consumer. */
class IntegrationLocator
{
    public const NAME = 'Scopevisio';

    public function __construct(
        private readonly IntegrationServiceInterface $integrationService,
        private readonly OauthServiceInterface $oauthService
    ) {
    }

    public function find(): ?Integration
    {
        $integration = $this->integrationService->findByName(self::NAME);
        return $integration->getId() ? $integration : null;
    }

    public function consumer(): ?Consumer
    {
        $integration = $this->find();
        if (!$integration || !$integration->getConsumerId()) {
            return null;
        }
        $consumer = $this->oauthService->loadConsumer($integration->getConsumerId());
        return $consumer->getId() ? $consumer : null;
    }

    /** True once the connector completed the OAuth exchange and holds an access token. */
    public function isConnected(): bool
    {
        $integration = $this->find();
        return $integration !== null
            && $integration->getConsumerId()
            && $this->oauthService->getAccessToken($integration->getConsumerId()) !== false;
    }
}
