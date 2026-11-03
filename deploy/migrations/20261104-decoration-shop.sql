-- The decoration shop: a quote fixes one coin amount for one or more priced decorations, the buyer
-- pays it to the treasury in a single plain transfer, and confirming the transfer onchain grants
-- them all. See src/lib/decorationShop.js. Times are unix seconds; amount_wei is the quoted coin
-- amount as text, since it outgrows BIGINT; price_usd is the order's total. decoration_ids is the
-- comma-joined catalog ids. tx_hash is unique so one transfer can only ever pay for one order.

CREATE TABLE IF NOT EXISTS decoration_orders (
  id CHAR(32) NOT NULL,
  buyer_address VARCHAR(42) NOT NULL,
  recipient_address VARCHAR(42) NOT NULL,
  decoration_ids VARCHAR(255) NOT NULL,
  network_id INT UNSIGNED NOT NULL,
  amount_wei VARCHAR(78) NOT NULL,
  price_usd DECIMAL(10, 2) NOT NULL,
  coin_usd_price DECIMAL(24, 10) NOT NULL,
  created_at BIGINT UNSIGNED NOT NULL,
  expires_at BIGINT UNSIGNED NOT NULL,
  tx_hash VARCHAR(66) NULL,
  paid_at BIGINT UNSIGNED NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uniq_tx_hash (tx_hash),
  KEY idx_buyer (buyer_address, created_at),
  KEY idx_paid (paid_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- What each wallet owns. A gift lands here under the recipient, with the order that paid for it.
CREATE TABLE IF NOT EXISTS decoration_ownership (
  wallet_address VARCHAR(42) NOT NULL,
  decoration_id VARCHAR(48) NOT NULL,
  order_id CHAR(32) NULL,
  acquired_at BIGINT UNSIGNED NOT NULL,
  PRIMARY KEY (wallet_address, decoration_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
