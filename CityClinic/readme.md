# City Clinic — Clinic Management System

A responsive web app plus a REST API (PHP + MySQL) for managing patients, doctors, doctor schedules, appointments and staff accounts.

```
CityClinic/
├── api/                    REST API (plain PHP 8 + PDO, no framework)
│   ├── api.php             entry point / router
│   ├── config.php          settings (put secrets in config.local.php)
│   ├── .htaccess           Authorization header fix + pretty URLs for Apache
│   └── src/
│       ├── bootstrap.php   DB, JSON, validation, auth helpers
│       └── routes/         auth, dashboard, patients, doctors, appointments, users
├── web/                    responsive front end (HTML/CSS/vanilla JS, no build step)
│   ├── index.html
│   ├── css/styles.css
│   └── js/                 api client, UI helpers, one file per page
├── database/
│   ├── db.sql              schema + sample data (safe to re-run)
│   └── queries.sql         handy test queries
├── docs/
│   ├── plainuml.md         UML class diagram (PlantUML)
│   └── diagram-prompt.md   original diagram brief
└── index.html              redirects to web/
```

## Setup

### 1. Database
Run the script in MySQL Workbench or from the command line:

```bash
mysql -u root -p < database/db.sql
```

It is **safe to run on your existing `clinic_db`**. It never drops anything; it only creates missing tables (including the new `api_tokens` table), replaces the old `REPLACE_WITH_HASH` placeholder passwords with real ones, and inserts sample rows that are missing.

### 2. Database password
Create `api/config.local.php` (it is git-ignored):

```php
<?php
return ['db' => [
    'user' => 'root',
    'pass' => 'YOUR_MYSQL_PASSWORD',
    'port' => 3306,          // use 3307 if clinic_db lives on your other MySQL server
]];
```

You can also use environment variables instead: `CLINIC_DB_HOST`, `CLINIC_DB_PORT`, `CLINIC_DB_NAME`, `CLINIC_DB_USER`, `CLINIC_DB_PASS`.

### 3. Run it
**Option A — PHP built-in server** (simplest):
```bash
cd CityClinic
php -S localhost:8000
```
Open http://localhost:8000

**Option B — XAMPP Apache:** copy (or symlink) the `CityClinic` folder into `C:\xampp\htdocs\`, start Apache and open http://localhost/CityClinic/

### 4. Sign in
| Role | Email | Password |
|---|---|---|
| Admin | admin@clinic.com | Admin@123 |
| Receptionist | ali@clinic.com | Reception@123 |
| Doctor | ahmed@clinic.com | Doctor@123 |

**Change these passwords** using "Change password" in the sidebar.

## Roles

| | Admin | Receptionist | Doctor |
|---|:-:|:-:|:-:|
| View dashboard, patients, doctors | ✓ | ✓ | ✓ |
| Add / edit patients | ✓ | ✓ | |
| Delete patients (only if no appointments) | ✓ | | |
| Book / reschedule / cancel appointments | ✓ | ✓ | |
| Mark appointment Completed / No-Show | ✓ | ✓ | own only |
| See appointments | all | all | own only |
| Manage doctors & schedules | ✓ | | |
| Manage staff accounts | ✓ | | |

## Booking rules (enforced by the API)
- The doctor must be active and **working at that time** (inside a schedule block for that weekday).
- **No double-booking**: an appointment cannot overlap another non-cancelled appointment of the same doctor **or** the same patient. Back-to-back is fine.
- No booking in the past; end time must be after start time.
- Cancelling frees the slot. Re-opening a cancelled appointment re-checks the rules.
- Bookings run inside a transaction that locks the doctor, so two receptionists cannot take the same slot at the same moment.

## REST API

Base URL: `/api/api.php` (with Apache mod_rewrite, `/api/...` also works).
Send `Authorization: Bearer <token>` (from `/auth/login`) on every request except login.
All bodies and responses are JSON. Errors look like `{"error": "...", "errors": {"field": "message"}}` with status 401/403/404/409/422.

| Method | Path | Notes |
|---|---|---|
| POST | `/auth/login` | `{email, password}` → `{token, expires_at, user}` |
| POST | `/auth/logout` | |
| GET | `/auth/me` | current user + roles |
| PUT | `/auth/password` | `{current_password, new_password}` |
| GET | `/dashboard?date=` | totals, status breakdown, the day's appointments |
| GET | `/patients?q=&page=&per_page=` | search by name / code / phone |
| POST | `/patients` | `patient_code` is generated if left out (PAT003…) |
| GET / PUT / DELETE | `/patients/{id}` | GET includes appointment history |
| GET | `/doctors?active=1` | |
| POST | `/doctors` | `{name, email, password, specialization, phone}`, creates login + profile |
| GET / PUT / DELETE | `/doctors/{id}` | GET includes weekly schedule |
| GET / POST | `/doctors/{id}/schedules` | `{day_of_week, start_time, end_time}` |
| PUT / DELETE | `/schedules/{id}` | |
| GET | `/doctors/{id}/availability?date=` | 30-min slots marked free/booked |
| GET | `/appointments?date=&from=&to=&doctor_id=&patient_id=&status=&q=` | |
| POST | `/appointments` | `{patient_id, doctor_id, appointment_date, start_time, end_time}` |
| GET / PUT / DELETE | `/appointments/{id}` | |
| PATCH | `/appointments/{id}/status` | `{status}`: Scheduled, Completed, Cancelled, No-Show |
| GET | `/roles` | |
| GET / POST | `/users` | `{name, email, password, roles: [...]}` |
| GET / PUT / DELETE | `/users/{id}` | DELETE disables the account |

### Postman
Import [docs/postman/CityClinic.postman_collection.json](docs/postman/CityClinic.postman_collection.json) into Postman (**Import → File**).
Run **1. Auth → Login as Admin** first; the token is saved automatically and used by every other request.
You can also run the whole collection with the Collection Runner. It creates its own test records and deletes them again at the end.

Example:
```bash
curl -X POST http://localhost:8000/api/api.php/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@clinic.com","password":"Admin@123"}'
```

## Going to production
- Set `'debug' => false` and a real `'cors_origin'` in `config.local.php`.
- Use a MySQL user with access only to `clinic_db` instead of `root`.
- Serve over HTTPS.
