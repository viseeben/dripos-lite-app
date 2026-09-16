import { StyleSheet, View } from 'react-native';
import { Colors } from '../theme';

export function Divider({ onDark = false }: { onDark?: boolean }) {
  return <View style={[styles.divider, onDark && styles.onDark]} />;
}

const styles = StyleSheet.create({
  divider: { height: StyleSheet.hairlineWidth * 2, backgroundColor: Colors.borderDefault },
  onDark: { backgroundColor: Colors.borderOnDark },
});
