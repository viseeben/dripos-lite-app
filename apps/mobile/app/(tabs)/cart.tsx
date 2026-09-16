import { FlatList, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Colors, Radius, Spacing, TypeScale } from '../../src/theme';
import { formatCents } from '../../src/lib/money';
import { EmptyState } from '../../src/components/States';
import { Button } from '../../src/components/Button';
import { QuantityStepper } from '../../src/components/QuantityStepper';
import { TotalsBlock } from '../../src/components/TotalsBlock';
import { useCartStore, type CartItem } from '../../src/store/cart';

export default function CartScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const items = useCartStore((s) => s.items);
  const subtotalCents = useCartStore((s) => s.subtotalCents);
  const taxCents = useCartStore((s) => s.taxCents);
  const totalCents = useCartStore((s) => s.totalCents);
  const updateQuantity = useCartStore((s) => s.updateQuantity);

  if (items.length === 0) {
    return (
      <EmptyState
        icon="shopping-bag"
        title="Your cart is empty"
        body="Browse the menu to get started."
        action={{ label: 'Browse Menu', onPress: () => router.replace('/') }}
      />
    );
  }

  return (
    <View style={styles.container}>
      <FlatList
        data={items}
        keyExtractor={(item) => item.cartId}
        contentContainerStyle={styles.list}
        renderItem={({ item }) => (
          <CartLine
            item={item}
            onIncrease={() => updateQuantity(item.cartId, item.quantity + 1)}
            onDecrease={() => updateQuantity(item.cartId, item.quantity - 1)}
          />
        )}
      />

      <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, Spacing.base) }]}>
        <TotalsBlock
          subtotalCents={subtotalCents}
          taxCents={taxCents}
          totalCents={totalCents}
        />
        <Button
          label="Checkout"
          onPress={() => router.push('/checkout')}
          accessibilityHint={`Proceed to payment for ${formatCents(totalCents)}`}
        />
      </View>
    </View>
  );
}

function CartLine({
  item,
  onIncrease,
  onDecrease,
}: {
  item: CartItem;
  onIncrease: () => void;
  onDecrease: () => void;
}) {
  const modifierSummary = item.selectedModifiers.map((m) => m.optionName).join(', ');

  return (
    <View style={styles.line}>
      <View style={styles.lineHeader}>
        <View style={styles.lineText}>
          <Text style={styles.lineName}>{item.productName}</Text>
          {modifierSummary ? <Text style={styles.lineModifiers}>{modifierSummary}</Text> : null}
          <Text style={styles.lineUnit}>{formatCents(item.unitPriceCents)} each</Text>
        </View>
        <Text style={styles.lineTotal}>{formatCents(item.lineTotalCents)}</Text>
      </View>
      <QuantityStepper
        quantity={item.quantity}
        onIncrease={onIncrease}
        onDecrease={onDecrease}
        itemName={item.productName}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  list: { padding: Spacing.base, gap: Spacing.md, paddingBottom: Spacing.xl },
  line: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.lg,
    padding: Spacing.base,
    gap: Spacing.md,
  },
  lineHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.md },
  lineText: { flex: 1, gap: 2 },
  lineName: { ...TypeScale.bodyLarge, color: Colors.textPrimary },
  lineModifiers: { ...TypeScale.bodySmall, color: Colors.textMuted },
  lineUnit: { ...TypeScale.labelSmall, color: Colors.textMuted, marginTop: Spacing.xs },
  lineTotal: { ...TypeScale.amount, color: Colors.textPrimary },
  footer: {
    borderTopWidth: 1,
    borderTopColor: Colors.borderDefault,
    backgroundColor: Colors.background,
    padding: Spacing.base,
    gap: Spacing.base,
  },
});
