const form = document.getElementById('permissions-form');
const resetBtn = document.getElementById('permissions-reset');

if (form) {
  const inputs = Array.from(form.querySelectorAll('tbody input[type="checkbox"]'));
  const defaults = inputs.map((input) => input.checked);

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    alert('Permissions saved locally. Hook this to your backend + Google auth rules next.');
  });

  if (resetBtn) {
    resetBtn.addEventListener('click', () => {
      inputs.forEach((input, i) => {
        if (!input.disabled) input.checked = defaults[i];
      });
    });
  }
}

// Google hook placeholder:
// - Load current role permissions from backend (which maps Google groups/roles)
// - Save changes via API endpoint, e.g. PUT /api/admin/role-permissions
// - Enforce in middleware after Google sign-in token verification
