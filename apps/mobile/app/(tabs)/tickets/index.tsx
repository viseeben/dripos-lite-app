import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Colors, Radius, Spacing, TypeScale } from '../../../src/theme';
import { formatCents } from '../../../src/lib/money';
import { errorMessage } from '../../../src/lib/api';
import { useTickets } from '../../../src/lib/queries';
import { EmptyState, ErrorState, LoadingState } from '../../../src/components/States';
import { StatusBadge } from '../../../src/components/StatusBadge';
import type { TicketSummary } from '../../../src/types/api';

export default function TicketListScreen() {
  const router = useRouter();
  const { data, isPending, isError, error, refetch, isRefetching } = useTickets();

  if (isPending) return <LoadingState message="Loading tickets…" />;
  if (isError) return <ErrorState message={errorMessage(error)} onRetry={() => void refetch()} />;
  if (data.tickets.length === 0) {
    return <EmptyState icon="file-text" title="No tickets yet" body="Completed orders show up here." />;
  }

  return (
    <FlatList
      data={data.tickets}
      keyExtractor={(ticket) => ticket.id}
      contentContainerStyle={styles.list}
      refreshControl={
        <RefreshControl
          refreshing={isRefetching}
          onRefresh={() => void refetch()}
          tintColor={Colors.espresso}
        />
      }
      renderItem={({ item }) => (
        <TicketRow ticket={item} onPress={() => router.push(`/tickets/${item.id}`)} />
      )}
    />
  );
}

function TicketRow({ ticket, onPress }: { ticket: TicketSummary; onPress: () => void }) {
  const when = new Date(ticket.createdAt).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
  const shortId = ticket.id.slice(-8).toUpperCase();

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Ticket ${shortId}, ${when}, ${ticket.status}, ${formatCents(ticket.totalCents)}`}
      style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
    >
      <View style={styles.rowLeft}>
        <Text style={styles.id}>#{shortId}</Text>
        <Text style={styles.when}>{when}</Text>
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
  rowPressed: { opacity: 0.7 },
  rowLeft: { gap: 2, flex: 1 },
  rowRight: { alignItems: 'flex-end', gap: Spacing.sm },
  id: { ...TypeScale.labelSmall, color: Colors.textMuted },
  when: { ...TypeScale.body, color: Colors.textPrimary },
  count: { ...TypeScale.bodySmall, color: Colors.textMuted },
  total: { ...TypeScale.amount, color: Colors.textPrimary },
});
