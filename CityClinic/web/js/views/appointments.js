// Appointments list + shared table / actions.
import { api } from '../api.js';
import { $, $$, html, raw, toast, toastError, confirmDialog, statusBadge, time, date, todayISO, empty, spinner } from '../ui.js';
import { canManage, isAdmin, isDoctorOnly, hasRole } from '../roles.js';
import { openAppointmentForm } from './appointment-form.js';

const STATUSES = ['Scheduled', 'Completed', 'Cancelled', 'No-Show'];

/**
 * Render an appointments table into `container`.
 * opts.columns: which columns to show (date, patient, doctor)
 */
export function renderAppointmentTable(container, rows, { onChange, showDate = true, showPatient = true, showDoctor = true, emptyText = 'No appointments.' } = {}) {
  if (!rows.length) {
    container.innerHTML = empty(emptyText);
    return;
  }
  const canStatus = hasRole('Admin', 'Receptionist', 'Doctor');
  container.innerHTML = html`
    <div class="table-wrap"><table class="responsive">
      <thead><tr>
        ${raw(showDate ? '<th>Date</th>' : '')}<th>Time</th>
        ${raw(showPatient ? '<th>Patient</th>' : '')}${raw(showDoctor ? '<th>Doctor</th>' : '')}
        <th>Status</th><th></th>
      </tr></thead>
      <tbody>${rows.map((a) => html`
        <tr>
          ${raw(showDate ? html`<td data-label="Date">${date(a.appointment_date)}</td>` : '')}
          <td data-label="Time" class="nowrap"><div><strong>${time(a.start_time)}</strong>–${time(a.end_time)}</div></td>
          ${raw(showPatient ? html`<td data-label="Patient"><div><a href="#/patients/${a.patient_id}">${a.patient_name}</a>
              <div class="small muted">${a.patient_code}</div></div></td>` : '')}
          ${raw(showDoctor ? html`<td data-label="Doctor" class="nowrap"><div>${a.doctor_name}<div class="small muted">${a.specialization || ''}</div></div></td>` : '')}
          <td data-label="Status">${statusBadge(a.status)}</td>
          <td class="actions">
            ${raw(canStatus && a.status === 'Scheduled' ? html`
              <button class="btn ghost sm" data-act="Completed" data-id="${a.id}">Complete</button>
              <button class="btn ghost sm" data-act="No-Show" data-id="${a.id}">No-show</button>` : '')}
            ${raw(canManage() && a.status === 'Scheduled' ? html`
              <button class="btn ghost sm" data-act="edit" data-id="${a.id}">Reschedule</button>
              <button class="btn ghost danger sm" data-act="Cancelled" data-id="${a.id}">Cancel</button>` : '')}
            ${raw(canManage() && a.status !== 'Scheduled' ? html`
              <button class="btn ghost sm" data-act="Scheduled" data-id="${a.id}">Reopen</button>` : '')}
            ${raw(isAdmin() ? html`<button class="btn ghost danger sm" data-act="delete" data-id="${a.id}" aria-label="Delete">Delete</button>` : '')}
          </td>
        </tr>`)}
      </tbody>
    </table></div>`;

  $$('[data-act]', container).forEach((btn) => btn.addEventListener('click', async () => {
    const appt = rows.find((r) => r.id == btn.dataset.id);
    const act = btn.dataset.act;
    try {
      if (act === 'edit') {
        await openAppointmentForm({ appointment: appt, onSaved: onChange });
        return;
      }
      if (act === 'delete') {
        if (!await confirmDialog('Delete appointment', `Permanently delete ${appt.patient_name}'s appointment on ${date(appt.appointment_date)}? Prefer "Cancel" to keep history.`)) return;
        await api.deleteAppointment(appt.id);
        toast('Appointment deleted');
      } else if (act === 'Cancelled') {
        if (!await confirmDialog('Cancel appointment', `Cancel ${appt.patient_name}'s appointment at ${time(appt.start_time)} on ${date(appt.appointment_date)}?`, 'Cancel appointment')) return;
        await api.setAppointmentStatus(appt.id, act);
        toast('Appointment cancelled');
      } else {
        btn.disabled = true;
        await api.setAppointmentStatus(appt.id, act);
        toast(`Marked as ${act}`);
      }
      onChange?.();
    } catch (err) {
      btn.disabled = false;
      toastError(err);
    }
  }));
}

export async function appointmentsView(view, isCurrent) {
  const doctors = isDoctorOnly() ? [] : (await api.doctors()).data;
  if (!isCurrent()) return;

  const state = { date: todayISO(), status: '', doctor_id: '', q: '', range: 'day' };

  view.innerHTML = html`
    <div class="page-head">
      <div><h1>${isDoctorOnly() ? 'My appointments' : 'Appointments'}</h1><div class="muted">Search, filter and manage bookings</div></div>
      <div class="actions">${raw(canManage() ? '<button class="btn" id="btn-new">+ Book appointment</button>' : '')}</div>
    </div>
    <div class="card">
      <div class="toolbar">
        <input class="search" type="search" id="f-q" placeholder="Search patient or doctor">
        <select id="f-range" aria-label="Period">
          <option value="day">On date</option>
          <option value="upcoming">Upcoming</option>
          <option value="all">All dates</option>
        </select>
        <input type="date" id="f-date" value="${state.date}" aria-label="Date">
        ${raw(doctors.length ? html`<select id="f-doctor" aria-label="Doctor"><option value="">All doctors</option>
          ${doctors.map((d) => html`<option value="${d.id}">${d.name}</option>`)}</select>` : '')}
        <select id="f-status" aria-label="Status"><option value="">All statuses</option>
          ${STATUSES.map((s) => html`<option>${s}</option>`)}</select>
      </div>
      <div id="list">${raw(spinner())}</div>
    </div>`;

  const list = $('#list', view);
  let loadId = 0;
  async function load() {
    const id = ++loadId;
    const params = { status: state.status, doctor_id: state.doctor_id, q: state.q };
    if (state.range === 'day') params.date = state.date;
    if (state.range === 'upcoming') params.from = todayISO();
    try {
      const res = await api.appointments(params);
      if (id !== loadId || !isCurrent()) return;
      let rows = res.data;
      if (state.range === 'upcoming') rows = rows.slice().reverse(); // soonest first
      renderAppointmentTable(list, rows, { onChange: load, emptyText: 'No appointments match these filters.' });
    } catch (err) {
      list.innerHTML = empty(err.message);
    }
  }

  let t;
  $('#f-q', view).addEventListener('input', (e) => { clearTimeout(t); t = setTimeout(() => { state.q = e.target.value.trim(); load(); }, 250); });
  $('#f-range', view).addEventListener('change', (e) => { state.range = e.target.value; $('#f-date', view).hidden = state.range !== 'day'; load(); });
  $('#f-date', view).addEventListener('change', (e) => { state.date = e.target.value || todayISO(); load(); });
  $('#f-status', view).addEventListener('change', (e) => { state.status = e.target.value; load(); });
  $('#f-doctor', view)?.addEventListener('change', (e) => { state.doctor_id = e.target.value; load(); });
  $('#btn-new', view)?.addEventListener('click', () =>
    openAppointmentForm({ date: state.range === 'day' ? state.date : null, doctorId: state.doctor_id || null, onSaved: load }).catch(toastError));

  load();
}
