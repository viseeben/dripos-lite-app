import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Colors, IconSize, Radius, Spacing, TypeScale } from '../../src/theme';
import { formatCents } from '../../src/lib/money';
import { errorMessage } from '../../src/lib/api';
import { useProducts } from '../../src/lib/queries';
import { EmptyState, ErrorState, LoadingState } from '../../src/components/States';
import type { Product } from '../../src/types/api';

export default function MenuScreen() {
  const router = useRouter();
  const { data: products, isPending, isError, error, refetch } = useProducts();

  if (isPending) return <LoadingState message="Loading menu…" />;
  if (isError) return <ErrorState message={errorMessage(error)} onRetry={() => void refetch()} />;
  if (products.length === 0) {
    return <EmptyState icon="coffee" title="No products available" body="The menu is empty." />;
  }

  return (
    <FlatList
      data={products}
      keyExtractor={(item) => item.id}
      contentContainerStyle={styles.list}
      renderItem={({ item }) => (
        <ProductCard product={item} onPress={() => router.push(`/product/${item.id}`)} />
      )}
    />
  );
}

function ProductCard({ product, onPress }: { product: Product; onPress: () => void }) {
  const optionCount = product.modifierGroups.length;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${product.name}, ${formatCents(product.priceCents)}`}
      accessibilityHint="Opens options and adds to cart"
      style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
    >
      <View style={styles.cardBody}>
        <Text style={styles.name}>{product.name}</Text>
        <Text style={styles.price}>{formatCents(product.priceCents)}</Text>
        {optionCount > 0 ? (
          <Text style={styles.meta}>
            {optionCount} option{optionCount === 1 ? '' : 's'}
          </Text>
        ) : null}
      </View>
      <Feather name="chevron-right" size={IconSize.lg} color={Colors.textMuted} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  list: { padding: Spacing.base, gap: Spacing.md, paddingBottom: Spacing.xxl },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.surface,
    borderRadius: Radius.lg,
    padding: Spacing.base,
    minHeight: 72,
    shadowColor: Colors.espresso,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 2,
  },
  cardPressed: { opacity: 0.7 },
  cardBody: { flex: 1, gap: 2 },
  name: { ...TypeScale.bodyLarge, color: Colors.textPrimary },
  price: { ...TypeScale.amount, color: Colors.textMuted },
  meta: { ...TypeScale.labelSmall, color: Colors.textMuted, marginTop: Spacing.xs },
});
