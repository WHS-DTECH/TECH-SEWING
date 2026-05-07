require('dotenv').config();

const express = require('express');
const { Pool }  = require('pg');
const path      = require('path');
const session   = require('express-session');
const passport  = require('passport');
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

app.get('/api/me', (req, res) => {
  if (!(req.isAuthenticated && req.isAuthenticated())) {
    return res.json({ authenticated: false });
  }

  return res.json({
    authenticated: true,
    user: {
      email: req.user.email,
      displayName: req.user.displayName,
      initials: req.user.initials,
      isAdmin: !!req.user.isAdmin,
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

// ── Start ────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`Sewing Room server running on http://localhost:${PORT}`);
});
