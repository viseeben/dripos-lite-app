import { StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { Colors, Radius, Spacing, TypeScale } from '../theme';
import type { QueuedStatus } from '../store/queue';

const CONFIG = {
  pending: { label: 'Pending sync', bg: Colors.warning, fg: Colors.warningText, icon: 'clock' },
  syncing: { label: 'Syncing', bg: Colors.warning, fg: Colors.warningText, icon: 'upload-cloud' },
  synced: { label: 'Synced', bg: Colors.lime, fg: Colors.successText, icon: 'check-circle' },
  failed: { label: 'Sync failed', bg: Colors.error, fg: Colors.errorText, icon: 'alert-circle' },
} as const satisfies Record<
  QueuedStatus,
  { label: string; bg: string; fg: string; icon: keyof typeof Feather.glyphMap }
>;

/** Colour is never the only signal: each state carries its own icon and words. */
export function SyncBadge({ status }: { status: QueuedStatus }) {
  const config = CONFIG[status];
  return (
    <View
      style={[styles.badge, { backgroundColor: config.bg }]}
      accessibilityRole="text"
      accessibilityLabel={config.label}
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
