-- Handy test queries for clinic_db (moved out of db.sql so setup stays clean)
USE clinic_db;

SELECT * FROM patients;
SELECT * FROM doctors;
SELECT * FROM appointments;

-- Appointments with patient and doctor
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
