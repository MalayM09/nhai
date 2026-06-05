/**
 * ScanScreen — attendance verification.
 *
 * Phase 3 flow:
 *   1. User taps "Start Scan" → frame processor activates.
 *   2. BlazeFace detects face → FaceMesh extracts landmarks → LivenessGate picks
 *      a challenge (Blink / Smile / Turn Left / Right) and shows it in the UI.
 *   3. User completes challenge → gate transitions to GATE_1_PASSED.
 *   4. The next camera frame is captured and preprocessed:
 *        - Gate 2: ShuffleNet liveness [1,112,112,3] [0,1]
 *        - Gate 3: MobileFaceNet backbone → adapter → L2-normalize → cosine match
 *   5. Result: Verified (name) or Not Recognised.
 *
 * Phase 4: add face-crop affine alignment (eyes horizontal) before embedding.
 */

import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {
  Alert,
  Animated,
  Linking,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import {
  Camera,
  useCameraDevice,
  useCameraPermission,
  useFrameProcessor,
} from 'react-native-vision-camera';
import {useTensorflowModel} from 'react-native-fast-tflite';
import {Worklets, useSharedValue} from 'react-native-worklets-core';

import {
  MATCH_THRESHOLD_VALUE,
  LIVENESS_SPOOF_REJECT_PROB,
} from '../constants/thresholds';
import {
  LivenessGate,
  DEFAULT_THRESHOLDS,
  type Challenge,
} from '../liveness/gate';
import {reshapeFaceMeshOutput} from '../heuristics/landmarks';
import {resizeRgbToModelInput} from '../utils/frameUtils';
import {findBestMatch, l2Normalize} from '../utils/embeddingUtils';
import {loadAllUsers, UserRecord, logAttendance} from '../db/database';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ScanState =
  | 'ready' // idle — "Start Scan" button shown
  | 'positioning' // frame processor active — waiting for face in oval
  | 'challenge' // gate CHALLENGED — show prompt, user performing action
  | 'detecting' // gate passed — running identity models
  | 'verified'
  | 'failed'
  | 'no_workers';

const BLAZEFACE_SCORE_THRESHOLD = 0.6;

interface Props {
  goBack: () => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function ScanScreen({goBack}: Props): React.JSX.Element {
  const {hasPermission, requestPermission} = useCameraPermission();
  const device = useCameraDevice('front');

  const [scanState, setScanState] = useState<ScanState>('ready');
  const [statusMessage, setStatusMessage] = useState('Ready to Scan');
  const [activeChallenge, setActiveChallenge] = useState<Challenge | null>(
    null,
  );
  const [verifiedName, setVerifiedName] = useState('');

  // Keep a ref so worklet callbacks don't read stale state
  const scanStateRef = useRef<ScanState>('ready');
  const setScanStateBoth = useCallback((s: ScanState) => {
    scanStateRef.current = s;
    setScanState(s);
  }, []);

  const storedUsers = useRef<UserRecord[]>([]);
  const gateRef = useRef(new LivenessGate());

  // Shared values accessible from the worklet
  const gateActive = useSharedValue(false);
  const captureNextFrame = useSharedValue(false);
  const isChallengeSV = useSharedValue(false); // drives throttle
  const frameCount = useSharedValue(0);

  // Countdown bar (visual only — gate has its own 8 s timeout)
  const countdownAnim = useRef(new Animated.Value(1)).current;
  const countdownAnimRef = useRef<Animated.CompositeAnimation | null>(null);
  const challengeStarted = useRef(false);

  // ---------------------------------------------------------------------------
  // Models
  // ---------------------------------------------------------------------------

  const blazeface = useTensorflowModel(
    require('../../assets/models/blazeface.tflite'),
  );
  const facemesh = useTensorflowModel(
    require('../../assets/models/facemesh.tflite'),
  );
  const shufflenet = useTensorflowModel(
    require('../../assets/models/shufflenet_liveness.tflite'),
  );
  const mobilefacenet = useTensorflowModel(
    require('../../assets/models/mobilefacenet.tflite'),
  );
  const mobilefacenetAdapter = useTensorflowModel(
    require('../../assets/models/mobilefacenet_adapter.tflite'),
  );

  // ---------------------------------------------------------------------------
  // Init
  // ---------------------------------------------------------------------------

  useEffect(() => {
    if (!hasPermission) {
      requestPermission();
    }
  }, [hasPermission, requestPermission]);

  useEffect(() => {
    const users = loadAllUsers();
    storedUsers.current = users;
    if (users.length === 0) {
      setScanStateBoth('no_workers');
      setStatusMessage('No workers enrolled yet');
    }
  }, [setScanStateBoth]);

  // ---------------------------------------------------------------------------
  // Identity model inference (runs on React thread after gate passes)
  // ---------------------------------------------------------------------------

  // Called from worklet with the normalized embedding or a spoof flag
  const onDetectionResult = useCallback(
    (spoofFailed: boolean, embedding: number[] | null) => {
      if (spoofFailed) {
        setScanStateBoth('failed');
        setStatusMessage('Liveness check failed. Try again.');
        scheduleReset();
        return;
      }
      if (!embedding) return;
      try {
        const normalized = new Float32Array(embedding);
        const match = findBestMatch(
          normalized,
          storedUsers.current.map(u => ({userId: u.id, embedding: u.embedding})),
          MATCH_THRESHOLD_VALUE,
        );
        if (match) {
          const user = storedUsers.current.find(u => u.id === match.userId);
          const displayName = user?.name ?? match.userId;
          setVerifiedName(displayName);
          setStatusMessage(`Verified — ${displayName}`);
          setScanStateBoth('verified');
          logAttendance({
            id: `${match.userId}_${Date.now()}`,
            userId: match.userId,
            timestampWall: Date.now(),
            timestampMonotonic: Date.now(),
          });
        } else {
          setScanStateBoth('failed');
          setStatusMessage('Not recognised. Try again.');
          scheduleReset();
        }
      } catch {
        setScanStateBoth('failed');
        setStatusMessage('Detection error. Try again.');
        scheduleReset();
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  // ---------------------------------------------------------------------------
  // Frame update callback — called from worklet via runOnJS
  // ---------------------------------------------------------------------------

  const onFrameUpdate = useCallback(
    (rawLandmarksArr: number[] | null, presenceLogit: number | null) => {
      const rawLandmarks = rawLandmarksArr ? new Float32Array(rawLandmarksArr) : null;
      if (
        scanStateRef.current !== 'positioning' &&
        scanStateRef.current !== 'challenge'
      ) {
        return;
      }

      // Reshape FaceMesh [1,1,1,1404] flat output → 468 Point3D
      const landmarks =
        rawLandmarks && rawLandmarks.length >= 1404
          ? reshapeFaceMeshOutput(rawLandmarks.slice(0, 1404) as Float32Array)
          : null;

      const result = gateRef.current.onFrame(landmarks, presenceLogit);

      if (result.state === 'CHALLENGED') {
        if (scanStateRef.current !== 'challenge') {
          setScanStateBoth('challenge');
          isChallengeSV.value = true;
        }
        if (result.prompt) {
          setStatusMessage(result.prompt);
          setActiveChallenge(result.currentChallenge);
        }
        // Start countdown bar once per challenge session
        if (!challengeStarted.current) {
          challengeStarted.current = true;
          countdownAnim.setValue(1);
          countdownAnimRef.current = Animated.timing(countdownAnim, {
            toValue: 0,
            duration: DEFAULT_THRESHOLDS.challengeTimeoutMs,
            useNativeDriver: false,
          });
          countdownAnimRef.current.start();
        }
      } else if (result.state === 'GATE_1_PASSED') {
        countdownAnimRef.current?.stop();
        gateActive.value = false;
        captureNextFrame.value = true; // worklet will grab the next frame
        setScanStateBoth('detecting');
        setStatusMessage('Verifying identity…');
        setActiveChallenge(null);
      } else if (result.state === 'FAILED') {
        countdownAnimRef.current?.stop();
        gateActive.value = false;
        setScanStateBoth('failed');
        setStatusMessage('Challenge timed out. Try again.');
        setActiveChallenge(null);
        scheduleReset();
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [gateActive, captureNextFrame, isChallengeSV, countdownAnim],
  );

  // worklets-core JS-thread callbacks — safe to call from vision-camera worklet context
  const jsFrameUpdate = useMemo(
    () => Worklets.createRunOnJS(onFrameUpdate),
    [onFrameUpdate],
  );
  const jsDetectionResult = useMemo(
    () => Worklets.createRunOnJS(onDetectionResult),
    [onDetectionResult],
  );

  // ---------------------------------------------------------------------------
  // Frame processor (JSI worklet — runs on camera thread)
  // ---------------------------------------------------------------------------

  const frameProcessor = useFrameProcessor(
    frame => {
      'worklet';

      // --- Capture path: gate passed, run all inference in worklet ---
      if (captureNextFrame.value) {
        captureNextFrame.value = false;
        if (!shufflenet.model || !mobilefacenet.model || !mobilefacenetAdapter.model) return;

        const buf = frame.toArrayBuffer();

        // Gate 2: ShuffleNet liveness
        const livenessInput = resizeRgbToModelInput(buf, frame.width, frame.height, 112, 112, 'zero_to_1');
        const livenessOut = shufflenet.model.runSync([livenessInput]);
        const spoofProb = (livenessOut[0] as Float32Array)[1] ?? 0;
        if (spoofProb > LIVENESS_SPOOF_REJECT_PROB) {
          jsDetectionResult(true, null);
          return;
        }

        // Gate 3: MobileFaceNet + adapter
        const embInput = resizeRgbToModelInput(buf, frame.width, frame.height, 112, 112, 'minus1_to_1');
        const backboneOut = mobilefacenet.model.runSync([embInput]);
        const rawEmb = new Float32Array(backboneOut[0] as Float32Array);
        const adapterOut = mobilefacenetAdapter.model.runSync([rawEmb]);
        const normalized = l2Normalize(new Float32Array(adapterOut[0] as Float32Array));
        jsDetectionResult(false, Array.from(normalized));
        return;
      }

      if (!gateActive.value) {
        return;
      }

      // Throttle: 10 fps idle (every 3rd frame at 30 fps camera),
      //           30 fps during active challenge (every frame)
      frameCount.value += 1;
      const interval = isChallengeSV.value ? 1 : 3;
      if (frameCount.value % interval !== 0) {
        return;
      }

      if (!blazeface.model || !facemesh.model) {
        return;
      }

      const detectBuf = frame.toArrayBuffer();

      // --- BlazeFace: detect face presence ([1,128,128,3] [-1,1]) ---
      const bfInput = resizeRgbToModelInput(detectBuf, frame.width, frame.height, 128, 128, 'minus1_to_1');
      const bfOut = blazeface.model.runSync([bfInput]);
      const scores = bfOut[1] as Float32Array; // [1,896,1]
      let hasFace = false;
      for (let i = 0; i < scores.length; i++) {
        // inline sigmoid
        if (1 / (1 + Math.exp(-scores[i])) > BLAZEFACE_SCORE_THRESHOLD) {
          hasFace = true;
          break;
        }
      }

      if (!hasFace) {
        jsFrameUpdate(null, null);
        return;
      }

      // --- FaceMesh: extract landmarks ([1,192,192,3] [0,1]) ---
      const fmInput = resizeRgbToModelInput(detectBuf, frame.width, frame.height, 192, 192, 'zero_to_1');
      const fmOut = facemesh.model.runSync([fmInput]);
      const rawLandmarks = fmOut[0] as Float32Array; // [1,1,1,1404]
      const presenceLogit = (fmOut[1] as Float32Array)[0]; // scalar

      jsFrameUpdate(Array.from(rawLandmarks), presenceLogit);
    },
    [
      blazeface.model,
      facemesh.model,
      shufflenet.model,
      mobilefacenet.model,
      mobilefacenetAdapter.model,
      jsFrameUpdate,
      jsDetectionResult,
      gateActive,
      captureNextFrame,
      isChallengeSV,
      frameCount,
    ],
  );

  // ---------------------------------------------------------------------------
  // Scan control
  // ---------------------------------------------------------------------------

  const scheduleReset = useCallback(() => {
    setTimeout(() => {
      gateRef.current.reset();
      challengeStarted.current = false;
      isChallengeSV.value = false;
      setScanStateBoth('ready');
      setStatusMessage('Ready to Scan');
      setActiveChallenge(null);
      setVerifiedName('');
    }, 2500);
  }, [isChallengeSV, setScanStateBoth]);

  const startScan = useCallback(() => {
    const modelsReady =
      blazeface.state === 'loaded' &&
      facemesh.state === 'loaded' &&
      shufflenet.state === 'loaded' &&
      mobilefacenet.state === 'loaded' &&
      mobilefacenetAdapter.state === 'loaded';

    if (scanState !== 'ready' || !modelsReady) {
      if (!modelsReady) {
        Alert.alert('Loading', 'Models are still loading, please wait.');
      }
      return;
    }

    gateRef.current.reset();
    challengeStarted.current = false;
    gateActive.value = true;
    isChallengeSV.value = false;
    frameCount.value = 0;
    setScanStateBoth('positioning');
    setStatusMessage('Position your face in the oval…');
  }, [
    scanState,
    blazeface.state,
    facemesh.state,
    shufflenet.state,
    mobilefacenet.state,
    mobilefacenetAdapter.state,
    gateActive,
    isChallengeSV,
    frameCount,
    setScanStateBoth,
  ]);

  const resetScan = useCallback(() => {
    countdownAnimRef.current?.stop();
    gateActive.value = false;
    captureNextFrame.value = false;
    gateRef.current.reset();
    challengeStarted.current = false;
    isChallengeSV.value = false;
    setScanStateBoth('ready');
    setStatusMessage('Ready to Scan');
    setActiveChallenge(null);
    setVerifiedName('');
  }, [gateActive, captureNextFrame, isChallengeSV, setScanStateBoth]);

  // ---------------------------------------------------------------------------
  // Permission / device guards
  // ---------------------------------------------------------------------------

  if (!hasPermission) {
    return (
      <View style={styles.center}>
        <Text style={styles.errorText}>Camera permission required.</Text>
        <TouchableOpacity
          style={styles.textBtn}
          onPress={() => Linking.openSettings()}>
          <Text style={styles.textBtnLabel}>Open Settings</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (!device) {
    return (
      <View style={styles.center}>
        <Text style={styles.errorText}>No front camera found.</Text>
      </View>
    );
  }

  // ---------------------------------------------------------------------------
  // Derived UI
  // ---------------------------------------------------------------------------

  const dotColor =
    scanState === 'verified'
      ? '#2e7d32'
      : scanState === 'failed'
      ? '#c62828'
      : scanState === 'challenge'
      ? '#f9a825'
      : scanState === 'detecting'
      ? '#1565c0'
      : '#374151';

  const modelsLoading =
    blazeface.state === 'loading' ||
    facemesh.state === 'loading' ||
    shufflenet.state === 'loading' ||
    mobilefacenet.state === 'loading' ||
    mobilefacenetAdapter.state === 'loading';

  const cameraActive = scanState !== 'verified' && scanState !== 'failed';

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <View style={styles.container}>
      <TouchableOpacity style={styles.backBtn} onPress={goBack}>
        <Text style={styles.backBtnText}>← Back</Text>
      </TouchableOpacity>

      <Camera
        style={StyleSheet.absoluteFill}
        device={device}
        isActive={cameraActive}
        pixelFormat="rgb"
        frameProcessor={
          scanState === 'positioning' ||
          scanState === 'challenge' ||
          scanState === 'detecting'
            ? frameProcessor
            : undefined
        }
        photo={false}
        video={false}
        audio={false}
      />

      <View style={styles.overlay} />
      <View style={styles.ovalGuide} />

      <View style={styles.card}>
        <View style={[styles.statusDot, {backgroundColor: dotColor}]} />

        <Text style={styles.statusText}>{statusMessage}</Text>

        {/* Countdown bar — visible during challenge */}
        {scanState === 'challenge' && (
          <View style={styles.progressTrack}>
            <Animated.View
              style={[
                styles.progressFill,
                {
                  width: countdownAnim.interpolate({
                    inputRange: [0, 1],
                    outputRange: ['0%', '100%'],
                  }),
                },
              ]}
            />
          </View>
        )}

        {scanState === 'detecting' && (
          <Text style={styles.hintText}>Running biometric check…</Text>
        )}

        {scanState === 'positioning' && (
          <Text style={styles.hintText}>
            Move closer if the challenge doesn't appear
          </Text>
        )}

        {scanState === 'verified' && verifiedName ? (
          <Text style={styles.verifiedName}>{verifiedName}</Text>
        ) : null}

        {modelsLoading && scanState === 'ready' && (
          <Text style={styles.hintText}>Loading models…</Text>
        )}

        {(scanState === 'ready' || scanState === 'positioning') && (
          <TouchableOpacity
            style={[
              styles.actionBtn,
              (modelsLoading || scanState === 'positioning') &&
                styles.btnDisabled,
            ]}
            activeOpacity={0.85}
            onPress={startScan}
            disabled={modelsLoading || scanState === 'positioning'}>
            <Text style={styles.actionBtnText}>
              {scanState === 'positioning' ? 'Waiting for face…' : 'Start Scan'}
            </Text>
          </TouchableOpacity>
        )}

        {scanState === 'no_workers' && (
          <Text style={styles.hintText}>
            Enroll workers from the home screen first.
          </Text>
        )}

        {scanState === 'verified' && (
          <TouchableOpacity
            style={styles.actionBtn}
            activeOpacity={0.85}
            onPress={resetScan}>
            <Text style={styles.actionBtnText}>Scan Another</Text>
          </TouchableOpacity>
        )}

        {scanState === 'challenge' && (
          <TouchableOpacity
            style={styles.cancelBtn}
            activeOpacity={0.85}
            onPress={resetScan}>
            <Text style={styles.cancelBtnText}>Cancel</Text>
          </TouchableOpacity>
        )}

        {scanState === 'failed' && (
          <Text style={styles.hintText}>Resetting…</Text>
        )}
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0d1117',
    justifyContent: 'flex-end',
    alignItems: 'center',
  },
  center: {
    flex: 1,
    backgroundColor: '#0d1117',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 16,
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.40)',
  },
  backBtn: {
    position: 'absolute',
    top: 56,
    left: 20,
    zIndex: 10,
    backgroundColor: 'rgba(0,0,0,0.5)',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
  },
  backBtnText: {color: '#ffffff', fontSize: 14, fontWeight: '500'},
  ovalGuide: {
    position: 'absolute',
    top: '18%',
    alignSelf: 'center',
    width: '55%',
    aspectRatio: 0.75,
    borderRadius: 999,
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.35)',
  },
  card: {
    width: '90%',
    backgroundColor: 'rgba(255,255,255,0.97)',
    borderRadius: 16,
    padding: 24,
    marginBottom: 48,
    alignItems: 'center',
    gap: 10,
    shadowColor: '#000',
    shadowOffset: {width: 0, height: 6},
    shadowOpacity: 0.2,
    shadowRadius: 12,
    elevation: 8,
  },
  statusDot: {width: 10, height: 10, borderRadius: 5},
  statusText: {
    fontSize: 18,
    fontWeight: '700',
    color: '#1a1a2e',
    letterSpacing: 0.2,
    textAlign: 'center',
  },
  verifiedName: {fontSize: 15, color: '#2e7d32', fontWeight: '600'},
  hintText: {fontSize: 13, color: '#6b7280', textAlign: 'center'},
  progressTrack: {
    width: '100%',
    height: 4,
    backgroundColor: '#e5e7eb',
    borderRadius: 2,
    overflow: 'hidden',
  },
  progressFill: {height: 4, backgroundColor: '#f9a825', borderRadius: 2},
  actionBtn: {
    marginTop: 4,
    backgroundColor: '#1a237e',
    paddingHorizontal: 32,
    paddingVertical: 13,
    borderRadius: 10,
    width: '100%',
    alignItems: 'center',
  },
  actionBtnText: {color: '#ffffff', fontWeight: '700', fontSize: 15},
  cancelBtn: {
    marginTop: 4,
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: '#c62828',
    paddingHorizontal: 32,
    paddingVertical: 11,
    borderRadius: 10,
    width: '100%',
    alignItems: 'center',
  },
  cancelBtnText: {color: '#c62828', fontWeight: '600', fontSize: 14},
  btnDisabled: {opacity: 0.45},
  errorText: {color: '#ef5350', fontSize: 16},
  textBtn: {
    backgroundColor: '#1a237e',
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 8,
  },
  textBtnLabel: {color: '#fff', fontWeight: '600', fontSize: 15},
});
