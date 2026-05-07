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

if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && process.env.GOOGLE_CALLBACK_URL) {
  passport.use(
    new GoogleStrategy(
      {
        clientID: process.env.GOOGLE_CLIENT_ID,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET,
        callbackURL: process.env.GOOGLE_CALLBACK_URL,
      },
      (_accessToken, _refreshToken, profile, done) => {
        const email = profile.emails && profile.emails[0] ? profile.emails[0].value.toLowerCase() : null;
        const domain = email ? email.split('@')[1] : null;
        const allowedDomain = process.env.GOOGLE_WORKSPACE_DOMAIN;

        if (!email) {
          return done(new Error('No email returned by Google'));
        }
        if (allowedDomain && domain !== allowedDomain) {
          return done(new Error('Email domain not allowed'));
        }

        const displayName = profile.displayName || email;
        const initials = displayName
          .split(' ')
          .map((p) => p[0])
          .join('')
          .slice(0, 2)
          .toUpperCase();

        return done(null, {
          googleId: profile.id,
          email,
          displayName,
          initials: initials || 'U',
          isAdmin: ADMIN_EMAILS.includes(email),
        });
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
