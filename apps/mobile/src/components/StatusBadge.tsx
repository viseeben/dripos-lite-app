import { StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { Colors, Radius, Spacing, TypeScale } from '../theme';
import type { TicketStatus } from '../types/api';

/**
 * Colour is never the only signal: each status also carries its own icon and
 * label, so the badge still reads correctly in greyscale or with colour vision
 * deficiency.
 */
const STATUS_CONFIG = {
  paid: { label: 'Paid', bg: Colors.lime, fg: Colors.successText, icon: 'check-circle' },
  open: { label: 'Open', bg: Colors.warning, fg: Colors.warningText, icon: 'clock' },
  void: { label: 'Void', bg: Colors.error, fg: Colors.errorText, icon: 'x-circle' },
} as const satisfies Record<TicketStatus, { label: string; bg: string; fg: string; icon: keyof typeof Feather.glyphMap }>;

export function StatusBadge({ status }: { status: TicketStatus }) {
  const config = STATUS_CONFIG[status];
  return (
    <View
      style={[styles.badge, { backgroundColor: config.bg }]}
      accessibilityRole="text"
      accessibilityLabel={`Status: ${config.label}`}
    >
      <Feather name={config.icon} size={11} color={config.fg} />
      <Text style={[styles.label, { color: config.fg }]}>{config.label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    borderRadius: Radius.pill,
    paddingVertical: Spacing.xs,
    paddingHorizontal: Spacing.sm + 2,
    alignSelf: 'flex-start',
  },
  label: { ...TypeScale.labelSmall },
});
