document.addEventListener('DOMContentLoaded', function() {
    const urlInput = document.getElementById('url');
    const serverInput = document.getElementById('server');
    const downloadBtn = document.getElementById('downloadBtn');
    const autoFillBtn = document.getElementById('autoFillBtn');
    const queueList = document.getElementById('queueList');
    const queueCount = document.getElementById('queueCount');
    const cookiesStatus = document.getElementById('cookiesStatus');
    const toggleCookiesBtn = document.getElementById('toggleCookiesBtn');
    const cookiesInputArea = document.getElementById('cookiesInputArea');
    const cookiesTextarea = document.getElementById('cookiesTextarea');
    const saveCookiesBtn = document.getElementById('saveCookiesBtn');

    // Track item IDs for UI updates
    let itemIds = {};

    // Saved cookies (stored locally in extension)
    let savedCookies = '';

    // Load saved settings
    chrome.storage.local.get(['server', 'cookies'], function(data) {
        if (data.server) serverInput.value = data.server;
        if (data.cookies) {
            savedCookies = data.cookies;
            updateCookiesStatusLocal(true);
        } else {
            updateCookiesStatusLocal(false);
        }
    });

    // Get existing downloads from background
    chrome.runtime.sendMessage({ action: 'getDownloads' }, function(response) {
        if (response && response.downloads) {
            Object.keys(response.downloads).forEach(taskId => {
                const download = response.downloads[taskId];
                if (!document.getElementById(download.itemId)) {
                    // Recreate UI for existing downloads
                    createQueueItemUI(download.itemId, download.url);
                    itemIds[taskId] = download.itemId;
                    updateQueueItemFromDownload(download);
                }
            });
            updateQueueCount();
        }
    });

    // Listen for updates from background
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        if (message.action === 'downloadUpdate') {
            Object.keys(message.downloads).forEach(taskId => {
                const download = message.downloads[taskId];
                updateQueueItemFromDownload(download);
            });
            updateQueueCount();
        }
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

    function createQueueItemUI(itemId, url) {
        const videoId = extractVideoId(url);
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
    }

    function addToQueue(url, server) {
        const itemId = 'task-' + Date.now();
        createQueueItemUI(itemId, url);
        updateQueueCount();

        // Start download on server (include cookies if available)
        const requestBody = { url: url };
        if (savedCookies) {
            requestBody.cookies = savedCookies;
        }

        fetch(server + '/download-async', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(requestBody)
        })
        .then(response => response.json())
        .then(data => {
            if (data.success && data.task_id) {
                // Track itemId for this task
                itemIds[data.task_id] = itemId;

                // Send to background worker
                chrome.runtime.sendMessage({
                    action: 'startDownload',
                    data: {
                        taskId: data.task_id,
                        itemId: itemId,
                        url: url,
                        server: server
                    }
                });

                updateQueueItem(itemId, 0, 'Đang tải trên server...');
            } else {
                updateQueueItem(itemId, 0, 'Lỗi: ' + (data.error || 'Unknown'), 'error');
            }
        })
        .catch(error => {
            updateQueueItem(itemId, 0, 'Lỗi kết nối: ' + error.message, 'error');
        });
    }

    function updateQueueItemFromDownload(download) {
        const itemId = download.itemId;
        const progress = download.progress || 0;
        const status = download.status;
        const message = download.message || '';

        let statusClass = '';
        if (status === 'completed') statusClass = 'completed';
        else if (status === 'error') statusClass = 'error';
        else if (status === 'downloading' && download.downloaded) statusClass = 'downloading-local';

        updateQueueItem(itemId, progress, message, statusClass);
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

    // Cookies functions - stored locally in extension
    function updateCookiesStatusLocal(hasCookies) {
        if (hasCookies) {
            cookiesStatus.textContent = '🟢 Cookies OK';
            cookiesStatus.className = 'cookies-status active';
        } else {
            cookiesStatus.textContent = '🔴 Chưa có cookies';
            cookiesStatus.className = 'cookies-status error';
        }
    }

    // Toggle cookies input area
    toggleCookiesBtn.addEventListener('click', function() {
        if (cookiesInputArea.style.display === 'none') {
            cookiesInputArea.style.display = 'block';
            toggleCookiesBtn.textContent = 'Ẩn';
        } else {
            cookiesInputArea.style.display = 'none';
            toggleCookiesBtn.textContent = 'Cập nhật Cookies';
        }
    });

    // Save cookies locally in extension storage
    saveCookiesBtn.addEventListener('click', function() {
        const cookiesContent = cookiesTextarea.value.trim();

        if (!cookiesContent) {
            alert('Vui lòng paste nội dung cookies!');
            return;
        }

        // Validate cookies format
        if (!cookiesContent.includes('.youtube.com') && !cookiesContent.includes('# Netscape')) {
            alert('Định dạng cookies không hợp lệ!\nCần có dạng Netscape HTTP Cookie File.');
            return;
        }

        // Save to extension local storage
        savedCookies = cookiesContent;
        chrome.storage.local.set({ cookies: cookiesContent }, function() {
            alert('Đã lưu cookies! Cookies sẽ được gửi kèm mỗi lần tải video.');
            cookiesTextarea.value = '';
            cookiesInputArea.style.display = 'none';
            toggleCookiesBtn.textContent = 'Cập nhật Cookies';
            updateCookiesStatusLocal(true);
        });
    });
});
