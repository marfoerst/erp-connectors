<?php
declare(strict_types=1);

namespace Scopevisio\Connector\Console\Command;

use Magento\Framework\App\Area;
use Magento\Framework\App\Config\ReinitableConfigInterface;
use Magento\Framework\App\Config\Storage\WriterInterface;
use Magento\Framework\App\State;
use Scopevisio\Connector\Model\Config;
use Scopevisio\Connector\Model\IntegrationProvisioner;
use Symfony\Component\Console\Command\Command;
use Symfony\Component\Console\Input\InputInterface;
use Symfony\Component\Console\Input\InputOption;
use Symfony\Component\Console\Output\OutputInterface;

/**
 * bin/magento scopevisio:integration:setup --connector-url=https://… --enable --activate
 *
 * The same as saving the configuration and pressing Activate in the admin,
 * for installs that are provisioned by script.
 */
class SetupCommand extends Command
{
    public function __construct(
        private readonly IntegrationProvisioner $provisioner,
        private readonly Config $config,
        private readonly State $state,
        private readonly WriterInterface $writer,
        private readonly ReinitableConfigInterface $reinitableConfig
    ) {
        parent::__construct();
    }

    protected function configure(): void
    {
        $this->setName('scopevisio:integration:setup')
            ->setDescription('Create or update the Scopevisio integration, and optionally activate it.')
            ->addOption('connector-url', null, InputOption::VALUE_REQUIRED, 'Connector base URL')
            ->addOption('enable', null, InputOption::VALUE_NONE, 'Switch sending on')
            ->addOption('activate', null, InputOption::VALUE_NONE, 'Run the OAuth handshake with the connector')
            ->addOption('reauthorize', null, InputOption::VALUE_NONE, 'Discard the current token and handshake again');
    }

    protected function execute(InputInterface $input, OutputInterface $output): int
    {
        try {
            $this->state->setAreaCode(Area::AREA_ADMINHTML);
        } catch (\Throwable) {
            // Already set.
        }

        if ($url = $input->getOption('connector-url')) {
            $this->writer->save(Config::XML_CONNECTOR_URL, rtrim((string)$url, '/'));
        }
        if ($input->getOption('enable')) {
            $this->writer->save(Config::XML_ENABLED, '1');
        }
        $this->reinitableConfig->reinit();

        $connectorUrl = $this->config->getConnectorUrl();
        if ($connectorUrl === '') {
            $output->writeln('<error>No connector URL configured. Pass --connector-url.</error>');
            return Command::FAILURE;
        }
        if ($this->config->isEnabled()) {
            $output->writeln('Sending invoices paid since ' . $this->config->ensureSyncFrom() . ' UTC.');
        }

        $integration = $this->provisioner->provision($connectorUrl);
        $output->writeln(sprintf(
            'Integration "%s" (id %d) → %s',
            $integration->getName(),
            $integration->getId(),
            $integration->getEndpoint()
        ));

        $reauthorize = (bool)$input->getOption('reauthorize');
        if ($input->getOption('activate') || $reauthorize) {
            if (!$this->provisioner->activate($reauthorize)) {
                $output->writeln('<error>The connector did not complete the OAuth exchange within 30 seconds.</error>');
                return Command::FAILURE;
            }
            $output->writeln('<info>Activated. The connector holds an access token.</info>');
        }
        return Command::SUCCESS;
    }
}
