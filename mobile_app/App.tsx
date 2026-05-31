/**
 * App root — handles:
 *  1. MODEL WARMUP on splash: one dummy forward pass per .tflite model
 *     before the user sees anything. Without this, the first user-facing
 *     inference is 2–3× slower (TFLite delegate initialises lazily) and
 *     the demo looks broken. Controlled by WARMUP_ON_SPLASH in thresholds.
 *  2. Database initialisation (creates tables if absent).
 *  3. Renders ScanScreen once warmup is complete.
 */

import React, {useEffect, useState} from 'react';
import {ActivityIndicator, StyleSheet, Text, View} from 'react-native';
import {useTensorflowModel} from 'react-native-fast-tflite';

import ScanScreen from './src/screens/ScanScreen';
import {initDatabase} from './src/db/database';
import {WARMUP_ON_SPLASH} from './src/constants/thresholds';

type AppState = 'warming_up' | 'ready' | 'error';

export default function App(): React.JSX.Element {
  const [appState, setAppState] = useState<AppState>('warming_up');
  const [warmupMessage, setWarmupMessage] = useState('Initialising…');

  // Load all three models so their TFLite delegates (NNAPI/CoreML) initialise now.
  const blazeface = useTensorflowModel(
    require('./assets/models/blazeface_dummy.tflite'),
  );
  const shufflenet = useTensorflowModel(
    require('./assets/models/shufflenet_dummy.tflite'),
  );
  const mobilefacenet = useTensorflowModel(
    require('./assets/models/mobilefacenet_dummy.tflite'),
  );

  useEffect(() => {
    // Initialise SQLite tables (idempotent — safe to run on every launch)
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

    // Wait for all three models to load then run a dummy forward pass on each.
    const allLoaded =
      blazeface.state === 'loaded' &&
      shufflenet.state === 'loaded' &&
      mobilefacenet.state === 'loaded';

    if (!allLoaded) return; // re-fires when state changes via the dependency array

    setWarmupMessage('Running warmup…');
    runModelWarmup();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blazeface.state, shufflenet.state, mobilefacenet.state]);

  function runModelWarmup(): void {
    try {
      // BlazeFace: [1, 128, 128, 3] — input normalised to [-1, 1]
      blazeface.model?.run([new Float32Array(1 * 128 * 128 * 3)]);
      // ShuffleNet: [1, 112, 112, 3] — input normalised to [0, 1]
      shufflenet.model?.run([new Float32Array(1 * 112 * 112 * 3)]);
      // MobileFaceNet: [1, 112, 112, 3] — input normalised to [-1, 1]
      mobilefacenet.model?.run([new Float32Array(1 * 112 * 112 * 3)]);
    } catch (e) {
      // Non-fatal: warmup failure means the first real inference is slower,
      // not that the app is broken.
      console.warn('Model warmup failed (non-fatal):', e);
    }
    setAppState('ready');
  }

  if (appState === 'warming_up') {
    return (
      <View style={styles.splash}>
        <Text style={styles.splashTitle}>NHAI Biometric</Text>
        <ActivityIndicator color="#fff" style={styles.spinner} size="large" />
        <Text style={styles.splashSub}>{warmupMessage}</Text>
      </View>
    );
  }

  if (appState === 'error') {
    return (
      <View style={styles.splash}>
        <Text style={styles.splashTitle}>NHAI Biometric</Text>
        <Text style={[styles.splashSub, {color: '#ef5350'}]}>
          Failed to initialise database. Restart the app.
        </Text>
      </View>
    );
  }

  return <ScanScreen />;
}

const styles = StyleSheet.create({
  splash: {
    flex: 1,
    backgroundColor: '#0d1117',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 16,
  },
  splashTitle: {
    color: '#ffffff',
    fontSize: 26,
    fontWeight: '700',
    letterSpacing: 1,
  },
  spinner: {
    marginVertical: 8,
  },
  splashSub: {
    color: '#aaa',
    fontSize: 14,
    letterSpacing: 0.5,
  },
});
