// ── Card renderer ────────────────────────────────────────
function buildCard(a) {
  const diffClass = {
    Beginner:     'tag-beginner',
    Intermediate: 'tag-intermediate',
    Advanced:     'tag-advanced',
  }[a.difficulty] || '';

  const hrs = Number(a.duration_hours);
  const durationLabel = hrs === 1 ? '1 hr' : `${hrs} hrs`;

  return `
    <a class="activity-card activity-card-link ${a.color}" href="activity_detail.html?id=${Number(a.id)}"
         data-name="${escHtml(a.name)}"
         data-year="${escHtml(a.year_level)}"
         data-type="${escHtml(a.type)}"
         data-duration="${hrs}">
      <div class="card-header">
        <div class="card-circles"><div class="cc cc1"></div><div class="cc cc2"></div></div>
        <div class="card-header-text">
          <h3>${escHtml(a.name)}</h3>
          <p>Sewing Room Activity</p>
        </div>
      </div>
      ${a.outcome_image_url ? `<div class="card-outcome-image"><img src="${escHtml(a.outcome_image_url)}" alt="${escHtml(a.name)} outcome" loading="lazy" /></div>` : ''}
      <div class="card-body">
        <div class="tags">
          <span class="tag">${escHtml(a.year_level)}</span>
          <span class="tag">${escHtml(a.type)}</span>
          <span class="tag">${durationLabel}</span>
          <span class="tag ${diffClass}">${escHtml(a.difficulty)}</span>
        </div>
        <h4>${escHtml(a.name)}</h4>
        <p>${escHtml(a.description || '')}</p>
      </div>
    </a>`;
}

function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function showGridError(grid, msg) {
  grid.innerHTML = `<p style="color:#c0392b;font-size:0.85rem;padding:0.5rem 0">${msg}</p>`;
}

// ── This Week section ─────────────────────────────────────
async function loadThisWeek() {
  const grid = document.getElementById('week-grid');
  if (!grid) return;
  try {
    const res  = await fetch('/api/activities?week=true');
    if (!res.ok) throw new Error(res.statusText);
    const data = await res.json();
    grid.innerHTML = data.length
      ? data.map(buildCard).join('')
      : '<p style="color:#666;font-size:0.85rem">No activities scheduled this week.</p>';
  } catch {
    showGridError(grid, 'Could not load this week\'s activities.');
  }
}

// ── Library section ───────────────────────────────────────
const searchInput = document.getElementById('search-input');
const filterYear  = document.getElementById('filter-year');
const filterType  = document.getElementById('filter-type');
const filterSort  = document.getElementById('filter-sort');
const libGrid     = document.getElementById('library-grid');
const countBadge  = document.querySelector('.library-count');

async function loadLibrary() {
  if (!libGrid) return;
  libGrid.innerHTML = '<p style="color:#888;font-size:0.85rem;padding:0.5rem 0">Loading…</p>';

  try {
    const params = new URLSearchParams();
    const year   = filterYear?.value;
    const type   = filterType?.value;
    const sort   = filterSort?.value || 'az';
    if (year) params.set('year', year);
    if (type) params.set('type', type);
    params.set('sort', sort);

    const res  = await fetch('/api/activities?' + params.toString());
    if (!res.ok) throw new Error(res.statusText);
    let data = await res.json();

    // Client-side text search (fast, no extra round-trip)
    const q = searchInput?.value.trim().toLowerCase();
    if (q) {
      data = data.filter(a =>
        a.name.toLowerCase().includes(q) ||
        a.type.toLowerCase().includes(q) ||
        (a.description || '').toLowerCase().includes(q)
      );
    }

    libGrid.innerHTML = data.length
      ? data.map(buildCard).join('')
      : '<p style="color:#666;font-size:0.85rem;padding:0.5rem 0">No activities match your filters.</p>';

    if (countBadge) countBadge.textContent = `${data.length} shown`;
  } catch {
    showGridError(libGrid, 'Could not load activities. Please refresh the page.');
  }
}

// ── Event listeners ───────────────────────────────────────
searchInput?.addEventListener('input',  loadLibrary);
filterYear?.addEventListener('change',  loadLibrary);
filterType?.addEventListener('change',  loadLibrary);
filterSort?.addEventListener('change',  loadLibrary);

// ── Init ──────────────────────────────────────────────────
loadThisWeek();
loadLibrary();

