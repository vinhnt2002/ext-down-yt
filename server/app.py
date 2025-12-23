"""
Flask Server for YouTube Video Downloader
Uses yt-dlp to download single videos (no playlist)
Downloads to temp folder on server, then streams file to client
"""

from flask import Flask, request, jsonify, send_file, Response
from flask_cors import CORS
import subprocess
import os
import threading
import uuid
import tempfile
import shutil
import re

app = Flask(__name__)
CORS(app)  # Enable CORS for extension requests

# Store download status and file info
downloads = {}

# Temp directory for downloads
TEMP_DIR = tempfile.mkdtemp(prefix='ytdl_')
print(f"Temp directory: {TEMP_DIR}")

# Cookies file path (for YouTube authentication)
COOKIES_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'cookies.txt')


@app.route('/')
def index():
    return jsonify({
        'name': 'YouTube Downloader Server',
        'version': '2.0.0',
        'status': 'running',
        'endpoints': {
            'POST /download-async': 'Start async download',
            'GET /status/<task_id>': 'Check download status',
            'GET /download-file/<task_id>': 'Download the video file',
            'GET /health': 'Health check'
        }
    })


@app.route('/health')
def health():
    return jsonify({'status': 'ok'})


@app.route('/download-async', methods=['POST'])
def download_async():
    """
    Start async download and return task ID
    Video will be downloaded to server temp folder
    """
    data = request.get_json()

    if not data:
        return jsonify({'success': False, 'error': 'No data provided'}), 400

    url = data.get('url')

    if not url:
        return jsonify({'success': False, 'error': 'URL is required'}), 400

    # Validate URL (basic check)
    if 'youtube.com' not in url and 'youtu.be' not in url:
        return jsonify({'success': False, 'error': 'Invalid YouTube URL'}), 400

    # Generate task ID
    task_id = str(uuid.uuid4())[:8]
    task_folder = os.path.join(TEMP_DIR, task_id)
    os.makedirs(task_folder, exist_ok=True)

    downloads[task_id] = {
        'status': 'pending',
        'progress': 0,
        'message': 'Starting download...',
        'filename': None,
        'filepath': None,
        'folder': task_folder
    }

    # Start download in background
    thread = threading.Thread(target=run_download, args=(task_id, url, task_folder))
    thread.start()

    return jsonify({
        'success': True,
        'task_id': task_id,
        'message': 'Download started'
    })


def run_download(task_id, url, folder):
    """Background download task"""
    try:
        downloads[task_id]['status'] = 'downloading'
        downloads[task_id]['message'] = 'Fetching video info...'

        output_template = os.path.join(folder, '%(title)s.%(ext)s')

        cmd = [
            'yt-dlp',
            '--no-playlist',
            '-o', output_template,
            '--newline',
            '--progress',
        ]

        # Add cookies if file exists
        if os.path.exists(COOKIES_FILE):
            cmd.extend(['--cookies', COOKIES_FILE])

        cmd.append(url)

        process = subprocess.Popen(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True
        )

        for line in process.stdout:
            # Parse progress
            if '%' in line:
                try:
                    # Match patterns like "50.5%" or "100%"
                    match = re.search(r'(\d+\.?\d*)%', line)
                    if match:
                        percent = float(match.group(1))
                        downloads[task_id]['progress'] = percent
                        downloads[task_id]['message'] = f'Downloading... {percent:.1f}%'
                except:
                    pass

        process.wait()

        if process.returncode == 0:
            # Find downloaded file
            files = os.listdir(folder)
            if files:
                filename = files[0]
                filepath = os.path.join(folder, filename)
                downloads[task_id]['status'] = 'completed'
                downloads[task_id]['progress'] = 100
                downloads[task_id]['message'] = 'Download completed!'
                downloads[task_id]['filename'] = filename
                downloads[task_id]['filepath'] = filepath
            else:
                downloads[task_id]['status'] = 'error'
                downloads[task_id]['message'] = 'File not found after download'
        else:
            stderr_output = process.stderr.read()
            downloads[task_id]['status'] = 'error'
            downloads[task_id]['message'] = stderr_output[:200] if stderr_output else 'Download failed'

    except Exception as e:
        downloads[task_id]['status'] = 'error'
        downloads[task_id]['message'] = str(e)


@app.route('/status/<task_id>')
def status(task_id):
    """Check download status"""
    if task_id not in downloads:
        return jsonify({'success': False, 'error': 'Task not found'}), 404

    task = downloads[task_id]
    return jsonify({
        'success': True,
        'status': task['status'],
        'progress': task['progress'],
        'message': task['message'],
        'filename': task.get('filename'),
        'downloadReady': task['status'] == 'completed' and task.get('filepath') is not None
    })


@app.route('/download-file/<task_id>')
def download_file(task_id):
    """Stream the downloaded file to client"""
    if task_id not in downloads:
        return jsonify({'success': False, 'error': 'Task not found'}), 404

    task = downloads[task_id]

    if task['status'] != 'completed' or not task.get('filepath'):
        return jsonify({'success': False, 'error': 'File not ready'}), 400

    filepath = task['filepath']
    filename = task['filename']

    if not os.path.exists(filepath):
        return jsonify({'success': False, 'error': 'File not found on server'}), 404

    # Send file to client
    response = send_file(
        filepath,
        as_attachment=True,
        download_name=filename
    )

    # Schedule cleanup after sending (optional - keep for a while)
    # cleanup_task(task_id)

    return response


@app.route('/cleanup/<task_id>', methods=['POST'])
def cleanup(task_id):
    """Clean up task files"""
    if task_id in downloads:
        task = downloads[task_id]
        folder = task.get('folder')
        if folder and os.path.exists(folder):
            shutil.rmtree(folder, ignore_errors=True)
        del downloads[task_id]
        return jsonify({'success': True, 'message': 'Cleaned up'})
    return jsonify({'success': False, 'error': 'Task not found'}), 404


if __name__ == '__main__':
    print("=" * 50)
    print("YouTube Downloader Server v2.0")
    print("=" * 50)
    print("Server running at http://localhost:1101")
    print(f"Temp directory: {TEMP_DIR}")
    print("\nEndpoints:")
    print("  POST /download-async - Start download")
    print("  GET /status/<task_id> - Check status")
    print("  GET /download-file/<task_id> - Download file to client")
    print("  POST /cleanup/<task_id> - Clean up task")
    print("=" * 50)

    app.run(host='0.0.0.0', port=1101, debug=True)
