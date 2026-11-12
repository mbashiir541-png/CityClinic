<?php
/**
 * POST /auth/login    { email, password }  -> { token, expires_at, user }
 * POST /auth/logout
 * GET  /auth/me
 * PUT  /auth/password { current_password, new_password }
 */

route('POST', '/auth/login', function () {
    $in = validate(body(), [
        'email'    => 'required|email',
        'password' => 'required|string',
    ]);

    $user = q('SELECT * FROM users WHERE email = ?', [$in['email']])->fetch();
    if (!$user || !password_verify($in['password'], $user['password'])) {
        throw new HttpError(401, 'Wrong email or password.');
    }
    if (!$user['status']) {
        throw new HttpError(403, 'This account is disabled. Contact an administrator.');
    }

    // Clean up this user's expired tokens
    q('DELETE FROM api_tokens WHERE user_id = ? AND expires_at <= NOW()', [$user['id']]);

    $token   = bin2hex(random_bytes(32));
    // expiry is computed by MySQL so it always matches NOW() used in auth()
    q('INSERT INTO api_tokens (user_id, token_hash, expires_at) VALUES (?, ?, DATE_ADD(NOW(), INTERVAL ? HOUR))',
        [$user['id'], hash('sha256', $token), (int)config('token_ttl_hours')]);
    $expires = q('SELECT expires_at FROM api_tokens WHERE id = ?', [db()->lastInsertId()])->fetchColumn();

    json_response([
        'token'      => $token,
        'expires_at' => $expires,
        'user'       => hydrate_user($user),
    ]);
});

route('POST', '/auth/logout', function () {
    auth();
    q('DELETE FROM api_tokens WHERE token_hash = ?', [hash('sha256', bearer_token())]);
    no_content();
});

route('GET', '/auth/me', function () {
    json_response(auth());
});

route('PUT', '/auth/password', function () {
    $user = auth();
    $in = validate(body(), [
        'current_password' => 'required|string',
        'new_password'     => 'required|string|min:8|max:72',
    ]);
    $hash = q('SELECT password FROM users WHERE id = ?', [$user['id']])->fetchColumn();
    if (!password_verify($in['current_password'], $hash)) {
        throw new HttpError(422, 'Some fields are invalid.', ['errors' => ['current_password' => 'Current password is wrong.']]);
    }
    q('UPDATE users SET password = ? WHERE id = ?', [password_hash($in['new_password'], PASSWORD_BCRYPT), $user['id']]);
    json_response(['message' => 'Password changed.']);
});
