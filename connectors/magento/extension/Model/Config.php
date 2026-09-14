<?php
declare(strict_types=1);

namespace Scopevisio\Connector\Model;

use Magento\Framework\App\Config\ScopeConfigInterface;
use Magento\Framework\App\Config\Storage\WriterInterface;
use Magento\Framework\App\Config\ReinitableConfigInterface;

class Config
{
    public const XML_ENABLED = 'scopevisio/general/enabled';
    public const XML_CONNECTOR_URL = 'scopevisio/general/connector_url';
    /** UTC timestamp of the first enable. Nothing paid earlier is ever sent. */
    public const XML_SYNC_FROM = 'scopevisio/general/sync_from';

    public function __construct(
        private readonly ScopeConfigInterface $scopeConfig,
        private readonly WriterInterface $writer,
        private readonly ReinitableConfigInterface $reinitableConfig
    ) {
    }

    public function isEnabled(): bool
    {
        return $this->scopeConfig->isSetFlag(self::XML_ENABLED);
    }

    public function getConnectorUrl(): string
    {
        return rtrim(trim((string)$this->scopeConfig->getValue(self::XML_CONNECTOR_URL)), '/');
    }

    public function getSyncFrom(): ?string
    {
        $value = trim((string)$this->scopeConfig->getValue(self::XML_SYNC_FROM));
        return $value !== '' ? $value : null;
    }

    /** Set once, on the first enable, and never moved afterwards. */
    public function ensureSyncFrom(): string
    {
        $existing = $this->getSyncFrom();
        if ($existing !== null) {
            return $existing;
        }
        $now = gmdate('Y-m-d H:i:s');
        $this->writer->save(self::XML_SYNC_FROM, $now);
        $this->reinitableConfig->reinit();
        return $now;
    }
}
