<?php
declare(strict_types=1);

namespace Scopevisio\Connector\Observer;

use Magento\Framework\Event\Observer;
use Magento\Framework\Event\ObserverInterface;
use Magento\Sales\Model\Order\Creditmemo;
use Psr\Log\LoggerInterface;
use Scopevisio\Connector\Model\Config;
use Scopevisio\Connector\Model\Outbox;

/** Records a credit memo (refund) in the outbox. Same guarantees as InvoiceSaved. */
class CreditmemoSaved implements ObserverInterface
{
    public function __construct(
        private readonly Outbox $outbox,
        private readonly Config $config,
        private readonly LoggerInterface $logger
    ) {
    }

    public function execute(Observer $observer): void
    {
        /** @var Creditmemo|null $memo */
        $memo = $observer->getEvent()->getData('creditmemo');
        if (!$memo || !$memo->getId() || (int)$memo->getState() === Creditmemo::STATE_CANCELED) {
            return;
        }
        try {
            if (!$this->config->isEnabled()) {
                return;
            }
            $this->outbox->enqueue(Outbox::EVENT_CREDITMEMO_CREATED, (int)$memo->getId(), (int)$memo->getOrderId());
        } catch (\Throwable $e) {
            $this->logger->error('Scopevisio: could not enqueue credit memo', [
                'creditmemo_id' => $memo->getId(),
                'exception' => $e,
            ]);
        }
    }
}
