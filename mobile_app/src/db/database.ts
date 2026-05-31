/**
 * Local SQLite database layer.
 *
 * Schema is frozen in shared_contracts/README.md. Do not change column names
 * or types without updating that file first.
 *
 * TODO Phase 2 — SQLCipher:
 *   Replace `open({ name })` with `open({ name, encryptionKey: key })` where
 *   `key` is retrieved from iOS Keychain / Android Keystore.
 *   Package: react-native-quick-sqlite supports SQLCipher when built with the
 *   SQLCipher variant. See README for the Podfile / Gradle flag.
 *   Until Phase 2, the DB is unencrypted. Do not ship to production.
 */

import {open, QuickSQLiteConnection} from 'react-native-quick-sqlite';

let db: QuickSQLiteConnection | null = null;

/** Open (or reopen) the database and create tables if they don't exist. */
export function initDatabase(): void {
  // TODO Phase 2: retrieve encryption key from Keychain/Keystore and pass it here
  db = open({name: 'nhai_biometric.db'});
  createTables();
}

function getDb(): QuickSQLiteConnection {
  if (!db) throw new Error('Database not initialised. Call initDatabase() first.');
  return db;
}

function createTables(): void {
  const conn = getDb();

  // Users — stores one L2-normalised centroid embedding per person.
  // embedding BLOB: 512 × float32 little-endian = 2048 bytes.
  conn.execute(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      embedding BLOB NOT NULL,
      enrollment_shots INTEGER NOT NULL DEFAULT 1,
      enrollment_quality REAL
    )
  `);

  // Attendance — offline log with dual timestamps for anti-tamper.
  // timestamp_monotonic tracks device uptime (not wall-clock) to detect
  // OS time spoofing while offline (see shared_contracts/README.md §22).
  conn.execute(`
    CREATE TABLE IF NOT EXISTS attendance (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      timestamp_wall INTEGER NOT NULL,
      timestamp_monotonic INTEGER NOT NULL,
      synced INTEGER NOT NULL DEFAULT 0
    )
  `);
}

// ---------------------------------------------------------------------------
// User operations
// ---------------------------------------------------------------------------

/** Serialise a Float32Array to a Buffer (little-endian float32 × 512). */
function embeddingToBuffer(embedding: Float32Array): ArrayBuffer {
  return embedding.buffer.slice(
    embedding.byteOffset,
    embedding.byteOffset + embedding.byteLength,
  );
}

/** Deserialise a BLOB column back to Float32Array. */
function bufferToEmbedding(blob: ArrayBuffer): Float32Array {
  return new Float32Array(blob);
}

export interface UserRecord {
  id: string;
  name: string;
  embedding: Float32Array;
  enrollmentShots: number;
  enrollmentQuality: number | null;
}

/** Insert or replace a user with their centroid embedding. */
export function upsertUser(user: UserRecord): void {
  getDb().execute(
    `INSERT OR REPLACE INTO users (id, name, embedding, enrollment_shots, enrollment_quality)
     VALUES (?, ?, ?, ?, ?)`,
    [
      user.id,
      user.name,
      embeddingToBuffer(user.embedding),
      user.enrollmentShots,
      user.enrollmentQuality ?? null,
    ],
  );
}

/** Load all user records into memory for matrix matching. */
export function loadAllUsers(): UserRecord[] {
  const result = getDb().execute('SELECT id, name, embedding, enrollment_shots, enrollment_quality FROM users');
  if (!result.rows) return [];

  const users: UserRecord[] = [];
  for (let i = 0; i < result.rows.length; i++) {
    const row = result.rows.item(i);
    users.push({
      id: row.id as string,
      name: row.name as string,
      embedding: bufferToEmbedding(row.embedding as ArrayBuffer),
      enrollmentShots: row.enrollment_shots as number,
      enrollmentQuality: row.enrollment_quality as number | null,
    });
  }
  return users;
}

// ---------------------------------------------------------------------------
// Attendance operations
// ---------------------------------------------------------------------------

export interface AttendanceRecord {
  id: string;
  userId: string;
  /** Unix epoch milliseconds (wall clock). */
  timestampWall: number;
  /** Device uptime in ms at the moment of scan (anti time-tamper). */
  timestampMonotonic: number;
}

/** Log an attendance event. synced = 0 (pending sync to backend). */
export function logAttendance(record: AttendanceRecord): void {
  getDb().execute(
    `INSERT INTO attendance (id, user_id, timestamp_wall, timestamp_monotonic, synced)
     VALUES (?, ?, ?, ?, 0)`,
    [record.id, record.userId, record.timestampWall, record.timestampMonotonic],
  );
}

/** Return all attendance records that haven't been synced yet. */
export function getUnsyncedAttendance(): AttendanceRecord[] {
  const result = getDb().execute(
    'SELECT id, user_id, timestamp_wall, timestamp_monotonic FROM attendance WHERE synced = 0',
  );
  if (!result.rows) return [];

  const records: AttendanceRecord[] = [];
  for (let i = 0; i < result.rows.length; i++) {
    const row = result.rows.item(i);
    records.push({
      id: row.id as string,
      userId: row.user_id as string,
      timestampWall: row.timestamp_wall as number,
      timestampMonotonic: row.timestamp_monotonic as number,
    });
  }
  return records;
}

/** Mark an attendance record as synced (called after backend returns 200 OK). */
export function markSynced(attendanceId: string): void {
  getDb().execute('UPDATE attendance SET synced = 1 WHERE id = ?', [attendanceId]);
}

/** Purge a synced record after backend confirms receipt (200 OK). */
export function purgeAttendance(attendanceId: string): void {
  getDb().execute('DELETE FROM attendance WHERE id = ?', [attendanceId]);
}
