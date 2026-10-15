import { useEffect } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Colors, IconSize, MIN_TOUCH_TARGET, Radius, Spacing, TypeScale } from '../../src/theme';
import { formatCents } from '../../src/lib/money';
import { ApiError, api, errorMessage } from '../../src/lib/api';
import { isOfflineNow, useIsOffline } from '../../src/store/connectivity';
import { useQueueStore } from '../../src/store/queue';
import { summariseSession, usePaymentSessionStore } from '../../src/store/payment';
import { Button } from '../../src/components/Button';
import { Divider } from '../../src/components/Divider';
import { TotalsBlock } from '../../src/components/TotalsBlock';
import { EmptyState } from '../../src/components/States';
import { OfflineBanner } from '../../src/components/OfflineBanner';
import { useCartStore } from '../../src/store/cart';
import type { PaymentMethod } from '../../src/types/api';

const PAYMENT_METHODS: Array<{ method: PaymentMethod; label: string; enabled: boolean }> = [
  { method: 'cash', label: 'Cash', enabled: true },
  { method: 'card', label: 'Card', enabled: false },
  { method: 'gift_card', label: 'Gift Card', enabled: false },
  { method: 'other', label: 'Other', enabled: false },
];

export default function CheckoutScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const offline = useIsOffline();

  const items = useCartStore((s) => s.items);
  const subtotalCents = useCartStore((s) => s.subtotalCents);
  const taxCents = useCartStore((s) => s.taxCents);
  const totalCents = useCartStore((s) => s.totalCents);
  const clearCart = useCartStore((s) => s.clearCart);

  const clientTicketId = usePaymentSessionStore((s) => s.clientTicketId);
  const tenders = usePaymentSessionStore((s) => s.tenders);
  const startSession = usePaymentSessionStore((s) => s.start);
  const removeTender = usePaymentSessionStore((s) => s.removeTender);
  const clearSession = usePaymentSessionStore((s) => s.clear);

  const enqueue = useQueueStore((s) => s.enqueue);

  // Opens (or resumes) the payment for this cart. A changed total starts over,
  // because tenders taken against a different total no longer apply.
  useEffect(() => {
    if (totalCents > 0) startSession(totalCents);
  }, [totalCents, startSession]);

  const { lines, amountPaidCents, amountRemainingCents, changeDueCents } = summariseSession(
    totalCents,
    tenders,
  );
  const fullyPaid = tenders.length > 0 && amountRemainingCents === 0;

  const submit = useMutation({
    mutationFn: async (): Promise<{ receiptId: string }> => {
      if (!clientTicketId) throw new Error('No payment in progress.');
      if (amountRemainingCents > 0) throw new Error('The ticket is not fully paid yet.');

      const sale = {
        clientTicketId,
        placedAt: new Date().toISOString(),
        items: items.map((item) => ({
          productId: item.productId,
          productName: item.productName,
          quantity: item.quantity,
          unitPriceCents: item.unitPriceCents,
          lineTotalCents: item.lineTotalCents,
          modifiers: item.selectedModifiers.map((m) => ({
            optionId: m.optionId,
            name: m.optionName,
            groupName: m.modifierGroupName,
            priceDeltaCents: m.priceDeltaCents,
          })),
        })),
        subtotalCents,
        taxCents,
        totalCents,
        tenders,
      };

      if (isOfflineNow()) {
        const queued = await enqueue(sale);
        return { receiptId: queued.clientTicketId };
      }

      try {
        const ticket = await api.createTicket({
          items: sale.items.map((item) => ({
            productId: item.productId,
            quantity: item.quantity,
            selectedModifierOptionIds: item.modifiers.map((m) => m.optionId),
          })),
          subtotalCents,
          taxCents,
          totalCents,
          clientTicketId,
          placedAt: sale.placedAt,
        });

        // Every tender is sent as its own payment, under its own key, so a
        // retry re-sends the same set rather than charging again.
        for (const tender of tenders) {
          await api.payTicket(ticket.id, {
            paymentMethod: 'cash',
            amountTenderedCents: tender.amountTenderedCents,
            clientPaymentId: tender.clientPaymentId,
          });
        }
        return { receiptId: ticket.id };
      } catch (err) {
        const transient =
          err instanceof ApiError && (err.code === 'NETWORK_ERROR' || err.code === 'TIMEOUT');
        if (!transient) throw err;
        // Cash is already in the drawer; never lose it to a flaky connection.
        const queued = await enqueue(sale);
        return { receiptId: queued.clientTicketId };
      }
    },
    onSuccess: ({ receiptId }) => {
      clearCart();
      clearSession();
      void queryClient.invalidateQueries({ queryKey: ['tickets'] });
      router.replace(`/receipt/${receiptId}`);
    },
  });

  if (items.length === 0 && !submit.isPending) {
    return (
      <EmptyState
        icon="shopping-bag"
        title="Nothing to check out"
        body="Your cart is empty."
        action={{ label: 'Browse Menu', onPress: () => router.replace('/') }}
      />
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
      <OfflineBanner />

      <View style={styles.card}>
        <Text style={styles.sectionLabel}>Order</Text>
        {items.map((item) => (
          <View key={item.cartId} style={styles.summaryRow}>
            <Text style={styles.summaryName} numberOfLines={2}>
              {item.quantity}× {item.productName}
              {item.selectedModifiers.length > 0
                ? ` (${item.selectedModifiers.map((m) => m.optionName).join(', ')})`
                : ''}
            </Text>
            <Text style={styles.summaryAmount}>{formatCents(item.lineTotalCents)}</Text>
          </View>
        ))}
        <Divider />
        <TotalsBlock subtotalCents={subtotalCents} taxCents={taxCents} totalCents={totalCents} />
      </View>

      <View style={styles.card}>
        <Text style={styles.sectionLabel}>Payment method</Text>
        <View style={styles.methodRow}>
          {PAYMENT_METHODS.map(({ method, label, enabled }) => (
            <Pressable
              key={method}
              disabled={!enabled}
              onPress={() => undefined}
              accessibilityRole="radio"
              accessibilityState={{ disabled: !enabled, selected: enabled, checked: enabled }}
              accessibilityLabel={enabled ? `${label}, selected` : `${label}, coming soon`}
              style={[styles.method, enabled ? styles.methodActive : styles.methodDisabled]}
            >
              <Feather
                name={enabled ? 'check' : 'lock'}
                size={12}
                color={enabled ? Colors.espresso : Colors.textDisabled}
              />
              <Text style={[styles.methodLabel, !enabled && styles.methodLabelDisabled]}>
                {label}
              </Text>
            </Pressable>
          ))}
        </View>
        <Text style={styles.hint}>Card, gift card and other methods are coming soon.</Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.sectionLabel}>
          {tenders.length > 0 ? `Payments taken (${tenders.length})` : 'Payments'}
        </Text>

        {lines.length === 0 ? (
          <Text style={styles.hint}>
            No payments yet. Add one below — you can take several if the customer is splitting
            the bill.
          </Text>
        ) : (
          lines.map((line, index) => (
            <View key={line.clientPaymentId} style={styles.tenderRow}>
              <View style={styles.tenderText}>
                <Text style={styles.tenderTitle}>
                  Payment {index + 1} · {formatCents(line.amountTenderedCents)} cash
                </Text>
                <Text style={styles.tenderMeta}>
                  {formatCents(line.amountAppliedCents)} to balance
                  {line.changeDueCents > 0 ? ` · ${formatCents(line.changeDueCents)} change` : ''}
                </Text>
              </View>
              <Pressable
                onPress={() => removeTender(line.clientPaymentId)}
                accessibilityRole="button"
                accessibilityLabel={`Remove payment ${index + 1}`}
                accessibilityHint="Removes this payment from the ticket"
                hitSlop={8}
                style={styles.removeButton}
              >
                <Feather name="x" size={IconSize.md} color={Colors.errorText} />
              </Pressable>
            </View>
          ))
        )}

        <Divider />

        <View style={styles.balanceRow}>
          <Text style={styles.balanceLabel}>{fullyPaid ? 'Change due' : 'Remaining'}</Text>
          <Text style={[styles.balanceValue, fullyPaid && styles.balancePaid]}>
            {formatCents(fullyPaid ? changeDueCents : amountRemainingCents)}
          </Text>
        </View>
        {tenders.length > 0 && !fullyPaid ? (
          <Text style={styles.hint}>{formatCents(amountPaidCents)} paid so far.</Text>
        ) : null}

        {!fullyPaid ? (
          <Button
            label={tenders.length === 0 ? 'Take payment' : 'Add another payment'}
            onPress={() => router.push('/checkout/tender')}
            accessibilityHint={`Enter a cash amount towards the ${formatCents(
              amountRemainingCents,
            )} remaining`}
          />
        ) : null}
      </View>

      {submit.isError ? (
        <View style={styles.errorBox}>
          <Text style={styles.errorText} accessibilityRole="alert">
            {errorMessage(submit.error)}
          </Text>
        </View>
      ) : null}

      {fullyPaid ? (
        <Button
          label={
            submit.isPending
              ? 'Processing order…'
              : offline
                ? 'Complete Order (offline)'
                : 'Complete Order'
          }
          onPress={() => submit.mutate()}
          loading={submit.isPending}
          disabled={submit.isPending}
          accessibilityHint="Finalises the ticket and prints the receipt"
        />
      ) : null}
    </ScrollView>
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
  sectionLabel: { ...TypeScale.labelSmall, color: Colors.textMuted },
  summaryRow: { flexDirection: 'row', justifyContent: 'space-between', gap: Spacing.md },
  summaryName: { ...TypeScale.body, color: Colors.textPrimary, flex: 1 },
  summaryAmount: { ...TypeScale.amount, color: Colors.textPrimary },
  methodRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  method: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    minHeight: MIN_TOUCH_TARGET,
    paddingHorizontal: Spacing.base,
    borderRadius: Radius.pill,
    borderWidth: 1.5,
  },
  methodActive: { borderColor: Colors.espresso, backgroundColor: Colors.lime },
  methodDisabled: { borderColor: Colors.borderDefault, backgroundColor: Colors.surfaceAlt },
  methodLabel: { ...TypeScale.labelSmall, color: Colors.espresso },
  methodLabelDisabled: { color: Colors.textDisabled },
  hint: { ...TypeScale.bodySmall, color: Colors.textMuted },
  tenderRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  tenderText: { flex: 1, gap: 2 },
  tenderTitle: { ...TypeScale.body, color: Colors.textPrimary },
  tenderMeta: { ...TypeScale.bodySmall, color: Colors.textMuted },
  removeButton: {
    width: MIN_TOUCH_TARGET,
    height: MIN_TOUCH_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
  },
  balanceRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  balanceLabel: { ...TypeScale.label, color: Colors.textMuted },
  balanceValue: { ...TypeScale.amountLarge, color: Colors.textPrimary },
  balancePaid: { color: Colors.successText },
  errorBox: { backgroundColor: Colors.error, borderRadius: Radius.md, padding: Spacing.base },
  errorText: { ...TypeScale.body, color: Colors.errorText },
});
