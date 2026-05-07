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
        adminBadge.style.display = 'inline-block';
        adminBadge.setAttribute('href', '/admin_user_roles.html');
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
