const form = document.getElementById('activity-upload-form');
const statusEl = document.getElementById('upload-status');

function setStatus(msg, isError) {
  if (!statusEl) return;
  statusEl.textContent = msg;
  statusEl.style.color = isError ? '#b63a3a' : '#37618a';
}

if (form) {
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    setStatus('Saving activity...', false);

    const payload = {
      name: document.getElementById('activity-name')?.value?.trim(),
      year_level: document.getElementById('activity-year')?.value,
      type: document.getElementById('activity-type')?.value?.trim(),
      duration_hours: Number(document.getElementById('activity-duration')?.value),
      difficulty: document.getElementById('activity-difficulty')?.value,
      description: document.getElementById('activity-description')?.value?.trim() || null,
      color: document.getElementById('activity-color')?.value,
      is_this_week: !!document.getElementById('activity-week')?.checked,
      outcome_image_url: document.getElementById('activity-image')?.value?.trim() || null,
      resources: document.getElementById('activity-resources')?.value?.trim() || null,
      equipment: document.getElementById('activity-equipment')?.value?.trim() || null,
      instructions: document.getElementById('activity-instructions')?.value?.trim() || null,
    };

    try {
      const res = await fetch('/api/admin/activities', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not save activity');

      setStatus('Activity saved. Opening preview...', false);
      window.location.href = `/activity_detail.html?id=${data.id}`;
    } catch (err) {
      setStatus(err.message || 'Could not save activity', true);
    }
  });
}
