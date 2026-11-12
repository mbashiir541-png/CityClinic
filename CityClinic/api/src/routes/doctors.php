<?php
/**
 * GET    /doctors?active=1
 * POST   /doctors                       (Admin) creates the user account + doctor profile
 * GET    /doctors/{id}                  includes weekly schedule
 * PUT    /doctors/{id}                  (Admin)
 * DELETE /doctors/{id}                  (Admin) refused if the doctor has appointments
 *
 * GET    /doctors/{id}/schedules
 * POST   /doctors/{id}/schedules        (Admin)
 * PUT    /schedules/{id}                (Admin)
 * DELETE /schedules/{id}                (Admin)
 *
 * GET    /doctors/{id}/availability?date=YYYY-MM-DD   free/booked slots for a day
 */

const DOCTOR_SELECT = 'SELECT d.id, d.user_id, u.name, u.email, d.specialization, d.phone,
        d.status, u.status AS user_status
    FROM doctors d JOIN users u ON u.id = d.user_id';

function find_doctor(int $id): array
{
    $doctor = require_found(q(DOCTOR_SELECT . ' WHERE d.id = ?', [$id])->fetch(), 'Doctor');
    return format_doctor($doctor);
}

function format_doctor(array $d): array
{
    $d['id'] = (int)$d['id'];
    $d['user_id'] = (int)$d['user_id'];
    $d['status'] = (bool)$d['status'];
    $d['user_status'] = (bool)$d['user_status'];
    return $d;
}

function doctor_schedules(int $doctorId): array
{
    return q("SELECT * FROM doctor_schedules WHERE doctor_id = ?
              ORDER BY FIELD(day_of_week,'Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'), start_time",
        [$doctorId])->fetchAll();
}

function role_id(string $name): int
{
    $id = q('SELECT id FROM roles WHERE name = ?', [$name])->fetchColumn();
    if ($id === false) {
        q('INSERT INTO roles (name) VALUES (?)', [$name]);
        $id = db()->lastInsertId();
    }
    return (int)$id;
}

// ------------------------- Doctors -------------------------

route('GET', '/doctors', function () {
    auth();
    $where = query_param('active') === '1' ? ' WHERE d.status = 1 AND u.status = 1' : '';
    $rows = q(DOCTOR_SELECT . $where . ' ORDER BY u.name')->fetchAll();
    json_response(['data' => array_map('format_doctor', $rows)]);
});

route('GET', '/doctors/{id}', function ($p) {
    auth();
    $doctor = find_doctor($p['id']);
    $doctor['schedules'] = doctor_schedules($p['id']);
    json_response($doctor);
});

route('POST', '/doctors', function () {
    require_role(ROLE_ADMIN);
    $in = validate(body(), [
        'name'           => 'required|string|max:100',
        'email'          => 'required|email|max:100',
        'password'       => 'required|string|min:8|max:72',
        'specialization' => 'string|max:100',
        'phone'          => 'string|max:20',
        'status'         => 'bool',
    ]);
    if (q('SELECT 1 FROM users WHERE email = ?', [$in['email']])->fetchColumn()) {
        throw new HttpError(422, 'Some fields are invalid.', ['errors' => ['email' => 'This email is already used.']]);
    }

    db()->beginTransaction();
    q('INSERT INTO users (name, email, password, status) VALUES (?, ?, ?, 1)',
        [$in['name'], $in['email'], password_hash($in['password'], PASSWORD_BCRYPT)]);
    $userId = (int)db()->lastInsertId();
    q('INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)', [$userId, role_id(ROLE_DOCTOR)]);
    q('INSERT INTO doctors (user_id, specialization, phone, status) VALUES (?, ?, ?, ?)',
        [$userId, $in['specialization'], $in['phone'], ($in['status'] ?? true) ? 1 : 0]);
    $id = (int)db()->lastInsertId();
    db()->commit();

    json_response(find_doctor($id), 201);
});

route('PUT', '/doctors/{id}', function ($p) {
    require_role(ROLE_ADMIN);
    $doctor = find_doctor($p['id']);
    $in = validate(body(), [
        'name'           => 'required|string|max:100',
        'email'          => 'required|email|max:100',
        'specialization' => 'string|max:100',
        'phone'          => 'string|max:20',
        'status'         => 'bool',
    ], true);

    if (isset($in['email']) && q('SELECT 1 FROM users WHERE email = ? AND id <> ?', [$in['email'], $doctor['user_id']])->fetchColumn()) {
        throw new HttpError(422, 'Some fields are invalid.', ['errors' => ['email' => 'This email is already used.']]);
    }

    $userFields   = array_intersect_key($in, array_flip(['name', 'email']));
    $doctorFields = array_intersect_key($in, array_flip(['specialization', 'phone', 'status']));
    if (isset($doctorFields['status'])) $doctorFields['status'] = $doctorFields['status'] ? 1 : 0;

    db()->beginTransaction();
    if ($userFields) {
        q('UPDATE users SET ' . set_clause($userFields) . ' WHERE id = :id', $userFields + ['id' => $doctor['user_id']]);
    }
    if ($doctorFields) {
        q('UPDATE doctors SET ' . set_clause($doctorFields) . ' WHERE id = :id', $doctorFields + ['id' => $p['id']]);
    }
    db()->commit();

    json_response(find_doctor($p['id']));
});

route('DELETE', '/doctors/{id}', function ($p) {
    require_role(ROLE_ADMIN);
    $doctor = find_doctor($p['id']);
    $count = (int)q('SELECT COUNT(*) FROM appointments WHERE doctor_id = ?', [$p['id']])->fetchColumn();
    if ($count > 0) {
        throw new HttpError(409, "This doctor has $count appointment(s). Set the doctor to inactive instead of deleting.");
    }
    db()->beginTransaction();
    q('DELETE FROM doctor_schedules WHERE doctor_id = ?', [$p['id']]);
    q('DELETE FROM doctors WHERE id = ?', [$p['id']]);
    q('DELETE FROM user_roles WHERE user_id = ? AND role_id = ?', [$doctor['user_id'], role_id(ROLE_DOCTOR)]);
    db()->commit();
    no_content();
});

// ------------------------- Schedules -------------------------

function schedule_rules(): array
{
    return [
        'day_of_week' => 'required|in:' . implode(',', DAYS_OF_WEEK),
        'start_time'  => 'required|time',
        'end_time'    => 'required|time',
    ];
}

function check_schedule(int $doctorId, array $s, int $excludeId = 0): void
{
    if ($s['start_time'] >= $s['end_time']) {
        throw new HttpError(422, 'Some fields are invalid.', ['errors' => ['end_time' => 'End time must be after start time.']]);
    }
    $clash = q('SELECT id FROM doctor_schedules WHERE doctor_id = ? AND day_of_week = ? AND id <> ?
                AND start_time < ? AND end_time > ?',
        [$doctorId, $s['day_of_week'], $excludeId, $s['end_time'], $s['start_time']])->fetchColumn();
    if ($clash) {
        throw new HttpError(409, "This overlaps another schedule block on {$s['day_of_week']}.");
    }
}

route('GET', '/doctors/{id}/schedules', function ($p) {
    auth();
    find_doctor($p['id']);
    json_response(['data' => doctor_schedules($p['id'])]);
});

route('POST', '/doctors/{id}/schedules', function ($p) {
    require_role(ROLE_ADMIN);
    find_doctor($p['id']);
    $in = validate(body(), schedule_rules());
    check_schedule($p['id'], $in);
    q('INSERT INTO doctor_schedules (doctor_id, day_of_week, start_time, end_time) VALUES (?, ?, ?, ?)',
        [$p['id'], $in['day_of_week'], $in['start_time'], $in['end_time']]);
    $id = (int)db()->lastInsertId();
    json_response(q('SELECT * FROM doctor_schedules WHERE id = ?', [$id])->fetch(), 201);
});

route('PUT', '/schedules/{id}', function ($p) {
    require_role(ROLE_ADMIN);
    $current = require_found(q('SELECT * FROM doctor_schedules WHERE id = ?', [$p['id']])->fetch(), 'Schedule');
    $in = validate(body(), schedule_rules(), true);
    $merged = array_merge($current, $in);
    check_schedule((int)$current['doctor_id'], $merged, $p['id']);
    if ($in) {
        q('UPDATE doctor_schedules SET ' . set_clause($in) . ' WHERE id = :id', $in + ['id' => $p['id']]);
    }
    json_response(q('SELECT * FROM doctor_schedules WHERE id = ?', [$p['id']])->fetch());
});

route('DELETE', '/schedules/{id}', function ($p) {
    require_role(ROLE_ADMIN);
    require_found(q('SELECT id FROM doctor_schedules WHERE id = ?', [$p['id']])->fetch(), 'Schedule');
    q('DELETE FROM doctor_schedules WHERE id = ?', [$p['id']]);
    no_content();
});

// ------------------------- Availability -------------------------

route('GET', '/doctors/{id}/availability', function ($p) {
    auth();
    $doctor = find_doctor($p['id']);
    $in = validate(['date' => query_param('date'), 'exclude' => query_param('exclude')],
        ['date' => 'required|date', 'exclude' => 'int']);
    $date = $in['date'];
    $day  = date('l', strtotime($date));
    $step = (int)config('slot_minutes') * 60;

    $blocks = q('SELECT start_time, end_time FROM doctor_schedules WHERE doctor_id = ? AND day_of_week = ? ORDER BY start_time',
        [$p['id'], $day])->fetchAll();
    $booked = q("SELECT start_time, end_time FROM appointments
                 WHERE doctor_id = ? AND appointment_date = ? AND status <> 'Cancelled' AND id <> ?",
        [$p['id'], $date, $in['exclude'] ?? 0])->fetchAll();

    $now = time();
    $slots = [];
    foreach ($blocks as $b) {
        $t   = strtotime("$date {$b['start_time']}");
        $end = strtotime("$date {$b['end_time']}");
        for (; $t + $step <= $end; $t += $step) {
            $s = date('H:i:s', $t);
            $e = date('H:i:s', $t + $step);
            $free = true;
            foreach ($booked as $a) {
                if ($a['start_time'] < $e && $a['end_time'] > $s) { $free = false; break; }
            }
            $slots[] = ['start_time' => $s, 'end_time' => $e, 'available' => $free && $t > $now];
        }
    }

    json_response([
        'doctor_id'   => $doctor['id'],
        'date'        => $date,
        'day_of_week' => $day,
        'working'     => $doctor['status'] && (bool)$blocks,
        'schedule'    => $blocks,
        'slots'       => $slots,
    ]);
});
