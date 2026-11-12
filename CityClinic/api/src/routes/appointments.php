<?php
/**
 * GET    /appointments?date=&from=&to=&doctor_id=&patient_id=&status=&q=
 * POST   /appointments                 (Admin, Receptionist)
 * GET    /appointments/{id}
 * PUT    /appointments/{id}            (Admin, Receptionist) reschedule / edit
 * PATCH  /appointments/{id}/status     (Admin, Receptionist, or the appointment's own doctor)
 * DELETE /appointments/{id}            (Admin)
 *
 * Booking rules enforced on create/update:
 *   - patient exists, doctor exists and is active
 *   - start_time < end_time, not in the past
 *   - the time is inside one of the doctor's schedule blocks for that weekday
 *   - no overlap with another non-cancelled appointment of the same doctor
 *   - no overlap with another non-cancelled appointment of the same patient
 *
 * Doctors (without another role) only ever see their own appointments.
 */

const APPOINTMENT_SELECT = 'SELECT a.id, a.patient_id, a.doctor_id, a.appointment_date, a.start_time, a.end_time, a.status,
        p.full_name AS patient_name, p.patient_code, p.phone AS patient_phone,
        u.name AS doctor_name, d.specialization
    FROM appointments a
    JOIN patients p ON p.id = a.patient_id
    JOIN doctors d ON d.id = a.doctor_id
    JOIN users u ON u.id = d.user_id';

function find_appointment(int $id): array
{
    $a = require_found(q(APPOINTMENT_SELECT . ' WHERE a.id = ?', [$id])->fetch(), 'Appointment');
    if (is_doctor_only() && (int)$a['doctor_id'] !== auth()['doctor_id']) {
        throw new HttpError(404, 'Appointment not found.');
    }
    return $a;
}

function appointment_errors(array $errors): HttpError
{
    return new HttpError(422, 'This appointment cannot be booked.', ['errors' => $errors]);
}

/**
 * Check all booking rules. Must be called inside a transaction: it locks the
 * doctor row so two receptionists cannot book the same slot at the same time.
 */
function check_booking(array $a, int $excludeId = 0): void
{
    if ($a['start_time'] >= $a['end_time']) {
        throw appointment_errors(['end_time' => 'End time must be after start time.']);
    }

    $patient = q('SELECT id FROM patients WHERE id = ?', [$a['patient_id']])->fetch();
    if (!$patient) throw appointment_errors(['patient_id' => 'Patient not found.']);

    $doctor = q('SELECT d.id, d.status, u.status AS user_status FROM doctors d JOIN users u ON u.id = d.user_id
                 WHERE d.id = ? FOR UPDATE', [$a['doctor_id']])->fetch();
    if (!$doctor) throw appointment_errors(['doctor_id' => 'Doctor not found.']);
    if (!$doctor['status'] || !$doctor['user_status']) {
        throw appointment_errors(['doctor_id' => 'This doctor is not active.']);
    }

    if (strtotime("{$a['appointment_date']} {$a['start_time']}") < time()) {
        throw appointment_errors(['appointment_date' => 'The appointment time is in the past.']);
    }

    $day = date('l', strtotime($a['appointment_date']));
    $inSchedule = q('SELECT 1 FROM doctor_schedules WHERE doctor_id = ? AND day_of_week = ?
                     AND start_time <= ? AND end_time >= ?',
        [$a['doctor_id'], $day, $a['start_time'], $a['end_time']])->fetchColumn();
    if (!$inSchedule) {
        throw appointment_errors(['start_time' => "The doctor does not work at this time on $day."]);
    }

    $overlap = "SELECT a.start_time, a.end_time FROM appointments a
                WHERE a.%s = ? AND a.appointment_date = ? AND a.status <> 'Cancelled' AND a.id <> ?
                AND a.start_time < ? AND a.end_time > ? LIMIT 1";
    $args = [$a['appointment_date'], $excludeId, $a['end_time'], $a['start_time']];

    if ($c = q(sprintf($overlap, 'doctor_id'), array_merge([$a['doctor_id']], $args))->fetch()) {
        throw appointment_errors(['start_time' => sprintf('The doctor already has an appointment from %s to %s.',
            substr($c['start_time'], 0, 5), substr($c['end_time'], 0, 5))]);
    }
    if ($c = q(sprintf($overlap, 'patient_id'), array_merge([$a['patient_id']], $args))->fetch()) {
        throw appointment_errors(['start_time' => sprintf('The patient already has an appointment from %s to %s.',
            substr($c['start_time'], 0, 5), substr($c['end_time'], 0, 5))]);
    }
}

function appointment_rules(): array
{
    return [
        'patient_id'       => 'required|int',
        'doctor_id'        => 'required|int',
        'appointment_date' => 'required|date',
        'start_time'       => 'required|time',
        'end_time'         => 'required|time',
        'status'           => 'in:' . implode(',', APPOINTMENT_STATUSES),
    ];
}

route('GET', '/appointments', function () {
    $user = auth();
    $in = validate([
        'date' => query_param('date'), 'from' => query_param('from'), 'to' => query_param('to'),
        'doctor_id' => query_param('doctor_id'), 'patient_id' => query_param('patient_id'),
        'status' => query_param('status'),
    ], [
        'date' => 'date', 'from' => 'date', 'to' => 'date',
        'doctor_id' => 'int', 'patient_id' => 'int',
        'status' => 'in:' . implode(',', APPOINTMENT_STATUSES),
    ]);

    $where = [];
    $params = [];
    if (is_doctor_only()) {
        $in['doctor_id'] = $user['doctor_id'] ?? 0;
    }
    if ($in['date'])       { $where[] = 'a.appointment_date = ?'; $params[] = $in['date']; }
    if ($in['from'])       { $where[] = 'a.appointment_date >= ?'; $params[] = $in['from']; }
    if ($in['to'])         { $where[] = 'a.appointment_date <= ?'; $params[] = $in['to']; }
    if ($in['doctor_id'])  { $where[] = 'a.doctor_id = ?'; $params[] = $in['doctor_id']; }
    if ($in['patient_id']) { $where[] = 'a.patient_id = ?'; $params[] = $in['patient_id']; }
    if ($in['status'])     { $where[] = 'a.status = ?'; $params[] = $in['status']; }
    $search = query_param('q', '');
    if ($search !== '') {
        $where[] = '(p.full_name LIKE ? OR p.patient_code LIKE ? OR u.name LIKE ?)';
        array_push($params, "%$search%", "%$search%", "%$search%");
    }

    $sql = APPOINTMENT_SELECT . ($where ? ' WHERE ' . implode(' AND ', $where) : '')
        . ' ORDER BY a.appointment_date DESC, a.start_time ASC LIMIT 500';
    json_response(['data' => q($sql, $params)->fetchAll()]);
});

route('GET', '/appointments/{id}', function ($p) {
    json_response(find_appointment($p['id']));
});

route('POST', '/appointments', function () {
    require_role(ROLE_ADMIN, ROLE_RECEPTIONIST);
    $in = validate(body(), appointment_rules());
    $in['status'] = $in['status'] ?? 'Scheduled';

    db()->beginTransaction();
    if ($in['status'] !== 'Cancelled') {
        check_booking($in);
    }
    q('INSERT INTO appointments (patient_id, doctor_id, appointment_date, start_time, end_time, status)
       VALUES (:patient_id, :doctor_id, :appointment_date, :start_time, :end_time, :status)', $in);
    $id = (int)db()->lastInsertId();
    db()->commit();

    json_response(find_appointment($id), 201);
});

route('PUT', '/appointments/{id}', function ($p) {
    require_role(ROLE_ADMIN, ROLE_RECEPTIONIST);
    $current = find_appointment($p['id']);
    $in = validate(body(), appointment_rules(), true);
    if (array_key_exists('status', $in) && $in['status'] === null) unset($in['status']);
    $merged = array_merge(array_intersect_key($current, appointment_rules()), $in);

    // Only re-check booking rules if the time/people changed and it is still active
    $moved = false;
    foreach (['patient_id', 'doctor_id', 'appointment_date', 'start_time', 'end_time'] as $k) {
        if (array_key_exists($k, $in) && (string)$in[$k] !== (string)$current[$k]) $moved = true;
    }
    $reactivated = $current['status'] === 'Cancelled' && ($merged['status'] ?? '') === 'Scheduled';

    db()->beginTransaction();
    if (($moved || $reactivated) && $merged['status'] !== 'Cancelled') {
        check_booking($merged, $p['id']);
    }
    if ($in) {
        q('UPDATE appointments SET ' . set_clause($in) . ' WHERE id = :id', $in + ['id' => $p['id']]);
    }
    db()->commit();

    json_response(find_appointment($p['id']));
});

route('PATCH', '/appointments/{id}/status', function ($p) {
    $user = auth();
    $current = find_appointment($p['id']); // doctors can only reach their own
    if (!has_role(ROLE_ADMIN, ROLE_RECEPTIONIST, ROLE_DOCTOR)) {
        throw new HttpError(403, 'You do not have permission to do this.');
    }
    $in = validate(body(), ['status' => 'required|in:' . implode(',', APPOINTMENT_STATUSES)]);

    db()->beginTransaction();
    if ($current['status'] === 'Cancelled' && $in['status'] === 'Scheduled') {
        check_booking(array_intersect_key($current, appointment_rules()), $p['id']);
    }
    q('UPDATE appointments SET status = ? WHERE id = ?', [$in['status'], $p['id']]);
    db()->commit();

    json_response(find_appointment($p['id']));
});

route('DELETE', '/appointments/{id}', function ($p) {
    require_role(ROLE_ADMIN);
    find_appointment($p['id']);
    q('DELETE FROM appointments WHERE id = ?', [$p['id']]);
    no_content();
});
