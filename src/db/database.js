import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import config from '../config.js';

let db = null;

/**
 * Initialize database connection and create tables
 */
export function initDatabase() {
  // Ensure config directory exists
  const configDir = path.dirname(config.DB_PATH);
  if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true });
  }
  
  db = new Database(config.DB_PATH);
  
  // Create tasks table
  db.exec(`
    CREATE TABLE IF NOT EXISTS tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      service TEXT NOT NULL,
      title TEXT,
      artist TEXT,
      album TEXT,
      cover_url TEXT,
      download_url TEXT NOT NULL,
      file_size TEXT,
      format TEXT,
      status TEXT NOT NULL DEFAULT 'queued',
      error_message TEXT,
      staging_path TEXT,
      library_path TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `);
  
  return db;
}

/**
 * Get database instance
 */
export function getDatabase() {
  if (!db) {
    initDatabase();
  }
  return db;
}

/**
 * Create a new download task
 */
export function createTask(taskData) {
  const db = getDatabase();
  const now = Date.now();
  
  const stmt = db.prepare(`
    INSERT INTO tasks (
      service, title, artist, album, cover_url, download_url,
      file_size, format, status, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'queued', ?, ?)
  `);
  
  const result = stmt.run(
    taskData.service,
    taskData.title,
    taskData.artist,
    taskData.album,
    taskData.coverUrl,
    taskData.downloadUrl,
    taskData.fileSize,
    taskData.format,
    now,
    now
  );
  
  return result.lastInsertRowid;
}

/**
 * Get all tasks
 */
export function getAllTasks() {
  const db = getDatabase();
  const stmt = db.prepare('SELECT * FROM tasks ORDER BY created_at DESC');
  return stmt.all();
}

/**
 * Get task by ID
 */
export function getTaskById(id) {
  const db = getDatabase();
  const stmt = db.prepare('SELECT * FROM tasks WHERE id = ?');
  return stmt.get(id);
}

/**
 * Update task status
 */
export function updateTaskStatus(id, status, errorMessage = null, additionalData = {}) {
  const db = getDatabase();
  const now = Date.now();
  
  let sql = 'UPDATE tasks SET status = ?, updated_at = ?';
  const params = [status, now];
  
  if (errorMessage) {
    sql += ', error_message = ?';
    params.push(errorMessage);
  }
  
  if (additionalData.stagingPath) {
    sql += ', staging_path = ?';
    params.push(additionalData.stagingPath);
  }
  
  if (additionalData.libraryPath) {
    sql += ', library_path = ?';
    params.push(additionalData.libraryPath);
  }
  
  sql += ' WHERE id = ?';
  params.push(id);
  
  const stmt = db.prepare(sql);
  return stmt.run(...params);
}

/**
 * Get next queued task
 */
export function getNextQueuedTask() {
  const db = getDatabase();
  const stmt = db.prepare('SELECT * FROM tasks WHERE status = ? ORDER BY created_at ASC LIMIT 1');
  return stmt.get('queued');
}
