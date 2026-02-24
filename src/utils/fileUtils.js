/**
 * Sanitize filename to prevent path traversal and illegal characters
 */
export function sanitizeFilename(filename) {
  if (!filename) return 'unknown';
  
  // Remove path separators and dangerous characters
  let sanitized = filename
    .replace(/[\/\\]/g, '-')
    .replace(/[<>:"|?*\x00-\x1f]/g, '')
    .replace(/^\.+/, '') // Remove leading dots
    .trim();
  
  // Limit length
  if (sanitized.length > 200) {
    sanitized = sanitized.substring(0, 200);
  }
  
  return sanitized || 'unknown';
}

/**
 * Extract file extension from URL or filename
 */
export function getExtension(url, defaultExt = '.mp3') {
  if (!url) return defaultExt;
  
  try {
    const parsed = new URL(url);
    const pathname = parsed.pathname;
    const match = pathname.match(/\.([a-z0-9]+)$/i);
    if (match) {
      return '.' + match[1];
    }
  } catch (e) {
    // Not a valid URL, try as filename
    const match = url.match(/\.([a-z0-9]+)$/i);
    if (match) {
      return '.' + match[1];
    }
  }
  
  return defaultExt;
}

/**
 * Create safe directory path for library organization
 */
export function createLibraryPath(artist, title, ext) {
  const safeArtist = sanitizeFilename(artist || 'Unknown Artist');
  const safeTitle = sanitizeFilename(title || 'Unknown Title');
  const safeExt = ext.startsWith('.') ? ext : '.' + ext;
  
  return {
    dir: `${safeArtist}/Singles`,
    filename: `${safeTitle}${safeExt}`
  };
}
