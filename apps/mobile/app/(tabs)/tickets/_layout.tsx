import { Stack } from 'expo-router';
import { Colors, TypeScale } from '../../../src/theme';

export default function TicketsLayout() {
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: Colors.background },
        headerTintColor: Colors.espresso,
        headerTitleStyle: TypeScale.label,
        headerShadowVisible: false,
        contentStyle: { backgroundColor: Colors.background },
      }}
    >
      <Stack.Screen name="index" options={{ title: 'Tickets' }} />
      <Stack.Screen name="[id]" options={{ title: 'Ticket' }} />
    </Stack>
  );
}
