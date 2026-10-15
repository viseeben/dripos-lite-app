import { Tabs } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { Colors, FontFamily } from '../../src/theme';
import { useCartLineCount } from '../../src/store/cart';
import { usePendingCount } from '../../src/store/queue';

export default function TabsLayout() {
  const lineCount = useCartLineCount();
  const pendingSync = usePendingCount();

  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: Colors.background },
        headerTintColor: Colors.espresso,
        headerShadowVisible: false,
        headerTitleStyle: {
          fontFamily: FontFamily.mono,
          fontSize: 14,
          letterSpacing: 0.5,
          textTransform: 'uppercase',
        },
        tabBarStyle: { backgroundColor: Colors.espresso, borderTopWidth: 0 },
        tabBarActiveTintColor: Colors.lime,
        tabBarInactiveTintColor: Colors.textOnDark,
        tabBarLabelStyle: { fontFamily: FontFamily.mono, fontSize: 10, letterSpacing: 0.5 },
        tabBarBadgeStyle: {
          backgroundColor: Colors.lime,
          color: Colors.espresso,
          fontFamily: FontFamily.mono,
          fontSize: 11,
        },
        sceneStyle: { backgroundColor: Colors.background },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Menu',
          headerTitle: 'Dripos Lite',
          tabBarIcon: ({ color, size }) => <Feather name="coffee" size={size} color={color} />,
          tabBarAccessibilityLabel: 'Menu',
        }}
      />
      <Tabs.Screen
        name="cart"
        options={{
          title: 'Cart',
          tabBarIcon: ({ color, size }) => <Feather name="shopping-bag" size={size} color={color} />,
          // The badge disappears at zero rather than showing "0".
          tabBarBadge: lineCount > 0 ? lineCount : undefined,
          tabBarAccessibilityLabel:
            lineCount > 0 ? `Cart, ${lineCount} item${lineCount === 1 ? '' : 's'}` : 'Cart, empty',
        }}
      />
      <Tabs.Screen
        name="tickets"
        options={{
          title: 'Tickets',
          headerShown: false,
          tabBarIcon: ({ color, size }) => <Feather name="file-text" size={size} color={color} />,
          // How many sales are still held on this device, visible from anywhere.
          tabBarBadge: pendingSync > 0 ? pendingSync : undefined,
          tabBarAccessibilityLabel:
            pendingSync > 0
              ? `Tickets, ${pendingSync} pending sync`
              : 'Tickets',
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: 'Settings',
          tabBarIcon: ({ color, size }) => <Feather name="settings" size={size} color={color} />,
          tabBarAccessibilityLabel: 'Settings',
        }}
      />
    </Tabs>
  );
}
