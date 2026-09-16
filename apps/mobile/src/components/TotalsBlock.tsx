import { StyleSheet, Text, View } from 'react-native';
import { Colors, Spacing, TypeScale } from '../theme';
import { formatCents } from '../lib/money';
import { Divider } from './Divider';

interface TotalsBlockProps {
  subtotalCents: number;
  taxCents: number;
  totalCents: number;
  onDark?: boolean;
}

export function TotalsBlock({ subtotalCents, taxCents, totalCents, onDark }: TotalsBlockProps) {
  const labelColor = onDark ? Colors.textOnDark : Colors.textMuted;
  const valueColor = onDark ? Colors.textOnDark : Colors.textPrimary;

  return (
    <View style={styles.container}>
      <Row label="Subtotal" value={formatCents(subtotalCents)} labelColor={labelColor} valueColor={valueColor} />
      <Row label="Tax (8.875%)" value={formatCents(taxCents)} labelColor={labelColor} valueColor={valueColor} />
      <Divider onDark={onDark} />
      <View style={styles.row}>
        <Text style={[TypeScale.label, { color: valueColor }]}>Total</Text>
        <Text style={[TypeScale.amountLarge, { color: onDark ? Colors.lime : Colors.textPrimary }]}>
          {formatCents(totalCents)}
        </Text>
      </View>
    </View>
  );
}

function Row({
  label,
  value,
  labelColor,
  valueColor,
}: {
  label: string;
  value: string;
  labelColor: string;
  valueColor: string;
}) {
  return (
    <View style={styles.row} accessibilityLabel={`${label} ${value}`}>
      <Text style={[TypeScale.body, { color: labelColor }]}>{label}</Text>
      <Text style={[TypeScale.amount, { color: valueColor }]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: Spacing.sm },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
});
