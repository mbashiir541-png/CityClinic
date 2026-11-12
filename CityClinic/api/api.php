<?php
/**
 * City Clinic REST API - single entry point / router.
 *
 * URLs look like:  /api/api.php/patients/5
 * (or /api/patients/5 when Apache mod_rewrite is enabled, see .htaccess)
 *
 * Every response is JSON. Errors look like:
 *   { "error": "message", "errors": { "field": "problem" } }
 */

declare(strict_types=1);

require __DIR__ . '/src/bootstrap.php';

// ---------------- CORS ----------------
header('Access-Control-Allow-Origin: ' . config('cors_origin'));
header('Access-Control-Allow-Headers: Content-Type, Authorization, X-Auth-Token');
header('Access-Control-Allow-Methods: GET, POST, PUT, PATCH, DELETE, OPTIONS');
if (($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'OPTIONS') {
    no_content();
}

// ---------------- Routing ----------------
$routes = [];

/** Register a route. Path params use {name}, e.g. /patients/{id}. */
function route(string $method, string $pattern, callable $handler): void
{
    global $routes;
    $regex = '#^' . preg_replace('#\{(\w+)\}#', '(?P<$1>\d+)', $pattern) . '$#';
    $routes[] = [$method, $regex, $handler];
}

foreach (glob(__DIR__ . '/src/routes/*.php') as $file) {
    require $file;
}

function current_path(): string
{
    if (!empty($_SERVER['PATH_INFO'])) {
        $path = $_SERVER['PATH_INFO'];
    } elseif (isset($_GET['route'])) {
        $path = '/' . ltrim((string)$_GET['route'], '/');
    } else {
        // Rewritten URL: strip the directory this script lives in
        $uri  = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?: '/';
        $base = rtrim(str_replace('\\', '/', dirname($_SERVER['SCRIPT_NAME'] ?? '')), '/');
        $path = ($base !== '' && strpos($uri, $base) === 0) ? substr($uri, strlen($base)) : $uri;
        $path = preg_replace('#^/api\.php#', '', $path);
    }
    $path = '/' . trim($path, '/');
    return $path;
}

try {
    $method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
    $path   = current_path();

    $pathMatched = false;
    foreach ($routes as [$m, $regex, $handler]) {
        if (!preg_match($regex, $path, $matches)) continue;
        $pathMatched = true;
        if ($m !== $method) continue;
        $params = array_map('intval', array_filter($matches, 'is_string', ARRAY_FILTER_USE_KEY));
        $handler($params);
        // handlers normally exit via json_response(); fall back to 204
        no_content();
    }

    if ($pathMatched) {
        throw new HttpError(405, "Method $method is not allowed here.");
    }
    throw new HttpError(404, "No endpoint at $method $path.");

} catch (HttpError $e) {
    json_response(['error' => $e->getMessage()] + $e->details, $e->getCode());
} catch (PDOException $e) {
    if (db()->inTransaction()) db()->rollBack();
    // 23000 = integrity constraint (duplicate key / foreign key in use)
    if ($e->getCode() === '23000') {
        $msg = str_contains($e->getMessage(), 'Duplicate')
            ? 'A record with this value already exists.'
            : 'This record is linked to other records and cannot be changed or deleted.';
        json_response(['error' => $msg] + (config('debug') ? ['reason' => $e->getMessage()] : []), 409);
    }
    json_response(['error' => 'Database error.'] + (config('debug') ? ['reason' => $e->getMessage()] : []), 500);
} catch (Throwable $e) {
    json_response(['error' => 'Server error.'] + (config('debug') ? ['reason' => $e->getMessage()] : []), 500);
}
