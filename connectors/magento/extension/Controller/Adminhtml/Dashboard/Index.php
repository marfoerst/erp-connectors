<?php
declare(strict_types=1);

namespace Scopevisio\Connector\Controller\Adminhtml\Dashboard;

use Magento\Backend\App\Action;
use Magento\Backend\App\Action\Context;
use Magento\Framework\App\Action\HttpGetActionInterface;
use Magento\Framework\View\Result\Page;
use Magento\Framework\View\Result\PageFactory;

class Index extends Action implements HttpGetActionInterface
{
    public const ADMIN_RESOURCE = 'Scopevisio_Connector::dashboard';

    public function __construct(Context $context, private readonly PageFactory $pageFactory)
    {
        parent::__construct($context);
    }

    public function execute(): Page
    {
        $page = $this->pageFactory->create();
        $page->setActiveMenu('Scopevisio_Connector::dashboard');
        $page->getConfig()->getTitle()->prepend(__('Scopevisio ERP'));
        return $page;
    }
}
