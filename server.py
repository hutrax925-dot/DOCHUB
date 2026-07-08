#!/usr/bin/env python3
"""Servidor único, seguro e persistente para DocHub."""

from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from http import cookies
import hashlib
import json
import mimetypes
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
TOKEN_TTL_SECONDS = int(os.environ.get(
    'DESKMANAGER_TOKEN_TTL', str(8 * 60 * 60)))
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
        path.write_text(json.dumps(payload, ensure_ascii=False,
                        indent=2), encoding='utf-8')


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
    legacy_state = {k: v for k, v in payload.items() if k in (
        'documents', 'examples', 'categories', 'chat', 'ai')}
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
STATE = normalize_state_payload(
    load_json(STATE_FILE, build_default_user_state()))


class DocHubHandler(BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        return

    def get_allowed_origin(self):
        origin = self.headers.get('Origin') or ''
        allowed_hosts = {
            'http://127.0.0.1:8000',
            'http://localhost:8000',
            'http://0.0.0.0:8000',
            'http://127.0.0.1',
            'http://localhost',
            'http://0.0.0.0',
            'https://127.0.0.1',
            'https://localhost',
            'https://0.0.0.0',
            'https://127.0.0.1:8000',
            'https://localhost:8000',
        }
        configured_origin = os.environ.get('CORS_ALLOWED_ORIGIN', '').strip()
        if configured_origin:
            allowed_hosts.add(configured_origin)
        if origin in allowed_hosts:
            return origin
        if not origin:
            return 'http://127.0.0.1:8000'
        return configured_origin or 'http://127.0.0.1:8000'

    def send_json(self, status_code, data, extra_headers=None):
        body = json.dumps(data, ensure_ascii=False).encode('utf-8')
        self.send_response(status_code)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Access-Control-Allow-Origin',
                         self.get_allowed_origin())
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers',
                         'Content-Type, Authorization')
        self.send_header('Access-Control-Allow-Credentials', 'true')
        self.send_header('Vary', 'Origin')
        if extra_headers:
            for name, value in extra_headers:
                self.send_header(name, value)
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def serve_file(self, file_path: Path, extra_headers=None):
        if not file_path.exists() or not file_path.is_file():
            self.send_json(
                404, {'success': False, 'error': 'Arquivo não encontrado'})
            return
        content_type = mimetypes.guess_type(
            str(file_path))[0] or 'application/octet-stream'
        body = file_path.read_bytes()
        self.send_response(200)
        self.send_header('Content-Type', content_type)
        self.send_header('Cache-Control', 'no-store')
        self.send_header('Access-Control-Allow-Origin',
                         self.get_allowed_origin())
        self.send_header('Access-Control-Allow-Credentials', 'true')
        self.send_header('Vary', 'Origin')
        if extra_headers:
            for name, value in extra_headers:
                self.send_header(name, value)
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header('Access-Control-Allow-Origin',
                         self.get_allowed_origin())
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers',
                         'Content-Type, Authorization')
        self.send_header('Access-Control-Allow-Credentials', 'true')
        self.send_header('Vary', 'Origin')
        self.end_headers()

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

    def require_auth(self):
        session = self.get_session()
        if not session:
            self.send_json(401, {'success': False, 'error': 'Não autenticado'})
            return None
        return session

    def get_session_or_default(self):
        session = self.get_session()
        if session:
            return session
        username = os.environ.get('DOC_USERNAME', 'admin').strip() or 'admin'
        return {'username': username}

    def create_session_cookie(self, username: str):
        global SESSION_STORE
        token = secrets.token_urlsafe(24)
        SESSION_STORE[token] = {'username': username,
                                'expires_at': int(time.time()) + SESSION_TTL}
        save_json(SESSIONS_FILE, SESSION_STORE)
        cookie = cookies.SimpleCookie()
        cookie['doc_session'] = token
        cookie['doc_session']['httponly'] = True
        cookie['doc_session']['samesite'] = 'Lax'
        cookie['doc_session']['path'] = '/'
        return cookie['doc_session'].OutputString()

    def clear_session_cookie(self):
        cookie = cookies.SimpleCookie()
        cookie['doc_session'] = ''
        cookie['doc_session']['expires'] = 'Thu, 01 Jan 1970 00:00:00 GMT'
        cookie['doc_session']['path'] = '/'
        return cookie['doc_session'].OutputString()

    def do_GET(self):
        path = urllib.parse.urlparse(self.path).path
        if path in ('/health', '/api/health'):
            self.send_json(200, {'status': 'online', 'service': 'DocHub'})
            return
        if path in ('/api/auth/me', '/api/auth/status'):
            session = self.get_session_or_default()
            self.send_json(200, {'success': True, 'user': session['username']})
            return
        if path == '/api/data':
            session = self.get_session_or_default()
            self.send_json(
                200, {'success': True, 'data': self.get_user_state(session['username'])})
            return
        if path == '/chat':
            self.serve_file(ROOT / 'chat.html')
            return
        if path in ('/', '/index.html'):
            self.serve_file(ROOT / 'index.html')
            return
        if path.startswith('/deskmanager/'):
            self.handle_deskmanager_get(path)
            return
        requested = (ROOT / path.lstrip('/')).resolve()
        if requested.exists() and requested.is_file() and str(requested).startswith(str(ROOT)):
            self.serve_file(requested)
            return
        self.send_json(404, {'success': False, 'error': 'Rota não encontrada'})

    def do_POST(self):
        path = urllib.parse.urlparse(self.path).path
        content_length = int(self.headers.get('Content-Length', 0))
        body = self.rfile.read(content_length).decode(
            'utf-8') if content_length else '{}'
        try:
            data = json.loads(body) if body else {}
        except json.JSONDecodeError:
            self.send_json(400, {'success': False, 'error': 'JSON inválido'})
            return

        if path in ('/api/auth/login', '/api/auth/register'):
            self.handle_auth(path, data)
        elif path == '/api/auth/logout':
            self.send_json(200, {'success': True}, extra_headers=[
                           ('Set-Cookie', self.clear_session_cookie())])
        elif path == '/api/data':
            session = self.get_session_or_default()
            self.handle_state_update(data, session)
        elif path in ('/validate', '/api/validate'):
            self.handle_validate(data)
        elif path in ('/chat', '/api/chat'):
            self.handle_chat(data)
        elif path in ('/set_summary_system_prompt', '/api/set_summary_system_prompt', '/set_system_prompt', '/api/set_system_prompt'):
            self.handle_ai_settings(data)
        elif path.startswith('/deskmanager/'):
            self.handle_deskmanager_post(path, data)
        else:
            self.send_json(
                404, {'success': False, 'error': 'Rota não encontrada'})

    def handle_auth(self, path, data):
        username = (data.get('username') or '').strip()
        password = (data.get('password') or '').strip()
        if not username or not password:
            self.send_json(
                400, {'success': False, 'error': 'Usuário e senha são obrigatórios'})
            return
        global USERS
        if path.endswith('/register'):
            if username in USERS:
                self.send_json(
                    409, {'success': False, 'error': 'Usuário já existe'})
                return
            salt = secrets.token_hex(8)
            USERS[username] = {'salt': salt,
                               'password': hash_password(password, salt)}
            save_json(USERS_FILE, USERS)
            self.get_user_state(username)
            self.send_json(200, {'success': True, 'message': 'Usuário criado'})
            return
        record = USERS.get(username)
        if not record:
            self.send_json(
                401, {'success': False, 'error': 'Credenciais inválidas'})
            return
        if record['password'] != hash_password(password, record['salt']):
            self.send_json(
                401, {'success': False, 'error': 'Credenciais inválidas'})
            return
        self.send_json(200, {'success': True, 'user': username}, extra_headers=[
                       ('Set-Cookie', self.create_session_cookie(username))])

    def get_user_state(self, username):
        global STATE
        with STATE_LOCK:
            users_state = STATE.get(
                'users', {}) if isinstance(STATE, dict) else {}
            if not isinstance(users_state, dict):
                users_state = {}
            username_key = str(username or '').strip() or 'default'
            if username_key not in users_state:
                users_state[username_key] = build_default_user_state()
                STATE['users'] = users_state
                save_json(STATE_FILE, STATE)
            return users_state[username_key]

    def handle_state_update(self, data, session):
        kind = (data.get('kind') or '').strip()
        if not kind:
            self.send_json(
                400, {'success': False, 'error': 'kind obrigatório'})
            return
        username = (session.get('username') or '').strip() or 'default'

        def preserve_existing_if_empty(current_value, incoming_value, default_value=None):
            if isinstance(incoming_value, list):
                if incoming_value:
                    return incoming_value
                if current_value is None:
                    return default_value if default_value is not None else []
                return current_value
            if incoming_value is None:
                return current_value if current_value is not None else (default_value if default_value is not None else [])
            return incoming_value

        with STATE_LOCK:
            users_state = STATE.get(
                'users', {}) if isinstance(STATE, dict) else {}
            if not isinstance(users_state, dict):
                users_state = {}
            user_state = users_state.get(username)
            if not isinstance(user_state, dict):
                user_state = build_default_user_state()
            if kind == 'documents':
                current_documents = user_state.get('documents', [])
                incoming_documents = data.get('data', current_documents)
                user_state['documents'] = preserve_existing_if_empty(
                    current_documents, incoming_documents, [])
            elif kind == 'examples':
                current_examples = user_state.get('examples', [])
                incoming_examples = data.get('data', current_examples)
                user_state['examples'] = preserve_existing_if_empty(
                    current_examples, incoming_examples, [])
            elif kind == 'categories':
                current_categories = user_state.get('categories', [])
                incoming_categories = data.get('data', current_categories)
                user_state['categories'] = preserve_existing_if_empty(
                    current_categories, incoming_categories, [])
            elif kind == 'chat':
                current_chat = user_state.get(
                    'chat', {'global': [], 'docs': {}})
                incoming_chat = data.get('data', current_chat)
                if isinstance(incoming_chat, dict) and incoming_chat:
                    user_state['chat'] = {**current_chat, **incoming_chat}
                else:
                    user_state['chat'] = current_chat if current_chat else {
                        'global': [], 'docs': {}}
            elif kind == 'ai':
                current_ai = user_state.get(
                    'ai', {'model': 'gpt-4o-mini', 'provider': 'openai'})
                incoming_ai = data.get('data', current_ai)
                if isinstance(incoming_ai, dict) and incoming_ai:
                    sanitized_current = {
                        k: v for k, v in current_ai.items() if k not in ('apiKey', 'api_key')
                    }
                    sanitized_incoming = {
                        k: v for k, v in incoming_ai.items() if k not in ('apiKey', 'api_key')
                    }
                    user_state['ai'] = {
                        **sanitized_current, **sanitized_incoming}
                else:
                    user_state['ai'] = current_ai if current_ai else {
                        'model': 'gpt-4o-mini', 'provider': 'openai'}
            else:
                self.send_json(
                    400, {'success': False, 'error': 'kind inválido'})
                return
            users_state[username] = user_state
            STATE['users'] = users_state
            save_json(STATE_FILE, STATE)
        self.send_json(200, {'success': True})

    def handle_ai_settings(self, data):
        session = self.get_session_or_default()
        username = (session.get('username') or '').strip() or 'default'
        global STATE
        with STATE_LOCK:
            users_state = STATE.get(
                'users', {}) if isinstance(STATE, dict) else {}
            if not isinstance(users_state, dict):
                users_state = {}
            ai_state = users_state.get(username, build_default_user_state())
            ai_data = ai_state.get('ai', {}) if isinstance(
                ai_state.get('ai', {}), dict) else {}
            ai_data = {
                k: v for k, v in ai_data.items() if k not in ('apiKey', 'api_key')
            }
            if 'summary_system_prompt' in data:
                ai_data['summarySystemPrompt'] = str(
                    data.get('summary_system_prompt', '')).strip()
            if 'model' in data:
                ai_data['model'] = str(data.get('model', '')).strip()
            if 'provider' in data:
                ai_data['provider'] = str(data.get('provider', '')).strip()
            if 'commands' in data:
                ai_data['commands'] = data.get('commands', {})
            ai_state['ai'] = ai_data
            users_state[username] = ai_state
            STATE['users'] = users_state
            save_json(STATE_FILE, STATE)
        self.send_json(200, {'success': True, 'saved': True})

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
        provider = self.detect_provider((data.get('provider') or '').lower(
        ), (data.get('model') or '').strip(), (data.get('api_key') or '').strip())
        model = (data.get('model') or '').strip() or (
            'gpt-4o-mini' if provider != 'genai' else 'gemini-2.0-flash')
        api_key = (data.get('api_key') or '').strip()
        if provider == 'genai':
            effective_key = api_key or GOOGLE_API_KEY
            if not effective_key:
                self.send_json(
                    200, {'valid': False, 'error': 'Google API key não configurada no servidor'})
                return
            try:
                response = requests.get(
                    f'https://generativelanguage.googleapis.com/v1beta/models?key={effective_key}',
                    timeout=20,
                )
                ok = response.status_code == 200
                self.send_json(
                    200, {'valid': ok, 'error': None if ok else response.text[:200]})
            except Exception as exc:
                self.send_json(200, {'valid': False, 'error': str(exc)[:200]})
            return
        if provider == 'anthropic':
            effective_key = api_key or ANTHROPIC_API_KEY
            if not effective_key:
                self.send_json(
                    200, {'valid': False, 'error': 'Anthropic API key não configurada no servidor'})
                return
            try:
                response = requests.get(
                    'https://api.anthropic.com/v1/models',
                    headers={'x-api-key': effective_key,
                             'anthropic-version': '2023-06-01'},
                    timeout=20,
                )
                ok = response.status_code == 200
                self.send_json(
                    200, {'valid': ok, 'error': None if ok else response.text[:200]})
            except Exception as exc:
                self.send_json(200, {'valid': False, 'error': str(exc)[:200]})
            return
        effective_key = api_key or OPENAI_API_KEY
        if not effective_key:
            self.send_json(
                200, {'valid': False, 'error': 'OpenAI API key não configurada no servidor'})
            return
        try:
            response = requests.get(
                'https://api.openai.com/v1/models',
                headers={'Authorization': f'Bearer {effective_key}'},
                timeout=20,
            )
            ok = response.status_code == 200
            self.send_json(
                200, {'valid': ok, 'error': None if ok else response.text[:200]})
        except Exception as exc:
            self.send_json(200, {'valid': False, 'error': str(exc)[:200]})

    def handle_chat(self, data):
        session = self.get_session_or_default()
        username = (session.get('username') or '').strip() or 'default'
        provider = self.detect_provider((data.get('provider') or '').lower(
        ), (data.get('model') or '').strip(), (data.get('api_key') or '').strip())
        model = (data.get('model') or '').strip() or (
            'gpt-4o-mini' if provider != 'genai' else 'gemini-2.0-flash')
        message = (data.get('message') or '').strip()
        system_prompt = (data.get('system_prompt')
                         or '').strip() or 'Você é um assistente útil.'
        user_state = self.get_user_state(username)
        ai_state = user_state.get('ai', {}) if isinstance(
            user_state.get('ai', {}), dict) else {}
        api_key = (data.get('api_key') or '').strip() or str(
            ai_state.get('apiKey') or ai_state.get('api_key') or '').strip()
        if not message:
            self.send_json(400, {'success': False, 'error': 'Mensagem vazia'})
            return
        if provider == 'genai':
            effective_key = api_key or GOOGLE_API_KEY
            if not effective_key:
                self.send_json(
                    200, {'success': False, 'error': 'Google API key não configurada no servidor'})
                return
            try:
                response = requests.post(
                    f'https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={effective_key}',
                    json={'contents': [
                        {'parts': [{'text': f'{system_prompt}\n\nUsuário: {message}'}]}]},
                    timeout=30,
                )
                if response.status_code != 200:
                    self.send_json(
                        200, {'success': False, 'error': response.text[:500]})
                    return
                payload = response.json()
                text = (
                    payload.get('candidates', [{}])[0]
                    .get('content', {})
                    .get('parts', [{}])[0]
                    .get('text', '')
                )
                self.send_json(
                    200, {'success': True, 'response': text or 'Sem resposta disponível.'})
            except Exception as exc:
                self.send_json(
                    200, {'success': False, 'error': str(exc)[:500]})
            return
        if provider == 'anthropic':
            effective_key = api_key or ANTHROPIC_API_KEY
            if not effective_key:
                self.send_json(
                    200, {'success': False, 'error': 'Anthropic API key não configurada no servidor'})
                return
            try:
                response = requests.post(
                    'https://api.anthropic.com/v1/messages',
                    headers={'x-api-key': effective_key, 'anthropic-version': '2023-06-01',
                             'Content-Type': 'application/json'},
                    json={'model': model, 'max_tokens': 400, 'messages': [
                        {'role': 'user', 'content': f'{system_prompt}\n\nUsuário: {message}'}]},
                    timeout=30,
                )
                if response.status_code != 200:
                    self.send_json(
                        200, {'success': False, 'error': response.text[:500]})
                    return
                payload = response.json()
                text = ''
                for block in payload.get('content', []) or []:
                    if isinstance(block, dict) and isinstance(block.get('text'), str):
                        text += block['text']
                self.send_json(
                    200, {'success': True, 'response': text or 'Sem resposta disponível.'})
            except Exception as exc:
                self.send_json(
                    200, {'success': False, 'error': str(exc)[:500]})
            return
        effective_key = api_key or OPENAI_API_KEY
        if not effective_key:
            self.send_json(
                200, {'success': False, 'error': 'OpenAI API key não configurada no servidor'})
            return
        try:
            prompt_messages = []
            if system_prompt:
                prompt_messages.append(
                    {'role': 'system', 'content': system_prompt})
            prompt_messages.append({'role': 'user', 'content': message})
            response = requests.post(
                'https://api.openai.com/v1/chat/completions',
                headers={'Authorization': f'Bearer {effective_key}',
                         'Content-Type': 'application/json'},
                json={'model': model, 'messages': prompt_messages,
                      'temperature': 0.7},
                timeout=30,
            )
            if response.status_code != 200:
                self.send_json(
                    200, {'success': False, 'error': response.text[:500]})
                return
            payload = response.json()
            text = payload.get('choices', [{}])[0].get(
                'message', {}).get('content', '')
            self.send_json(
                200, {'success': True, 'response': text or 'Sem resposta disponível.'})
        except Exception as exc:
            self.send_json(200, {'success': False, 'error': str(exc)[:500]})

    def handle_deskmanager_get(self, path):
        if path == '/deskmanager/health':
            self.send_json(
                200, {'status': 'online', 'service': 'DeskManager API'})
            return
        self.send_json(404, {'success': False, 'error': 'Rota não encontrada'})

    def handle_deskmanager_post(self, path, data):
        if path in ('/deskmanager/Login/autenticar', '/Login/autenticar'):
            self.handle_deskmanager_login(data)
        elif path in ('/deskmanager/AutoCategorias', '/AutoCategorias'):
            self.handle_deskmanager_auto_categorias(data)
        else:
            self.send_json(
                404, {'success': False, 'error': 'Rota não encontrada'})

    def handle_deskmanager_login(self, data):
        operator_key = self.parse_authorization_header(
            self.headers.get('Authorization', ''))
        if not operator_key:
            self.send_json(
                401, {'success': False, 'error': 'Authorization header required'})
            return
        token = secrets.token_urlsafe(16)
        TOKEN_STORE[token] = {'operator_key': operator_key, 'created_at': int(
            time.time()), 'expires_at': int(time.time()) + TOKEN_TTL_SECONDS}
        self.send_json(200, {'token': token, 'expires_in': TOKEN_TTL_SECONDS,
                       'operator_key': operator_key, 'message': 'Autenticado com sucesso'})

    def handle_deskmanager_auto_categorias(self, data):
        auth_header = self.headers.get('Authorization', '')
        token_data = self.get_token_data(auth_header)
        if not token_data:
            self.send_json(
                401, {'success': False, 'error': 'Token inválido ou expirado'})
            return
        codigo = (data.get('codigo') or '').strip()
        if not codigo:
            self.send_json(
                400, {'success': False, 'error': 'Campo codigo obrigatório'})
            return
        response = self.get_chamado_data(codigo)
        if response is None:
            self.send_json(
                404, {'success': False, 'error': 'Chamado não encontrado'})
            return
        self.send_json(200, response)

    def parse_authorization_header(self, header_value):
        if not header_value:
            return ''
        value = header_value.strip()
        if value.lower().startswith('token '):
            return value[6:].strip()
        if value.lower().startswith('bearer '):
            return value[7:].strip()
        return value

    def get_token_data(self, header_value):
        token = self.parse_authorization_header(header_value)
        if not token:
            return None
        token_data = TOKEN_STORE.get(token)
        if not token_data:
            return None
        if token_data.get('expires_at', 0) < int(time.time()):
            TOKEN_STORE.pop(token, None)
            return None
        return token_data

    def get_chamado_data(self, codigo):
        codigo_upper = codigo.upper()
        fixed_mock = {'CHAMADO-1234': {'titulo': 'Falha no backup automático', 'descricao': 'Solicitação de ajuste no servidor e verificação de rede.', 'sla': '4h', 'data': '25/06/2026', 'horario': '10:35', 'solicitante': 'João Silva', 'status': 'Aberto', 'setor': 'Infraestrutura', 'prioridade': 'Alta', 'nome': 'Suporte Técnico', 'abertoEm': '25/06/2026 10:35'},
                      'CHAMADO-5678': {'titulo': 'Atualização de plataforma', 'descricao': 'Atualização de sistema operacional e correção de bugs.', 'sla': '8h', 'data': '24/06/2026', 'horario': '14:12', 'solicitante': 'Maria Ferreira', 'status': 'Em atendimento', 'setor': 'Desenvolvimento', 'prioridade': 'Média', 'nome': 'Manutenção de Software', 'abertoEm': '24/06/2026 14:12'}}
        return fixed_mock.get(codigo_upper)


def run_server():
    server = ThreadingHTTPServer((HOST, PORT), DocHubHandler)
    print(f'\n✅ Servidor DocHub rodando em http://{HOST}:{PORT}')
    print('Pressione Ctrl+C para parar')
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print('\nServidor encerrado')


if __name__ == '__main__':
    run_server()
