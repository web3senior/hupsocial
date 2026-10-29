CREATE TABLE IF NOT EXISTS user_blocks (
  blocker_address VARCHAR(44) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  blocked_address VARCHAR(44) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (blocker_address, blocked_address)
) ENGINE=InnoDB;
