import Constants from 'expo-constants';

/**
 * Varsayılan API adresi: EXPO_PUBLIC_API_URL ayarlıysa o; değilse Expo geliştirme
 * sunucusunun çalıştığı bilgisayarın IP'si (telefon aynı Wi-Fi'deyken API de oradadır).
 */
export function defaultApiUrl() {
  if (process.env.EXPO_PUBLIC_API_URL) return process.env.EXPO_PUBLIC_API_URL;
  const host = Constants.expoConfig?.hostUri?.split(':')[0];
  return `http://${host || 'localhost'}:3000`;
}

/** Sunucu hatası; `status` (401, 402...) ve `code` ('auth', 'expired', 'password') taşır. */
export class ApiError extends Error {
  constructor(message, status, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function createApi(baseUrl, token) {
  async function request(path, { method = 'GET', body } = {}) {
    const headers = { 'content-type': 'application/json' };
    if (token) headers.authorization = `Bearer ${token}`;
    let res;
    try {
      res = await fetch(`${baseUrl.replace(/\/$/, '')}${path}`, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch {
      throw new ApiError(`Sunucuya ulaşılamadı: ${baseUrl}`, 0);
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new ApiError(data.error || `Sunucu hatası (${res.status})`, res.status, data.code);
    return data;
  }

  return {
    // Oturum
    login: (phone, password) => request('/api/auth/login', { method: 'POST', body: { phone, password } }),
    requestEmailCode: (email) => request('/api/auth/email-code', { method: 'POST', body: { email } }),
    emailLogin: (email, code) => request('/api/auth/email-login', { method: 'POST', body: { email, code } }),
    me: () => request('/api/auth/me'),
    logout: () => request('/api/auth/logout', { method: 'POST' }),
    changePassword: (newPassword) => request('/api/auth/password', { method: 'POST', body: { newPassword } }),

    // Navigasyon
    closures: () => request('/api/closures'),
    route: ({ from, to, via, costing, heading, alternatives, avoidTolls }) =>
      request('/api/route', { method: 'POST', body: { from, to, via, costing, heading, alternatives, avoidTolls } }),
    search: (q) => request(`/api/search?q=${encodeURIComponent(q)}`),

    // Yol kapatma ve gruplar (sahip + yönetici)
    toggleClosure: ({ lat, lon }) => request('/api/closures/toggle', { method: 'POST', body: { lat, lon } }),
    saveZone: (name) => request('/api/zones', { method: 'POST', body: { name } }),
    setZoneActive: (id, active) => request(`/api/zones/${id}`, { method: 'PATCH', body: { active } }),
    deleteZone: (id) => request(`/api/zones/${id}`, { method: 'DELETE' }),
    openAll: () => request('/api/closures/open-all', { method: 'POST' }),
    toggleZoneSegment: (id, { lat, lon }) => request(`/api/zones/${id}/toggle-segment`, { method: 'POST', body: { lat, lon } }),
    renameZone: (id, name) => request(`/api/zones/${id}`, { method: 'PATCH', body: { name } }),

    // Üyeler, yöneticiler ve ödeme bilgisi (yalnızca sahip)
    users: (role) => request(`/api/users?role=${role}`),
    createUser: ({ name, email, phone, role }) => request('/api/users', { method: 'POST', body: { name, email, phone, role } }),
    extendUser: (id, days) => request(`/api/users/${id}/extend`, { method: 'POST', body: { days } }),
    expireUser: (id) => request(`/api/users/${id}/expire`, { method: 'POST' }),
    resetPassword: (id) => request(`/api/users/${id}/reset-password`, { method: 'POST' }),
    deleteUser: (id) => request(`/api/users/${id}`, { method: 'DELETE' }),
    updateSettings: (patch) => request('/api/settings', { method: 'PUT', body: patch }),
  };
}
