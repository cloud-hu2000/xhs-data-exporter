CREATE DATABASE IF NOT EXISTS note_guard CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE note_guard;

CREATE TABLE IF NOT EXISTS users (
  id CHAR(36) PRIMARY KEY,
  email VARCHAR(320) NOT NULL UNIQUE,
  display_name VARCHAR(40) NULL,
  password_hash VARCHAR(255) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS sessions (
  id CHAR(36) PRIMARY KEY,
  user_id CHAR(36) NOT NULL,
  token_hash CHAR(64) NOT NULL UNIQUE,
  expires_at DATETIME(3) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  CONSTRAINT sessions_user_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS memberships (
  id CHAR(36) PRIMARY KEY,
  user_id CHAR(36) NOT NULL UNIQUE,
  plan ENUM('FREE', 'PRO', 'TEAM') NOT NULL DEFAULT 'FREE',
  status ENUM('ACTIVE', 'PAST_DUE', 'CANCELED') NOT NULL DEFAULT 'ACTIVE',
  monthly_quota INT NOT NULL,
  period_ends_at DATETIME(3) NULL,
  provider VARCHAR(32) NULL,
  provider_subscription_id VARCHAR(191) NULL UNIQUE,
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  CONSTRAINT memberships_user_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS audit_reports (
  id CHAR(36) PRIMARY KEY,
  user_id CHAR(36) NOT NULL,
  platform ENUM('XIAOHONGSHU', 'DOUYIN') NOT NULL,
  title VARCHAR(120) NULL,
  body LONGTEXT NULL,
  score TINYINT UNSIGNED NOT NULL,
  overall_risk ENUM('LOW', 'MEDIUM', 'HIGH') NOT NULL,
  recommendation VARCHAR(80) NOT NULL,
  engine JSON NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  CONSTRAINT audit_reports_user_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX audit_reports_user_created_idx (user_id, created_at)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS audit_issues (
  id CHAR(36) PRIMARY KEY,
  report_id CHAR(36) NOT NULL,
  source VARCHAR(16) NOT NULL,
  image_index SMALLINT UNSIGNED NULL,
  category VARCHAR(100) NOT NULL,
  severity ENUM('TIP', 'LOW', 'MEDIUM', 'HIGH') NOT NULL,
  evidence VARCHAR(255) NOT NULL,
  reason TEXT NOT NULL,
  suggestion TEXT NOT NULL,
  bbox JSON NULL,
  rule_path JSON NULL,
  CONSTRAINT audit_issues_report_fk FOREIGN KEY (report_id) REFERENCES audit_reports(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS usage_events (
  id CHAR(36) PRIMARY KEY,
  user_id CHAR(36) NOT NULL,
  report_id CHAR(36) NULL,
  unit_count INT NOT NULL DEFAULT 1,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  CONSTRAINT usage_events_user_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT usage_events_report_fk FOREIGN KEY (report_id) REFERENCES audit_reports(id) ON DELETE SET NULL,
  INDEX usage_events_user_created_idx (user_id, created_at)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS assets (
  id CHAR(36) PRIMARY KEY,
  report_id CHAR(36) NOT NULL,
  storage_key VARCHAR(255) NOT NULL UNIQUE,
  original_name VARCHAR(255) NULL,
  mime_type VARCHAR(100) NOT NULL,
  byte_size INT UNSIGNED NOT NULL,
  sha256 CHAR(64) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  CONSTRAINT assets_report_fk FOREIGN KEY (report_id) REFERENCES audit_reports(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- Retained from content-checker so policy data can move without another schema change.
CREATE TABLE IF NOT EXISTS policy_sets (
  id CHAR(36) PRIMARY KEY,
  slug VARCHAR(80) NOT NULL,
  platform VARCHAR(64) NOT NULL,
  version VARCHAR(80) NOT NULL,
  status ENUM('DRAFT', 'ACTIVE', 'RETIRED') NOT NULL DEFAULT 'DRAFT',
  rollout_percentage TINYINT UNSIGNED NOT NULL DEFAULT 0,
  effective_from DATETIME(3) NOT NULL,
  effective_to DATETIME(3) NULL,
  definition JSON NOT NULL,
  created_by VARCHAR(191) NOT NULL,
  approved_by VARCHAR(191) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  approved_at DATETIME(3) NULL,
  UNIQUE KEY policy_sets_slug_version_uq (slug, version),
  INDEX policy_sets_active_idx (platform, status, effective_from, effective_to)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS policy_rules (
  id CHAR(36) PRIMARY KEY,
  rule_id VARCHAR(120) NOT NULL UNIQUE,
  parent_rule VARCHAR(120) NULL,
  child_rule VARCHAR(32) NULL,
  platform VARCHAR(64) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS policy_rule_versions (
  id CHAR(36) PRIMARY KEY,
  policy_set_id CHAR(36) NOT NULL,
  policy_rule_id CHAR(36) NOT NULL,
  evidence_level ENUM('S', 'A', 'B', 'S+A', 'S+S', 'A+A') NOT NULL,
  trigger_signals JSON NOT NULL,
  counter_examples JSON NOT NULL,
  risk_result JSON NOT NULL,
  suggestion TEXT NOT NULL,
  source_urls JSON NOT NULL,
  reviewer VARCHAR(191) NOT NULL,
  test_samples JSON NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  CONSTRAINT policy_rule_versions_set_fk FOREIGN KEY (policy_set_id) REFERENCES policy_sets(id) ON DELETE CASCADE,
  CONSTRAINT policy_rule_versions_rule_fk FOREIGN KEY (policy_rule_id) REFERENCES policy_rules(id) ON DELETE CASCADE,
  UNIQUE KEY policy_rule_versions_set_rule_uq (policy_set_id, policy_rule_id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS policy_evidence (
  id CHAR(36) PRIMARY KEY,
  policy_rule_version_id CHAR(36) NOT NULL,
  evidence_type ENUM('OFFICIAL', 'CREATOR_OUTCOME', 'EXPERT_REVIEW', 'OTHER') NOT NULL,
  source_url VARCHAR(2048) NOT NULL,
  source_excerpt TEXT NULL,
  evidence_level ENUM('S', 'A', 'B') NOT NULL,
  reviewed_by VARCHAR(191) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  CONSTRAINT policy_evidence_rule_version_fk FOREIGN KEY (policy_rule_version_id) REFERENCES policy_rule_versions(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS policy_test_cases (
  id CHAR(36) PRIMARY KEY,
  policy_rule_version_id CHAR(36) NOT NULL,
  input_text TEXT NOT NULL,
  expected_decision ENUM('KEEP', 'DISMISS') NOT NULL,
  expected_severity ENUM('TIP', 'LOW', 'MEDIUM', 'HIGH') NULL,
  kind ENUM('POSITIVE', 'NEGATIVE', 'BOUNDARY') NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  CONSTRAINT policy_test_cases_rule_version_fk FOREIGN KEY (policy_rule_version_id) REFERENCES policy_rule_versions(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS policy_review_tasks (
  id CHAR(36) PRIMARY KEY,
  policy_set_id CHAR(36) NOT NULL,
  status ENUM('PENDING', 'APPROVED', 'REJECTED') NOT NULL DEFAULT 'PENDING',
  submitted_by VARCHAR(191) NOT NULL,
  reviewed_by VARCHAR(191) NULL,
  review_note TEXT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  reviewed_at DATETIME(3) NULL,
  CONSTRAINT policy_review_tasks_set_fk FOREIGN KEY (policy_set_id) REFERENCES policy_sets(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS practice_articles (
  id CHAR(36) PRIMARY KEY,
  title VARCHAR(160) NOT NULL,
  body LONGTEXT NOT NULL,
  status ENUM('DRAFT', 'PUBLISHED', 'OFFLINE') NOT NULL DEFAULT 'DRAFT',
  published_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  INDEX practice_articles_public_idx (status, published_at),
  INDEX practice_articles_title_idx (title)
) ENGINE=InnoDB;
