import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Colors, IconSize, MIN_TOUCH_TARGET, Radius, Spacing, TypeScale } from '../../src/theme';
import { computeUnitPriceCents, formatCents, formatDelta } from '../../src/lib/money';
import { errorMessage } from '../../src/lib/api';
import { useProduct } from '../../src/lib/queries';
import { ErrorState, LoadingState } from '../../src/components/States';
import { Button } from '../../src/components/Button';
import { useCartStore, type SelectedModifier } from '../../src/store/cart';
import type { ModifierGroup, ModifierOption } from '../../src/types/api';

export default function ProductModal() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const addItem = useCartStore((s) => s.addItem);

  /** groupId -> selected optionId. Each group is single-select. */
  const [selections, setSelections] = useState<Record<string, string>>({});

  const { product, isPending, isError, error, refetch } = useProduct(id);

  const selectedModifiers = useMemo<SelectedModifier[]>(() => {
    if (!product) return [];
    return product.modifierGroups.flatMap((group) => {
      const optionId = selections[group.id];
      const option = group.options.find((o) => o.id === optionId);
      return option
        ? [
            {
              modifierGroupId: group.id,
              modifierGroupName: group.name,
              optionId: option.id,
              optionName: option.name,
              priceDeltaCents: option.priceDeltaCents,
            },
          ]
        : [];
    });
  }, [product, selections]);

  const unitPriceCents = product
    ? computeUnitPriceCents(
        product.priceCents,
        selectedModifiers.map((m) => m.priceDeltaCents),
      )
    : 0;

  const missingRequired = product
    ? product.modifierGroups.filter((g) => g.required && !selections[g.id])
    : [];
  const canAdd = product !== undefined && missingRequired.length === 0;

  if (isPending) return <LoadingState message="Loading…" />;
  if (isError) return <ErrorState message={errorMessage(error)} onRetry={refetch} />;
  if (!product) {
    return <ErrorState message="That product is no longer on the menu." onRetry={refetch} />;
  }

  const handleAdd = () => {
    addItem({
      productId: product.id,
      productName: product.name,
      productPriceCents: product.priceCents,
      selectedModifiers,
      quantity: 1,
    });
    router.back();
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View style={styles.headerText}>
          <Text style={styles.title}>{product.name}</Text>
          <Text style={styles.basePrice}>{formatCents(product.priceCents)}</Text>
        </View>
        <Pressable
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel="Close"
          hitSlop={8}
          style={styles.close}
        >
          <Feather name="x" size={IconSize.lg} color={Colors.espresso} />
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>
        {product.modifierGroups.length === 0 ? (
          <Text style={styles.noOptions}>No options for this item.</Text>
        ) : (
          product.modifierGroups.map((group) => (
            <ModifierGroupSection
              key={group.id}
              group={group}
              selectedOptionId={selections[group.id]}
              onSelect={(optionId) => setSelections((prev) => ({ ...prev, [group.id]: optionId }))}
            />
          ))
        )}
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, Spacing.base) }]}>
        <View style={styles.previewRow}>
          <Text style={styles.previewLabel}>Item total</Text>
          <Text style={styles.previewAmount}>{formatCents(unitPriceCents)}</Text>
        </View>
        {missingRequired.length > 0 ? (
          <Text style={styles.requiredHint} accessibilityRole="alert">
            Choose {missingRequired.map((g) => g.name).join(', ')} to continue
          </Text>
        ) : null}
        <Button
          label="Add to Cart"
          onPress={handleAdd}
          disabled={!canAdd}
          accessibilityHint={
            canAdd ? `Adds ${product.name} to your cart` : 'Select all required options first'
          }
        />
      </View>
    </View>
  );
}

function ModifierGroupSection({
  group,
  selectedOptionId,
  onSelect,
}: {
  group: ModifierGroup;
  selectedOptionId: string | undefined;
  onSelect: (optionId: string) => void;
}) {
  return (
    <View style={styles.group}>
      <Text style={styles.groupLabel}>
        {group.name}
        {group.required ? ' (required)' : ''}
      </Text>
      <View style={styles.optionList}>
        {group.options.map((option) => (
          <OptionRow
            key={option.id}
            option={option}
            selected={option.id === selectedOptionId}
            groupName={group.name}
            onPress={() => onSelect(option.id)}
          />
        ))}
      </View>
    </View>
  );
}

function OptionRow({
  option,
  selected,
  groupName,
  onPress,
}: {
  option: ModifierOption;
  selected: boolean;
  groupName: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ selected, checked: selected }}
      accessibilityLabel={`${groupName}: ${option.name}, ${formatDelta(option.priceDeltaCents)}`}
      style={({ pressed }) => [styles.option, selected && styles.optionSelected, pressed && styles.optionPressed]}
    >
      <Feather
        name={selected ? 'check-circle' : 'circle'}
        size={IconSize.md}
        color={selected ? Colors.successText : Colors.textMuted}
      />
      <Text style={styles.optionName}>{option.name}</Text>
      <Text style={[styles.optionDelta, option.priceDeltaCents === 0 && styles.optionDeltaFree]}>
        {formatDelta(option.priceDeltaCents)}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.surface },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    padding: Spacing.lg,
    paddingBottom: Spacing.md,
  },
  headerText: { flex: 1, gap: Spacing.xs },
  title: { ...TypeScale.h1, color: Colors.textPrimary },
  basePrice: { ...TypeScale.amount, color: Colors.textMuted },
  close: {
    width: MIN_TOUCH_TARGET,
    height: MIN_TOUCH_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scroll: { paddingHorizontal: Spacing.lg, paddingBottom: Spacing.xl, gap: Spacing.xl },
  noOptions: { ...TypeScale.body, color: Colors.textMuted },
  group: { gap: Spacing.sm },
  groupLabel: { ...TypeScale.label, color: Colors.textMuted },
  optionList: { gap: Spacing.sm },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    minHeight: MIN_TOUCH_TARGET + 4,
    paddingHorizontal: Spacing.base,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.borderDefault,
    backgroundColor: Colors.surface,
  },
  optionSelected: { borderColor: Colors.espresso, backgroundColor: Colors.surfaceAlt },
  optionPressed: { opacity: 0.7 },
  optionName: { ...TypeScale.body, color: Colors.textPrimary, flex: 1 },
  optionDelta: { ...TypeScale.amount, color: Colors.textPrimary },
  optionDeltaFree: { color: Colors.textMuted },
  footer: {
    borderTopWidth: 1,
    borderTopColor: Colors.borderDefault,
    padding: Spacing.lg,
    gap: Spacing.md,
    backgroundColor: Colors.surface,
  },
  previewRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  previewLabel: { ...TypeScale.label, color: Colors.textMuted },
  previewAmount: { ...TypeScale.amountLarge, color: Colors.textPrimary },
  requiredHint: { ...TypeScale.bodySmall, color: Colors.warningText },
});
