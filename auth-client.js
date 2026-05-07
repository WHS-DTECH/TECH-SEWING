(async function initAuthNav() {
  const signoutLink = document.getElementById('google-signout');
  const avatar = document.getElementById('google-user-initials');
  const adminBadge = document.getElementById('google-admin-badge');

  if (!signoutLink || !avatar) return;

  try {
    const res = await fetch('/api/me', { credentials: 'include' });
    const data = await res.json();

    if (!data.authenticated) {
      avatar.textContent = 'G';
      signoutLink.textContent = 'Sign in';
      signoutLink.setAttribute('href', '/auth/google');
      if (adminBadge) adminBadge.style.display = 'none';
      return;
    }

    avatar.textContent = data.user.initials || 'U';
    signoutLink.textContent = 'Sign out';
    signoutLink.setAttribute('href', '/auth/logout');

    if (adminBadge) {
      if (data.user.isAdmin) {
        adminBadge.style.display = 'flex';
      } else {
        adminBadge.style.display = 'none';
      }
    }
  } catch (_err) {
    avatar.textContent = 'G';
    signoutLink.textContent = 'Sign in';
    signoutLink.setAttribute('href', '/auth/google');
    if (adminBadge) adminBadge.style.display = 'none';
  }
})();

// Admin dropdown toggle
(function () {
  const toggleBtn = document.getElementById('admin-dropdown-toggle');
  const dropMenu = document.getElementById('admin-dropdown-menu');
  if (!toggleBtn || !dropMenu) return;
  toggleBtn.addEventListener('click', function (e) {
    e.stopPropagation();
    dropMenu.classList.toggle('open');
  });
  document.addEventListener('click', function () {
    dropMenu.classList.remove('open');
  });
})();
