#!/bin/bash

# MS5.0 Simple Web Server - No Docker Required
# This creates a basic Python web server to test the database

echo "================================================"
echo "   MS5.0 Simple Web Interface (Python)"
echo "================================================"
echo ""

# Check Python
if ! command -v python3 &> /dev/null; then
    echo "Python3 not found. Installing..."
    apt-get update && apt-get install -y python3 python3-pip
fi

# Install required packages
pip3 install flask psycopg2-binary redis flask-cors

# Detect ports
POSTGRES_PORT=5432
REDIS_PORT=6379

if ! nc -zv localhost 5432 2>&1 | grep -q succeeded; then
    POSTGRES_PORT=5433
fi

if ! nc -zv localhost 6379 2>&1 | grep -q succeeded; then
    REDIS_PORT=6380
fi

echo "Using PostgreSQL on port ${POSTGRES_PORT}"
echo "Using Redis on port ${REDIS_PORT}"

# Create Python web application
mkdir -p /opt/ms5/web
cd /opt/ms5/web

cat > app.py << EOF
from flask import Flask, jsonify, request, send_from_directory
from flask_cors import CORS
import psycopg2
import json
from datetime import datetime

app = Flask(__name__)
CORS(app)

# Database configuration
DB_CONFIG = {
    'host': 'localhost',
    'port': ${POSTGRES_PORT},
    'database': 'ms5db',
    'user': 'ms5user',
    'password': 'ms5pass'
}

def get_db():
    return psycopg2.connect(**DB_CONFIG)

@app.route('/')
def index():
    html = '''
    <!DOCTYPE html>
    <html>
    <head>
        <title>MS5.0 Dashboard</title>
        <style>
            body {
                font-family: Arial, sans-serif;
                background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                color: white;
                padding: 20px;
            }
            .container {
                max-width: 1200px;
                margin: 0 auto;
            }
            .card {
                background: white;
                color: #333;
                padding: 20px;
                margin: 20px 0;
                border-radius: 10px;
                box-shadow: 0 4px 6px rgba(0,0,0,0.1);
            }
            .status {
                display: inline-block;
                padding: 5px 15px;
                border-radius: 20px;
                margin: 5px;
            }
            .online { background: #4ade80; color: white; }
            .offline { background: #f87171; color: white; }
            table {
                width: 100%;
                border-collapse: collapse;
            }
            th, td {
                padding: 10px;
                text-align: left;
                border-bottom: 1px solid #ddd;
            }
            button {
                background: #667eea;
                color: white;
                border: none;
                padding: 10px 20px;
                border-radius: 5px;
                cursor: pointer;
            }
        </style>
    </head>
    <body>
        <div class="container">
            <h1>🏭 MS5.0 Manufacturing System</h1>

            <div class="card">
                <h2>System Status</h2>
                <span class="status online" id="dbStatus">Database: Checking...</span>
                <span class="status online" id="apiStatus">API: Online</span>
                <p>Server Time: <span id="serverTime"></span></p>
            </div>

            <div class="card">
                <h2>Production Lines</h2>
                <table id="linesTable">
                    <thead>
                        <tr>
                            <th>Name</th>
                            <th>Area</th>
                            <th>Status</th>
                        </tr>
                    </thead>
                    <tbody id="linesBody">
                        <tr><td colspan="3">Loading...</td></tr>
                    </tbody>
                </table>
            </div>

            <div class="card">
                <h2>Users</h2>
                <table id="usersTable">
                    <thead>
                        <tr>
                            <th>Name</th>
                            <th>Email</th>
                            <th>Role</th>
                        </tr>
                    </thead>
                    <tbody id="usersBody">
                        <tr><td colspan="3">Loading...</td></tr>
                    </tbody>
                </table>
            </div>

            <div class="card">
                <h2>Actions</h2>
                <button onclick="refreshData()">Refresh Data</button>
                <button onclick="testConnection()">Test Database</button>
            </div>
        </div>

        <script>
            async function loadData() {
                // Load production lines
                try {
                    const linesResponse = await fetch('/api/production-lines');
                    const lines = await linesResponse.json();

                    const linesBody = document.getElementById('linesBody');
                    linesBody.innerHTML = lines.map(line => \`
                        <tr>
                            <td>\${line[1]}</td>
                            <td>\${line[2] || 'N/A'}</td>
                            <td><span class="status \${line[3] === 'active' ? 'online' : 'offline'}">\${line[3]}</span></td>
                        </tr>
                    \`).join('');
                } catch (err) {
                    console.error('Error loading lines:', err);
                }

                // Load users
                try {
                    const usersResponse = await fetch('/api/users');
                    const users = await usersResponse.json();

                    const usersBody = document.getElementById('usersBody');
                    usersBody.innerHTML = users.map(user => \`
                        <tr>
                            <td>\${user[2]}</td>
                            <td>\${user[1]}</td>
                            <td>\${user[3]}</td>
                        </tr>
                    \`).join('');
                } catch (err) {
                    console.error('Error loading users:', err);
                }

                // Update server time
                document.getElementById('serverTime').textContent = new Date().toLocaleString();
            }

            async function testConnection() {
                try {
                    const response = await fetch('/api/health');
                    const data = await response.json();
                    alert('Database Status: ' + data.database);
                } catch (err) {
                    alert('Connection failed: ' + err.message);
                }
            }

            function refreshData() {
                loadData();
            }

            // Load data on page load
            loadData();

            // Auto-refresh every 10 seconds
            setInterval(loadData, 10000);
        </script>
    </body>
    </html>
    '''
    return html

@app.route('/api/health')
def health():
    try:
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute('SELECT NOW()')
        db_time = cursor.fetchone()[0]
        conn.close()
        return jsonify({
            'status': 'ok',
            'database': 'connected',
            'db_time': str(db_time),
            'timestamp': datetime.now().isoformat()
        })
    except Exception as e:
        return jsonify({
            'status': 'error',
            'database': str(e),
            'timestamp': datetime.now().isoformat()
        })

@app.route('/api/production-lines')
def production_lines():
    try:
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute('SELECT * FROM production_lines ORDER BY name')
        lines = cursor.fetchall()
        conn.close()
        return jsonify(lines)
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/users')
def users():
    try:
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute('SELECT id, email, name, role FROM users ORDER BY name')
        users = cursor.fetchall()
        conn.close()
        return jsonify(users)
    except Exception as e:
        return jsonify({'error': str(e)}), 500

if __name__ == '__main__':
    print('MS5.0 Web Interface starting...')
    print('Access at: http://localhost:4000')
    app.run(host='0.0.0.0', port=4000, debug=True)
EOF

echo ""
echo "Starting Python web server..."

# Kill any existing process on port 4000
fuser -k 4000/tcp 2>/dev/null || true

# Start the Flask app
cd /opt/ms5/web
nohup python3 app.py > /opt/ms5/web.log 2>&1 &
echo $! > /opt/ms5/web.pid

sleep 3

# Check if running
if ps -p $(cat /opt/ms5/web.pid) > /dev/null 2>&1; then
    echo "✅ Web server started (PID: $(cat /opt/ms5/web.pid))"
else
    echo "❌ Failed to start. Check /opt/ms5/web.log"
    tail -20 /opt/ms5/web.log
fi

# Get system IP
SYSTEM_IP=$(hostname -I | awk '{print $1}')

echo ""
echo "================================================"
echo "   Web Interface Ready!"
echo "================================================"
echo ""
echo "🌐 Access the dashboard at:"
echo "   Local:    http://localhost:4000"
echo "   Network:  http://${SYSTEM_IP}:4000"
echo ""
echo "📊 Features:"
echo "   • Live production line status"
echo "   • User management view"
echo "   • Database connection status"
echo "   • Auto-refresh every 10 seconds"
echo ""
echo "🔧 Management:"
echo "   Stop server:  kill \$(cat /opt/ms5/web.pid)"
echo "   View logs:    tail -f /opt/ms5/web.log"
echo "   Restart:      bash $0"
echo ""

# Test connection
echo "Testing connection..."
if curl -s http://localhost:4000/api/health | grep -q "ok"; then
    echo "✅ API is responding correctly"
else
    echo "⚠️  API may still be starting. Wait a few seconds and try again."
fi