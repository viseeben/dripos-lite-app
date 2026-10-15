import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { Colors, IconSize, Radius, Spacing, TypeScale } from '../theme';
import { useIsOffline } from '../store/connectivity';
import { usePendingCount } from '../store/queue';
import { useSyncStore } from '../lib/sync';

/**
 * Standing status line. A cashier needs to know, without being asked, whether
 * the till is banking sales or stacking them up, so this reports both the
 * connection and the depth of the queue.
 */
export function OfflineBanner({ cachedMenu = false }: { cachedMenu?: boolean }) {
  const offline = useIsOffline();
  const pending = usePendingCount();
  const isSyncing = useSyncStore((s) => s.isSyncing);

  if (!offline && pending === 0) return null;

  const plural = pending === 1 ? 'ticket' : 'tickets';

  if (offline) {
    return (
      <View style={[styles.banner, styles.offline]}>
        <Feather name="wifi-off" size={IconSize.md} color={Colors.warningText} />
        <View style={styles.text}>
          <Text style={styles.title}>Offline</Text>
          <Text style={styles.body}>
            {pending > 0
              ? `${pending} ${plural} saved on this device. They'll sync automatically when you're back online.`
              : 'Orders will be saved on this device and synced when you’re back online.'}
            {cachedMenu ? ' Showing the last downloaded menu.' : ''}
          </Text>
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.banner, styles.syncing]}>
      {isSyncing ? (
        <ActivityIndicator size="small" color={Colors.successText} />
      ) : (
        <Feather name="upload-cloud" size={IconSize.md} color={Colors.successText} />
      )}
      <View style={styles.text}>
        <Text style={[styles.title, styles.titleOnline]}>
          {isSyncing ? 'Syncing…' : `${pending} ${plural} pending sync`}
        </Text>
        <Text style={[styles.body, styles.bodyOnline]}>
          {isSyncing ? 'Sending saved orders to the server.' : 'Waiting to send saved orders.'}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.md,
    borderRadius: Radius.md,
    padding: Spacing.md,
    marginBottom: Spacing.md,
  },
  offline: { backgroundColor: Colors.warning },
  syncing: { backgroundColor: Colors.lime },
  text: { flex: 1, gap: 2 },
  title: { ...TypeScale.labelSmall, color: Colors.warningText },
  titleOnline: { color: Colors.successText },
  body: { ...TypeScale.bodySmall, color: Colors.warningText },
  bodyOnline: { color: Colors.successText },
});
