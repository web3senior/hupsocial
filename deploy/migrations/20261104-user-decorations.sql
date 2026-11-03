-- Avatar decorations: what each wallet wears in each slot (back, ring, effect, crown), set through a
-- signed message. The catalog lives in src/config/decorations.js; an id this table holds that the
-- catalog no longer lists is ignored on read. Unequipping a slot deletes its row.

CREATE TABLE IF NOT EXISTS user_decorations (
  wallet_address VARCHAR(42) NOT NULL,
  slot VARCHAR(16) NOT NULL,
  decoration_id VARCHAR(48) NOT NULL,
  updated_at BIGINT UNSIGNED NOT NULL,
  PRIMARY KEY (wallet_address, slot)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
