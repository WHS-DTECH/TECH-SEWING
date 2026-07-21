-- Safe merge of duplicate role_permissions with user_roles updates
-- This script standardizes role names and updates all references before deleting duplicates

BEGIN;

-- Step 1: Create a mapping of canonical role names (lowercase, trimmed)
WITH role_mapping AS (
  SELECT 
    id,
    role_name,
    LOWER(BTRIM(role_name)) AS canonical_name,
    MAX(id) OVER (PARTITION BY LOWER(BTRIM(role_name))) AS canonical_id,
    LOWER(BTRIM(role_name)) = role_name AS is_canonical
  FROM role_permissions
)

-- Step 2: For each role, update user_roles to use the canonical role name
UPDATE user_roles ur
SET role = rm.canonical_name
FROM (
  SELECT DISTINCT 
    LOWER(BTRIM(role_name)) AS canonical_name,
    role_name
  FROM role_permissions
) rm
WHERE LOWER(BTRIM(ur.role)) = rm.canonical_name
  AND ur.role != rm.canonical_name;

-- Step 3: Update role_permissions to use canonical names (normalize)
UPDATE role_permissions
SET role_name = LOWER(BTRIM(role_name))
WHERE role_name != LOWER(BTRIM(role_name));

-- Step 4: Remove duplicate role_permissions, keeping the one with the latest update
DELETE FROM role_permissions rp
WHERE id NOT IN (
  SELECT MAX(id)
  FROM role_permissions
  GROUP BY LOWER(BTRIM(role_name))
);

-- Verify the cleanup
SELECT 
  role_name,
  COUNT(*) as count,
  COUNT(DISTINCT id) as unique_ids
FROM role_permissions
GROUP BY LOWER(BTRIM(role_name))
HAVING COUNT(*) > 1;

COMMIT;
