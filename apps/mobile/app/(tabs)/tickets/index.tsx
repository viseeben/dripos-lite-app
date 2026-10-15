import { useCallback } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Colors, Radius, Spacing, TypeScale } from '../../../src/theme';
import { formatCents } from '../../../src/lib/money';
import { errorMessage } from '../../../src/lib/api';
import { useTickets } from '../../../src/lib/queries';
import { syncQueue } from '../../../src/lib/sync';
import { useIsOffline } from '../../../src/store/connectivity';
import { selectUnsynced, useQueueStore, type QueuedTicket } from '../../../src/store/queue';
import { EmptyState, ErrorState, LoadingState } from '../../../src/components/States';
import { OfflineBanner } from '../../../src/components/OfflineBanner';
import { StatusBadge } from '../../../src/components/StatusBadge';
import { SyncBadge } from '../../../src/components/SyncBadge';
import type { TicketSummary } from '../../../src/types/api';

/**
 * Rows come from two places: sales still held on this device, and sales the
 * server knows about. Unsynced ones sort first because they are the ones that
 * still need somebody's attention.
 */
type Row =
  | { kind: 'queued'; key: string; ticket: QueuedTicket }
  | { kind: 'server'; key: string; ticket: TicketSummary };

const shortId = (id: string): string => id.slice(-8).toUpperCase();

const when = (iso: string): string =>
  new Date(iso).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });

export default function TicketListScreen() {
  const router = useRouter();
  const offline = useIsOffline();
  const queued = useQueueStore((s) => s.tickets);
  const { data, isPending, isError, error, refetch, isRefetching } = useTickets();

  const unsynced = selectUnsynced(queued);
  const serverTickets = data?.tickets ?? [];

  // A sale that has synced appears in the server list; showing the local copy
  // too would read as a duplicate.
  const syncedIds = new Set(
    queued.filter((t) => t.serverTicketId).map((t) => t.serverTicketId as string),
  );

  const rows: Row[] = [
    ...unsynced.map((ticket) => ({
      kind: 'queued' as const,
      key: ticket.clientTicketId,
      ticket,
    })),
    ...serverTickets.map((ticket) => ({ kind: 'server' as const, key: ticket.id, ticket })),
  ];

  const onRefresh = useCallback(() => {
    void syncQueue().then(() => refetch());
  }, [refetch]);

  if (!offline && isPending) return <LoadingState message="Loading tickets…" />;

  if (!offline && isError && unsynced.length === 0) {
    return <ErrorState message={errorMessage(error)} onRetry={() => void refetch()} />;
  }

  if (rows.length === 0) {
    return (
      <View style={styles.emptyWrap}>
        <OfflineBanner />
        <EmptyState
          icon="file-text"
          title="No tickets yet"
          body={
            offline
              ? 'Completed orders will appear here. You’re offline, so only orders taken on this device are shown.'
              : 'Completed orders show up here.'
          }
        />
      </View>
    );
  }

  return (
    <FlatList
      data={rows}
      keyExtractor={(row) => row.key}
      contentContainerStyle={styles.list}
      ListHeaderComponent={
        <View>
          <OfflineBanner />
          {unsynced.length > 0 ? <Text style={styles.sectionLabel}>On this device</Text> : null}
        </View>
      }
      refreshControl={
        <RefreshControl
          refreshing={isRefetching}
          onRefresh={onRefresh}
          tintColor={Colors.espresso}
        />
      }
      renderItem={({ item, index }) => {
        if (item.kind === 'queued') {
          return (
            <QueuedRow
              ticket={item.ticket}
              onPress={() => router.push(`/receipt/${item.ticket.clientTicketId}`)}
            />
          );
        }
        const firstServerRow = index === unsynced.length;
        return (
          <View>
            {firstServerRow && unsynced.length > 0 ? (
              <Text style={[styles.sectionLabel, styles.sectionLabelSpaced]}>On the server</Text>
            ) : null}
            <ServerRow
              ticket={item.ticket}
              highlighted={syncedIds.has(item.ticket.id)}
              onPress={() => router.push(`/tickets/${item.ticket.id}`)}
            />
          </View>
        );
      }}
    />
  );
}

function QueuedRow({ ticket, onPress }: { ticket: QueuedTicket; onPress: () => void }) {
  const count = ticket.items.reduce((sum, item) => sum + item.quantity, 0);
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Saved ticket ${shortId(ticket.clientTicketId)}, ${when(
        ticket.placedAt,
      )}, ${ticket.status}, ${formatCents(ticket.totalCents)}`}
      style={({ pressed }) => [styles.row, styles.rowQueued, pressed && styles.rowPressed]}
    >
      <View style={styles.rowLeft}>
        <Text style={styles.id}>#{shortId(ticket.clientTicketId)}</Text>
        <Text style={styles.when}>{when(ticket.placedAt)}</Text>
        <Text style={styles.count}>
          {count} item{count === 1 ? '' : 's'}
          {ticket.lastError ? ` · ${ticket.lastError}` : ''}
        </Text>
      </View>
      <View style={styles.rowRight}>
        <Text style={styles.total}>{formatCents(ticket.totalCents)}</Text>
        <SyncBadge status={ticket.status} />
      </View>
    </Pressable>
  );
}

function ServerRow({
  ticket,
  highlighted,
  onPress,
}: {
  ticket: TicketSummary;
  highlighted: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Ticket ${shortId(ticket.id)}, ${when(ticket.createdAt)}, ${
        ticket.status
      }, ${formatCents(ticket.totalCents)}`}
      style={({ pressed }) => [styles.row, highlighted && styles.rowSynced, pressed && styles.rowPressed]}
    >
      <View style={styles.rowLeft}>
        <Text style={styles.id}>#{shortId(ticket.id)}</Text>
        <Text style={styles.when}>{when(ticket.createdAt)}</Text>
        <Text style={styles.count}>
          {ticket.itemCount} item{ticket.itemCount === 1 ? '' : 's'}
        </Text>
      </View>
      <View style={styles.rowRight}>
        <Text style={styles.total}>{formatCents(ticket.totalCents)}</Text>
        <StatusBadge status={ticket.status} />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  list: { padding: Spacing.base, gap: Spacing.md, paddingBottom: Spacing.xxl },
  emptyWrap: { flex: 1, padding: Spacing.base },
  sectionLabel: { ...TypeScale.labelSmall, color: Colors.textMuted, marginBottom: Spacing.xs },
  sectionLabelSpaced: { marginTop: Spacing.md },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: Colors.surface,
    borderRadius: Radius.lg,
    padding: Spacing.base,
    minHeight: 72,
    gap: Spacing.md,
  },
  rowQueued: { borderWidth: 1.5, borderColor: Colors.borderDefault },
  rowSynced: { borderWidth: 1.5, borderColor: Colors.lime },
  rowPressed: { opacity: 0.7 },
  rowLeft: { gap: 2, flex: 1 },
  rowRight: { alignItems: 'flex-end', gap: Spacing.sm },
  id: { ...TypeScale.labelSmall, color: Colors.textMuted },
  when: { ...TypeScale.body, color: Colors.textPrimary },
  count: { ...TypeScale.bodySmall, color: Colors.textMuted },
  total: { ...TypeScale.amount, color: Colors.textPrimary },
});
