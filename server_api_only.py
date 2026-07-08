#!/usr/bin/env python3
"""Servidor API-only para DocHub (sem servimento de arquivos estáticos)."""

from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from http import cookies
import hashlib
import json
import os
import secrets
import threading
import time
import urllib.parse
from pathlib import Path

import requests

ROOT = Path(__file__).resolve().parent
HOST = os.environ.get('HOST', '0.0.0.0')
PORT = int(os.environ.get('PORT', '8000'))
DATA_DIR = ROOT / '.data'
DATA_DIR.mkdir(exist_ok=True)
USERS_FILE = DATA_DIR / 'users.json'
STATE_FILE = DATA_DIR / 'state.json'
SESSIONS_FILE = DATA_DIR / 'sessions.json'
SESSION_TTL = int(os.environ.get('SESSION_TTL', '86400'))
OPENAI_API_KEY = os.environ.get('OPENAI_API_KEY', '').strip()
GOOGLE_API_KEY = os.environ.get('GOOGLE_API_KEY', '').strip()
ANTHROPIC_API_KEY = os.environ.get('ANTHROPIC_API_KEY', '').strip()

TOKEN_STORE = {}
SESSION_STORE = {}
STATE_LOCK = threading.Lock()


def hash_password(password: str, salt: str) -> str:
    return hashlib.pbkdf2_hmac('sha256', password.encode('utf-8'), salt.encode('utf-8'), 200_000).hex()


def save_json(path: Path, payload):
    with STATE_LOCK:
        path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding='utf-8')


def load_json(path: Path, default):
    if not path.exists():
        return default
    try:
        return json.loads(path.read_text(encoding='utf-8'))
    except Exception:
        return default


def build_default_user_state():
    return {'documents': [], 'examples': [], 'categories': [], 'chat': {'global': [], 'docs': {}}, 'ai': {'model': 'gpt-4o-mini', 'provider': 'openai'}}


def normalize_state_payload(payload):
    if not isinstance(payload, dict):
        return {'users': {}}
    if 'users' in payload and isinstance(payload['users'], dict):
        return payload
    legacy_state = {k: v for k, v in payload.items() if k in ('documents', 'examples', 'categories', 'chat', 'ai')}
    if legacy_state:
        username = os.environ.get('DOC_USERNAME', 'admin').strip() or 'admin'
        return {'users': {username: legacy_state}}
    return {'users': {}}


def ensure_default_user():
    users = load_json(USERS_FILE, {})
    username = os.environ.get('DOC_USERNAME', 'admin').strip() or 'admin'
    password = os.environ.get('DOC_PASSWORD', 'xccdyzla').strip()

    if username not in users:
        print(f'Credenciais iniciais: username={username} password={password}')

    if users and username in users:
        return users

    if users:
        return users

    salt = secrets.token_hex(8)
    users[username] = {'salt': salt, 'password': hash_password(password, salt)}
    save_json(USERS_FILE, users)
    return users


USERS = ensure_default_user()
SESSION_STORE = load_json(SESSIONS_FILE, {})
STATE = normalize_state_payload(load_json(STATE_FILE, build_default_user_state()))


class DocHubAPIHandler(BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        return

    def get_allowed_origin(self):
        origin = self.headers.get('Origin') or ''
        allowed_hosts = {
            'http://127.0.0.1:8000',
            'http://localhost:8000',
            'http://0.0.0.0:8000',
            'https://dochub-roa3.onrender.com',
            'https://frontend-eight-roan-52.vercel.app',
        }
        configured_origin = os.environ.get('CORS_ALLOWED_ORIGIN', '').strip()
        if configured_origin:
            allowed_hosts.add(configured_origin)
        if origin in allowed_hosts:
            return origin
        if not origin:
            return 'https://frontend-eight-roan-52.vercel.app'
        return configured_origin or '*'

    def send_json(self, status_code, data, extra_headers=None):
        body = json.dumps(data, ensure_ascii=False).encode('utf-8')
        self.send_response(status_code)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Access-Control-Allow-Origin', self.get_allowed_origin())
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type, Authorization')
        self.send_header('Access-Control-Allow-Credentials', 'true')
        self.send_header('Vary', 'Origin')
        if extra_headers:
            for name, value in extra_headers:
                self.send_header(name, value)
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def get_session(self):
        global SESSION_STORE
        if not SESSION_STORE:
            SESSION_STORE = load_json(SESSIONS_FILE, {})
        cookie_header = self.headers.get('Cookie', '')
        if not cookie_header:
            return None
        jar = cookies.SimpleCookie(cookie_header)
        token = jar.get('doc_session')
        if not token:
            return None
        session = SESSION_STORE.get(token.value)
        if not session:
            return None
        if session.get('expires_at', 0) < int(time.time()):
            SESSION_STORE.pop(token.value, None)
            save_json(SESSIONS_FILE, SESSION_STORE)
            return None
        return session

    def get_session_or_default(self):
        session = self.get_session()
        if session:
            return session
        username = os.environ.get('DOC_USERNAME', 'admin').strip() or 'admin'
        return {'username': username}

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header('Access-Control-Allow-Origin', self.get_allowed_origin())
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type, Authorization')
        self.send_header('Access-Control-Allow-Credentials', 'true')
        self.send_header('Vary', 'Origin')
        self.end_headers()

    def do_GET(self):
        path = urllib.parse.urlparse(self.path).path
        if path in ('/health', '/api/health'):
            self.send_json(200, {'status': 'online', 'service': 'DocHub API'})
            return
        self.send_json(404, {'success': False, 'error': 'Rota não encontrada'})

    def do_POST(self):
        path = urllib.parse.urlparse(self.path).path
        content_length = int(self.headers.get('Content-Length', 0))
        body = self.rfile.read(content_length).decode('utf-8') if content_length else '{}'
        try:
            data = json.loads(body) if body else {}
        except json.JSONDecodeError:
            self.send_json(400, {'success': False, 'error': 'JSON inválido'})
            return

        if path in ('/validate', '/api/validate'):
            self.handle_validate(data)
        elif path in ('/chat', '/api/chat'):
            self.handle_chat(data)
        else:
            self.send_json(404, {'success': False, 'error': 'Rota não encontrada'})

    def detect_provider(self, provider, model, api_key):
        normalized_provider = (provider or '').strip().lower()
        if normalized_provider in {'genai', 'gemini', 'google', 'googleai', 'google-generative-ai'}:
            return 'genai'
        if normalized_provider in {'openai', 'gpt', 'chatgpt'}:
            return 'openai'
        if normalized_provider in {'anthropic', 'claude'}:
            return 'anthropic'
        if (api_key or '').strip().startswith('AIza'):
            return 'genai'
        if (api_key or '').strip().startswith(('sk-', 'sk-proj-', 'sk-ant-', 'gsk_')):
            return 'openai'
        model_name = (model or '').strip().lower()
        if 'gemini' in model_name or 'gemma' in model_name:
            return 'genai'
        if 'claude' in model_name or 'anthropic' in model_name:
            return 'anthropic'
        return 'openai'

    def handle_validate(self, data):
        self.get_session_or_default()
        provider = self.detect_provider((data.get('provider') or '').lower(), (data.get('model') or '').strip(), (data.get('api_key') or '').strip())
        model = (data.get('model') or '').strip() or ('gpt-4o-mini' if provider != 'genai' else 'gemini-2.0-flash')
        api_key = (data.get('api_key') or '').strip()
        if provider == 'genai':
            effective_key = api_key or GOOGLE_API_KEY
            if not effective_key:
                self.send_json(200, {'valid': False, 'error': 'Google API key não configurada no servidor'})
                return
            try:
                response = requests.get(f'https://generativelanguage.googleapis.com/v1beta/models?key={effective_key}', timeout=20)
                ok = response.status_code == 200
                self.send_json(200, {'valid': ok, 'error': None if ok else response.text[:200]})
            except Exception as exc:
                self.send_json(200, {'valid': False, 'error': str(exc)[:200]})
            return
        if provider == 'anthropic':
            effective_key = api_key or ANTHROPIC_API_KEY
            if not effective_key:
                self.send_json(200, {'valid': False, 'error': 'Anthropic API key não configurada no servidor'})
                return
            try:
                response = requests.get('https://api.anthropic.com/v1/models', headers={'x-api-key': effective_key, 'anthropic-version': '2023-06-01'}, timeout=20)
                ok = response.status_code == 200
                self.send_json(200, {'valid': ok, 'error': None if ok else response.text[:200]})
            except Exception as exc:
                self.send_json(200, {'valid': False, 'error': str(exc)[:200]})
            return
        effective_key = api_key or OPENAI_API_KEY
        if not effective_key:
            self.send_json(200, {'valid': False, 'error': 'OpenAI API key não configurada no servidor'})
            return
        try:
            response = requests.get('https://api.openai.com/v1/models', headers={'Authorization': f'Bearer {effective_key}'}, timeout=20)
            ok = response.status_code == 200
            self.send_json(200, {'valid': ok, 'error': None if ok else response.text[:200]})
        except Exception as exc:
            self.send_json(200, {'valid': False, 'error': str(exc)[:200]})

    def handle_chat(self, data):
        self.get_session_or_default()
        provider = self.detect_provider((data.get('provider') or '').lower(), (data.get('model') or '').strip(), (data.get('api_key') or '').strip())
        model = (data.get('model') or '').strip() or ('gpt-4o-mini' if provider != 'genai' else 'gemini-2.0-flash')
        message = (data.get('message') or '').strip()
        system_prompt = (data.get('system_prompt') or '').strip() or 'Você é um assistente útil.'
        api_key = (data.get('api_key') or '').strip()
        if not message:
            self.send_json(400, {'success': False, 'error': 'Mensagem vazia'})
            return
        if provider == 'genai':
            effective_key = api_key or GOOGLE_API_KEY
            if not effective_key:
                self.send_json(200, {'success': False, 'error': 'Google API key não configurada no servidor'})
                return
            try:
                response = requests.post(f'https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={effective_key}', json={'contents': [{'parts': [{'text': f'{system_prompt}\n\nUsuário: {message}'}]}]}, timeout=30)
                if response.status_code != 200:
                    self.send_json(200, {'success': False, 'error': response.text[:500]})
                    return
                payload = response.json()
                text = payload.get('candidates', [{}])[0].get('content', {}).get('parts', [{}])[0].get('text', '')
                self.send_json(200, {'success': True, 'response': text or 'Sem resposta disponível.'})
            except Exception as exc:
                self.send_json(200, {'success': False, 'error': str(exc)[:500]})
            return
        if provider == 'anthropic':
            effective_key = api_key or ANTHROPIC_API_KEY
            if not effective_key:
                self.send_json(200, {'success': False, 'error': 'Anthropic API key não configurada no servidor'})
                return
            try:
                response = requests.post('https://api.anthropic.com/v1/messages', headers={'x-api-key': effective_key, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json'}, json={'model': model, 'max_tokens': 400, 'messages': [{'role': 'user', 'content': f'{system_prompt}\n\nUsuário: {message}'}]}, timeout=30)
                if response.status_code != 200:
                    self.send_json(200, {'success': False, 'error': response.text[:500]})
                    return
                payload = response.json()
                text = ''
                for block in payload.get('content', []) or []:
                    if isinstance(block, dict) and isinstance(block.get('text'), str):
                        text += block['text']
                self.send_json(200, {'success': True, 'response': text or 'Sem resposta disponível.'})
            except Exception as exc:
                self.send_json(200, {'success': False, 'error': str(exc)[:500]})
            return
        effective_key = api_key or OPENAI_API_KEY
        if not effective_key:
            self.send_json(200, {'success': False, 'error': 'OpenAI API key não configurada no servidor'})
            return
        try:
            prompt_messages = []
            if system_prompt:
                prompt_messages.append({'role': 'system', 'content': system_prompt})
            prompt_messages.append({'role': 'user', 'content': message})
            response = requests.post('https://api.openai.com/v1/chat/completions', headers={'Authorization': f'Bearer {effective_key}', 'Content-Type': 'application/json'}, json={'model': model, 'messages': prompt_messages, 'temperature': 0.7}, timeout=30)
            if response.status_code != 200:
                self.send_json(200, {'success': False, 'error': response.text[:500]})
                return
            payload = response.json()
            text = payload.get('choices', [{}])[0].get('message', {}).get('content', '')
            self.send_json(200, {'success': True, 'response': text or 'Sem resposta disponível.'})
        except Exception as exc:
            self.send_json(200, {'success': False, 'error': str(exc)[:500]})


def run_server():
    server = ThreadingHTTPServer((HOST, PORT), DocHubAPIHandler)
    print(f'\n✅ Servidor DocHub API rodando em http://{HOST}:{PORT}')
    print('Pressione Ctrl+C para parar')
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print('\nServidor encerrado')


if __name__ == '__main__':
    run_server()
