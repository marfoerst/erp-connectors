<?php
declare(strict_types=1);

namespace Scopevisio\Connector\Cron;

use Scopevisio\Connector\Model\Config;
use Scopevisio\Connector\Model\Outbox;

class Sweep
{
    public function __construct(
        private readonly Config $config,
        private readonly Outbox $outbox
    ) {
    }

    public function execute(): void
    {
        $since = $this->config->getSyncFrom();
        if (!$this->config->isEnabled() || $since === null) {
            return;
        }
        $this->outbox->sweep($since);
    }
}
