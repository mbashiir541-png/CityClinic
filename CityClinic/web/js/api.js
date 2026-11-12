// Thin wrapper around fetch() for the City Clinic REST API.

// The API lives next to the web folder: /api/api.php/...
// Override by setting window.CLINIC_API_URL before this script loads.
const BASE = (window.CLINIC_API_URL || new URL('../api/api.php', location.href).href).replace(/\/$/, '');

const TOKEN_KEY = 'clinic.token';
const USER_KEY = 'clinic.user';

export class ApiError extends Error {
  constructor(status, message, errors = {}) {
    super(message);
    this.status = status;
    this.errors = errors;
  }
}

export const session = {
  get token() { return localStorage.getItem(TOKEN_KEY); },
  get user() {
    try { return JSON.parse(localStorage.getItem(USER_KEY)); } catch { return null; }
  },
  save(token, user) {
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(USER_KEY, JSON.stringify(user));
  },
  setUser(user) { localStorage.setItem(USER_KEY, JSON.stringify(user)); },
  clear() {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
  },
};

let onUnauthorized = () => {};
export function setUnauthorizedHandler(fn) { onUnauthorized = fn; }

export async function request(method, path, data) {
  const headers = { Accept: 'application/json' };
  if (data !== undefined) headers['Content-Type'] = 'application/json';
  if (session.token) {
    headers.Authorization = `Bearer ${session.token}`;
    headers['X-Auth-Token'] = session.token; // fallback if the server strips Authorization
  }

  let res;
  try {
    res = await fetch(BASE + path, {
      method,
      headers,
      body: data !== undefined ? JSON.stringify(data) : undefined,
    });
  } catch {
    throw new ApiError(0, 'Cannot reach the server. Is the API running?');
  }

  if (res.status === 204) return null;
  let json = null;
  try { json = await res.json(); } catch { /* not JSON */ }

  if (!res.ok) {
    if (res.status === 401 && path !== '/auth/login') onUnauthorized();
    throw new ApiError(res.status, json?.error || `Request failed (${res.status})`, json?.errors || {});
  }
  return json;
}

const qs = (params = {}) => {
  const p = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => { if (v !== undefined && v !== null && v !== '') p.set(k, v); });
  const s = p.toString();
  return s ? `?${s}` : '';
};

export const api = {
  login: (email, password) => request('POST', '/auth/login', { email, password }),
  logout: () => request('POST', '/auth/logout'),
  me: () => request('GET', '/auth/me'),
  changePassword: (data) => request('PUT', '/auth/password', data),

  dashboard: (date) => request('GET', `/dashboard${qs({ date })}`),

  patients: (params) => request('GET', `/patients${qs(params)}`),
  patient: (id) => request('GET', `/patients/${id}`),
  createPatient: (d) => request('POST', '/patients', d),
  updatePatient: (id, d) => request('PUT', `/patients/${id}`, d),
  deletePatient: (id) => request('DELETE', `/patients/${id}`),

  doctors: (params) => request('GET', `/doctors${qs(params)}`),
  doctor: (id) => request('GET', `/doctors/${id}`),
  createDoctor: (d) => request('POST', '/doctors', d),
  updateDoctor: (id, d) => request('PUT', `/doctors/${id}`, d),
  deleteDoctor: (id) => request('DELETE', `/doctors/${id}`),
  availability: (id, date, exclude) => request('GET', `/doctors/${id}/availability${qs({ date, exclude })}`),

  addSchedule: (doctorId, d) => request('POST', `/doctors/${doctorId}/schedules`, d),
  updateSchedule: (id, d) => request('PUT', `/schedules/${id}`, d),
  deleteSchedule: (id) => request('DELETE', `/schedules/${id}`),

  appointments: (params) => request('GET', `/appointments${qs(params)}`),
  appointment: (id) => request('GET', `/appointments/${id}`),
  createAppointment: (d) => request('POST', '/appointments', d),
  updateAppointment: (id, d) => request('PUT', `/appointments/${id}`, d),
  setAppointmentStatus: (id, status) => request('PATCH', `/appointments/${id}/status`, { status }),
  deleteAppointment: (id) => request('DELETE', `/appointments/${id}`),

  users: () => request('GET', '/users'),
  roles: () => request('GET', '/roles'),
  createUser: (d) => request('POST', '/users', d),
  updateUser: (id, d) => request('PUT', `/users/${id}`, d),
  disableUser: (id) => request('DELETE', `/users/${id}`),
};
