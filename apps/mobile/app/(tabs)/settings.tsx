import { ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { Colors, IconSize, Radius, Spacing, TypeScale } from '../../src/theme';
import { Button } from '../../src/components/Button';
import { Divider } from '../../src/components/Divider';
import { useConnectivityStore, useIsOffline } from '../../src/store/connectivity';
import { selectUnsynced, useQueueStore } from '../../src/store/queue';
import { syncQueue, useSyncStore } from '../../src/lib/sync';

const API_URL = process.env.EXPO_PUBLIC_API_URL ?? '(not configured)';

export default function SettingsScreen() {
  const offline = useIsOffline();
  const simulateOffline = useConnectivityStore((s) => s.simulateOffline);
  const networkOnline = useConnectivityStore((s) => s.networkOnline);
  const setSimulateOffline = useConnectivityStore((s) => s.setSimulateOffline);

  const tickets = useQueueStore((s) => s.tickets);
  const retry = useQueueStore((s) => s.retry);
  const clearSynced = useQueueStore((s) => s.clearSynced);

  const isSyncing = useSyncStore((s) => s.isSyncing);
  const lastRunAt = useSyncStore((s) => s.lastRunAt);
  const lastOutcome = useSyncStore((s) => s.lastOutcome);

  const unsynced = selectUnsynced(tickets);
  const failed = tickets.filter((t) => t.status === 'failed');
  const syncedCount = tickets.length - unsynced.length;

  return (
    <ScrollView contentContainerStyle={styles.scroll}>
      <View style={styles.card}>
        <Text style={styles.sectionLabel}>Connection</Text>

        <View style={styles.statusRow}>
          <Feather
            name={offline ? 'wifi-off' : 'wifi'}
            size={IconSize.lg}
            color={offline ? Colors.warningText : Colors.successText}
          />
          <View style={styles.statusText}>
            <Text style={styles.statusTitle}>{offline ? 'Offline' : 'Online'}</Text>
            <Text style={styles.statusBody}>
              {simulateOffline
                ? 'Offline mode is switched on below.'
                : networkOnline
                  ? 'Connected to the network.'
                  : 'No network connection detected.'}
            </Text>
          </View>
        </View>

        <Divider />

        <View style={styles.toggleRow}>
          <View style={styles.toggleText}>
            <Text style={styles.toggleTitle}>Simulate offline</Text>
            <Text style={styles.toggleBody}>
              Forces the app to behave as if there were no connection, so offline
              ordering can be demonstrated without airplane mode.
            </Text>
          </View>
          <Switch
            value={simulateOffline}
            onValueChange={setSimulateOffline}
            trackColor={{ false: Colors.borderDefault, true: Colors.lime }}
            thumbColor={Colors.surface}
            ios_backgroundColor={Colors.borderDefault}
            accessibilityLabel="Simulate offline mode"
            accessibilityHint="Treats the device as offline so orders are queued locally"
          />
        </View>
      </View>

      <View style={styles.card}>
        <Text style={styles.sectionLabel}>Pending sync</Text>

        <View style={styles.statRow}>
          <Text style={styles.statLabel}>Waiting to sync</Text>
          <Text style={styles.statValue}>{unsynced.length}</Text>
        </View>
        {failed.length > 0 ? (
          <View style={styles.statRow}>
            <Text style={[styles.statLabel, styles.statLabelError]}>Failed</Text>
            <Text style={[styles.statValue, styles.statValueError]}>{failed.length}</Text>
          </View>
        ) : null}
        <View style={styles.statRow}>
          <Text style={styles.statLabel}>Synced on this device</Text>
          <Text style={styles.statValue}>{syncedCount}</Text>
        </View>

        {lastRunAt ? (
          <Text style={styles.lastRun}>
            Last sync {new Date(lastRunAt).toLocaleTimeString()} —{' '}
            {lastOutcome
              ? `${lastOutcome.synced} sent${lastOutcome.failed > 0 ? `, ${lastOutcome.failed} failed` : ''}${
                  lastOutcome.interrupted ? ', interrupted' : ''
                }`
              : 'no result'}
          </Text>
        ) : null}

        <Button
          label={isSyncing ? 'Syncing…' : 'Sync now'}
          onPress={() => void syncQueue()}
          loading={isSyncing}
          disabled={offline || unsynced.length === 0}
          accessibilityHint={
            offline
              ? 'Unavailable while offline'
              : 'Sends orders saved on this device to the server'
          }
        />

        {failed.length > 0 ? (
          <Button
            label={`Retry ${failed.length} failed`}
            variant="secondary"
            onPress={() => {
              for (const ticket of failed) retry(ticket.clientTicketId);
              void syncQueue();
            }}
          />
        ) : null}

        {syncedCount > 0 ? (
          <Button
            label="Clear synced history"
            variant="secondary"
            onPress={clearSynced}
            accessibilityHint="Removes already-synced orders from this device's list"
          />
        ) : null}
      </View>

      <View style={styles.card}>
        <Text style={styles.sectionLabel}>Backend</Text>
        <Text style={styles.mono} selectable>
          {API_URL}
        </Text>
      </View>
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
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  statusText: { flex: 1, gap: 2 },
  statusTitle: { ...TypeScale.h3, color: Colors.textPrimary },
  statusBody: { ...TypeScale.bodySmall, color: Colors.textMuted },
  toggleRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  toggleText: { flex: 1, gap: 2 },
  toggleTitle: { ...TypeScale.bodyLarge, color: Colors.textPrimary },
  toggleBody: { ...TypeScale.bodySmall, color: Colors.textMuted },
  statRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  statLabel: { ...TypeScale.body, color: Colors.textMuted },
  statLabelError: { color: Colors.errorText },
  statValue: { ...TypeScale.amountLarge, color: Colors.textPrimary },
  statValueError: { color: Colors.errorText },
  lastRun: { ...TypeScale.bodySmall, color: Colors.textMuted },
  mono: { ...TypeScale.amount, color: Colors.textPrimary },
});
