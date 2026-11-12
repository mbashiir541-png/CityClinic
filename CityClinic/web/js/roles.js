// Role helpers based on the logged-in user saved in the session.
import { session } from './api.js';

export const currentUser = () => session.user;
export const hasRole = (...roles) => (session.user?.roles || []).some((r) => roles.includes(r));
export const canManage = () => hasRole('Admin', 'Receptionist');
export const isAdmin = () => hasRole('Admin');
export const isDoctorOnly = () => hasRole('Doctor') && !canManage();
