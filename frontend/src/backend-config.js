const configuredBackendUrl = import.meta.env.VITE_API_BASE_URL || 'https://chatgpt-clone-zqlu.onrender.com'

// Accept either the backend origin or an origin already ending in /api.
export const BACKEND_URL = configuredBackendUrl.replace(/\/+$/, '').replace(/\/api$/i, '')
export const API_BASE_URL = `${BACKEND_URL}/api`
