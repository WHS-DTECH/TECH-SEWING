require('dotenv').config();

const express = require('express');
const { Pool }  = require('pg');
const path      = require('path');
const fs        = require('fs');
const session   = require('express-session');
const passport  = require('passport');
const multer    = require('multer');
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

// ── Database connection ──────────────────────────────────
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

const uploadsDir = path.join(__dirname, 'images', 'uploads');

const imageUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, uploadsDir),
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname || '').toLowerCase();
      const safeExt = ext === '.jpeg' ? '.jpg' : ext;
      const unique = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
      cb(null, `activity-${unique}${safeExt}`);
    },
  }),
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
    ADD COLUMN IF NOT EXISTS instructions TEXT
  `);
}

// ── Middleware ───────────────────────────────────────────
app.use(express.json());

app.set('trust proxy', 1);
app.use(
  session({
    name: 'sewing.sid',
    secret: process.env.SESSION_SECRET || 'dev-only-secret-change-me',
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      maxAge: 1000 * 60 * 60 * 24 * 7,
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
  return res.redirect('/auth/google');
}

function requireAdmin(req, res, next) {
  if (req.isAuthenticated && req.isAuthenticated() && req.user && req.user.isAdmin) return next();
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
  try {
    canUploadActivity = await userCanUploadActivity(req.user);
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
      `SELECT role_name, recipes, add_recipes, inventory, planning, admin
       FROM role_permissions
       WHERE role_name IS NOT NULL
       ORDER BY role_name ASC`
    );

    res.json(result.rows);
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

// Favicon requested by browsers at /favicon.ico
app.get('/favicon.ico', (_req, res) => {
  res.sendFile(path.join(__dirname, 'images', 'favicon.ico'));
});

// Serve all static frontend files (html, css, js, etc.)
app.use(express.static(path.join(__dirname)));

// ── GET /api/activities ──────────────────────────────────
// Query params: ?week=true  ?year=Year+9  ?type=Embroidery  ?sort=az|za|level|duration
app.get('/api/activities', async (req, res) => {
  try {
    const { week, year, type, sort } = req.query;

    const params = [];
    const conditions = [];

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

    res.json(result.rows);
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

    const result = await pool.query('SELECT * FROM activities WHERE id = $1 LIMIT 1', [id]);
    if (!result.rows.length) {
      return res.status(404).json({ error: 'Activity not found' });
    }

    res.json(result.rows[0]);
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
      duration_hours,
      difficulty,
      description,
      color,
      is_this_week,
      outcome_image_url,
      resources,
      equipment,
      instructions,
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
    const hours = Number(duration_hours);

    if (!Number.isFinite(hours) || hours <= 0 || hours > 24) {
      return res.status(400).json({ error: 'Duration must be between 0 and 24 hours' });
    }

    const result = await pool.query(
      `INSERT INTO activities (
         name,
         year_level,
         type,
         duration_hours,
         difficulty,
         description,
         color,
         is_this_week,
         outcome_image_url,
         resources,
         equipment,
         instructions
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       RETURNING id`,
      [
        String(name).trim(),
        String(year_level).trim(),
        String(type).trim(),
        hours,
        String(difficulty).trim(),
        description ? String(description).trim() : null,
        safeColor,
        !!is_this_week,
        outcome_image_url ? String(outcome_image_url).trim() : null,
        resources ? String(resources).trim() : null,
        equipment ? String(equipment).trim() : null,
        instructions ? String(instructions).trim() : null,
      ]
    );

    res.json({ success: true, id: result.rows[0].id });
  } catch (err) {
    console.error('POST /api/admin/activities error:', err.message);
    res.status(500).json({ error: 'Database error' });
  }
});

app.post('/api/admin/upload-image', requireAuth, requireUploadPermission, (req, res) => {
  imageUpload.single('image')(req, res, (err) => {
    if (err) {
      const msg = err.message || 'Upload failed';
      return res.status(400).json({ error: msg });
    }

    if (!req.file) {
      return res.status(400).json({ error: 'No image file received' });
    }

    const imageUrl = `/images/uploads/${req.file.filename}`;
    return res.json({ success: true, imageUrl });
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
