-- Run this once against your Render PostgreSQL database to create the tables.
-- In Render: open your PostgreSQL instance and run this script.

-- Activities ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS activities (
  id             SERIAL PRIMARY KEY,
  name           VARCHAR(255)  NOT NULL,
  year_level     VARCHAR(20)   NOT NULL,
  type           VARCHAR(50)   NOT NULL,
  activity_category VARCHAR(20) NOT NULL DEFAULT 'Practice'
                   CHECK (activity_category IN ('Practice','Assessment','Skill','URL Idea')),
  duration_hours NUMERIC(4,1)  NOT NULL,
  difficulty     VARCHAR(20)   NOT NULL
                   CHECK (difficulty IN ('Beginner','Intermediate','Advanced')),
  description    TEXT,
  outcome_image_url TEXT,
  idea_url       TEXT,
  resources      TEXT,
  equipment      TEXT,
  instructions   TEXT,
  class_management_notes TEXT,
  class_preparation TEXT,
  assessment_focus TEXT,
  color          VARCHAR(30)   NOT NULL DEFAULT 'color-rose',
  is_this_week   BOOLEAN       NOT NULL DEFAULT FALSE,
  created_at     TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- Suggestions ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS suggestions (
  id             SERIAL PRIMARY KEY,
  date           DATE          NOT NULL,
  activity_name  VARCHAR(255)  NOT NULL,
  suggested_by   VARCHAR(255),
  email          VARCHAR(255)  NOT NULL,
  url            VARCHAR(500),
  reason         TEXT          NOT NULL,
  created_at     TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- Users ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id             SERIAL PRIMARY KEY,
  google_id      TEXT          UNIQUE,
  email          VARCHAR(255)  NOT NULL UNIQUE,
  name           VARCHAR(255)  NOT NULL,
  picture        TEXT,
  created_at     TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- User roles ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS user_roles (
  id             SERIAL PRIMARY KEY,
  user_id        INTEGER       NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role           VARCHAR(100)  NOT NULL,
  user_type      VARCHAR(100),
  assigned_by    VARCHAR(255),
  assigned_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  created_at     TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- Role permissions ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS role_permissions (
  id             SERIAL PRIMARY KEY,
  role_name      VARCHAR(100)  NOT NULL UNIQUE,
  recipes        BOOLEAN       NOT NULL DEFAULT FALSE,
  add_recipes    BOOLEAN       NOT NULL DEFAULT FALSE,
  inventory      BOOLEAN       NOT NULL DEFAULT FALSE,
  planning       BOOLEAN       NOT NULL DEFAULT FALSE,
  admin          BOOLEAN       NOT NULL DEFAULT FALSE,
  created_at     TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);
