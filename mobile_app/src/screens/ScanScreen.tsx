/**
 * ScanScreen — the heart of the app.
 *
 * Responsibilities:
 *  1. Open front camera at 480p.
 *  2. Run a JSI frame processor with ADAPTIVE THROTTLING:
 *       • ~10 fps while idle (no face / waiting).
 *       • ~30 fps during active challenge ("Blink", "Look Left", etc.).
 *       Static frame-skipping is avoided because it can drop the single frame
 *       where the user actually blinks.
 *  3. Load BlazeFace dummy model and run one detection per throttled frame.
 *  4. Drive a status state machine: Ready → Challenge → Detecting → Verified.
 *  5. Display a minimal corporate status card (see UI aesthetic in README).
 *
 * Model warmup happens in App.tsx (splash phase) before this screen mounts.
 * This screen assumes the TFLite delegates are already hot.
 */

import React, {useCallback, useEffect, useRef, useState} from 'react';
import {
  Alert,
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
import {useSharedValue, runOnJS} from 'react-native-reanimated';

import {
  MATCH_THRESHOLD_VALUE,
  THROTTLE_IDLE_FPS,
  THROTTLE_ACTIVE_CHALLENGE_FPS,
} from '../constants/thresholds';
import {
  Challenge,
  EarState,
  FaceLandmarks,
  runGate1,
} from '../utils/gateHeuristics';
import {findBestMatch, l2Normalize} from '../utils/embeddingUtils';
import {loadAllUsers, UserRecord, logAttendance} from '../db/database';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ScanState =
  | 'ready'        // Waiting for user to start
  | 'challenge'    // Active liveness prompt (Blink, Look Left, etc.)
  | 'detecting'    // Gate 1 passed, running ShuffleNet + MobileFaceNet
  | 'verified'     // Match found
  | 'failed';      // No match / spoof detected

const CHALLENGE_PROMPTS: Record<Challenge, string> = {
  blink: 'Blink your eyes',
  smile: 'Smile',
  look_left: 'Look Left',
  look_right: 'Look Right',
};

const CHALLENGES: Challenge[] = ['blink', 'look_left', 'look_right'];

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function ScanScreen(): React.JSX.Element {
  const {hasPermission, requestPermission} = useCameraPermission();
  const device = useCameraDevice('front');

  const [scanState, setScanState] = useState<ScanState>('ready');
  const [statusMessage, setStatusMessage] = useState('Ready to Scan');
  const [activeChallenge, setActiveChallenge] = useState<Challenge | null>(null);

  // Shared values visible inside the Reanimated worklet
  const challengeActive = useSharedValue(false);
  const lastFrameTimestamp = useSharedValue(0);

  // In-memory user embeddings loaded from SQLite
  const storedUsers = useRef<UserRecord[]>([]);

  // EAR state for blink detection (mutable, persists across frames)
  const earState = useRef<EarState>({consecutiveLowFrames: 0});

  // ---------------------------------------------------------------------------
  // Load TFLite models
  // ---------------------------------------------------------------------------

  // BlazeFace: face detection (Gate 0 — always runs)
  const blazeface = useTensorflowModel(
    require('../../assets/models/blazeface_dummy.tflite'),
  );
  // ShuffleNet: passive liveness (Gate 2 — fires only when Gate 1 passes)
  const shufflenet = useTensorflowModel(
    require('../../assets/models/shufflenet_dummy.tflite'),
  );
  // MobileFaceNet: identity embedding (Gate 3)
  const mobilefacenet = useTensorflowModel(
    require('../../assets/models/mobilefacenet_dummy.tflite'),
  );

  // ---------------------------------------------------------------------------
  // Initialise
  // ---------------------------------------------------------------------------

  useEffect(() => {
    // Load embeddings from SQLite into memory for fast cosine matching
    storedUsers.current = loadAllUsers();
  }, []);

  // ---------------------------------------------------------------------------
  // Permission flow
  // ---------------------------------------------------------------------------

  useEffect(() => {
    if (!hasPermission) {
      requestPermission();
    }
  }, [hasPermission, requestPermission]);

  // ---------------------------------------------------------------------------
  // State machine helpers (called from worklet via runOnJS)
  // ---------------------------------------------------------------------------

  const onFaceDetected = useCallback(() => {
    if (scanState === 'ready') {
      const challenge = CHALLENGES[Math.floor(Math.random() * CHALLENGES.length)];
      setActiveChallenge(challenge);
      setStatusMessage(CHALLENGE_PROMPTS[challenge]);
      setScanState('challenge');
      challengeActive.value = true;
      earState.current = {consecutiveLowFrames: 0};
    }
  }, [scanState, challengeActive]);

  const onGate1Passed = useCallback(() => {
    if (scanState === 'challenge') {
      setScanState('detecting');
      setStatusMessage('Detecting…');
      challengeActive.value = false;
    }
  }, [scanState, challengeActive]);

  const onMatchResult = useCallback(
    (matched: boolean, userId?: string) => {
      if (scanState === 'detecting') {
        if (matched && userId) {
          setStatusMessage(`Verified — ${userId}`);
          setScanState('verified');
        } else {
          setStatusMessage('Not recognised. Try again.');
          setScanState('failed');
          setTimeout(() => {
            setScanState('ready');
            setStatusMessage('Ready to Scan');
            setActiveChallenge(null);
          }, 2500);
        }
      }
    },
    [scanState],
  );

  // ---------------------------------------------------------------------------
  // Frame processor (runs as a Reanimated worklet — no React state access)
  // ---------------------------------------------------------------------------

  const frameProcessor = useFrameProcessor(
    frame => {
      'worklet';

      // ---- Adaptive throttling ------------------------------------------------
      // ~10 fps idle, ~30 fps during active challenge.
      // Timestamp-based: avoids dropping the critical blink frame that static
      // frame-count skipping would miss.
      const targetFps = challengeActive.value
        ? THROTTLE_ACTIVE_CHALLENGE_FPS
        : THROTTLE_IDLE_FPS;
      const minIntervalMs = 1000 / targetFps;
      const nowMs = frame.timestamp / 1_000_000; // ns → ms
      if (nowMs - lastFrameTimestamp.value < minIntervalMs) return;
      lastFrameTimestamp.value = nowMs;

      // ---- Gate 0: face detection (BlazeFace) ---------------------------------
      const blazeModel = blazeface.model;
      if (!blazeModel) return;

      // TODO Phase 2: convert frame buffer to [1,128,128,3] float32 tensor,
      // normalised to [-1,1]. For Phase 1 the model runs with zeros (warmup only).
      // Real conversion happens in a C++ JSI plugin — never in JS.
      const detectionInput = new Float32Array(1 * 128 * 128 * 3);
      blazeModel.run([detectionInput]);

      // Signal JS thread that a face was seen (stub — Phase 2 reads real output)
      runOnJS(onFaceDetected)();

      // ---- Gate 1: heuristics -------------------------------------------------
      // Phase 1 stub: landmarks are empty arrays so EAR/MAR/PnP return their
      // default stub values. Quality gate still runs (Laplacian on a real pixel
      // array would be passed in Phase 2 from the YUV buffer).
      const emptyLandmarks: FaceLandmarks = {
        leftEye: [],
        rightEye: [],
        mouth: [],
      };
      // Stub 8×8 grey crop (all zeros = variance 0, will fail quality gate).
      // Phase 2: pass the real 112×112 cropped face pixels.
      const stubGray = new Uint8Array(8 * 8);
      const gate1 = runGate1(
        'blink', // Phase 2: use activeChallenge from shared value
        {consecutiveLowFrames: 0},
        emptyLandmarks,
        0, // yaw baseline
        0, // current yaw
        stubGray,
        8,
        8,
      );

      if (!gate1.passed) return;
      runOnJS(onGate1Passed)();

      // ---- Gate 2: ShuffleNet liveness ----------------------------------------
      const shuffleModel = shufflenet.model;
      if (!shuffleModel) return;

      const livenessInput = new Float32Array(1 * 112 * 112 * 3);
      // run() is synchronous inside a Reanimated worklet even though the TS
      // type is Promise<TypedArray[]> — cast is safe here.
      const livenessOutput = shuffleModel.run([livenessInput]) as unknown as Float32Array[];
      // output[0] = [live_prob, spoof_prob]
      const spoofProb = (livenessOutput[0]?.[1] as number | undefined) ?? 0;
      if (spoofProb > 0.5) {
        runOnJS(onMatchResult)(false);
        return;
      }

      // ---- Gate 3: MobileFaceNet identity embedding ----------------------------
      const faceModel = mobilefacenet.model;
      if (!faceModel) return;

      // Input: [1, 112, 112, 3] float32, normalised to [-1, 1], RGB, aligned.
      const embeddingInput = new Float32Array(1 * 112 * 112 * 3);
      // run() is synchronous inside a Reanimated worklet (same as above)
      const embeddingOutput = faceModel.run([embeddingInput]) as unknown as Float32Array[];
      const rawEmbedding = new Float32Array(embeddingOutput[0]);

      // L2-normalise before cosine distance (required by shared_contracts)
      const normalised = l2Normalize(rawEmbedding);

      // Phase 1: storedUsers is not accessible in worklet — call back to JS
      // for the cosine-distance matching step. In Phase 2 move matching to C++.
      runOnJS(handleEmbeddingOnJs)(normalised);
    },
    [blazeface, shufflenet, mobilefacenet, challengeActive, lastFrameTimestamp, onFaceDetected, onGate1Passed, onMatchResult],
  );

  // ---------------------------------------------------------------------------
  // JS-side cosine matching (Phase 1 bridge — move to C++ in Phase 2)
  // ---------------------------------------------------------------------------

  const handleEmbeddingOnJs = useCallback(
    (embedding: Float32Array) => {
      const match = findBestMatch(
        embedding,
        storedUsers.current.map(u => ({userId: u.id, embedding: u.embedding})),
        MATCH_THRESHOLD_VALUE,
      );
      if (match) {
        // Log attendance
        logAttendance({
          id: `${match.userId}_${Date.now()}`,
          userId: match.userId,
          timestampWall: Date.now(),
          timestampMonotonic: Date.now(), // TODO Phase 2: use device uptime (react-native-device-info or native module)
        });
        onMatchResult(true, match.userId);
      } else {
        onMatchResult(false);
      }
    },
    [onMatchResult],
  );

  // ---------------------------------------------------------------------------
  // Permission denied UI
  // ---------------------------------------------------------------------------

  if (!hasPermission) {
    return (
      <View style={styles.container}>
        <Text style={styles.permissionText}>Camera permission is required.</Text>
        <TouchableOpacity
          style={styles.button}
          onPress={() => Linking.openSettings()}>
          <Text style={styles.buttonText}>Open Settings</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (device == null) {
    return (
      <View style={styles.container}>
        <Text style={styles.permissionText}>No front camera found.</Text>
      </View>
    );
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  const statusColor =
    scanState === 'verified'
      ? '#2e7d32'
      : scanState === 'failed'
      ? '#c62828'
      : '#1a237e';

  return (
    <View style={styles.container}>
      <Camera
        style={StyleSheet.absoluteFill}
        device={device}
        isActive={scanState !== 'verified'}
        frameProcessor={frameProcessor}
        // 480p is sufficient for 112×112 model input and cuts memory by 75%
        // compared to 1080p (see shared_contracts/thresholds.json camera_resolution).
        photo={false}
        video={false}
        audio={false}
      />

      {/* Dark overlay for readability */}
      <View style={styles.overlay} />

      {/* Status card — corporate minimal aesthetic */}
      <View style={styles.card}>
        <View style={[styles.statusDot, {backgroundColor: statusColor}]} />
        <Text style={styles.statusText}>{statusMessage}</Text>
        {activeChallenge && scanState === 'challenge' && (
          <Text style={styles.challengeHint}>
            {CHALLENGE_PROMPTS[activeChallenge]}
          </Text>
        )}
      </View>

      {scanState === 'verified' && (
        <TouchableOpacity
          style={styles.resetButton}
          onPress={() => {
            setScanState('ready');
            setStatusMessage('Ready to Scan');
            setActiveChallenge(null);
            challengeActive.value = false;
          }}>
          <Text style={styles.buttonText}>Scan Another</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Styles — corporate, minimal, muted palette
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0d1117',
    justifyContent: 'flex-end',
    alignItems: 'center',
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
  card: {
    width: '88%',
    backgroundColor: 'rgba(255,255,255,0.97)',
    borderRadius: 12,
    padding: 24,
    marginBottom: 48,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: {width: 0, height: 4},
    shadowOpacity: 0.18,
    shadowRadius: 8,
    elevation: 6,
  },
  statusDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginBottom: 10,
  },
  statusText: {
    fontSize: 18,
    fontWeight: '600',
    color: '#1a1a2e',
    letterSpacing: 0.3,
    textAlign: 'center',
  },
  challengeHint: {
    marginTop: 8,
    fontSize: 14,
    color: '#555',
    textAlign: 'center',
  },
  permissionText: {
    color: '#fff',
    fontSize: 16,
    marginBottom: 16,
    textAlign: 'center',
    paddingHorizontal: 24,
  },
  button: {
    backgroundColor: '#1a237e',
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 8,
  },
  resetButton: {
    backgroundColor: '#1a237e',
    paddingHorizontal: 32,
    paddingVertical: 14,
    borderRadius: 8,
    marginBottom: 64,
    position: 'absolute',
    bottom: 0,
  },
  buttonText: {
    color: '#fff',
    fontWeight: '600',
    fontSize: 15,
  },
});
