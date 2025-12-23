/**
 * Background Service Worker
 * Handles download polling and triggers - persists even when popup is closed
 */

// Store all active downloads
let downloads = {};
let pollInterval = null;

// Listen for messages from popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'startDownload') {
        startDownload(message.data);
        sendResponse({ success: true });
    } else if (message.action === 'getDownloads') {
        sendResponse({ downloads: downloads });
    }
    return true;
});

function startDownload(data) {
    const { taskId, itemId, url, server, filename } = data;

    downloads[taskId] = {
        itemId: itemId,
        url: url,
        server: server,
        downloaded: false,
        progress: 0,
        status: 'downloading',
        message: 'Đang tải trên server...',
        filename: null
    };

    // Start polling if not already running
    if (!pollInterval) {
        startPolling();
    }

    // Notify popup of update
    notifyPopup();
}

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

                        // Update download info
                        downloads[taskId].progress = progress;
                        downloads[taskId].status = status;
                        downloads[taskId].message = message;
                        downloads[taskId].filename = filename;

                        if (status === 'completed' && downloadReady && !download.downloaded) {
                            // Server finished, trigger download to local
                            download.downloaded = true;
                            downloads[taskId].message = 'Đang tải về máy: ' + filename;

                            triggerDownloadToLocal(download.server, taskId, filename);

                            // Mark as completed after a short delay
                            setTimeout(() => {
                                downloads[taskId].status = 'completed';
                                downloads[taskId].message = 'Hoàn thành: ' + filename;
                                notifyPopup();

                                // Cleanup on server
                                fetch(download.server + '/cleanup/' + taskId, { method: 'POST' });

                                // Remove from downloads after some time
                                setTimeout(() => {
                                    delete downloads[taskId];
                                    notifyPopup();
                                }, 5000);
                            }, 2000);

                        } else if (status === 'error') {
                            downloads[taskId].status = 'error';
                            downloads[taskId].message = 'Lỗi: ' + message;

                            // Remove from active polling after some time
                            setTimeout(() => {
                                delete downloads[taskId];
                                notifyPopup();
                            }, 10000);
                        }

                        // Notify popup of update
                        notifyPopup();
                    }
                })
                .catch(error => {
                    console.error('Poll error for task ' + taskId + ':', error);
                });
        });
    }, 1000);
}

function triggerDownloadToLocal(server, taskId, filename) {
    const downloadUrl = server + '/download-file/' + taskId;

    chrome.downloads.download({
        url: downloadUrl,
        filename: filename,
        saveAs: true
    }, function(downloadId) {
        if (chrome.runtime.lastError) {
            console.error('Download error:', chrome.runtime.lastError);
        }
    });
}

function notifyPopup() {
    // Send message to popup if it's open
    chrome.runtime.sendMessage({
        action: 'downloadUpdate',
        downloads: downloads
    }).catch(() => {
        // Popup might be closed, ignore error
    });
}

console.log('Background service worker started');
