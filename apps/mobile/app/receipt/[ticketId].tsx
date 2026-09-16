import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Colors, Radius, Spacing, TypeScale } from '../../src/theme';
import { formatCents } from '../../src/lib/money';
import { errorMessage } from '../../src/lib/api';
import { useTicket } from '../../src/lib/queries';
import { ErrorState, LoadingState } from '../../src/components/States';
import { Button } from '../../src/components/Button';
import { Divider } from '../../src/components/Divider';

export default function ReceiptScreen() {
  const { ticketId } = useLocalSearchParams<{ ticketId: string }>();
  const router = useRouter();
  const { data: ticket, isPending, isError, error, refetch } = useTicket(ticketId);

  if (isPending) return <LoadingState message="Loading receipt…" />;
  if (isError) return <ErrorState message={errorMessage(error)} onRetry={() => void refetch()} />;

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.paper}>
          <View style={styles.head}>
            <Text style={styles.brand}>Dripos Lite</Text>
            <Text style={styles.meta}>
              {new Date(ticket.createdAt).toLocaleString(undefined, {
                month: 'short',
                day: 'numeric',
                hour: 'numeric',
                minute: '2-digit',
              })}
            </Text>
            <Text style={styles.meta}>#{ticket.id.slice(-8).toUpperCase()}</Text>
          </View>

          <Divider />

          {ticket.items.map((item) => (
            <View key={item.id} style={styles.itemRow}>
              <View style={styles.itemText}>
                <Text style={styles.itemName}>
                  {item.productName}
                  {item.quantity > 1 ? ` ×${item.quantity}` : ''}
                </Text>
                {item.modifiers.length > 0 ? (
                  <Text style={styles.itemModifiers}>
                    {item.modifiers.map((m) => m.name).join(', ')}
                  </Text>
                ) : null}
              </View>
              <Text style={styles.itemAmount}>{formatCents(item.lineTotalCents)}</Text>
            </View>
          ))}

          <Divider />

          <Row label="Subtotal" value={formatCents(ticket.subtotalCents)} />
          <Row label="Tax (8.875%)" value={formatCents(ticket.taxCents)} />
          <Row label="Total" value={formatCents(ticket.totalCents)} emphasis />

          {ticket.amountTenderedCents !== null ? (
            <>
              <Divider />
              <Row label="Cash Tendered" value={formatCents(ticket.amountTenderedCents)} />
              {ticket.changeDueCents !== null ? (
                <Row label="Change Due" value={formatCents(ticket.changeDueCents)} emphasis />
              ) : null}
            </>
          ) : null}

          <Divider />
          <Text style={styles.thanks}>Thank you!</Text>
        </View>
      </ScrollView>

      <View style={styles.footer}>
        <Button
          label="New Order"
          onPress={() => router.dismissAll()}
          accessibilityHint="Returns to the menu to start a new order"
        />
      </View>
    </View>
  );
}

function Row({ label, value, emphasis }: { label: string; value: string; emphasis?: boolean }) {
  return (
    <View style={styles.row} accessibilityLabel={`${label} ${value}`}>
      <Text style={[styles.rowLabel, emphasis && styles.rowLabelEmphasis]}>{label}</Text>
      <Text style={[styles.rowValue, emphasis && styles.rowValueEmphasis]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scroll: { padding: Spacing.base, paddingBottom: Spacing.xl },
  paper: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.lg,
    padding: Spacing.lg,
    gap: Spacing.sm,
  },
  head: { alignItems: 'center', gap: Spacing.xs, paddingVertical: Spacing.sm },
  brand: { ...TypeScale.h1, color: Colors.textPrimary },
  meta: { ...TypeScale.labelSmall, color: Colors.textMuted },
  itemRow: { flexDirection: 'row', justifyContent: 'space-between', gap: Spacing.md, paddingVertical: 2 },
  itemText: { flex: 1, gap: 2 },
  itemName: { ...TypeScale.body, color: Colors.textPrimary },
  itemModifiers: { ...TypeScale.bodySmall, color: Colors.textMuted },
  itemAmount: { ...TypeScale.amount, color: Colors.textPrimary },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  rowLabel: { ...TypeScale.body, color: Colors.textMuted },
  rowLabelEmphasis: { ...TypeScale.label, color: Colors.textPrimary },
  rowValue: { ...TypeScale.amount, color: Colors.textPrimary },
  rowValueEmphasis: { ...TypeScale.amountLarge, color: Colors.textPrimary },
  thanks: { ...TypeScale.label, color: Colors.textMuted, textAlign: 'center', paddingTop: Spacing.sm },
  footer: {
    padding: Spacing.base,
    borderTopWidth: 1,
    borderTopColor: Colors.borderDefault,
    backgroundColor: Colors.background,
  },
});
