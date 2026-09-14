<?php
declare(strict_types=1);

namespace Scopevisio\Connector\Console\Command;

use Magento\Framework\App\Area;
use Magento\Framework\App\State;
use Scopevisio\Connector\Model\Delivery;
use Scopevisio\Connector\Model\Outbox;
use Symfony\Component\Console\Command\Command;
use Symfony\Component\Console\Input\InputInterface;
use Symfony\Component\Console\Input\InputOption;
use Symfony\Component\Console\Output\OutputInterface;

/** bin/magento scopevisio:outbox:deliver [--retry-failed] */
class DeliverCommand extends Command
{
    public function __construct(
        private readonly Delivery $delivery,
        private readonly Outbox $outbox,
        private readonly State $state
    ) {
        parent::__construct();
    }

    protected function configure(): void
    {
        $this->setName('scopevisio:outbox:deliver')
            ->setDescription('Send pending Scopevisio outbox events now, and show the queue.')
            ->addOption('retry-failed', null, InputOption::VALUE_NONE, 'Requeue events that exhausted their retries first.');
    }

    protected function execute(InputInterface $input, OutputInterface $output): int
    {
        try {
            $this->state->setAreaCode(Area::AREA_CRONTAB);
        } catch (\Throwable) {
            // Already set.
        }

        if ($input->getOption('retry-failed')) {
            $output->writeln(sprintf('<info>Requeued %d failed event(s).</info>', $this->outbox->retryFailed()));
        }

        $result = $this->delivery->run(500);
        if ($result['skipped'] !== null) {
            $output->writeln(sprintf('<comment>Nothing sent: %s</comment>', $result['skipped']));
        } else {
            $output->writeln(sprintf('Delivered %d, failed %d.', $result['delivered'], $result['failed']));
        }

        foreach ($this->outbox->counts() as $status => $n) {
            $output->writeln(sprintf('  %-10s %d', $status, $n));
        }
        return $result['failed'] > 0 ? Command::FAILURE : Command::SUCCESS;
    }
}
