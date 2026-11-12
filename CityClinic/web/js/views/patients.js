// Patients list, form and detail page.
import { api } from '../api.js';
import { $, $$, html, raw, modal, field, toast, toastError, confirmDialog, date, age, todayISO, empty, spinner } from '../ui.js';
import { canManage, isAdmin } from '../roles.js';
import { renderAppointmentTable } from './appointments.js';
import { openAppointmentForm } from './appointment-form.js';

function openPatientForm(patient, onSaved) {
  const p = patient || {};
  modal({
    title: patient ? 'Edit patient' : 'New patient',
    submitLabel: patient ? 'Save changes' : 'Add patient',
    body: html`
      ${raw(field('full_name', 'Full name', { value: p.full_name, required: true }))}
      <div class="grid-2">
        ${raw(field('patient_code', 'Patient code', { value: p.patient_code, hint: patient ? '' : 'Leave empty to generate (e.g. PAT003).' }))}
        ${raw(field('gender', 'Gender', { options: [['', '—'], ['Male', 'Male'], ['Female', 'Female']], value: p.gender }))}
        ${raw(field('dob', 'Date of birth', { type: 'date', value: p.dob, attrs: `max="${todayISO()}"` }))}
        ${raw(field('phone', 'Phone', { type: 'tel', value: p.phone }))}
      </div>
      ${raw(field('address', 'Address', { value: p.address }))}`,
    onSubmit: async (d) => {
      const saved = patient ? await api.updatePatient(patient.id, d) : await api.createPatient(d);
      toast(patient ? 'Patient updated' : `Patient ${saved.patient_code} added`);
      onSaved?.(saved);
    },
  });
}

export async function patientsView(view, isCurrent) {
  const state = { q: '', page: 1 };
  view.innerHTML = html`
    <div class="page-head">
      <div><h1>Patients</h1><div class="muted">Patient records and history</div></div>
      <div class="actions">${raw(canManage() ? '<button class="btn" id="btn-new">+ New patient</button>' : '')}</div>
    </div>
    <div class="card">
      <div class="toolbar"><input class="search" type="search" id="f-q" placeholder="Search by name, code or phone"></div>
      <div id="list">${raw(spinner())}</div>
      <div class="pager" id="pager" hidden></div>
    </div>`;

  const list = $('#list', view);
  const pager = $('#pager', view);
  let loadId = 0;

  async function load() {
    const id = ++loadId;
    const res = await api.patients({ q: state.q, page: state.page, per_page: 20 });
    if (id !== loadId || !isCurrent()) return;
    const rows = res.data;
    list.innerHTML = rows.length ? html`
      <div class="table-wrap"><table class="responsive">
        <thead><tr><th>Code</th><th>Name</th><th>Gender</th><th>Age</th><th>Phone</th><th>Address</th></tr></thead>
        <tbody>${rows.map((p) => html`
          <tr class="clickable" data-id="${p.id}">
            <td data-label="Code"><span class="badge">${p.patient_code}</span></td>
            <td data-label="Name"><strong>${p.full_name}</strong></td>
            <td data-label="Gender">${p.gender || '—'}</td>
            <td data-label="Age">${p.dob ? age(p.dob) : '—'}</td>
            <td data-label="Phone">${p.phone || '—'}</td>
            <td data-label="Address">${p.address || '—'}</td>
          </tr>`)}
        </tbody></table></div>` : empty(state.q ? 'No patients match your search.' : 'No patients yet.');
    $$('tr[data-id]', list).forEach((tr) => tr.addEventListener('click', () => { location.hash = `#/patients/${tr.dataset.id}`; }));

    const m = res.meta;
    pager.hidden = m.pages <= 1;
    pager.innerHTML = html`
      <button class="btn secondary sm" id="prev" ${raw(m.page <= 1 ? 'disabled' : '')}>Previous</button>
      <span class="small muted">Page ${m.page} of ${m.pages} · ${m.total} patients</span>
      <button class="btn secondary sm" id="next" ${raw(m.page >= m.pages ? 'disabled' : '')}>Next</button>`;
    $('#prev', pager).onclick = () => { state.page--; load().catch(toastError); };
    $('#next', pager).onclick = () => { state.page++; load().catch(toastError); };
  }

  let t;
  $('#f-q', view).addEventListener('input', (e) => {
    clearTimeout(t);
    t = setTimeout(() => { state.q = e.target.value.trim(); state.page = 1; load().catch(toastError); }, 250);
  });
  $('#btn-new', view)?.addEventListener('click', () => openPatientForm(null, (p) => { location.hash = `#/patients/${p.id}`; }));
  await load();
}

export async function patientDetailView(view, id, isCurrent) {
  async function load() {
    const p = await api.patient(id);
    if (!isCurrent()) return;
    view.innerHTML = html`
      <div class="page-head">
        <div>
          <a href="#/patients" class="small">← All patients</a>
          <h1 style="margin-top:.3rem">${p.full_name}</h1>
          <div class="muted">${p.patient_code}</div>
        </div>
        <div class="actions">
          ${raw(canManage() ? '<button class="btn secondary" id="btn-edit">Edit</button><button class="btn" id="btn-book">+ Book appointment</button>' : '')}
          ${raw(isAdmin() ? '<button class="btn danger" id="btn-del">Delete</button>' : '')}
        </div>
      </div>
      <div class="split">
        <div class="card">
          <div class="card-head"><h2>Appointment history</h2><span class="small muted">${p.appointments.length} total</span></div>
          <div id="history"></div>
        </div>
        <div class="card">
          <div class="card-head"><h2>Details</h2></div>
          <div class="card-body">
            <dl class="details">
              <dt>Gender</dt><dd>${p.gender || '—'}</dd>
              <dt>Date of birth</dt><dd>${p.dob ? `${date(p.dob)} (${age(p.dob)} yrs)` : '—'}</dd>
              <dt>Phone</dt><dd>${raw(p.phone ? html`<a href="tel:${p.phone}">${p.phone}</a>` : '—')}</dd>
              <dt>Address</dt><dd>${p.address || '—'}</dd>
            </dl>
          </div>
        </div>
      </div>`;

    renderAppointmentTable($('#history', view), p.appointments, {
      onChange: load, showPatient: false, emptyText: 'This patient has no appointments yet.',
    });
    $('#btn-edit', view)?.addEventListener('click', () => openPatientForm(p, load));
    $('#btn-book', view)?.addEventListener('click', () => openAppointmentForm({ patientId: p.id, onSaved: load }).catch(toastError));
    $('#btn-del', view)?.addEventListener('click', async () => {
      if (!await confirmDialog('Delete patient', `Delete ${p.full_name} (${p.patient_code})? This cannot be undone.`)) return;
      try {
        await api.deletePatient(p.id);
        toast('Patient deleted');
        location.hash = '#/patients';
      } catch (err) { toastError(err); }
    });
  }
  await load();
}
