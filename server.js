require('dotenv').config();

const express = require('express');
const { Pool }  = require('pg');
const path      = require('path');
const fs        = require('fs');
const crypto    = require('crypto');
const session   = require('express-session');
const PgSession = require('connect-pg-simple')(session);
const passport  = require('passport');
const multer    = require('multer');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const { v2: cloudinary } = require('cloudinary');
const GoogleStrategy = require('passport-google-oauth20').Strategy;

const app  = express();
const PORT = process.env.PORT || 3000;
const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || '')
  .split(',')
  .map((v) => v.trim().toLowerCase())
  .filter(Boolean);
const GOOGLE_CLIENT_ID = (process.env.GOOGLE_CLIENT_ID || '').trim();
const GOOGLE_CLIENT_SECRET = (process.env.GOOGLE_CLIENT_SECRET || '').trim();
const GOOGLE_CALLBACK_URL = (process.env.GOOGLE_CALLBACK_URL || '').trim();
const GOOGLE_WORKSPACE_DOMAIN = (process.env.GOOGLE_WORKSPACE_DOMAIN || '').trim().toLowerCase();
const OBJECT_STORAGE_ENDPOINT = (process.env.OBJECT_STORAGE_ENDPOINT || '').trim();
const OBJECT_STORAGE_BUCKET = (process.env.OBJECT_STORAGE_BUCKET || '').trim();
const OBJECT_STORAGE_ACCESS_KEY_ID = (process.env.OBJECT_STORAGE_ACCESS_KEY_ID || '').trim();
const OBJECT_STORAGE_SECRET_ACCESS_KEY = (process.env.OBJECT_STORAGE_SECRET_ACCESS_KEY || '').trim();
const OBJECT_STORAGE_PUBLIC_BASE_URL = (process.env.OBJECT_STORAGE_PUBLIC_BASE_URL || '').trim();
const CLOUDINARY_CLOUD_NAME = (process.env.CLOUDINARY_CLOUD_NAME || '').trim();
const CLOUDINARY_API_KEY = (process.env.CLOUDINARY_API_KEY || '').trim();
const CLOUDINARY_API_SECRET = (process.env.CLOUDINARY_API_SECRET || '').trim();
const CLOUDINARY_UPLOAD_FOLDER = (process.env.CLOUDINARY_UPLOAD_FOLDER || 'sewing-room-activities').trim();
const HUB_SITE_KEY = (process.env.HUB_SITE_KEY || 'TECH-SEWING').trim().toUpperCase();

// ── Database connection ──────────────────────────────────
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

const uploadsDir = path.join(__dirname, 'images', 'uploads');

// Serve public files before session-backed middleware so the homepage can load
// even if the session store is unavailable.
app.use(express.static(path.join(__dirname)));

app.get('/favicon.ico', (_req, res) => {
  res.setHeader('Content-Type', 'image/svg+xml');
  res.setHeader('Cache-Control', 'public, max-age=86400');
  res.send(`
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
      <rect width="64" height="64" rx="14" fill="#6b2b90"/>
      <path d="M18 20h28v8H18zm0 16h18v8H18z" fill="#fff"/>
    </svg>
  `);
});

const objectStorageEnabled = !!(
  OBJECT_STORAGE_ENDPOINT &&
  OBJECT_STORAGE_BUCKET &&
  OBJECT_STORAGE_ACCESS_KEY_ID &&
  OBJECT_STORAGE_SECRET_ACCESS_KEY &&
  OBJECT_STORAGE_PUBLIC_BASE_URL
);

const cloudinaryEnabled = !!(
  CLOUDINARY_CLOUD_NAME &&
  CLOUDINARY_API_KEY &&
  CLOUDINARY_API_SECRET
);

if (cloudinaryEnabled) {
  cloudinary.config({
    cloud_name: CLOUDINARY_CLOUD_NAME,
    api_key: CLOUDINARY_API_KEY,
    api_secret: CLOUDINARY_API_SECRET,
    secure: true,
  });
}

const s3Client = objectStorageEnabled
  ? new S3Client({
      region: 'auto',
      endpoint: OBJECT_STORAGE_ENDPOINT,
      forcePathStyle: true,
      credentials: {
        accessKeyId: OBJECT_STORAGE_ACCESS_KEY_ID,
        secretAccessKey: OBJECT_STORAGE_SECRET_ACCESS_KEY,
      },
    })
  : null;

function fileExtFromMime(mimeType) {
  const map = {
    'image/jpeg': '.jpg',
    'image/jpg': '.jpg',
    'image/png': '.png',
  };
  return map[String(mimeType || '').toLowerCase()] || null;
}

function createImageFileName(mimeType) {
  const ext = fileExtFromMime(mimeType) || '.jpg';
  return `activity-${Date.now()}-${crypto.randomUUID()}${ext}`;
}

async function uploadToCloudinary(fileBuffer, mimeType, originalFileName) {
  const publicId = `activity-${Date.now()}-${crypto.randomUUID()}`;

  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        folder: CLOUDINARY_UPLOAD_FOLDER,
        resource_type: 'image',
        public_id: publicId,
        format: fileExtFromMime(mimeType)?.replace('.', '') || 'jpg',
        use_filename: false,
        unique_filename: false,
        overwrite: false,
        filename_override: originalFileName || undefined,
      },
      (error, result) => {
        if (error) return reject(error);
        if (!result || !result.secure_url) {
          return reject(new Error('Cloudinary did not return a secure URL'));
        }
        return resolve(result.secure_url);
      }
    );

    stream.end(fileBuffer);
  });
}

const imageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = new Set(['image/png', 'image/jpeg', 'image/jpg']);
    if (!allowed.has((file.mimetype || '').toLowerCase())) {
      return cb(new Error('Only PNG and JPG files are allowed'));
    }
    cb(null, true);
  },
});

async function ensureSchema() {
  await pool.query(`
    ALTER TABLE activities
    ADD COLUMN IF NOT EXISTS outcome_image_url TEXT,
    ADD COLUMN IF NOT EXISTS resources TEXT,
    ADD COLUMN IF NOT EXISTS equipment TEXT,
    ADD COLUMN IF NOT EXISTS instructions TEXT,
    ADD COLUMN IF NOT EXISTS idea_url TEXT,
    ADD COLUMN IF NOT EXISTS activity_category VARCHAR(20) DEFAULT 'Practice',
    ADD COLUMN IF NOT EXISTS class_management_notes TEXT,
    ADD COLUMN IF NOT EXISTS class_preparation TEXT,
    ADD COLUMN IF NOT EXISTS assessment_focus TEXT,
    ADD COLUMN IF NOT EXISTS hub_site VARCHAR(100)
  `);

  await pool.query(
    `UPDATE activities
     SET hub_site = 'UNSCOPED'
     WHERE hub_site IS NULL OR BTRIM(hub_site) = ''`
  );

  const legacyHubColumnResult = await pool.query(`
    SELECT EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'activities'
        AND column_name = 'hub'
    ) AS has_legacy_hub
  `);

  const hasLegacyHubColumn = !!legacyHubColumnResult.rows[0]?.has_legacy_hub;

  if (hasLegacyHubColumn) {
    await pool.query(`
      UPDATE activities
      SET hub_site = CASE
        WHEN UPPER(BTRIM(COALESCE(hub, ''))) IN ('SEWING', 'TECH-SEWING', 'TECH_SEWING') THEN 'TECH-SEWING'
        WHEN UPPER(BTRIM(COALESCE(hub, ''))) IN ('DTECH', 'DTECH-HUB', 'WHS-DTECH', 'TECHSPACE') THEN 'DTECH-HUB'
        ELSE hub_site
      END
      WHERE hub_site = 'UNSCOPED'
    `);
  }

  await pool.query(`
    UPDATE activities
    SET hub_site = 'TECH-SEWING'
    WHERE hub_site = 'UNSCOPED'
      AND year_level ~* '^Year\\s*[0-9]+'
  `);

  await pool.query(`
    UPDATE activities
    SET hub_site = 'DTECH-HUB'
    WHERE hub_site = 'UNSCOPED'
      AND LOWER(BTRIM(COALESCE(year_level, ''))) IN ('junior', 'senior')
  `);

  await pool.query(`
    ALTER TABLE activities
    ALTER COLUMN hub_site SET DEFAULT 'UNSCOPED'
  `);

  await pool.query(`
    ALTER TABLE activities
    ALTER COLUMN hub_site SET NOT NULL
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_activities_hub_site
    ON activities (hub_site)
  `);

  // Normalize legacy or inconsistent category values before adding the CHECK constraint.
  await pool.query(`
    UPDATE activities
    SET activity_category = CASE
      WHEN activity_category IS NULL OR BTRIM(activity_category) = '' THEN 'Practice'
      WHEN LOWER(BTRIM(activity_category)) = 'practice' THEN 'Practice'
      WHEN LOWER(BTRIM(activity_category)) = 'assessment' THEN 'Assessment'
      WHEN LOWER(BTRIM(activity_category)) = 'skill' THEN 'Skill'
      WHEN LOWER(BTRIM(activity_category)) IN ('url idea', 'url_idea', 'url-idea', 'urlidea') THEN 'URL Idea'
      ELSE 'Practice'
    END
    WHERE activity_category IS NULL
       OR BTRIM(activity_category) = ''
       OR LOWER(BTRIM(activity_category)) NOT IN ('practice', 'assessment', 'skill', 'url idea', 'url_idea', 'url-idea', 'urlidea')
       OR activity_category NOT IN ('Practice', 'Assessment', 'Skill', 'URL Idea')
  `);

  await pool.query(`
    ALTER TABLE activities DROP CONSTRAINT IF EXISTS activities_activity_category_check
  `);

  await pool.query(`
    ALTER TABLE activities
    ADD CONSTRAINT activities_activity_category_check
    CHECK (activity_category IN ('Practice','Assessment','Skill','URL Idea'))
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      google_id TEXT UNIQUE,
      email VARCHAR(255) NOT NULL UNIQUE,
      name VARCHAR(255) NOT NULL,
      picture TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS user_roles (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      role VARCHAR(100) NOT NULL,
      user_type VARCHAR(100),
      assigned_by VARCHAR(255),
      assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS role_permissions (
      id SERIAL PRIMARY KEY,
      role_name VARCHAR(100) NOT NULL UNIQUE,
      recipes BOOLEAN NOT NULL DEFAULT FALSE,
      add_recipes BOOLEAN NOT NULL DEFAULT FALSE,
      inventory BOOLEAN NOT NULL DEFAULT FALSE,
      planning BOOLEAN NOT NULL DEFAULT FALSE,
      admin BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS user_sessions (
      sid VARCHAR PRIMARY KEY,
      sess JSON NOT NULL,
      expire TIMESTAMPTZ NOT NULL
    )
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_user_sessions_expire
    ON user_sessions (expire)
  `);
}

// ── Middleware ───────────────────────────────────────────
app.use(express.json());

const sessionStore = new PgSession({
  pool,
  tableName: 'user_sessions',
  createTableIfMissing: false,
  pruneSessionInterval: 60 * 15,
});

app.set('trust proxy', 1);
app.use(
  session({
    store: sessionStore,
    name: 'sewing.sid',
    secret: process.env.SESSION_SECRET || 'dev-only-secret-change-me',
    resave: false,
    saveUninitialized: false,
    rolling: true,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      maxAge: 1000 * 60 * 60 * 24 * 30,
    },
  })
);

app.use(passport.initialize());
app.use(passport.session());

passport.serializeUser((user, done) => done(null, user));
passport.deserializeUser((user, done) => done(null, user));

function maskClientId(clientId) {
  if (!clientId) return 'missing';
  const parts = clientId.split('.apps.googleusercontent.com');
  const prefix = parts[0] || clientId;
  return `${prefix.slice(0, 12)}...apps.googleusercontent.com`;
}

if (GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET && GOOGLE_CALLBACK_URL) {
  console.log(
    '[google-auth] configured',
    JSON.stringify({
      clientId: maskClientId(GOOGLE_CLIENT_ID),
      callbackURL: GOOGLE_CALLBACK_URL,
      workspaceDomain: GOOGLE_WORKSPACE_DOMAIN || null,
    })
  );

  passport.use(
    new GoogleStrategy(
      {
        clientID: GOOGLE_CLIENT_ID,
        clientSecret: GOOGLE_CLIENT_SECRET,
        callbackURL: GOOGLE_CALLBACK_URL,
      },
      async (_accessToken, _refreshToken, profile, done) => {
        try {
          const email = profile.emails && profile.emails[0] ? profile.emails[0].value.toLowerCase() : null;
          const domain = email ? email.split('@')[1] : null;
          const allowedDomain = GOOGLE_WORKSPACE_DOMAIN;

          if (!email) {
            return done(new Error('No email returned by Google'));
          }
          if (allowedDomain && domain !== allowedDomain) {
            return done(new Error('Email domain not allowed'));
          }

          const displayName = profile.displayName || email;
          const picture = profile.photos && profile.photos[0] ? profile.photos[0].value : null;

          // Keep local users table synced with Google profile data.
          const userUpsert = await pool.query(
            `INSERT INTO users (google_id, email, name, picture)
             VALUES ($1, $2, $3, $4)
             ON CONFLICT (google_id)
             DO UPDATE SET email = EXCLUDED.email, name = EXCLUDED.name, picture = EXCLUDED.picture
             RETURNING id`,
            [profile.id, email, displayName, picture]
          );

          const dbUserId = userUpsert.rows[0].id;

          const adminCheck = await pool.query(
            `SELECT EXISTS (
               SELECT 1 FROM user_roles ur
               WHERE ur.user_id = $1 AND LOWER(ur.role) = 'admin'
             ) AS is_admin_role`,
            [dbUserId]
          );

          const isAdmin = ADMIN_EMAILS.includes(email) || adminCheck.rows[0].is_admin_role;

          const initials = displayName
            .split(' ')
            .map((p) => p[0])
            .join('')
            .slice(0, 2)
            .toUpperCase();

          return done(null, {
            googleId: profile.id,
            dbUserId,
            email,
            displayName,
            initials: initials || 'U',
            isAdmin,
          });
        } catch (err) {
          return done(err);
        }
      }
    )
  );
}

function requireAuth(req, res, next) {
  if (req.isAuthenticated && req.isAuthenticated()) return next();
  if (req.path && req.path.startsWith('/api/')) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  return res.redirect('/auth/google');
}

function requireAdmin(req, res, next) {
  if (!(req.isAuthenticated && req.isAuthenticated())) {
    if (req.path && req.path.startsWith('/api/')) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    return res.redirect('/auth/google');
  }

  if (req.user && req.user.isAdmin) return next();

  if (req.path && req.path.startsWith('/api/')) {
    return res.status(403).json({ error: 'Admin access required' });
  }

  return res.status(403).send('Access denied');
}

async function hasRolePermission(userId, permissionColumn) {
  const allowedColumns = new Set(['recipes', 'add_recipes', 'inventory', 'planning', 'admin']);
  if (!allowedColumns.has(permissionColumn)) return false;

  const result = await pool.query(
    `SELECT EXISTS (
       SELECT 1
       FROM user_roles ur
       JOIN role_permissions rp ON LOWER(rp.role_name) = LOWER(ur.role)
       WHERE ur.user_id = $1 AND COALESCE(rp.${permissionColumn}, FALSE) = TRUE
     ) AS allowed`,
    [userId]
  );

  return !!result.rows[0]?.allowed;
}

async function userCanUploadActivity(user) {
  if (!user || !user.dbUserId) return false;
  if (user.isAdmin) return true;
  return hasRolePermission(user.dbUserId, 'add_recipes');
}

async function userCanBrowseActivities(user) {
  if (!user || !user.dbUserId) return false;
  if (user.isAdmin) return true;
  return hasRolePermission(user.dbUserId, 'inventory');
}

async function userCanViewTeacherCard(user) {
  if (!user || !user.dbUserId) return false;
  if (user.isAdmin) return true;

  const result = await pool.query(
    `SELECT EXISTS (
       SELECT 1
       FROM user_roles ur
       WHERE ur.user_id = $1
         AND (
           LOWER(COALESCE(ur.role, '')) LIKE '%teacher%'
           OR LOWER(COALESCE(ur.user_type, '')) = 'teacher'
         )
     ) AS allowed`,
    [user.dbUserId]
  );

  return !!result.rows[0]?.allowed;
}

function stripTeacherOnlyFields(activity) {
  return {
    ...activity,
    class_management_notes: null,
    class_preparation: null,
    assessment_focus: null,
  };
}

function addActivityVisibilityGuards(conditions) {
  conditions.push(`COALESCE(BTRIM(name), '') <> ''`);
  conditions.push(`COALESCE(BTRIM(year_level), '') <> ''`);
  conditions.push(`COALESCE(BTRIM(type), '') <> ''`);
  conditions.push(`COALESCE(BTRIM(difficulty), '') <> ''`);
}

function addHubScopeCondition(params, conditions) {
  params.push(HUB_SITE_KEY);
  conditions.push(`hub_site = $${params.length}`);
}

async function requireUploadPermission(req, res, next) {
  try {
    if (!(req.isAuthenticated && req.isAuthenticated() && req.user)) {
      return res.status(401).send('Authentication required');
    }

    if (await userCanUploadActivity(req.user)) {
      return next();
    }

    return res.status(403).send('Access denied');
  } catch (err) {
    return next(err);
  }
}

// ── Auth routes ───────────────────────────────────────────
app.get('/auth/google', (req, res, next) => {
  if (!passport._strategy('google')) {
    return res.status(500).send('Google auth is not configured yet.');
  }

  console.log(
    '[google-auth] start',
    JSON.stringify({
      host: req.get('host'),
      forwardedProto: req.get('x-forwarded-proto') || null,
      callbackURL: GOOGLE_CALLBACK_URL,
      clientId: maskClientId(GOOGLE_CLIENT_ID),
    })
  );

  return passport.authenticate('google', { scope: ['profile', 'email'] })(req, res, next);
});

app.get(
  '/auth/google/callback',
  (req, res, next) => {
    if (!passport._strategy('google')) {
      return res.status(500).send('Google auth is not configured yet.');
    }
    return passport.authenticate('google', {
      failureRedirect: '/index.html?auth=failed',
    })(req, res, next);
  },
  (_req, res) => {
    res.redirect('/index.html');
  }
);

app.get('/auth/logout', (req, res, next) => {
  req.logout((err) => {
    if (err) return next(err);
    req.session.destroy(() => {
      res.redirect('/index.html');
    });
  });
});

app.get('/api/me', async (req, res) => {
  if (!(req.isAuthenticated && req.isAuthenticated())) {
    return res.json({ authenticated: false });
  }

  let canUploadActivity = false;
  let canBrowseActivities = false;
  let canViewTeacherCard = false;
  try {
    canUploadActivity = await userCanUploadActivity(req.user);
    canBrowseActivities = await userCanBrowseActivities(req.user);
    canViewTeacherCard = await userCanViewTeacherCard(req.user);
  } catch (err) {
    console.error('GET /api/me permission check error:', err.message);
  }

  return res.json({
    authenticated: true,
    user: {
      email: req.user.email,
      displayName: req.user.displayName,
      initials: req.user.initials,
      isAdmin: !!req.user.isAdmin,
      canUploadActivity: !!canUploadActivity,
      canBrowseActivities: !!canBrowseActivities,
      canViewTeacherCard: !!canViewTeacherCard,
    },
  });
});

// Protect admin pages (HTML)
app.get('/admin_user_roles.html', requireAuth, requireAdmin, (req, res) => {
  res.sendFile(path.join(__dirname, 'admin_user_roles.html'));
});
app.get('/admin_role_permissions.html', requireAuth, requireAdmin, (req, res) => {
  res.sendFile(path.join(__dirname, 'admin_role_permissions.html'));
});
app.get('/admin_upload_activity.html', requireAuth, requireUploadPermission, (req, res) => {
  res.sendFile(path.join(__dirname, 'admin_upload_activity.html'));
});
app.get('/admin_upload_url_idea.html', requireAuth, requireUploadPermission, (req, res) => {
  res.sendFile(path.join(__dirname, 'admin_upload_url_idea.html'));
});

// ── Admin API: user roles ─────────────────────────────────
app.get('/api/admin/user-roles', requireAuth, requireAdmin, async (_req, res) => {
  try {
    const result = await pool.query(
      `SELECT
         u.id AS user_id,
         u.email,
         u.name,
         COALESCE(MAX(ur.user_type), 'Staff') AS user_type,
         COALESCE(
           ARRAY_REMOVE(ARRAY_AGG(DISTINCT ur.role), NULL),
           ARRAY[]::varchar[]
         ) AS roles
       FROM users u
       LEFT JOIN user_roles ur ON ur.user_id = u.id
       GROUP BY u.id, u.email, u.name
       ORDER BY u.email ASC`
    );

    res.json(result.rows);
  } catch (err) {
    console.error('GET /api/admin/user-roles error:', err.message);
    res.status(500).json({ error: 'Database error' });
  }
});

app.post('/api/admin/user-roles', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { email, role, user_type } = req.body;

    if (!email || !role) {
      return res.status(400).json({ error: 'Missing required fields: email, role' });
    }

    const userRow = await pool.query(
      'SELECT id FROM users WHERE LOWER(email) = LOWER($1) LIMIT 1',
      [email.trim()]
    );

    if (!userRow.rows.length) {
      return res.status(404).json({ error: 'User not found in users table. Ask the user to sign in first.' });
    }

    const userId = userRow.rows[0].id;

    // Avoid duplicate same-role assignment for same user.
    const existing = await pool.query(
      'SELECT id FROM user_roles WHERE user_id = $1 AND LOWER(role) = LOWER($2) LIMIT 1',
      [userId, role.trim()]
    );

    if (existing.rows.length) {
      return res.json({ success: true, message: 'Role already assigned' });
    }

    await pool.query(
      `INSERT INTO user_roles (user_id, role, user_type, assigned_by, assigned_at)
       VALUES ($1, $2, $3, $4, NOW())`,
      [
        userId,
        role.trim(),
        user_type ? user_type.trim() : null,
        req.user.dbUserId || null,
      ]
    );

    res.json({ success: true });
  } catch (err) {
    console.error('POST /api/admin/user-roles error:', err.message);
    res.status(500).json({ error: 'Database error' });
  }
});

app.delete('/api/admin/user-roles', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { email, role } = req.body;

    if (!email || !role) {
      return res.status(400).json({ error: 'Missing required fields: email, role' });
    }

    const del = await pool.query(
      `DELETE FROM user_roles
       WHERE user_id = (SELECT id FROM users WHERE LOWER(email) = LOWER($1) LIMIT 1)
         AND LOWER(role) = LOWER($2)`,
      [email.trim(), role.trim()]
    );

    res.json({ success: true, deleted: del.rowCount });
  } catch (err) {
    console.error('DELETE /api/admin/user-roles error:', err.message);
    res.status(500).json({ error: 'Database error' });
  }
});

// ── Admin API: role permissions ───────────────────────────
app.get('/api/admin/role-permissions', requireAuth, requireAdmin, async (_req, res) => {
  try {
    const result = await pool.query(
      `SELECT DISTINCT ON (LOWER(role_name))
          role_name,
          recipes,
          add_recipes,
          inventory,
          planning,
          admin
       FROM role_permissions
       WHERE role_name IS NOT NULL
       ORDER BY LOWER(role_name), updated_at DESC NULLS LAST, created_at DESC NULLS LAST`
    );

    const roleOrder = [
      'admin',
      'lead teacher',
      'teacher',
      'technician',
      'staff',
      'student',
      'public access',
    ];

    const sorted = [...result.rows].sort((a, b) => {
      const aRole = String(a.role_name || '').trim().toLowerCase();
      const bRole = String(b.role_name || '').trim().toLowerCase();
      const aIdx = roleOrder.indexOf(aRole);
      const bIdx = roleOrder.indexOf(bRole);

      if (aIdx !== -1 && bIdx !== -1) return aIdx - bIdx;
      if (aIdx !== -1) return -1;
      if (bIdx !== -1) return 1;
      return aRole.localeCompare(bRole);
    });

    res.json(sorted);
  } catch (err) {
    console.error('GET /api/admin/role-permissions error:', err.message);
    res.status(500).json({ error: 'Database error' });
  }
});

app.put('/api/admin/role-permissions', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { roles } = req.body;
    if (!Array.isArray(roles)) {
      return res.status(400).json({ error: 'roles array is required' });
    }

    for (const r of roles) {
      if (!r.role_name) continue;

      const update = await pool.query(
        `UPDATE role_permissions
         SET recipes = $2,
             add_recipes = $3,
             inventory = $4,
             planning = $5,
             admin = $6,
             updated_at = NOW()
         WHERE LOWER(role_name) = LOWER($1)`,
        [
          r.role_name,
          !!r.recipes,
          !!r.add_recipes,
          !!r.inventory,
          !!r.planning,
          !!r.admin,
        ]
      );

      if (update.rowCount === 0) {
        await pool.query(
          `INSERT INTO role_permissions (role_name, recipes, add_recipes, inventory, planning, admin, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())`,
          [
            r.role_name,
            !!r.recipes,
            !!r.add_recipes,
            !!r.inventory,
            !!r.planning,
            !!r.admin,
          ]
        );
      }
    }

    res.json({ success: true });
  } catch (err) {
    console.error('PUT /api/admin/role-permissions error:', err.message);
    res.status(500).json({ error: 'Database error' });
  }
});

app.post('/api/admin/role-permissions/cleanup-duplicates', requireAuth, requireAdmin, async (_req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const beforeRes = await client.query(
      `SELECT COUNT(*)::INT AS total_rows
       FROM role_permissions
       WHERE role_name IS NOT NULL`
    );

    const deletedRes = await client.query(
      `WITH ranked AS (
         SELECT
           ctid,
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
         AND r.rn > 1`
    );

    const afterRes = await client.query(
      `SELECT COUNT(*)::INT AS total_rows
       FROM role_permissions
       WHERE role_name IS NOT NULL`
    );

    await client.query('COMMIT');

    res.json({
      success: true,
      before: beforeRes.rows[0]?.total_rows || 0,
      deleted: deletedRes.rowCount || 0,
      after: afterRes.rows[0]?.total_rows || 0,
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('POST /api/admin/role-permissions/cleanup-duplicates error:', err.message);
    res.status(500).json({ error: 'Database error' });
  } finally {
    client.release();
  }
});

// Protect admin API endpoint
app.get('/api/suggestions', requireAuth, requireAdmin, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM suggestions ORDER BY created_at DESC'
    );
    res.json(result.rows);
  } catch (err) {
    console.error('GET /api/suggestions error:', err.message);
    res.status(500).json({ error: 'Database error' });
  }
});

// ── GET /api/activities ──────────────────────────────────
// Query params: ?week=true  ?year=Year+9  ?type=Embroidery  ?category=assessment|practice|skill|url-idea  ?sort=az|za|level|duration
app.get('/api/activities', async (req, res) => {
  try {
    const { week, year, type, category, sort } = req.query;

    const params = [];
    const conditions = [];

    addHubScopeCondition(params, conditions);
    addActivityVisibilityGuards(conditions);

    if (week === 'true') {
      conditions.push('is_this_week = TRUE');
    }
    if (year) {
      params.push(year);
      conditions.push(`year_level = $${params.length}`);
    }
    if (type) {
      params.push(type);
      conditions.push(`type = $${params.length}`);
    }
    if (category) {
      const rawCategory = String(category).toLowerCase();
      const categoryMap = {
        assessment: 'Assessment',
        practice: 'Practice',
        skill: 'Skill',
        'url-idea': 'URL Idea',
        url_idea: 'URL Idea',
        'url idea': 'URL Idea',
        urlidea: 'URL Idea',
      };
      const safeCategory = categoryMap[rawCategory];
      if (safeCategory) {
        params.push(safeCategory);
        conditions.push(`activity_category = $${params.length}`);
      }
    }

    const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';

    const sortMap = {
      az:       'name ASC',
      za:       'name DESC',
      level:    'year_level ASC, name ASC',
      duration: 'duration_hours ASC, name ASC',
    };
    const orderBy = sortMap[sort] || 'name ASC';

    const sql = `SELECT * FROM activities ${where} ORDER BY ${orderBy}`;
    const result = await pool.query(sql, params);

    let canViewTeacherCard = false;
    if (req.isAuthenticated && req.isAuthenticated() && req.user) {
      canViewTeacherCard = await userCanViewTeacherCard(req.user);
    }

    const rows = canViewTeacherCard
      ? result.rows
      : result.rows.map(stripTeacherOnlyFields);

    res.json(rows.map((r) => ({ ...r, canViewTeacherCard })));
  } catch (err) {
    console.error('GET /api/activities error:', err.message);
    res.status(500).json({ error: 'Database error' });
  }
});

app.get('/api/activities/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) {
      return res.status(400).json({ error: 'Invalid activity id' });
    }

    const result = await pool.query(
      `SELECT *
       FROM activities
       WHERE id = $1
         AND hub_site = $2
         AND COALESCE(BTRIM(name), '') <> ''
         AND COALESCE(BTRIM(year_level), '') <> ''
         AND COALESCE(BTRIM(type), '') <> ''
         AND COALESCE(BTRIM(difficulty), '') <> ''
       LIMIT 1`,
      [id, HUB_SITE_KEY]
    );
    if (!result.rows.length) {
      return res.status(404).json({ error: 'Activity not found' });
    }

    let activity = result.rows[0];
    const canViewInstructions = !!(req.isAuthenticated && req.isAuthenticated());
    let canViewTeacherCard = false;

    if (req.isAuthenticated && req.isAuthenticated() && req.user) {
      canViewTeacherCard = await userCanViewTeacherCard(req.user);
    }

    if (!canViewTeacherCard) {
      activity = stripTeacherOnlyFields(activity);
    }

    if (!canViewInstructions) {
      activity.instructions = null;
    }

    res.json({
      ...activity,
      canViewInstructions,
      canViewTeacherCard,
    });
  } catch (err) {
    console.error('GET /api/activities/:id error:', err.message);
    res.status(500).json({ error: 'Database error' });
  }
});

app.post('/api/admin/activities', requireAuth, requireUploadPermission, async (req, res) => {
  try {
    const {
      name,
      year_level,
      type,
      activity_category,
      duration_hours,
      difficulty,
      description,
      color,
      is_this_week,
      outcome_image_url,
      idea_url,
      resources,
      equipment,
      instructions,
      class_management_notes,
      class_preparation,
      assessment_focus,
    } = req.body;

    if (!name || !year_level || !type || !duration_hours || !difficulty) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const allowedDifficulty = new Set(['Beginner', 'Intermediate', 'Advanced']);
    if (!allowedDifficulty.has(String(difficulty))) {
      return res.status(400).json({ error: 'Invalid difficulty' });
    }

    const allowedColors = new Set([
      'color-rose',
      'color-teal',
      'color-sage',
      'color-lavender',
      'color-coral',
      'color-gold',
    ]);

    const safeColor = allowedColors.has(String(color)) ? color : 'color-rose';
    const categoryRaw = String(activity_category || 'Practice').trim().toLowerCase();
    const categoryMap = {
      assessment: 'Assessment',
      practice: 'Practice',
      skill: 'Skill',
      'url idea': 'URL Idea',
      url_idea: 'URL Idea',
      'url-idea': 'URL Idea',
      urlidea: 'URL Idea',
    };
    const safeCategory = categoryMap[categoryRaw] || 'Practice';
    const hours = Number(duration_hours);

    if (!Number.isFinite(hours) || hours <= 0 || hours > 24) {
      return res.status(400).json({ error: 'Duration must be between 0 and 24 hours' });
    }

    const result = await pool.query(
      `INSERT INTO activities (
         name,
         year_level,
         type,
         activity_category,
         duration_hours,
         difficulty,
         description,
         color,
         is_this_week,
         outcome_image_url,
         idea_url,
         resources,
         equipment,
         instructions,
         class_management_notes,
         class_preparation,
         assessment_focus,
         hub_site
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
       RETURNING id`,
      [
        String(name).trim(),
        String(year_level).trim(),
        String(type).trim(),
        safeCategory,
        hours,
        String(difficulty).trim(),
        description ? String(description).trim() : null,
        safeColor,
        !!is_this_week,
        outcome_image_url ? String(outcome_image_url).trim() : null,
        idea_url ? String(idea_url).trim() : null,
        resources ? String(resources).trim() : null,
        equipment ? String(equipment).trim() : null,
        instructions ? String(instructions).trim() : null,
        class_management_notes ? String(class_management_notes).trim() : null,
        class_preparation ? String(class_preparation).trim() : null,
        assessment_focus ? String(assessment_focus).trim() : null,
        HUB_SITE_KEY,
      ]
    );

    res.json({ success: true, id: result.rows[0].id });
  } catch (err) {
    console.error('POST /api/admin/activities error:', err.message);
    res.status(500).json({ error: 'Database error' });
  }
});

app.put('/api/admin/activities/:id', requireAuth, requireUploadPermission, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) {
      return res.status(400).json({ error: 'Invalid activity id' });
    }

    const {
      name,
      year_level,
      type,
      activity_category,
      duration_hours,
      difficulty,
      description,
      color,
      is_this_week,
      outcome_image_url,
      idea_url,
      resources,
      equipment,
      instructions,
      class_management_notes,
      class_preparation,
      assessment_focus,
    } = req.body;

    if (!name || !year_level || !type || !duration_hours || !difficulty) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const allowedDifficulty = new Set(['Beginner', 'Intermediate', 'Advanced']);
    if (!allowedDifficulty.has(String(difficulty))) {
      return res.status(400).json({ error: 'Invalid difficulty' });
    }

    const allowedColors = new Set([
      'color-rose',
      'color-teal',
      'color-sage',
      'color-lavender',
      'color-coral',
      'color-gold',
    ]);

    const safeColor = allowedColors.has(String(color)) ? color : 'color-rose';
    const categoryRaw = String(activity_category || 'Practice').trim().toLowerCase();
    const categoryMap = {
      assessment: 'Assessment',
      practice: 'Practice',
      skill: 'Skill',
      'url idea': 'URL Idea',
      url_idea: 'URL Idea',
      'url-idea': 'URL Idea',
      urlidea: 'URL Idea',
    };
    const safeCategory = categoryMap[categoryRaw] || 'Practice';
    const hours = Number(duration_hours);

    if (!Number.isFinite(hours) || hours <= 0 || hours > 24) {
      return res.status(400).json({ error: 'Duration must be between 0 and 24 hours' });
    }

    const result = await pool.query(
      `UPDATE activities
       SET name = $2,
           year_level = $3,
           type = $4,
           activity_category = $5,
           duration_hours = $6,
           difficulty = $7,
           description = $8,
           color = $9,
           is_this_week = $10,
           outcome_image_url = $11,
             idea_url = $12,
             resources = $13,
             equipment = $14,
             instructions = $15,
             class_management_notes = $16,
             class_preparation = $17,
               assessment_focus = $18,
             hub_site = $19
       WHERE id = $1
             AND hub_site = $19
       RETURNING id`,
      [
        id,
        String(name).trim(),
        String(year_level).trim(),
        String(type).trim(),
        safeCategory,
        hours,
        String(difficulty).trim(),
        description ? String(description).trim() : null,
        safeColor,
        !!is_this_week,
        outcome_image_url ? String(outcome_image_url).trim() : null,
        idea_url ? String(idea_url).trim() : null,
        resources ? String(resources).trim() : null,
        equipment ? String(equipment).trim() : null,
        instructions ? String(instructions).trim() : null,
        class_management_notes ? String(class_management_notes).trim() : null,
        class_preparation ? String(class_preparation).trim() : null,
        assessment_focus ? String(assessment_focus).trim() : null,
        HUB_SITE_KEY,
      ]
    );

    if (!result.rows.length) {
      return res.status(404).json({ error: 'Activity not found' });
    }

    res.json({ success: true, id: result.rows[0].id });
  } catch (err) {
    console.error('PUT /api/admin/activities/:id error:', err.message);
    res.status(500).json({ error: 'Database error' });
  }
});

app.post('/api/admin/url-ideas', requireAuth, requireUploadPermission, async (req, res) => {
  try {
    const { name, type, color, description, idea_url } = req.body;

    if (!name || !type || !idea_url) {
      return res.status(400).json({ error: 'Missing required fields: name, type, idea_url' });
    }

    const safeUrl = String(idea_url).trim();
    if (!/^https?:\/\//i.test(safeUrl)) {
      return res.status(400).json({ error: 'URL must start with http:// or https://' });
    }

    const allowedColors = new Set([
      'color-rose',
      'color-teal',
      'color-sage',
      'color-lavender',
      'color-coral',
      'color-gold',
    ]);

    const safeColor = allowedColors.has(String(color)) ? color : 'color-teal';

    const result = await pool.query(
      `INSERT INTO activities (
         name,
         year_level,
         type,
         activity_category,
         duration_hours,
         difficulty,
         description,
         color,
         is_this_week,
         idea_url,
         hub_site
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       RETURNING id`,
      [
        String(name).trim(),
        'Year 9',
        String(type).trim(),
        'URL Idea',
        1,
        'Beginner',
        description ? String(description).trim() : null,
        safeColor,
        false,
        safeUrl,
        HUB_SITE_KEY,
      ]
    );

    res.json({ success: true, id: result.rows[0].id });
  } catch (err) {
    console.error('POST /api/admin/url-ideas error:', err.message);
    res.status(500).json({ error: 'Database error' });
  }
});

app.post('/api/admin/upload-image', requireAuth, requireUploadPermission, (req, res) => {
  imageUpload.single('image')(req, res, (err) => {
    const finish = async () => {
      if (!req.file) {
        return res.status(400).json({ error: 'No image file received' });
      }

      if (cloudinaryEnabled) {
        try {
          const imageUrl = await uploadToCloudinary(
            req.file.buffer,
            req.file.mimetype,
            req.file.originalname
          );
          return res.json({ success: true, imageUrl });
        } catch (uploadErr) {
          console.error('Cloudinary upload error:', uploadErr.message);
          return res.status(500).json({ error: 'Could not upload image to Cloudinary' });
        }
      }

      const fileName = createImageFileName(req.file.mimetype);

      if (objectStorageEnabled && s3Client) {
        try {
          const key = `activities/${fileName}`;
          await s3Client.send(
            new PutObjectCommand({
              Bucket: OBJECT_STORAGE_BUCKET,
              Key: key,
              Body: req.file.buffer,
              ContentType: req.file.mimetype,
            })
          );

          const base = OBJECT_STORAGE_PUBLIC_BASE_URL.replace(/\/$/, '');
          return res.json({ success: true, imageUrl: `${base}/${key}` });
        } catch (uploadErr) {
          console.error('Object storage upload error:', uploadErr.message);
          return res.status(500).json({ error: 'Could not upload image to object storage' });
        }
      }

      try {
        fs.mkdirSync(uploadsDir, { recursive: true });
        fs.writeFileSync(path.join(uploadsDir, fileName), req.file.buffer);
        return res.json({ success: true, imageUrl: `/images/uploads/${fileName}` });
      } catch (writeErr) {
        console.error('Local upload fallback error:', writeErr.message);
        return res.status(500).json({ error: 'Could not store uploaded image' });
      }
    };

    if (err) {
      const msg = err.message || 'Upload failed';
      return res.status(400).json({ error: msg });
    }

    finish().catch((unhandledErr) => {
      console.error('Upload handler error:', unhandledErr.message);
      return res.status(500).json({ error: 'Upload failed' });
    });
  });
});

// ── POST /api/suggestions ────────────────────────────────
app.post('/api/suggestions', async (req, res) => {
  try {
    const { date, activity_name, suggested_by, email, url, reason } = req.body;

    // Server-side validation
    if (!activity_name || !email || !reason) {
      return res.status(400).json({ error: 'Missing required fields: activity_name, email, reason' });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
      return res.status(400).json({ error: 'Invalid email address' });
    }
    if (activity_name.length > 255 || email.length > 255) {
      return res.status(400).json({ error: 'Input too long' });
    }

    const submittedDate = date || new Date().toISOString().split('T')[0];

    const result = await pool.query(
      `INSERT INTO suggestions (date, activity_name, suggested_by, email, url, reason)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id`,
      [
        submittedDate,
        activity_name.trim(),
        suggested_by ? suggested_by.trim() : null,
        email.trim().toLowerCase(),
        url ? url.trim() : null,
        reason.trim(),
      ]
    );

    res.json({ success: true, id: result.rows[0].id });
  } catch (err) {
    console.error('POST /api/suggestions error:', err.message);
    res.status(500).json({ error: 'Database error' });
  }
});

app.use((err, req, res, _next) => {
  console.error('Unhandled error:', err && err.stack ? err.stack : err);

  if (req.path.startsWith('/api/')) {
    return res.status(500).json({ error: 'Internal server error' });
  }

  return res.status(500).sendFile(path.join(__dirname, '500.html'));
});

// ── Start ────────────────────────────────────────────────
async function startServer() {
  try {
    if (cloudinaryEnabled) {
      console.log('[storage] cloudinary enabled');
    } else if (objectStorageEnabled) {
      console.log('[storage] object storage enabled');
    } else {
      console.log('[storage] no cloud storage configured, using local uploads fallback');
    }

    fs.mkdirSync(uploadsDir, { recursive: true });
    await ensureSchema();
    app.listen(PORT, () => {
      console.log(`Sewing Room server running on http://localhost:${PORT}`);
    });
  } catch (err) {
    console.error('Failed to initialize schema:', err.message);
    process.exit(1);
  }
}

startServer();
