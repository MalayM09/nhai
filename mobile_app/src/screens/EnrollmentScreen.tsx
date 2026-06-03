/**
 * EnrollmentScreen — register a new worker's face.
 *
 * Phase 3 flow: enter name → tap Capture 3× → each tap grabs the current
 * camera frame, resizes to 112×112, runs backbone → adapter → L2-normalize
 * → accumulates embeddings → Save computes L2-centroid and writes to SQLite.
 */

import React, {useCallback, useEffect, useRef, useState} from 'react';
import {
  Alert,
  Animated,
  Linking,
  StyleSheet,
  Text,
  TextInput,
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
import {runOnJS, useSharedValue} from 'react-native-reanimated';

import {l2AverageEmbeddings, l2Normalize} from '../utils/embeddingUtils';
import {resizeRgbaToModelInput} from '../utils/frameUtils';
import {upsertUser} from '../db/database';
import {ENROLLMENT_SHOTS_MIN} from '../constants/thresholds';

interface Props {
  goBack: () => void;
}

type EnrollState = 'capturing' | 'saving' | 'saved';

export default function EnrollmentScreen({goBack}: Props): React.JSX.Element {
  const {hasPermission, requestPermission} = useCameraPermission();
  const device = useCameraDevice('front');

  const [workerName, setWorkerName] = useState('');
  const [enrollState, setEnrollState] = useState<EnrollState>('capturing');
  const [captures, setCaptures] = useState<Float32Array[]>([]);
  const [errorMsg, setErrorMsg] = useState('');

  const flashOpacity = useRef(new Animated.Value(0)).current;

  // Shared value: set to true by handleCapture, cleared by worklet after one frame
  const captureRequested = useSharedValue(false);

  const mobilefacenet = useTensorflowModel(
    require('../../assets/models/mobilefacenet.tflite'),
  );
  const mobilefacenetAdapter = useTensorflowModel(
    require('../../assets/models/mobilefacenet_adapter.tflite'),
  );

  useEffect(() => {
    if (!hasPermission) {
      requestPermission();
    }
  }, [hasPermission, requestPermission]);

  // ---------------------------------------------------------------------------
  // Process a captured frame on the React thread
  // ---------------------------------------------------------------------------

  const triggerFlash = useCallback(() => {
    flashOpacity.setValue(1);
    Animated.timing(flashOpacity, {
      toValue: 0,
      duration: 350,
      useNativeDriver: true,
    }).start();
  }, [flashOpacity]);

  const onFrameCaptured = useCallback(
    (buf: ArrayBuffer, w: number, h: number) => {
      if (
        mobilefacenet.state !== 'loaded' ||
        !mobilefacenet.model ||
        mobilefacenetAdapter.state !== 'loaded' ||
        !mobilefacenetAdapter.model
      ) {
        setErrorMsg('Model still loading, wait a moment.');
        return;
      }

      triggerFlash();

      try {
        // MobileFaceNet backbone: [1,112,112,3] float32 [-1,1]
        const input = resizeRgbaToModelInput(
          buf,
          w,
          h,
          112,
          112,
          'minus1_to_1',
        );
        const backboneOut = mobilefacenet.model.runSync([input]);
        const rawEmb = new Float32Array(backboneOut[0] as Float32Array);

        // Adapter: [1,512] → [1,512]
        const adapterOut = mobilefacenetAdapter.model.runSync([rawEmb]);
        const adapted = new Float32Array(adapterOut[0] as Float32Array);
        const normalized = l2Normalize(adapted);

        setCaptures(prev => [...prev, normalized]);
        setErrorMsg('');
      } catch (e) {
        setErrorMsg('Capture failed. Try again.');
      }
    },
    [mobilefacenet, mobilefacenetAdapter, triggerFlash],
  );

  // ---------------------------------------------------------------------------
  // Frame processor — idle until captureRequested fires
  // ---------------------------------------------------------------------------

  const frameProcessor = useFrameProcessor(
    frame => {
      'worklet';
      if (!captureRequested.value) {
        return;
      }
      captureRequested.value = false;
      const buf = frame.toArrayBuffer();
      runOnJS(onFrameCaptured)(buf, frame.width, frame.height);
    },
    [captureRequested, onFrameCaptured],
  );

  // ---------------------------------------------------------------------------
  // Capture button handler
  // ---------------------------------------------------------------------------

  const handleCapture = useCallback(() => {
    if (
      mobilefacenet.state !== 'loaded' ||
      mobilefacenetAdapter.state !== 'loaded'
    ) {
      setErrorMsg('Model still loading, wait a moment.');
      return;
    }
    if (captures.length >= ENROLLMENT_SHOTS_MIN) {
      return;
    }
    captureRequested.value = true; // worklet picks up on next frame
  }, [
    mobilefacenet.state,
    mobilefacenetAdapter.state,
    captures.length,
    captureRequested,
  ]);

  // ---------------------------------------------------------------------------
  // Save handler
  // ---------------------------------------------------------------------------

  const handleSave = useCallback(() => {
    const name = workerName.trim();
    if (!name) {
      setErrorMsg("Please enter the worker's name.");
      return;
    }
    if (captures.length < ENROLLMENT_SHOTS_MIN) {
      setErrorMsg(`Capture ${ENROLLMENT_SHOTS_MIN} frames first.`);
      return;
    }
    setEnrollState('saving');
    try {
      const centroid = l2AverageEmbeddings(captures);
      const userId = `worker_${Date.now()}`;
      upsertUser({
        id: userId,
        name,
        embedding: centroid,
        enrollmentShots: captures.length,
        enrollmentQuality: null,
      });
      setEnrollState('saved');
    } catch (e) {
      setEnrollState('capturing');
      Alert.alert('Save Failed', String(e));
    }
  }, [workerName, captures]);

  // ---------------------------------------------------------------------------
  // Permission / device guards
  // ---------------------------------------------------------------------------

  if (!hasPermission) {
    return (
      <View style={styles.center}>
        <Text style={styles.errorText}>Camera permission required.</Text>
        <TouchableOpacity
          style={styles.linkBtn}
          onPress={() => Linking.openSettings()}>
          <Text style={styles.linkBtnText}>Open Settings</Text>
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
  // Success screen
  // ---------------------------------------------------------------------------

  if (enrollState === 'saved') {
    return (
      <View style={styles.container}>
        <TouchableOpacity style={styles.backBtn} onPress={goBack}>
          <Text style={styles.backBtnText}>← Back</Text>
        </TouchableOpacity>
        <View style={styles.successBox}>
          <View style={styles.successIcon}>
            <Text style={styles.successTick}>✓</Text>
          </View>
          <Text style={styles.successTitle}>Worker Enrolled</Text>
          <Text style={styles.successSub}>
            {workerName.trim()} registered with {captures.length} face captures.
          </Text>
          <TouchableOpacity style={styles.primaryBtn} onPress={goBack}>
            <Text style={styles.primaryBtnText}>Done</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  const shotsDone = captures.length;
  const allCaptured = shotsDone >= ENROLLMENT_SHOTS_MIN;
  const modelsLoading =
    mobilefacenet.state === 'loading' ||
    mobilefacenetAdapter.state === 'loading';

  // ---------------------------------------------------------------------------
  // Capture screen
  // ---------------------------------------------------------------------------

  return (
    <View style={styles.container}>
      <TouchableOpacity style={styles.backBtn} onPress={goBack}>
        <Text style={styles.backBtnText}>← Back</Text>
      </TouchableOpacity>

      <Text style={styles.screenTitle}>Enroll Worker</Text>

      <TextInput
        style={styles.nameInput}
        placeholder="Worker full name"
        placeholderTextColor="#6b7280"
        value={workerName}
        onChangeText={setWorkerName}
        autoCapitalize="words"
        returnKeyType="done"
      />

      <View style={styles.cameraWrap}>
        <Camera
          style={StyleSheet.absoluteFill}
          device={device}
          isActive={enrollState === 'capturing'}
          pixelFormat="rgb"
          frameProcessor={
            enrollState === 'capturing' ? frameProcessor : undefined
          }
          photo={false}
          video={false}
          audio={false}
        />

        <View style={styles.ovalGuide} />

        <Animated.View
          style={[
            StyleSheet.absoluteFillObject,
            {backgroundColor: '#ffffff', opacity: flashOpacity},
          ]}
          pointerEvents="none"
        />

        {modelsLoading && (
          <View style={styles.loadingBadge}>
            <Text style={styles.loadingBadgeText}>Loading models…</Text>
          </View>
        )}
      </View>

      <View style={styles.dotsRow}>
        {Array.from({length: ENROLLMENT_SHOTS_MIN}).map((_, i) => (
          <View
            key={i}
            style={[styles.dot, i < shotsDone && styles.dotFilled]}
          />
        ))}
        <Text style={styles.dotsLabel}>
          {shotsDone}/{ENROLLMENT_SHOTS_MIN} captures
        </Text>
      </View>

      {errorMsg ? <Text style={styles.errorInline}>{errorMsg}</Text> : null}

      {!allCaptured ? (
        <TouchableOpacity
          style={[
            styles.primaryBtn,
            (modelsLoading || enrollState === 'saving') && styles.btnDisabled,
          ]}
          activeOpacity={0.85}
          onPress={handleCapture}
          disabled={modelsLoading || enrollState === 'saving'}>
          <Text style={styles.primaryBtnText}>
            Capture ({shotsDone + 1}/{ENROLLMENT_SHOTS_MIN})
          </Text>
        </TouchableOpacity>
      ) : (
        <TouchableOpacity
          style={[
            styles.saveBtn,
            enrollState === 'saving' && styles.btnDisabled,
          ]}
          activeOpacity={0.85}
          onPress={handleSave}
          disabled={enrollState === 'saving'}>
          <Text style={styles.primaryBtnText}>
            {enrollState === 'saving' ? 'Saving…' : 'Save Worker'}
          </Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0d1117',
    paddingHorizontal: 20,
    paddingTop: 56,
    paddingBottom: 32,
  },
  center: {
    flex: 1,
    backgroundColor: '#0d1117',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 16,
  },
  backBtn: {marginBottom: 12},
  backBtnText: {color: '#6b7280', fontSize: 15},
  screenTitle: {
    color: '#ffffff',
    fontSize: 22,
    fontWeight: '700',
    marginBottom: 20,
  },
  nameInput: {
    backgroundColor: '#161b22',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#21262d',
    color: '#ffffff',
    fontSize: 16,
    paddingHorizontal: 16,
    paddingVertical: 12,
    marginBottom: 16,
  },
  cameraWrap: {
    flex: 1,
    borderRadius: 16,
    overflow: 'hidden',
    backgroundColor: '#161b22',
    marginBottom: 20,
    position: 'relative',
  },
  ovalGuide: {
    position: 'absolute',
    alignSelf: 'center',
    top: '15%',
    width: '60%',
    aspectRatio: 0.75,
    borderRadius: 999,
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.5)',
    borderStyle: 'dashed',
  },
  loadingBadge: {
    position: 'absolute',
    bottom: 12,
    alignSelf: 'center',
    backgroundColor: 'rgba(0,0,0,0.7)',
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 20,
  },
  loadingBadgeText: {color: '#aaa', fontSize: 12},
  dotsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
    paddingHorizontal: 4,
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#21262d',
    borderWidth: 1,
    borderColor: '#374151',
  },
  dotFilled: {backgroundColor: '#2e7d32', borderColor: '#2e7d32'},
  dotsLabel: {color: '#6b7280', fontSize: 13, marginLeft: 4},
  errorInline: {
    color: '#ef5350',
    fontSize: 13,
    marginBottom: 8,
    paddingHorizontal: 4,
  },
  errorText: {color: '#ef5350', fontSize: 15},
  linkBtn: {
    backgroundColor: '#1a237e',
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 8,
  },
  linkBtnText: {color: '#fff', fontWeight: '600', fontSize: 15},
  primaryBtn: {
    backgroundColor: '#1a237e',
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 4,
  },
  saveBtn: {
    backgroundColor: '#1b5e20',
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 4,
  },
  primaryBtnText: {color: '#ffffff', fontSize: 16, fontWeight: '700'},
  btnDisabled: {opacity: 0.45},
  successBox: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 16,
    paddingHorizontal: 16,
  },
  successIcon: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: '#1b5e20',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 8,
  },
  successTick: {color: '#fff', fontSize: 32, fontWeight: '700'},
  successTitle: {color: '#ffffff', fontSize: 22, fontWeight: '700'},
  successSub: {
    color: '#6b7280',
    fontSize: 15,
    textAlign: 'center',
    lineHeight: 22,
  },
});
