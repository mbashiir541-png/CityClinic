<?php
/**
 * GET /dashboard?date=YYYY-MM-DD  -> summary numbers + that day's appointments
 * Doctors only see their own numbers.
 */

route('GET', '/dashboard', function () {
    $user = auth();
    $date = query_param('date') ?: date('Y-m-d');
    validate(['date' => $date], ['date' => 'date']);

    $doctorFilter = '';
    $params = [$date];
    if (is_doctor_only()) {
        $doctorFilter = ' AND a.doctor_id = ?';
        $params[] = $user['doctor_id'] ?? 0;
    }

    $byStatus = q("SELECT a.status, COUNT(*) AS n FROM appointments a
                   WHERE a.appointment_date = ? $doctorFilter GROUP BY a.status", $params)
        ->fetchAll(PDO::FETCH_KEY_PAIR);

    $today = q("SELECT a.id, a.appointment_date, a.start_time, a.end_time, a.status,
                       a.patient_id, p.full_name AS patient_name, p.patient_code,
                       a.doctor_id, u.name AS doctor_name, d.specialization
                FROM appointments a
                JOIN patients p ON p.id = a.patient_id
                JOIN doctors d ON d.id = a.doctor_id
                JOIN users u ON u.id = d.user_id
                WHERE a.appointment_date = ? $doctorFilter
                ORDER BY a.start_time", $params)->fetchAll();

    $upcomingParams = [$date];
    if (is_doctor_only()) $upcomingParams[] = $user['doctor_id'] ?? 0;
    $upcoming = (int)q("SELECT COUNT(*) FROM appointments a
                        WHERE a.appointment_date > ? AND a.status = 'Scheduled' $doctorFilter", $upcomingParams)->fetchColumn();

    json_response([
        'date'   => $date,
        'totals' => [
            'patients'          => (int)q('SELECT COUNT(*) FROM patients')->fetchColumn(),
            'active_doctors'    => (int)q('SELECT COUNT(*) FROM doctors WHERE status = 1')->fetchColumn(),
            'appointments_day'  => array_sum(array_map('intval', $byStatus)),
            'upcoming'          => $upcoming,
        ],
        'by_status'    => array_map('intval', $byStatus) + array_fill_keys(APPOINTMENT_STATUSES, 0),
        'appointments' => $today,
    ]);
});
