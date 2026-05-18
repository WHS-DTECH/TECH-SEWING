const form = document.getElementById('url-idea-form');
const statusEl = document.getElementById('url-idea-status');

function setStatus(message, isError) {
  if (!statusEl) return;
  statusEl.textContent = message;
  statusEl.style.color = isError ? '#b63a3a' : '#37618a';
}

if (form) {
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    setStatus('Saving URL idea...', false);

    const payload = {
      name: document.getElementById('idea-name')?.value?.trim(),
      type: document.getElementById('idea-type')?.value?.trim(),
      color: document.getElementById('idea-color')?.value,
      idea_url: document.getElementById('idea-url')?.value?.trim(),
      description: document.getElementById('idea-description')?.value?.trim() || null,
    };

    try {
      const res = await fetch('/api/admin/url-ideas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not save URL idea');

      setStatus('URL idea saved. Opening preview...', false);
      window.location.href = `/activity_detail.html?id=${data.id}`;
    } catch (err) {
      setStatus(err.message || 'Could not save URL idea', true);
    }
  });
}
