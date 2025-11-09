#!/usr/bin/env python3
"""
Warp Account Manager - 本地 HTTP API 服务
为 Surge Module 和 BoxJS 提供数据库访问接口
"""

import os
import json
import sqlite3
from http.server import HTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs
import threading

# 数据库路径
DB_PATH = os.path.expanduser("~/Library/Application Support/WarpAccountManager/accounts.db")

class WarpAPIHandler(BaseHTTPRequestHandler):
    """处理 HTTP 请求的处理器"""
    
    def _send_cors_headers(self):
        """发送 CORS 头"""
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
    
    def _send_json_response(self, data, status=200):
        """发送 JSON 响应"""
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self._send_cors_headers()
        self.end_headers()
        self.wfile.write(json.dumps(data, ensure_ascii=False).encode('utf-8'))
    
    def _send_error_response(self, message, status=500):
        """发送错误响应"""
        self._send_json_response({'error': message, 'success': False}, status)
    
    def do_OPTIONS(self):
        """处理 OPTIONS 请求（CORS 预检）"""
        self.send_response(200)
        self._send_cors_headers()
        self.end_headers()
    
    def do_GET(self):
        """处理 GET 请求"""
        parsed_path = urlparse(self.path)
        path = parsed_path.path
        
        try:
            conn = sqlite3.connect(DB_PATH)
            conn.row_factory = sqlite3.Row
            cursor = conn.cursor()
            
            # 获取所有账号
            if path == '/accounts':
                cursor.execute("""
                    SELECT email, is_active, is_banned, last_used, 
                           CASE WHEN token IS NOT NULL THEN 1 ELSE 0 END as has_token
                    FROM accounts 
                    ORDER BY is_active DESC, last_used DESC
                """)
                accounts = [dict(row) for row in cursor.fetchall()]
                self._send_json_response({'accounts': accounts, 'success': True})
            
            # 获取活跃账号
            elif path == '/active-account':
                cursor.execute("""
                    SELECT email, token, last_used
                    FROM accounts 
                    WHERE is_active = 1 AND is_banned = 0
                    LIMIT 1
                """)
                row = cursor.fetchone()
                if row:
                    self._send_json_response({
                        'email': row['email'],
                        'token': row['token'],
                        'last_used': row['last_used'],
                        'success': True
                    })
                else:
                    self._send_error_response('没有找到活跃账号', 404)
            
            # 获取账号详情
            elif path.startswith('/account/'):
                email = path.split('/')[-1]
                cursor.execute("""
                    SELECT email, token, is_active, is_banned, last_used, added_at
                    FROM accounts 
                    WHERE email = ?
                """, (email,))
                row = cursor.fetchone()
                if row:
                    self._send_json_response({**dict(row), 'success': True})
                else:
                    self._send_error_response('账号不存在', 404)
            
            # 获取统计信息
            elif path == '/stats':
                cursor.execute("""
                    SELECT 
                        COUNT(*) as total,
                        SUM(CASE WHEN is_active = 1 THEN 1 ELSE 0 END) as active,
                        SUM(CASE WHEN is_banned = 1 THEN 1 ELSE 0 END) as banned
                    FROM accounts
                """)
                stats = dict(cursor.fetchone())
                self._send_json_response({**stats, 'success': True})
            
            else:
                self._send_error_response('未找到接口', 404)
            
            conn.close()
            
        except Exception as e:
            self._send_error_response(f'数据库错误: {str(e)}', 500)
    
    def do_POST(self):
        """处理 POST 请求"""
        parsed_path = urlparse(self.path)
        path = parsed_path.path
        
        # 读取请求体
        content_length = int(self.headers.get('Content-Length', 0))
        body = self.rfile.read(content_length).decode('utf-8') if content_length > 0 else '{}'
        
        try:
            data = json.loads(body) if body else {}
        except json.JSONDecodeError:
            self._send_error_response('无效的 JSON 数据', 400)
            return
        
        try:
            conn = sqlite3.connect(DB_PATH)
            conn.row_factory = sqlite3.Row
            cursor = conn.cursor()
            
            # 切换账号
            if path == '/switch-account':
                # 获取当前活跃账号
                cursor.execute("SELECT email FROM accounts WHERE is_active = 1 LIMIT 1")
                current = cursor.fetchone()
                current_email = current['email'] if current else None
                
                # 取消所有账号的活跃状态
                cursor.execute("UPDATE accounts SET is_active = 0")
                
                # 找到下一个可用账号（未 ban 且不是当前账号）
                cursor.execute("""
                    SELECT email, token 
                    FROM accounts 
                    WHERE is_banned = 0 AND email != COALESCE(?, '')
                    ORDER BY last_used ASC
                    LIMIT 1
                """, (current_email,))
                
                next_account = cursor.fetchone()
                if next_account:
                    cursor.execute("""
                        UPDATE accounts 
                        SET is_active = 1, last_used = datetime('now')
                        WHERE email = ?
                    """, (next_account['email'],))
                    conn.commit()
                    
                    self._send_json_response({
                        'email': next_account['email'],
                        'token': next_account['token'],
                        'message': f'已切换到账号: {next_account["email"]}',
                        'success': True
                    })
                else:
                    self._send_error_response('没有可用的账号', 404)
            
            # 激活指定账号
            elif path == '/activate-account':
                email = data.get('email')
                if not email:
                    self._send_error_response('缺少 email 参数', 400)
                    return
                
                # 取消所有账号的活跃状态
                cursor.execute("UPDATE accounts SET is_active = 0")
                
                # 激活指定账号
                cursor.execute("""
                    UPDATE accounts 
                    SET is_active = 1, last_used = datetime('now')
                    WHERE email = ? AND is_banned = 0
                """, (email,))
                
                if cursor.rowcount > 0:
                    conn.commit()
                    cursor.execute("SELECT token FROM accounts WHERE email = ?", (email,))
                    row = cursor.fetchone()
                    self._send_json_response({
                        'email': email,
                        'token': row['token'],
                        'message': f'已激活账号: {email}',
                        'success': True
                    })
                else:
                    self._send_error_response('账号不存在或已被 ban', 404)
            
            # 标记账号为 banned
            elif path == '/ban-account':
                email = data.get('email')
                if not email:
                    self._send_error_response('缺少 email 参数', 400)
                    return
                
                cursor.execute("""
                    UPDATE accounts 
                    SET is_banned = 1, is_active = 0
                    WHERE email = ?
                """, (email,))
                conn.commit()
                
                self._send_json_response({
                    'message': f'账号 {email} 已标记为 banned',
                    'success': True
                })
            
            # 添加新账号
            elif path == '/add-account':
                email = data.get('email')
                token = data.get('token')
                
                if not email or not token:
                    self._send_error_response('缺少 email 或 token 参数', 400)
                    return
                
                try:
                    cursor.execute("""
                        INSERT INTO accounts (email, token, is_active, is_banned, added_at, last_used)
                        VALUES (?, ?, 0, 0, datetime('now'), datetime('now'))
                    """, (email, token))
                    conn.commit()
                    
                    self._send_json_response({
                        'message': f'账号 {email} 已添加',
                        'success': True
                    })
                except sqlite3.IntegrityError:
                    # 账号已存在，更新 token
                    cursor.execute("""
                        UPDATE accounts 
                        SET token = ?, last_used = datetime('now')
                        WHERE email = ?
                    """, (token, email))
                    conn.commit()
                    
                    self._send_json_response({
                        'message': f'账号 {email} 的 token 已更新',
                        'success': True
                    })
            
            # 删除账号
            elif path == '/delete-account':
                email = data.get('email')
                if not email:
                    self._send_error_response('缺少 email 参数', 400)
                    return
                
                cursor.execute("DELETE FROM accounts WHERE email = ?", (email,))
                conn.commit()
                
                self._send_json_response({
                    'message': f'账号 {email} 已删除',
                    'success': True
                })
            
            else:
                self._send_error_response('未找到接口', 404)
            
            conn.close()
            
        except Exception as e:
            self._send_error_response(f'数据库错误: {str(e)}', 500)
    
    def log_message(self, format, *args):
        """自定义日志格式"""
        print(f"[API] {self.address_string()} - {format % args}")


def start_api_server(host='127.0.0.1', port=8888):
    """启动 API 服务器"""
    # 确保数据库存在
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    if not os.path.exists(DB_PATH):
        conn = sqlite3.connect(DB_PATH)
        cursor = conn.cursor()
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS accounts (
                email TEXT PRIMARY KEY,
                token TEXT NOT NULL,
                is_active INTEGER DEFAULT 0,
                is_banned INTEGER DEFAULT 0,
                added_at TEXT,
                last_used TEXT
            )
        """)
        conn.commit()
        conn.close()
        print(f"✅ 数据库已创建: {DB_PATH}")
    
    server = HTTPServer((host, port), WarpAPIHandler)
    print(f"🚀 Warp API 服务器启动在 http://{host}:{port}")
    print(f"📁 数据库路径: {DB_PATH}")
    print("=" * 60)
    
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n⏹️  服务器已停止")
        server.shutdown()


if __name__ == '__main__':
    start_api_server()
