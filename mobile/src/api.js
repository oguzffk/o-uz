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

export function createApi(baseUrl, adminToken) {
  async function request(path, { method = 'GET', body, admin = false } = {}) {
    const headers = { 'content-type': 'application/json' };
    if (admin) headers['x-admin-token'] = adminToken;
    let res;
    try {
      res = await fetch(`${baseUrl.replace(/\/$/, '')}${path}`, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch {
      throw new Error(`Sunucuya ulaşılamadı: ${baseUrl}`);
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Sunucu hatası (${res.status})`);
    return data;
  }

  return {
    closures: () => request('/api/closures'),
    route: ({ from, to, costing, heading }) => request('/api/route', { method: 'POST', body: { from, to, costing, heading } }),
    search: (q) => request(`/api/search?q=${encodeURIComponent(q)}`),
    checkAdmin: () => request('/api/admin/check', { method: 'POST', admin: true }),
    toggleClosure: ({ lat, lon }) => request('/api/closures/toggle', { method: 'POST', body: { lat, lon }, admin: true }),
    saveZone: (name) => request('/api/zones', { method: 'POST', body: { name }, admin: true }),
    setZoneActive: (id, active) => request(`/api/zones/${id}`, { method: 'PATCH', body: { active }, admin: true }),
    deleteZone: (id) => request(`/api/zones/${id}`, { method: 'DELETE', admin: true }),
    openAll: () => request('/api/closures/open-all', { method: 'POST', admin: true }),
  };
}
