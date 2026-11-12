// Dashboard: key numbers + the day's appointments.
import { api } from '../api.js';
import { $, html, raw, todayISO, date, toastError } from '../ui.js';
import { canManage, isDoctorOnly, currentUser } from '../roles.js';
import { renderAppointmentTable } from './appointments.js';
import { openAppointmentForm } from './appointment-form.js';

export async function dashboardView(view, isCurrent) {
  let day = todayISO();

  view.innerHTML = html`
    <div class="page-head">
      <div>
        <h1>Hello, ${currentUser().name}</h1>
        <div class="muted" id="dash-date"></div>
      </div>
      <div class="actions">
        <input type="date" id="dash-day" value="${day}" aria-label="Day" style="width:auto">
        ${raw(canManage() ? '<button class="btn" id="btn-new">+ Book appointment</button>' : '')}
      </div>
    </div>
    <div class="stats" id="stats"></div>
    <div class="split">
      <div class="card">
        <div class="card-head"><h2 id="list-title">Appointments</h2><a href="#/appointments" class="small">View all</a></div>
        <div id="today"></div>
      </div>
      <div class="card">
        <div class="card-head"><h2>Status breakdown</h2></div>
        <div class="card-body" id="breakdown"></div>
      </div>
    </div>`;

  async function load() {
    const d = await api.dashboard(day);
    if (!isCurrent()) return;
    const t = d.totals;
    $('#dash-date', view).textContent = date(day, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    $('#list-title', view).textContent = day === todayISO() ? "Today's appointments" : `Appointments on ${date(day)}`;
    $('#stats', view).innerHTML = [
      ['Appointments this day', t.appointments_day],
      ['Upcoming (after this day)', t.upcoming],
      ['Patients', t.patients],
      ['Active doctors', t.active_doctors],
    ].map(([l, v]) => html`<div class="card stat"><div class="label">${l}</div><div class="value">${v}</div></div>`).join('');

    const max = Math.max(1, ...Object.values(d.by_status));
    $('#breakdown', view).innerHTML = Object.entries(d.by_status).map(([s, n]) => html`
      <div style="margin-bottom:.8rem">
        <div style="display:flex;justify-content:space-between" class="small"><span class="badge ${s}">${s}</span><strong>${n}</strong></div>
        <div style="height:6px;background:var(--bg);border-radius:3px;margin-top:.35rem">
          <div style="height:100%;width:${Math.round((n / max) * 100)}%;background:var(--primary);border-radius:3px"></div>
        </div>
      </div>`).join('');

    renderAppointmentTable($('#today', view), d.appointments, {
      onChange: load, showDate: false, showDoctor: !isDoctorOnly(),
      emptyText: 'No appointments on this day.',
    });
  }

  $('#dash-day', view).addEventListener('change', (e) => { day = e.target.value || todayISO(); load().catch(toastError); });
  $('#btn-new', view)?.addEventListener('click', () => openAppointmentForm({ date: day, onSaved: load }).catch(toastError));
  await load();
}
