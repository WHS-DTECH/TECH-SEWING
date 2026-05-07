require('dotenv').config();

const express = require('express');
const { Pool }  = require('pg');
const path      = require('path');

const app  = express();
const PORT = process.env.PORT || 3000;

// ── Database connection ──────────────────────────────────
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

// ── Middleware ───────────────────────────────────────────
app.use(express.json());

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

// ── GET /api/suggestions (Admin use) ─────────────────────
app.get('/api/suggestions', async (req, res) => {
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

// ── Start ────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`Sewing Room server running on http://localhost:${PORT}`);
});
