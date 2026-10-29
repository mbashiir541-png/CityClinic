
@startuml
title Clinic Management System - Class Diagram

class User {
  +id: int
  +name: string
  +email: string
  +password: string
  +status: boolean
}

class Role {
  +id: int
  +name: string
}

class Patient {
  +id: int
  +patient_code: string
  +full_name: string
  +gender: string
  +dob: date
  +phone: string
  +address: string
}

class Doctor {
  +id: int
  +user_id: int
  +specialization: string
  +phone: string
  +status: boolean
}

class DoctorSchedule {
  +id: int
  +doctor_id: int
  +day_of_week: string
  +start_time: time
  +end_time: time
}

class Appointment {
  +id: int
  +patient_id: int
  +doctor_id: int
  +appointment_date: date
  +start_time: time
  +end_time: time
  +status: string
}

class UserRole {
  +user_id: int
  +role_id: int
}

User "1" -- "0..1" Doctor
User "1" -- "0..*" UserRole
Role "1" -- "0..*" UserRole

Patient "1" -- "0..*" Appointment
Doctor "1" -- "0..*" Appointment
Doctor "1" -- "0..*" DoctorSchedule

@enduml
