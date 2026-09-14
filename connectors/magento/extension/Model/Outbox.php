<?php
declare(strict_types=1);

namespace Scopevisio\Connector\Model;

use Magento\Framework\App\ResourceConnection;
use Magento\Framework\DB\Adapter\AdapterInterface;

/**
 * Durable queue of events for the connector.
 *
 * All timestamps are UTC, matching sales_invoice.created_at.
 */
class Outbox
{
    public const TABLE = 'scopevisio_outbox';

    public const EVENT_INVOICE_PAID = 'invoice.paid';
    public const EVENT_CREDITMEMO_CREATED = 'creditmemo.created';

    public const STATUS_PENDING = 'pending';
    public const STATUS_DELIVERED = 'delivered';
    public const STATUS_FAILED = 'failed';

    /** About four days of exponential backoff, capped at six hours per wait. */
    public const MAX_ATTEMPTS = 20;

    /** sales_invoice.state for Magento\Sales\Model\Order\Invoice::STATE_PAID */
    private const INVOICE_STATE_PAID = 2;

    public function __construct(private readonly ResourceConnection $resource)
    {
    }

    private function connection(): AdapterInterface
    {
        return $this->resource->getConnection();
    }

    private function table(string $name = self::TABLE): string
    {
        return $this->resource->getTableName($name);
    }

    /** Returns true when a new row was written, false when it already existed. */
    public function enqueue(string $event, int $entityId, ?int $orderId): bool
    {
        $written = $this->connection()->insertArray(
            $this->table(),
            ['event', 'entity_id', 'order_id', 'next_attempt_at'],
            [[$event, $entityId, $orderId, gmdate('Y-m-d H:i:s')]],
            AdapterInterface::INSERT_IGNORE
        );
        return $written > 0;
    }

    /** @return array<int, array<string, mixed>> */
    public function due(int $limit): array
    {
        $select = $this->connection()->select()
            ->from($this->table())
            ->where('status = ?', self::STATUS_PENDING)
            ->where('next_attempt_at <= ?', gmdate('Y-m-d H:i:s'))
            ->order('outbox_id ASC')
            ->limit($limit);
        return $this->connection()->fetchAll($select);
    }

    public function markDelivered(int $outboxId): void
    {
        $this->connection()->update(
            $this->table(),
            [
                'status' => self::STATUS_DELIVERED,
                'delivered_at' => gmdate('Y-m-d H:i:s'),
                'last_error' => null,
                'attempts' => new \Zend_Db_Expr('attempts + 1'),
            ],
            ['outbox_id = ?' => $outboxId]
        );
    }

    public function markAttemptFailed(int $outboxId, int $attemptsSoFar, string $error): void
    {
        $attempts = $attemptsSoFar + 1;
        $waitMinutes = min(2 ** $attempts, 360);
        $this->connection()->update(
            $this->table(),
            [
                'status' => $attempts >= self::MAX_ATTEMPTS ? self::STATUS_FAILED : self::STATUS_PENDING,
                'attempts' => $attempts,
                'last_error' => mb_substr($error, 0, 2000),
                'next_attempt_at' => gmdate('Y-m-d H:i:s', time() + $waitMinutes * 60),
            ],
            ['outbox_id = ?' => $outboxId]
        );
    }

    /** Put exhausted rows back in the queue, e.g. after the connector was down for days. */
    public function retryFailed(): int
    {
        return $this->connection()->update(
            $this->table(),
            ['status' => self::STATUS_PENDING, 'attempts' => 0, 'next_attempt_at' => gmdate('Y-m-d H:i:s')],
            ['status = ?' => self::STATUS_FAILED]
        );
    }

    /** @return array<string, int> */
    public function counts(): array
    {
        $select = $this->connection()->select()
            ->from($this->table(), ['status', 'n' => new \Zend_Db_Expr('COUNT(*)')])
            ->group('status');
        $counts = [self::STATUS_PENDING => 0, self::STATUS_DELIVERED => 0, self::STATUS_FAILED => 0];
        foreach ($this->connection()->fetchPairs($select) as $status => $n) {
            $counts[(string)$status] = (int)$n;
        }
        return $counts;
    }

    /** @return array<int, array<string, mixed>> */
    public function recent(int $limit = 20): array
    {
        $select = $this->connection()->select()
            ->from($this->table())
            ->order('outbox_id DESC')
            ->limit($limit);
        return $this->connection()->fetchAll($select);
    }

    /**
     * Enqueue paid invoices and credit memos the observer did not see.
     *
     * Bounded below by $since — the moment the merchant first switched the
     * connector on. Invoices from before then were booked some other way, and
     * sending them now would book them twice.
     *
     * @return int rows added
     */
    public function sweep(string $since): int
    {
        $connection = $this->connection();
        $added = 0;

        $invoices = $connection->select()
            ->from(
                $this->table('sales_invoice'),
                [
                    'event' => new \Zend_Db_Expr($connection->quote(self::EVENT_INVOICE_PAID)),
                    'entity_id',
                    'order_id',
                ]
            )
            ->where('state = ?', self::INVOICE_STATE_PAID)
            ->where('created_at >= ?', $since);
        $added += $connection->query(
            $connection->insertFromSelect(
                $invoices,
                $this->table(),
                ['event', 'entity_id', 'order_id'],
                AdapterInterface::INSERT_IGNORE
            )
        )->rowCount();

        $memos = $connection->select()
            ->from(
                $this->table('sales_creditmemo'),
                [
                    'event' => new \Zend_Db_Expr($connection->quote(self::EVENT_CREDITMEMO_CREATED)),
                    'entity_id',
                    'order_id',
                ]
            )
            ->where('created_at >= ?', $since);
        $added += $connection->query(
            $connection->insertFromSelect(
                $memos,
                $this->table(),
                ['event', 'entity_id', 'order_id'],
                AdapterInterface::INSERT_IGNORE
            )
        )->rowCount();

        return $added;
    }
}
