-- One-time cleanup: remove duplicate role_permissions rows (case-insensitive by role_name).
-- Keeps the newest row per role using updated_at/created_at ordering.
-- Safe to re-run; subsequent runs should delete 0 rows.

WITH ranked AS (
  SELECT
    ctid,
    role_name,
    ROW_NUMBER() OVER (
      PARTITION BY LOWER(BTRIM(role_name))
      ORDER BY updated_at DESC NULLS LAST, created_at DESC NULLS LAST, ctid DESC
    ) AS rn
  FROM role_permissions
  WHERE role_name IS NOT NULL
)
DELETE FROM role_permissions rp
USING ranked r
WHERE rp.ctid = r.ctid
  AND r.rn > 1;
