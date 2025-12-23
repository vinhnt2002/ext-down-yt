document.addEventListener('DOMContentLoaded', function() {
    const urlInput = document.getElementById('url');
    const serverInput = document.getElementById('server');
    const downloadBtn = document.getElementById('downloadBtn');
    const autoFillBtn = document.getElementById('autoFillBtn');
    const queueList = document.getElementById('queueList');
    const queueCount = document.getElementById('queueCount');
    const cookiesStatus = document.getElementById('cookiesStatus');
    const uploadCookiesBtn = document.getElementById('uploadCookiesBtn');
    const cookiesFile = document.getElementById('cookiesFile');

    // Store all active downloads
    let downloads = {};
    let pollInterval = null;

    // Load saved settings
    chrome.storage.local.get(['server'], function(data) {
        if (data.server) serverInput.value = data.server;
        // Check cookies status after loading server
        checkCookiesStatus();
    });

    // Auto fill URL from current tab
    autoFillBtn.addEventListener('click', function() {
        chrome.tabs.query({ active: true, currentWindow: true }, function(tabs) {
            const currentUrl = tabs[0].url;
            if (isYouTubeUrl(currentUrl)) {
                urlInput.value = currentUrl;
            } else {
                alert('Tab hiện tại không phải YouTube!');
            }
        });
    });

    // Try auto-fill on popup open
    chrome.tabs.query({ active: true, currentWindow: true }, function(tabs) {
        const currentUrl = tabs[0].url;
        if (isYouTubeUrl(currentUrl)) {
            urlInput.value = currentUrl;
        }
    });

    // Download button click - Add to queue
    downloadBtn.addEventListener('click', function() {
        const url = urlInput.value.trim();
        const server = serverInput.value.trim();

        // Validate
        if (!url) {
            alert('Vui lòng nhập link YouTube!');
            return;
        }

        if (!isYouTubeUrl(url)) {
            alert('Link YouTube không hợp lệ!');
            return;
        }

        if (!server) {
            alert('Vui lòng nhập Server URL!');
            return;
        }

        // Save settings
        chrome.storage.local.set({ server: server });

        // Add to queue
        addToQueue(url, server);

        // Clear URL input for next video
        urlInput.value = '';
    });

    function isYouTubeUrl(url) {
        return url && (
            url.includes('youtube.com/watch') ||
            url.includes('youtu.be/') ||
            url.includes('youtube.com/shorts/')
        );
    }

    function extractVideoId(url) {
        const match = url.match(/[?&]v=([^&]+)/) || url.match(/youtu\.be\/([^?]+)/) || url.match(/shorts\/([^?]+)/);
        return match ? match[1] : url.substring(0, 20);
    }

    function addToQueue(url, server) {
        const videoId = extractVideoId(url);

        // Create queue item UI
        const itemId = 'task-' + Date.now();
        const itemHtml = `
            <div class="queue-item" id="${itemId}">
                <div class="queue-item-title" title="${url}">${videoId}</div>
                <div class="queue-item-progress">
                    <div class="queue-item-progress-fill" style="width: 0%"></div>
                </div>
                <div class="queue-item-status">Đang kết nối...</div>
            </div>
        `;
        queueList.insertAdjacentHTML('beforeend', itemHtml);
        updateQueueCount();

        // Start download on server
        fetch(server + '/download-async', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ url: url })
        })
        .then(response => response.json())
        .then(data => {
            if (data.success && data.task_id) {
                // Store download info
                downloads[data.task_id] = {
                    itemId: itemId,
                    url: url,
                    server: server,
                    downloaded: false
                };

                updateQueueItem(itemId, 0, 'Đang tải trên server...');

                // Start polling if not already running
                if (!pollInterval) {
                    startPolling();
                }
            } else {
                updateQueueItem(itemId, 0, 'Lỗi: ' + (data.error || 'Unknown'), 'error');
            }
        })
        .catch(error => {
            updateQueueItem(itemId, 0, 'Lỗi kết nối: ' + error.message, 'error');
        });
    }

    function updateQueueItem(itemId, progress, status, statusClass) {
        const item = document.getElementById(itemId);
        if (!item) return;

        const progressFill = item.querySelector('.queue-item-progress-fill');
        const statusEl = item.querySelector('.queue-item-status');

        if (progressFill) {
            progressFill.style.width = progress + '%';
        }
        if (statusEl) {
            statusEl.textContent = status;
        }

        // Update class for styling
        item.classList.remove('completed', 'error', 'downloading-local');
        if (statusClass) {
            item.classList.add(statusClass);
        }
    }

    function updateQueueCount() {
        queueCount.textContent = queueList.children.length;
    }

    function triggerDownloadToLocal(server, taskId, filename) {
        // Create download link and trigger it
        const downloadUrl = server + '/download-file/' + taskId;

        // Use Chrome downloads API
        chrome.downloads.download({
            url: downloadUrl,
            filename: filename,
            saveAs: true  // Ask user where to save
        }, function(downloadId) {
            if (chrome.runtime.lastError) {
                console.error('Download error:', chrome.runtime.lastError);
                // Fallback: open in new tab
                window.open(downloadUrl, '_blank');
            }
        });
    }

    // Cookies functions
    function checkCookiesStatus() {
        const server = serverInput.value.trim();
        if (!server) return;

        fetch(server + '/cookies-status')
            .then(response => response.json())
            .then(data => {
                if (data.success && data.hasCookies) {
                    cookiesStatus.textContent = '🟢 Cookies OK';
                    cookiesStatus.classList.add('active');
                } else {
                    cookiesStatus.textContent = '🔴 Chưa có cookies';
                    cookiesStatus.classList.remove('active');
                }
            })
            .catch(() => {
                cookiesStatus.textContent = '⚪ Không kết nối được';
                cookiesStatus.classList.remove('active');
            });
    }

    // Upload cookies button
    uploadCookiesBtn.addEventListener('click', function() {
        cookiesFile.click();
    });

    // Handle file selection
    cookiesFile.addEventListener('change', function(e) {
        const file = e.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = function(e) {
            const cookiesContent = e.target.result;
            uploadCookies(cookiesContent);
        };
        reader.readAsText(file);
    });

    function uploadCookies(cookiesContent) {
        const server = serverInput.value.trim();
        if (!server) {
            alert('Vui lòng nhập Server URL trước!');
            return;
        }

        uploadCookiesBtn.disabled = true;
        uploadCookiesBtn.textContent = 'Đang upload...';

        fetch(server + '/upload-cookies', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ cookies: cookiesContent })
        })
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                alert('Upload cookies thành công!');
                checkCookiesStatus();
            } else {
                alert('Lỗi: ' + (data.error || 'Upload thất bại'));
            }
        })
        .catch(error => {
            alert('Lỗi kết nối: ' + error.message);
        })
        .finally(() => {
            uploadCookiesBtn.disabled = false;
            uploadCookiesBtn.textContent = '📤 Upload Cookies';
            cookiesFile.value = '';  // Reset file input
        });
    }

    // Re-check cookies when server changes
    serverInput.addEventListener('change', checkCookiesStatus);

    function startPolling() {
        pollInterval = setInterval(() => {
            const taskIds = Object.keys(downloads);

            if (taskIds.length === 0) {
                clearInterval(pollInterval);
                pollInterval = null;
                return;
            }

            taskIds.forEach(taskId => {
                const download = downloads[taskId];

                // Skip if already triggered local download
                if (download.downloaded) return;

                fetch(download.server + '/status/' + taskId)
                    .then(response => response.json())
                    .then(data => {
                        if (data.success) {
                            const progress = data.progress || 0;
                            const status = data.status;
                            const message = data.message || '';
                            const filename = data.filename;
                            const downloadReady = data.downloadReady;

                            if (status === 'completed' && downloadReady && !download.downloaded) {
                                // Server finished, trigger download to local
                                download.downloaded = true;
                                updateQueueItem(download.itemId, 100, 'Đang tải về máy: ' + filename, 'downloading-local');

                                triggerDownloadToLocal(download.server, taskId, filename);

                                // Mark as completed after a short delay
                                setTimeout(() => {
                                    updateQueueItem(download.itemId, 100, 'Hoàn thành: ' + filename, 'completed');
                                    delete downloads[taskId];

                                    // Cleanup on server
                                    fetch(download.server + '/cleanup/' + taskId, { method: 'POST' });
                                }, 2000);

                            } else if (status === 'error') {
                                updateQueueItem(download.itemId, progress, 'Lỗi: ' + message, 'error');
                                delete downloads[taskId];
                            } else if (status === 'downloading') {
                                updateQueueItem(download.itemId, progress, message || 'Đang tải...');
                            }
                        }
                    })
                    .catch(error => {
                        console.error('Poll error for task ' + taskId + ':', error);
                    });
            });
        }, 1000);
    }
});
