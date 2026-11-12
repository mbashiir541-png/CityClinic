// City Clinic - app shell, auth and hash router.
import { api, session, setUnauthorizedHandler } from './api.js';
import { $, html, raw, toast, toastError, modal, field, spinner } from './ui.js';
import { dashboardView } from './views/dashboard.js';
import { appointmentsView } from './views/appointments.js';
import { patientsView, patientDetailView } from './views/patients.js';
import { doctorsView, doctorDetailView } from './views/doctors.js';
import { usersView } from './views/users.js';
import { hasRole } from './roles.js';

const ICONS = {
  dashboard: '<path d="M3 13h8V3H3zM13 21h8V11h-8zM3 21h8v-6H3zM13 3v6h8V3z"/>',
  appointments: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
  patients: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>',
  doctors: '<path d="M4.8 2.3A.3.3 0 1 0 5 2H4a2 2 0 0 0-2 2v5a6 6 0 0 0 6 6 6 6 0 0 0 6-6V4a2 2 0 0 0-2-2h-1a.2.2 0 1 0 .3.3"/><path d="M8 15v1a6 6 0 0 0 6 6 6 6 0 0 0 6-6v-4"/><circle cx="20" cy="10" r="2"/>',
  users: '<circle cx="12" cy="8" r="4"/><path d="M4 21v-1a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v1"/><path d="M19 3l2 2-2 2"/>',
};

const NAV = [
  { path: 'dashboard', label: 'Dashboard', roles: null },
  { path: 'appointments', label: 'Appointments', roles: null },
  { path: 'patients', label: 'Patients', roles: null },
  { path: 'doctors', label: 'Doctors', roles: null },
  { path: 'users', label: 'Staff accounts', roles: ['Admin'] },
];

// ---------- Login / logout ----------
function showLogin() {
  $('#app').hidden = true;
  $('#login').hidden = false;
  $('#login-email').focus();
}

function showApp() {
  const u = session.user;
  $('#login').hidden = true;
  $('#app').hidden = false;
  $('#who-name').textContent = u.name;
  $('#who-roles').textContent = u.roles.join(', ');
  $('#nav').innerHTML = NAV
    .filter((n) => !n.roles || hasRole(...n.roles))
    .map((n) => html`<li><a href="#/${n.path}" data-path="${n.path}">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${raw(ICONS[n.path])}</svg>
        ${n.label}</a></li>`)
    .join('');
  router();
}

$('#login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const err = $('#login-error');
  const btn = $('#login-form button[type=submit]');
  err.hidden = true;
  btn.disabled = true;
  try {
    const res = await api.login($('#login-email').value.trim(), $('#login-password').value);
    session.save(res.token, res.user);
    $('#login-password').value = '';
    if (!location.hash || location.hash === '#/') location.hash = '#/dashboard';
    showApp();
  } catch (ex) {
    err.textContent = ex.message;
    err.hidden = false;
  } finally {
    btn.disabled = false;
  }
});

$('#btn-logout').addEventListener('click', async () => {
  try { await api.logout(); } catch { /* token may already be invalid */ }
  session.clear();
  history.replaceState(null, '', '#/dashboard'); // next user starts on the dashboard
  showLogin();
});

$('#btn-password').addEventListener('click', () => {
  closeNav();
  modal({
    title: 'Change password',
    submitLabel: 'Change password',
    body: field('current_password', 'Current password', { type: 'password', required: true })
      + field('new_password', 'New password', { type: 'password', required: true, hint: 'At least 8 characters.' }),
    onSubmit: async (d) => {
      await api.changePassword(d);
      toast('Password changed');
    },
  });
});

setUnauthorizedHandler(() => {
  session.clear();
  $('#modal-root').innerHTML = '';
  toast('Your session expired. Please sign in again.', 'error');
  showLogin();
});

// ---------- Mobile nav ----------
const closeNav = () => $('#app').classList.remove('nav-open');
$('#btn-menu').addEventListener('click', () => $('#app').classList.add('nav-open'));
$('#backdrop').addEventListener('click', closeNav);

// ---------- Router ----------
const ROUTES = [
  [/^dashboard$/, dashboardView],
  [/^appointments$/, appointmentsView],
  [/^patients$/, patientsView],
  [/^patients\/(\d+)$/, patientDetailView],
  [/^doctors$/, doctorsView],
  [/^doctors\/(\d+)$/, doctorDetailView],
  [/^users$/, usersView, ['Admin']],
];

let renderId = 0;
async function router() {
  if (!session.token) return showLogin();
  closeNav();
  const path = location.hash.replace(/^#\/?/, '') || 'dashboard';
  const match = ROUTES.find(([re]) => re.test(path));
  const view = $('#view');

  document.querySelectorAll('#nav a').forEach((a) =>
    a.classList.toggle('active', path === a.dataset.path || path.startsWith(`${a.dataset.path}/`)));

  if (!match || (match[2] && !hasRole(...match[2]))) {
    location.hash = '#/dashboard';
    return;
  }
  const [re, fn] = match;
  const params = path.match(re).slice(1);
  const id = ++renderId;
  view.innerHTML = spinner();
  window.scrollTo(0, 0);
  try {
    await fn(view, ...params, () => id === renderId);
  } catch (err) {
    if (id !== renderId) return;
    if (err.status === 401) return;
    view.innerHTML = html`<div class="card"><div class="empty">${err.message}</div></div>`;
    toastError(err);
  }
}

window.addEventListener('hashchange', router);

// ---------- Boot ----------
(async function boot() {
  if (!session.token) return showLogin();
  try {
    session.setUser(await api.me()); // refresh roles in case they changed
    showApp();
  } catch (err) {
    if (err.status !== 401) {
      // API unreachable - still show the app with cached user, views will report errors
      if (session.user) return showApp();
      session.clear();
    }
    showLogin();
    if (err.status === 0) toastError(err);
  }
})();
