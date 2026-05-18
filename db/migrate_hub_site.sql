-- Assign hub identifiers to existing activity rows in a shared database.
-- Run this in PostgreSQL after deploying the app update.

-- 1) Ensure the column exists (safe to re-run).
ALTER TABLE activities
ADD COLUMN IF NOT EXISTS hub_site VARCHAR(100);

UPDATE activities
SET hub_site = 'UNSCOPED'
WHERE hub_site IS NULL OR BTRIM(hub_site) = '';

ALTER TABLE activities
ALTER COLUMN hub_site SET DEFAULT 'UNSCOPED';

ALTER TABLE activities
ALTER COLUMN hub_site SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_activities_hub_site
  ON activities (hub_site);

-- 2) Label this website's existing rows.
-- Replace the WHERE clause with rules that uniquely identify this hub.
-- Example for TECH-SEWING rows with Year-level naming:
UPDATE activities
SET hub_site = 'TECH-SEWING'
WHERE hub_site = 'UNSCOPED'
  AND year_level ~* '^Year\\s*[0-9]+';

-- 3) Label rows that belong to another website.
-- Example (adjust as needed):
UPDATE activities
SET hub_site = 'DTECH-HUB'
WHERE hub_site = 'UNSCOPED'
  AND year_level IN ('Senior', 'Junior');

-- 4) Remove legacy blank rows that create empty cards.
DELETE FROM activities
WHERE COALESCE(BTRIM(name), '') = ''
   OR COALESCE(BTRIM(year_level), '') = ''
   OR COALESCE(BTRIM(type), '') = ''
   OR COALESCE(BTRIM(difficulty), '') = ''
   OR duration_hours IS NULL
   OR duration_hours <= 0;

-- 5) Verify counts by hub.
SELECT hub_site, COUNT(*) AS total
FROM activities
GROUP BY hub_site
ORDER BY hub_site;
