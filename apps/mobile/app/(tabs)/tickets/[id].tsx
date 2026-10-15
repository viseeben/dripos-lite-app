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
  if (isError || !ticket) {
    return <ErrorState message={errorMessage(error)} onRetry={() => void refetch()} />;
  }

  const payments = ticket.payments ?? [];

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

      {payments.length > 0 ? (
        <View style={styles.card}>
          <Text style={styles.sectionLabel}>
            {payments.length > 1
              ? `Payments (${payments.length})`
              : 'Payment'}
          </Text>

          {payments.map((payment, index) => (
            <View key={payment.id} style={styles.item}>
              <View style={styles.itemHeader}>
                <Text style={styles.itemName}>
                  {payments.length > 1 ? `Payment ${index + 1} · ` : ''}
                  {PAYMENT_LABELS[payment.paymentMethod] ?? payment.paymentMethod}
                </Text>
                <Text style={styles.itemAmount}>{formatCents(payment.amountTenderedCents)}</Text>
              </View>
              <View style={styles.modifierRow}>
                <Text style={styles.modifierName}>Applied to balance</Text>
                <Text style={styles.modifierDelta}>
                  {formatCents(payment.amountAppliedCents)}
                </Text>
              </View>
              {payment.changeDueCents > 0 ? (
                <View style={styles.modifierRow}>
                  <Text style={styles.modifierName}>Change returned</Text>
                  <Text style={styles.modifierDelta}>{formatCents(payment.changeDueCents)}</Text>
                </View>
              ) : null}
            </View>
          ))}

          {payments.length > 1 ? (
            <>
              <DetailRow
                label="Total tendered"
                value={formatCents(ticket.amountTenderedCents ?? 0)}
              />
              <DetailRow label="Change due" value={formatCents(ticket.changeDueCents ?? 0)} />
            </>
          ) : null}

          {ticket.amountRemainingCents > 0 ? (
            <DetailRow
              label="Still owed"
              value={formatCents(ticket.amountRemainingCents)}
            />
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
