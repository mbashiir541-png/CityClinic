<?php
/**
 * Core helpers shared by every route: DB connection, JSON responses,
 * request parsing, validation and authentication.
 */

declare(strict_types=1);

final class HttpError extends Exception
{
    public array $details;

    public function __construct(int $status, string $message, array $details = [])
    {
        parent::__construct($message, $status);
        $this->details = $details;
    }
}

const ROLE_ADMIN        = 'Admin';
const ROLE_RECEPTIONIST = 'Receptionist';
const ROLE_DOCTOR       = 'Doctor';

const DAYS_OF_WEEK        = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const GENDERS             = ['Male', 'Female'];
const APPOINTMENT_STATUSES = ['Scheduled', 'Completed', 'Cancelled', 'No-Show'];

function config(?string $key = null)
{
    static $config = null;
    if ($config === null) {
        $config = require __DIR__ . '/../config.php';
    }
    return $key === null ? $config : ($config[$key] ?? null);
}

date_default_timezone_set(config('timezone') ?: 'UTC');

function db(): PDO
{
    static $pdo = null;
    if ($pdo === null) {
        $c = config('db');
        $dsn = sprintf('mysql:host=%s;port=%d;dbname=%s;charset=%s', $c['host'], $c['port'], $c['name'], $c['charset']);
        try {
            $pdo = new PDO($dsn, $c['user'], $c['pass'], [
                PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
                PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
                PDO::ATTR_EMULATE_PREPARES   => false,
            ]);
        } catch (PDOException $e) {
            throw new HttpError(500, 'Could not connect to the database. Check api/config.local.php.',
                config('debug') ? ['reason' => $e->getMessage()] : []);
        }
    }
    return $pdo;
}

/** Run a prepared query and return the statement. */
function q(string $sql, array $params = []): PDOStatement
{
    $stmt = db()->prepare($sql);
    $stmt->execute($params);
    return $stmt;
}

function json_response($data, int $status = 200): void
{
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

function no_content(): void
{
    http_response_code(204);
    exit;
}

/** Decoded JSON request body (empty array if none). */
function body(): array
{
    static $body = null;
    if ($body === null) {
        $raw = file_get_contents('php://input');
        if ($raw === '' || $raw === false) {
            $body = [];
        } else {
            $body = json_decode($raw, true);
            if (!is_array($body)) {
                throw new HttpError(400, 'Request body must be valid JSON.');
            }
        }
    }
    return $body;
}

function query_param(string $key, $default = null)
{
    $v = $_GET[$key] ?? $default;
    return is_string($v) ? trim($v) : $v;
}

// ------------------------------------------------------------------
// Validation
// ------------------------------------------------------------------

/**
 * Validate input against simple rules and return the cleaned values.
 *
 * Rules per field (pipe separated): required, string, email, int, bool,
 * date, time, max:N, min:N, in:a,b,c, nullable
 *
 * With $partial = true (used for PUT/PATCH) missing fields are skipped
 * instead of failing "required".
 */
function validate(array $input, array $rules, bool $partial = false): array
{
    $errors = [];
    $clean  = [];

    foreach ($rules as $field => $ruleString) {
        $rules_ = explode('|', $ruleString);
        $present = array_key_exists($field, $input);
        $value = $present ? $input[$field] : null;
        if (is_string($value)) {
            $value = trim($value);
        }
        $empty = $value === null || $value === '';

        if (!$present && $partial) {
            continue;
        }
        if ($empty) {
            if (in_array('required', $rules_, true)) {
                $errors[$field] = 'This field is required.';
            } elseif ($present || !$partial) {
                $clean[$field] = null;
            }
            continue;
        }

        foreach ($rules_ as $rule) {
            [$name, $arg] = array_pad(explode(':', $rule, 2), 2, null);
            switch ($name) {
                case 'string':
                    if (!is_string($value)) $errors[$field] = 'Must be text.';
                    break;
                case 'email':
                    if (!filter_var($value, FILTER_VALIDATE_EMAIL)) $errors[$field] = 'Must be a valid email address.';
                    else $value = strtolower($value);
                    break;
                case 'int':
                    if (filter_var($value, FILTER_VALIDATE_INT) === false) $errors[$field] = 'Must be a whole number.';
                    else $value = (int)$value;
                    break;
                case 'bool':
                    $b = filter_var($value, FILTER_VALIDATE_BOOLEAN, FILTER_NULL_ON_FAILURE);
                    if ($b === null) $errors[$field] = 'Must be true or false.';
                    else $value = $b;
                    break;
                case 'date':
                    $d = DateTime::createFromFormat('!Y-m-d', (string)$value);
                    if (!$d || $d->format('Y-m-d') !== $value) $errors[$field] = 'Must be a date (YYYY-MM-DD).';
                    break;
                case 'time':
                    if (!preg_match('/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/', (string)$value)) {
                        $errors[$field] = 'Must be a time (HH:MM).';
                    } elseif (strlen($value) === 5) {
                        $value .= ':00';
                    }
                    break;
                case 'max':
                    if (is_string($value) && mb_strlen($value) > (int)$arg) $errors[$field] = "Must be at most $arg characters.";
                    break;
                case 'min':
                    if (is_string($value) && mb_strlen($value) < (int)$arg) $errors[$field] = "Must be at least $arg characters.";
                    break;
                case 'in':
                    $allowed = explode(',', $arg);
                    // case-insensitive match, normalised to the canonical value
                    $match = null;
                    foreach ($allowed as $a) {
                        if (strcasecmp($a, (string)$value) === 0) { $match = $a; break; }
                    }
                    if ($match === null) $errors[$field] = 'Must be one of: ' . implode(', ', $allowed) . '.';
                    else $value = $match;
                    break;
            }
            if (isset($errors[$field])) break;
        }
        if (!isset($errors[$field])) {
            $clean[$field] = $value;
        }
    }

    if ($errors) {
        throw new HttpError(422, 'Some fields are invalid.', ['errors' => $errors]);
    }
    return $clean;
}

/** Build "a = :a, b = :b" for UPDATE statements. */
function set_clause(array $data): string
{
    return implode(', ', array_map(fn($k) => "`$k` = :$k", array_keys($data)));
}

function require_found($row, string $what = 'Record')
{
    if (!$row) {
        throw new HttpError(404, "$what not found.");
    }
    return $row;
}

// ------------------------------------------------------------------
// Authentication
// ------------------------------------------------------------------

function bearer_token(): ?string
{
    $header = $_SERVER['HTTP_AUTHORIZATION']
        ?? $_SERVER['REDIRECT_HTTP_AUTHORIZATION']
        ?? null;
    if ($header === null && function_exists('getallheaders')) {
        foreach (getallheaders() as $k => $v) {
            if (strcasecmp($k, 'Authorization') === 0) { $header = $v; break; }
        }
    }
    if ($header && preg_match('/^Bearer\s+(\S+)$/i', $header, $m)) {
        return $m[1];
    }
    // Fallback for servers that strip the Authorization header
    return $_SERVER['HTTP_X_AUTH_TOKEN'] ?? null;
}

/** Load roles + doctor_id for a user row. */
function hydrate_user(array $user): array
{
    $roles = q('SELECT r.name FROM roles r JOIN user_roles ur ON ur.role_id = r.id WHERE ur.user_id = ? ORDER BY r.name', [$user['id']])
        ->fetchAll(PDO::FETCH_COLUMN);
    $doctorId = q('SELECT id FROM doctors WHERE user_id = ?', [$user['id']])->fetchColumn();
    return [
        'id'        => (int)$user['id'],
        'name'      => $user['name'],
        'email'     => $user['email'],
        'status'    => (bool)$user['status'],
        'roles'     => $roles,
        'doctor_id' => $doctorId === false ? null : (int)$doctorId,
    ];
}

/** Returns the logged-in user or throws 401. */
function auth(): array
{
    static $user = null;
    if ($user !== null) return $user;

    $token = bearer_token();
    if (!$token) {
        throw new HttpError(401, 'Please log in.');
    }
    $row = q('SELECT u.* FROM api_tokens t JOIN users u ON u.id = t.user_id
              WHERE t.token_hash = ? AND t.expires_at > NOW()', [hash('sha256', $token)])->fetch();
    if (!$row) {
        throw new HttpError(401, 'Your session has expired. Please log in again.');
    }
    if (!$row['status']) {
        throw new HttpError(403, 'This account is disabled.');
    }
    $user = hydrate_user($row);
    return $user;
}

function has_role(string ...$roles): bool
{
    return (bool)array_intersect(auth()['roles'], $roles);
}

/** Throws 403 unless the user has at least one of the roles. */
function require_role(string ...$roles): array
{
    $user = auth();
    if (!has_role(...$roles)) {
        throw new HttpError(403, 'You do not have permission to do this.');
    }
    return $user;
}

/** True if the user is ONLY a doctor (no admin/receptionist role). */
function is_doctor_only(): bool
{
    return has_role(ROLE_DOCTOR) && !has_role(ROLE_ADMIN, ROLE_RECEPTIONIST);
}
