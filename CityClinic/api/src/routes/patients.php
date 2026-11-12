<?php
/**
 * GET    /patients?q=search&page=1&per_page=20
 * POST   /patients              (Admin, Receptionist)
 * GET    /patients/{id}         includes appointment history
 * PUT    /patients/{id}         (Admin, Receptionist)
 * DELETE /patients/{id}         (Admin) - refused if the patient has appointments
 */

function patient_rules(): array
{
    return [
        'patient_code' => 'string|max:30',
        'full_name'    => 'required|string|max:100',
        'gender'       => 'in:' . implode(',', GENDERS),
        'dob'          => 'date',
        'phone'        => 'string|max:20',
        'address'      => 'string|max:255',
    ];
}

function validate_dob(?string $dob): void
{
    if ($dob && $dob > date('Y-m-d')) {
        throw new HttpError(422, 'Some fields are invalid.', ['errors' => ['dob' => 'Date of birth cannot be in the future.']]);
    }
}

/** Next free code like PAT003. */
function next_patient_code(): string
{
    $max = q("SELECT MAX(CAST(SUBSTRING(patient_code, 4) AS UNSIGNED)) FROM patients WHERE patient_code REGEXP '^PAT[0-9]+$'")
        ->fetchColumn();
    return sprintf('PAT%03d', ((int)$max) + 1);
}

route('GET', '/patients', function () {
    auth();
    $search  = query_param('q', '');
    $page    = max(1, (int)query_param('page', 1));
    $perPage = min(100, max(1, (int)query_param('per_page', 20)));

    $where = '';
    $params = [];
    if ($search !== '') {
        $where = 'WHERE full_name LIKE :s1 OR patient_code LIKE :s2 OR phone LIKE :s3';
        $like = '%' . $search . '%';
        $params = ['s1' => $like, 's2' => $like, 's3' => $like];
    }
    $total = (int)q("SELECT COUNT(*) FROM patients $where", $params)->fetchColumn();
    $offset = ($page - 1) * $perPage;
    $rows = q("SELECT * FROM patients $where ORDER BY full_name LIMIT $perPage OFFSET $offset", $params)->fetchAll();

    json_response([
        'data' => $rows,
        'meta' => ['page' => $page, 'per_page' => $perPage, 'total' => $total, 'pages' => (int)ceil($total / $perPage)],
    ]);
});

route('GET', '/patients/{id}', function ($p) {
    auth();
    $patient = require_found(q('SELECT * FROM patients WHERE id = ?', [$p['id']])->fetch(), 'Patient');
    $patient['appointments'] = q('SELECT a.*, u.name AS doctor_name, d.specialization
        FROM appointments a JOIN doctors d ON d.id = a.doctor_id JOIN users u ON u.id = d.user_id
        WHERE a.patient_id = ? ORDER BY a.appointment_date DESC, a.start_time DESC', [$p['id']])->fetchAll();
    json_response($patient);
});

route('POST', '/patients', function () {
    require_role(ROLE_ADMIN, ROLE_RECEPTIONIST);
    $in = validate(body(), patient_rules());
    validate_dob($in['dob']);
    $in['patient_code'] = $in['patient_code'] ?: next_patient_code();

    q('INSERT INTO patients (patient_code, full_name, gender, dob, phone, address)
       VALUES (:patient_code, :full_name, :gender, :dob, :phone, :address)', $in);
    $id = (int)db()->lastInsertId();
    json_response(q('SELECT * FROM patients WHERE id = ?', [$id])->fetch(), 201);
});

route('PUT', '/patients/{id}', function ($p) {
    require_role(ROLE_ADMIN, ROLE_RECEPTIONIST);
    require_found(q('SELECT id FROM patients WHERE id = ?', [$p['id']])->fetch(), 'Patient');
    $in = validate(body(), patient_rules(), true);
    if (array_key_exists('patient_code', $in) && !$in['patient_code']) {
        unset($in['patient_code']); // keep existing code
    }
    if (array_key_exists('dob', $in)) validate_dob($in['dob']);
    if ($in) {
        q('UPDATE patients SET ' . set_clause($in) . ' WHERE id = :id', $in + ['id' => $p['id']]);
    }
    json_response(q('SELECT * FROM patients WHERE id = ?', [$p['id']])->fetch());
});

route('DELETE', '/patients/{id}', function ($p) {
    require_role(ROLE_ADMIN);
    require_found(q('SELECT id FROM patients WHERE id = ?', [$p['id']])->fetch(), 'Patient');
    $count = (int)q('SELECT COUNT(*) FROM appointments WHERE patient_id = ?', [$p['id']])->fetchColumn();
    if ($count > 0) {
        throw new HttpError(409, "This patient has $count appointment(s) and cannot be deleted.");
    }
    q('DELETE FROM patients WHERE id = ?', [$p['id']]);
    no_content();
});
