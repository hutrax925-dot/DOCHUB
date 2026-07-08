#!/usr/bin/env python3
"""
Debug Logger - Monitora requisições do Chat em tempo real
Roda em um CMD separado e registra em ia_debug.log
"""

import os
import sys
import time
from datetime import datetime

LOG_FILE = os.path.join(os.path.dirname(__file__), 'ia_debug.log')


def print_log(msg):
    """Imprime e registra no arquivo de log"""
    timestamp = datetime.now().strftime('%H:%M:%S')
    log_msg = f'[{timestamp}] {msg}'
    print(log_msg)
    try:
        with open(LOG_FILE, 'a', encoding='utf-8') as f:
            f.write(log_msg + '\n')
    except Exception as e:
        print(f'Erro ao escrever log: {e}')


def tail_log():
    """Monitora o arquivo de log em tempo real (tipo tail -f)"""
    print_log('=== Debug Logger iniciado ===')
    print_log('Monitorando ia_debug.log...\n')

    if not os.path.exists(LOG_FILE):
        open(LOG_FILE, 'w').close()

    with open(LOG_FILE, 'r', encoding='utf-8') as f:
        # ir para o final do arquivo
        f.seek(0, 2)
        while True:
            line = f.readline()
            if line:
                print(line.rstrip())
            else:
                time.sleep(0.1)


if __name__ == '__main__':
    try:
        tail_log()
    except KeyboardInterrupt:
        print('\n\n=== Debug Logger finalizado ===')
        sys.exit(0)
