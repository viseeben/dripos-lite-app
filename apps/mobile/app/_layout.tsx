import { useCallback, useEffect, useState } from 'react';
import { AppState, type AppStateStatus, Platform, View } from 'react-native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import { useFonts } from 'expo-font';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { QueryClient, QueryClientProvider, focusManager } from '@tanstack/react-query';
import {
  PlayfairDisplay_400Regular,
  PlayfairDisplay_500Medium,
} from '@expo-google-fonts/playfair-display';
import { DMSans_400Regular, DMSans_500Medium, DMSans_700Bold } from '@expo-google-fonts/dm-sans';
import { DMMono_400Regular, DMMono_500Medium } from '@expo-google-fonts/dm-mono';
import { Colors, TypeScale } from '../src/theme';

void SplashScreen.preventAutoHideAsync();

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 30_000,
      refetchOnWindowFocus: true,
    },
  },
});

/**
 * React Query's focus tracking is written for the browser. On native it has to
 * be driven from AppState, otherwise `refetchOnWindowFocus` never fires.
 */
function useAppStateFocusManager() {
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (status: AppStateStatus) => {
      if (Platform.OS !== 'web') focusManager.setFocused(status === 'active');
    });
    return () => subscription.remove();
  }, []);
}

export default function RootLayout() {
  useAppStateFocusManager();

  const [fontsLoaded, fontError] = useFonts({
    PlayfairDisplay_400Regular,
    PlayfairDisplay_500Medium,
    DMSans_400Regular,
    DMSans_500Medium,
    DMSans_700Bold,
    DMMono_400Regular,
    DMMono_500Medium,
  });

  const [splashHidden, setSplashHidden] = useState(false);

  const onReady = useCallback(() => {
    // Render even if a font failed: system fallbacks beat a stuck splash screen.
    if ((fontsLoaded || fontError) && !splashHidden) {
      setSplashHidden(true);
      void SplashScreen.hideAsync();
    }
  }, [fontsLoaded, fontError, splashHidden]);

  if (!fontsLoaded && !fontError) return null;

  return (
    <QueryClientProvider client={queryClient}>
      <SafeAreaProvider>
        <View style={{ flex: 1, backgroundColor: Colors.background }} onLayout={onReady}>
          <StatusBar style="dark" />
          <Stack
            screenOptions={{
              headerStyle: { backgroundColor: Colors.background },
              headerTintColor: Colors.espresso,
              headerTitleStyle: TypeScale.label,
              headerShadowVisible: false,
              contentStyle: { backgroundColor: Colors.background },
            }}
          >
            <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
            <Stack.Screen
              name="product/[id]"
              options={{ presentation: 'modal', headerShown: false }}
            />
            <Stack.Screen name="checkout" options={{ title: 'Checkout' }} />
            <Stack.Screen
              name="receipt/[ticketId]"
              options={{ title: 'Receipt', headerBackVisible: false, gestureEnabled: false }}
            />
          </Stack>
        </View>
      </SafeAreaProvider>
    </QueryClientProvider>
  );
}
