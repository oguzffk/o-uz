import { decodePolyline } from './geo.js';

export class ValhallaError extends Error {
  constructor(message, status = 502, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

export function createValhallaClient(baseUrl) {
  async function call(action, body) {
    let res;
    try {
      res = await fetch(`${baseUrl}/${action}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
    } catch (err) {
      throw new ValhallaError(`Valhalla'ya ulaşılamadı (${baseUrl}): ${err.message}`, 503);
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      // Valhalla hata gövdesi: { error_code, error, status_code, status }
      const status = res.status === 400 ? 400 : 502;
      throw new ValhallaError(data.error || `Valhalla ${action} hatası (${res.status})`, status, data);
    }
    return data;
  }

  return {
    status: () => fetch(`${baseUrl}/status`).then((r) => r.json()),

    /**
     * Noktaya en yakın araç yolu kenarını bulur. Valhalla her iki yönü ayrı
     * kenar olarak döndürür ama geometrileri (edge_info.shape) aynıdır.
     */
    async locateEdge({ lat, lon }, costing = 'auto') {
      const [result] = await call('locate', {
        locations: [{ lat, lon }],
        costing,
        verbose: true,
      });
      const edge = result?.edges?.[0];
      if (!edge?.edge_info?.shape) return null;
      return {
        shapeEncoded: edge.edge_info.shape,
        coordinates: decodePolyline(edge.edge_info.shape),
        wayId: edge.edge_info.way_id,
        names: edge.edge_info.names ?? [],
        // Valhalla'nın "distance" alanı: girilen noktanın yola uzaklığı (metre)
        distanceMeters: edge.distance ?? 0,
        snapped: [edge.correlated_lat, edge.correlated_lon],
      };
    },

    route: (body) => call('route', body),
  };
}
