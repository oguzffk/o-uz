import { StyleSheet, View } from 'react-native';
import Svg, { Circle, Path, Polygon } from 'react-native-svg';

// Yön bandındaki dönüş oku ve şerit okları. 24×24 çizim alanında, ok aşağıdan (araçtan)
// başlar, yukarı çıkar ve dönüş açısına kıvrılır.

const W = 2.6; // çizgi kalınlığı

// Okun ucu: `x, y` noktasında, `deg` yönüne bakan üçgen (0 = yukarı, 90 = sağ).
function head(x, y, deg, s = 4.2) {
  const r = (deg * Math.PI) / 180;
  const fx = Math.sin(r), fy = -Math.cos(r); // ileri
  const px = Math.cos(r), py = Math.sin(r); // sağ
  const tip = [x + fx * s * 0.9, y + fy * s * 0.9];
  const l = [x - px * s * 0.85, y - py * s * 0.85];
  const rr = [x + px * s * 0.85, y + py * s * 0.85];
  return [tip, l, rr].map((p) => p.map((v) => v.toFixed(2)).join(',')).join(' ');
}

// Açıya göre dönüş oku: 0 düz, ±45 hafif, ±90 dön, ±135 keskin.
function TurnPath({ deg, color, offsetX = 0 }) {
  const x0 = 12 + offsetX;
  if (deg === 0) {
    return (
      <>
        <Path d={`M${x0} 22 V7`} stroke={color} strokeWidth={W} strokeLinecap="round" fill="none" />
        <Polygon points={head(x0, 6, 0)} fill={color} />
      </>
    );
  }
  const r = (deg * Math.PI) / 180;
  const len = Math.abs(deg) > 100 ? 6 : 7.5;
  const bx = x0, by = Math.abs(deg) > 100 ? 10 : 12; // kırılma noktası
  const ex = bx + Math.sin(r) * len, ey = by - Math.cos(r) * len;
  return (
    <>
      <Path
        d={`M${x0} 22 V${by + 2} Q${bx} ${by} ${(bx + Math.sin(r) * 2).toFixed(2)} ${(by - Math.cos(r) * 2).toFixed(2)} L${ex.toFixed(2)} ${ey.toFixed(2)}`}
        stroke={color}
        strokeWidth={W}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
      <Polygon points={head(ex, ey, deg)} fill={color} />
    </>
  );
}

function UTurn({ left, color }) {
  // Sola U dönüşü: sağdan çıkıp üstte kıvrılır, solda aşağı iner.
  const d = left ? 'M15 22 V11 A4 4 0 0 0 7 11 V15' : 'M9 22 V11 A4 4 0 0 1 17 11 V15';
  return (
    <>
      <Path d={d} stroke={color} strokeWidth={W} strokeLinecap="round" fill="none" />
      <Polygon points={head(left ? 7 : 17, 16, 180)} fill={color} />
    </>
  );
}

const MANEUVER_DEG = {
  1: 0, 2: 0, 3: 0, 7: 0, 8: 0, 17: 0, 22: 0, 25: 0,
  9: 45, 10: 90, 11: 135, 16: -45, 15: -90, 14: -135,
  18: 45, 20: 45, 23: 30, 37: 30, 19: -45, 21: -45, 24: -30, 38: -30,
};

/** Valhalla manevra türüne göre büyük dönüş oku (yön bandında). */
export function ManeuverIcon({ type, size = 40, color = '#fff' }) {
  let body;
  if (type === 4 || type === 5 || type === 6) {
    // Varış: hedef işareti
    body = (
      <>
        <Path d="M12 22 C12 22 5 14.5 5 10 A7 7 0 0 1 19 10 C19 14.5 12 22 12 22 Z" fill={color} />
        <Circle cx={12} cy={10} r={2.8} fill="#0b5c3b" />
      </>
    );
  } else if (type === 12 || type === 13) {
    // Türkiye'de sağdan trafik: U dönüşü sola doğru çizilir.
    body = <UTurn left color={color} />;
  } else if (type === 26 || type === 27) {
    body = (
      <>
        <Circle cx={12} cy={11} r={4.5} stroke={color} strokeWidth={W} fill="none" />
        <Path d="M12 22 V15.5" stroke={color} strokeWidth={W} strokeLinecap="round" />
        <Path d="M15.2 7.8 L19 4" stroke={color} strokeWidth={W} strokeLinecap="round" />
        <Polygon points={head(19.6, 3.4, 45, 3.6)} fill={color} />
      </>
    );
  } else {
    const deg = MANEUVER_DEG[type] ?? 0;
    // Büyük okta gövde, dönüş tarafının tersine kaydırılır ki ok kutuda ortalansın.
    body = <TurnPath deg={deg} color={color} offsetX={-Math.sin((deg * Math.PI) / 180) * 3.5} />;
  }
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      {body}
    </Svg>
  );
}

// OSRM şerit yönleri → açı.
const LANE_DEG = {
  straight: 0,
  'slight right': 45,
  right: 90,
  'sharp right': 135,
  'slight left': -45,
  left: -90,
  'sharp left': -135,
};

/** Tek şerit: üzerindeki bütün yönler çizilir; gidilecek yön (use) öne çıkar. */
function LaneIcon({ lane, size }) {
  const dirs = lane.dirs.length ? lane.dirs : ['straight'];
  const on = lane.ok;
  const color = on ? '#fff' : 'rgba(255,255,255,0.35)';
  const dim = 'rgba(255,255,255,0.35)';
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      {dirs.map((d) => {
        const c = on && lane.use && d !== lane.use ? dim : color;
        if (d === 'uturn') return <UTurn key={d} left color={c} />;
        return <TurnPath key={d} deg={LANE_DEG[d] ?? 0} color={c} />;
      })}
    </Svg>
  );
}

/** Şerit şeridi: soldan sağa şeritler; girilmesi gereken şeritler beyaz, diğerleri soluk. */
export function LaneStrip({ lanes, size = 30 }) {
  return (
    <View style={styles.lanes} accessibilityLabel={`Şerit: ${lanes.map((l) => (l.ok ? 'gir' : '-')).join(' ')}`}>
      {lanes.map((lane, i) => (
        <View key={i} style={[styles.lane, i > 0 && styles.laneDivider, lane.ok && styles.laneOn]}>
          <LaneIcon lane={lane} size={size} />
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  lanes: {
    flexDirection: 'row',
    alignSelf: 'center',
    backgroundColor: '#084a30',
    borderRadius: 10,
    paddingHorizontal: 4,
    paddingVertical: 3,
    marginTop: 8,
  },
  lane: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 7 },
  laneOn: { backgroundColor: 'rgba(255,255,255,0.12)' },
  laneDivider: { borderLeftWidth: 1, borderLeftColor: 'rgba(255,255,255,0.25)', borderStyle: 'dashed' },
});
