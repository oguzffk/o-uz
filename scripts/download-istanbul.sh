#!/usr/bin/env bash
# OpenStreetMap'ten yalnızca İstanbul'un yol ağını çıkarır ve Valhalla'nın
# okuyacağı klasöre koyar: valhalla/custom_files/istanbul.osm.pbf
#
# 1) Geofabrik'ten Türkiye özütünü indirir (~600 MB, yarıda kalırsa kaldığı yerden devam eder)
# 2) İstanbul il sınırını kapsayan kutuyu keser
# 3) Sadece yolları (highway=*), feribot hatlarını ve dönüş yasaklarını bırakır
#
# osmium yüklü değilse Docker içinde çalıştırılır (tools/osmium/Dockerfile).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORK="$ROOT/data/osm"
OUT_DIR="$ROOT/valhalla/custom_files"
SOURCE_URL="${SOURCE_URL:-https://download.geofabrik.de/europe/turkey-latest.osm.pbf}"
# minLon,minLat,maxLon,maxLat — server/src/app.js içindeki ISTANBUL_BBOX ile aynı
BBOX="${BBOX:-27.95,40.78,29.95,41.60}"

mkdir -p "$WORK" "$OUT_DIR"

echo "==> Türkiye verisi indiriliyor: $SOURCE_URL"
curl -fL --retry 3 -C - -o "$WORK/turkey-latest.osm.pbf" "$SOURCE_URL"

if command -v osmium >/dev/null 2>&1; then
  osm() { osmium "$@"; }
  IN="$WORK"; OUT="$OUT_DIR"
else
  echo "==> osmium bulunamadı, Docker imajı hazırlanıyor (bir kerelik)"
  docker build -q -t istanbul-nav-osmium "$ROOT/tools/osmium" >/dev/null
  osm() { docker run --rm -v "$WORK:/work" -v "$OUT_DIR:/out" istanbul-nav-osmium "$@"; }
  IN="/work"; OUT="/out"
fi

echo "==> İstanbul kutusu kesiliyor ($BBOX)"
osm extract --bbox "$BBOX" --strategy complete_ways --overwrite \
  -o "$IN/istanbul-all.osm.pbf" "$IN/turkey-latest.osm.pbf"

echo "==> Yalnızca yol ağı bırakılıyor"
osm tags-filter --overwrite -o "$OUT/istanbul.osm.pbf" "$IN/istanbul-all.osm.pbf" \
  w/highway w/route=ferry r/type=restriction r/restriction

osm fileinfo -e -g data.count.ways "$OUT/istanbul.osm.pbf" | xargs -I{} echo "==> Tamam: {} yol parçası"
ls -lh "$OUT_DIR/istanbul.osm.pbf"
echo
echo "Sonraki adım: docker compose up   (ilk açılışta Valhalla rota grafiğini kurar, birkaç dakika sürer)"
