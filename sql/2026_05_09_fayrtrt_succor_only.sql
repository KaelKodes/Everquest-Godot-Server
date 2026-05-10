-- If fayrtrt already exists from an earlier migration, run this to set succor only:
--   mysql ... peq < server/sql/2026_05_09_fayrtrt_succor_only.sql

UPDATE zone
SET safe_x = -430, safe_y = -209, safe_z = 6.75, safe_heading = 0
WHERE short_name = 'fayrtrt';
