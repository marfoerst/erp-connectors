<?php
declare(strict_types=1);

namespace Scopevisio\Connector\Observer;

use Magento\Framework\Event\Observer;
use Magento\Framework\Event\ObserverInterface;
use Magento\Sales\Model\Order\Invoice;
use Psr\Log\LoggerInterface;
use Scopevisio\Connector\Model\Config;
use Scopevisio\Connector\Model\Outbox;

/**
 * Records a paid invoice in the outbox.
 *
 * Fires on every save of every invoice; only the paid ones matter. An invoice
 * created open (authorize-only payment) and captured later is picked up on the
 * save that makes it paid. Enqueueing is idempotent, so repeated saves of a
 * paid invoice do nothing.
 *
 * Never throws: this runs on the checkout and invoicing path, and the ERP must
 * not be able to break a sale. A failure is logged and the sweep job catches
 * the invoice within fifteen minutes.
 */
class InvoiceSaved implements ObserverInterface
{
    public function __construct(
        private readonly Outbox $outbox,
        private readonly Config $config,
        private readonly LoggerInterface $logger
    ) {
    }

    public function execute(Observer $observer): void
    {
        /** @var Invoice|null $invoice */
        $invoice = $observer->getEvent()->getData('invoice');
        if (!$invoice || !$invoice->getId() || (int)$invoice->getState() !== Invoice::STATE_PAID) {
            return;
        }
        try {
            if (!$this->config->isEnabled()) {
                return;
            }
            $this->outbox->enqueue(Outbox::EVENT_INVOICE_PAID, (int)$invoice->getId(), (int)$invoice->getOrderId());
        } catch (\Throwable $e) {
            $this->logger->error('Scopevisio: could not enqueue paid invoice', [
                'invoice_id' => $invoice->getId(),
                'exception' => $e,
            ]);
        }
    }
}
