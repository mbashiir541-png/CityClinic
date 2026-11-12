<?php
/**
 * API configuration.
 *
 * Do not put your real password here. Instead create  api/config.local.php
 * (it is git-ignored) that returns only the keys you want to override, e.g.:
 *
 *   <?php return ['db' => ['pass' => 'my-secret', 'port' => 3306]];
 */
$config = [
    'db' => [
        'host'    => '127.0.0.1',
        'port'    => 3307,
        'name'    => 'cityclinic',
        'user'    => 'root',
        'pass'    => '',
        'charset' => 'utf8mb4',
    ],
    // Clinic timezone (used for "today", availability and past-date checks)
    'timezone' => 'Africa/Mogadishu',
    // How long a login token stays valid (hours)
    'token_ttl_hours' => 12,
    // Length of appointment slots offered by /availability (minutes)
    'slot_minutes' => 30,
    // Allowed origins for CORS. '*' is fine for local development.
    'cors_origin' => '*',
    // Show detailed error messages (turn off in production)
    'debug' => true,
];

$local = __DIR__ . '/config.local.php';
if (is_file($local)) {
    $config = array_replace_recursive($config, require $local);
}

// Environment variables win over everything (handy for hosting / testing)
foreach (['host', 'port', 'name', 'user', 'pass'] as $key) {
    $env = getenv('cityclinic' . strtoupper($key));
    if ($env !== false) {
        $config['db'][$key] = $key === 'port' ? (int)$env : $env;
    }
}

return $config;
