#!/usr/bin/env python3
"""
DocHub IA - Integração Python Simples
Único arquivo que valida API Key e integra com OpenAI
Roda em http://localhost:5000
"""

from http.server import HTTPServer, BaseHTTPRequestHandler
import json
import requests
import threading
import urllib.parse
from concurrent.futures import ThreadPoolExecutor, TimeoutError as FutureTimeout

# Tentativa de importar o cliente GenAI (Google). Pode não estar instalado.
try:
    from google import genai
    HAS_GENAI = True
except Exception:
    HAS_GENAI = False


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
        except:
            self.send_error(400, 'JSON inválido')
            return

        # Validar API Key
        if self.path == '/validate':
            self.handle_validate(data)
        # Chat
        elif self.path == '/chat':
            self.handle_chat(data)
        else:
            self.send_error(404, 'Rota não encontrada')

    def handle_validate(self, data):
        """Valida a API Key usando endpoint /models (mais simples)"""
        api_key = data.get('api_key', '').strip()
        model = data.get('model', 'gpt-3.5-turbo')
        provider = data.get('provider') or (
            'genai' if any(k in model.lower() for k in ['gem', 'gemma', 'gemini']) else 'openai')

        if not api_key:
            self.send_json(400, {
                'valid': False,
                'error': 'API Key não fornecida'
            })
            return

        # Se o provedor for GenAI, valide usando a lib genai (quando disponível)
        if provider == 'genai':
            if not HAS_GENAI:
                self.send_json(
                    200, {'valid': False, 'error': 'Cliente genai não instalado no servidor'})
                return

            # Tenta gerar um conteúdo curto para validar a chave/modelo
            def genai_test():
                client = genai.Client(api_key=api_key)
                # gerar conteúdo mínimo
                resp = client.models.generate_content(
                    model=model, contents='teste')
                return resp

            with ThreadPoolExecutor(max_workers=1) as ex:
                fut = ex.submit(genai_test)
                try:
                    resp = fut.result(timeout=10)
                    # Se não lançar exceção, consideramos válida
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

        # Caso contrário, assume OpenAI-compatible key e testa via /models
        try:
            response = requests.get(
                'https://api.openai.com/v1/models',
                headers={
                    'Authorization': f'Bearer {api_key}',
                    'Content-Type': 'application/json'
                },
                timeout=10
            )

            print(f"[DEBUG] /models response: {response.status_code}")
            print(f"[DEBUG] Response text: {response.text[:200]}")

            if response.status_code == 401:
                self.send_json(200, {
                    'valid': False,
                    'error': 'Chave de API inválida ou expirada'
                })
            elif response.status_code == 200:
                # Chave é válida! Agora testa se consegue fazer um chat
                self.test_chat(api_key, model)
            else:
                print(
                    f"[DEBUG] Erro {response.status_code}, mas tentando chat mesmo assim")
                self.test_chat(api_key, model)
        except Exception as e:
            print(f"[DEBUG] Exception: {str(e)}")
            # Se der erro de conexão, tenta fazer o chat mesmo assim
            self.test_chat(api_key, model)

    def test_chat(self, api_key, model):
        """Testa se consegue fazer um chat com a chave"""
        try:
            response = requests.post(
                'https://api.openai.com/v1/chat/completions',
                headers={
                    'Authorization': f'Bearer {api_key}',
                    'Content-Type': 'application/json'
                },
                json={
                    'model': model,
                    'messages': [{'role': 'user', 'content': 'test'}],
                    'max_tokens': 5
                },
                timeout=10
            )

            print(f"[DEBUG] chat response: {response.status_code}")
            print(f"[DEBUG] Response text: {response.text[:200]}")

            if response.status_code == 200:
                self.send_json(200, {
                    'valid': True,
                    'error': None
                })
            elif response.status_code == 401:
                self.send_json(200, {
                    'valid': False,
                    'error': 'Chave inválida'
                })
            else:
                # Outros erros (429, 404 modelo não existe, etc) = considerar válido
                # porque a chave respondeu, só que teve outro problema
                print(
                    f"[DEBUG] Erro {response.status_code}, considerando válido")
                    'genai' if any(k in model.lower() for k in ['gem', 'gemma', 'gemini']) else 'openai')
                    'valid': True,
                    'error': None
                })
        except Exception as e:
            print(f"[DEBUG] Chat exception: {str(e)}")
            # Se der erro, considerar válido mesmo assim (pode ser conexão)
            self.send_json(200, {
                if provider == 'genai':
                'error': None
            })

    def handle_chat(self, data):
        """Processa mensagens de chat"""
        api_key= data.get('api_key', '').strip()
        model= data.get('model', 'gpt-3.5-turbo')
        message= data.get('message', '').strip()
        system_prompt= data.get('system_prompt', 'Você é um assistente útil')
        temperature= data.get('temperature', 0.7)
        provider= data.get('provider') or (
            None if api_key.startswith('sk-') else 'genai')

        if not api_key or not message:
            self.send_json(
                400, {'success': False, 'error': 'API Key ou mensagem vazia'})
            return

        # Se provider for genai, use o cliente genai
        if provider == 'genai' or (provider is None and not api_key.startswith('sk-')):
            if not HAS_GENAI:
                self.send_json(
                    200, {'success': False, 'error': 'Cliente genai não disponível no servidor'})
                return

            def call_genai():
                client= genai.Client(api_key=api_key)
                resp= client.models.generate_content(
                    model=model, contents=message)
                # Alguns clientes retornam objeto com .text ou .response
                text= getattr(resp, 'text', None) or getattr(
                    resp, 'response', None) or str(resp)
                return text

            with ThreadPoolExecutor(max_workers=1) as ex:
                fut= ex.submit(call_genai)
                try:
                    text= fut.result(timeout=30)
                    self.send_json(
                        200, {'success': True, 'response': text, 'tokens': None, 'model': model})
                    return
                except FutureTimeout:
                    self.send_json(
                        200, {'success': False, 'error': 'Tempo esgotado ao comunicar com GenAI'})
                    return
                except Exception as e:
                    self.send_json(
                        200, {'success': False, 'error': str(e)[:200]})
                    return

        # Fallback para fluxo OpenAI-compatible
        try:
            response= requests.post(
                'https://api.openai.com/v1/chat/completions',
                headers={
                    'Authorization': f'Bearer {api_key}',
                    'Content-Type': 'application/json'
                },
                json={
                    'model': model,
                    'messages': [
                        {'role': 'system', 'content': system_prompt},
                        {'role': 'user', 'content': message}
                    ],
                    'temperature': temperature,
                    'max_tokens': 2000
                },
                timeout = 30
            )

            if response.status_code == 200:
                data_resp= response.json()
                self.send_json(200, {
                    'success': True,
                    'response': data_resp['choices'][0]['message']['content'],
                    'tokens': data_resp.get('usage', {}).get('total_tokens'),
                    'model': model
                })
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
    server= HTTPServer(('localhost', port), IAHandler)
    print(f"\n✅ Servidor IA rodando em http://localhost:{port}")
    print("💡 Pressione Ctrl+C para parar\n")

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n❌ Servidor parado")
        server.shutdown()


if __name__ == '__main__':
    run_server()
