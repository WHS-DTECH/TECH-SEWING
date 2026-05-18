-- Seed all 14 activities.
-- Run AFTER schema.sql.  Safe to re-run (uses INSERT … ON CONFLICT DO NOTHING).

-- Add a unique constraint so re-runs are safe
ALTER TABLE activities ADD CONSTRAINT activities_name_unique UNIQUE (name);

INSERT INTO activities
  (name, year_level, type, activity_category, duration_hours, difficulty, description, color, is_this_week, hub)
VALUES
  ('Hand Stitching Sampler',   'Year 9',  'Hand Sewing',    'Skill', 2,   'Beginner',     'Practice running stitch, backstitch, and whip stitch on a fabric sampler card to build core hand sewing skills.',                        'color-rose',     FALSE, 'SEWING'),
  ('Zippered Pouch',           'Year 10', 'Machine Sewing', 'Skill', 3,   'Intermediate', 'Cut, pin, and machine sew a lined zippered pouch using a metal zip and coordinating fabric.',                                               'color-teal',     FALSE, 'SEWING'),
  ('Embroidery Hoop Art',      'Year 11', 'Embroidery',     'Skill', 2,   'Beginner',     'Transfer a design onto fabric and complete it using satin stitch, stem stitch, and French knots.',                                          'color-sage',     FALSE, 'SEWING'),
  ('Drawstring Bag',           'Year 9',  'Machine Sewing', 'Skill', 2,   'Beginner',     'Sew a simple drawstring bag with a casing channel and learn to thread and tie off cord ends neatly.',                                       'color-lavender', FALSE, 'SEWING'),
  ('French Seam Cushion',      'Year 11', 'Construction',   'Skill', 4,   'Advanced',     'Construct a cushion cover using French seams for a clean finish, including an envelope back opening.',                                       'color-coral',    FALSE, 'SEWING'),
  ('Bias Binding Apron',       'Year 12', 'Finishing',      'Skill', 3,   'Advanced',     'Cut and apply bias binding to finish all raw edges of a half apron and attach neatly mitered corners.',                                      'color-gold',     FALSE, 'SEWING'),
  ('Tote Bag',                 'Year 9',  'Machine Sewing', 'Skill', 2,   'Beginner',     'Sew a sturdy canvas tote bag with reinforced handles and a boxed base corner.',                                                              'color-teal',     FALSE, 'SEWING'),
  ('Patch Pocket Attachment',  'Year 10', 'Construction',   'Skill', 1,   'Beginner',     'Cut, press, and topstitch a neat patch pocket onto a garment piece with even seam allowances.',                                              'color-rose',     FALSE, 'SEWING'),
  ('Elasticated Waistband',    'Year 10', 'Construction',   'Skill', 2,   'Intermediate', 'Fold, stitch, and thread elastic through a casing to create a comfortable fitted waistband.',                                                'color-lavender', FALSE, 'SEWING'),
  ('Cross Stitch Bookmark',    'Year 9',  'Embroidery',     'Skill', 1,   'Beginner',     'Complete a simple counted cross stitch pattern on Aida cloth and finish with a tassel.',                                                     'color-sage',     FALSE, 'SEWING'),
  ('Simple Skirt from Pattern','Year 11', 'Pattern Making', 'Skill', 5,   'Intermediate', 'Read and cut a commercial pattern, adjust for fit, and sew a basic A-line skirt.',                                                           'color-coral',    FALSE, 'SEWING'),
  ('Flat-Felled Seam Practice','Year 12', 'Finishing',      'Skill', 1,   'Advanced',     'Create strong, decorative flat-felled seams used in jeans and workwear construction.',                                                       'color-gold',     FALSE, 'SEWING'),
  ('Button & Buttonhole',      'Year 10', 'Hand Sewing',    'Skill', 1,   'Intermediate', 'Sew on buttons with a shank and use the machine''s buttonhole foot to create neat, even buttonholes.',                                       'color-rose',     FALSE, 'SEWING'),
  ('Invisible Zip Insertion',  'Year 12', 'Construction',   'Skill', 2,   'Advanced',     'Install an invisible zip into a seam using a specialist foot for a professional, hidden closure.',                                           'color-lavender', FALSE, 'SEWING')
ON CONFLICT (name) DO UPDATE
SET activity_category = EXCLUDED.activity_category,
    is_this_week = EXCLUDED.is_this_week,
    hub = EXCLUDED.hub;
