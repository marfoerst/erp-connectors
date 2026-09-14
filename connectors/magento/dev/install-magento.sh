#!/usr/bin/env bash
# Installs Magento 2.4.9 with Luma sample data and German tax settings.
# Runs inside the `magento` container. Idempotent enough to re-run after a
# failure: each stage checks whether it already happened.
set -euo pipefail

ROOT=/var/www/html
VERSION=2.4.9
MIRROR=https://mirror.mage-os.org/
ADMIN_USER=admin
ADMIN_PASSWORD='Admin12345!'

cd "$ROOT"
mage() { php -d memory_limit=-1 bin/magento "$@"; }

if [ ! -f composer.json ]; then
  echo "==> composer create-project magento/project-community-edition=$VERSION"
  # The target already holds the bind-mounted extension, so create elsewhere
  # and copy in.
  rm -rf /tmp/mage
  composer create-project --no-install --no-interaction \
    --repository-url="$MIRROR" "magento/project-community-edition=$VERSION" /tmp/mage
  cp -a /tmp/mage/. "$ROOT"/
  composer config repositories.0 composer "$MIRROR"
fi

if [ ! -d vendor/magento/framework ]; then
  echo "==> composer install"
  composer install --no-interaction --prefer-dist
fi

if [ ! -f app/etc/env.php ]; then
  echo "==> setup:install"
  mage setup:install \
    --base-url=http://localhost:8080/ \
    --db-host=db --db-name=magento --db-user=magento --db-password=magento \
    --admin-firstname=Admin --admin-lastname=Scopevisio \
    --admin-email=admin@example.invalid \
    --admin-user="$ADMIN_USER" --admin-password="$ADMIN_PASSWORD" \
    --language=de_DE --currency=EUR --timezone=Europe/Berlin \
    --use-rewrites=1 --backend-frontname=admin \
    --search-engine=opensearch --opensearch-host=opensearch --opensearch-port=9200 \
    --disable-modules=Magento_TwoFactorAuth,Magento_AdminAdobeImsTwoFactorAuth \
    --cleanup-database
fi

if [ ! -d vendor/magento/module-catalog-sample-data ]; then
  echo "==> sample data"
  mage sampledata:deploy
  mage setup:upgrade
fi

echo "==> German shop settings"
mage config:set general/country/default DE
mage config:set general/locale/code de_DE
mage config:set shipping/origin/country_id DE
mage config:set tax/defaults/country DE
# A German shop prices gross. This exercises the connector's gross handling,
# which is the case that broke the Shopware connector on its first live order.
mage config:set tax/calculation/price_includes_tax 1
mage config:set tax/calculation/shipping_includes_tax 1
mage config:set tax/classes/shipping_tax_class 2
mage config:set tax/display/type 2
mage config:set tax/display/shipping 2
mage config:set tax/cart_display/price 2
mage config:set tax/cart_display/subtotal 2
mage config:set tax/cart_display/shipping 2
mage config:set tax/sales_display/price 2
mage config:set tax/sales_display/subtotal 2
mage config:set tax/sales_display/shipping 2
mage config:set admin/security/use_form_key 1
mage config:set admin/security/session_lifetime 86400

echo "==> Tax rates: DE 19%, and 19% for EU B2C (a non-OSS merchant charges home VAT)"
mysql -hdb -umagento -pmagento magento <<'SQL'
DELETE FROM tax_calculation WHERE tax_calculation_rule_id IN
  (SELECT tax_calculation_rule_id FROM tax_calculation_rule WHERE code = 'DE 19%');
DELETE FROM tax_calculation_rule WHERE code = 'DE 19%';
DELETE FROM tax_calculation_rate WHERE code LIKE 'SV-%';

INSERT INTO tax_calculation_rate (tax_country_id, tax_region_id, tax_postcode, code, rate) VALUES
  ('DE', 0, '*', 'SV-DE-19', 19.0000),
  ('AT', 0, '*', 'SV-AT-19', 19.0000),
  ('FR', 0, '*', 'SV-FR-19', 19.0000),
  ('NL', 0, '*', 'SV-NL-19', 19.0000);

INSERT INTO tax_calculation_rule (code, priority, position, calculate_subtotal)
  VALUES ('DE 19%', 0, 0, 0);
SET @rule = LAST_INSERT_ID();

INSERT INTO tax_calculation (tax_calculation_rate_id, tax_calculation_rule_id, customer_tax_class_id, product_tax_class_id)
  SELECT r.tax_calculation_rate_id, @rule, 3, 2 FROM tax_calculation_rate r WHERE r.code LIKE 'SV-%';
SQL

if mage module:status Scopevisio_Connector 2>/dev/null | grep -q 'disabled'; then
  echo "==> enable Scopevisio_Connector"
  mage module:enable Scopevisio_Connector
  mage setup:upgrade
fi

mage deploy:mode:set developer || true
mage indexer:reindex || true
mage cache:flush

chown -R www-data:www-data "$ROOT"
echo "==> done: http://localhost:8080/  admin: http://localhost:8080/admin ($ADMIN_USER / $ADMIN_PASSWORD)"
