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

function instructionsMarkup(activity) {
  if (activity.canViewInstructions) {
    return makeList(toLines(activity.instructions), true);
  }

  return `
    <div class="detail-lock-note">
      Instructions are available to signed-in users only.
      <a href="/auth/google">Sign in with Google</a> to view the full step-by-step method.
    </div>
  `;
}

function teacherPanelMarkup(activity) {
  if (!activity.canViewTeacherCard) return '';

  const classMgmt = toLines(activity.class_management_notes);
  const prep = toLines(activity.class_preparation);
  const assess = toLines(activity.assessment_focus);
  const hasContent = classMgmt.length || prep.length || assess.length;

  return `
    <article class="detail-card">
      <h2>Teacher Card</h2>
      <p class="small">Class management information (teacher view only).</p>
      ${classMgmt.length ? `<h3 style="font-size:0.86rem;color:#2e5378;margin:0.45rem 0 0.2rem;">Class Management</h3>${makeList(classMgmt, false)}` : ''}
      ${prep.length ? `<h3 style="font-size:0.86rem;color:#2e5378;margin:0.45rem 0 0.2rem;">Preparation</h3>${makeList(prep, false)}` : ''}
      ${assess.length ? `<h3 style="font-size:0.86rem;color:#2e5378;margin:0.45rem 0 0.2rem;">Assessment Focus</h3>${makeList(assess, false)}` : ''}
      ${!hasContent ? '<p class="small" style="color:#666;">No teacher notes yet.</p>' : ''}
      <a class="teacher-edit-link" href="/admin_upload_activity.html?id=${activity.id}" style="display:block;margin-top:1rem;">Edit Activity</a>
    </article>
  `;
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
    const hrs = Number(a.duration_hours);
    const durationLabel = hrs === 1 ? '1 hr' : `${hrs} hrs`;
    const fallbackImage = defaultImage(a.name);

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
          <img src="${escHtml(a.outcome_image_url || fallbackImage)}" alt="${escHtml(a.name)} outcome" loading="lazy" onerror="this.onerror=null;this.src='${escHtml(fallbackImage)}'" />
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
          ${instructionsMarkup(a)}
        </article>

        ${teacherPanelMarkup(a)}
      </section>
    `;
  } catch (_err) {
    mount.innerHTML = '<p style="color:#b63a3a;font-size:0.9rem;padding:1rem 0;">Could not load this activity.</p>';
  }
}

loadActivity();
