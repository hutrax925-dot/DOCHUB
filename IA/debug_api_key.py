#!/usr/bin/env python3
"""
Debug - Testa sua API Key diretamente com OpenAI
Sem servidor, direto ao ponto
"""

import requests
import sys


def testar_chave(api_key):
    """Testa a chave com OpenAI"""
    print("\n" + "="*60)
    print("🧪 TESTE DIRETO COM OPENAI")
    print("="*60)

    if not api_key:
        print("❌ Erro: Passe a API Key como argumento")
        print("   Uso: python debug_api_key.py <sua-api-key>")
        sys.exit(1)

    print(f"\n📝 Testando com chave: {api_key[:10]}...{api_key[-4:]}")
    print("\n🔄 Enviando requisição para OpenAI...")

    try:
        response = requests.post(
            'https://api.openai.com/v1/chat/completions',
            headers={
                'Authorization': f'Bearer {api_key}',
                'Content-Type': 'application/json'
            },
            json={
                'model': 'gpt-3.5-turbo',
                'messages': [{'role': 'user', 'content': 'Responda com "OK"'}],
                'max_tokens': 10
            },
            timeout=10
        )

        print(f"\n📊 Status Code: {response.status_code}")
        print(f"📄 Response:\n{response.text}\n")

        if response.status_code == 200:
            print("✅ SUCESSO! Sua chave funciona!")
            data = response.json()
            print(f"   Resposta: {data['choices'][0]['message']['content']}")
            return True
        elif response.status_code == 401:
            print("❌ ERRO 401: Chave inválida ou expirada")
            print("   Verifique em: https://platform.openai.com/api-keys")
            return False
        elif response.status_code == 429:
            print("⚠️  ERRO 429: Rate limit (muitas requisições)")
            print("   Aguarde alguns minutos e tente novamente")
            return False
        elif response.status_code == 500:
            print("⚠️  ERRO 500: Servidor OpenAI com problema")
            print("   Tente novamente em alguns minutos")
            return False
        else:
            print(f"❌ ERRO {response.status_code}: {response.text}")
            return False

    except requests.exceptions.Timeout:
        print("❌ ERRO: Timeout (demorou muito)")
        print("   Verifique sua conexão internet")
        return False
    except requests.exceptions.ConnectionError:
        print("❌ ERRO: Não conseguiu conectar")
        print("   Verifique sua conexão internet")
        return False
    except Exception as e:
        print(f"❌ ERRO inesperado: {str(e)}")
        return False


if __name__ == '__main__':
    if len(sys.argv) > 1:
        api_key = sys.argv[1].strip()
    else:
        print("\n" + "="*60)
        print("🧪 DEBUG - Testa sua API Key com OpenAI")
        print("="*60)
        api_key = input("\n🔑 Digite sua API Key: ").strip()

    sucesso = testar_chave(api_key)
    sys.exit(0 if sucesso else 1)
