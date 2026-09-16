import { useMemo, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Colors, IconSize, MIN_TOUCH_TARGET, Radius, Spacing, TypeScale } from '../src/theme';
import { formatCents, parseDollarsToCents } from '../src/lib/money';
import { api, errorMessage } from '../src/lib/api';
import { Button } from '../src/components/Button';
import { Divider } from '../src/components/Divider';
import { TotalsBlock } from '../src/components/TotalsBlock';
import { EmptyState } from '../src/components/States';
import { useCartStore } from '../src/store/cart';
import type { PaymentMethod } from '../src/types/api';

const PAYMENT_METHODS: Array<{ method: PaymentMethod; label: string; enabled: boolean }> = [
  { method: 'cash', label: 'Cash', enabled: true },
  { method: 'card', label: 'Card', enabled: false },
  { method: 'gift_card', label: 'Gift Card', enabled: false },
  { method: 'other', label: 'Other', enabled: false },
];

export default function CheckoutScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();

  const items = useCartStore((s) => s.items);
  const subtotalCents = useCartStore((s) => s.subtotalCents);
  const taxCents = useCartStore((s) => s.taxCents);
  const totalCents = useCartStore((s) => s.totalCents);
  const clearCart = useCartStore((s) => s.clearCart);

  const [tendered, setTendered] = useState('');
  const [errorText, setErrorText] = useState<string | null>(null);

  const tenderedCents = parseDollarsToCents(tendered);
  const changeDueCents =
    tenderedCents !== null && tenderedCents >= totalCents ? tenderedCents - totalCents : null;
  const isShort = tenderedCents !== null && tenderedCents < totalCents;

  /** Exact change, plus the next round amounts a cashier would actually reach for. */
  const quickTenders = useMemo(() => {
    const candidates = new Set<number>([totalCents]);
    for (const step of [500, 1000, 2000, 5000]) {
      candidates.add(Math.ceil(totalCents / step) * step);
    }
    return [...candidates].sort((a, b) => a - b).slice(0, 4);
  }, [totalCents]);

  const submit = useMutation({
    mutationFn: async () => {
      if (tenderedCents === null) throw new Error('Enter the amount tendered.');
      const ticket = await api.createTicket({
        items: items.map((item) => ({
          productId: item.productId,
          quantity: item.quantity,
          selectedModifierOptionIds: item.selectedModifiers.map((m) => m.optionId),
        })),
        subtotalCents,
        taxCents,
        totalCents,
      });
      return api.payTicket(ticket.id, {
        paymentMethod: 'cash',
        amountTenderedCents: tenderedCents,
      });
    },
    onSuccess: (ticket) => {
      clearCart();
      void queryClient.invalidateQueries({ queryKey: ['tickets'] });
      router.replace(`/receipt/${ticket.id}`);
    },
    onError: (err) => setErrorText(errorMessage(err)),
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

  const canSubmit = tenderedCents !== null && tenderedCents >= totalCents && !submit.isPending;

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 96 : 0}
    >
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
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
                {!enabled ? (
                  <Feather name="lock" size={12} color={Colors.textDisabled} />
                ) : (
                  <Feather name="check" size={12} color={Colors.espresso} />
                )}
                <Text style={[styles.methodLabel, !enabled && styles.methodLabelDisabled]}>
                  {label}
                </Text>
              </Pressable>
            ))}
          </View>
          <Text style={styles.hint}>Card, gift card and other methods are coming soon.</Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionLabel}>Amount tendered</Text>
          <View style={styles.inputRow}>
            <Text style={styles.currency}>$</Text>
            <TextInput
              value={tendered}
              onChangeText={(text) => {
                setTendered(text);
                setErrorText(null);
              }}
              keyboardType="decimal-pad"
              inputMode="decimal"
              placeholder="0.00"
              placeholderTextColor={Colors.textDisabled}
              style={styles.input}
              accessibilityLabel="Amount tendered in dollars"
              returnKeyType="done"
            />
          </View>

          <View style={styles.quickRow}>
            {quickTenders.map((cents) => (
              <Pressable
                key={cents}
                onPress={() => {
                  setTendered((cents / 100).toFixed(2));
                  setErrorText(null);
                }}
                accessibilityRole="button"
                accessibilityLabel={`Tender ${formatCents(cents)}`}
                style={({ pressed }) => [styles.quick, pressed && styles.quickPressed]}
              >
                <Text style={styles.quickLabel}>
                  {cents === totalCents ? 'Exact' : formatCents(cents)}
                </Text>
              </Pressable>
            ))}
          </View>

          {isShort ? (
            <Text style={styles.shortText} accessibilityRole="alert">
              Insufficient — {formatCents(totalCents - (tenderedCents ?? 0))} short
            </Text>
          ) : null}

          {changeDueCents !== null ? (
            <View style={styles.changeRow}>
              <Text style={styles.changeLabel}>Change due</Text>
              <Text style={styles.changeAmount}>{formatCents(changeDueCents)}</Text>
            </View>
          ) : null}
        </View>

        {errorText ? (
          <View style={styles.errorBox}>
            <Text style={styles.errorText} accessibilityRole="alert">
              {errorText}
            </Text>
          </View>
        ) : null}

        <Button
          label={submit.isPending ? 'Processing order…' : 'Submit Order'}
          onPress={() => {
            setErrorText(null);
            submit.mutate();
          }}
          disabled={!canSubmit}
          loading={submit.isPending}
          accessibilityHint={
            canSubmit ? 'Creates the ticket and records payment' : 'Enter an amount covering the total'
          }
        />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
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
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: Colors.borderDefault,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.base,
    minHeight: 52,
    gap: Spacing.xs,
  },
  currency: { ...TypeScale.amountLarge, color: Colors.textMuted },
  input: { ...TypeScale.amountLarge, color: Colors.textPrimary, flex: 1, paddingVertical: Spacing.sm },
  quickRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  quick: {
    minHeight: MIN_TOUCH_TARGET,
    justifyContent: 'center',
    paddingHorizontal: Spacing.base,
    borderRadius: Radius.pill,
    borderWidth: 1,
    borderColor: Colors.borderDefault,
    backgroundColor: Colors.surfaceAlt,
  },
  quickPressed: { opacity: 0.6 },
  quickLabel: { ...TypeScale.labelSmall, color: Colors.textPrimary },
  shortText: { ...TypeScale.body, color: Colors.errorText },
  changeRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  changeLabel: { ...TypeScale.label, color: Colors.textMuted },
  changeAmount: { ...TypeScale.amountLarge, color: Colors.successText },
  errorBox: { backgroundColor: Colors.error, borderRadius: Radius.md, padding: Spacing.base },
  errorText: { ...TypeScale.body, color: Colors.errorText },
});
