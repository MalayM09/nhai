/**
 * App root.
 *
 * 1. WARMUP: load all three TFLite models and run one dummy forward pass each
 *    so TFLite delegates (NNAPI / CoreML) are initialised before the user's
 *    first real inference. Controlled by WARMUP_ON_SPLASH.
 * 2. DB INIT: create SQLite tables on first launch (idempotent).
 * 3. NAVIGATION: simple state-based routing — Home → Enroll / Scan → Home.
 */

import React, {useEffect, useRef, useState} from 'react';
import {ActivityIndicator, StyleSheet, Text, View} from 'react-native';
import {useTensorflowModel} from 'react-native-fast-tflite';

import HomeScreen from './src/screens/HomeScreen';
import EnrollmentScreen from './src/screens/EnrollmentScreen';
import ScanScreen from './src/screens/ScanScreen';
import {initDatabase} from './src/db/database';
import {WARMUP_ON_SPLASH} from './src/constants/thresholds';

type AppState = 'warming_up' | 'ready' | 'error';
type Screen = 'home' | 'enroll' | 'scan';

export default function App(): React.JSX.Element {
  const [appState, setAppState] = useState<AppState>('warming_up');
  const [screen, setScreen] = useState<Screen>('home');
  const [warmupMessage, setWarmupMessage] = useState('Initialising…');

  // Load all models during splash so TFLite delegates are hot before first use
  const blazeface = useTensorflowModel(
    require('./assets/models/blazeface.tflite'),
  );
  const facemesh = useTensorflowModel(
    require('./assets/models/facemesh.tflite'),
  );
  const shufflenet = useTensorflowModel(
    require('./assets/models/shufflenet_liveness.tflite'),
  );
  const mobilefacenet = useTensorflowModel(
    require('./assets/models/mobilefacenet.tflite'),
  );
  const mobilefacenetAdapter = useTensorflowModel(
    require('./assets/models/mobilefacenet_adapter.tflite'),
  );

  // Guard so warmup only runs once even if the effect re-fires
  const warmupRan = useRef(false);

  useEffect(() => {
    try {
      initDatabase();
    } catch (e) {
      console.error('DB init failed:', e);
      setAppState('error');
      return;
    }

    if (!WARMUP_ON_SPLASH) {
      setAppState('ready');
      return;
    }

    const allLoaded =
      blazeface.state === 'loaded' &&
      facemesh.state === 'loaded' &&
      shufflenet.state === 'loaded' &&
      mobilefacenet.state === 'loaded' &&
      mobilefacenetAdapter.state === 'loaded';

    if (!allLoaded || warmupRan.current) return;
    warmupRan.current = true;

    setWarmupMessage('Running warmup…');

    try {
      // One dummy forward pass per model to amortise delegate init cost.
      // runSync is safe here — we're not in a Reanimated worklet.
      blazeface.model?.runSync([new Float32Array(1 * 128 * 128 * 3)]);
      facemesh.model?.runSync([new Float32Array(1 * 192 * 192 * 3)]);
      shufflenet.model?.runSync([new Float32Array(1 * 112 * 112 * 3)]);
      const warmupEmbedding = mobilefacenet.model?.runSync([new Float32Array(1 * 112 * 112 * 3)]);
      if (warmupEmbedding) {
        mobilefacenetAdapter.model?.runSync([new Float32Array(warmupEmbedding[0] as Float32Array)]);
      }
    } catch (e) {
      // Non-fatal: warmup failure means the first real inference is slower
      console.warn('Model warmup failed (non-fatal):', e);
    }

    setAppState('ready');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blazeface.state, facemesh.state, shufflenet.state, mobilefacenet.state, mobilefacenetAdapter.state]);

  // ---- Splash screen ----
  if (appState === 'warming_up') {
    return (
      <View style={styles.splash}>
        <View style={styles.splashLogo}>
          <Text style={styles.splashLogoLetter}>N</Text>
        </View>
        <Text style={styles.splashTitle}>NHAI Biometric</Text>
        <ActivityIndicator color="#4c7ef3" style={styles.spinner} size="large" />
        <Text style={styles.splashSub}>{warmupMessage}</Text>
      </View>
    );
  }

  if (appState === 'error') {
    return (
      <View style={styles.splash}>
        <Text style={styles.splashTitle}>NHAI Biometric</Text>
        <Text style={[styles.splashSub, {color: '#ef5350'}]}>
          Failed to initialise database. Please restart the app.
        </Text>
      </View>
    );
  }

  // ---- Screen routing ----
  if (screen === 'enroll') {
    return <EnrollmentScreen goBack={() => setScreen('home')} />;
  }

  if (screen === 'scan') {
    return <ScanScreen goBack={() => setScreen('home')} />;
  }

  return <HomeScreen navigate={setScreen} />;
}

const styles = StyleSheet.create({
  splash: {
    flex: 1,
    backgroundColor: '#0d1117',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 14,
  },
  splashLogo: {
    width: 64,
    height: 64,
    borderRadius: 16,
    backgroundColor: '#1a237e',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 4,
  },
  splashLogoLetter: {
    color: '#fff',
    fontSize: 30,
    fontWeight: '800',
  },
  splashTitle: {
    color: '#ffffff',
    fontSize: 24,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  spinner: {
    marginVertical: 6,
  },
  splashSub: {
    color: '#6b7280',
    fontSize: 13,
    letterSpacing: 0.3,
  },
});
