// Book / reschedule appointment modal (used from several views).
import { api } from '../api.js';
import { $, $$, html, raw, modal, field, toast, todayISO, time, date } from '../ui.js';

/**
 * openAppointmentForm({ appointment, patientId, doctorId, date, onSaved })
 * - appointment: existing appointment to reschedule (optional)
 */
export async function openAppointmentForm({ appointment = null, patientId = null, doctorId = null, date: day = null, onSaved } = {}) {
  const [doctorsRes, patientsRes] = await Promise.all([
    api.doctors({ active: 1 }),
    api.patients({ per_page: 100 }),
  ]);
  const doctors = doctorsRes.data;
  let patients = patientsRes.data;

  const a = appointment || {};
  const selectedPatient = a.patient_id || patientId || '';
  const selectedDoctor = a.doctor_id || doctorId || (doctors.length === 1 ? doctors[0].id : '');
  // Make sure the current patient is in the list even if not in the first 100
  if (selectedPatient && !patients.some((p) => p.id == selectedPatient)) {
    try { patients = [await api.patient(selectedPatient), ...patients]; } catch { /* ignore */ }
  }

  const patientOptions = (list) => [['', 'Select patient…'], ...list.map((p) => [p.id, `${p.full_name} (${p.patient_code})`])];

  modal({
    title: appointment ? 'Reschedule appointment' : 'Book appointment',
    submitLabel: appointment ? 'Save changes' : 'Book appointment',
    wide: true,
    body: html`
      <div class="grid-2">
        <div>
          <div class="field">
            <label for="patient-search">Find patient</label>
            <input id="patient-search" type="search" placeholder="Name, code or phone">
          </div>
          ${raw(field('patient_id', 'Patient', { options: patientOptions(patients), value: selectedPatient, required: true }))}
        </div>
        <div>
          ${raw(field('doctor_id', 'Doctor', {
            options: [['', 'Select doctor…'], ...doctors.map((d) => [d.id, `${d.name}${d.specialization ? ` — ${d.specialization}` : ''}`])],
            value: selectedDoctor, required: true,
          }))}
          ${raw(field('appointment_date', 'Date', { type: 'date', value: a.appointment_date || day || todayISO(), required: true, attrs: `min="${todayISO()}"` }))}
        </div>
      </div>
      <input type="hidden" name="start_time" value="${a.start_time || ''}">
      <input type="hidden" name="end_time" value="${a.end_time || ''}">
      <div class="field">
        <label>Time slot *</label>
        <div id="slot-area"><div class="hint">Choose a doctor and a date to see free times.</div></div>
      </div>`,
    onOpen: (form) => {
      const patientSel = $('[name=patient_id]', form);
      const doctorSel = $('[name=doctor_id]', form);
      const dateInput = $('[name=appointment_date]', form);
      const startIn = $('[name=start_time]', form);
      const endIn = $('[name=end_time]', form);
      const area = $('#slot-area', form);

      // Patient search (server side)
      let t;
      $('#patient-search', form).addEventListener('input', (e) => {
        clearTimeout(t);
        t = setTimeout(async () => {
          const keep = patientSel.value;
          const res = await api.patients({ q: e.target.value, per_page: 100 });
          patientSel.innerHTML = patientOptions(res.data)
            .map(([v, l]) => html`<option value="${v}">${l}</option>`).join('');
          if (res.data.some((p) => p.id == keep)) patientSel.value = keep;
          else if (res.data.length === 1) patientSel.value = res.data[0].id;
        }, 250);
      });

      let loadId = 0;
      async function loadSlots() {
        const doctor = doctorSel.value;
        const d = dateInput.value;
        if (!doctor || !d) {
          area.innerHTML = '<div class="hint">Choose a doctor and a date to see free times.</div>';
          return;
        }
        const id = ++loadId;
        area.innerHTML = '<div class="hint">Loading free times…</div>';
        try {
          const res = await api.availability(doctor, d, appointment?.id);
          if (id !== loadId) return;
          if (!res.slots.length) {
            area.innerHTML = html`<div class="hint">The doctor does not work on ${res.day_of_week}s. Pick another date.</div>`;
            startIn.value = endIn.value = '';
            return;
          }
          const hours = res.schedule.map((s) => `${time(s.start_time)}–${time(s.end_time)}`).join(', ');
          area.innerHTML = html`
            <div class="small muted" style="margin-bottom:.5rem">${res.day_of_week} ${date(d)} · working hours ${hours}</div>
            <div class="slots">${res.slots.map((s) => html`
              <button type="button" class="slot ${s.start_time === startIn.value ? 'selected' : ''}"
                data-start="${s.start_time}" data-end="${s.end_time}" ${raw(s.available ? '' : 'disabled')}
                title="${s.available ? 'Free' : 'Booked or past'}">${time(s.start_time)}</button>`)}
            </div>`;
          if (!res.slots.some((s) => s.available)) {
            area.insertAdjacentHTML('beforeend', '<div class="hint" style="margin-top:.5rem">No free times left on this day.</div>');
          }
          $$('.slot', area).forEach((b) => b.addEventListener('click', () => {
            $$('.slot', area).forEach((x) => x.classList.remove('selected'));
            b.classList.add('selected');
            startIn.value = b.dataset.start;
            endIn.value = b.dataset.end;
          }));
        } catch (err) {
          if (id === loadId) area.innerHTML = html`<div class="form-error">${err.message}</div>`;
        }
      }

      const reset = () => { startIn.value = ''; endIn.value = ''; loadSlots(); };
      doctorSel.addEventListener('change', reset);
      dateInput.addEventListener('change', reset);
      loadSlots();
    },
    onSubmit: async (d) => {
      if (!d.start_time) {
        const err = new Error('Please choose a time slot.');
        err.errors = {};
        throw err;
      }
      const payload = {
        patient_id: d.patient_id, doctor_id: d.doctor_id,
        appointment_date: d.appointment_date, start_time: d.start_time, end_time: d.end_time,
      };
      if (appointment) {
        if (appointment.status === 'Cancelled') payload.status = 'Scheduled';
        await api.updateAppointment(appointment.id, payload);
        toast('Appointment updated');
      } else {
        await api.createAppointment(payload);
        toast('Appointment booked');
      }
      onSaved?.();
    },
  });
}
