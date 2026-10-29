CREATE DATABASE IF NOT EXISTS clinic_db;
USE clinic_db;

-- 1. USERS
CREATE TABLE users (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    email VARCHAR(100) NOT NULL UNIQUE,
    password VARCHAR(255) NOT NULL,
    status BOOLEAN DEFAULT TRUE
);

-- 2. ROLES
CREATE TABLE roles (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(50) NOT NULL UNIQUE
);

-- 3. USER ROLES
CREATE TABLE user_roles (
    user_id INT NOT NULL,
    role_id INT NOT NULL,
    PRIMARY KEY (user_id, role_id),
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (role_id) REFERENCES roles(id)
);

-- 4. PATIENTS
CREATE TABLE patients (
    id INT AUTO_INCREMENT PRIMARY KEY,
    patient_code VARCHAR(30) NOT NULL UNIQUE,
    full_name VARCHAR(100) NOT NULL,
    gender VARCHAR(10),
    dob DATE,
    phone VARCHAR(20),
    address VARCHAR(255)
);

-- 5. DOCTORS
CREATE TABLE doctors (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL UNIQUE,
    specialization VARCHAR(100),
    phone VARCHAR(20),
    status BOOLEAN DEFAULT TRUE,
    FOREIGN KEY (user_id) REFERENCES users(id)
);

-- 6. DOCTOR SCHEDULES
CREATE TABLE doctor_schedules (
    id INT AUTO_INCREMENT PRIMARY KEY,
    doctor_id INT NOT NULL,
    day_of_week VARCHAR(15) NOT NULL,
    start_time TIME NOT NULL,
    end_time TIME NOT NULL,
    FOREIGN KEY (doctor_id) REFERENCES doctors(id),
    CHECK (start_time < end_time)
);

-- 7. APPOINTMENTS
CREATE TABLE appointments (
    id INT AUTO_INCREMENT PRIMARY KEY,
    patient_id INT NOT NULL,
    doctor_id INT NOT NULL,
    appointment_date DATE NOT NULL,
    start_time TIME NOT NULL,
    end_time TIME NOT NULL,
    status VARCHAR(20) DEFAULT 'Scheduled',
    FOREIGN KEY (patient_id) REFERENCES patients(id),
    FOREIGN KEY (doctor_id) REFERENCES doctors(id),
    CHECK (start_time < end_time)
);

-- ========================================
-- SAMPLE DATA
-- ========================================

-- ROLES
INSERT INTO roles (name)
VALUES
('Admin'),
('Receptionist'),
('Doctor');

-- USERS
-- Replace placeholder passwords with Laravel-generated hashes.
INSERT INTO users (name, email, password)
VALUES
('Dr. Ahmed', 'ahmed@clinic.com', 'REPLACE_WITH_HASH'),
('Ali Hassan', 'ali@clinic.com', 'REPLACE_WITH_HASH');

-- USER ROLES
INSERT INTO user_roles (user_id, role_id)
VALUES
(1, 3),
(2, 2);

-- DOCTORS
INSERT INTO doctors (user_id, specialization, phone)
VALUES
(1, 'General Medicine', '0612345678');

-- PATIENTS
INSERT INTO patients
(patient_code, full_name, gender, dob, phone, address)
VALUES
('PAT001', 'Mohamed Ali', 'Male', '1995-05-12', '0611111111', 'Bosaso'),
('PAT002', 'Fatima Hassan', 'Female', '2000-08-20', '0612222222', 'Garowe');

-- DOCTOR SCHEDULES
INSERT INTO doctor_schedules
(doctor_id, day_of_week, start_time, end_time)
VALUES
(1, 'Sunday', '08:00:00', '14:00:00'),
(1, 'Monday', '08:00:00', '14:00:00');

-- APPOINTMENTS
INSERT INTO appointments
(patient_id, doctor_id, appointment_date, start_time, end_time, status)
VALUES
(1, 1, '2026-11-01', '09:00:00', '09:30:00', 'Scheduled'),
(2, 1, '2026-11-01', '10:00:00', '10:30:00', 'Scheduled');

-- ========================================
-- TEST QUERIES
-- ========================================

-- ALL PATIENTS
SELECT * FROM patients;

-- ALL DOCTORS
SELECT * FROM doctors;

-- ALL APPOINTMENTS
SELECT * FROM appointments;

-- APPOINTMENTS WITH PATIENT AND DOCTOR
SELECT
    a.id,
    p.full_name AS patient_name,
    u.name AS doctor_name,
    d.specialization,
    a.appointment_date,
    a.start_time,
    a.end_time,
    a.status
FROM appointments a
JOIN patients p ON a.patient_id = p.id
JOIN doctors d ON a.doctor_id = d.id
JOIN users u ON d.user_id = u.id
ORDER BY a.appointment_date, a.start_time;