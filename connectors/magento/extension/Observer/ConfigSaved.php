<?php
declare(strict_types=1);

namespace Scopevisio\Connector\Observer;

use Magento\Framework\Event\Observer;
use Magento\Framework\Event\ObserverInterface;
use Magento\Framework\Message\ManagerInterface;
use Scopevisio\Connector\Model\Config;
use Scopevisio\Connector\Model\IntegrationProvisioner;

/**
 * On saving the configuration: create or update the Scopevisio integration
 * with URLs pointing at the configured connector, and pin the sync start.
 */
class ConfigSaved implements ObserverInterface
{
    public function __construct(
        private readonly Config $config,
        private readonly IntegrationProvisioner $provisioner,
        private readonly ManagerInterface $messages
    ) {
    }

    public function execute(Observer $observer): void
    {
        if (!$this->config->isEnabled() || $this->config->getConnectorUrl() === '') {
            return;
        }
        try {
            $this->config->ensureSyncFrom();
            $integration = $this->provisioner->provision($this->config->getConnectorUrl());
            $this->messages->addNoticeMessage(
                $integration->getStatus()
                    ? __('The Scopevisio integration is up to date.')
                    : __('The Scopevisio integration was prepared. Activate it under System > Integrations to connect this store.')
            );
        } catch (\Throwable $e) {
            $this->messages->addErrorMessage(
                __('The Scopevisio integration could not be prepared: %1', $e->getMessage())
            );
        }
    }
}
