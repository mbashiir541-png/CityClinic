-- ============================================================
-- City Clinic - Clinic Management System
-- MySQL 8+ schema + sample data
--
-- This script is SAFE TO RE-RUN:
--   * tables use CREATE TABLE IF NOT EXISTS
--   * sample rows are only inserted when missing
--   * it never drops tables or deletes your data
-- ============================================================

CREATE DATABASE IF NOT EXISTS cityclinic
    CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE cityclinic;

-- 1. USERS
CREATE TABLE IF NOT EXISTS users (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    email VARCHAR(100) NOT NULL UNIQUE,
    password VARCHAR(255) NOT NULL,
    status BOOLEAN DEFAULT TRUE
);

-- 2. ROLES
CREATE TABLE IF NOT EXISTS roles (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(50) NOT NULL UNIQUE
);

-- 3. USER ROLES
CREATE TABLE IF NOT EXISTS user_roles (
    user_id INT NOT NULL,
    role_id INT NOT NULL,
    PRIMARY KEY (user_id, role_id),
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (role_id) REFERENCES roles(id)
);

-- 4. PATIENTS
CREATE TABLE IF NOT EXISTS patients (
    id INT AUTO_INCREMENT PRIMARY KEY,
    patient_code VARCHAR(30) NOT NULL UNIQUE,
    full_name VARCHAR(100) NOT NULL,
    gender VARCHAR(10),
    dob DATE,
    phone VARCHAR(20),
    address VARCHAR(255),
    CHECK (gender IS NULL OR gender IN ('Male', 'Female'))
);

-- 5. DOCTORS
CREATE TABLE IF NOT EXISTS doctors (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL UNIQUE,
    specialization VARCHAR(100),
    phone VARCHAR(20),
    status BOOLEAN DEFAULT TRUE,
    FOREIGN KEY (user_id) REFERENCES users(id)
);

-- 6. DOCTOR SCHEDULES
CREATE TABLE IF NOT EXISTS doctor_schedules (
    id INT AUTO_INCREMENT PRIMARY KEY,
    doctor_id INT NOT NULL,
    day_of_week VARCHAR(15) NOT NULL,
    start_time TIME NOT NULL,
    end_time TIME NOT NULL,
    FOREIGN KEY (doctor_id) REFERENCES doctors(id),
    CHECK (start_time < end_time),
    CHECK (day_of_week IN ('Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'))
);

-- 7. APPOINTMENTS
CREATE TABLE IF NOT EXISTS appointments (
    id INT AUTO_INCREMENT PRIMARY KEY,
    patient_id INT NOT NULL,
    doctor_id INT NOT NULL,
    appointment_date DATE NOT NULL,
    start_time TIME NOT NULL,
    end_time TIME NOT NULL,
    status VARCHAR(20) DEFAULT 'Scheduled',
    FOREIGN KEY (patient_id) REFERENCES patients(id),
    FOREIGN KEY (doctor_id) REFERENCES doctors(id),
    INDEX idx_appointments_doctor_date (doctor_id, appointment_date),
    CHECK (start_time < end_time),
    CHECK (status IN ('Scheduled', 'Completed', 'Cancelled', 'No-Show'))
);

-- 8. API TOKENS (login sessions for the REST API)
--    Only a SHA-256 hash of each token is stored, never the token itself.
CREATE TABLE IF NOT EXISTS api_tokens (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    token_hash CHAR(64) NOT NULL UNIQUE,
    expires_at DATETIME NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- ============================================================
-- SAMPLE DATA (inserted only if missing)
--
-- Login accounts:
--   admin@clinic.com  / Admin@123      (Admin)
--   ahmed@clinic.com  / Doctor@123     (Doctor)
--   ali@clinic.com    / Reception@123  (Receptionist)
--   CHANGE THESE PASSWORDS after your first login.
-- ============================================================

-- ROLES
INSERT IGNORE INTO roles (name) VALUES
('Admin'),
('Receptionist'),
('Doctor');

-- USERS (bcrypt hashes generated with PHP password_hash)
INSERT IGNORE INTO users (name, email, password) VALUES
('System Admin', 'admin@clinic.com', '$2y$10$UY7XvUV/QOnZXL7mDC8A3uMBUKhPdffpxhWo1ExSV/60na1RGI.qS'),
('Dr. Ahmed',    'ahmed@clinic.com', '$2y$10$d.pg7J0QYf8lUTpLjBFylOPh/XTZXUYLTByfUFMtPu/uP0br7FNO2'),
('Ali Hassan',   'ali@clinic.com',   '$2y$10$JsImLul0tX8pBS0UISy3SOf5Zdxhl6qeKGE5dkQLZK7N/GHwIRvj6');

-- Fix databases created with the old script that stored 'REPLACE_WITH_HASH'
UPDATE users SET password = '$2y$10$d.pg7J0QYf8lUTpLjBFylOPh/XTZXUYLTByfUFMtPu/uP0br7FNO2'
    WHERE email = 'ahmed@clinic.com' AND password = 'REPLACE_WITH_HASH';
UPDATE users SET password = '$2y$10$JsImLul0tX8pBS0UISy3SOf5Zdxhl6qeKGE5dkQLZK7N/GHwIRvj6'
    WHERE email = 'ali@clinic.com' AND password = 'REPLACE_WITH_HASH';

-- USER ROLES (looked up by email/name so IDs never matter)
INSERT IGNORE INTO user_roles (user_id, role_id)
SELECT u.id, r.id FROM users u JOIN roles r
WHERE (u.email = 'admin@clinic.com' AND r.name = 'Admin')
   OR (u.email = 'ahmed@clinic.com' AND r.name = 'Doctor')
   OR (u.email = 'ali@clinic.com'   AND r.name = 'Receptionist');

-- DOCTORS
INSERT IGNORE INTO doctors (user_id, specialization, phone)
SELECT id, 'General Medicine', '0612345678' FROM users WHERE email = 'ahmed@clinic.com';

-- PATIENTS
INSERT IGNORE INTO patients (patient_code, full_name, gender, dob, phone, address) VALUES
('PAT001', 'Mohamed Ali',   'Male',   '1995-05-12', '0611111111', 'Bosaso'),
('PAT002', 'Fatima Hassan', 'Female', '2000-08-20', '0612222222', 'Garowe');

-- DOCTOR SCHEDULES
INSERT INTO doctor_schedules (doctor_id, day_of_week, start_time, end_time)
SELECT d.id, s.day_of_week, s.start_time, s.end_time
FROM doctors d
JOIN users u ON u.id = d.user_id AND u.email = 'ahmed@clinic.com'
JOIN (
    SELECT 'Sunday' AS day_of_week, '08:00:00' AS start_time, '14:00:00' AS end_time
    UNION ALL SELECT 'Monday', '08:00:00', '14:00:00'
) s
WHERE NOT EXISTS (
    SELECT 1 FROM doctor_schedules x
    WHERE x.doctor_id = d.id AND x.day_of_week = s.day_of_week
);

-- APPOINTMENTS (2026-11-01 is a Sunday, inside Dr. Ahmed's schedule)
INSERT INTO appointments (patient_id, doctor_id, appointment_date, start_time, end_time, status)
SELECT p.id, d.id, a.appointment_date, a.start_time, a.end_time, 'Scheduled'
FROM (
    SELECT 'PAT001' AS code, '2026-11-01' AS appointment_date, '09:00:00' AS start_time, '09:30:00' AS end_time
    UNION ALL SELECT 'PAT002', '2026-11-01', '10:00:00', '10:30:00'
) a
JOIN patients p ON p.patient_code = a.code
JOIN doctors d
JOIN users u ON u.id = d.user_id AND u.email = 'ahmed@clinic.com'
WHERE NOT EXISTS (
    SELECT 1 FROM appointments x
    WHERE x.doctor_id = d.id AND x.appointment_date = a.appointment_date AND x.start_time = a.start_time
);
