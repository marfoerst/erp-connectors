<?php
declare(strict_types=1);

namespace Scopevisio\Connector\Block\Adminhtml;

use Magento\Backend\Block\Template;
use Magento\Backend\Block\Template\Context;
use Scopevisio\Connector\Model\Config;
use Scopevisio\Connector\Model\IntegrationLocator;
use Scopevisio\Connector\Model\Outbox;

class Dashboard extends Template
{
    public function __construct(
        Context $context,
        private readonly Config $config,
        private readonly IntegrationLocator $integrations,
        private readonly Outbox $outbox,
        array $data = []
    ) {
        parent::__construct($context, $data);
    }

    public function isEnabled(): bool
    {
        return $this->config->isEnabled();
    }

    public function getConnectorUrl(): string
    {
        return $this->config->getConnectorUrl();
    }

    public function getSyncFrom(): ?string
    {
        return $this->config->getSyncFrom();
    }

    public function hasIntegration(): bool
    {
        return $this->integrations->find() !== null;
    }

    public function isConnected(): bool
    {
        return $this->integrations->isConnected();
    }

    /** @return array<string, int> */
    public function getCounts(): array
    {
        return $this->outbox->counts();
    }

    /** @return array<int, array<string, mixed>> */
    public function getRecent(): array
    {
        return $this->outbox->recent(25);
    }

    public function getConfigUrl(): string
    {
        return $this->getUrl('adminhtml/system_config/edit', ['section' => 'scopevisio']);
    }

    public function getIntegrationsUrl(): string
    {
        return $this->getUrl('adminhtml/integration/index');
    }

    public function getOpenUrl(): string
    {
        return $this->getUrl('scopevisio/dashboard/open');
    }

    public function getDeliverUrl(): string
    {
        return $this->getUrl('scopevisio/dashboard/deliver');
    }
}
