// DOM elements
const searchBtn = document.getElementById('searchBtn');
const searchText = document.getElementById('searchText');
const serviceSelect = document.getElementById('service');
const searchResults = document.getElementById('searchResults');
const tasksList = document.getElementById('tasksList');

// State
let pollingTimeout = null;
let pollingController = null;
let searchResultsData = []; // Store search results data separately
let queuePanelOpen = false;

// Search music
async function searchMusic() {
  const text = searchText.value.trim();
  const service = serviceSelect.value;
  
  if (!text) {
    alert('Please enter search text');
    return;
  }
  
  searchBtn.disabled = true;
  searchBtn.textContent = 'Searching...';
  searchResults.innerHTML = '<p class="loading">Searching...</p>';
  
  try {
    const response = await fetch(`/api/search?service=${service}&text=${encodeURIComponent(text)}&pageNum=1&pageSize=20`);
    const data = await response.json();
    
    if (data.error) {
      throw new Error(data.error);
    }
    
    // Support both 'results' and 'items' fields for compatibility
    const results = data.results || data.items || [];
    displaySearchResults(results);
    
  } catch (error) {
    searchResults.innerHTML = `<p class="placeholder">Error: ${error.message}</p>`;
  } finally {
    searchBtn.disabled = false;
    searchBtn.textContent = 'Search';
  }
}

// Display search results
function displaySearchResults(results) {
  if (!results || results.length === 0) {
    searchResults.innerHTML = '<p class="placeholder">No results found</p>';
    searchResultsData = [];
    return;
  }
  
  // Store results data
  searchResultsData = results;
  
  searchResults.innerHTML = results.map((item, index) => `
    <div class="result-item">
      <img 
        src="${escapeHtml(item.coverUrl || '/placeholder.png')}" 
        alt="${escapeHtml(item.title)}"
        class="result-cover"
        onerror="this.src='data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%2260%22 height=%2260%22%3E%3Crect fill=%22%23ddd%22 width=%2260%22 height=%2260%22/%3E%3Ctext x=%2250%25%22 y=%2250%25%22 text-anchor=%22middle%22 dy=%22.3em%22 fill=%22%23999%22 font-size=%2224%22%3E%F0%9F%8E%B5%3C/text%3E%3C/svg%3E'"
      >
      <div class="result-info">
        <div class="result-title">${escapeHtml(item.title)}</div>
        <div class="result-artist">${escapeHtml(item.artist)}</div>
        <div class="result-meta">
          ${item.album ? escapeHtml(item.album) + ' · ' : ''}
          ${escapeHtml(item.format)} · ${escapeHtml(item.fileSize)}
        </div>
      </div>
      <div class="result-actions">
        <button class="download-btn" data-index="${index}" onclick="downloadSongByIndex(${index})">
          Download
        </button>
      </div>
    </div>
  `).join('');
}

// Download song by index
async function downloadSongByIndex(index) {
  const item = searchResultsData[index];
  if (!item) {
    alert('Invalid item selected');
    return;
  }
  
  // Disable the download button immediately
  const btn = document.querySelector(`button[data-index="${index}"]`);
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Queued';
    btn.classList.add('queued');
  }
  
  // Trigger flying animation
  triggerFlyingAnimation(index);
  
  await downloadSong(item);
}

// Download song
async function downloadSong(item) {
  try {
    const response = await fetch('/api/tasks', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        service: serviceSelect.value,
        title: item.title,
        artist: item.artist,
        album: item.album,
        coverUrl: item.coverUrl,
        downloadUrl: item.downloadUrl,
        fileSize: item.fileSize,
        format: item.format
      })
    });
    
    const task = await response.json();
    
    if (task.error) {
      throw new Error(task.error);
    }
    
    // Immediately reload tasks to update queue
    loadTasks();
    
  } catch (error) {
    alert('Failed to create download task: ' + error.message);
  }
}

// Trigger flying animation from search result to queue button
function triggerFlyingAnimation(index) {
  const resultItem = document.querySelector(`.result-item:nth-child(${index + 1})`);
  const queueBtn = document.getElementById('queueBtn');
  
  if (!resultItem || !queueBtn) return;
  
  const cover = resultItem.querySelector('.result-cover');
  if (!cover) return;
  
  // Create flying element
  const flyingElement = document.createElement('div');
  flyingElement.className = 'flying-cover';
  flyingElement.style.backgroundImage = cover.style.backgroundImage || `url(${cover.src})`;
  
  // Get positions
  const coverRect = cover.getBoundingClientRect();
  const queueRect = queueBtn.getBoundingClientRect();
  
  // Set initial position
  flyingElement.style.left = coverRect.left + 'px';
  flyingElement.style.top = coverRect.top + 'px';
  
  document.body.appendChild(flyingElement);
  
  // Trigger animation after a small delay to ensure CSS is applied
  setTimeout(() => {
    flyingElement.style.left = queueRect.left + (queueRect.width / 2) - 15 + 'px';
    flyingElement.style.top = queueRect.top + (queueRect.height / 2) - 15 + 'px';
    flyingElement.style.opacity = '0';
    flyingElement.style.transform = 'scale(0.2)';
  }, 10);
  
  // Remove element after animation completes
  setTimeout(() => {
    flyingElement.remove();
  }, 800);
}

// Load tasks
async function loadTasks() {
  // Cancel previous request if still in flight
  if (pollingController) {
    pollingController.abort();
  }
  
  // Create new AbortController for this request
  pollingController = new AbortController();
  
  try {
    const response = await fetch('/api/tasks', {
      signal: pollingController.signal
    });
    const tasks = await response.json();
    
    if (tasks.error) {
      throw new Error(tasks.error);
    }
    
    displayTasks(tasks);
    updateQueueBadge(tasks);
    
    // Update queue panel if it's open
    if (queuePanelOpen) {
      updateQueuePanelContent(tasks);
    }
    
    // Optimize polling: only continue if there are active tasks
    const hasActiveTasks = tasks.some(task => 
      ['queued', 'downloading', 'organizing'].includes(task.status)
    );
    
    // Schedule next poll with appropriate interval
    const nextInterval = hasActiveTasks ? 3000 : 10000;
    scheduleNextPoll(nextInterval);
    
  } catch (error) {
    if (error.name === 'AbortError') {
      // Request was aborted, this is expected
      console.log('Previous request aborted');
      return;
    }
    console.error('Failed to load tasks:', error);
    // Still schedule next poll on error
    scheduleNextPoll(10000);
  }
}

// Schedule next poll using setTimeout (recursive polling)
function scheduleNextPoll(interval) {
  // Clear any existing timeout
  if (pollingTimeout) {
    clearTimeout(pollingTimeout);
  }
  
  // Schedule next poll
  pollingTimeout = setTimeout(() => {
    loadTasks();
  }, interval);
}

// Update queue badge with active tasks count
function updateQueueBadge(tasks) {
  const activeTasks = tasks.filter(task => 
    ['queued', 'downloading', 'organizing'].includes(task.status)
  );
  
  const badge = document.getElementById('queueBadge');
  if (badge) {
    if (activeTasks.length > 0) {
      badge.textContent = activeTasks.length;
      badge.style.display = 'flex';
    } else {
      badge.style.display = 'none';
    }
  }
}

// Display tasks
function displayTasks(tasks) {
  if (!tasks || tasks.length === 0) {
    tasksList.innerHTML = '<p class="placeholder">No tasks yet</p>';
    return;
  }
  
  tasksList.innerHTML = tasks.map(task => {
    const progressBarHtml = generateProgressBar(task);
    
    return `
    <div class="task-item">
      <img 
        src="${escapeHtml(task.cover_url || '/placeholder.png')}" 
        alt="${escapeHtml(task.title)}"
        class="task-cover"
        onerror="this.src='data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%2260%22 height=%2260%22%3E%3Crect fill=%22%23ddd%22 width=%2260%22 height=%2260%22/%3E%3Ctext x=%2250%25%22 y=%2250%25%22 text-anchor=%22middle%22 dy=%22.3em%22 fill=%22%23999%22 font-size=%2224%22%3E%F0%9F%8E%B5%3C/text%3E%3C/svg%3E'"
      >
      <div class="task-info">
        <div class="task-title">${escapeHtml(task.title)}</div>
        <div class="task-artist">${escapeHtml(task.artist)}</div>
        <div class="task-meta">
          ${task.album ? escapeHtml(task.album) + ' · ' : ''}
          ${escapeHtml(task.format)}
          ${task.library_path ? ' · ' + escapeHtml(task.library_path) : ''}
        </div>
        ${progressBarHtml}
        ${task.error_message ? `<div class="error-message">${escapeHtml(task.error_message)}</div>` : ''}
      </div>
      <div class="task-status status-${escapeHtml(task.status)}">
        ${escapeHtml(task.status)}
      </div>
    </div>
  `;
  }).join('');
}

// Generate progress bar HTML for a task
function generateProgressBar(task) {
  if (task.status === 'downloading' || (task.status === 'queued' && task.progress > 0)) {
    const progress = task.progress || 0;
    const downloadedBytes = task.downloaded_bytes || 0;
    const totalBytes = task.total_bytes || 0;
    const speedBps = task.speed_bps || 0;
    
    // Format bytes to human-readable
    const formatBytes = (bytes) => {
      if (bytes === 0) return '0 B';
      const k = 1024;
      const sizes = ['B', 'KB', 'MB', 'GB'];
      const i = Math.floor(Math.log(bytes) / Math.log(k));
      return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    };
    
    // Format speed
    const formatSpeed = (bps) => {
      return formatBytes(bps) + '/s';
    };
    
    let progressInfo = '';
    if (totalBytes > 0) {
      progressInfo = `${formatBytes(downloadedBytes)} / ${formatBytes(totalBytes)}`;
      if (speedBps > 0) {
        progressInfo += ` · ${formatSpeed(speedBps)}`;
      }
    } else if (downloadedBytes > 0) {
      progressInfo = `${formatBytes(downloadedBytes)}`;
      if (speedBps > 0) {
        progressInfo += ` · ${formatSpeed(speedBps)}`;
      }
    }
    
    return `
      <div class="progress-container">
        <div class="progress-bar">
          <div class="progress-fill" style="width: ${progress}%"></div>
        </div>
        <div class="progress-info">${progress.toFixed(1)}% ${progressInfo ? '· ' + progressInfo : ''}</div>
      </div>
    `;
  }
  return '';
}

// Utility: Escape HTML
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Toggle queue panel
function toggleQueuePanel() {
  const panel = document.getElementById('queuePanel');
  queuePanelOpen = !queuePanelOpen;
  
  if (queuePanelOpen) {
    panel.classList.add('open');
    // Load tasks into queue panel
    loadQueuePanel();
  } else {
    panel.classList.remove('open');
  }
}

// Load queue panel with current tasks
async function loadQueuePanel() {
  const queueContent = document.getElementById('queueContent');
  
  try {
    const response = await fetch('/api/tasks');
    const tasks = await response.json();
    
    if (tasks.error) {
      throw new Error(tasks.error);
    }
    
    updateQueuePanelContent(tasks);
    
  } catch (error) {
    console.error('Failed to load queue panel:', error);
    queueContent.innerHTML = '<p class="placeholder error">Failed to load queue</p>';
  }
}

// Update queue panel content with tasks
function updateQueuePanelContent(tasks) {
  const queueContent = document.getElementById('queueContent');
  
  if (!tasks || tasks.length === 0) {
    queueContent.innerHTML = '<p class="placeholder">No tasks in queue</p>';
    return;
  }
  
  // Sort tasks: active first, then by creation time
  const sortedTasks = tasks.sort((a, b) => {
    const activeStates = ['downloading', 'queued', 'organizing'];
    const aActive = activeStates.includes(a.status);
    const bActive = activeStates.includes(b.status);
    
    if (aActive && !bActive) return -1;
    if (!aActive && bActive) return 1;
    
    return b.created_at - a.created_at;
  });
  
  queueContent.innerHTML = sortedTasks.map(task => {
    const progressBarHtml = generateProgressBar(task);
    
    return `
      <div class="queue-item">
        <img 
          src="${escapeHtml(task.cover_url || '/placeholder.png')}" 
          alt="${escapeHtml(task.title)}"
          class="queue-cover"
          onerror="this.src='data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%2240%22 height=%2240%22%3E%3Crect fill=%22%23ddd%22 width=%2240%22 height=%2240%22/%3E%3Ctext x=%2250%25%22 y=%2250%25%22 text-anchor=%22middle%22 dy=%22.3em%22 fill=%22%23999%22 font-size=%2216%22%3E%F0%9F%8E%B5%3C/text%3E%3C/svg%3E'"
        >
        <div class="queue-info">
          <div class="queue-title">${escapeHtml(task.title)}</div>
          <div class="queue-artist">${escapeHtml(task.artist)}</div>
          ${progressBarHtml}
          ${task.error_message ? `<div class="error-message">${escapeHtml(task.error_message)}</div>` : ''}
        </div>
        <div class="queue-status status-${escapeHtml(task.status)}">
          ${escapeHtml(task.status)}
        </div>
      </div>
    `;
  }).join('');
}

// Event listeners
searchBtn.addEventListener('click', searchMusic);
searchText.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') {
    searchMusic();
  }
});

// Initialize - start polling immediately
loadTasks();

// Clean up on page unload
window.addEventListener('beforeunload', () => {
  if (pollingTimeout) {
    clearTimeout(pollingTimeout);
  }
  if (pollingController) {
    pollingController.abort();
  }
});
