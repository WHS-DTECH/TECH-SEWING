-- Migration: Add 'Skill' category and update all existing activities
-- Run this once in the Neon dashboard SQL Editor

-- 1. Update the CHECK constraint to allow 'Skill'
ALTER TABLE activities DROP CONSTRAINT IF EXISTS activities_activity_category_check;
ALTER TABLE activities ADD CONSTRAINT activities_activity_category_check
  CHECK (activity_category IN ('Practice', 'Assessment', 'Skill'));

-- 2. Update the default for new rows
ALTER TABLE activities ALTER COLUMN activity_category SET DEFAULT 'Skill';

-- 3. Set all existing activities to Skill and remove from This Week
UPDATE activities
SET activity_category = 'Skill',
    is_this_week      = FALSE;
