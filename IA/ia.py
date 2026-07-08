#!/usr/bin/env python3
"""
DocHub IA - Integração Python Simples
Roda em http://localhost:5000
Arquivo reescrito para estabilidade
"""

from http.server import HTTPServer, BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import requests
from concurrent.futures import ThreadPoolExecutor, TimeoutError as FutureTimeout
import os
import time

# Timeouts (segundos) -- podem ser ajustados via variáveis de ambiente
OPENAI_TIMEOUT = int(os.environ.get('OPENAI_TIMEOUT', '20'))
GENAI_TIMEOUT = int(os.environ.get('GENAI_TIMEOUT', '25'))
EXECUTOR_TIMEOUT = int(os.environ.get('IA_EXECUTOR_TIMEOUT', '30'))
FREE_GEMINI_MODEL = os.environ.get('FREE_GEMINI_MODEL', 'gemini-2.5-flash')

# Tentativa de importar o cliente GenAI (Google). Pode não estar instalado.
try:
    from google import genai
    HAS_GENAI = True
except Exception:
    HAS_GENAI = False


def normalize_gemini_model(model_name):
    """Garante que o modelo Gemini usado seja um nome compatível com a API gratuita."""
    name = (model_name or '').strip().lower()
    if not name:
        return FREE_GEMINI_MODEL
    if name.startswith('gemini-1.5') or name.startswith('gemini-2.0') or name.startswith('gemma-') or name.startswith('gemini-1.'):
        return FREE_GEMINI_MODEL
    return model_name.strip() or FREE_GEMINI_MODEL


def format_genai_error_message(exception):
    """Normaliza erros GenAI para mensagens claras no chat."""
    try:
        text = str(exception) or ''
    except Exception:
        text = repr(exception)

    lower = text.lower()

    if any(substr in lower for substr in ['429', 'resource_exhausted', 'quota exceeded']):
        return "[GENAI ERROR] RESOURCE_EXHAUSTED: cota gratuita do Gemini excedida. Verifique seu plano/billing e tente novamente mais tarde. Consulte: https://aistudio.google.com/app/api-keys?hl=pt-br&_gl=1*1il0omn*_ga*OTg0Nzc3NjA1LjE3NzAyOTM5NTA.*_ga_P1DBVKWT6V*czE3NzM3NDkxODckbzIkZzEkdDE3NzM3NDkyNDYkajEkbDAkaDE5NDQzNjMwNzI.&project=gen-lang-client-0746024858"

    if any(substr in lower for substr in ['503', 'unavailable', 'high demand', 'temporarily unavailable']):
        return "[GENAI ERROR] Modelo indisponível por alta demanda no momento. Tente novamente mais tarde."

    return f"[GENAI ERROR] {text}"


class IAHandler(BaseHTTPRequestHandler):
    """Handler para requisições HTTP"""

    def do_GET(self):
        """GET - Health check"""
        if self.path == '/health':
            self.send_response(200)
            self.send_header('Content-type', 'application/json')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            self.wfile.write(json.dumps({'status': 'online'}).encode())
        else:
            self.send_response(404)
            self.end_headers()

    def do_POST(self):
        """POST - Processa requisições"""
        content_length = int(self.headers.get('Content-Length', 0))
        body = self.rfile.read(content_length).decode('utf-8')

        try:
            data = json.loads(body)
        except Exception:
            self.send_error(400, 'JSON inválido')
            return

        if self.path == '/validate':
            self.handle_validate(data)
        elif self.path == '/chat':
            self.handle_chat(data)
        elif self.path == '/set_system_prompt':
            self.handle_set_system_prompt(data)
        else:
            self.send_error(404, 'Rota não encontrada')

    def handle_set_system_prompt(self, data):
        """Persistir system prompt no servidor (invisível ao usuário)
        Espera JSON: { system_prompt: '...' }
        """
        sp = (data.get('system_prompt') or '').strip()
        try:
            # gravar em arquivo ao lado deste script
            base = os.path.dirname(__file__)
            path = os.path.join(base, 'system_prompt.txt')
            with open(path, 'w', encoding='utf-8') as f:
                f.write(sp)
            # atualizar memória
            global PERSISTED_SYSTEM_PROMPT
            PERSISTED_SYSTEM_PROMPT = sp
            self.send_json(200, {'success': True, 'saved': True})
        except Exception as e:
            self.send_json(500, {'success': False, 'error': str(e)[:200]})

    def handle_validate(self, data):
        """Valida a API Key usando endpoint /models (OpenAI) ou gerando conteúdo (GenAI)"""
        api_key = data.get('api_key', '').strip()
        model = normalize_gemini_model(data.get('model', FREE_GEMINI_MODEL)) if (data.get(
            'provider') or '').lower() == 'genai' else data.get('model', 'gpt-3.5-turbo')
        provider = data.get('provider') or (
            'genai' if any(k in (data.get('model') or '').lower() for k in ['gem', 'gemma', 'gemini']) else 'openai')

        if not api_key:
            self.send_json(
                400, {'valid': False, 'error': 'API Key não fornecida'})
            return

        if provider == 'genai':
            if not HAS_GENAI:
                self.send_json(
                    200, {'valid': False, 'error': 'Cliente genai não instalado no servidor'})
                return

            def genai_test():
                client = genai.Client(api_key=api_key)
                resp = client.models.generate_content(
                    model=model, contents='teste')
                return resp

            with ThreadPoolExecutor(max_workers=1) as ex:
                fut = ex.submit(genai_test)
                try:
                    _ = fut.result(timeout=10)
                    self.send_json(200, {'valid': True, 'error': None})
                    return
                except FutureTimeout:
                    self.send_json(
                        200, {'valid': False, 'error': 'Tempo esgotado ao validar chave GenAI'})
                    return
                except Exception as e:
                    self.send_json(
                        200, {'valid': False, 'error': str(e)[:200]})
                    return

        # OpenAI-compatible validation
        try:
            response = requests.get(
                'https://api.openai.com/v1/models',
                headers={
                    'Authorization': f'Bearer {api_key}',
                    'Content-Type': 'application/json'
                },
                timeout=10
            )

            if response.status_code == 401:
                self.send_json(
                    200, {'valid': False, 'error': 'Chave de API inválida ou expirada'})
            elif response.status_code == 200:
                # Chave válida — tentar um chat simples
                self.test_chat(api_key, model)
            else:
                # Respondeu algo diferente; tentar chat como fallback
                self.test_chat(api_key, model)
        except Exception:
            # Em caso de erro de rede, tentar chat como fallback
            self.test_chat(api_key, model)

    def test_chat(self, api_key, model):
        """Testa se consegue fazer um chat com a chave (OpenAI flow)"""
        try:
            response = requests.post(
                'https://api.openai.com/v1/chat/completions',
                headers={
                    'Authorization': f'Bearer {api_key}',
                    'Content-Type': 'application/json'
                },
                json={
                    'model': model,
                    'messages': [{'role': 'user', 'content': 'test'}]
                },
                timeout=10
            )

            if response.status_code == 200:
                self.send_json(200, {'valid': True, 'error': None})
            elif response.status_code == 401:
                self.send_json(
                    200, {'valid': False, 'error': 'Chave inválida'})
            else:
                # Outros erros ainda indicam que a chave respondeu
                self.send_json(200, {'valid': True, 'error': None})
        except Exception:
            # Em caso de exceção de conexão, considerar como válido (fallback)
            self.send_json(200, {'valid': True, 'error': None})

    def handle_chat(self, data):
        """Processa mensagens de chat"""
        api_key = data.get('api_key', '').strip()
        provider = data.get('provider') or (
            None if api_key.startswith('sk-') else 'genai')
        model = normalize_gemini_model(data.get(
            'model', FREE_GEMINI_MODEL)) if provider == 'genai' else data.get('model', 'gpt-3.5-turbo')
        message = data.get('message', '').strip()
        # Preferir prompt persistido no servidor (invisível ao usuário).
        # Se não existir, usar o enviado no body como fallback.
        req_sp = data.get('system_prompt', '')
        persisted = globals().get('PERSISTED_SYSTEM_PROMPT', '') or ''
        system_prompt = persisted.strip() if persisted.strip() else (
            req_sp or 'Você é um assistente útil')
        # Usar diretamente o system prompt recebido (persistido ou enviado pelo frontend)
        system_content = (system_prompt or '').strip(
        ) or 'Você é um assistente útil'
        temperature = float(data.get('temperature', 0.7))

        if not api_key or not message:
            self.send_json(
                400, {'success': False, 'error': 'API Key ou mensagem vazia'})
            return

        # GenAI flow
        if provider == 'genai' or (provider is None and not api_key.startswith('sk-')):
            if not HAS_GENAI:
                self.send_json(
                    200, {'success': False, 'error': 'Cliente genai não disponível no servidor'})
                return

            def call_genai():
                client = genai.Client(api_key=api_key)

                # Construir o conteúdo para GenAI usando system prompt separado e histórico, se fornecido.
                contents = []
                history = data.get('history')
                if isinstance(history, list):
                    for item in history:
                        role = (item.get('role') or '').strip().lower()
                        if role in ('bot', 'assistant', 'user'):
                            normalized_role = 'USER'
                        elif role in ('system', 'model'):
                            normalized_role = 'MODEL'
                        else:
                            continue
                        content = item.get('content') or ''
                        if not isinstance(content, str) or not content.strip():
                            continue
                        contents.append({
                            'role': normalized_role,
                            'parts': [{'text': content.strip()}]
                        })

                if not any(item.get('role') == 'MODEL' for item in contents):
                    contents.insert(0, {
                        'role': 'MODEL',
                        'parts': [{'text': system_content}]
                    })

                contents.append({
                    'role': 'USER',
                    'parts': [{'text': message}]
                })

                max_retries = int(os.environ.get('GENAI_RETRY_ATTEMPTS', '1'))
                retry_delay = float(os.environ.get('GENAI_RETRY_DELAY', '1.5'))
                last_error = None

                for attempt in range(max_retries + 1):
                    try:
                        resp = client.models.generate_content(
                            model=model, contents=contents)
                        text = getattr(resp, 'text', None) or getattr(
                            resp, 'response', None) or str(resp)
                        return text
                    except Exception as e:
                        last_error = e
                        error_text = str(e).lower()

                        if attempt < max_retries and any(substr in error_text for substr in ['503', 'unavailable', 'high demand', 'temporarily unavailable']):
                            time.sleep(retry_delay)
                            continue

                        return format_genai_error_message(e)

                if last_error:
                    return format_genai_error_message(last_error)
                return "[GENAI ERROR] Erro desconhecido"

            with ThreadPoolExecutor(max_workers=1) as ex:
                fut = ex.submit(call_genai)
                try:
                    text = fut.result(timeout=EXECUTOR_TIMEOUT)
                    self.send_json(
                        200, {'success': True, 'response': text, 'tokens': None, 'model': model})
                    return
                except FutureTimeout:
                    self.send_json(
                        504, {'success': False, 'error': 'Tempo esgotado ao comunicar com GenAI'})
                    return
                except Exception as e:
                    self.send_json(
                        200, {'success': False, 'error': str(e)[:200]})
                    return

        # OpenAI-compatible flow
        try:
            history = data.get('history')
            messages = []
            if isinstance(history, list) and history:
                for item in history:
                    role = (item.get('role') or '').strip().lower()
                    if role == 'bot':
                        role = 'assistant'
                    if role not in ('system', 'user', 'assistant'):
                        continue
                    content = item.get('content') or ''
                    if not isinstance(content, str) or not content.strip():
                        continue
                    messages.append({'role': role, 'content': content.strip()})

            if not any(msg.get('role') == 'system' for msg in messages):
                messages.insert(
                    0, {'role': 'system', 'content': system_content})

            messages.append({'role': 'user', 'content': message})

            payload = {
                'model': model,
                'messages': messages,
                'temperature': temperature
            }

            # Executar a chamada ao OpenAI em um worker para aplicar timeout do executor
            def call_openai():
                return requests.post(
                    'https://api.openai.com/v1/chat/completions',
                    headers={
                        'Authorization': f'Bearer {api_key}',
                        'Content-Type': 'application/json'
                    },
                    json=payload,
                    timeout=OPENAI_TIMEOUT
                )

            with ThreadPoolExecutor(max_workers=1) as ex:
                fut = ex.submit(call_openai)
                try:
                    response = fut.result(timeout=EXECUTOR_TIMEOUT)
                except FutureTimeout:
                    self.send_json(
                        504, {'success': False, 'error': 'Tempo esgotado ao comunicar com OpenAI'})
                    return
                except Exception as e:
                    # Erro na chamada (ex: network)
                    self.send_json(
                        200, {'success': False, 'error': str(e)[:200]})
                    return

            if response.status_code == 200:
                data_resp = response.json()
                content = data_resp['choices'][0]['message']['content']
                tokens = data_resp.get('usage', {}).get('total_tokens')
                self.send_json(
                    200, {'success': True, 'response': content, 'tokens': tokens, 'model': model})
            else:
                self.send_json(200, {
                    'success': False, 'error': f'Erro {response.status_code}: {response.text[:200]}'})
        except Exception as e:
            self.send_json(200, {'success': False, 'error': str(e)[:200]})

    def send_json(self, status_code, data):
        """Envia resposta JSON"""
        self.send_response(status_code)
        self.send_header('Content-type', 'application/json')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()
        self.wfile.write(json.dumps(data).encode())

    def do_OPTIONS(self):
        """Handle CORS preflight"""
        self.send_response(200)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()

    def log_message(self, format, *args):
        """Silencia logs desnecessários"""
        pass


def run_server(port=5000):
    """Inicia o servidor"""
    # Carregar prompt persistido se existir
    base = os.path.dirname(__file__)
    prompt_path = os.path.join(base, 'system_prompt.txt')
    global PERSISTED_SYSTEM_PROMPT
    PERSISTED_SYSTEM_PROMPT = ''
    try:
        if os.path.exists(prompt_path):
            with open(prompt_path, 'r', encoding='utf-8') as f:
                PERSISTED_SYSTEM_PROMPT = f.read().strip()
    except Exception:
        PERSISTED_SYSTEM_PROMPT = ''

    server = HTTPServer(('localhost', port), IAHandler)
    print(f"\n✅ Servidor IA rodando em http://localhost:{port}")
    print("💡 Pressione Ctrl+C para parar\n")

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n❌ Servidor parado")
        server.shutdown()


if __name__ == '__main__':
    run_server()
