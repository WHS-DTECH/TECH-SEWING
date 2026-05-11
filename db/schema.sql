-- Run this once against your Neon database to create the tables.
-- In the Neon dashboard: SQL Editor → paste → Run

-- Activities ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS activities (
  id             SERIAL PRIMARY KEY,
  name           VARCHAR(255)  NOT NULL,
  year_level     VARCHAR(20)   NOT NULL,
  type           VARCHAR(50)   NOT NULL,
  duration_hours NUMERIC(4,1)  NOT NULL,
  difficulty     VARCHAR(20)   NOT NULL
                   CHECK (difficulty IN ('Beginner','Intermediate','Advanced')),
  description    TEXT,
  outcome_image_url TEXT,
  resources      TEXT,
  equipment      TEXT,
  instructions   TEXT,
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
