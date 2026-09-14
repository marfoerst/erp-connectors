<?php
declare(strict_types=1);

namespace Scopevisio\Connector\Cron;

use Scopevisio\Connector\Model\Delivery;

class Deliver
{
    public function __construct(private readonly Delivery $delivery)
    {
    }

    public function execute(): void
    {
        $this->delivery->run();
    }
}
