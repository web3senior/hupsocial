-- Admin overrides for the avatar decoration catalog (src/config/decorations.js): a decoration's
-- price, whether it is kept out of feeds, and whether the shop offers it. A row replaces all three
-- for its decoration; no row means the catalog's own values. Written from /admin/decorations with a
-- signature from the admin wallet. updated_at is unix seconds.

CREATE TABLE IF NOT EXISTS decoration_settings (
  decoration_id VARCHAR(48) NOT NULL,
  price_usd DECIMAL(10, 2) NOT NULL,
  profile_only TINYINT(1) NOT NULL,
  listed TINYINT(1) NOT NULL,
  updated_at BIGINT UNSIGNED NOT NULL,
  PRIMARY KEY (decoration_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
