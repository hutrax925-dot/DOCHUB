Rollback rápido usando Git

- Listar tags de snapshot:

  git tag --list "snapshot-*"

- Ver log com últimas entradas:

  git log --oneline --decorate --graph -n 20

- Voltar para uma tag (modo seguro - criar branch temporário):

  git checkout -b restore-<nome> snapshot-YYYYMMDD-HHMMSS

  (ou apenas: `git checkout snapshot-YYYYMMDD-HHMMSS` para 'detached HEAD')

- Substituir o estado atual (perigoso, sobrescreve alterações):

  git reset --hard <commit-ish>

- Exemplo: restaurar para tag `snapshot-20260205-124534`:

  git checkout -b restore-20260205-124534 snapshot-20260205-124534

Observação: use `git status` antes de qualquer reset para evitar perda de trabalho não comitado.
