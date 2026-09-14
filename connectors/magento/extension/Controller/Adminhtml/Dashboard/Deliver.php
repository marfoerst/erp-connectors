<?php
declare(strict_types=1);

namespace Scopevisio\Connector\Controller\Adminhtml\Dashboard;

use Magento\Backend\App\Action;
use Magento\Backend\App\Action\Context;
use Magento\Framework\App\Action\HttpPostActionInterface;
use Magento\Framework\Controller\Result\Redirect;
use Scopevisio\Connector\Model\Delivery;
use Scopevisio\Connector\Model\Outbox;

/** "Send now" and "Retry failed" on the dashboard. POST with form key only. */
class Deliver extends Action implements HttpPostActionInterface
{
    public const ADMIN_RESOURCE = 'Scopevisio_Connector::dashboard';

    public function __construct(
        Context $context,
        private readonly Delivery $delivery,
        private readonly Outbox $outbox
    ) {
        parent::__construct($context);
    }

    public function execute(): Redirect
    {
        if ($this->getRequest()->getParam('retry_failed')) {
            $requeued = $this->outbox->retryFailed();
            $this->messageManager->addNoticeMessage(__('%1 failed event(s) were put back in the queue.', $requeued));
        }

        $result = $this->delivery->run(200);
        if ($result['skipped'] !== null) {
            $this->messageManager->addWarningMessage(__('Nothing was sent: %1', $result['skipped']));
        } elseif ($result['failed'] > 0) {
            $this->messageManager->addErrorMessage(
                __('%1 event(s) delivered, %2 failed and will be retried.', $result['delivered'], $result['failed'])
            );
        } else {
            $this->messageManager->addSuccessMessage(__('%1 event(s) delivered.', $result['delivered']));
        }
        return $this->resultRedirectFactory->create()->setPath('scopevisio/dashboard/index');
    }
}
