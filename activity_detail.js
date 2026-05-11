const mount = document.getElementById('detail-wrap');

function escHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function toLines(text) {
  return String(text || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function makeList(items, ordered) {
  if (!items.length) {
    return '<p class="small">Not provided yet.</p>';
  }

  const tag = ordered ? 'ol' : 'ul';
  const klass = ordered ? 'detail-steps' : 'detail-list';
  return `<${tag} class="${klass}">${items.map((x) => `<li>${escHtml(x)}</li>`).join('')}</${tag}>`;
}

function defaultImage(name) {
  const label = encodeURIComponent(name || 'Sewing Activity');
  return `https://placehold.co/900x560/e8eef4/23496f?text=${label}`;
}

async function loadActivity() {
  if (!mount) return;

  const params = new URLSearchParams(window.location.search);
  const id = Number(params.get('id'));

  if (!Number.isInteger(id) || id < 1) {
    mount.innerHTML = '<p style="color:#b63a3a;font-size:0.9rem;padding:1rem 0;">Invalid activity link.</p>';
    return;
  }

  try {
    const res = await fetch(`/api/activities/${id}`);
    if (!res.ok) throw new Error('Activity not found');
    const a = await res.json();

    const resources = toLines(a.resources);
    const equipment = toLines(a.equipment);
    const instructions = toLines(a.instructions);

    const hrs = Number(a.duration_hours);
    const durationLabel = hrs === 1 ? '1 hr' : `${hrs} hrs`;

    mount.innerHTML = `
      <section class="detail-hero">
        <div class="detail-hero-content">
          <p class="detail-sub">STUDENT SEWING ACTIVITY</p>
          <h1>${escHtml(a.name)}</h1>
          <div class="detail-meta">
            <span class="detail-chip">${escHtml(a.year_level)}</span>
            <span class="detail-chip">${escHtml(a.type)}</span>
            <span class="detail-chip">${escHtml(durationLabel)}</span>
            <span class="detail-chip">${escHtml(a.difficulty)}</span>
          </div>
          <p class="detail-desc">${escHtml(a.description || 'Practical sewing task for students.')}</p>
          <a class="detail-back" href="/index.html">&#8592; Back to activity library</a>
        </div>
        <div class="detail-image">
          <img src="${escHtml(a.outcome_image_url || defaultImage(a.name))}" alt="${escHtml(a.name)} outcome" loading="lazy" />
        </div>
      </section>

      <section class="detail-grid">
        <article class="detail-card">
          <h2>Resources</h2>
          <p class="small">Materials students need for this activity.</p>
          ${makeList(resources, false)}
        </article>

        <article class="detail-card">
          <h2>Equipment</h2>
          <p class="small">Tools and machines used.</p>
          ${makeList(equipment, false)}
        </article>

        <article class="detail-card">
          <h2>Instructions</h2>
          <p class="small">Step-by-step method.</p>
          ${makeList(instructions, true)}
        </article>
      </section>
    `;
  } catch (_err) {
    mount.innerHTML = '<p style="color:#b63a3a;font-size:0.9rem;padding:1rem 0;">Could not load this activity.</p>';
  }
}

loadActivity();
