import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { Colors, IconSize, Spacing, TypeScale } from '../theme';
import { Button } from './Button';

/** Full-screen states shared by every data-fetching screen. */

export function LoadingState({ message }: { message: string }) {
  return (
    <View style={styles.center} accessibilityRole="progressbar" accessibilityLabel={message}>
      <ActivityIndicator size="large" color={Colors.espresso} />
      <Text style={styles.message}>{message}</Text>
    </View>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <View style={styles.center}>
      <View style={styles.errorCard}>
        <Feather name="alert-circle" size={IconSize.xl} color={Colors.errorText} />
        <Text style={styles.errorText} accessibilityRole="alert">
          {message}
        </Text>
      </View>
      {onRetry ? <Button label="Try again" onPress={onRetry} style={styles.retry} /> : null}
    </View>
  );
}

export function EmptyState({
  icon,
  title,
  body,
  action,
}: {
  icon: keyof typeof Feather.glyphMap;
  title: string;
  body?: string;
  action?: { label: string; onPress: () => void };
}) {
  return (
    <View style={styles.center}>
      <Feather name={icon} size={40} color={Colors.textMuted} />
      <Text style={styles.emptyTitle}>{title}</Text>
      {body ? <Text style={styles.message}>{body}</Text> : null}
      {action ? (
        <Button
          label={action.label}
          onPress={action.onPress}
          variant="secondary"
          style={styles.retry}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.xl,
    gap: Spacing.md,
  },
  message: { ...TypeScale.body, color: Colors.textMuted, textAlign: 'center' },
  emptyTitle: { ...TypeScale.h2, color: Colors.textPrimary, textAlign: 'center' },
  errorCard: {
    backgroundColor: Colors.error,
    borderRadius: 12,
    padding: Spacing.lg,
    alignItems: 'center',
    gap: Spacing.sm,
    maxWidth: 340,
  },
  errorText: { ...TypeScale.body, color: Colors.errorText, textAlign: 'center' },
  retry: { marginTop: Spacing.sm, minWidth: 180 },
});
