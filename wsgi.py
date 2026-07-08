#!/usr/bin/env python3
"""Wrapper para iniciar o servidor DocHub no Render."""
import sys
import os

# Adiciona o diretório atual ao path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from server import run_server

if __name__ == '__main__':
    run_server()
