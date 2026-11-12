// Staff accounts (Admin only).
import { api } from '../api.js';
import { $, $$, html, raw, modal, field, toast, toastError, confirmDialog, activeBadge, empty } from '../ui.js';
import { currentUser } from '../roles.js';

function openUserForm(user, roles, onSaved) {
  const u = user || { roles: ['Receptionist'], status: true };
  modal({
    title: user ? 'Edit account' : 'New staff account',
    submitLabel: user ? 'Save changes' : 'Create account',
    body: html`
      ${raw(field('name', 'Full name', { value: u.name, required: true }))}
      <div class="grid-2">
        ${raw(field('email', 'Email', { type: 'email', value: u.email, required: true }))}
        ${raw(field('password', user ? 'New password' : 'Password', { type: 'password', required: !user, hint: user ? 'Leave empty to keep the current password.' : 'At least 8 characters.' }))}
      </div>
      <div class="field">
        <label>Roles *</label>
        ${roles.map((r) => html`<label class="checkbox"><input type="checkbox" name="roles" data-multi="1" value="${r.name}" ${raw(u.roles.includes(r.name) ? 'checked' : '')}> ${r.name}</label>`)}
        <div class="small muted">To add a doctor with a schedule, use the Doctors page.</div>
      </div>
      <label class="checkbox"><input type="checkbox" name="status" ${raw(u.status ? 'checked' : '')}> Account active</label>`,
    onSubmit: async (d) => {
      if (user && !d.password) delete d.password;
      if (user) await api.updateUser(user.id, d); else await api.createUser(d);
      toast(user ? 'Account updated' : 'Account created');
      onSaved?.();
    },
  });
}

export async function usersView(view, isCurrent) {
  const roles = (await api.roles()).data;

  async function load() {
    const { data } = await api.users();
    if (!isCurrent()) return;
    view.innerHTML = html`
      <div class="page-head">
        <div><h1>Staff accounts</h1><div class="muted">Who can sign in and what they can do</div></div>
        <div class="actions"><button class="btn" id="btn-new">+ New account</button></div>
      </div>
      <div class="card" id="list"></div>
      <p class="small muted" style="margin-top:1rem">
        <strong>Admin</strong>: everything · <strong>Receptionist</strong>: patients &amp; appointments ·
        <strong>Doctor</strong>: own appointments, mark completed / no-show
      </p>`;
    $('#list', view).innerHTML = data.length ? html`
      <div class="table-wrap"><table class="responsive">
        <thead><tr><th>Name</th><th>Email</th><th>Roles</th><th>Status</th><th></th></tr></thead>
        <tbody>${data.map((u) => html`
          <tr>
            <td data-label="Name"><strong>${u.name}</strong>${raw(u.id === currentUser().id ? ' <span class="small muted">(you)</span>' : '')}</td>
            <td data-label="Email">${u.email}</td>
            <td data-label="Roles">${u.roles.map((r) => html`<span class="badge">${r}</span>`)}</td>
            <td data-label="Status">${activeBadge(u.status)}</td>
            <td class="actions">
              <button class="btn ghost sm" data-edit="${u.id}">Edit</button>
              ${raw(u.status && u.id !== currentUser().id ? html`<button class="btn ghost danger sm" data-off="${u.id}">Disable</button>` : '')}
            </td>
          </tr>`)}
        </tbody></table></div>` : empty('No accounts.');

    $('#btn-new', view).addEventListener('click', () => openUserForm(null, roles, load));
    $$('[data-edit]', view).forEach((b) => b.addEventListener('click', () =>
      openUserForm(data.find((u) => u.id == b.dataset.edit), roles, load)));
    $$('[data-off]', view).forEach((b) => b.addEventListener('click', async () => {
      const u = data.find((x) => x.id == b.dataset.off);
      if (!await confirmDialog('Disable account', `${u.name} will no longer be able to sign in. You can re-enable the account later.`, 'Disable')) return;
      try { await api.disableUser(u.id); toast('Account disabled'); load(); } catch (err) { toastError(err); }
    }));
  }
  await load();
}
