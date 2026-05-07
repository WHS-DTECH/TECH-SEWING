const form = document.getElementById('role-form');
const tableBody = document.querySelector('#user-roles-table tbody');

if (form && tableBody) {
  form.addEventListener('submit', (e) => {
    e.preventDefault();

    const type = document.getElementById('user-type').value;
    const email = document.getElementById('user-email').value.trim().toLowerCase();
    const role = document.getElementById('role-to-add').value;

    if (!type || !email || !role) return;

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><span class="chip">${escapeHtml(type)}</span></td>
      <td>
        <strong>${escapeHtml(email)}</strong>
        <div>${escapeHtml(nameFromEmail(email))}</div>
      </td>
      <td><span class="chip chip-danger">${escapeHtml(role)}</span></td>
      <td><button class="admin-danger-btn" type="button">Remove Roles</button></td>
    `;

    const removeBtn = tr.querySelector('button');
    removeBtn.addEventListener('click', () => tr.remove());

    tableBody.appendChild(tr);
    form.reset();
  });

  tableBody.querySelectorAll('.admin-danger-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const row = btn.closest('tr');
      if (row) row.remove();
    });
  });
}

// Google hook placeholder:
// - Replace manual email field with selected Google Workspace account
// - Save role updates to backend route, e.g. POST /api/admin/user-roles
// - Trigger Gmail notification from server after successful save

function nameFromEmail(email) {
  const name = email.split('@')[0].replace(/[._-]/g, ' ');
  return name.replace(/\b\w/g, (ch) => ch.toUpperCase());
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
