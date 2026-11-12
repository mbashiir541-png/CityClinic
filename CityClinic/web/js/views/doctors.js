// Doctors list, form, detail page with weekly schedule.
import { api } from '../api.js';
import { $, $$, html, raw, modal, field, toast, toastError, confirmDialog, activeBadge, time, empty } from '../ui.js';
import { isAdmin, canManage } from '../roles.js';
import { openAppointmentForm } from './appointment-form.js';

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function openDoctorForm(doctor, onSaved) {
  const d = doctor || {};
  modal({
    title: doctor ? 'Edit doctor' : 'New doctor',
    submitLabel: doctor ? 'Save changes' : 'Add doctor',
    body: html`
      ${raw(field('name', 'Full name', { value: d.name, required: true, attrs: 'placeholder="Dr. …"' }))}
      <div class="grid-2">
        ${raw(field('email', 'Login email', { type: 'email', value: d.email, required: true }))}
        ${raw(doctor ? '' : field('password', 'Initial password', { type: 'password', required: true, hint: 'At least 8 characters.' }))}
        ${raw(field('specialization', 'Specialization', { value: d.specialization }))}
        ${raw(field('phone', 'Phone', { type: 'tel', value: d.phone }))}
      </div>
      <label class="checkbox"><input type="checkbox" name="status" ${raw(d.status === false ? '' : 'checked')}> Active (can receive appointments)</label>`,
    onSubmit: async (data) => {
      const saved = doctor ? await api.updateDoctor(doctor.id, data) : await api.createDoctor(data);
      toast(doctor ? 'Doctor updated' : 'Doctor added');
      onSaved?.(saved);
    },
  });
}

function openScheduleForm(doctorId, schedule, onSaved) {
  const s = schedule || {};
  modal({
    title: schedule ? 'Edit working hours' : 'Add working hours',
    body: html`
      ${raw(field('day_of_week', 'Day', { options: DAYS.map((x) => [x, x]), value: s.day_of_week || 'Sunday' }))}
      <div class="grid-2">
        ${raw(field('start_time', 'From', { type: 'time', value: time(s.start_time) || '08:00', required: true }))}
        ${raw(field('end_time', 'To', { type: 'time', value: time(s.end_time) || '14:00', required: true }))}
      </div>`,
    onSubmit: async (data) => {
      if (schedule) await api.updateSchedule(schedule.id, data);
      else await api.addSchedule(doctorId, data);
      toast('Schedule saved');
      onSaved?.();
    },
  });
}

export async function doctorsView(view, isCurrent) {
  async function load() {
    const { data } = await api.doctors();
    if (!isCurrent()) return;
    view.innerHTML = html`
      <div class="page-head">
        <div><h1>Doctors</h1><div class="muted">Doctors and their working hours</div></div>
        <div class="actions">${raw(isAdmin() ? '<button class="btn" id="btn-new">+ New doctor</button>' : '')}</div>
      </div>
      <div class="card" id="list"></div>`;
    $('#list', view).innerHTML = data.length ? html`
      <div class="table-wrap"><table class="responsive">
        <thead><tr><th>Name</th><th>Specialization</th><th>Phone</th><th>Email</th><th>Status</th></tr></thead>
        <tbody>${data.map((d) => html`
          <tr class="clickable" data-id="${d.id}">
            <td data-label="Name"><strong>${d.name}</strong></td>
            <td data-label="Specialization">${d.specialization || '—'}</td>
            <td data-label="Phone">${d.phone || '—'}</td>
            <td data-label="Email">${d.email}</td>
            <td data-label="Status">${activeBadge(d.status && d.user_status)}</td>
          </tr>`)}
        </tbody></table></div>` : empty('No doctors yet.');
    $$('tr[data-id]', view).forEach((tr) => tr.addEventListener('click', () => { location.hash = `#/doctors/${tr.dataset.id}`; }));
    $('#btn-new', view)?.addEventListener('click', () => openDoctorForm(null, (d) => { location.hash = `#/doctors/${d.id}`; }));
  }
  await load();
}

export async function doctorDetailView(view, id, isCurrent) {
  async function load() {
    const d = await api.doctor(id);
    if (!isCurrent()) return;
    const byDay = DAYS.map((day) => [day, d.schedules.filter((s) => s.day_of_week === day)]);

    view.innerHTML = html`
      <div class="page-head">
        <div>
          <a href="#/doctors" class="small">← All doctors</a>
          <h1 style="margin-top:.3rem">${d.name}</h1>
          <div class="muted">${d.specialization || 'Doctor'} ${activeBadge(d.status && d.user_status)}</div>
        </div>
        <div class="actions">
          ${raw(canManage() && d.status ? '<button class="btn" id="btn-book">+ Book appointment</button>' : '')}
          ${raw(isAdmin() ? '<button class="btn secondary" id="btn-edit">Edit</button><button class="btn danger" id="btn-del">Delete</button>' : '')}
        </div>
      </div>
      <div class="split">
        <div class="card">
          <div class="card-head"><h2>Weekly schedule</h2>
            ${raw(isAdmin() ? '<button class="btn sm" id="btn-add-sched">+ Add hours</button>' : '')}</div>
          <div class="card-body">
            ${byDay.map(([day, blocks]) => html`
              <div class="schedule-row">
                <strong style="min-width:100px">${day}</strong>
                <div style="flex:1;text-align:right">
                  ${raw(blocks.length ? blocks.map((s) => html`
                    <div>
                      ${time(s.start_time)} – ${time(s.end_time)}
                      ${raw(isAdmin() ? html`<button class="btn ghost sm" data-edit="${s.id}">Edit</button><button class="btn ghost danger sm" data-del="${s.id}">Remove</button>` : '')}
                    </div>`).join('') : '<span class="muted">Off</span>')}
                </div>
              </div>`)}
          </div>
        </div>
        <div class="card">
          <div class="card-head"><h2>Contact</h2></div>
          <div class="card-body">
            <dl class="details">
              <dt>Email</dt><dd>${d.email}</dd>
              <dt>Phone</dt><dd>${raw(d.phone ? html`<a href="tel:${d.phone}">${d.phone}</a>` : '—')}</dd>
              <dt>Account</dt><dd>${d.user_status ? 'Can sign in' : 'Disabled'}</dd>
            </dl>
            <p class="small muted" style="margin-top:1rem"><a href="#/appointments">See appointments →</a></p>
          </div>
        </div>
      </div>`;

    $('#btn-book', view)?.addEventListener('click', () => openAppointmentForm({ doctorId: d.id }).catch(toastError));
    $('#btn-edit', view)?.addEventListener('click', () => openDoctorForm(d, load));
    $('#btn-add-sched', view)?.addEventListener('click', () => openScheduleForm(d.id, null, load));
    $$('[data-edit]', view).forEach((b) => b.addEventListener('click', () =>
      openScheduleForm(d.id, d.schedules.find((s) => s.id == b.dataset.edit), load)));
    $$('[data-del]', view).forEach((b) => b.addEventListener('click', async () => {
      const s = d.schedules.find((x) => x.id == b.dataset.del);
      if (!await confirmDialog('Remove hours', `Remove ${s.day_of_week} ${time(s.start_time)}–${time(s.end_time)}? Existing appointments are kept.`, 'Remove')) return;
      try { await api.deleteSchedule(s.id); toast('Hours removed'); load(); } catch (err) { toastError(err); }
    }));
    $('#btn-del', view)?.addEventListener('click', async () => {
      if (!await confirmDialog('Delete doctor', `Delete ${d.name}? Doctors with appointments cannot be deleted — set them inactive instead.`)) return;
      try { await api.deleteDoctor(d.id); toast('Doctor deleted'); location.hash = '#/doctors'; } catch (err) { toastError(err); }
    });
  }
  await load();
}
