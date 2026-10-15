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
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Colors, MIN_TOUCH_TARGET, Radius, Spacing, TypeScale } from '../../src/theme';
import { applyTenderCents, formatCents, parseDollarsToCents } from '../../src/lib/money';
import { Button } from '../../src/components/Button';
import { useCartStore } from '../../src/store/cart';
import { summariseSession, usePaymentSessionStore } from '../../src/store/payment';

/**
 * Collects one tender.
 *
 * This is a route of its own precisely so that leaving it is a normal back
 * navigation: the half-entered amount lives only here, and dismissing the
 * screen discards it without touching anything already confirmed.
 */
export default function TenderScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const totalCents = useCartStore((s) => s.totalCents);
  const tenders = usePaymentSessionStore((s) => s.tenders);
  const sessionTotal = usePaymentSessionStore((s) => s.totalCents);
  const addTender = usePaymentSessionStore((s) => s.addTender);

  const [amount, setAmount] = useState('');
  const [saving, setSaving] = useState(false);

  const basis = sessionTotal || totalCents;
  const { amountRemainingCents } = summariseSession(basis, tenders);

  const enteredCents = parseDollarsToCents(amount);
  const split =
    enteredCents !== null && enteredCents > 0
      ? applyTenderCents(amountRemainingCents, enteredCents)
      : null;

  /** Exact balance first, then the round notes a cashier reaches for. */
  const quickAmounts = useMemo(() => {
    const candidates = new Set<number>([amountRemainingCents]);
    for (const step of [500, 1000, 2000, 5000]) {
      candidates.add(Math.ceil(amountRemainingCents / step) * step);
    }
    return [...candidates].filter((c) => c > 0).sort((a, b) => a - b).slice(0, 4);
  }, [amountRemainingCents]);

  const canConfirm = enteredCents !== null && enteredCents > 0 && !saving;

  const confirm = async (): Promise<void> => {
    if (enteredCents === null || enteredCents <= 0) return;
    setSaving(true);
    await addTender(enteredCents);
    router.back();
  };

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 96 : 0}
    >
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <View style={styles.card}>
          <Text style={styles.sectionLabel}>Remaining balance</Text>
          <Text style={styles.remaining}>{formatCents(amountRemainingCents)}</Text>
          {tenders.length > 0 ? (
            <Text style={styles.hint}>
              {tenders.length} payment{tenders.length === 1 ? '' : 's'} already taken on this
              ticket.
            </Text>
          ) : null}
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionLabel}>Cash tendered</Text>
          <View style={styles.inputRow}>
            <Text style={styles.currency}>$</Text>
            <TextInput
              value={amount}
              onChangeText={setAmount}
              keyboardType="decimal-pad"
              inputMode="decimal"
              placeholder="0.00"
              placeholderTextColor={Colors.textDisabled}
              style={styles.input}
              accessibilityLabel="Cash tendered in dollars"
              autoFocus
              returnKeyType="done"
            />
          </View>

          <View style={styles.quickRow}>
            {quickAmounts.map((cents) => (
              <Pressable
                key={cents}
                onPress={() => setAmount((cents / 100).toFixed(2))}
                accessibilityRole="button"
                accessibilityLabel={`Tender ${formatCents(cents)}`}
                style={({ pressed }) => [styles.quick, pressed && styles.quickPressed]}
              >
                <Text style={styles.quickLabel}>
                  {cents === amountRemainingCents ? 'Exact' : formatCents(cents)}
                </Text>
              </Pressable>
            ))}
          </View>

          {split ? (
            <View style={styles.previewBlock}>
              <View style={styles.previewRow}>
                <Text style={styles.previewLabel}>Applies to balance</Text>
                <Text style={styles.previewValue}>{formatCents(split.amountAppliedCents)}</Text>
              </View>
              {split.changeDueCents > 0 ? (
                <View style={styles.previewRow}>
                  <Text style={styles.previewLabel}>Change from this payment</Text>
                  <Text style={[styles.previewValue, styles.change]}>
                    {formatCents(split.changeDueCents)}
                  </Text>
                </View>
              ) : null}
              <View style={styles.previewRow}>
                <Text style={styles.previewLabel}>Still owed after this</Text>
                <Text style={styles.previewValue}>
                  {formatCents(amountRemainingCents - split.amountAppliedCents)}
                </Text>
              </View>
            </View>
          ) : null}
        </View>

        <Text style={styles.discardNote}>
          Going back discards this entry. Payments already confirmed stay on the ticket.
        </Text>
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, Spacing.base) }]}>
        <Button
          label={
            split && split.amountAppliedCents >= amountRemainingCents
              ? 'Confirm final payment'
              : 'Confirm payment'
          }
          onPress={() => void confirm()}
          disabled={!canConfirm}
          loading={saving}
          accessibilityHint="Records this cash payment against the ticket"
        />
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  scroll: { padding: Spacing.base, gap: Spacing.base, paddingBottom: Spacing.xl },
  card: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.lg,
    padding: Spacing.base,
    gap: Spacing.md,
  },
  sectionLabel: { ...TypeScale.labelSmall, color: Colors.textMuted },
  remaining: { ...TypeScale.amountHero, color: Colors.textPrimary },
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
  input: {
    ...TypeScale.amountLarge,
    color: Colors.textPrimary,
    flex: 1,
    paddingVertical: Spacing.sm,
  },
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
  previewBlock: { gap: Spacing.sm, paddingTop: Spacing.xs },
  previewRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  previewLabel: { ...TypeScale.body, color: Colors.textMuted },
  previewValue: { ...TypeScale.amount, color: Colors.textPrimary },
  change: { color: Colors.successText },
  discardNote: { ...TypeScale.bodySmall, color: Colors.textMuted, paddingHorizontal: Spacing.xs },
  footer: {
    borderTopWidth: 1,
    borderTopColor: Colors.borderDefault,
    backgroundColor: Colors.background,
    padding: Spacing.base,
  },
});
