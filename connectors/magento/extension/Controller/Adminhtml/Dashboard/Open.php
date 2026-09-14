<?php
declare(strict_types=1);

namespace Scopevisio\Connector\Controller\Adminhtml\Dashboard;

use Magento\Backend\App\Action;
use Magento\Backend\App\Action\Context;
use Magento\Backend\Model\Auth\Session;
use Magento\Framework\App\Action\HttpGetActionInterface;
use Magento\Framework\Controller\Result\Redirect;
use Scopevisio\Connector\Model\Config;
use Scopevisio\Connector\Model\IntegrationLocator;
use Scopevisio\Connector\Model\Signer;

/**
 * Opens the connector's own screens (mapping, review queue, CSV export) for
 * the logged-in admin.
 *
 * The link is signed at click time and valid for five minutes, so it cannot be
 * bookmarked or forwarded into a standing session. Magento's ACL decides who
 * may click it; the connector trusts nothing but the signature.
 */
class Open extends Action implements HttpGetActionInterface
{
    public const ADMIN_RESOURCE = 'Scopevisio_Connector::dashboard';

    public function __construct(
        Context $context,
        private readonly Config $config,
        private readonly IntegrationLocator $integrations,
        private readonly Signer $signer,
        private readonly Session $authSession
    ) {
        parent::__construct($context);
    }

    public function execute(): Redirect
    {
        $redirect = $this->resultRedirectFactory->create();
        $consumer = $this->integrations->consumer();
        $url = $this->config->getConnectorUrl();

        if ($consumer === null || $url === '' || !$this->integrations->isConnected()) {
            $this->messageManager->addErrorMessage(
                __('Activate the Scopevisio integration under System > Integrations first.')
            );
            return $redirect->setPath('scopevisio/dashboard/index');
        }

        $user = (string)$this->authSession->getUser()?->getUserName();
        $ts = (string)time();
        $query = http_build_query([
            'consumer_key' => $consumer->getKey(),
            'ts' => $ts,
            'user' => $user,
            'signature' => $this->signer->signAdminLink((string)$consumer->getSecret(), (string)$consumer->getKey(), $ts, $user),
        ]);
        return $redirect->setUrl($url . '/magento/admin?' . $query);
    }
}
