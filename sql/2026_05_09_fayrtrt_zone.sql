-- Faydark Retreat — EQMUD GM / private zone cloned from Surefall Glade (qrg).
-- Same zone rules / fog as qrg; explicit succor; new short_name + zoneidnumber.
-- Does NOT copy zone_points, spawn2, doors, or grids (no zone lines, no NPCs).
--
-- Apply once against your PEQ database, e.g.:
--   mysql -h 127.0.0.1 -P 3307 -u eqemu -p peq < server/sql/2026_05_09_fayrtrt_zone.sql
--
-- If zoneidnumber 95100 is already taken, change it here and in server/data/worldAtlas.js / ZONES_NUM_FALLBACK.

INSERT INTO zone (
  short_name, file_name, long_name, map_file_name,
  safe_x, safe_y, safe_z, safe_heading, graveyard_id, min_level, min_status,
  zoneidnumber, timezone, maxclients, ruleset, note,
  underworld, minclip, maxclip, fog_minclip, fog_maxclip, fog_blue, fog_red, fog_green,
  sky, ztype, zone_exp_multiplier, gravity, time_type,
  fog_red1, fog_green1, fog_blue1, fog_minclip1, fog_maxclip1,
  fog_red2, fog_green2, fog_blue2, fog_minclip2, fog_maxclip2,
  fog_red3, fog_green3, fog_blue3, fog_minclip3, fog_maxclip3,
  fog_red4, fog_green4, fog_blue4, fog_minclip4, fog_maxclip4,
  fog_density, flag_needed, canbind, cancombat, canlevitate, castoutdoor, hotzone,
  shutdowndelay, peqzone, expansion, suspendbuffs,
  rain_chance1, rain_chance2, rain_chance3, rain_chance4,
  rain_duration1, rain_duration2, rain_duration3, rain_duration4,
  snow_chance1, snow_chance2, snow_chance3, snow_chance4,
  snow_duration1, snow_duration2, snow_duration3, snow_duration4,
  type, skylock, skip_los, music, random_loc, dragaggro, never_idle, castdungeon,
  pull_limit, graveyard_time, max_z, min_expansion, max_expansion, content_flags, content_flags_disabled
)
SELECT
  'fayrtrt', 'fayrtrt', 'Faydark Retreat', map_file_name,
  -430, -209, 6.75, 0, graveyard_id, min_level, min_status,
  95100, timezone, maxclients, ruleset, 'EQMUD GM zone (geometry via qrg.s3d)',
  underworld, minclip, maxclip, fog_minclip, fog_maxclip, fog_blue, fog_red, fog_green,
  sky, ztype, zone_exp_multiplier, gravity, time_type,
  fog_red1, fog_green1, fog_blue1, fog_minclip1, fog_maxclip1,
  fog_red2, fog_green2, fog_blue2, fog_minclip2, fog_maxclip2,
  fog_red3, fog_green3, fog_blue3, fog_minclip3, fog_maxclip3,
  fog_red4, fog_green4, fog_blue4, fog_minclip4, fog_maxclip4,
  fog_density, flag_needed, canbind, cancombat, canlevitate, castoutdoor, hotzone,
  shutdowndelay, peqzone, expansion, suspendbuffs,
  rain_chance1, rain_chance2, rain_chance3, rain_chance4,
  rain_duration1, rain_duration2, rain_duration3, rain_duration4,
  snow_chance1, snow_chance2, snow_chance3, snow_chance4,
  snow_duration1, snow_duration2, snow_duration3, snow_duration4,
  type, skylock, skip_los, music, random_loc, dragaggro, never_idle, castdungeon,
  pull_limit, graveyard_time, max_z, min_expansion, max_expansion, content_flags, content_flags_disabled
FROM zone WHERE short_name = 'qrg' LIMIT 1;

-- Succor = zone.safe_x / safe_y / safe_z (used by getZoneSuccorCoords, /succor, GM succor teleport).
-- Coords match proven Surefall ground (same as barb druid start in server/tools/apply_barb_druid_surefall.js).
UPDATE zone
SET safe_x = -430, safe_y = -209, safe_z = 6.75, safe_heading = 0
WHERE short_name = 'fayrtrt';
