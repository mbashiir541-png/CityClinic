<?php
/**
 * Staff accounts - Admin only.
 *
 * GET    /roles
 * GET    /users
 * POST   /users            { name, email, password, roles: ["Receptionist"], status }
 * GET    /users/{id}
 * PUT    /users/{id}       { name?, email?, password?, roles?, status? }
 * DELETE /users/{id}       disables the account (users are never hard-deleted,
 *                          because doctors/appointments may reference them)
 *
 * Doctors are created through POST /doctors so they also get a doctor profile.
 */

function all_role_names(): array
{
    return q('SELECT name FROM roles ORDER BY name')->fetchAll(PDO::FETCH_COLUMN);
}

/** Validate the "roles" array and return matching role ids. */
function role_ids_from(array $names): array
{
    $names = array_values(array_unique(array_filter(array_map('strval', $names))));
    if (!$names) {
        throw new HttpError(422, 'Some fields are invalid.', ['errors' => ['roles' => 'Choose at least one role.']]);
    }
    $marks = implode(',', array_fill(0, count($names), '?'));
    $rows = q("SELECT id, name FROM roles WHERE name IN ($marks)", $names)->fetchAll(PDO::FETCH_KEY_PAIR);
    if (count($rows) !== count($names)) {
        throw new HttpError(422, 'Some fields are invalid.', ['errors' => ['roles' => 'Unknown role. Allowed: ' . implode(', ', all_role_names())]]);
    }
    return array_keys($rows);
}

function set_user_roles(int $userId, array $roleIds): void
{
    q('DELETE FROM user_roles WHERE user_id = ?', [$userId]);
    foreach ($roleIds as $rid) {
        q('INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)', [$userId, $rid]);
    }
}

function find_user(int $id): array
{
    return hydrate_user(require_found(q('SELECT * FROM users WHERE id = ?', [$id])->fetch(), 'User'));
}

function admin_count_excluding(int $userId): int
{
    return (int)q("SELECT COUNT(DISTINCT u.id) FROM users u
        JOIN user_roles ur ON ur.user_id = u.id JOIN roles r ON r.id = ur.role_id
        WHERE r.name = 'Admin' AND u.status = 1 AND u.id <> ?", [$userId])->fetchColumn();
}

route('GET', '/roles', function () {
    require_role(ROLE_ADMIN);
    json_response(['data' => q('SELECT * FROM roles ORDER BY name')->fetchAll()]);
});

route('GET', '/users', function () {
    require_role(ROLE_ADMIN);
    $rows = q('SELECT * FROM users ORDER BY name')->fetchAll();
    json_response(['data' => array_map('hydrate_user', $rows)]);
});

route('GET', '/users/{id}', function ($p) {
    require_role(ROLE_ADMIN);
    json_response(find_user($p['id']));
});

route('POST', '/users', function () {
    require_role(ROLE_ADMIN);
    $body = body();
    $in = validate($body, [
        'name'     => 'required|string|max:100',
        'email'    => 'required|email|max:100',
        'password' => 'required|string|min:8|max:72',
        'status'   => 'bool',
    ]);
    $roleIds = role_ids_from((array)($body['roles'] ?? []));
    if (q('SELECT 1 FROM users WHERE email = ?', [$in['email']])->fetchColumn()) {
        throw new HttpError(422, 'Some fields are invalid.', ['errors' => ['email' => 'This email is already used.']]);
    }

    db()->beginTransaction();
    q('INSERT INTO users (name, email, password, status) VALUES (?, ?, ?, ?)',
        [$in['name'], $in['email'], password_hash($in['password'], PASSWORD_BCRYPT), ($in['status'] ?? true) ? 1 : 0]);
    $id = (int)db()->lastInsertId();
    set_user_roles($id, $roleIds);
    db()->commit();

    json_response(find_user($id), 201);
});

route('PUT', '/users/{id}', function ($p) {
    $me = require_role(ROLE_ADMIN);
    $user = find_user($p['id']);
    $body = body();
    $in = validate($body, [
        'name'     => 'required|string|max:100',
        'email'    => 'required|email|max:100',
        'password' => 'string|min:8|max:72',
        'status'   => 'bool',
    ], true);
    if (array_key_exists('password', $in) && !$in['password']) unset($in['password']);

    if (isset($in['email']) && q('SELECT 1 FROM users WHERE email = ? AND id <> ?', [$in['email'], $user['id']])->fetchColumn()) {
        throw new HttpError(422, 'Some fields are invalid.', ['errors' => ['email' => 'This email is already used.']]);
    }

    $roleIds = array_key_exists('roles', $body) ? role_ids_from((array)$body['roles']) : null;
    $newRoles = $roleIds === null ? $user['roles']
        : q('SELECT name FROM roles WHERE id IN (' . implode(',', array_map('intval', $roleIds)) . ')')->fetchAll(PDO::FETCH_COLUMN);

    // Never lock everyone out: keep at least one active admin
    $losesAdmin = in_array(ROLE_ADMIN, $user['roles'], true)
        && (!in_array(ROLE_ADMIN, $newRoles, true) || (isset($in['status']) && !$in['status']));
    if ($losesAdmin && admin_count_excluding($user['id']) === 0) {
        throw new HttpError(409, 'There must be at least one active Admin.');
    }
    // A doctor profile needs the Doctor role
    if ($user['doctor_id'] && !in_array(ROLE_DOCTOR, $newRoles, true)) {
        throw new HttpError(409, 'This user has a doctor profile, so the Doctor role cannot be removed. Delete the doctor first.');
    }

    if (isset($in['password'])) $in['password'] = password_hash($in['password'], PASSWORD_BCRYPT);
    if (isset($in['status']))   $in['status'] = $in['status'] ? 1 : 0;

    db()->beginTransaction();
    if ($in) {
        q('UPDATE users SET ' . set_clause($in) . ' WHERE id = :id', $in + ['id' => $user['id']]);
    }
    if ($roleIds !== null) set_user_roles($user['id'], $roleIds);
    // Disabled users are logged out everywhere
    if (isset($in['status']) && !$in['status']) q('DELETE FROM api_tokens WHERE user_id = ?', [$user['id']]);
    db()->commit();

    json_response(find_user($user['id']));
});

route('DELETE', '/users/{id}', function ($p) {
    $me = require_role(ROLE_ADMIN);
    $user = find_user($p['id']);
    if ($user['id'] === $me['id']) {
        throw new HttpError(409, 'You cannot disable your own account.');
    }
    if (in_array(ROLE_ADMIN, $user['roles'], true) && admin_count_excluding($user['id']) === 0) {
        throw new HttpError(409, 'There must be at least one active Admin.');
    }
    q('UPDATE users SET status = 0 WHERE id = ?', [$user['id']]);
    q('DELETE FROM api_tokens WHERE user_id = ?', [$user['id']]);
    no_content();
});
