import React, {useEffect, useState} from 'react';
import {StyleSheet, Text, TouchableOpacity, View} from 'react-native';
import {getTodayAttendanceCount, loadAllUsers} from '../db/database';

interface Props {
  navigate: (screen: 'enroll' | 'scan') => void;
}

export default function HomeScreen({navigate}: Props): React.JSX.Element {
  const [workerCount, setWorkerCount] = useState(0);
  const [todayCount, setTodayCount] = useState(0);

  useEffect(() => {
    setWorkerCount(loadAllUsers().length);
    setTodayCount(getTodayAttendanceCount());
  }, []);

  return (
    <View style={styles.container}>
      {/* Brand header */}
      <View style={styles.header}>
        <View style={styles.logoBox}>
          <Text style={styles.logoLetter}>N</Text>
        </View>
        <View>
          <Text style={styles.title}>NHAI Biometric</Text>
          <Text style={styles.tagline}>Edge AI · Fully Offline</Text>
        </View>
      </View>

      {/* Stats row */}
      <View style={styles.statsRow}>
        <View style={styles.statCard}>
          <Text style={styles.statNum}>{workerCount}</Text>
          <Text style={styles.statLabel}>Enrolled</Text>
        </View>
        <View style={[styles.statCard, styles.statCardMid]}>
          <Text style={styles.statNum}>{todayCount}</Text>
          <Text style={styles.statLabel}>Today</Text>
        </View>
        <View style={styles.statCard}>
          <Text style={styles.statNum}>0ms</Text>
          <Text style={styles.statLabel}>Network</Text>
        </View>
      </View>

      {/* Action buttons */}
      <View style={styles.actions}>
        <TouchableOpacity
          style={styles.primaryBtn}
          activeOpacity={0.85}
          onPress={() => navigate('scan')}>
          <Text style={styles.primaryBtnText}>Scan Attendance</Text>
          <Text style={styles.primaryBtnSub}>
            Verify and log a worker
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.secondaryBtn}
          activeOpacity={0.85}
          onPress={() => navigate('enroll')}>
          <Text style={styles.secondaryBtnText}>Enroll New Worker</Text>
          <Text style={styles.secondaryBtnSub}>
            Register face for recognition
          </Text>
        </TouchableOpacity>
      </View>

      <Text style={styles.footer}>
        All data stored on-device · Zero network required
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0d1117',
    paddingHorizontal: 24,
    paddingTop: 64,
    paddingBottom: 32,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    marginBottom: 36,
  },
  logoBox: {
    width: 48,
    height: 48,
    borderRadius: 12,
    backgroundColor: '#1a237e',
    justifyContent: 'center',
    alignItems: 'center',
  },
  logoLetter: {
    color: '#fff',
    fontSize: 22,
    fontWeight: '800',
  },
  title: {
    color: '#ffffff',
    fontSize: 22,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  tagline: {
    color: '#6b7280',
    fontSize: 12,
    marginTop: 2,
    letterSpacing: 0.5,
  },
  statsRow: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 40,
  },
  statCard: {
    flex: 1,
    backgroundColor: '#161b22',
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#21262d',
  },
  statCardMid: {
    borderColor: '#1a237e',
  },
  statNum: {
    color: '#ffffff',
    fontSize: 24,
    fontWeight: '700',
  },
  statLabel: {
    color: '#6b7280',
    fontSize: 11,
    marginTop: 4,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  actions: {
    gap: 16,
    flex: 1,
  },
  primaryBtn: {
    backgroundColor: '#1a237e',
    borderRadius: 14,
    padding: 22,
  },
  primaryBtnText: {
    color: '#ffffff',
    fontSize: 17,
    fontWeight: '700',
  },
  primaryBtnSub: {
    color: 'rgba(255,255,255,0.65)',
    fontSize: 13,
    marginTop: 4,
  },
  secondaryBtn: {
    backgroundColor: '#161b22',
    borderRadius: 14,
    padding: 22,
    borderWidth: 1,
    borderColor: '#21262d',
  },
  secondaryBtnText: {
    color: '#ffffff',
    fontSize: 17,
    fontWeight: '700',
  },
  secondaryBtnSub: {
    color: '#6b7280',
    fontSize: 13,
    marginTop: 4,
  },
  footer: {
    color: '#374151',
    fontSize: 12,
    textAlign: 'center',
    marginTop: 24,
    letterSpacing: 0.3,
  },
});
