import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { Colors, IconSize, MIN_TOUCH_TARGET, Radius, TypeScale } from '../theme';

interface QuantityStepperProps {
  quantity: number;
  onIncrease: () => void;
  onDecrease: () => void;
  /** Label used to disambiguate this stepper for screen readers. */
  itemName: string;
}

/**
 * At a quantity of 1 the decrement control becomes a trash button that removes
 * the line, so there is never a dead-end minus.
 */
export function QuantityStepper({
  quantity,
  onIncrease,
  onDecrease,
  itemName,
}: QuantityStepperProps) {
  const atMinimum = quantity <= 1;

  return (
    <View style={styles.row}>
      <Pressable
        onPress={onDecrease}
        style={({ pressed }) => [styles.button, pressed && styles.pressed]}
        accessibilityRole="button"
        accessibilityLabel={atMinimum ? `Remove ${itemName}` : `Decrease quantity of ${itemName}`}
        accessibilityHint={atMinimum ? 'Removes this item from the cart' : 'Decrease quantity'}
        hitSlop={6}
      >
        <Feather
          name={atMinimum ? 'trash-2' : 'minus'}
          size={IconSize.md}
          color={atMinimum ? Colors.errorText : Colors.espresso}
        />
      </Pressable>

      <Text style={styles.quantity} accessibilityLabel={`Quantity ${quantity}`}>
        {quantity}
      </Text>

      <Pressable
        onPress={onIncrease}
        style={({ pressed }) => [styles.button, pressed && styles.pressed]}
        accessibilityRole="button"
        accessibilityLabel={`Increase quantity of ${itemName}`}
        accessibilityHint="Increase quantity"
        hitSlop={6}
      >
        <Feather name="plus" size={IconSize.md} color={Colors.espresso} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  button: {
    width: MIN_TOUCH_TARGET,
    height: MIN_TOUCH_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Radius.pill,
    borderWidth: 1,
    borderColor: Colors.borderDefault,
    backgroundColor: Colors.surface,
  },
  pressed: { opacity: 0.6 },
  quantity: {
    ...TypeScale.amount,
    color: Colors.textPrimary,
    minWidth: 40,
    textAlign: 'center',
  },
});
