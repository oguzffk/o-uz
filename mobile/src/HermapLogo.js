import { StyleSheet, Text, View } from 'react-native';
import Svg, { ClipPath, Defs, G, Polygon, Rect } from 'react-native-svg';

/**
 * HERMAP yazı logosu: "A" harfinin yatay çizgisi kırmızı-beyaz bariyerdir.
 * `size` harf yüksekliğini (yazı tipi boyutu) belirler.
 */
export default function HermapLogo({ size = 46, color = '#fff', tagline }) {
  const aWidth = size * 0.76;
  const aHeight = size * 0.74;
  return (
    <View style={styles.wrap}>
      <View style={styles.row} accessibilityLabel="HERMAP">
        <Text style={[styles.word, { fontSize: size, color, lineHeight: size * 1.05 }]}>HERM</Text>
        <Svg width={aWidth} height={aHeight} viewBox="0 0 42 46" style={{ marginBottom: size * 0.17, marginRight: size * 0.02 }}>
          <Defs>
            <ClipPath id="hermap-bar">
              <Rect x="4" y="25" width="34" height="11" rx="1.5" />
            </ClipPath>
          </Defs>
          <Polygon points="16,0 26,0 42,46 32,46 21,13 10,46 0,46" fill={color} />
          <Rect x="4" y="25" width="34" height="11" rx="1.5" fill="#fff" />
          <G clipPath="url(#hermap-bar)">
            {[0, 1, 2, 3, 4].map((k) => (
              <Polygon key={k} points={`${k * 9 - 2},36 ${k * 9 + 3},36 ${k * 9 + 9},25 ${k * 9 + 4},25`} fill="#d70015" />
            ))}
          </G>
        </Svg>
        <Text style={[styles.word, { fontSize: size, color, lineHeight: size * 1.05 }]}>P</Text>
      </View>
      {!!tagline && <Text style={[styles.tagline, { color }]}>{tagline}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center' },
  row: { flexDirection: 'row', alignItems: 'flex-end' },
  word: { fontWeight: '900', letterSpacing: 1, textShadowColor: 'rgba(0,0,0,0.5)', textShadowRadius: 10, textShadowOffset: { width: 0, height: 3 } },
  tagline: { fontSize: 13, marginTop: 6, opacity: 0.92, textShadowColor: 'rgba(0,0,0,0.6)', textShadowRadius: 6 },
});
