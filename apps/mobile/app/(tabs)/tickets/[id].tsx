import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { Colors, Radius, Spacing, TypeScale } from '../../../src/theme';
import { formatCents, formatDelta } from '../../../src/lib/money';
import { errorMessage } from '../../../src/lib/api';
import { useTicket } from '../../../src/lib/queries';
import { ErrorState, LoadingState } from '../../../src/components/States';
import { StatusBadge } from '../../../src/components/StatusBadge';
import { TotalsBlock } from '../../../src/components/TotalsBlock';

const PAYMENT_LABELS: Record<string, string> = {
  cash: 'Cash',
  card: 'Card',
  gift_card: 'Gift Card',
  other: 'Other',
};

export default function TicketDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data: ticket, isPending, isError, error, refetch } = useTicket(id);

  if (isPending) return <LoadingState message="Loading ticket…" />;
  if (isError) return <ErrorState message={errorMessage(error)} onRetry={() => void refetch()} />;

  return (
    <ScrollView contentContainerStyle={styles.scroll}>
      <View style={styles.card}>
        <View style={styles.header}>
          <View style={styles.headerText}>
            <Text style={styles.id}>#{ticket.id.slice(-8).toUpperCase()}</Text>
            <Text style={styles.when}>
              {new Date(ticket.createdAt).toLocaleString(undefined, {
                month: 'short',
                day: 'numeric',
                year: 'numeric',
                hour: 'numeric',
                minute: '2-digit',
              })}
            </Text>
          </View>
          <StatusBadge status={ticket.status} />
        </View>
      </View>

      <View style={styles.card}>
        <Text style={styles.sectionLabel}>Items</Text>
        {ticket.items.map((item) => (
          <View key={item.id} style={styles.item}>
            <View style={styles.itemHeader}>
              <Text style={styles.itemName}>
                {item.quantity}× {item.productName}
              </Text>
              <Text style={styles.itemAmount}>{formatCents(item.lineTotalCents)}</Text>
            </View>
            <Text style={styles.itemUnit}>{formatCents(item.unitPriceCents)} each</Text>
            {item.modifiers.map((modifier, index) => (
              <View key={`${item.id}-${index}`} style={styles.modifierRow}>
                <Text style={styles.modifierName}>
                  {modifier.groupName}: {modifier.name}
                </Text>
                <Text style={styles.modifierDelta}>{formatDelta(modifier.priceDeltaCents)}</Text>
              </View>
            ))}
          </View>
        ))}
      </View>

      <View style={styles.card}>
        <Text style={styles.sectionLabel}>Totals</Text>
        <TotalsBlock
          subtotalCents={ticket.subtotalCents}
          taxCents={ticket.taxCents}
          totalCents={ticket.totalCents}
        />
      </View>

      {ticket.paymentMethod ? (
        <View style={styles.card}>
          <Text style={styles.sectionLabel}>Payment</Text>
          <DetailRow label="Method" value={PAYMENT_LABELS[ticket.paymentMethod] ?? ticket.paymentMethod} />
          {ticket.amountTenderedCents !== null ? (
            <DetailRow label="Tendered" value={formatCents(ticket.amountTenderedCents)} />
          ) : null}
          {ticket.changeDueCents !== null ? (
            <DetailRow label="Change due" value={formatCents(ticket.changeDueCents)} />
          ) : null}
        </View>
      ) : null}
    </ScrollView>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.detailRow} accessibilityLabel={`${label} ${value}`}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text style={styles.detailValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  scroll: { padding: Spacing.base, gap: Spacing.base, paddingBottom: Spacing.xxl },
  card: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.lg,
    padding: Spacing.base,
    gap: Spacing.md,
  },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: Spacing.md },
  headerText: { gap: 2, flex: 1 },
  id: { ...TypeScale.labelSmall, color: Colors.textMuted },
  when: { ...TypeScale.bodyLarge, color: Colors.textPrimary },
  sectionLabel: { ...TypeScale.labelSmall, color: Colors.textMuted },
  item: { gap: 2, paddingBottom: Spacing.sm },
  itemHeader: { flexDirection: 'row', justifyContent: 'space-between', gap: Spacing.md },
  itemName: { ...TypeScale.body, color: Colors.textPrimary, flex: 1 },
  itemAmount: { ...TypeScale.amount, color: Colors.textPrimary },
  itemUnit: { ...TypeScale.bodySmall, color: Colors.textMuted },
  modifierRow: { flexDirection: 'row', justifyContent: 'space-between', paddingLeft: Spacing.md },
  modifierName: { ...TypeScale.bodySmall, color: Colors.textMuted, flex: 1 },
  modifierDelta: { ...TypeScale.bodySmall, color: Colors.textMuted },
  detailRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  detailLabel: { ...TypeScale.body, color: Colors.textMuted },
  detailValue: { ...TypeScale.amount, color: Colors.textPrimary },
});
