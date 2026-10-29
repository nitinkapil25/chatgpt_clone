import { API_BASE_URL } from './backend-config'

async function request(path, options = {}) {
  const normalizedPath = `/${path.replace(/^\/+/, '')}`
  const response = await fetch(`${API_BASE_URL}${normalizedPath}`, {
    ...options,
    credentials: 'include',
    headers: {
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...options.headers,
    },
  })

  const data = await response.json().catch(() => ({}))
  if (!response.ok) {
    const error = new Error(data.message || `Request failed (${response.status})`)
    error.status = response.status
    throw error
  }
  return data
}

export const api = {
  login: (credentials) => request('/auth/login', {
    method: 'POST',
    body: JSON.stringify(credentials),
  }),
  register: (details) => request('/auth/register', {
    method: 'POST',
    body: JSON.stringify(details),
  }),
  logout: () => request('/auth/logout', { method: 'POST' }),
  getChats: () => request('/chat'),
  getChatMessages: (chatId) => request(`/chat/${encodeURIComponent(chatId)}/messages`),
  createChat: (title) => request('/chat', {
    method: 'POST',
    body: JSON.stringify({ title }),
  }),
  renameChat: (chatId, title) => request(`/chat/${encodeURIComponent(chatId)}`, {
    method: 'PATCH',
    body: JSON.stringify({ title }),
  }),
  deleteChat: (chatId) => request(`/chat/${encodeURIComponent(chatId)}`, { method: 'DELETE' }),
}
