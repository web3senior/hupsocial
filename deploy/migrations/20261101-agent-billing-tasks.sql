-- Hosted agents pay for their own model use and take tasks from their owner.
-- Credits are AIML API's unit (2,000,000 to the dollar), so a run is charged exactly what AIML
-- reported it cost. Top-ups are LYX sent by the agent's own wallet, credited at the USD price of
-- the moment, after which the balance no longer moves with LYX.

ALTER TABLE hosted_agents
  ADD COLUMN model VARCHAR(100) NULL AFTER persona,
  -- Signed: a run is checked before it starts and charged after, so one run can dip below zero
  ADD COLUMN credits BIGINT NOT NULL DEFAULT 0 AFTER daily_runs;

-- One row per credited transfer. The hash is the key, so the same transfer can never be credited twice.
CREATE TABLE IF NOT EXISTS agent_topups (
  tx_hash VARCHAR(80) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  network_id INT UNSIGNED NOT NULL,
  agent_address VARCHAR(44) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  amount_wei DECIMAL(65, 0) NOT NULL,
  usd_price DECIMAL(24, 10) NOT NULL,
  credits BIGINT UNSIGNED NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (tx_hash, network_id),
  KEY idx_agent_topups_agent (agent_address, created_at)
) ENGINE=InnoDB;

-- What each chat turn or task run cost.
CREATE TABLE IF NOT EXISTS agent_usage (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  agent_address VARCHAR(44) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  kind ENUM('chat', 'task') NOT NULL,
  task_id BIGINT UNSIGNED NULL,
  model VARCHAR(100) NOT NULL,
  credits BIGINT UNSIGNED NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_agent_usage_agent (agent_address, id)
) ENGINE=InnoDB;

-- Standing instructions the owner gives an agent, run on demand or on a schedule. Results land in
-- the agent's chat; anything that would act on Hup arrives as a draft for the owner to approve.
CREATE TABLE IF NOT EXISTS agent_tasks (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  agent_address VARCHAR(44) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  title VARCHAR(120) NOT NULL,
  instructions TEXT NOT NULL,
  schedule ENUM('manual', 'hourly', 'daily') NOT NULL DEFAULT 'manual',
  enabled TINYINT(1) NOT NULL DEFAULT 1,
  next_run_at TIMESTAMP NULL DEFAULT NULL,
  last_run_at TIMESTAMP NULL DEFAULT NULL,
  -- Set while a run is underway, so two cron ticks never run the same task at once
  running_since TIMESTAMP NULL DEFAULT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_agent_tasks_agent (agent_address),
  KEY idx_agent_tasks_due (enabled, next_run_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
