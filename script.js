let documentacoes = [];
let exemplos = [];
let categorias = [];
let currentEditingId = null;
let currentEditingType = null;
let currentSelectedCategory = 'todos';
let currentViewVersion = 'normal';
let currentEditVersion = 'normal';
let currentDocFullscreen = false;
let aiConfig = { apiKey: '', model: '' };
const STORAGE_UI = 'dochub-ui-config';

/*
  ╔═══════════════════════════════════════════════════════════════════════╗
  ║ RASTREAMENTO DE MUDANÇAS - AVISO DE SAÍDA SEGURA                      ║
  ╠═══════════════════════════════════════════════════════════════════════╣
  ║ hasUnsavedChanges: boolean                                            ║
  ║   - TRUE: User está editando/criando e há mudanças não salvas        ║
  ║   - FALSE: Nada em edição ou já foi salvo                            ║
  ║                                                                       ║
  ║ Quando TRUE, evento 'beforeunload' avisa ao fechar a página          ║
  ║ ALTERAR EM: adicionarDocumentacao(), salvarEdicao(), limpar ao sair  ║
  ╚═══════════════════════════════════════════════════════════════════════╝
*/
let hasUnsavedChanges = false;

// apply UI config (colors) to CSS variables
function applyUiConfig(conf) {
    if (!conf) return;
    const root = document.documentElement;
    if (conf.primary) root.style.setProperty('--primary-color', conf.primary);
    if (conf.secondary) root.style.setProperty('--secondary-color', conf.secondary);
    if (conf.background) root.style.setProperty('--background', conf.background);
    if (conf.surface) root.style.setProperty('--surface', conf.surface);
    if (conf.text) root.style.setProperty('--text-primary', conf.text);
    if (conf.border) root.style.setProperty('--border-color', conf.border);
}

function loadUiConfig() {
    try {
        const raw = localStorage.getItem(STORAGE_UI);
        if (!raw) return null;
        return JSON.parse(raw);
    } catch (e) { return null; }
}

function saveUiConfig(conf) {
    try { localStorage.setItem(STORAGE_UI, JSON.stringify(conf)); applyUiConfig(conf); } catch(e){}
}
let lastFocusedEditorId = null;
let currentChatDocId = null; // quando chat for aberto a partir de uma doc específica
let currentChatOrigin = null; // { type: 'edit'|'create', docId?: number }
let previousSection = 'documentos'; // rastreia seção anterior antes de entrar em Chat
let previousModalOpen = null; // rastreia qual modal estava aberto antes de entrar em Chat
let categoriesLoadedFromStorage = false;
let ordensSessao = {};
let originalNavbarTitleText = null;
let originalLogoIconText = null;

const STORAGE_DOCS = 'dochub-docs';
const STORAGE_EXEMPLOS = 'dochub-exemplos';
const STORAGE_CATEGORIAS = 'dochub-categorias';
const STORAGE_AI = 'dochub-ai-config';

document.addEventListener('DOMContentLoaded', () => {
    carregarDados();
    inicializarEventos();
    inicializarChat();
    criarCategoriasDefault();
    renderizarCategorias();
    atualizarSelectsCategorias();
    atualizarStats();
    filtrarPorCategoria('todos');
    renderizarExemplos();
    
    // Icon Popover Initialization
    const toggleBtn = document.getElementById('toggleIconPaletteBtn');
    const popover = document.getElementById('iconPopover');

    function closePopover() {
        if (popover) popover.style.display = 'none';
    }

    if (toggleBtn && popover) {
        toggleBtn.addEventListener('click', (e) => {
            e.preventDefault();

            const rect = toggleBtn.getBoundingClientRect();
            const bodyRect = document.body.getBoundingClientRect();

            const left = rect.left + window.scrollX;
            let top = rect.top + window.scrollY - 10; // tentar posicionar acima

            popover.style.left = left + 'px';
            popover.style.top = top + 'px';
            popover.style.display = popover.style.display === 'none' ? 'block' : 'none';
        });

        document.addEventListener('click', (e) => {
            if (!toggleBtn.contains(e.target) && !popover.contains(e.target)) {
                closePopover();
            }
        });
    }
});

// Aviso de segurança ao sair da página com mudanças não salvas
window.addEventListener('beforeunload', (e) => {
    if (hasUnsavedChanges) {
        e.preventDefault();
        e.returnValue = '';
        return '';
    }
});

function setModalVisible(modalId, visible) {
    const modal = document.getElementById(modalId);
    if (!modal) return;
    if (visible) {
        modal.classList.add('show');
        document.body.classList.add('modal-open');
        // Rastreia qual modal foi aberto (se não estamos no Chat)
        const currentSection = document.querySelector('.content-section.active')?.id;
        if (currentSection !== 'chat') {
            previousModalOpen = modalId;
        }
    } else {
        modal.classList.remove('show');
        const anyOpen = document.querySelectorAll('.modal.show').length > 0;
        if (!anyOpen) document.body.classList.remove('modal-open');
        // Se está fechando para ir ao Chat, mantém o rastreamento
        const nextSection = document.querySelector('.content-section.active')?.id;
        // Só limpa se não estamos transitando para o chat
        if (!anyOpen && previousModalOpen === modalId && nextSection !== 'chat') {
            previousModalOpen = null;
        }
    }
}

function bloquearInterfaceReordenacao(bloquear) {
    if (bloquear) {

        document.querySelectorAll('.nav-link').forEach(link => {
            link.style.pointerEvents = 'none';
            link.style.opacity = '0.3';
            link.style.filter = 'grayscale(100%)';
        });

        document.querySelectorAll('.btn-primary, .btn-secondary').forEach(btn => {
            if (!btn.classList.contains('btn-confirm-reorder') && !btn.classList.contains('btn-cancel-reorder')) {
                btn.style.pointerEvents = 'none';
                btn.style.opacity = '0.3';
                btn.style.filter = 'grayscale(100%)';
            }
        });

        const elementosEspecificos = [
            '#addCategoryBtn',      // Botão adicionar categoria
            '.search-btn',          // Botão buscar
            '.view-btn',            // Botões Grid/Lista
            '#openAiBtn',           // Botão IA flutuante
            '.category-item-edit',  // Botões editar categoria
            '.category-item-delete' // Botões excluir categoria
        ];
        
        elementosEspecificos.forEach(seletor => {
            document.querySelectorAll(seletor).forEach(elemento => {
                elemento.style.pointerEvents = 'none';
                elemento.style.opacity = '0.3';
                elemento.style.filter = 'grayscale(100%)';
            });
        });

        document.querySelectorAll('.doc-card, .category-item:not(.reordering-mode)').forEach(item => {
            item.style.pointerEvents = 'none';
            item.style.opacity = '0.5';
            item.style.filter = 'grayscale(100%)';
        });

        document.querySelectorAll('input, textarea, select').forEach(input => {
            if (!input.closest('.reorder-actions')) {
                input.style.pointerEvents = 'none';
                input.style.opacity = '0.5';
            }
        });
        
    } else {

        document.querySelectorAll('.nav-link').forEach(link => {
            link.style.pointerEvents = '';
            link.style.opacity = '';
            link.style.filter = '';
        });

        document.querySelectorAll('.btn-primary, .btn-secondary').forEach(btn => {
            btn.style.pointerEvents = '';
            btn.style.opacity = '';
            btn.style.filter = '';
        });

        const elementosEspecificos = [
            '#addCategoryBtn',      // Botão adicionar categoria
            '.search-btn',          // Botão buscar
            '.view-btn',            // Botões Grid/Lista
            '#openAiBtn',           // Botão IA flutuante
            '.category-item-edit',  // Botões editar categoria
            '.category-item-delete' // Botões excluir categoria
        ];
        
        elementosEspecificos.forEach(seletor => {
            document.querySelectorAll(seletor).forEach(elemento => {
                elemento.style.pointerEvents = '';
                elemento.style.opacity = '';
                elemento.style.filter = '';
            });
        });

        document.querySelectorAll('.doc-card, .category-item').forEach(item => {
            item.style.pointerEvents = '';
            item.style.opacity = '';
            item.style.filter = '';
        });

        document.querySelectorAll('input, textarea, select').forEach(input => {
            input.style.pointerEvents = '';
            input.style.opacity = '';
        });
    }
}

/* ===================== CHAT IA - implementação leve ===================== */
const STORAGE_CHAT = 'dochub-chat-histories';

function inicializarChat() {
    // load histories
    loadChatHistory();

    // attach send button listeners (support two possible IDs)
    const sendBtn = document.getElementById('sendChatBtn') || document.getElementById('chatSendBtn');
    if (sendBtn) sendBtn.addEventListener('click', enviarMensagemChat);

    const chatInput = document.getElementById('chatInput');
    if (chatInput) {
        chatInput.addEventListener('keyup', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                enviarMensagemChat();
            }
        });
    }

    // Botão de voltar do Chat IA
    const chatBackBtn = document.getElementById('chatBackBtn');
    if (chatBackBtn) {
        chatBackBtn.addEventListener('click', () => {
            // Se estava criando documentação, volta pra seção de criar
            if (previousSection === 'adicionar') {
                mudarSecao('adicionar');
            } else {
                // Se estava editando, volta pra documentos E restaura modal
                mudarSecao('documentos');
                if (previousModalOpen) {
                    setModalVisible(previousModalOpen, true);
                }
            }
        });
    }

    // support floating AI button id variations
    const floating = document.getElementById('floatingAiButton') || document.getElementById('openAiBtn');
    if (floating) {
        floating.addEventListener('click', () => mudarSecao('chat'));
    }
}

function loadChatHistory() {
    try {
        const raw = localStorage.getItem(STORAGE_CHAT);
        if (!raw) return;
        const histories = JSON.parse(raw);
        // render last session or combined messages
        renderChatMessages(histories || []);
    } catch (e) { console.warn('Erro ao carregar histórico do chat', e); }
}

function saveChatHistory(messages) {
    try {
        localStorage.setItem(STORAGE_CHAT, JSON.stringify(messages));
    } catch (e) { console.warn('Erro ao salvar histórico do chat', e); }
}

function getChatMessages() {
    const messagesRaw = localStorage.getItem(STORAGE_CHAT);
    if (!messagesRaw) return [];
    try { return JSON.parse(messagesRaw); } catch (e) { return []; }
}

function renderChatMessages(messages) {
    const container = document.getElementById('chatMessages');
    if (!container) return;
    container.innerHTML = '';
    messages.forEach(m => {
        const el = document.createElement('div');
        el.className = 'chat-message ' + (m.role === 'user' ? 'user' : 'bot');
        const inner = document.createElement('div');
        inner.className = 'message-content';
        inner.innerHTML = `<p>${escapeHtml(m.content).replace(/\n/g, '<br>')}</p>`;
        el.appendChild(inner);
        container.appendChild(el);
    });
    container.scrollTop = container.scrollHeight;
}

function appendChatMessage(role, content) {
    const messages = getChatMessages();
    messages.push({ role, content, ts: Date.now() });
    saveChatHistory(messages);
    renderChatMessages(messages);
    const container = document.getElementById('chatMessages');
    if (!container) return null;
    return container.lastChild;
}

function enviarMensagemChat() {
    const input = document.getElementById('chatInput');
    if (!input) return;
    const text = input.value.trim();
    if (!text) return;
    
    // Verificar se tem API Key configurada
    if (!aiConfig.apiKey) {
        appendChatMessage('user', text);
        appendChatMessage('bot', '❌ API Key não configurada. Acesse as configurações para adicionar sua chave de IA.');
        input.value = '';
        input.disabled = false;
        return;
    }

    // Mostrar mensagem do usuário e loading
    appendChatMessage('user', text);
    input.value = '';
    input.disabled = true;
    const loadingEl = appendChatMessage('bot', '⏳ Pensando...') || null;

    // timeout via AbortController
    const controller = new AbortController();
    const timeoutMs = 20000; // 20s timeout
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    // Fazer requisição ao backend Python com timeout
    // Determinar modelo e provider (prefere configuração do aiConfig ou seleção atual)
    const selectedModel = aiConfig.model || document.querySelector('input[name="aiModel"]:checked')?.value || '';
    // Determinar provider: preferir configuração salva, senão inferir pelo nome do modelo
    let provider = aiConfig.provider || '';
    if (!provider) {
        const name = selectedModel.toLowerCase();
        if (name.includes('gem') || name.includes('gemma') || name.includes('gemini')) provider = 'genai';
        else provider = 'openai';
    }

    fetch('http://localhost:5000/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            api_key: aiConfig.apiKey,
            model: selectedModel,
            provider: provider,
            message: text,
            system_prompt: aiConfig.systemPrompt || 'Você é um assistente útil',
            
            max_tokens: aiConfig.maxTokens || 2000,
            history: []
        }),
        signal: controller.signal
    })
    .then(res => {
        clearTimeout(timeoutId);
        return res.json();
    })
    .then(data => {
        if (!loadingEl) {
            // fallback: render new bot message
            if (!data.success) appendChatMessage('bot', `❌ Erro: ${data.error}`);
            else appendChatMessage('bot', renderMessageHTML(data.response));
        } else {
            if (!data.success) {
                loadingEl.innerHTML = `<div class="message-content"><p>❌ Erro: ${data.error}</p></div>`;
            } else {
                loadingEl.innerHTML = `<div class="message-content"><p>${renderMessageHTML(data.response)}</p></div>`;
            }
        }
        input.disabled = false;
        input.focus();
    })
    .catch(err => {
        const msg = err.name === 'AbortError' ?
            'Tempo de resposta esgotado. Tente novamente.' :
            `Erro de conexão: ${err.message}`;
        if (loadingEl) {
            loadingEl.innerHTML = `<div class="message-content"><p>❌ ${msg}<br><small>Verifique se o backend está rodando em http://localhost:5000</small></p></div>`;
        } else {
            appendChatMessage('bot', `❌ ${msg}`);
        }
        input.disabled = false;
        input.focus();
    });
}

function sendEditorContentToChat(editorId, options = { isEdit: false, isPasso: false, autoSend: true }) {
    const editor = document.getElementById(editorId);
    if (!editor) return;
    const text = (editor.innerText || editor.textContent || '').trim();
    // open chat and prefill
    mudarSecao('chat');
    const input = document.getElementById('chatInput');
    if (input) input.value = text;
    currentChatOrigin = { type: options.isEdit ? 'edit' : 'create', docId: currentEditingId };
    setChatScopeBanner(options.isEdit ? 'Discussão: edição' : 'Discussão: criação');
    if (options.autoSend) enviarMensagemChat();
}

function goBackFromChat() {
    // if came from edit, reopen edit modal
    if (currentChatOrigin && currentChatOrigin.type === 'edit' && currentChatOrigin.docId) {
        currentEditingId = currentChatOrigin.docId;
        abrirEdicao();
        currentChatOrigin = null;
        clearChatScopeBanner();
        return;
    }
    // otherwise go back to documents
    mudarSecao('documentos');
    currentChatOrigin = null;
    clearChatScopeBanner();
}

function setChatScopeBanner(text) {
    try {
        const topBar = document.getElementById('chatTopBar');
        if (!topBar) return;
        topBar.textContent = '';
        const span = document.createElement('div');
        span.className = 'chat-scope-banner';
        span.textContent = text;
        topBar.appendChild(span);
        const backBtn = document.getElementById('chatBackBtn');
        if (backBtn) backBtn.style.display = '';
    } catch (e) {}
}

function clearChatScopeBanner() {
    try {
        const topBar = document.getElementById('chatTopBar');
        if (!topBar) return;
        topBar.innerHTML = '';
    } catch (e) {}
}

/* ===================== FIM CHAT IA ===================== */



const editorSelectionRanges = {};

function saveSelectionForEditor(editorId) {
    try {
        const sel = window.getSelection();
        if (sel && sel.rangeCount > 0) {
            editorSelectionRanges[editorId] = sel.getRangeAt(0).cloneRange();
        }
    } catch (e) {

    }
}

function restoreSelectionForEditor(editorId) {
    try {
        const range = editorSelectionRanges[editorId];
        if (range) {
            const sel = window.getSelection();
            sel.removeAllRanges();
            sel.addRange(range);
            delete editorSelectionRanges[editorId];
            return true;
        }
    } catch (e) {

    }
    return false;
}

function carregarDados() {
    const docs = localStorage.getItem(STORAGE_DOCS);
    const exs = localStorage.getItem(STORAGE_EXEMPLOS);
    const cats = localStorage.getItem(STORAGE_CATEGORIAS);

    categoriesLoadedFromStorage = cats !== null;
    const ai = localStorage.getItem(STORAGE_AI);

    documentacoes = docs ? JSON.parse(docs) : [];
    exemplos = exs ? JSON.parse(exs) : [];
    categorias = cats ? JSON.parse(cats) : [];

    if (documentacoes.length === 0) {
        documentacoes = [];
        salvarDados();
    }

    if (categorias.length > 0 && typeof categorias[0] === 'string') {
        categorias = categorias.map((nome, index) => ({
            id: index + 1,
            nome,
            icone: '📂',
            cor: undefined
        }));
        salvarDados();
    }

    
    documentacoes = documentacoes.map(d => {
        if (typeof d.conteudoPasso === 'undefined') d.conteudoPasso = '';
        if (d.hasOwnProperty('tipo')) delete d.tipo;
        if (typeof d.descricao === 'undefined') d.descricao = '';
        if (typeof d.tags === 'undefined') d.tags = [];
        
        if (d.categoria === 'todos') {
            // Keep as is
        } else if (typeof d.categoria === 'number') {
            d.categoria = String(d.categoria);
        } else if (typeof d.categoria === 'string') {
            // If it's a numeric string (id), keep it. Otherwise try to map from category name.
            if (/^\d+$/.test(d.categoria)) {
                // numeric string id, keep
            } else {
                const cat = categorias.find(c => c.nome === d.categoria);
                d.categoria = cat ? String(cat.id) : '1';
            }
        }
        return d;
    });
    
    if (ai) {
        aiConfig = JSON.parse(ai);
        const keyInput = document.getElementById('aiApiKey');
        const modelInput = document.getElementById('aiModel');
        if (keyInput) keyInput.value = aiConfig.apiKey;
        if (modelInput) modelInput.value = aiConfig.model;
    }
}

function salvarDados() {
    localStorage.setItem(STORAGE_DOCS, JSON.stringify(documentacoes));
    localStorage.setItem(STORAGE_EXEMPLOS, JSON.stringify(exemplos));
    localStorage.setItem(STORAGE_CATEGORIAS, JSON.stringify(categorias));
    
    aiConfig.apiKey = document.getElementById('aiApiKey')?.value || '';
    aiConfig.model = document.getElementById('aiModel')?.value || document.querySelector('input[name="aiModel"]:checked')?.value || '';
    localStorage.setItem(STORAGE_AI, JSON.stringify(aiConfig));
}

function criarCategoriasDefault() {


}

function renderizarCategorias() {
    const container = document.getElementById('categoriesList');
    if (!container) return;

    if (!categorias || categorias.length === 0) {
        container.innerHTML = `<div class="category-empty" style="padding:0.8rem 1rem; color:var(--text-secondary); opacity:0.6;">Nenhuma categoria. Clique em <strong>➕</strong> para criar uma nova.</div>`;
    } else {
        container.innerHTML = '';

        const all = document.createElement('div');
        all.className = 'category-item active';
        all.dataset.categoryId = 'todos';
        all.innerHTML = `
            <div class="category-left"><span class="category-icon">📋</span><span class="category-name">TODOS</span></div>
            <div class="category-actions"></div>
        `;
        container.appendChild(all);

        categorias.forEach(cat => {
            const item = document.createElement('div');
            item.className = 'category-item';
            item.dataset.categoryId = String(cat.id);
            item.innerHTML = `
                <div class="category-left"><span class="category-icon">${cat.icone}</span><span class="category-name">${cat.nome}</span></div>
                <div class="category-actions">
                    <button type="button" class="category-item-edit" title="Editar">✏️</button>
                    <button class="category-item-delete" title="Deletar">✕</button>
                </div>
            `;
            container.appendChild(item);
        });
    }

    if (typeof atualizarChatCategories === 'function') atualizarChatCategories();
}

function atualizarSelectsCategorias() {
    [document.getElementById('docCategory'), document.getElementById('editDocCategory')].forEach(select => {
        if (!select) return;
        const val = select.value;
        select.innerHTML = '<option value="">Selecione uma categoria</option>';
        categorias.forEach(cat => {
            select.innerHTML += `<option value="${String(cat.id)}">${cat.icone} ${cat.nome}</option>`;
        });
        if (val) select.value = val;

        select.disabled = !(categorias && categorias.length > 0);
    });
}

function atualizarChatCategorias() {
    const sel = document.getElementById('chatCategorySelect');
    if (!sel) return;
    const current = sel.value;
    sel.innerHTML = '<option value="">Todas</option>';
    categorias.forEach(cat => {
        const opt = document.createElement('option');
        opt.value = String(cat.id);
        opt.textContent = `${cat.icone} ${cat.nome}`;
        sel.appendChild(opt);
    });
    if (current) sel.value = current;
}

function getNomeCategoria(catId) {
    if (catId === 'todos') return '';
    if (typeof catId === 'number' && catId === 0) return '— Sem categoria';
    if (!catId) return '';
    const cat = categorias.find(c => String(c.id) === catId);
    return cat ? `${cat.icone} ${cat.nome}` : '📂 Sem categoria';
}

function getIconeCategoria(catId) {
    if (catId === 'todos') return '';
    const cat = categorias.find(c => String(c.id) === catId);
    return cat ? cat.icone : '📄';
}

function inicializarEventos() {

    document.querySelectorAll('.nav-link').forEach(link => {
        link.addEventListener('click', (e) => {
            e.preventDefault();
            mudarSecao(link.dataset.section);
        });

        // Lógica para linha única
        link.addEventListener('mouseenter', () => {
            // Esconder linha da ativa
            document.querySelectorAll('.nav-link.active').forEach(activeLink => {
                activeLink.classList.add('hide-line');
            });
        });

        link.addEventListener('mouseleave', () => {
            // Mostrar linha da ativa novamente
            document.querySelectorAll('.nav-link.active').forEach(activeLink => {
                activeLink.classList.remove('hide-line');
            });
        });
    });

    document.addEventListener('click', (e) => {

        const editModalOpen = document.getElementById('editModal')?.classList.contains('show');
        if (editModalOpen) return;

        const categoryModalOpen = document.getElementById('categoryModal')?.classList.contains('show');
        const editingCategoryId = document.getElementById('editingCategoryId')?.value;
        const isEditingCategory = categoryModalOpen && editingCategoryId && editingCategoryId.trim() !== '';
        
        if (e.target.closest('.category-item') && !e.target.closest('.category-item-delete') && !e.target.closest('.category-item-edit')) {
            if (isEditingCategory) {

                setModalVisible('categoryModal', false);
                iniciarModoReordenacao();
                return;
            } else {
                document.querySelectorAll('.category-item').forEach(i => i.classList.remove('active'));
                const clicked = e.target.closest('.category-item');
                clicked.classList.add('active');
                // debug logs removed
                const searchInput = document.getElementById('searchInput');
                if (searchInput) searchInput.value = '';
                mudarSecao('documentos');
                // Filtrar e renderizar imediatamente pelo id clicado (string)
                const clickedId = String(clicked.dataset.categoryId || 'todos');
                currentSelectedCategory = clickedId;
                if (clickedId === 'todos') {
                    renderizarDocumentacoes(documentacoes);
                } else {
                    const catObj = categorias.find(c => String(c.id) === clickedId);
                    const catName = catObj ? catObj.nome : null;
                    const filtrados = documentacoes.filter(d => {
                        const dc = (d.categoria === undefined || d.categoria === null) ? 'todos' : String(d.categoria);
                        return dc === clickedId || (catName && dc === String(catName));
                    });
                    renderizarDocumentacoes(filtrados);
                }
            }
        }

        if (e.target.closest('.category-item-edit') || e.target.closest('.edit-cat-btn')) {
            e.stopPropagation();
            const btn = e.target.closest('button');
            const catId = parseInt(btn?.dataset?.catId || e.target.closest('.category-item')?.dataset?.categoryId);
            const cat = categorias.find(c => c.id === catId);
            if (!cat) return;

                document.getElementById('categoryName').value = cat.nome;
                document.getElementById('categoryIcon').value = cat.icone;
                const col = document.getElementById('categoryColor'); if (col) col.value = cat.cor || '#6366f1';
                document.getElementById('editingCategoryId').value = String(cat.id);
                document.getElementById('categoryModalTitle').textContent = 'Editar Categoria';
                document.getElementById('categorySubmitBtn').textContent = '💾 Salvar Alterações';
                const palette = document.getElementById('iconPalette'); if (palette) palette.style.display = 'block';
                setModalVisible('categoryModal', true);
            return;
        }

        if (e.target.closest('.move-cat-btn')) {
            e.stopPropagation();
            const btn = e.target.closest('.move-cat-btn');
            iniciarModoReordenacao();
        }

        if (e.target.closest('.category-item-delete')) {
            const catId = parseInt(e.target.closest('.category-item').dataset.categoryId);
            const cat = categorias.find(c => c.id === catId);
                if (confirm(`⚠️ ATENÇÃO: Deletar categoria "${cat.nome}"? Esta ação não pode ser desfeita!`) &&
                confirm(`Tem CERTEZA? Documentos nessa categoria serão movidos para outra categoria (ou ficarão sem categoria).`)) {
                categorias = categorias.filter(c => c.id !== catId);
                documentacoes.forEach(d => {
                    if (d.categoria === catId) d.categoria = categorias.length > 0 ? (categorias[0]?.id || 0) : 0;
                });
                salvarDados();
                renderizarCategorias();
                atualizarSelectsCategorias();
                renderizarDocumentacoes();
                atualizarStats();
                alert('✅ Categoria deletada!');
            }
        }

        if (e.target.closest('.delete-cat-btn')) {
            const catId = parseInt(e.target.closest('.delete-cat-btn').dataset.catId);
            const cat = categorias.find(c => c.id === catId);
            if (confirm(`⚠️ ATENÇÃO: Deletar categoria "${cat.nome}"? Esta ação não pode ser desfeita!`) &&
                confirm(`Tem CERTEZA? Documentos nessa categoria serão movidos para outra categoria (ou ficarão sem categoria).`)) {
                categorias = categorias.filter(c => c.id !== catId);
                documentacoes.forEach(d => {
                    if (d.categoria === catId) d.categoria = categorias.length > 0 ? (categorias[0]?.id || 0) : 0;
                });
                salvarDados();
                renderizarCategorias();
                atualizarSelectsCategorias();
                renderizarDocumentacoes();
                atualizarStats();
                alert('✅ Categoria deletada!');
            }
        }

        if (e.target.closest('.edit-cat-btn')) {
            const catId = parseInt(e.target.closest('.edit-cat-btn').dataset.catId);
            const cat = categorias.find(c => c.id === catId);
            if (!cat) return;
            document.getElementById('categoryName').value = cat.nome;
            document.getElementById('categoryIcon').value = cat.icone;
            const col2 = document.getElementById('categoryColor'); if (col2) col2.value = cat.cor || '#6366f1';
            document.getElementById('editingCategoryId').value = String(cat.id);
            document.getElementById('categoryModalTitle').textContent = 'Editar Categoria';
            document.getElementById('categorySubmitBtn').textContent = '💾 Salvar Alterações';
            const palette2 = document.getElementById('iconPalette'); if (palette2) palette2.style.display = 'block';
            setModalVisible('categoryModal', true);
        }
    });

    const btnAddDoc = document.getElementById('quickAddDocBtn');
    if (btnAddDoc) {
        btnAddDoc.addEventListener('click', () => {
            mudarSecao('adicionar');
            document.getElementById('docForm')?.reset();
            setTimeout(() => document.getElementById('docTitle').focus(), 100);
        });
    }
    const btnAddExemplo = document.getElementById('quickAddExemploBtn');
    if (btnAddExemplo) {
        btnAddExemplo.addEventListener('click', () => {
            abrirModalExemplo();
        });
    }

    const btnAddCategory = document.getElementById('addCategoryBtn');
    if (btnAddCategory) {
        btnAddCategory.addEventListener('click', () => {

            document.getElementById('categoryForm').reset();
            document.getElementById('editingCategoryId').value = '';
            document.getElementById('categoryModalTitle').textContent = 'Adicionar Categoria';
            document.getElementById('categorySubmitBtn').textContent = '➕ Criar Categoria';
            const palette = document.getElementById('iconPalette'); if (palette) palette.style.display = 'none';
            setModalVisible('categoryModal', true);
        });
    }

    const btnAddCategorySettings = document.getElementById('addNewCategoryBtn');
    if (btnAddCategorySettings) {
        btnAddCategorySettings.addEventListener('click', () => {

                const btnReorderCategories = document.getElementById('reorderCategoriesBtn');
                if (btnReorderCategories) {
                    btnReorderCategories.addEventListener('click', () => {
                        iniciarModoReordenacaoSettings();
                    });
                }
            document.getElementById('categoryForm').reset();
            document.getElementById('editingCategoryId').value = '';
            document.getElementById('categoryModalTitle').textContent = 'Adicionar Categoria';
            document.getElementById('categorySubmitBtn').textContent = '➕ Criar Categoria';
            const palette = document.getElementById('iconPalette'); if (palette) palette.style.display = 'none';
            setModalVisible('categoryModal', true);
        });
    }

    const searchInput = document.getElementById('searchInput');
    if (searchInput) {
        searchInput.addEventListener('keyup', pesquisarDocumentacoes);
    }

    const searchBtn = document.querySelector('.search-btn');
    if (searchBtn) {
        searchBtn.addEventListener('click', pesquisarDocumentacoes);
    }

    document.querySelectorAll('.view-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            document.querySelectorAll('.view-btn').forEach(b => b.classList.remove('active'));
            e.target.classList.add('active');
            renderizarDocumentacoes();
        });
    });

    const reorderDocsBtn = document.getElementById('reorderDocsBtn');
    if (reorderDocsBtn) {
        reorderDocsBtn.addEventListener('click', iniciarModoReordenacaoDocs);
    }

    inicializarRichEditor();

    const docForm = document.getElementById('docForm');
    if (docForm) docForm.addEventListener('submit', adicionarDocumentacao);

    // Botão de enviar para chat na seção de adicionar
    const sendAddToChatBtn = document.getElementById('sendAddToChatBtn');
    if (sendAddToChatBtn) {
        sendAddToChatBtn.addEventListener('click', () => {
            const editorId = document.getElementById('docType').value === 'passo-a-passo' ? 'docPassoContent' : 'docContent';
            sendEditorContentToChat(editorId, { isEdit: false, isPasso: document.getElementById('docType').value === 'passo-a-passo', autoSend: true });
        });
    }

    // Botão de enviar para chat na seção de editar
    const sendEditToChatBtn = document.getElementById('sendEditToChatBtn');
    if (sendEditToChatBtn) {
        sendEditToChatBtn.addEventListener('click', () => {
            const isPasso = currentEditVersion === 'passo-a-passo';
            const editorId = isPasso ? 'editDocPassoContent' : 'editDocContent';
            sendEditorContentToChat(editorId, { isEdit: true, isPasso: isPasso, autoSend: true });
        });
    }

    const docTypeSelect = document.getElementById('docType');
    if (docTypeSelect) {
        const docPassoGroup = document.getElementById('docPassoGroup');
        const docContentGroup = document.getElementById('docContentGroup');
        docTypeSelect.addEventListener('change', (e) => {
            const v = e.target.value;
            if (v === 'normal') {
                if (docPassoGroup) docPassoGroup.style.display = 'none';
                if (docContentGroup) docContentGroup.style.display = 'block';
                const fullscreenAddBtn = document.getElementById('fullscreenAddToolbarBtn');
                if (fullscreenAddBtn) fullscreenAddBtn.style.display = 'inline-block';
                const fullscreenAddBtnPasso = document.getElementById('fullscreenAddToolbarBtnPasso');
                if (fullscreenAddBtnPasso) fullscreenAddBtnPasso.style.display = 'none';
            } else if (v === 'passo-a-passo') {
                if (docPassoGroup) docPassoGroup.style.display = 'block';
                if (docContentGroup) docContentGroup.style.display = 'none';
                const fullscreenAddBtn = document.getElementById('fullscreenAddToolbarBtn');
                if (fullscreenAddBtn) fullscreenAddBtn.style.display = 'none';
                const fullscreenAddBtnPasso = document.getElementById('fullscreenAddToolbarBtnPasso');
                if (fullscreenAddBtnPasso) fullscreenAddBtnPasso.style.display = 'inline-block';
            }
        });
    }

    const editForm = document.getElementById('editForm');
    if (editForm) editForm.addEventListener('submit', salvarEdicao);

    const exemploForm = document.getElementById('exemploForm');
    if (exemploForm) exemploForm.addEventListener('submit', adicionarExemplo);

    const categoryForm = document.getElementById('categoryForm');
    if (categoryForm) categoryForm.addEventListener('submit', adicionarCategoria);

    const docDescriptionInput = document.getElementById('docDescription');
    const docDescriptionCounter = document.getElementById('docDescriptionCounter');
    const editDocDescriptionInput = document.getElementById('editDocDescription');
    const editDocDescriptionCounter = document.getElementById('editDocDescriptionCounter');

    function atualizarContador(input, counter, maxLength) {
        if (input && counter) {
            const currentLength = input.value.length;
            const remaining = maxLength - currentLength;
            counter.textContent = `${currentLength}/${maxLength}`;
            counter.style.color = remaining < 10 ? '#ef4444' : 'var(--text-secondary)';
        }
    }

    if (docDescriptionInput && docDescriptionCounter) {
        docDescriptionInput.addEventListener('input', () => atualizarContador(docDescriptionInput, docDescriptionCounter, 100));

        atualizarContador(docDescriptionInput, docDescriptionCounter, 100);
    }

    if (editDocDescriptionInput && editDocDescriptionCounter) {
        editDocDescriptionInput.addEventListener('input', () => atualizarContador(editDocDescriptionInput, editDocDescriptionCounter, 100));

        atualizarContador(editDocDescriptionInput, editDocDescriptionCounter, 100);
    }

    fecharModalsEventos();

    // Dark mode: default to dark when no preference stored
    const darkToggle = document.getElementById('darkMode');
    const storedTheme = localStorage.getItem('theme');
    if (storedTheme === 'dark') {
        document.body.classList.add('dark-mode');
    } else if (storedTheme === 'light') {
        document.body.classList.remove('dark-mode');
    } else {
        // no stored preference -> default to dark
        document.body.classList.add('dark-mode');
        localStorage.setItem('theme', 'dark');
    }
    if (darkToggle) {
        darkToggle.checked = document.body.classList.contains('dark-mode');
        darkToggle.addEventListener('change', () => {
            const isDark = darkToggle.checked;
            if (isDark) document.body.classList.add('dark-mode'); else document.body.classList.remove('dark-mode');
            localStorage.setItem('theme', isDark ? 'dark' : 'light');
        });
    }

    // Top-right settings button -> opens lightweight settings modal
    const topSettingsBtn = document.getElementById('topSettingsBtn');
    const settingsModal = document.getElementById('settingsModal');
    const closeSettings = document.querySelector('.close-settings');
    if (topSettingsBtn && settingsModal) {
        topSettingsBtn.addEventListener('click', () => {
            setModalVisible('settingsModal', true);
            populateSettingsModal();
        });
    }
    if (closeSettings && settingsModal) {
        closeSettings.addEventListener('click', () => setModalVisible('settingsModal', false));
    }
    // allow clicking outside modal to close
    if (settingsModal) {
        window.addEventListener('click', (e) => {
            if (e.target === settingsModal) setModalVisible('settingsModal', false);
        });
    }

    // Settings do IA (modal exclusivo) - Navbar
    const aiSettingsBtn = document.getElementById('aiSettingsBtn');
    const aiSettingsModal = document.getElementById('aiSettingsModal');
    const closeAiSettings = document.querySelector('.close-ai-settings');

    if (aiSettingsBtn && aiSettingsModal) {
        aiSettingsBtn.addEventListener('click', () => {
            setModalVisible('aiSettingsModal', true);
            carregarConfigsIA();
        });
    }

    // Settings do IA (modal exclusivo) - Botão do Chat
    const chatSettingsBtn = document.getElementById('chatSettingsBtn');
    if (chatSettingsBtn && aiSettingsModal) {
        chatSettingsBtn.addEventListener('click', () => {
            setModalVisible('aiSettingsModal', true);
            carregarConfigsIA();
        });
    }

    if (closeAiSettings && aiSettingsModal) {
        closeAiSettings.addEventListener('click', () => setModalVisible('aiSettingsModal', false));
    }

    if (aiSettingsModal) {
        window.addEventListener('click', (e) => {
            if (e.target === aiSettingsModal) setModalVisible('aiSettingsModal', false);
        });
    }

    // Sistema de abas do modal de IA
    document.querySelectorAll('.ai-tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const tabName = btn.dataset.tab;
            
            // Desativar todas as abas
            document.querySelectorAll('.ai-tab-btn').forEach(b => b.classList.remove('active'));
            document.querySelectorAll('.ai-tab-content').forEach(c => c.classList.remove('active'));
            
            // Ativar aba selecionada
            btn.classList.add('active');
            const tabContent = document.querySelector(`.ai-tab-content[data-tab="${tabName}"]`);
            if (tabContent) tabContent.classList.add('active');
        });
    });

    // Botões de salvar das abas
    document.getElementById('saveSystemPromptBtn')?.addEventListener('click', salvarSystemPrompt);
    document.getElementById('resetSystemPromptBtn')?.addEventListener('click', restaurarSystemPromptPadrao);
    document.getElementById('saveApiSettingsBtn')?.addEventListener('click', salvarConfigsIA);
    document.getElementById('validateApiKeyBtn')?.addEventListener('click', validarApiKey);
    document.getElementById('runConnectionTestBtn')?.addEventListener('click', testarConexaoIA);

    // Toggle visibilidade da API Key
    const toggleAiKeyBtn = document.getElementById('toggleAiKeyBtn');
    if (toggleAiKeyBtn) {
        // SVGs para olhos (open / closed)
        const eyeOpen = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true">'
            + '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/>'
            + '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"/>'
            + '</svg>';
        const eyeClosed = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true">'
            + '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 3l18 18"/>'
            + '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10.58 10.58A3 3 0 0113.42 13.42"/>'
            + '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M14.12 14.12C12.98 15.26 11.03 15.26 9.89 14.12"/>'
            + '</svg>';

        toggleAiKeyBtn.addEventListener('click', (e) => {
            const input = document.getElementById('aiApiKey');
            if (!input) return;
            if (input.type === 'password') {
                input.type = 'text';
                toggleAiKeyBtn.innerHTML = eyeClosed;
                toggleAiKeyBtn.title = 'Ocultar chave';
            } else {
                input.type = 'password';
                toggleAiKeyBtn.innerHTML = eyeOpen;
                toggleAiKeyBtn.title = 'Mostrar chave';
            }
        });
    }

    // Controle de temperatura removido da UI

    // Botão de limpar chat
    document.getElementById('clearChatBtn')?.addEventListener('click', limparChat);

    // Salvar configurações de IA
    document.getElementById('saveAiSettingsBtn')?.addEventListener('click', () => {
        salvarConfigsIA();
    });

    document.getElementById('saveUiBtn')?.addEventListener('click', () => {
        // Aparência: opção desativada conforme solicitado (não aplica cores)
        showToast('🎨 Aparência salva (nota: cores não serão aplicadas)', 'info');
    });

    document.getElementById('resetUiBtn')?.addEventListener('click', () => {
        localStorage.removeItem(STORAGE_UI);
        location.reload();
    });

    // populate saved prompts list
    function populateSavedPrompts(){
        const list = document.getElementById('savedPromptsList');
        if (!list) return;
        list.innerHTML = '';
        (aiConfig.prompts||[]).forEach((p, idx) => {
            const el = document.createElement('div');
            el.className = 'saved-prompt';
            el.innerHTML = `<small>${p}</small><div style="display:flex;gap:6px;"><button class='btn-small use-prompt' data-idx='${idx}'>Usar</button><button class='btn-small del-prompt' data-idx='${idx}'>✕</button></div>`;
            list.appendChild(el);
        });
        list.querySelectorAll('.del-prompt').forEach(b => b.addEventListener('click', (e)=>{
            const i = parseInt(b.dataset.idx);
            aiConfig.prompts.splice(i,1);
            saveAiConfig();
            populateSavedPrompts();
        }));
        list.querySelectorAll('.use-prompt').forEach(b => b.addEventListener('click', ()=>{
            const i = parseInt(b.dataset.idx);
            document.getElementById('aiPrompt').value = aiConfig.prompts[i] || '';
        }));
    }

    // populate settings modal fields from storage
    function populateSettingsModal(){
        // Carregar configurações de UI
        const ui = loadUiConfig();
        if (ui) {
            document.getElementById('uiPrimary').value = ui.primary || '#6366f1';
            document.getElementById('uiSecondary').value = ui.secondary || '#8b5cf6';
            document.getElementById('uiBackground').value = ui.background || '#f9fafb';
            document.getElementById('uiSurface').value = ui.surface || '#ffffff';
            document.getElementById('uiText').value = ui.text || '#1f2937';
        }
    }

    // Carregar configurações de IA para o modal exclusivo
    function carregarConfigsIA() {
        try {
            const ai = localStorage.getItem(STORAGE_AI);
            if (ai) aiConfig = JSON.parse(ai);
        } catch(e){}
        
        document.getElementById('aiApiKey').value = aiConfig.apiKey || '';
        document.getElementById('aiModel').value = aiConfig.model || document.querySelector('input[name="aiModel"]:checked')?.value || '';
        document.getElementById('aiSystemPrompt').value = aiConfig.systemPrompt || 'Você é um assistente de IA útil, preciso e respeitoso. Responda em português. Seja conciso mas informativo.';
        document.getElementById('aiMaxTokens').value = aiConfig.maxTokens || 2000;
        
        // Selecionar modelo
        const modelRadios = document.querySelectorAll('input[name="aiModel"]');
        const defaultSelection = aiConfig.model || document.querySelector('input[name="aiModel"]:checked')?.value || '';
        modelRadios.forEach(radio => {
            if (radio.value === defaultSelection) {
                radio.checked = true;
            }
        });
    }

    // Função de label de temperatura removida (controle de temperatura foi retirado da UI)

    // Validar API Key
    function validarApiKey() {
        const apiKey = document.getElementById('aiApiKey').value.trim();
        const badge = document.getElementById('apiKeyStatusBadge');
        const btn = document.getElementById('validateApiKeyBtn');

        if (!apiKey) {
            badge.classList.remove('valid');
            badge.textContent = '❌ API Key não foi preenchida';
            badge.style.display = 'block';
            return;
        }

        btn.disabled = true;
        btn.textContent = '⏳ Validando...';

        // Detect provider: respeitar aiConfig.provider ou inferir pelo modelo selecionado
        const selectedModel = aiConfig.model || document.querySelector('input[name="aiModel"]:checked')?.value || '';
        let provider = aiConfig.provider || '';
        if (!provider) {
            const name = (selectedModel || '').toLowerCase();
            if (name.includes('gem') || name.includes('gemma') || name.includes('gemini')) provider = 'genai';
            else provider = 'openai';
        }
        const modelForTest = selectedModel || (provider === 'genai' ? 'gemma-3-27b-it' : 'gpt-3.5-turbo');

        // Fazer requisição ao backend para validar (rota /validate)
        fetch('http://localhost:5000/validate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ api_key: apiKey, model: modelForTest, provider: provider })
        })
        .then(res => res.json())
        .then(data => {
            if (data.valid) {
                badge.classList.add('valid');
                badge.textContent = '✅ API Key válida! Pronta para usar.';
            } else {
                badge.classList.remove('valid');
                badge.textContent = '❌ API Key inválida ou expirada: ' + (data.error || 'verifique a chave');
            }
            badge.style.display = 'block';
            btn.disabled = false;
            btn.textContent = '🔍 Validar Chave';
        })
        .catch(err => {
            badge.classList.remove('valid');
            badge.textContent = '❌ Erro ao validar: ' + err.message;
            badge.style.display = 'block';
            btn.disabled = false;
            btn.textContent = '🔍 Validar Chave';
        });
    }

    // Verificar se servidor está online
    function verificarServerOnline(tentativas = 0) {
        return fetch('http://localhost:5000/health', { method: 'GET' })
            .then(res => res.json())
            .then(data => {
                if (data.status === 'online') {
                    return true;
                }
                throw new Error('Server not responding');
            })
            .catch(err => {
                if (tentativas < 5) {
                    return new Promise(resolve => {
                        setTimeout(() => resolve(verificarServerOnline(tentativas + 1)), 1000);
                    });
                } else {
                    return false;
                }
            });
    }

    // Função para executar teste dos modelos
    function executarTesteModelos(apiKey, status, results, btn, provider) {
        let modeloFuncional = null;
        let providerFuncional = null;

        function testarModelo(modelo, prov) {
            return fetch('http://localhost:5000/validate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ api_key: apiKey, model: modelo, provider: prov })
            }).then(res => res.json()).then(validationData => {
                document.getElementById('testConnectionMessage').textContent = `Testando ${modelo} (${prov})...`;
                if (validationData && validationData.valid) {
                    modeloFuncional = modelo;
                    providerFuncional = prov;
                    return true;
                }
                return false;
            }).catch(() => false);
        }

        (async () => {
            const selected = aiConfig.model || document.querySelector('input[name="aiModel"]:checked')?.value || '';

            const providersToTry = provider ? [provider] : ['openai', 'genai'];

            for (const prov of providersToTry) {
                let modelos = [];
                if (selected) modelos = [selected];
                else if (prov === 'genai') modelos = ['gemma-3-27b-it', 'gemma-3-12b', 'gemini-1.5'];
                else modelos = ['gpt-4', 'gpt-3.5-turbo'];

                for (const modelo of modelos) {
                    const ok = await testarModelo(modelo, prov);
                    if (ok) break;
                }

                if (modeloFuncional) break;
            }

            document.getElementById('testConnectionMessage').textContent = '✅ Teste concluído!';

            if (modeloFuncional) {
                results.innerHTML = `
                    <div style="color: #22c55e;">
                        <h5 style="margin: 0 0 12px 0;">✅ API Key Válida!</h5>
                        <div style="background: rgba(34, 197, 94, 0.1); padding: 10px; border-radius: 4px; margin-bottom: 12px;">
                            <p style="margin: 4px 0; font-weight: 600;">🎉 Provider:</p>
                            <p style="margin: 4px 0; font-size: 1.05rem; font-weight: 700; color: var(--primary-color);">${providerFuncional} — ${modeloFuncional}</p>
                        </div>
                        <p style="margin-top: 12px; font-size: 0.85rem; color: var(--text-secondary);">Sua chave está ativa e funcionando!</p>
                    </div>
                `;

                results.style.display = 'block';
                document.getElementById('aiApiKey').value = apiKey;
                const radio = document.querySelector(`input[name="aiModel"][value="${modeloFuncional}"]`);
                if (radio) radio.checked = true;
                aiConfig.apiKey = apiKey;
                aiConfig.model = modeloFuncional;
                aiConfig.provider = providerFuncional;
                localStorage.setItem(STORAGE_AI, JSON.stringify(aiConfig));

                showToast(`✅ Configurado! Provider: ${providerFuncional}`, 'success');
            } else {
                results.innerHTML = `
                    <div style="color: #ef4444;">
                        <h5 style="margin: 0 0 12px 0;">❌ API Key Inválida</h5>
                        <p style="margin: 8px 0; font-size: 0.85rem;">Verifique se a chave está correta e ainda é válida.</p>
                    </div>
                `;
                results.style.display = 'block';
                showToast('❌ API Key inválida - verifique e tente novamente', 'error');
            }

            btn.disabled = false;
            btn.textContent = '🚀 Testar Automaticamente';
        })();
    }
    function testarConexaoIA() {
        const apiKey = document.getElementById('testApiKey').value.trim();
        const status = document.getElementById('testConnectionStatus');
        const results = document.getElementById('testResults');
        const btn = document.getElementById('runConnectionTestBtn');

        if (!apiKey) {
            showToast('❌ Preencha a API Key para testar', 'error');
            return;
        }

        // aceitar chaves de outros provedores (não exigir prefixo sk-)

        btn.disabled = true;
        btn.textContent = '⏳ Verificando servidor...';
        status.style.display = 'block';
        status.innerHTML = `
            <div style="display: flex; align-items: center; gap: 10px;">
                <div style="width: 16px; height: 16px; border: 2px solid var(--primary-color); border-top: 2px solid transparent; border-radius: 50%; animation: spin 1s linear infinite;"></div>
                <div id="testConnectionMessage" style="font-weight: 600; color: var(--primary-color);">⏳ Verificando servidor...</div>
            </div>
            <style>
                @keyframes spin {
                    to { transform: rotate(360deg); }
                }
            </style>
        `;
        results.style.display = 'none';

        // Verificar se servidor está online
        verificarServerOnline()
            .then(serverOnline => {
                if (!serverOnline) {
                    // Servidor não está respondendo
                    btn.disabled = false;
                    btn.textContent = '🚀 Testar Automaticamente';
                    
                    status.innerHTML = `
                        <div style="display: flex; align-items: center; gap: 10px;">
                            <span style="font-size: 24px;">❌</span>
                            <div id="testConnectionMessage" style="font-weight: 600; color: #ef4444;">
                                Servidor não encontrado
                            </div>
                        </div>
                    `;

                    results.innerHTML = `
                        <div style="color: #ef4444;">
                            <h5 style="margin: 0 0 12px 0;">❌ Servidor não está rodando</h5>
                            <p style="margin: 8px 0; font-weight: 600;">Execute o arquivo para iniciar:</p>
                            
                            <div style="background: rgba(239, 68, 68, 0.1); padding: 12px; border-radius: 4px; margin: 12px 0; font-family: monospace; font-size: 0.9rem;">
                                <p style="margin: 4px 0; color: #22c55e;">👉 IA/iniciar.bat</p>
                            </div>

                            <p style="margin-top: 12px; font-size: 0.85rem; color: var(--text-secondary);">
                                Após executar, volte aqui e clique em "Testar Automaticamente" novamente.
                            </p>
                        </div>
                    `;
                    results.style.display = 'block';
                    showToast('❌ Execute IA/iniciar.bat para iniciar o servidor', 'error');
                    return;
                }

                // Servidor está online! Proceder com o teste
                status.innerHTML = `
                    <div style="display: flex; align-items: center; gap: 10px;">
                        <span style="font-size: 24px;">✅</span>
                        <div id="testConnectionMessage" style="font-weight: 600; color: #22c55e;">
                            Servidor online! Testando modelos...
                        </div>
                    </div>
                `;

                executarTesteModelos(apiKey, status, results, btn);
            });
    }

    // Salvar configurações de IA
    function salvarConfigsIA() {
        const apiKey = document.getElementById('aiApiKey').value.trim();
        const model = document.querySelector('input[name="aiModel"]:checked')?.value || '';

        if (!apiKey) {
            showToast('❌ Preencha a chave de API', 'error');
            return;
        }

        // Ler também system prompt e max tokens
        const systemPrompt = document.getElementById('aiSystemPrompt')?.value || '';
        const maxTokens = parseInt(document.getElementById('aiMaxTokens')?.value) || 2000;

        aiConfig.apiKey = apiKey;
        aiConfig.model = model;
        aiConfig.systemPrompt = systemPrompt;
        aiConfig.maxTokens = maxTokens;

        // Incluir provider inferido
        let provider = aiConfig.provider || '';
        if (!provider) {
            const name = (model || '').toLowerCase();
            provider = (name.includes('gem') || name.includes('gemma') || name.includes('gemini')) ? 'genai' : 'openai';
            aiConfig.provider = provider;
        }

        localStorage.setItem(STORAGE_AI, JSON.stringify(aiConfig));
        showToast('✅ Configurações de API salvas!', 'success');

        // Fechar modal de configurações de IA
        setModalVisible('aiSettingsModal', false);

        // Ir direto para o Chat e focar o input
        mudarSecao('chat');
        setTimeout(() => {
            const chatInput = document.getElementById('chatInput');
            if (chatInput) {
                chatInput.focus();
            }
        }, 150);
    }

    // Salvar System Prompt
    function salvarSystemPrompt() {
        const systemPrompt = document.getElementById('aiSystemPrompt').value.trim();
        const maxTokens = parseInt(document.getElementById('aiMaxTokens').value) || 2000;

        if (!systemPrompt) {
            showToast('❌ System Prompt não pode estar vazio', 'error');
            return;
        }

        aiConfig.systemPrompt = systemPrompt;
        aiConfig.maxTokens = maxTokens;

        localStorage.setItem(STORAGE_AI, JSON.stringify(aiConfig));
        showToast('✅ System Prompt salvo!', 'success');
    }

    // Restaurar System Prompt padrão
    function restaurarSystemPromptPadrao() {
        const padrao = 'Você é um assistente de IA útil, preciso e respeitoso. Responda em português. Seja conciso mas informativo.';
        document.getElementById('aiSystemPrompt').value = padrao;
        aiConfig.systemPrompt = padrao;
        localStorage.setItem(STORAGE_AI, JSON.stringify(aiConfig));
        showToast('✅ System Prompt restaurado ao padrão', 'success');
    }

    // Limpar chat
    function limparChat() {
        if (confirm('Tem certeza que deseja limpar todo o histórico do chat?')) {
            const chatMessages = document.getElementById('chatMessages');
            if (chatMessages) {
                chatMessages.innerHTML = '<div class="chat-message bot"><div class="message-content"><p>Olá! 👋 Sou seu assistente de IA. Como posso ajudá-lo?</p></div></div>';
            }
            showToast('✅ Chat limpo', 'success');
        }
    }

    // on load apply ui config if present
    const uiConf = loadUiConfig();
    if (uiConf) applyUiConfig(uiConf);

    const exportBtn = document.getElementById('exportBtn');
    if (exportBtn) exportBtn.addEventListener('click', exportarDados);

    const importBtn = document.getElementById('importBtn');
    if (importBtn) importBtn.addEventListener('click', () => document.getElementById('importFile').click());

    const importFile = document.getElementById('importFile');
    if (importFile) importFile.addEventListener('change', importarDados);

    const clearBtn = document.getElementById('clearAllBtn');
    if (clearBtn) {
        clearBtn.addEventListener('click', () => {
            if (confirm('ATENÇÃO: Isso vai deletar TUDO! Tem certeza?')) {
                documentacoes = [];
                exemplos = [];
                salvarDados();
                filtrarPorCategoria(currentSelectedCategory);
                renderizarExemplos();
                atualizarStats();
            }
        });
    }

    const exportOrdensBtn = document.getElementById('exportOrdensBtn');
    if (exportOrdensBtn) exportOrdensBtn.addEventListener('click', exportarOrdens);

    const importOrdensBtn = document.getElementById('importOrdensBtn');
    if (importOrdensBtn) importOrdensBtn.addEventListener('click', () => document.getElementById('importOrdensFile').click());

    const importOrdensFile = document.getElementById('importOrdensFile');
    if (importOrdensFile) importOrdensFile.addEventListener('change', importarOrdens);

    const clearOrdensBtn = document.getElementById('clearOrdensBtn');
    if (clearOrdensBtn) clearOrdensBtn.addEventListener('click', limparOrdens);

    const aiKeyInput = document.getElementById('aiApiKey');
    if (aiKeyInput) aiKeyInput.addEventListener('change', () => salvarDados());

    const aiModelInput = document.getElementById('aiModel');
    if (aiModelInput) aiModelInput.addEventListener('change', () => salvarDados());

    const testAiBtn = document.getElementById('testAiBtn');
    if (testAiBtn) testAiBtn.addEventListener('click', () => alert('🧪 Teste de IA (futuro)'));

    const sendChatBtn = document.getElementById('sendChatBtn');
    if (sendChatBtn) sendChatBtn.addEventListener('click', enviarMensagemChat);

    const chatInput = document.getElementById('chatInput');
    if (chatInput) {
        chatInput.addEventListener('keyup', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                enviarMensagemChat();
            }
        });
    }
}

let reorderingMode = false;
let reorderingDocsMode = false;
let draggedElement = null;

function iniciarModoReordenacao() {
    reorderingMode = true;
    const container = document.getElementById('categoriesList');
    if (!container) return;

    container.querySelectorAll('.category-item').forEach((item, idx) => {
        if (idx > 0) { // Pular o item "Todos"
            item.classList.add('reordering-mode');
            item.draggable = true;
            
            item.removeEventListener('dragstart', handleDragStart);
            item.removeEventListener('dragover', handleDragOver);
            item.removeEventListener('drop', handleDrop);
            item.removeEventListener('dragend', handleDragEnd);
            item.removeEventListener('dragenter', handleDragEnter);
            item.removeEventListener('dragleave', handleDragLeave);
        }
    });

    const editModalOpen = document.getElementById('editModal')?.classList.contains('show');
    
    if (editModalOpen) {
        return;
    } else {

        const reorderActions = document.querySelector('.reorder-actions');
        if (reorderActions) {
            reorderActions.innerHTML = `
                <button class="btn-confirm-reorder" id="confirmReorderBtn">✅ Confirmar</button>
                <button class="btn-cancel-reorder" id="cancelReorderBtn">❌ Cancelar</button>
            `;
            reorderActions.classList.add('visible');

            document.getElementById('confirmReorderBtn').addEventListener('click', confirmarReordenacao);
            document.getElementById('cancelReorderBtn').addEventListener('click', cancelarReordenacao);
        }
    }

    container.querySelectorAll('.category-item.reordering-mode').forEach(item => {
        item.removeEventListener('dragstart', handleDragStart);
        item.removeEventListener('dragover', handleDragOver);
        item.removeEventListener('drop', handleDrop);
        item.removeEventListener('dragend', handleDragEnd);
        item.removeEventListener('dragenter', handleDragEnter);
        item.removeEventListener('dragleave', handleDragLeave);
        
        item.addEventListener('dragstart', handleDragStart);
        item.addEventListener('dragover', handleDragOver);
        item.addEventListener('drop', handleDrop);
        item.addEventListener('dragend', handleDragEnd);
        item.addEventListener('dragenter', handleDragEnter);
        item.addEventListener('dragleave', handleDragLeave);
    });

    bloquearInterfaceReordenacao(true);
}

function iniciarModoReordenacaoSettings() {
    reorderingMode = true;
    const container = document.getElementById('categoriesSettings');
    if (!container) return;

    container.querySelectorAll('.category-setting-item').forEach((item) => {
        item.classList.add('reordering-mode');
        item.draggable = true;
    });

    container.querySelectorAll('.setting-actions').forEach(actions => {
        actions.style.display = 'none';
    });

    const reorderActions = document.getElementById('reorderActionsSettings');
    if (reorderActions) {
        reorderActions.innerHTML = `
            <button class="btn-confirm-reorder" id="confirmReorderSettingsBtn">✅ Confirmar</button>
            <button class="btn-cancel-reorder" id="cancelReorderSettingsBtn">❌ Cancelar</button>
        `;
        reorderActions.classList.add('visible');

        document.getElementById('confirmReorderSettingsBtn').addEventListener('click', confirmarReordenacaoSettings);
        document.getElementById('cancelReorderSettingsBtn').addEventListener('click', cancelarReordenacaoSettings);
    }

    container.querySelectorAll('.category-setting-item.reordering-mode').forEach(item => {
        item.addEventListener('dragstart', handleDragStart);
        item.addEventListener('dragover', handleDragOver);
        item.addEventListener('drop', handleDropSettings);
        item.addEventListener('dragend', handleDragEnd);
        item.addEventListener('dragenter', handleDragEnter);
        item.addEventListener('dragleave', handleDragLeave);
    });
}

function iniciarModoReordenacaoDocs() {
    reorderingMode = true;
    ordensSessao = {};
    
    // Desabilitar o botão de reordenar
    const reorderDocsBtn = document.getElementById('reorderDocsBtn');
    if (reorderDocsBtn) {
        reorderDocsBtn.style.pointerEvents = 'none';
        reorderDocsBtn.style.opacity = '0.3';
        reorderDocsBtn.style.filter = 'grayscale(100%)';
    }
    const elementosParaDesabilitar = [
        '.btn-add-category',
        '.btn-add-doc', 
        '.btn-edit-category',
        '.btn-delete-category',
        '.btn-ai-assistant',
        '.btn-ai-summarize',
        '.btn-ai-translate',
        '.search-input',
        '.search-btn',
        '#reordenarBtn',
        '.category-item-edit',
        '.category-item-delete',
        '.nav-link',
        '#quickAddDocBtn',
        '#openAiBtn',
        '.navbar-title',
        '.logo-icon',
        '.sidebar-title',
        '.section-header h2'
    ];
    
    elementosParaDesabilitar.forEach(seletor => {
        const elementos = document.querySelectorAll(seletor);
        elementos.forEach(el => {
            // Não aplicar pointer-events: none nas documentações para permitir drag and drop
            if (!el.classList.contains('doc-card')) {
                el.classList.add('disabled-reorder');
                el.style.pointerEvents = 'none';
                el.style.opacity = '0.4';
                el.style.filter = 'grayscale(100%)';
            } else {
                // Para documentações, manter aparência normal para drag and drop
                el.classList.add('disabled-reorder');
                // Removido opacity e grayscale para manter visual normal
            }
        });
    });
    
    // Remover event listeners dos cards de documentação para não abrir leitura
    const docCards = document.querySelectorAll('.doc-card');
    docCards.forEach(card => {
        card.style.cursor = 'not-allowed';
        // Guardar os event listeners originais se necessário
        card._originalClickHandler = card.onclick;
        card.onclick = null;
        
        // Bloquear cliques para máxima segurança (mas permitir drag)
        const preventClicks = (e) => {
            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation();
            return false;
        };
        
        card.addEventListener('click', preventClicks, true);
        card.addEventListener('dblclick', preventClicks, true);
        card.addEventListener('contextmenu', preventClicks, true);
        
        // Guardar os event listeners de bloqueio para remover depois
        card._preventClickHandlers = [preventClicks, preventClicks, preventClicks];
    });
    
    const docsContainer = document.querySelector('.docs-container');
    const categoriesContainer = document.getElementById('categoriesList');
    
    if (docsContainer) {
        docsContainer.querySelectorAll('.doc-card').forEach((card) => {
            card.classList.add('reordering-mode');
            card.draggable = true;
            card.style.cursor = 'move';
            card.style.border = '2px solid #6366f1';
            card.style.backgroundColor = 'rgba(99, 102, 241, 0.15)';
        });

        docsContainer.querySelectorAll('.doc-card.reordering-mode').forEach(card => {
            card.removeEventListener('dragstart', handleDragStart);
            card.removeEventListener('dragover', handleDragOver);
            card.removeEventListener('drop', handleDropDocs);
            card.removeEventListener('dragend', handleDragEnd);
            card.removeEventListener('dragenter', handleDragEnter);
            card.removeEventListener('dragleave', handleDragLeave);
            
            card.addEventListener('dragstart', handleDragStart);
            card.addEventListener('dragover', handleDragOver);
            card.addEventListener('drop', handleDropDocs);
            card.addEventListener('dragend', handleDragEnd);
            card.addEventListener('dragenter', handleDragEnter);
            card.addEventListener('dragleave', handleDragLeave);
        });
    }
    
    if (categoriesContainer) {
        const allItems = categoriesContainer.querySelectorAll('.category-item');
        allItems.forEach((item, idx) => {
            item.classList.add('reordering-mode');
            item.style.border = '2px solid #6366f1';
            
            if (idx === 0) {
                item.style.backgroundColor = 'rgba(99, 102, 241, 0.15)';
                item.draggable = false;
                item.style.cursor = 'pointer'; // Permite clique para acessar
                // Remover opacity para permitir interação visual normal
            } else {
                item.style.backgroundColor = 'rgba(99, 102, 241, 0.15)';
                item.draggable = true;
                item.style.cursor = 'move';
                item.style.opacity = '1';
            }
        });

        const reorderableItems = categoriesContainer.querySelectorAll('.category-item.reordering-mode');
        reorderableItems.forEach((item, idx) => {
            if (idx === 0) return;
            
            item.removeEventListener('dragstart', handleDragStart);
            item.removeEventListener('dragover', handleDragOver);
            item.removeEventListener('drop', handleDrop);
            item.removeEventListener('dragend', handleDragEnd);
            item.removeEventListener('dragenter', handleDragEnter);
            item.removeEventListener('dragleave', handleDragLeave);
            
            item.addEventListener('dragstart', handleDragStart);
            item.addEventListener('dragover', handleDragOver);
            item.addEventListener('drop', handleDrop);
            item.addEventListener('dragend', handleDragEnd);
            item.addEventListener('dragenter', handleDragEnter);
            item.addEventListener('dragleave', handleDragLeave);
        });
    }
    
    const reorderActions = document.querySelector('.reorder-actions');
    if (reorderActions) {
        reorderActions.innerHTML = `
            <button class="btn-confirm-reorder" id="confirmReorderDocsBtn">✅ Confirmar</button>
            <button class="btn-cancel-reorder" id="cancelReorderDocsBtn">❌ Cancelar</button>
        `;
        reorderActions.classList.add('visible');

        document.getElementById('confirmReorderDocsBtn').addEventListener('click', confirmarReordenacaoDocs);
        document.getElementById('cancelReorderDocsBtn').addEventListener('click', cancelarReordenacaoDocs);
    }
}

function handleDragStart(e) {
    draggedElement = this;
    this.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
}

function handleDragOver(e) {
    if (e.preventDefault) {
        e.preventDefault();
    }
    e.dataTransfer.dropEffect = 'move';
    return false;
}

function handleDragEnter(e) {
    if (this !== draggedElement && this.classList.contains('reordering-mode')) {
        this.classList.add('drag-over');
    }
}

function handleDragLeave(e) {
    if (this.classList.contains('reordering-mode')) {
        this.classList.remove('drag-over');
    }
}

function handleDrop(e) {
    if (e.stopPropagation) {
        e.stopPropagation();
    }
    
    if (draggedElement !== this && this.classList.contains('category-item') && draggedElement.classList.contains('category-item')) {
        const container = document.getElementById('categoriesList');
        const items = Array.from(container.querySelectorAll('.category-item.reordering-mode'));
        const draggedIndex = items.indexOf(draggedElement);
        const targetIndex = items.indexOf(this);
        
        if (draggedIndex < targetIndex) {
            this.parentNode.insertBefore(draggedElement, this.nextSibling);
        } else {
            this.parentNode.insertBefore(draggedElement, this);
        }
    }
    
    this.classList.remove('drag-over');
    return false;
}

function handleDragEnd(e) {
    this.classList.remove('dragging');
    document.querySelectorAll('.category-item.drag-over, .doc-card.drag-over').forEach(item => {
        item.classList.remove('drag-over');
    });
}

function confirmarReordenacao() {
    const container = document.getElementById('categoriesList');
    const items = container.querySelectorAll('.category-item.reordering-mode');
    const novaOrdem = [];
    
    items.forEach(item => {
        const catId = parseInt(item.dataset.categoryId);
        const cat = categorias.find(c => c.id === catId);
        if (cat) novaOrdem.push(cat);
    });

    categorias = novaOrdem;

    cancelarReordenacao();

    salvarDados();
    renderizarCategorias();
    
    showToast('✅ Categorias reordenadas com sucesso!', 'success');
}

function cancelarReordenacao() {
    reorderingMode = false;
    reorderingDocsMode = false;

    document.querySelectorAll('.category-item.reordering-mode').forEach(item => {
        item.classList.remove('reordering-mode', 'dragging', 'drag-over');
        item.draggable = false;
        item.style.cursor = '';
        item.style.border = '';
        item.style.backgroundColor = '';
    });

    document.querySelectorAll('.category-item.reordering-mode').forEach(item => {
        item.removeEventListener('dragstart', handleDragStart);
        item.removeEventListener('dragover', handleDragOver);
        item.removeEventListener('drop', handleDrop);
        item.removeEventListener('dragend', handleDragEnd);
        item.removeEventListener('dragenter', handleDragEnter);
        item.removeEventListener('dragleave', handleDragLeave);
    });

    const reorderActions = document.querySelector('.reorder-actions');
    if (reorderActions) {
        reorderActions.classList.remove('visible');
    }
    
    const editReorderActions = document.getElementById('editReorderActions');
    if (editReorderActions) {
        editReorderActions.classList.remove('visible');
    }

    bloquearInterfaceReordenacao(false);

    renderizarCategorias();
}

function confirmarReordenacaoDocs() {
    // Salvar ordens da sessão
    for (const [catId, idsOrdem] of Object.entries(ordensSessao)) {
        salvarOrdemCategoria(catId, idsOrdem);
    }
    
    // Salvar nova ordem das categorias
    const categoriesContainer = document.getElementById('categoriesList');
    const categoryItems = categoriesContainer.querySelectorAll('.category-item.reordering-mode');
    const novaOrdemCategorias = [];
    
    categoryItems.forEach(item => {
        const catId = parseInt(item.dataset.categoryId);
        const cat = categorias.find(c => c.id === catId);
        if (cat) novaOrdemCategorias.push(cat);
    });

    // Reordenar categorias
    categorias = novaOrdemCategorias;

    // Cancelar ambos os modos de reordenação
    cancelarReordenacao();
    cancelarReordenacaoDocs();

    // Salvar e renderizar
    salvarDados();
    renderizarCategorias();
    filtrarPorCategoria(currentSelectedCategory);
    
    showToast('✅ Documentações e categorias reordenadas com sucesso!', 'success');
}

function cancelarReordenacaoDocs() {
    reorderingMode = false;
    reorderingDocsMode = false;

    document.querySelectorAll('.doc-card.reordering-mode').forEach(card => {
        card.classList.remove('reordering-mode', 'dragging', 'drag-over');
        card.draggable = false;
        card.style.cursor = '';
        card.style.border = '';
        card.style.backgroundColor = '';
    });

    document.querySelectorAll('.doc-card.reordering-mode').forEach(card => {
        card.removeEventListener('dragstart', handleDragStart);
        card.removeEventListener('dragover', handleDragOver);
        card.removeEventListener('drop', handleDropDocs);
        card.removeEventListener('dragend', handleDragEnd);
        card.removeEventListener('dragenter', handleDragEnter);
        card.removeEventListener('dragleave', handleDragLeave);
    });

    cancelarReordenacao();

    bloquearInterfaceReordenacaoDocs(false);

    // Reabilitar o botão de reordenar
    const reorderDocsBtn = document.getElementById('reorderDocsBtn');
    if (reorderDocsBtn) {
        reorderDocsBtn.style.pointerEvents = '';
        reorderDocsBtn.style.opacity = '';
        reorderDocsBtn.style.filter = '';
    }

    filtrarPorCategoria(currentSelectedCategory);
}

function getOrdemCategoria(catId) {
    const key = 'ordem_categoria_' + catId;
    const ordem = localStorage.getItem(key);
    return ordem ? JSON.parse(ordem) : null;
}

function salvarOrdemCategoria(catId, idsOrdem) {
    const key = 'ordem_categoria_' + catId;
    localStorage.setItem(key, JSON.stringify(idsOrdem));
}

function cancelarReordenacaoCompleta() {
    reorderingMode = false;

    // Reabilitar TODOS os controles da interface
    const elementosParaReabilitar = [
        '.btn-add-category',
        '.btn-add-doc',
        '.btn-edit-category', 
        '.btn-delete-category',
        '.btn-ai-assistant',
        '.btn-ai-summarize',
        '.btn-ai-translate',
        '.search-input',
        '.search-btn',
        '#reordenarBtn',
        '.category-item-edit',
        '.category-item-delete',
        '.nav-link',
        '#quickAddDocBtn',
        '#openAiBtn',
        '.navbar-title',
        '.logo-icon',
        '.sidebar-title',
        '.section-header h2'
    ];
    
    elementosParaReabilitar.forEach(seletor => {
        const elementos = document.querySelectorAll(seletor);
        elementos.forEach(el => {
            el.classList.remove('disabled-reorder');
            el.style.pointerEvents = '';
            el.style.opacity = '';
            el.style.filter = '';
        });
    });
    
    // Restaurar event listeners dos cards de documentação
    const docCards = document.querySelectorAll('.doc-card');
    docCards.forEach(card => {
        card.style.cursor = '';
        if (card._originalClickHandler) {
            card.onclick = card._originalClickHandler;
            delete card._originalClickHandler;
        }
        
        // Remover os event listeners de bloqueio
        if (card._preventClickHandlers) {
            const [clickHandler, dblclickHandler, contextHandler] = card._preventClickHandlers;
            card.removeEventListener('click', clickHandler, true);
            card.removeEventListener('dblclick', dblclickHandler, true);
            card.removeEventListener('contextmenu', contextHandler, true);
            delete card._preventClickHandlers;
        }
    });

    document.querySelectorAll('.doc-card.reordering-mode').forEach(card => {
        card.classList.remove('reordering-mode', 'dragging', 'drag-over');
        card.draggable = false;
        card.style.cursor = '';
        card.style.border = '';
        card.style.backgroundColor = '';
        
        card.removeEventListener('dragstart', handleDragStart);
        card.removeEventListener('dragover', handleDragOver);
        card.removeEventListener('drop', handleDropDocs);
        card.removeEventListener('dragend', handleDragEnd);
        card.removeEventListener('dragenter', handleDragEnter);
        card.removeEventListener('dragleave', handleDragLeave);
    });

    document.querySelectorAll('.category-item.reordering-mode').forEach((item, idx) => {
        item.classList.remove('reordering-mode', 'dragging', 'drag-over');
        if (idx > 0) {
            item.draggable = false;
        }
        item.style.cursor = '';
        item.style.border = '';
        item.style.backgroundColor = '';
        
        item.removeEventListener('dragstart', handleDragStart);
        item.removeEventListener('dragover', handleDragOver);
        item.removeEventListener('drop', handleDrop);
        item.removeEventListener('dragend', handleDragEnd);
        item.removeEventListener('dragenter', handleDragEnter);
        item.removeEventListener('dragleave', handleDragLeave);
    });

    const reorderActions = document.querySelector('.reorder-actions');
    if (reorderActions) {
        reorderActions.classList.remove('visible');
        reorderActions.innerHTML = '';
    }
}

function handleDropDocs(e) {
    if (e.stopPropagation) {
        e.stopPropagation();
    }
    
    if (draggedElement !== this && this.classList.contains('doc-card') && draggedElement.classList.contains('doc-card')) {
        const container = document.querySelector('.docs-container');
        const cards = Array.from(container.querySelectorAll('.doc-card.reordering-mode'));
        const draggedIndex = cards.indexOf(draggedElement);
        const targetIndex = cards.indexOf(this);
        
        if (draggedIndex > -1 && targetIndex > -1) {

            if (draggedIndex < targetIndex) {
                this.parentNode.insertBefore(draggedElement, this.nextSibling);
            } else {
                this.parentNode.insertBefore(draggedElement, this);
            }
            
            // Atualizar ordem da sessão
            const docsContainer = document.querySelector('.docs-container');
            const docCards = Array.from(docsContainer.querySelectorAll('.doc-card.reordering-mode'));
            const idsOrdem = docCards.map(card => parseInt(card.dataset.docId));
            ordensSessao[currentSelectedCategory] = idsOrdem;
        }
    }
    
    return false;
}

function bloquearInterfaceReordenacaoDocs(bloquear) {
    if (bloquear) {

        document.querySelectorAll('.nav-link').forEach(link => {
            link.style.pointerEvents = 'none';
            link.style.opacity = '0.3';
            link.style.filter = 'grayscale(100%)';
        });

        document.querySelectorAll('.btn-primary, .btn-secondary').forEach(btn => {
            if (!btn.id.includes('reorder') && !btn.classList.contains('btn-confirm-reorder') && !btn.classList.contains('btn-cancel-reorder')) {
                btn.style.pointerEvents = 'none';
                btn.style.opacity = '0.3';
                btn.style.filter = 'grayscale(100%)';
            }
        });

        const elementosEspecificos = [
            '.search-btn', '#reorderDocsBtn', '.view-btn'
        ];
        
        elementosEspecificos.forEach(seletor => {
            document.querySelectorAll(seletor).forEach(elemento => {
                elemento.style.pointerEvents = 'none';
                elemento.style.opacity = '0.3';
                elemento.style.filter = 'grayscale(100%)';
            });
        });

        const botoesCategoriaCRUD = [
            '#addCategoryBtn',
            '.category-item-edit',
            '.category-item-delete'
        ];
        
        botoesCategoriaCRUD.forEach(seletor => {
            document.querySelectorAll(seletor).forEach(elemento => {
                elemento.style.pointerEvents = 'none';
                elemento.style.opacity = '0.3';
                elemento.style.filter = 'grayscale(100%)';
            });
        });

        document.querySelectorAll('.doc-card:not(.reordering-mode)').forEach(card => {
            card.style.pointerEvents = 'none';
            card.style.opacity = '0.5';
            card.style.filter = 'grayscale(100%)';
        });

        document.querySelectorAll('input, textarea, select').forEach(input => {
            input.style.pointerEvents = 'none';
            input.style.opacity = '0.5';
        });

        overlay.style.display = 'flex';
        
    } else {

        document.querySelectorAll('.nav-link').forEach(link => {
            link.style.pointerEvents = '';
            link.style.opacity = '';
            link.style.filter = '';
        });

        document.querySelectorAll('.btn-primary, .btn-secondary').forEach(btn => {
            btn.style.pointerEvents = '';
            btn.style.opacity = '';
            btn.style.filter = '';
        });

        const elementosEspecificos = [
            '.search-btn', '#reorderDocsBtn', '.view-btn'
        ];
        
        elementosEspecificos.forEach(seletor => {
            document.querySelectorAll(seletor).forEach(elemento => {
                elemento.style.pointerEvents = '';
                elemento.style.opacity = '';
                elemento.style.filter = '';
            });
        });

        const botoesCategoriaCRUD = [
            '#addCategoryBtn',
            '.category-item-edit',
            '.category-item-delete'
        ];
        
        botoesCategoriaCRUD.forEach(seletor => {
            document.querySelectorAll(seletor).forEach(elemento => {
                elemento.style.pointerEvents = '';
                elemento.style.opacity = '';
                elemento.style.filter = '';
            });
        });

        document.querySelectorAll('.doc-card').forEach(card => {
            card.style.pointerEvents = '';
            card.style.opacity = '';
            card.style.filter = '';
        });

        document.querySelectorAll('input, textarea, select').forEach(input => {
            input.style.pointerEvents = '';
            input.style.opacity = '';
        });

        // Reabilitar títulos
        document.querySelectorAll('.sidebar-title, .navbar-title, .logo-icon').forEach(el => {
            el.style.pointerEvents = '';
            el.style.opacity = '';
            el.style.filter = '';
        });
    }
}

function handleDropSettings(e) {
    if (e.stopPropagation) {
        e.stopPropagation();
    }

    if (draggedElement !== this) {
        const container = document.getElementById('categoriesSettings');
        const items = Array.from(container.querySelectorAll('.category-setting-item.reordering-mode'));
        const draggedIndex = items.indexOf(draggedElement);
        const targetIndex = items.indexOf(this);

        if (draggedIndex < targetIndex) {
            this.parentNode.insertBefore(draggedElement, this.nextSibling);
        } else {
            this.parentNode.insertBefore(draggedElement, this);
        }
    }

    this.classList.remove('drag-over');
    return false;
}

    function confirmarReordenacaoSettings() {
        const container = document.getElementById('categoriesSettings');
        const items = container.querySelectorAll('.category-setting-item.reordering-mode');
        const novaOrdem = [];
    
        items.forEach(item => {
            const catId = parseInt(item.dataset.catId);
            const cat = categorias.find(c => c.id === catId);
            if (cat) novaOrdem.push(cat);
        });

        categorias = novaOrdem;

        cancelarReordenacaoSettings();

        salvarDados();
        renderizarCategorias();
    
        showToast('✅ Categorias reordenadas com sucesso!', 'success');
    }

    function cancelarReordenacaoSettings() {
        reorderingMode = false;
        const container = document.getElementById('categoriesSettings');

        container.querySelectorAll('.category-setting-item.reordering-mode').forEach(item => {
            item.classList.remove('reordering-mode', 'dragging', 'drag-over');
            item.draggable = false;
        });

        container.querySelectorAll('.setting-actions').forEach(actions => {
            actions.style.display = '';
        });

        container.querySelectorAll('.category-setting-item.reordering-mode').forEach(item => {
            item.removeEventListener('dragstart', handleDragStart);
            item.removeEventListener('dragover', handleDragOver);
            item.removeEventListener('drop', handleDropSettings);
            item.removeEventListener('dragend', handleDragEnd);
            item.removeEventListener('dragenter', handleDragEnter);
            item.removeEventListener('dragleave', handleDragLeave);
        });

        const reorderActions = document.getElementById('reorderActionsSettings');
        if (reorderActions) {
            reorderActions.classList.remove('visible');
        }

        renderizarCategorias();
}

document.addEventListener('DOMContentLoaded', () => {
    const toggleBtn = document.getElementById('toggleIconPaletteBtn');
    const popover = document.getElementById('iconPopover');

    function closePopover() {
        if (popover) popover.style.display = 'none';
    }

    if (toggleBtn && popover) {
        toggleBtn.addEventListener('click', (e) => {
            e.preventDefault();

            const rect = toggleBtn.getBoundingClientRect();
            const bodyRect = document.body.getBoundingClientRect();

            const left = rect.left + window.scrollX;
            let top = rect.top + window.scrollY - 10; // tentar posicionar acima

            popover.style.display = 'block';
            popover.style.opacity = '0';

            const popRect = popover.getBoundingClientRect();
            let calcLeft = left;
            if (calcLeft + popRect.width > window.innerWidth - 8) calcLeft = window.innerWidth - popRect.width - 12;
            let calcTop = top - popRect.height;
            if (calcTop < 8) {

                calcTop = rect.bottom + window.scrollY + 8;
            }

            popover.style.left = `${calcLeft}px`;
            popover.style.top = `${calcTop}px`;
            popover.style.opacity = '1';
        });

        popover.addEventListener('click', (ev) => {
            const btn = ev.target.closest('.icon-choice');
            if (!btn) return;
            const val = btn.dataset.value || btn.textContent.trim();
            const input = document.getElementById('categoryIcon');
            if (input) input.value = val;

            closePopover();
        });

        document.addEventListener('click', (ev) => {
            const outside = !ev.target.closest('#iconPopover') && !ev.target.closest('#toggleIconPaletteBtn');
            if (outside) closePopover();
        });
    }
});

function showToast(message, type = 'success', duration = 3000) {
    const container = document.getElementById('toastContainer');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = 'toast';
    
    const msgEl = document.createElement('p');
    msgEl.className = 'toast-message';
    msgEl.textContent = message;
    
    const progressBar = document.createElement('div');
    progressBar.className = 'toast-progress-bar';
    
    toast.appendChild(msgEl);
    toast.appendChild(progressBar);
    container.appendChild(toast);

    setTimeout(() => {
        toast.classList.add('fade-out');
        setTimeout(() => toast.remove(), 350);
    }, duration);
}

function fecharModalsEventos() {

    const docModal = document.getElementById('docModal');
    const closeTopBtns = document.querySelectorAll('.close-modal-top');
    const editBtn = document.getElementById('editDocBtn');

    if (closeTopBtns && closeTopBtns.length > 0) {
        closeTopBtns.forEach(cb => cb.addEventListener('click', () => {
            setModalVisible('docModal', false);
        }));
    }
    if (editBtn) editBtn.addEventListener('click', abrirEdicao);

    if (docModal) {
        window.addEventListener('click', (e) => {
            if (e.target === docModal) setModalVisible('docModal', false);
        });
    }

    document.querySelectorAll('#modalVersionToggle .version-btn').forEach(btn => {
        btn.addEventListener('click', () => {

            const doc = documentacoes.find(d => d.id == currentEditingId);
            if (!doc) return;

            const version = btn.dataset.version;
            currentViewVersion = version;

            document.querySelectorAll('#modalVersionToggle .version-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');

                let content = version === 'normal' ? (doc.conteudo || '') : (doc.conteudoPasso || '');
                if (!content || content.trim() === '') {
                    const label = version === 'normal' ? 'normal' : 'passo a passo';
                    document.getElementById('modalContent').innerHTML = `<p style="opacity:0.8">⚠️ Nenhuma versão ${label} disponível.</p>`;
                } else {
                    document.getElementById('modalContent').innerHTML = content;
                }
        });
    });

    const editModal = document.getElementById('editModal');
    const closeEditBtn = document.querySelector('.close-edit');

    document.querySelectorAll('.close-edit').forEach(btn => btn.addEventListener('click', () => {
        const editModalContent = document.querySelector('#editModal .modal-content');
        if (editModalContent.classList.contains('modal-fullscreen')) {
            // Se está em tela grande, volta ao modo normal de edição
            editModalContent.classList.remove('modal-fullscreen');
            const fullscreenBtn = document.getElementById('fullscreenEditToolbarBtn');
            if (fullscreenBtn) {
                fullscreenBtn.style.display = 'inline-block';
            }
            const fullscreenBtnPasso = document.getElementById('fullscreenEditToolbarBtnPasso');
            if (fullscreenBtnPasso) {
                fullscreenBtnPasso.style.display = 'inline-block';
            }
            const fullscreenAddBtn = document.getElementById('fullscreenAddToolbarBtn');
            if (fullscreenAddBtn) {
                fullscreenAddBtn.style.display = 'inline-block';
            }
            const fullscreenAddBtnPasso = document.getElementById('fullscreenAddToolbarBtnPasso');
            if (fullscreenAddBtnPasso) {
                fullscreenAddBtnPasso.style.display = 'inline-block';
            }
            const fullscreenBackBtn = document.getElementById('fullscreenBackBtn');
            if (fullscreenBackBtn) {
                fullscreenBackBtn.style.display = 'none';
            }
            const fullscreenBackBtnPasso = document.getElementById('fullscreenBackBtnPasso');
            if (fullscreenBackBtnPasso) {
                fullscreenBackBtnPasso.style.display = 'none';
            }
            toggleAddFieldsVisibility(false);
        } else {
            // Se não está em tela grande, volta à leitura
            setModalVisible('editModal', false);
            setModalVisible('docModal', true);

            // Sempre voltar para modo normal (não tela cheia)
            const docModalContent = document.querySelector('#docModal .modal-content');
            docModalContent.classList.remove('modal-fullscreen');
            currentDocFullscreen = false;

            if (reorderingMode) {
                cancelarReordenacao();
                cancelarReordenacaoDocs();
            }
        }
    }));

    const deleteEditBtn = document.querySelector('.delete-during-edit');
    if (deleteEditBtn) {
        deleteEditBtn.addEventListener('click', () => {
            if (confirm('⚠️ ATENÇÃO: Deletar esta documentação? Esta ação não pode ser desfeita!')) {
                deletarDocumento();
            }
        });
    }

    if (editModal) {
        const fullscreenEditBtn = document.getElementById('fullscreenEditToolbarBtn');
        const fullscreenEditBtnPasso = document.getElementById('fullscreenEditToolbarBtnPasso');
        const editModalContent = editModal.querySelector('.modal-content');
        if (fullscreenEditBtn && editModalContent) {
            fullscreenEditBtn.addEventListener('click', () => {
                editModalContent.classList.toggle('modal-fullscreen');
                if (editModalContent.classList.contains('modal-fullscreen')) {
                    fullscreenEditBtn.style.display = 'none';
                } else {
                    fullscreenEditBtn.style.display = 'inline-block';
                }
                const editor = currentEditVersion === 'normal' ? document.getElementById('editDocContent') : document.getElementById('editDocPassoContent');
                normalizeEditorAfterFullscreen(editor);
            });
        }
        if (fullscreenEditBtnPasso && editModalContent) {
            fullscreenEditBtnPasso.addEventListener('click', () => {
                editModalContent.classList.toggle('modal-fullscreen');
                fullscreenEditBtnPasso.style.display = 'none';
                const editor = document.getElementById('editDocPassoContent');
                normalizeEditorAfterFullscreen(editor);
            });
        }
    }

    // Botões de tela grande para adicionar
    const fullscreenAddBtn = document.getElementById('fullscreenAddToolbarBtn');
    const fullscreenAddBtnPasso = document.getElementById('fullscreenAddToolbarBtnPasso');
    const fullscreenBackBtn = document.getElementById('fullscreenBackBtn');
    const fullscreenBackBtnPasso = document.getElementById('fullscreenBackBtnPasso');
    const docTypeSelect = document.getElementById('docType');
    if (fullscreenAddBtn) {
        fullscreenAddBtn.addEventListener('click', () => {
            document.body.classList.toggle('fullscreen-add');
            const isFullscreen = document.body.classList.contains('fullscreen-add');
            toggleAddFieldsVisibility(isFullscreen);
            fullscreenAddBtn.style.display = isFullscreen ? 'none' : 'inline-block';
            const isPasso = docTypeSelect && docTypeSelect.value === 'passo-a-passo';
            if (isPasso) {
                if (fullscreenBackBtnPasso) fullscreenBackBtnPasso.style.display = isFullscreen ? 'block' : 'none';
            } else {
                if (fullscreenBackBtn) fullscreenBackBtn.style.display = isFullscreen ? 'block' : 'none';
            }
            const editor = document.getElementById(isPasso ? 'docPassoContent' : 'docContent');
            normalizeEditorAfterFullscreen(editor);
        });
    }
    if (fullscreenAddBtnPasso) {
        fullscreenAddBtnPasso.addEventListener('click', () => {
            document.body.classList.toggle('fullscreen-add');
            const isFullscreen = document.body.classList.contains('fullscreen-add');
            toggleAddFieldsVisibility(isFullscreen);
            fullscreenAddBtnPasso.style.display = isFullscreen ? 'none' : 'inline-block';
            if (fullscreenBackBtnPasso) fullscreenBackBtnPasso.style.display = isFullscreen ? 'block' : 'none';
            const editor = document.getElementById('docPassoContent');
            normalizeEditorAfterFullscreen(editor);
        });
    }
    if (fullscreenBackBtn) {
        fullscreenBackBtn.addEventListener('click', () => {
            document.body.classList.remove('fullscreen-add');
            toggleAddFieldsVisibility(false);
            fullscreenAddBtn.style.display = 'inline-block';
            fullscreenBackBtn.style.display = 'none';
            if (fullscreenBackBtnPasso) fullscreenBackBtnPasso.style.display = 'none';
        });
    }
    if (fullscreenBackBtnPasso) {
        fullscreenBackBtnPasso.addEventListener('click', () => {
            document.body.classList.remove('fullscreen-add');
            toggleAddFieldsVisibility(false);
            fullscreenAddBtnPasso.style.display = 'inline-block';
            fullscreenBackBtnPasso.style.display = 'none';
            if (fullscreenBackBtn) fullscreenBackBtn.style.display = 'none';
        });
    }

function toggleAddFieldsVisibility(isFullscreen) {
    const titleField = document.querySelector('#adicionar .form-row');
    const descriptionField = document.getElementById('docDescription')?.closest('.form-group');
    const categoryField = document.getElementById('docCategory')?.closest('.form-group');
    const typeField = document.getElementById('docTypeGroup');
    const tagsField = document.getElementById('docTags')?.closest('.form-group');
    const actionsField = document.querySelector('#adicionar .form-actions');

    if (titleField) titleField.style.display = isFullscreen ? 'none' : '';
    if (descriptionField) descriptionField.style.display = isFullscreen ? 'none' : 'block';
    if (categoryField) categoryField.style.display = isFullscreen ? 'none' : 'block';
    if (typeField) typeField.style.display = isFullscreen ? 'none' : 'block';
    if (tagsField) tagsField.style.display = isFullscreen ? 'none' : 'block';
    if (actionsField) actionsField.style.display = isFullscreen ? 'none' : 'flex';
}
// Expor globalmente para evitar ReferenceError em handlers que chamam a função
try { window.toggleAddFieldsVisibility = toggleAddFieldsVisibility; } catch (e) {}

    document.querySelectorAll('.edit-version-toggle .version-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            const version = btn.dataset.editVersion;
            currentEditVersion = version;

            document.querySelectorAll('.edit-version-toggle .version-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');

            if (version === 'normal') {
                document.getElementById('normalContentGroup').style.display = 'block';
                document.getElementById('passoContentGroup').style.display = 'none';
                document.getElementById('editContentType').textContent = 'Conteúdo Normal';
                const passoBtn = document.getElementById('fullscreenEditToolbarBtnPasso');
                if (passoBtn) passoBtn.style.display = 'none';
            } else {
                document.getElementById('normalContentGroup').style.display = 'none';
                document.getElementById('passoContentGroup').style.display = 'block';
                document.getElementById('editContentType').textContent = 'Conteúdo Passo a Passo';
                const passoBtn = document.getElementById('fullscreenEditToolbarBtnPasso');
                if (passoBtn) passoBtn.style.display = 'inline-block';
            }
        });
    });

    const exemploModal = document.getElementById('exemploModal');
    const closeExemploBtn = document.querySelector('.close-exemplo');
    document.querySelectorAll('.close-exemplo').forEach(btn => btn.addEventListener('click', () => setModalVisible('exemploModal', false)));
    if (exemploModal) {
        window.addEventListener('click', (e) => {
            if (e.target === exemploModal) setModalVisible('exemploModal', false);
        });
    }

    const categoryModal = document.getElementById('categoryModal');
    const closeCategoryBtn = document.querySelector('.close-category');
    document.querySelectorAll('.close-category').forEach(btn => btn.addEventListener('click', () => setModalVisible('categoryModal', false)));
    if (categoryModal) {
        window.addEventListener('click', (e) => {
            if (e.target === categoryModal) setModalVisible('categoryModal', false);
        });
    }
}

function inicializarRichEditor() {

    const allButtons = document.querySelectorAll('.editor-btn');

    function isSelectionInsideHeading(editorDiv) {
        try {
            const sel = window.getSelection();
            if (!sel || sel.rangeCount === 0) return false;
            let node = sel.getRangeAt(0).commonAncestorContainer;
            if (!node) return false;
            if (node.nodeType === Node.TEXT_NODE) node = node.parentElement;
            while (node && node !== editorDiv) {
                if (!node.tagName) { node = node.parentElement; continue; }
                const tag = node.tagName.toLowerCase();
                if (tag === 'h2' || tag === 'h3') return true;
                if (tag === 'span') {
                    try {
                        const fs = window.getComputedStyle(node).fontSize || '';
                        if (fs === '24px' || fs === '20px') return true;
                    } catch (e) {}
                }
                node = node.parentElement;
            }
        } catch (e) {}
        return false;
    }

    function ensureParagraphCaret(editorDiv) {
        try {
            const sel = window.getSelection();
            if (!sel) return;
            let range = sel.rangeCount > 0 ? sel.getRangeAt(0) : null;
            if (!range) {
                range = document.createRange();
                range.setStart(editorDiv, editorDiv.childNodes.length);
                range.collapse(true);
            }

            let node = range.commonAncestorContainer;
            if (node && node.nodeType === Node.TEXT_NODE) node = node.parentElement;

            // If inside a styled inline (span with font-size != 16px or b/strong/i/u), move caret after it
            let styledAncestor = node;
            while (styledAncestor && styledAncestor !== editorDiv) {
                if (styledAncestor.tagName) {
                    const tag = styledAncestor.tagName.toLowerCase();
                    if (['b', 'strong', 'i', 'em', 'u'].includes(tag)) break;
                    if (tag === 'span') {
                        try {
                            const fs = window.getComputedStyle(styledAncestor).fontSize || '';
                            if (fs && fs !== '16px') break;
                        } catch (e) {}
                    }
                }
                styledAncestor = styledAncestor.parentElement;
            }

            if (styledAncestor && styledAncestor !== editorDiv) {
                const afterRange = document.createRange();
                try {
                    afterRange.setStartAfter(styledAncestor);
                } catch (e) {
                    afterRange.setStart(editorDiv, editorDiv.childNodes.length);
                }
                afterRange.collapse(true);
                sel.removeAllRanges();
                sel.addRange(afterRange);
            }

            if (editorDiv && editorDiv.dataset) editorDiv.dataset.stickyFormat = '';
        } catch (e) {}
    }
    
    allButtons.forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            
            const command = btn.dataset.command;
            const value = btn.dataset.value;

            const toolbar = btn.closest('.editor-toolbar');
            const editorDiv = toolbar?.nextElementSibling;
            
            if (!editorDiv || !editorDiv.classList.contains('rich-editor')) {
                return;
            }

            editorDiv.focus();
            
            if (command === 'createLink') {
                const url = prompt('Digite a URL:');
                if (url) {
                    document.execCommand('createLink', false, url);
                }
            } else if (['bold', 'italic', 'underline'].includes(command)) {
                const sel = window.getSelection();
                const hasSelection = sel && sel.rangeCount > 0 && !sel.isCollapsed;
                const isActive = document.queryCommandState(command);

                // Prevent bold inside headings
                if (command === 'bold' && isSelectionInsideHeading(editorDiv)) {
                    return;
                }

                if (hasSelection) {
                    // Apply to selection (one-shot)
                    document.execCommand(command, false, null);
                    if (editorDiv && editorDiv.dataset) editorDiv.dataset.stickyFormat = '';
                } else {
                    // Caret-only: toggle typing state
                    if (isActive) {
                        // turning off -> ensure paragraph caret
                        document.execCommand(command, false, null);
                        ensureParagraphCaret(editorDiv);
                    } else {
                        // turning on -> leave command active for typing (set sticky)
                        document.execCommand(command, false, null);
                        if (editorDiv && editorDiv.dataset) editorDiv.dataset.stickyFormat = command;
                    }
                }

                updateToolbarButtons(toolbar, editorDiv);
                return;
            } else if (command === 'formatBlock') {
                // If there's a selection, apply inline styles (span) so headings can be mixed
                try {
                    const sel = window.getSelection();
                    const hasSelection = sel && sel.rangeCount > 0 && !sel.isCollapsed;

                    if (hasSelection) {
                        const range = sel.getRangeAt(0);

                        // Create span to wrap selection with inline styles

                        const span = document.createElement('span');
                        // use absolute px sizes to avoid multiplicative nesting
                        if (value === 'h2') {
                            span.style.fontSize = '24px';
                            span.style.fontWeight = '700';
                            span.style.lineHeight = '1.2';
                        } else if (value === 'h3') {
                            span.style.fontSize = '20px';
                            span.style.fontWeight = '600';
                            span.style.lineHeight = '1.25';
                        } else if (value === 'p') {
                            span.style.fontSize = '16px';
                            span.style.fontWeight = '400';
                            span.style.lineHeight = '1.6';
                        }

                        // Extract contents, sanitize inner font-size styles and insert span
                        const extracted = range.extractContents();
                        extracted.querySelectorAll && extracted.querySelectorAll('*').forEach(el => {
                            if (el.style) el.style.fontSize = '';
                        });
                        span.appendChild(extracted);
                        range.insertNode(span);

                        // Normalize selection to the new span (selection case: do NOT set sticky)
                        sel.removeAllRanges();
                        const newRange = document.createRange();
                        newRange.selectNodeContents(span);
                        sel.addRange(newRange);

                        // Ensure no sticky format is set when user formatted a selection
                        if (editorDiv && editorDiv.dataset) editorDiv.dataset.stickyFormat = '';

                        updateToolbarButtons(toolbar, editorDiv);
                    } else {
                        // No selection: deterministically insert a styled span at caret and set stickyFormat
                        try {
                            const sel2 = window.getSelection();
                            let range2 = sel2 && sel2.rangeCount > 0 ? sel2.getRangeAt(0) : null;
                            if (!range2) {
                                editorDiv.focus();
                                range2 = document.createRange();
                                range2.setStart(editorDiv, editorDiv.childNodes.length);
                                range2.collapse(true);
                            }

                            if (!range2.collapsed) {
                                range2.collapse(false);
                            }

                            let ancestor = range2.commonAncestorContainer;
                            if (ancestor && ancestor.nodeType === Node.TEXT_NODE) ancestor = ancestor.parentElement;

                            // If caret is already inside a span with the same heading style, toggle it off
                            const isSameHeadingSpan = (el) => {
                                if (!el || el.tagName !== 'SPAN') return false;
                                try {
                                    const fs = window.getComputedStyle(el).fontSize || '';
                                    if (value === 'h2') return fs === '24px';
                                    if (value === 'h3') return fs === '20px';
                                    if (value === 'p') return fs === '16px';
                                } catch (e) {}
                                return false;
                            };

                            if (isSameHeadingSpan(ancestor)) {
                                // Toggle off: move caret after the existing heading span WITHOUT changing its content
                                try {
                                    const parent = ancestor.parentNode;
                                    const placeholderSpan = document.createElement('span');
                                    placeholderSpan.dataset.placeholder = '1';
                                    // neutral paragraph style
                                    placeholderSpan.style.fontSize = '16px';
                                    placeholderSpan.style.fontWeight = '400';
                                    placeholderSpan.style.lineHeight = '1.6';
                                    const zwNode = document.createTextNode('\u200B');
                                    placeholderSpan.appendChild(zwNode);
                                    if (ancestor.nextSibling) parent.insertBefore(placeholderSpan, ancestor.nextSibling);
                                    else parent.appendChild(placeholderSpan);

                                    const newRange = document.createRange();
                                    newRange.setStart(zwNode, 1);
                                    newRange.collapse(true);
                                    sel2.removeAllRanges();
                                    sel2.addRange(newRange);

                                    // mark placeholder to be cleaned on next input
                                    if (editorDiv && editorDiv.dataset) editorDiv.dataset.tempZw = '1';
                                } catch (e) {
                                    try {
                                        const afterRange = document.createRange();
                                        afterRange.setStartAfter(ancestor);
                                        afterRange.collapse(true);
                                        sel2.removeAllRanges();
                                        sel2.addRange(afterRange);
                                    } catch (ee) {
                                        // fallback: place caret at end of editor
                                        const afterRange = document.createRange();
                                        afterRange.setStart(editorDiv, editorDiv.childNodes.length);
                                        afterRange.collapse(true);
                                        sel2.removeAllRanges();
                                        sel2.addRange(afterRange);
                                    }
                                }

                                // Clear sticky format when toggling off
                                if (editorDiv && editorDiv.dataset) editorDiv.dataset.stickyFormat = '';
                            } else {
                                // ensure caret is not inside a different heading span: if so, move caret after it
                                let headingAncestor = ancestor;
                                while (headingAncestor && headingAncestor !== editorDiv) {
                                    if (headingAncestor.tagName && headingAncestor.tagName.toLowerCase() === 'span') {
                                        try {
                                            const fs = window.getComputedStyle(headingAncestor).fontSize || '';
                                            if (fs === '24px' || fs === '20px') {
                                                const afterRange = document.createRange();
                                                afterRange.setStartAfter(headingAncestor);
                                                afterRange.collapse(true);
                                                sel2.removeAllRanges();
                                                sel2.addRange(afterRange);
                                                break;
                                            }
                                        } catch (e) {}
                                    }
                                    headingAncestor = headingAncestor.parentElement;
                                }

                                // Create new styled span and insert at caret
                                const spanNew = document.createElement('span');
                                if (value === 'h2') {
                                    spanNew.style.fontSize = '24px';
                                    spanNew.style.fontWeight = '700';
                                    spanNew.style.lineHeight = '1.2';
                                } else if (value === 'h3') {
                                    spanNew.style.fontSize = '20px';
                                    spanNew.style.fontWeight = '600';
                                    spanNew.style.lineHeight = '1.25';
                                } else if (value === 'p') {
                                    spanNew.style.fontSize = '16px';
                                    spanNew.style.fontWeight = '400';
                                    spanNew.style.lineHeight = '1.6';
                                }

                                const zw = document.createTextNode('\u200B');
                                spanNew.appendChild(zw);

                                range2.insertNode(spanNew);

                                // Place caret after zero-width char inside span
                                const newRange = document.createRange();
                                newRange.setStart(zw, 1);
                                newRange.collapse(true);
                                sel2.removeAllRanges();
                                sel2.addRange(newRange);
                                editorDiv.focus();

                                if (editorDiv && editorDiv.dataset) editorDiv.dataset.stickyFormat = value || '';
                            }
                        } catch (err) {
                            console.error('formatBlock caret inline error', err);
                        }

                        updateToolbarButtons(toolbar, editorDiv);
                    }
                } catch (err) {
                    console.error('formatBlock inline error', err);
                }
            } else if (command === 'removeFormat') {
                document.execCommand('removeFormat', false, null);
            } else {

                const selection = window.getSelection();
                const hasSelection = selection.rangeCount > 0 && !selection.isCollapsed;
                
                if (hasSelection) {

                    document.execCommand(command, false, null);

                } else {

                    document.execCommand(command, false, null);
                    updateToolbarButtons(toolbar, editorDiv);
                }
            }

            updateToolbarButtons(toolbar, editorDiv);
        });
    });

    document.querySelectorAll('.rich-editor').forEach(editor => {
        const toolbar = editor.previousElementSibling;
        if (toolbar && toolbar.classList.contains('editor-toolbar')) {
            editor.addEventListener('input', () => {
                updateToolbarButtons(toolbar, editor);
                hasUnsavedChanges = true;
            });
            editor.addEventListener('keyup', () => updateToolbarButtons(toolbar, editor));
            editor.addEventListener('mouseup', () => updateToolbarButtons(toolbar, editor));
            editor.addEventListener('focus', () => { updateToolbarButtons(toolbar, editor); lastFocusedEditorId = editor.id; });
            editor.addEventListener('blur', () => {

                setTimeout(() => updateToolbarButtons(toolbar, editor), 10);
            });
        }
    });

    // cleanup temporary zero-width placeholders inserted when toggling off headings
    document.querySelectorAll('.rich-editor').forEach(editor => {
        editor.addEventListener('input', (e) => {
            hasUnsavedChanges = true;
            try {
                if (editor.dataset && editor.dataset.tempZw) {
                    // remove text nodes that contain only the zero-width char
                    const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT, null, false);
                    const toRemove = [];
                    while (walker.nextNode()) {
                        const tn = walker.currentNode;
                        if (tn.nodeValue === '\u200B') toRemove.push(tn);
                    }
                    toRemove.forEach(n => n.parentNode && n.parentNode.removeChild(n));

                    // remove any empty placeholder spans left behind
                    const placeholders = editor.querySelectorAll('span[data-placeholder]');
                    placeholders.forEach(sp => {
                        if (!sp.textContent || sp.textContent.trim() === '') {
                            sp.parentNode && sp.parentNode.removeChild(sp);
                        }
                    });

                    delete editor.dataset.tempZw;
                }
                // Normalize: if caret is inside a heading-styled span but stickyFormat is empty,
                // unwrap that span so typed text does not inherit heading styles.
                try {
                    const sel = window.getSelection();
                    if (sel && sel.rangeCount > 0) {
                        let node = sel.getRangeAt(0).commonAncestorContainer;
                        if (node && node.nodeType === Node.TEXT_NODE) node = node.parentElement;
                        if (node && node.tagName && node.tagName.toLowerCase() === 'span') {
                            const fs = window.getComputedStyle(node).fontSize || '';
                            const sticky = editor.dataset?.stickyFormat || '';
                            if ((fs === '24px' || fs === '20px') && !sticky) {
                                // unwrap span: move its children out and remove it
                                const parent = node.parentNode;
                                while (node.firstChild) parent.insertBefore(node.firstChild, node);
                                parent.removeChild(node);
                            }
                        }
                    }
                } catch (err) {}
            } catch (err) {}
        });
    });

    document.getElementById('docEditorImageBtn')?.addEventListener('click', (e) => {
        e.preventDefault();

        saveSelectionForEditor('docContent');
        document.getElementById('docEditorImageInput').click();
    });

    document.getElementById('docEditorImageInput')?.addEventListener('change', (e) => {

        restoreSelectionForEditor('docContent');
        inserirImagemNoEditor(e.target.files, 'docContent');
        e.target.value = '';
    });

    document.getElementById('docPassoImageBtn')?.addEventListener('click', (e) => {
        e.preventDefault();
        saveSelectionForEditor('docPassoContent');
        document.getElementById('docPassoEditorImageInput').click();
    });

    document.getElementById('docPassoEditorImageInput')?.addEventListener('change', (e) => {
        restoreSelectionForEditor('docPassoContent');
        inserirImagemNoEditor(e.target.files, 'docPassoContent');
        e.target.value = '';
    });

    document.getElementById('editDocEditorImageBtn')?.addEventListener('click', (e) => {
        e.preventDefault();
        saveSelectionForEditor('editDocContent');
        document.getElementById('editDocEditorImageInput').click();
    });

    document.getElementById('editDocEditorImageInput')?.addEventListener('change', (e) => {
        restoreSelectionForEditor('editDocContent');
        inserirImagemNoEditor(e.target.files, 'editDocContent');
        e.target.value = '';
    });

    document.getElementById('editDocPassoImageBtn')?.addEventListener('click', (e) => {
        e.preventDefault();
        saveSelectionForEditor('editDocPassoContent');
        document.getElementById('editDocPassoImageInput').click();
    });

    document.getElementById('editDocPassoImageInput')?.addEventListener('change', (e) => {
        restoreSelectionForEditor('editDocPassoContent');
        inserirImagemNoEditor(e.target.files, 'editDocPassoContent');
        e.target.value = '';
    });

    document.querySelectorAll('.rich-editor').forEach(editor => {
        editor.addEventListener('blur', () => {
            if (editor.innerHTML.trim() === '' || editor.innerHTML === '<br>') {
                editor.innerHTML = '';
            }
        });
    });

    

    // chat send buttons removed

    // Floating AI button behavior: open chat and optionally send last focused editor content
    const floatingBtn = document.getElementById('floatingAiButton');
    if (floatingBtn) {
        floatingBtn.addEventListener('click', () => {
            // if there is a last focused editor, try to send its content automatically
            if (lastFocusedEditorId) {
                const editorId = lastFocusedEditorId;
                const isEdit = editorId.startsWith('edit');
                const isPasso = /Passo/i.test(editorId);
                const editor = document.getElementById(editorId);
                const txt = editor ? editor.innerText.trim() : '';
                if (txt) {
                    sendEditorContentToChat(editorId, { isEdit, isPasso });
                    return;
                }
            }

            // otherwise, just open the chat view
            mudarSecao('chat');
        });
    }
}

function updateToolbarButtons(toolbar, editor) {
    if (!toolbar || !editor) return;

    const buttons = toolbar.querySelectorAll('.editor-btn');
    const selection = window.getSelection();

    // helper: detect heading-like element at current selection/caret
    function detectHeadingAtSelection() {
        try {
            if (!selection || selection.rangeCount === 0) return '';
            let node = selection.getRangeAt(0).commonAncestorContainer;
            if (node.nodeType === Node.TEXT_NODE) node = node.parentElement;
            while (node && node !== editor) {
                if (node.tagName) {
                    const t = node.tagName.toLowerCase();
                    if (t === 'h2' || t === 'h3') return t;
                    if (t === 'span') {
                        try {
                            const fs = window.getComputedStyle(node).fontSize || '';
                            if (fs === '24px') return 'h2';
                            if (fs === '20px') return 'h3';
                        } catch (e) {}
                    }
                }
                node = node.parentElement;
            }
        } catch (e) {}
        return '';
    }

    const currentHeading = detectHeadingAtSelection();
    const hasSelection = selection && selection.rangeCount > 0 && !selection.isCollapsed;

    // Determine a single active format (mutually exclusive H2/H3)
    let activeFormat = '';
    if (!hasSelection) {
        try {
            const sticky = editor.dataset?.stickyFormat || '';
            if (sticky) {
                activeFormat = sticky;
            } else if (currentHeading) {
                activeFormat = currentHeading;
            }
        } catch (e) {}
    }

    // If there's a temporary zero-width placeholder inserted when toggling
    // headings off, treat as no active format to avoid leaving a heading
    // button visually highlighted until the placeholder is cleaned on input.
    try {
        if (editor && editor.dataset && editor.dataset.tempZw) {
            activeFormat = '';
        }
    } catch (e) {}

    buttons.forEach(btn => {
        const command = btn.dataset.command;
        const value = btn.dataset.value;

        btn.classList.remove('active');
        btn.disabled = false;
        btn.classList.remove('disabled');

        if (command === 'formatBlock') {
            if (hasSelection) {
                btn.classList.remove('active');
            } else {
                if (activeFormat && activeFormat === value) {
                    btn.classList.add('active');
                } else {
                    btn.classList.remove('active');
                }
            }
        } else if (['bold', 'italic', 'underline', 'insertUnorderedList'].includes(command)) {
            // If inside a heading-like format, disable bold
            if (command === 'bold' && activeFormat) {
                btn.disabled = true;
                btn.classList.add('disabled');
                btn.classList.remove('active');
            } else {
                // Active if queryCommandState OR if caret-only and stickyFormat matches
                let isActive = false;
                try { isActive = document.queryCommandState(command); } catch (e) { isActive = false; }

                if (!hasSelection) {
                    const sticky = editor.dataset?.stickyFormat || '';
                    if (sticky === command) isActive = true;
                }

                if (isActive) btn.classList.add('active');
                else btn.classList.remove('active');
            }
        }
    });
}

// Normaliza estado do editor: limpa placeholders e desembrulha spans de heading
function normalizeEditorAfterFullscreen(editor) {
    if (!editor) return;
    try {
        // remove temporary zw placeholders
        if (editor.dataset && editor.dataset.tempZw) {
            const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT, null, false);
            const toRemove = [];
            while (walker.nextNode()) {
                const tn = walker.currentNode;
                if (tn.nodeValue === '\u200B') toRemove.push(tn);
            }
            toRemove.forEach(n => n.parentNode && n.parentNode.removeChild(n));
            const placeholders = editor.querySelectorAll('span[data-placeholder]');
            placeholders.forEach(sp => sp.parentNode && sp.parentNode.removeChild(sp));
            delete editor.dataset.tempZw;
        }

        // If caret inside heading-styled span and no stickyFormat, unwrap it
        try {
            const sel = window.getSelection();
            if (sel && sel.rangeCount > 0) {
                let node = sel.getRangeAt(0).commonAncestorContainer;
                if (node && node.nodeType === Node.TEXT_NODE) node = node.parentElement;
                if (node && node.tagName && node.tagName.toLowerCase() === 'span') {
                    const fs = window.getComputedStyle(node).fontSize || '';
                    const sticky = editor.dataset?.stickyFormat || '';
                    if ((fs === '24px' || fs === '20px') && !sticky) {
                        const parent = node.parentNode;
                        while (node.firstChild) parent.insertBefore(node.firstChild, node);
                        parent.removeChild(node);
                    }
                }
            }
        } catch (e) {}

        // update toolbar visuals if toolbar exists
        const toolbar = editor.previousElementSibling;
        if (toolbar && toolbar.classList.contains('editor-toolbar')) updateToolbarButtons(toolbar, editor);
    } catch (e) {}
}

function inserirImagemNoEditor(files, editorId) {
    if (!files || files.length === 0) return;

    const editor = document.getElementById(editorId);
    if (!editor) return;

    editor.focus();

    Array.from(files).forEach((file) => {
        if (!file.type.startsWith('image/')) return;

        const reader = new FileReader();
        reader.onload = (e) => {
            const img = new Image();
            img.onload = () => {
                const canvas = document.createElement('canvas');
                let width = img.width;
                let height = img.height;

                if (width > 600) {
                    height = Math.round((height * 600) / width);
                    width = 600;
                }

                canvas.width = width;
                canvas.height = height;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, width, height);

                canvas.toBlob((blob) => {
                    const reader2 = new FileReader();
                    reader2.onload = (event) => {

                        const newP = document.createElement('p');
                        const imgElement = document.createElement('img');
                        imgElement.src = event.target.result;
                        imgElement.style.maxWidth = '100%';
                        imgElement.style.height = 'auto';
                        imgElement.style.display = 'block';
                        imgElement.style.margin = '1rem 0';
                        imgElement.style.borderRadius = '0.5rem';
                        
                        newP.appendChild(imgElement);

                        const selection = window.getSelection();
                        let insertNode = editor;
                        
                        if (selection.rangeCount > 0) {
                            const range = selection.getRangeAt(0);
                            const commonAncestor = range.commonAncestorContainer;

                            let node = commonAncestor.nodeType === Node.TEXT_NODE ? 
                                       commonAncestor.parentNode : commonAncestor;
                            
                            while (node && node.parentNode !== editor) {
                                node = node.parentNode;
                            }
                            
                            if (node && node.parentNode === editor) {

                                insertNode = node.nextSibling ? node.nextSibling : null;
                                if (insertNode) {
                                    editor.insertBefore(newP, insertNode);
                                } else {
                                    editor.appendChild(newP);
                                }
                            } else {
                                editor.appendChild(newP);
                            }
                        } else {
                            editor.appendChild(newP);
                        }
                        
                        editor.focus();
                    };
                    reader2.readAsDataURL(blob);
                }, 'image/jpeg', 0.8);
            };
            img.src = e.target.result;
        };
        reader.readAsDataURL(file);
    });
}

/*
  ╔════════════════════════════════════════════════════════════════════════════╗
  ║ DOCUMENTAÇÃO DE PROBLEMA CRÍTICO - TELA BRANCA                            ║
  ╠════════════════════════════════════════════════════════════════════════════╣
  ║ PROBLEMA:                                                                  ║
  ║ Se a função mudarSecao() tiver código orfão (código fora de chaves {}),   ║
  ║ o JavaScript para de funcionar e exibe tela branca.                       ║
  ║                                                                            ║
  ║ CAUSA COMUM:                                                              ║
  ║ - Edição incompleta da função (deletar linhas sem fechar chaves)         ║
  ║ - Deixar código solto sem estar dentro da função                         ║
  ║                                                                            ║
  ║ SOLUÇÃO:                                                                   ║
  ║ - Verificar que a função SEMPRE termina com }                            ║
  ║ - Não deixar código HTML/JS solto fora da função                         ║
  ║ - Usar console.log() para verificar erros (F12 > Console)                ║
  ║                                                                            ║
  ║ ESTRUTURA CORRETA:                                                         ║
  ║ function mudarSecao(secao) {                                              ║
  ║     // ... código aqui ...                                               ║
  ║     toggleAddFieldsVisibility(false);                                    ║
  ║ } // <-- ESTA CHAVE FECHA A FUNÇÃO - ESSENCIAL!                         ║
  ╚════════════════════════════════════════════════════════════════════════════╝
*/

function mudarSecao(secao) {
    // Rastreia seção anterior (só se não é 'chat')
    const currentSection = document.querySelector('.content-section.active')?.id;
    if (currentSection && currentSection !== 'chat') {
        previousSection = currentSection;
    }

    document.querySelectorAll('.nav-link').forEach(l => l.classList.remove('active'));
    document.querySelector(`[data-section="${secao}"]`)?.classList.add('active');

    document.querySelectorAll('.content-section').forEach(s => s.classList.remove('active'));
    document.getElementById(secao)?.classList.add('active');

    // Gerenciar elementos quando entra/sai do Chat
    const sidebar = document.querySelector('.sidebar');
    const settingsBtn = document.getElementById('topSettingsBtn');
    const aiSettingsBtn = document.getElementById('aiSettingsBtn');
    const chatBackBtn = document.getElementById('chatBackBtn');
    const navbarChatInfo = document.getElementById('navbarChatInfo');
    const navbarLogo = document.querySelector('.navbar-logo');
    const navMenu = document.querySelector('.nav-menu');
    const editModal = document.getElementById('editModal');

    if (secao === 'chat') {
        // Fechar modal de edição ao entrar em Chat IA
        if (editModal) setModalVisible('editModal', false);
        
        if (sidebar) sidebar.style.display = 'none';
        if (settingsBtn) settingsBtn.style.display = 'none';
        if (aiSettingsBtn) aiSettingsBtn.style.display = 'flex';
        if (chatBackBtn) chatBackBtn.style.display = 'flex';
        if (navbarChatInfo) navbarChatInfo.style.display = 'flex';
        if (navbarLogo) navbarLogo.style.display = 'none';
        if (navMenu) navMenu.style.display = 'none';
    } else {
        if (sidebar) sidebar.style.display = '';
        if (settingsBtn) settingsBtn.style.display = '';
        if (aiSettingsBtn) aiSettingsBtn.style.display = 'none';
        if (chatBackBtn) chatBackBtn.style.display = 'none';
        if (navbarChatInfo) navbarChatInfo.style.display = 'none';
        if (navbarLogo) navbarLogo.style.display = '';
        if (navMenu) navMenu.style.display = '';
    }

    // If opening chat, inject a top bar (outside the chat input) with a back button and scope text
    try {
        const chatWrapper = document.querySelector('#chat .chat-wrapper');
        const chatContainer = chatWrapper ? chatWrapper.querySelector('.chat-container') : null;
        if (secao === 'chat' && chatWrapper && chatContainer) {
            let topBar = document.getElementById('chatTopBar');
            if (!topBar) {
                topBar = document.createElement('div');
                topBar.id = 'chatTopBar';
                topBar.className = 'chat-top-bar';
                chatWrapper.insertBefore(topBar, chatContainer);
            }

            let backBtn = document.getElementById('chatBackBtn');
            if (!backBtn) {
                backBtn = document.createElement('button');
                backBtn.id = 'chatBackBtn';
                backBtn.className = 'btn-secondary';
                backBtn.addEventListener('click', () => goBackFromChat());
                topBar.appendChild(backBtn);
            }

            let topText = document.getElementById('chatTopText');
            if (!topText) {
                topText = document.createElement('div');
                topText.id = 'chatTopText';
                topText.className = 'chat-top-text';
                topBar.appendChild(topText);
            }

            if (currentChatOrigin && currentChatOrigin.type === 'edit') backBtn.textContent = '↩️';
            else if (currentChatOrigin && currentChatOrigin.type === 'create') backBtn.textContent = '↩️';
            else backBtn.textContent = '↩️';

            // topText will be managed by setChatScopeBanner(); leave empty by default
        } else {
            const topBar = document.getElementById('chatTopBar');
            if (topBar) topBar.remove();
        }
    } catch (e) {}

    // Remover fullscreen-add ao mudar seção
    document.body.classList.remove('fullscreen-add');

    // Resetar botões de fullscreen para adicionar
    const fullscreenAddBtn = document.getElementById('fullscreenAddToolbarBtn');
    const fullscreenAddBtnPasso = document.getElementById('fullscreenAddToolbarBtnPasso');
    const fullscreenBackBtn = document.getElementById('fullscreenBackBtn');
    if (fullscreenAddBtn) {
        fullscreenAddBtn.style.display = 'inline-block';
        fullscreenAddBtn.textContent = '🖥️';
        fullscreenAddBtn.title = 'Tela Grande';
    }
    if (fullscreenAddBtnPasso) {
        fullscreenAddBtnPasso.style.display = 'inline-block';
        fullscreenAddBtnPasso.textContent = '🖥️';
        fullscreenAddBtnPasso.title = 'Tela Grande';
    }
    if (fullscreenBackBtn) {
        fullscreenBackBtn.style.display = 'none';
    }
    const fullscreenBackBtnPasso = document.getElementById('fullscreenBackBtnPasso');
    if (fullscreenBackBtnPasso) {
        fullscreenBackBtnPasso.style.display = 'none';
    }

    toggleAddFieldsVisibility(false);
}

function adicionarDocumentacao(e) {
    e.preventDefault();

    const titulo = document.getElementById('docTitle').value.trim();
    const descricao = document.getElementById('docDescription').value.trim();
    const conteudo = document.getElementById('docContent').innerHTML.trim();
    const conteudoPasso = document.getElementById('docPassoContent') ? document.getElementById('docPassoContent').innerHTML.trim() : '';
    const tipoSelecionado = document.getElementById('docType') ? document.getElementById('docType').value : 'normal';
    let catId = parseInt(document.getElementById('docCategory').value) || 0;
    let tags = document.getElementById('docTags').value.split(',').map(t => {
        let tag = t.trim();
        if (tag.startsWith('#')) tag = tag.substring(1);
        return tag;
    }).filter(t => t);

    if (tags.length === 0) {
        alert('❌ Adicione pelo menos uma tag!');
        return;
    }

    if (!titulo || !descricao) {
        alert('❌ Preencha os campos obrigatórios!');
        return;
    }

    const hasNormal = conteudo && conteudo !== '';
    const hasPasso = conteudoPasso && conteudoPasso !== '';


    const docTypeSelectElem = document.getElementById('docType');
    let effectiveTipo = tipoSelecionado;
    if (tipoSelecionado === 'normal' && !hasNormal && hasPasso) {
        effectiveTipo = 'passo-a-passo';
        if (docTypeSelectElem) docTypeSelectElem.value = 'passo-a-passo';
    } else if (tipoSelecionado === 'passo-a-passo' && !hasPasso && hasNormal) {
        effectiveTipo = 'normal';
        if (docTypeSelectElem) docTypeSelectElem.value = 'normal';
    } else if (tipoSelecionado === 'ambos') {

    }

    if (effectiveTipo === 'normal' && !hasNormal) {
        alert('❌ Preencha o conteúdo (versão Normal)');
        return;
    }

    if (effectiveTipo === 'passo-a-passo' && !hasPasso) {
        alert('❌ Preencha o conteúdo (Passo a Passo)');
        return;
    }

    if (effectiveTipo === 'ambos' && !hasNormal && !hasPasso) {
        alert('❌ Preencha pelo menos uma das versões (Normal ou Passo a Passo)');
        return;
    }

    if (catId === 0) {
        if (currentSelectedCategory !== 'todos') {
            catId = parseInt(currentSelectedCategory);
        } else {

            catId = categorias.length > 0 ? (categorias[0]?.id || 0) : 0;
        }
    }

    let categoriaDoc;
    if (catId === 0) {
        categoriaDoc = 'todos';
    } else {
        categoriaDoc = String(catId);
    }

    documentacoes.push({
        id: Date.now(),
        titulo,
        descricao,
        conteudo: conteudo || '',
        conteudoPasso: conteudoPasso || '', // Armazenar versão "passo a passo"

        categoria: categoriaDoc,
        tags: tags,
        anexos: [],
        dataCriacao: new Date().toLocaleDateString('pt-BR'),
        dataAtualizacao: new Date().toLocaleDateString('pt-BR')
    });

    salvarDados();
    renderizarDocumentacoes(documentacoes);
    document.getElementById('docForm').reset();
    document.getElementById('docContent').innerHTML = '';
    if (document.getElementById('docPassoContent') ) document.getElementById('docPassoContent').innerHTML = '';
    hasUnsavedChanges = false;
    mudarSecao('documentos');
    filtrarPorCategoria(currentSelectedCategory);
    atualizarStats();
    alert('✅ Documentação criada!');
}

function renderizarDocumentacoes(docs = null) {
    const container = document.querySelector('.docs-container');
    if (!container) return;

    let toRender = [];
    
    if (docs === null || docs === undefined) {
        toRender = documentacoes;
    } else if (Array.isArray(docs)) {
        toRender = docs;
    } else {
        toRender = documentacoes;
    }
    
    const viewType = 'cards';

    container.classList.remove('cards-view', 'list-view');
    container.classList.add('cards-view');
    container.innerHTML = '';

    if (toRender.length === 0) {
        const noResults = document.getElementById('noResults');
        if (noResults) noResults.style.display = 'block';
        return;
    }

    const noResults = document.getElementById('noResults');
    if (noResults) noResults.style.display = 'none';

    toRender.forEach(doc => {
        const card = document.createElement('div');
        card.className = `doc-card`;
        card.dataset.docId = doc.id;

        let tagsHTML = '';
        if (doc.tags && doc.tags.length > 0) {
            const allTagsText = doc.tags.map(t => `#${t}`).join(' ');
            // Mostrar no máximo 3 tags; se houver mais, adicionar uma tag "..." que indica mais
            const visible = doc.tags.slice(0, 3);
            tagsHTML = `<div class="doc-tags tooltip" title="${allTagsText}">`;
            visible.forEach(t => {
                tagsHTML += `<span class="tag">#${escapeHtml(String(t))}</span>`;
            });
            if (doc.tags.length > 3) {
                tagsHTML += `<span class="tag tag-more" aria-hidden="true">...</span>`;
            }
            tagsHTML += `</div>`;
        }
        
        card.innerHTML = `
            <div class="card-top">
                <div class="doc-icon">${getIconeCategoria(doc.categoria)}</div>
                <div class="doc-title tooltip" title="${doc.titulo}">${doc.titulo}
                    <span class="tooltip-text">${doc.titulo}</span>
                </div>
            </div>
            <div class="card-body">
                <p class="doc-description tooltip" title="${doc.descricao}">${doc.descricao}
                    <span class="tooltip-text">${doc.descricao}</span>
                </p>
            </div>
            <div class="doc-footer">
                ${tagsHTML}
                <div class="doc-footer-meta">
                    <div class="doc-category">${getNomeCategoria(doc.categoria)}</div>
                    <span class="doc-date">📅 ${doc.dataCriacao}</span>
                </div>
            </div>
        `;
        card.addEventListener('click', () => abrirDocumento(doc));
        container.appendChild(card);
    });

    // Se estiver em modo reordenação, reaplicar os estilos e event listeners
    if (reorderingMode) {
        setTimeout(() => {
            const docCards = container.querySelectorAll('.doc-card');
            docCards.forEach(card => {
                // Aplicar estilos visuais de reordenação
                card.classList.add('reordering-mode');
                card.draggable = true;
                card.style.cursor = 'move';
                card.style.border = '2px solid #6366f1';
                card.style.backgroundColor = 'rgba(99, 102, 241, 0.15)';
                // Removido opacity e grayscale para manter visual normal

                // Bloquear cliques para abrir documento
                card._originalClickHandler = card.onclick;
                card.onclick = null;
                
                const preventClicks = (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    e.stopImmediatePropagation();
                    return false;
                };
                
                card.addEventListener('click', preventClicks, true);
                card.addEventListener('dblclick', preventClicks, true);
                card.addEventListener('contextmenu', preventClicks, true);
                
                card._preventClickHandlers = [preventClicks, preventClicks, preventClicks];

                // Adicionar event listeners de drag
                card.removeEventListener('dragstart', handleDragStart);
                card.removeEventListener('dragover', handleDragOver);
                card.removeEventListener('drop', handleDropDocs);
                card.removeEventListener('dragend', handleDragEnd);
                card.removeEventListener('dragenter', handleDragEnter);
                card.removeEventListener('dragleave', handleDragLeave);
                
                card.addEventListener('dragstart', handleDragStart);
                card.addEventListener('dragover', handleDragOver);
                card.addEventListener('drop', handleDropDocs);
                card.addEventListener('dragend', handleDragEnd);
                card.addEventListener('dragenter', handleDragEnter);
                card.addEventListener('dragleave', handleDragLeave);
            });
        }, 10);
    }
}



function abrirDocumento(doc) {

    if (reorderingMode) {
        cancelarReordenacaoDocs();
    }
    
    currentEditingId = doc.id;
    currentEditingType = 'doc';
    currentViewVersion = 'normal'; // Resetar para versão normal ao abrir
    currentDocFullscreen = false;

    const modalContent = document.querySelector('#docModal .modal-content');
    modalContent.classList.remove('modal-fullscreen');
    const fullscreenBtn = document.getElementById('fullscreenDocBtn');
    if (fullscreenBtn) fullscreenBtn.textContent = '🖥️ Tela Cheia';

    document.getElementById('modalTitle').textContent = doc.titulo;
    document.getElementById('modalCategory').textContent = getNomeCategoria(doc.categoria);

    const toggle = document.getElementById('modalVersionToggle');
    if (toggle) {
        toggle.style.display = 'flex';

        toggle.querySelectorAll('.version-btn').forEach(btn => btn.classList.remove('active'));
        const normalBtn = toggle.querySelector('[data-version="normal"]');
        const passoBtn = toggle.querySelector('[data-version="passo"]');
        if (currentViewVersion === 'normal') {
            normalBtn?.classList.add('active');
        } else {
            passoBtn?.classList.add('active');
        }
    }

    const contentEl = document.getElementById('modalContent');
    const contentToShow = currentViewVersion === 'normal' ? (doc.conteudo || '') : (doc.conteudoPasso || '');
    if (!contentToShow || contentToShow.trim() === '') {
        const label = currentViewVersion === 'normal' ? 'normal' : 'passo a passo';
        contentEl.innerHTML = `<p style="opacity:0.8">⚠️ Nenhuma versão ${label} disponível.</p>`;
    } else {
        contentEl.innerHTML = contentToShow;
    }

    const anexosSection = document.getElementById('attachmentsSection');
    if (doc.anexos && doc.anexos.length > 0) {
        anexosSection.style.display = 'block';
        document.getElementById('modalAttachments').innerHTML = doc.anexos.map(a => `
            <div class="modal-attachment">
                <img src="${a.data}" alt="${a.nome}" style="max-width: 100%; max-height: 200px; border-radius: 4px; margin: 8px 0;">
                <p style="font-size: 0.85rem; margin-top: 4px;">📎 ${a.nome}</p>
            </div>
        `).join('');
    } else {
        anexosSection.style.display = 'none';
    }

    const tagsSection = document.getElementById('tagsSection');
    if (doc.tags && doc.tags.length > 0) {
        tagsSection.style.display = 'block';
        document.getElementById('modalTags').innerHTML = doc.tags.map(t => `<span class="tag">#${t}</span>`).join('');
    } else {
        tagsSection.style.display = 'none';
    }

    setModalVisible('docModal', true);

    // Reorganizar header-top: agrupar botões em .header-actions e colocar o título abaixo
    try {
        const headerTop = document.querySelector('#docModal .modal-header-top');
        const header = document.querySelector('#docModal .modal-header');
        const titleEl = document.getElementById('modalTitle');
        if (headerTop && titleEl) {
            // criar header-actions se não existir
            let headerActions = headerTop.querySelector('.header-actions');
            if (!headerActions) {
                headerActions = document.createElement('div');
                headerActions.className = 'header-actions';
                // mover todos os filhos existentes para headerActions
                while (headerTop.firstChild) {
                    headerActions.appendChild(headerTop.firstChild);
                }
                headerTop.appendChild(headerActions);
            }

            // criar um container de título se necessário
            let titleContainer = headerTop.querySelector('.modal-title-center');
            if (!titleContainer) {
                titleContainer = document.createElement('div');
                titleContainer.className = 'modal-title-center';
                headerTop.appendChild(titleContainer);
            }

            // garantir que o título esteja dentro do container centralizado
            if (titleContainer && titleEl && titleContainer !== titleEl.parentNode) {
                titleContainer.appendChild(titleEl);
            }
        }
        if (header) header.style.display = 'none';
    } catch (e) {
        // noop
    }
}

function deletarDocumento() {
    const idParaDeletar = currentEditingId;
    
    documentacoes = documentacoes.filter(d => d.id != idParaDeletar);
    currentEditingId = null;
    currentEditingType = null;
    
    salvarDados();
    setModalVisible('docModal', false);
    setModalVisible('editModal', false);
    filtrarPorCategoria(currentSelectedCategory);
    atualizarStats();
    alert('✅ Documentação deletada!');
}

function abrirEdicao() {

    if (reorderingMode) {
        cancelarReordenacaoDocs();
    }
    
    const doc = documentacoes.find(d => d.id == currentEditingId);
    if (!doc) return;

    currentEditVersion = 'normal';

    document.getElementById('editDocTitle').value = doc.titulo;
    if (doc.categoria === 'todos') {
        document.getElementById('editDocCategory').value = '';
    } else {
        document.getElementById('editDocCategory').value = doc.categoria;
    }
    document.getElementById('editDocDescription').value = doc.descricao;
    document.getElementById('editDocContent').innerHTML = doc.conteudo;
    document.getElementById('editDocPassoContent').innerHTML = doc.conteudoPasso || '';
    document.getElementById('editDocTags').value = doc.tags.join(', ');

    const editDocDescriptionInput = document.getElementById('editDocDescription');
    const editDocDescriptionCounter = document.getElementById('editDocDescriptionCounter');
    if (editDocDescriptionInput && editDocDescriptionCounter) {
        const currentLength = editDocDescriptionInput.value.length;
        editDocDescriptionCounter.textContent = `${currentLength}/100`;
        editDocDescriptionCounter.style.color = (100 - currentLength) < 10 ? '#ef4444' : 'var(--text-secondary)';
    }

    document.querySelectorAll('.edit-version-toggle .version-btn').forEach(btn => btn.classList.remove('active'));
    document.querySelector('[data-edit-version="normal"]').classList.add('active');

    document.getElementById('normalContentGroup').style.display = 'block';
    document.getElementById('passoContentGroup').style.display = 'none';

    document.getElementById('editContentType').textContent = 'Conteúdo Normal';

    setModalVisible('docModal', false);
    setModalVisible('editModal', true);

    // Por padrão, abre em tela normal (não tela metade)
    const editModalContent = document.querySelector('#editModal .modal-content');
    if (editModalContent) {
        editModalContent.classList.remove('modal-fullscreen');
    }
    const fullscreenEditBtn = document.getElementById('fullscreenEditToolbarBtn');
    const fullscreenEditBtnPasso = document.getElementById('fullscreenEditToolbarBtnPasso');
    if (fullscreenEditBtn) {
        fullscreenEditBtn.textContent = '🖥️';
        fullscreenEditBtn.title = 'Tela Grande';
    }
    if (fullscreenEditBtnPasso) {
        fullscreenEditBtnPasso.textContent = '🖥️';
        fullscreenEditBtnPasso.title = 'Tela Grande';
    }
}

function salvarEdicao(e) {
    e.preventDefault();

    const doc = documentacoes.find(d => d.id == currentEditingId);
    if (!doc) return;

    let tags = document.getElementById('editDocTags').value.split(',').map(t => {
        let tag = t.trim();
        if (tag.startsWith('#')) tag = tag.substring(1);
        return tag;
    }).filter(t => t);

    if (tags.length === 0) {
        alert('❌ Adicione pelo menos uma tag!');
        return;
    }

    doc.titulo = document.getElementById('editDocTitle').value;
    let val = document.getElementById('editDocCategory') ? document.getElementById('editDocCategory').value : '';
    doc.categoria = val ? String(val) : 'todos';
    doc.descricao = document.getElementById('editDocDescription').value;
    doc.conteudo = document.getElementById('editDocContent').innerHTML;
    doc.conteudoPasso = document.getElementById('editDocPassoContent').innerHTML;
    doc.tags = tags;
    doc.dataAtualizacao = new Date().toLocaleDateString('pt-BR');

    salvarDados();
    hasUnsavedChanges = false;
    // Atualizar UI imediatamente
    atualizarSelectsCategorias();
    renderizarDocumentacoes(documentacoes);
    setModalVisible('editModal', false);

    if (reorderingMode) {
        cancelarReordenacao();
    }
    if (reorderingDocsMode) {
        cancelarReordenacaoDocs();
    }
    // Reaplicar filtro atual (usar valor normalizado)
    filtrarPorCategoria(currentSelectedCategory);
    atualizarStats();
    alert('✅ Documentação atualizada!');
}

function pesquisarDocumentacoes() {
    const termo = document.getElementById('searchInput').value.toLowerCase().trim();

    if (termo === '') {
        filtrarPorCategoria(currentSelectedCategory);
        return;
    }

    // Primeiro, filtrar pela categoria atual (se não for 'todos')
    let baseDocs = documentacoes;
    if (currentSelectedCategory !== 'todos') {
        baseDocs = documentacoes.filter(d => String(d.categoria) === currentSelectedCategory);
    }

    const resultados = baseDocs.filter(doc => {
        const t = termo.startsWith('#') ? termo.substring(1) : termo;
        return doc.tags.some(tag => tag.toLowerCase() === t);
    });

    renderizarDocumentacoes(resultados);
}

function filtrarPorCategoria(catId) {
    // normalize to string (preserve 'todos') and store
    let catStr = (catId === undefined || catId === null) ? currentSelectedCategory || 'todos' : catId;
    catStr = (catStr === 'todos') ? 'todos' : String(catStr);
    currentSelectedCategory = catStr;

    // Garantir que todas as documentações no array tenham categoria como string
    documentacoes = documentacoes.map(d => {
        if (d.categoria === undefined || d.categoria === null) {
            d.categoria = 'todos';
        } else {
            d.categoria = String(d.categoria);
        }
        return d;
    });

    // Atualizar classe active nas categorias
    document.querySelectorAll('.category-item').forEach(item => {
        item.classList.remove('active');
        if (item.dataset.categoryId === catStr) {
            item.classList.add('active');
        }
    });

    // debug logs removed

    if (catStr === 'todos') {
        let docs = [...documentacoes];
        const ordem = getOrdemCategoria('todos');
        if (ordem) {
            // Ordenar baseado na ordem salva
            docs.sort((a, b) => {
                const indexA = ordem.indexOf(a.id);
                const indexB = ordem.indexOf(b.id);
                if (indexA === -1 && indexB === -1) return 0;
                if (indexA === -1) return 1;
                if (indexB === -1) return -1;
                return indexA - indexB;
            });
        }
        renderizarDocumentacoes(docs);
    } else {
        // tentar encontrar a categoria por id e nome
        const catObj = categorias.find(c => String(c.id) === catStr);
        const catName = catObj ? catObj.nome : null;
        let filtrados = documentacoes.filter(d => {
            const dc = (d.categoria === undefined || d.categoria === null) ? 'todos' : String(d.categoria);
            return dc === catStr || (catName && dc === String(catName));
        });
        const ordem = getOrdemCategoria(catStr);
        if (ordem) {
            // Ordenar baseado na ordem salva
            filtrados.sort((a, b) => {
                const indexA = ordem.indexOf(a.id);
                const indexB = ordem.indexOf(b.id);
                if (indexA === -1 && indexB === -1) return 0;
                if (indexA === -1) return 1;
                if (indexB === -1) return -1;
                return indexA - indexB;
            });
        }
                renderizarDocumentacoes(filtrados);
    }
}

function abrirModalExemplo() {
    document.getElementById('exemploForm').reset();
    setModalVisible('exemploModal', true);
    currentEditingId = null;
}

function adicionarExemplo(e) {
    e.preventDefault();

    exemplos.push({
        id: Date.now(),
        titulo: document.getElementById('exemploTitulo').value,
        descricao: document.getElementById('exemploDescricao').value,
        solucao: document.getElementById('exemploSolucao').value,
        detalhes: document.getElementById('exemploDetalhes').value,
        referencia: document.getElementById('exemploCriado').value,
        data: new Date().toLocaleDateString('pt-BR')
    });

    salvarDados();
    setModalVisible('exemploModal', false);
    renderizarExemplos();
    atualizarStats();
    alert('✅ Exemplo adicionado!');
}

function renderizarExemplos() {
    const container = document.querySelector('.exemplos-container');
    if (!container) return;

    container.innerHTML = exemplos.map(ex => `
        <div class="exemplo-card">
            <h3>📌 ${ex.titulo}</h3>
            <p><strong>Situação:</strong> ${ex.descricao.substring(0, 80)}...</p>
            <p><strong>Solução:</strong> ${ex.solucao.substring(0, 60)}...</p>
            <div class="exemplo-footer">
                <span>${ex.referencia || ex.data}</span>
                <div class="exemplo-actions">
                    <button class="btn-small edit-exemplo-btn" data-id="${ex.id}">✏️</button>
                    <button class="btn-small delete-exemplo-btn" data-id="${ex.id}">🗑️</button>
                </div>
            </div>
        </div>
    `).join('');

    container.querySelectorAll('.delete-exemplo-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const id = parseInt(btn.dataset.id);
            if (confirm('Deletar?')) {
                exemplos = exemplos.filter(x => x.id !== id);
                salvarDados();
                renderizarExemplos();
                atualizarStats();
            }
        });
    });
}

function adicionarCategoria(e) {
    e.preventDefault();

    const nome = document.getElementById('categoryName').value.trim();
    if (!nome) {
        alert('❌ Nome vazio!');
        return;
    }

    const editingId = document.getElementById('editingCategoryId').value;
    if (editingId) {

        const cat = categorias.find(c => c.id == parseInt(editingId));
        if (cat) {
            cat.nome = nome;
            cat.icone = document.getElementById('categoryIcon').value || '📂';
            const col = document.getElementById('categoryColor'); if (col) cat.cor = col.value;
        }
    } else {
        categorias.push({
            id: Date.now(),
            nome,
            icone: document.getElementById('categoryIcon').value || '📂',
            cor: (document.getElementById('categoryColor') ? document.getElementById('categoryColor').value : undefined)
        });
    }

    salvarDados();
    setModalVisible('categoryModal', false);
    const wasEditing = !!editingId;
    document.getElementById('categoryForm').reset();
    document.getElementById('editingCategoryId').value = '';
    renderizarCategorias();
    atualizarSelectsCategorias();
    renderizarDocumentacoes();
    renderizarExemplos();
    atualizarStats();
    showToast(wasEditing ? '✅ Alterações salvas!' : '✅ Categoria criada!', 'success', 3000);
}

// chat send function removed

function exportarDados() {
    const data = {
        version: '2.0',
        exportDate: new Date().toLocaleString('pt-BR'),
        documentacoes,
        exemplos,
        categorias
    };

    const json = JSON.stringify(data, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `dochub-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
}

function importarDados(e) {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
        try {
            const data = JSON.parse(event.target.result);
            documentacoes = data.documentacoes || [];
            exemplos = data.exemplos || [];
            categorias = data.categorias || [];
            salvarDados();
            filtrarPorCategoria(currentSelectedCategory);
            renderizarExemplos();
            renderizarCategorias();
            atualizarSelectsCategorias();
            atualizarStats();
            alert('✅ Importado!');
        } catch (err) {
            alert('❌ Erro: ' + err.message);
        }
    };
    reader.readAsText(file);
    document.getElementById('importFile').value = '';
}

function exportarOrdens() {
    const ordens = {};
    for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key.startsWith('ordem_categoria_')) {
            ordens[key] = JSON.parse(localStorage.getItem(key));
        }
    }
    
    const data = {
        version: '1.0',
        exportDate: new Date().toLocaleString('pt-BR'),
        ordens
    };

    const json = JSON.stringify(data, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `dochub-ordens-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
}

function importarOrdens(e) {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
        try {
            const data = JSON.parse(event.target.result);
            if (data.ordens) {
                for (const [key, value] of Object.entries(data.ordens)) {
                    localStorage.setItem(key, JSON.stringify(value));
                }
            }
            renderizarDocumentacoes();
            alert('✅ Ordens importadas!');
        } catch (err) {
            alert('❌ Erro: ' + err.message);
        }
    };
    reader.readAsText(file);
    document.getElementById('importOrdensFile').value = '';
}

function limparOrdens() {
    if (!confirm('Tem certeza que deseja limpar todas as ordens de reordenação?')) return;
    
    for (let i = localStorage.length - 1; i >= 0; i--) {
        const key = localStorage.key(i);
        if (key.startsWith('ordem_categoria_')) {
            localStorage.removeItem(key);
        }
    }
    renderizarDocumentacoes();
    alert('✅ Ordens limpas!');
}

function atualizarStats() {
    const docCount = document.getElementById('docCount');
    const exemploCount = document.getElementById('exemploCount');
    const categoryCount = document.getElementById('categoryCount');

    if (docCount) docCount.textContent = documentacoes.length;
    if (exemploCount) exemploCount.textContent = exemplos.length;
    if (categoryCount) categoryCount.textContent = categorias.length;
}

// chat initialization removed

function escapeHtml(text) {
    const map = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#039;'
    };
    return text.replace(/[&<>"']/g, m => map[m]);
}

function renderMessageHTML(text) {
    // escape then convert newlines to <br>
    const safe = escapeHtml(String(text || ''));
    return safe.replace(/\n/g, '<br>');
}
