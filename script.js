let documentacoes = [];
let exemplos = [];
let categorias = [];

function ensureAppState() {
    if (!Array.isArray(documentacoes)) documentacoes = [];
    if (!Array.isArray(exemplos)) exemplos = [];
    if (!Array.isArray(categorias)) categorias = [];
    if (!aiConfig || typeof aiConfig !== 'object') aiConfig = { apiKey: '', model: '', provider: '' };
}
window.ensureAppState = ensureAppState;
let currentEditingId = null;
let currentEditingType = null;
let currentSelectedCategory = 'todos';

function sanitizeAiConfigForStorage(config = {}) {
    if (!config || typeof config !== 'object') return {};
    const sanitized = { ...config };
    delete sanitized.apiKey;
    return sanitized;
}

function readPersistedAiConfig() {
    try {
        const raw = localStorage.getItem(STORAGE_AI);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object') return null;
        return parsed;
    } catch (e) {
        return null;
    }
}

function persistAiConfig(config = {}) {
    try {
        const safeConfig = sanitizeAiConfigForStorage(config || {});
        safeConfig.apiKey = undefined;
        localStorage.setItem(STORAGE_AI, JSON.stringify(safeConfig));
        if (config && typeof config === 'object' && 'apiKey' in config) {
            const nextKey = String(config.apiKey || '');
            sessionStorage.setItem('dochub-ai-api-key', nextKey);
            localStorage.setItem('dochub-ai-api-key', nextKey);
        }
    } catch (e) {
        console.warn('Não foi possível persistir a configuração de IA', e);
    }
}

function restoreAiApiKey() {
    try {
        const persistedKey = (typeof window !== 'undefined' && typeof window.readPersistedAiApiKey === 'function')
            ? window.readPersistedAiApiKey(localStorage, sessionStorage)
            : (sessionStorage.getItem('dochub-ai-api-key') || localStorage.getItem('dochub-ai-api-key') || '');

        if (persistedKey) {
            aiConfig.apiKey = persistedKey;
            sessionStorage.setItem('dochub-ai-api-key', persistedKey);
            localStorage.setItem('dochub-ai-api-key', persistedKey);
            return persistedKey;
        }

        const raw = readPersistedAiConfig();
        if (raw && raw.apiKey) {
            aiConfig.apiKey = raw.apiKey;
            sessionStorage.setItem('dochub-ai-api-key', String(raw.apiKey));
            localStorage.setItem('dochub-ai-api-key', String(raw.apiKey));
            return raw.apiKey;
        }
        return '';
    } catch (e) {
        return '';
    }
}

function getAiInputAttributes() {
    return {
        type: 'text',
        autocomplete: 'off',
        autocapitalize: 'off',
        spellcheck: 'false',
        enterkeyhint: 'done',
        inputmode: 'text'
    };
}

function setAiKeyInputValue(input, value = '', reveal = false) {
    if (!input) return;
    const normalizedValue = String(value || '').trim();
    input.dataset.rawValue = normalizedValue;
    input.dataset.reveal = reveal ? 'true' : 'false';
    input.type = 'text';
    input.value = normalizedValue;
}

function getAiKeyInputValue(input) {
    if (!input) return '';
    const raw = input.dataset.rawValue || '';
    if (raw) return raw.trim();
    return (input.value || '').trim();
}

function configureAiKeyInput(input) {
    if (!input) return;
    const attrs = getAiInputAttributes();
    input.type = attrs.type;
    input.setAttribute('autocomplete', attrs.autocomplete);
    input.setAttribute('autocapitalize', attrs.autocapitalize);
    input.setAttribute('spellcheck', attrs.spellcheck);
    input.setAttribute('inputmode', attrs.inputmode);
    input.setAttribute('enterkeyhint', attrs.enterkeyhint);
    input.setAttribute('data-lpignore', 'true');
    input.setAttribute('data-1p-ignore', 'true');
    input.setAttribute('data-bwignore', 'true');
    input.dataset.reveal = 'true';
    input.addEventListener('input', () => {
        const nextValue = input.value || '';
        input.dataset.rawValue = nextValue;
        input.value = nextValue;
    });
    input.addEventListener('focus', () => {
        input.value = input.dataset.rawValue || '';
    });
    input.addEventListener('blur', () => {
        input.value = input.dataset.rawValue || '';
    });
}

function initializeAiKeyInputs() {
    ['aiApiKey', 'testApiKey'].forEach((id) => {
        const el = document.getElementById(id);
        if (!el) return;
        configureAiKeyInput(el);
        setAiKeyInputValue(el, el.dataset.rawValue || '', true);
    });
}
window.initializeAiKeyInputs = initializeAiKeyInputs;

function setActiveAiTab(tabName = 'api') {
    document.querySelectorAll('.ai-tab-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.tab === tabName);
    });
    document.querySelectorAll('.ai-tab-content').forEach(content => {
        content.classList.toggle('active', content.dataset.tab === tabName);
    });
}
window.setActiveAiTab = setActiveAiTab;

let currentViewVersion = 'normal';
let currentEditVersion = 'normal';
let currentDocFullscreen = false;
let aiConfig = { apiKey: '', model: '', provider: '' };
let aiSettingsSaved = false; // flag temporária para controlar fechamento do modal de IA
let activeChatCommandNames = []; // comandos @ ativos no chat IA
let chatMentionSelectionBlockedSend = false;
let aiAutoValidationTimer = null;
const DEFAULT_OPENAI_MODEL = 'gpt-3.5-turbo';
const DEFAULT_GENAI_MODEL = 'gemini-2.5-flash';

function inferProviderFromModel(model = '') {
    const name = (model || '').toLowerCase();
    if (name.includes('gem') || name.includes('gemma') || name.includes('gemini')) return 'genai';
    if (name.includes('claude') || name.includes('anthropic')) return 'anthropic';
    return 'openai';
}

function detectProviderFromApiKey(apiKey = '', model = '', provider = '') {
    const normalizedProvider = String(provider || '').trim().toLowerCase();
    if (['genai', 'gemini', 'google', 'googleai', 'google-generative-ai'].includes(normalizedProvider)) return 'genai';
    if (['openai', 'gpt', 'chatgpt'].includes(normalizedProvider)) return 'openai';
    if (['anthropic', 'claude'].includes(normalizedProvider)) return 'anthropic';

    const key = String(apiKey || '').trim();
    if (/^AIza/.test(key)) return 'genai';
    if (/^(sk-|sk-proj-|sk-ant-|gsk_)/.test(key)) return 'openai';

    const modelName = String(model || '').trim().toLowerCase();
    if (modelName.includes('gemini') || modelName.includes('gemma')) return 'genai';
    if (modelName.includes('claude') || modelName.includes('anthropic')) return 'anthropic';

    return inferProviderFromModel(model);
}

function normalizeAiModel(model = '', provider = '') {
    const effectiveProvider = provider || inferProviderFromModel(model);
    const currentModel = (model || '').trim();

    if (effectiveProvider === 'genai') {
        const lower = currentModel.toLowerCase();
        if (!currentModel || lower.includes('gemma') || lower.startsWith('gemini-1.5') || lower.startsWith('gemini-2.0') || lower === 'gemini-1.5' || lower === 'gemini-2.0-flash-exp') {
            return DEFAULT_GENAI_MODEL;
        }
        return currentModel;
    }

    if (effectiveProvider === 'anthropic') {
        return currentModel || 'claude-3-5-sonnet-latest';
    }

    return currentModel || DEFAULT_OPENAI_MODEL;
}
let isChatThinking = false; // indica se a IA está processando uma requisição
let nextBotMessageIsResume = false; // marca se a próxima mensagem de bot é um resumo
const STORAGE_UI = 'dochub-ui-config';

/*
  Rastreamento de mudanças - aviso de saída segura.
  hasUnsavedChanges = true quando houver mudanças não salvas.
*/
let hasUnsavedChanges = false;
// Quando true, impede que o evento beforeunload mostre confirmação.
let suppressUnsavedWarning = false;
let pendingImagePlaceholderForNormalDoc = null;
let chatSavedSinceOpen = false;
const imagePlaceholderDisabledNodes = new WeakSet();

function createNormalDocImagePlaceholder(editorId, manual = false) {
    const wrapper = document.createElement('div');
    wrapper.className = 'doc-image-placeholder-wrapper';
    wrapper.dataset.editor = editorId;
    wrapper.setAttribute('contenteditable', 'false');
    if (manual) wrapper.dataset.manual = 'true';
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'doc-image-placeholder-btn';
    btn.textContent = '🖼️';
    btn.title = 'Inserir imagem';
    btn.dataset.editor = editorId;
    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'doc-image-placeholder-remove-btn';
    removeBtn.title = 'Excluir placeholder';
    removeBtn.textContent = '✕';
    wrapper.appendChild(btn);
    wrapper.appendChild(removeBtn);
    return wrapper;
}

function cleanNormalDocImagePlaceholders(editor) {
    if (!editor) return;
    const placeholders = Array.from(editor.querySelectorAll('.doc-image-placeholder-wrapper'));
    placeholders.forEach(ph => {
        if (ph.dataset.manual === 'true') return;
        ph.remove();
    });
}

function getNormalDocNumberedLineNumber(text) {
    if (!text) return null;
    const trimmed = text.trim();
    const match = trimmed.match(/^(\d+)\.\s+[A-ZÀ-Ú].*/);
    if (!match) return null;
    const n = parseInt(match[1], 10);
    return Number.isNaN(n) ? null : n;
}

function isNormalDocNumberedLine(text) {
    return getNormalDocNumberedLineNumber(text) !== null;
}

function stripRichEditorListFormatting(editor) {
    if (!editor) return;
    const lists = editor.querySelectorAll('ul, ol');
    lists.forEach((list) => {
        const paragraph = document.createElement('p');
        const fragments = Array.from(list.children).map((item) => item.innerHTML || item.textContent || '');
        paragraph.innerHTML = fragments.join('<br>');
        list.replaceWith(paragraph);
    });
}

function shouldPreventAutoListOnEnter(editor) {
    if (!editor) return false;
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0 || !selection.isCollapsed) return false;

    const range = selection.getRangeAt(0);
    const container = range.commonAncestorContainer;
    const element = container.nodeType === Node.ELEMENT_NODE ? container : container.parentElement;
    const block = element?.closest('p, li, div');
    if (!block) return false;

    const text = (block.textContent || '').replace(/\u00A0/g, ' ').trim();
    return /^\d+[.)]\s*$/.test(text) || /^[-*+]\s*$/.test(text);
}

function handleRichEditorEnter(editor, event) {
    if (!editor || !event || event.key !== 'Enter' || event.shiftKey || event.altKey || event.ctrlKey || event.metaKey) {
        return;
    }

    if (shouldPreventAutoListOnEnter(editor)) {
        event.preventDefault();
        document.execCommand('insertParagraph', false, null);
        requestAnimationFrame(() => {
            stripRichEditorListFormatting(editor);
            preserveImagePlaceholderBlock(editor);
            ensureImagePlaceholdersInNormalEditor(editor);
        });
    }
}

function ensureImagePlaceholdersInNormalEditor(editor) {
    if (!editor || !editor.id) return;
    if (!(editor.id === 'docContent' || editor.id === 'editDocContent')) return;

    cleanNormalDocImagePlaceholders(editor);

    const selection = window.getSelection();
    let savedRange = null;
    if (selection && selection.rangeCount > 0) {
        try {
            savedRange = selection.getRangeAt(0).cloneRange();
        } catch (e) {
            savedRange = null;
        }
    }

    const nodes = Array.from(editor.children);
    nodes.forEach((node) => {
        if (!node || node.classList.contains('doc-image-placeholder-wrapper')) return;
        if (node.querySelector && node.querySelector('img')) return;
        imagePlaceholderDisabledNodes.delete(node);
    });

    try {
        if (savedRange) {
            selection.removeAllRanges();
            selection.addRange(savedRange);
        }
    } catch (e) {}
}

function moveCaretToImagePlaceholderParagraph(editor, placeholder) {
    if (!editor || !placeholder) return;
    const next = placeholder.nextElementSibling;
    if (!next || !next.tagName || next.tagName.toLowerCase() !== 'p') return;

    const caret = () => {
        const range = document.createRange();
        range.setStart(next, 0);
        range.collapse(true);
        const selection = window.getSelection();
        if (!selection) return;
        selection.removeAllRanges();
        selection.addRange(range);
        editor.focus();
    };

    if (typeof requestAnimationFrame === 'function') {
        requestAnimationFrame(caret);
    } else {
        setTimeout(caret, 0);
    }
}

function insertManualImagePlaceholderAtCursor(editor) {
    if (!editor || !editor.id) return null;
    const selection = window.getSelection();
    if (!selection || !selection.rangeCount) return null;
    let node = selection.getRangeAt(0).commonAncestorContainer;
    if (node.nodeType === Node.TEXT_NODE) node = node.parentNode;
    while (node && node.parentNode !== editor) {
        node = node.parentNode;
    }
    if (!node || node.classList.contains('doc-image-placeholder-wrapper')) return null;

    const previous = node.previousElementSibling;
    if (previous && previous.classList.contains('doc-image-placeholder-wrapper')) return previous;
    if (node.querySelector && node.querySelector('img')) return null;

    const placeholder = createNormalDocImagePlaceholder(editor.id, true);
    const paragraphBelow = document.createElement('p');
    paragraphBelow.dataset.imageParagraph = 'true';
    paragraphBelow.innerHTML = '<br>';

    editor.insertBefore(placeholder, node);
    editor.insertBefore(paragraphBelow, node);
    imagePlaceholderDisabledNodes.add(node);
    ensureImageBlockStructure(editor);
    moveCaretToImagePlaceholderParagraph(editor, placeholder);
    return placeholder;
}

function ensureImageBlockStructure(editor) {
    if (!editor) return;

    const placeholders = Array.from(editor.querySelectorAll('.doc-image-placeholder-wrapper'));

    placeholders.forEach((placeholder) => {
        if (!placeholder.parentNode) return;

        const next = placeholder.nextElementSibling;

        if (!next) {
            const forced = document.createElement('p');
            forced.innerHTML = '<br>';
            placeholder.parentNode.appendChild(forced);
            return;
        }

        if (next.tagName && next.tagName.toLowerCase() === 'p') {
            next.dataset.imageParagraph = 'true';
            if (!next.textContent || next.textContent.trim() === '') {
                next.innerHTML = '<br>';
            }
            return;
        }

        const forced = document.createElement('p');
        forced.dataset.imageParagraph = 'true';
        forced.innerHTML = '<br>';
        placeholder.parentNode.insertBefore(forced, next);
    });
}

function preserveImagePlaceholderBlock(editor) {
    if (!editor) return;
    ensureImageBlockStructure(editor);

    const placeholders = Array.from(editor.querySelectorAll('.doc-image-placeholder-wrapper'));
    placeholders.forEach((placeholder) => {
        if (!placeholder.nextElementSibling || placeholder.nextElementSibling.tagName.toLowerCase() !== 'p') {
            const forced = document.createElement('p');
            forced.dataset.imageParagraph = 'true';
            forced.innerHTML = '<br>';
            placeholder.parentNode.insertBefore(forced, placeholder.nextSibling);
        }
    });
}

function replaceImageShortcutTokens(editor) {
    if (!editor || !editor.id) return;
    if (!['docContent', 'editDocContent'].includes(editor.id)) return;

    const originalHtml = editor.innerHTML || '';
    if (!/\$image(?:\$|%)/i.test(originalHtml)) return;

    const placeholderMarkup = [
        '<div class="doc-image-placeholder-wrapper" data-editor="' + editor.id + '" contenteditable="false" data-manual="true">',
        '  <button type="button" class="doc-image-placeholder-btn" data-editor="' + editor.id + '" title="Inserir imagem">🖼️</button>',
        '  <button type="button" class="doc-image-placeholder-remove-btn" title="Excluir placeholder">✕</button>',
        '</div>',
        '<p data-image-paragraph="true"><br></p>'
    ].join('');

    const nextHtml = originalHtml.replace(/\$image(?:\$|%)/gi, placeholderMarkup);
    if (nextHtml === originalHtml) return;

    editor.innerHTML = nextHtml;
    ensureImagePlaceholdersInNormalEditor(editor);
    preserveImagePlaceholderBlock(editor);

    const insertedPlaceholders = Array.from(editor.querySelectorAll('.doc-image-placeholder-wrapper[data-manual="true"]'));
    const lastPlaceholder = insertedPlaceholders.length > 0 ? insertedPlaceholders[insertedPlaceholders.length - 1] : null;
    if (lastPlaceholder) {
        moveCaretToImagePlaceholderParagraph(editor, lastPlaceholder);
    }

    hasUnsavedChanges = true;
}


function inserirImagemNoEditorAtPlaceholder(files, placeholder, editorId) {
    if (!files || files.length === 0) return;
    if (!placeholder || !placeholder.parentNode) return;
    const editor = document.getElementById(editorId);
    if (!editor) return;

    Array.from(files).forEach(file => {
        if (!file.type.startsWith('image/')) return;
        const reader = new FileReader();
        reader.onload = (e) => {
            const img = document.createElement('img');
            img.src = e.target.result;
            img.style.maxWidth = '100%';
            img.style.height = 'auto';
            img.style.display = 'block';
            img.style.margin = '1rem 0';
            img.style.borderRadius = '0.5rem';

            const p = document.createElement('p');
            p.appendChild(img);
            placeholder.parentNode.insertBefore(p, placeholder);
            placeholder.parentNode.removeChild(placeholder);
            // Optionally remove following blank paragraphs if adjacent

            // keep the editor in focus
            editor.focus();

            // This function is used for placeholder insertion. Do not persist this change automatically (done by save flow)
        };
        reader.readAsDataURL(file);
    });
}

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
const STORAGE_STATE_BACKUP = 'dochub-state-backup';

function getApiBaseUrl() {
    try {
        const configured = (window.DOC_API_BASE_URL || '').trim();
        if (configured) return configured.replace(/\/$/, '');
    } catch (e) {}
    return '';
}

function apiUrl(path = '/') {
    const normalizedPath = path.startsWith('/') ? path : `/${path}`;
    const base = getApiBaseUrl();
    return base ? `${base}${normalizedPath}` : normalizedPath;
}

function getStateBackup() {
    try {
        const raw = localStorage.getItem(STORAGE_STATE_BACKUP);
        if (!raw) return null;
        return JSON.parse(raw);
    } catch (e) {
        return null;
    }
}

function saveStateBackup() {
    try {
        const snapshot = {
            documents: Array.isArray(documentacoes) ? documentacoes : [],
            examples: Array.isArray(exemplos) ? exemplos : [],
            categories: Array.isArray(categorias) ? categorias : [],
            chat: getChatStorageData(),
            ai: sanitizeAiConfigForStorage(aiConfig || { apiKey: '', model: '', provider: '' })
        };
        localStorage.setItem(STORAGE_STATE_BACKUP, JSON.stringify(snapshot));
    } catch (e) {}
}

document.addEventListener('DOMContentLoaded', async () => {
    try {
        await verificarSessao();
    } catch (e) {}
    ensureAppState();
    inicializarEventos();
    inicializarChat();
    // inicializa o editor lateral do chat quando presente
    if (document.getElementById('chatSidebarEditor')) inicializarChatSidebar();
    // Garantir estado do cabeçalho do Chat IA no carregamento:
    try {
        const wasOpen = localStorage.getItem('dochub-chat-editor-open') === 'true';
        const savedTab = localStorage.getItem('dochub-chat-editor-tab') || null;
        if (!wasOpen) {
            // Se o editor está fechado no início, remover quaisquer classes de modo
            document.body.classList.remove('chat-mode-normal');
            document.body.classList.remove('chat-mode-passo');
        } else {
            // Se estava aberto, aplicar o modo salvo ao body para manter cabeçalho coerente
            if (savedTab === 'passo') {
                document.body.classList.add('chat-mode-passo');
                document.body.classList.remove('chat-mode-normal');
            } else {
                document.body.classList.add('chat-mode-normal');
                document.body.classList.remove('chat-mode-passo');
            }
        }
    } catch (e) {}
    criarCategoriasDefault();
    renderizarCategorias();
    atualizarSelectsCategorias();
    atualizarStats();
    filtrarPorCategoria('todos');
    renderizarExemplos();

    // Se a página foi aberta após o chat, restaura a seção anterior sem alterar dados salvos
    try {
        restaurarUltimaSecao();
    } catch (e) { }
    
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

// Garantir restauração final após toda a inicialização (fallback):
window.addEventListener('load', () => {
    try {
        const validSections = ['documentos', 'exemplos', 'adicionar'];
        // prefer hash primeiro
        const hash = (window.location.hash || '').replace('#', '').trim();
        let target = null;
        if (hash && validSections.includes(hash)) target = hash;
        if (!target) {
            const stored = localStorage.getItem('dochub-chat-return-section');
            if (stored && validSections.includes(stored)) target = stored;
        }

        if (target === 'adicionar') {
            // small delay to let other init logic finish and then force the section
            setTimeout(() => {
                try {
                    mudarSecao('adicionar');
                    restaurarRascunhoAdicionar();
                } catch (e) { }
            }, 200);
        }
    } catch (e) { }
});

// Aviso de segurança ao sair da página com mudanças não salvas
window.addEventListener('beforeunload', (e) => {
    // Se a navegação foi intencional pelo app (ex: abrir Chat IA), o fluxo pode
    // suprimir o aviso. Caso contrário, manter o comportamento padrão.
    if (suppressUnsavedWarning) return;
    if (hasUnsavedChanges) {
        e.preventDefault();
        e.returnValue = '';
        return '';
    }
});

// Garantir que o rascunho do sidebar seja salvo ao recarregar/fechar a página
window.addEventListener('beforeunload', () => {
    try { saveChatSidebarDraft(); } catch(e){}
});

// Autosize do textarea do chat: cresce até um limite (responsivo)
function initChatInputAutosize() {
    const input = document.getElementById('chatInput');
    if (!input) return;
    input.style.overflow = 'hidden';
    // calcular altura inicial (visível) e permitir crescimento até +40%
    const computed = window.getComputedStyle(input);
    const initialH = input.clientHeight || parseFloat(computed.height) || 48;
    // limite responsivo: 40% a mais que a altura inicial, mas com teto razoável
    const calcMax = (w) => {
        const preferred = Math.round(initialH * 1.4);
        const screenCap = w < 420 ? Math.max(preferred, 90) : Math.max(preferred, 120);
        // garantir não ultrapassar uma fração da viewport (ex: 30% da altura)
        const viewportCap = Math.round(window.innerHeight * 0.3);
        return Math.min(screenCap, Math.max(preferred, viewportCap));
    };

    const resize = () => {
        input.style.height = 'auto';
        const max = calcMax(window.innerWidth);
        const newH = Math.min(input.scrollHeight, max);
        input.style.height = (newH) + 'px';
    };

    // inicial + handlers
    resize();
    input.addEventListener('input', resize);
    window.addEventListener('resize', resize);
}

document.addEventListener('DOMContentLoaded', () => {
    try {
        ensureAppState();
        initializeAiAutoSetup();
        initChatInputAutosize();
    } catch (e) { console.warn('autosize init failed', e); }
});

async function realizarLogin() {
    mostrarApp();
    await carregarDados();
}

document.addEventListener('DOMContentLoaded', () => {
    const loginButton = document.getElementById('authLoginBtn');
    if (loginButton) {
        loginButton.addEventListener('click', realizarLogin);
    }

    const passwordInput = document.getElementById('authPassword');
    if (passwordInput) {
        passwordInput.addEventListener('keydown', (event) => {
            if (event.key === 'Enter') {
                event.preventDefault();
                realizarLogin();
            }
        });
    }

    const usernameInput = document.getElementById('authUsername');
    if (usernameInput) {
        usernameInput.addEventListener('keydown', (event) => {
            if (event.key === 'Enter') {
                event.preventDefault();
                document.getElementById('authPassword')?.focus();
            }
        });
    }

    const logoutButton = document.getElementById('logoutBtn');
    if (logoutButton) {
        logoutButton.addEventListener('click', async () => {
            mostrarApp();
            await carregarDados();
        });
    }
});

// Legacy bindings removed; login is now wired in the DOMContentLoaded handler above.

// Sanitiza conteúdo colado em editores contenteditable: remove estilos, classes e backgrounds
function sanitizePasteHandler(e) {
    try {
        e.preventDefault();
        const clipboard = (e.clipboardData || window.clipboardData);
        const html = clipboard.getData('text/html');
        const text = clipboard.getData('text/plain');

        // Allow basic formatting tags but strip styles and classes
        const allowedTags = ['b','strong','i','em','u','ul','ol','li','p','br','h1','h2','h3','h4','h5','h6','code','pre','a'];
        const allowedAttrs = ['href','title','alt','src','target'];

        if (html && window.DOMPurify) {
            const clean = DOMPurify.sanitize(html, {ALLOWED_TAGS: allowedTags, ALLOWED_ATTR: allowedAttrs});
            // inserir HTML limpo na posição do cursor
            if (document.queryCommandSupported && document.queryCommandSupported('insertHTML')) {
                document.execCommand('insertHTML', false, clean);
            } else {
                // fallback: usar Range/Selection
                const sel = window.getSelection();
                if (!sel.rangeCount) return;
                sel.deleteFromDocument();
                const range = sel.getRangeAt(0);
                const frag = document.createRange().createContextualFragment(clean);
                range.insertNode(frag);
                range.collapse(false);
            }
        } else if (text) {
            // inserir texto puro (preserva quebras de linha)
            const escaped = text.replace(/\n/g, '<br>');
            if (document.queryCommandSupported && document.queryCommandSupported('insertHTML')) {
                document.execCommand('insertHTML', false, escaped);
            } else {
                const sel = window.getSelection();
                if (!sel.rangeCount) return;
                sel.deleteFromDocument();
                const range = sel.getRangeAt(0);
                const frag = document.createRange().createContextualFragment(escaped);
                range.insertNode(frag);
                range.collapse(false);
            }
        }
    } catch (err) {
        console.warn('sanitizePasteHandler error', err);
    }
}

// Attach paste sanitizer to all contenteditable editors on the page
function attachPasteSanitizers() {
    try {
        const editors = document.querySelectorAll('[contenteditable="true"]');
        editors.forEach(el => {
            // remove possíveis handlers duplicados
            el.removeEventListener('paste', sanitizePasteHandler);
            el.addEventListener('paste', sanitizePasteHandler);
        });
    } catch (e) { }
}

// Attach on DOM ready and whenever sidebar/editor is opened
document.addEventListener('DOMContentLoaded', attachPasteSanitizers);
document.addEventListener('click', () => { setTimeout(attachPasteSanitizers, 60); });

function setModalVisible(modalId, visible) {
    const modal = document.getElementById(modalId);
    if (!modal) return;
    if (visible) {
        // reset saved flag when opening modal (we haven't saved yet)
        if (modalId === 'aiSettingsModal') aiSettingsSaved = false;
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
        // If closing AI settings modal, AUTO-SAVE os prompts atuais (em vez de revert)
        if (modalId === 'aiSettingsModal') {
            autoSaveAISettings();
            // clear the temporary flag for next open
            aiSettingsSaved = false;
        }
    }
}

// Auto-save prompts quando fecha modal ou muda de página (sem perder alterações)
function autoSaveAISettings() {
    try {
        let stored = {};
        const raw = localStorage.getItem(STORAGE_AI);
        if (raw) stored = JSON.parse(raw);
        if (!stored || typeof stored !== 'object') stored = {};

        // Ler todos os campos do modal (se existirem) e atualizar aiConfig
        const apiKeyEl = document.getElementById('aiApiKey');
        const modelEl = document.querySelector('input[name="aiModel"]:checked');
        const summaryPromptEl = document.getElementById('aiSummarySystemPrompt');

        // Manter a API key disponível na UI e na sessão para não perder ao recarregar.
        if (apiKeyEl) {
            const enteredKey = getAiKeyInputValue(apiKeyEl);
            if (enteredKey) {
                stored.apiKey = enteredKey;
                aiConfig.apiKey = enteredKey;
                sessionStorage.setItem('dochub-ai-api-key', enteredKey);
            } else {
                stored.apiKey = aiConfig.apiKey || restoreAiApiKey();
            }
            setAiKeyInputValue(apiKeyEl, enteredKey || aiConfig.apiKey || '', true);
            configureAiKeyInput(apiKeyEl);
        }
        if (modelEl) stored.model = normalizeAiModel(modelEl.value, inferProviderFromModel(modelEl.value));
        if (summaryPromptEl) stored.summarySystemPrompt = (summaryPromptEl.value || '').trim();

        // Infer provider if not set
        if (!stored.provider && stored.model) {
            stored.provider = inferProviderFromModel(stored.model);
        }

        const commandsEl = document.getElementById('aiCommandsList');
        if (commandsEl) {
            stored.commands = collectAiCommandsFromUI();
        }

        // Salvar em background para evitar bloqueio do main-thread.
        const doSave = () => {
            try {
                persistAiConfig({ ...stored, apiKey: aiConfig.apiKey || '' });
                aiConfig = { ...stored, apiKey: aiConfig.apiKey || '' };
            } catch (e) {
                console.error('[ERROR] autoSaveAISettings failed during background save', e);
            }
        };
        if (typeof window !== 'undefined' && 'requestIdleCallback' in window) {
            try { requestIdleCallback(doSave, { timeout: 1000 }); } catch (e) { setTimeout(doSave, 50); }
        } else {
            setTimeout(doSave, 50);
        }
    } catch (e) {
        console.error('[ERROR] autoSaveAISettings failed', e);
    }
}

function getStoredAiCommandsSnapshot() {
    if (aiConfig && typeof aiConfig === 'object' && aiConfig.commands && typeof aiConfig.commands === 'object' && Object.keys(aiConfig.commands).length) {
        return aiConfig.commands;
    }
    try {
        const raw = localStorage.getItem(STORAGE_AI);
        if (!raw) return {};
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object' && parsed.commands && typeof parsed.commands === 'object') {
            return parsed.commands;
        }
    } catch (e) {}
    return {};
}

function collectAiCommandsFromUI() {
    const rows = document.querySelectorAll('.ai-command-row');
    const commands = {};
    rows.forEach(row => {
        const nameEl = row.querySelector('.ai-command-name');
        const promptEl = row.querySelector('.ai-command-prompt');
        if (!nameEl || !promptEl) return;

        let name = (nameEl.value || '').trim().replace(/^@/, '');
        const prompt = (promptEl.value || '').trim();
        if (!name || !prompt) return;

        name = name.toLowerCase();
        commands[name] = prompt;
    });
    return commands;
}

function renderAiCommandsUI() {
    const container = document.getElementById('aiCommandsList');
    if (!container) return;
    container.innerHTML = '';

    const commands = getStoredAiCommandsSnapshot();
    const entries = Object.entries(commands).sort((a, b) => a[0].localeCompare(b[0]));

    if (entries.length === 0) {
        const helper = document.createElement('div');
        helper.style = 'color:var(--text-secondary);padding:12px 0;';
        helper.textContent = 'Nenhum comando salvo ainda. Clique em + Novo Comando para adicionar um comando @.';
        container.appendChild(helper);
        return;
    }

    entries.forEach(([name, prompt]) => addAiCommandRow(name, prompt));
}

function addAiCommandRow(name = '', prompt = '') {
    const container = document.getElementById('aiCommandsList');
    if (!container) return;

    const row = document.createElement('div');
    row.className = 'ai-command-row';

    const topRow = document.createElement('div');
    topRow.className = 'ai-command-top';

    const nameWrapper = document.createElement('div');
    nameWrapper.className = 'ai-command-name-wrapper';
    const nameField = document.createElement('div');
    nameField.className = 'ai-command-field';
    const prefix = document.createElement('span');
    prefix.className = 'ai-command-prefix';
    prefix.textContent = '@';
    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.className = 'ai-command-name ai-command-input';
    nameInput.value = name.replace(/^@/, '');
    nameInput.placeholder = 'duvida';
    nameField.appendChild(prefix);
    nameField.appendChild(nameInput);
    nameWrapper.appendChild(nameField);

    const deleteButton = document.createElement('button');
    deleteButton.type = 'button';
    deleteButton.className = 'ai-command-delete-btn';
    deleteButton.textContent = '✕';
    deleteButton.title = 'Excluir comando';
    deleteButton.setAttribute('aria-label', 'Excluir comando');
    deleteButton.addEventListener('click', () => {
        row.remove();
        autoSaveAISettings();
    });

    topRow.appendChild(nameWrapper);
    topRow.appendChild(deleteButton);

    const promptWrapper = document.createElement('div');
    promptWrapper.className = 'ai-command-prompt-wrapper';
    const promptTextarea = document.createElement('textarea');
    promptTextarea.className = 'ai-command-prompt ai-command-textarea';
    promptTextarea.rows = 5;
    promptTextarea.value = prompt;
    promptTextarea.placeholder = 'Escreva o prompt completo que a IA deve usar quando este comando for acionado.';
    promptTextarea.addEventListener('input', debounce(() => autoSaveAISettings(), 500));
    nameInput.addEventListener('input', debounce(() => autoSaveAISettings(), 500));
    promptWrapper.appendChild(promptTextarea);

    row.appendChild(topRow);
    row.appendChild(promptWrapper);
    container.appendChild(row);
}

function saveAiCommandsConfig() {
    if (!aiConfig || typeof aiConfig !== 'object') aiConfig = {};
    aiConfig.commands = collectAiCommandsFromUI();
    aiConfig.apiKey = '';
    const safeConfig = sanitizeAiConfigForStorage(aiConfig);
    safeConfig.apiKey = undefined;
    localStorage.setItem(STORAGE_AI, JSON.stringify(safeConfig));
    showToast('✅ Comandos salvos!', 'success');
}

function getAiCommandPrompt(commandName) {
    if (!commandName) return null;
    const commands = getStoredAiCommandsSnapshot();
    return commands[commandName.toLowerCase()] || null;
}

function parseAiCommandFromText(text) {
    if (!text || typeof text !== 'string') return { commandName: null, cleanedText: text };
    const trimmed = text.trim();
    const match = trimmed.match(/^@([\p{L}\p{N}_-]+)\s*(.*)$/u);
    if (!match) return { commandName: null, cleanedText: text };
    return { commandName: match[1].toLowerCase(), cleanedText: (match[2] || '').trim() };
}

function extractAiCommandNamesFromText(text) {
    if (!text || typeof text !== 'string') return [];
    const regex = /@([\p{L}\p{N}_-]+)/gu;
    const names = [];
    let match;
    while ((match = regex.exec(text)) !== null) {
        names.push(match[1].toLowerCase());
    }
    return names;
}

function removeAiCommandTokens(text) {
    if (!text || typeof text !== 'string') return text;
    return text.replace(/@([\w-]+)\b/g, '').replace(/\s+/g, ' ').trim();
}

function removeAiCommandTokensFromList(text, commandNames) {
    if (!text || typeof text !== 'string' || !Array.isArray(commandNames) || !commandNames.length) {
        return text;
    }
    const escaped = commandNames
        .filter(Boolean)
        .map(name => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
        .join('|');
    if (!escaped) return text;
    const regex = new RegExp(`@(?:${escaped})\\b`, 'gi');
    return text.replace(regex, '').replace(/\s+/g, ' ').trim();
}

function getActiveChatPrompts() {
    const commands = getStoredAiCommandsSnapshot();
    return activeChatCommandNames
        .map(name => ({ name, prompt: commands[name] }))
        .filter(item => item.prompt);
}

function addActiveChatCommands(names) {
    const normalized = names
        .filter(Boolean)
        .map(name => name.toLowerCase())
        .filter(name => !!getAiCommandPrompt(name));
    // Manter apenas 1 comando @ por vez (substituir o anterior)
    if (normalized.length > 0) {
        activeChatCommandNames = [normalized[0]];
    }
    updateActivePromptChips();
}

function removeActiveChatCommand(name) {
    activeChatCommandNames = activeChatCommandNames.filter(cmd => cmd !== name.toLowerCase());
    updateActivePromptChips();
}

function updateActivePromptChips() {
    const wrapper = document.getElementById('activePromptsWrapper');
    const list = document.getElementById('activePromptsList');
    if (!wrapper || !list) return;
    list.innerHTML = '';
    if (!activeChatCommandNames.length) {
        wrapper.style.display = 'none';
        return;
    }
    wrapper.style.display = 'flex';
    activeChatCommandNames.forEach(name => {
        const chip = document.createElement('div');
        chip.className = 'active-prompt-chip';
        const icon = document.createElement('span');
        icon.className = 'active-prompt-chip-icon';
        icon.textContent = '@';
        const label = document.createElement('span');
        label.className = 'active-prompt-chip-label';
        label.textContent = name;
        const removeBtn = document.createElement('button');
        removeBtn.type = 'button';
        removeBtn.textContent = '✕';
        removeBtn.addEventListener('click', () => removeActiveChatCommand(name));
        chip.appendChild(icon);
        chip.appendChild(label);
        chip.appendChild(removeBtn);
        list.appendChild(chip);
    });
}

function getChatCommandsOverridePrompt() {
    const prompts = getActiveChatPrompts();
    if (!prompts.length) return null;
    return [
        'INSTRUÇÃO OBRIGATÓRIA - SIGA ESTES PROMPTS DE COMANDO:'.trim(),
        ...prompts.map(item => `PROMPT @${item.name}:\n${item.prompt}`),
        '',
        'REGRAS DE APLICAÇÃO (OBRIGATÓRIAS):',
        '1) Use as instruções acima como prioridade máxima.',
        '2) Responda em português de forma objetiva.',
        '3) Não ignore os prompts ativos mesmo quando a pergunta do usuário for ampla.'
    ].join('\n');
}

/* ========== CHAT SIDEBAR EDITOR ========== */
function inicializarChatSidebar() {
    // elementos
    const tabNormal = document.getElementById('editorTabNormal');
    const tabPasso = document.getElementById('editorTabPasso');
    const sidebar = document.getElementById('chatSidebarEditor');
    const chatContainer = document.querySelector('.chat-container');
    const chatWrapper = document.querySelector('.chat-wrapper');
    const contentEl = document.getElementById('chatEditContent');
    const passoEl = document.getElementById('chatEditPassoContent');
    // createPassoWrapper removed from UI; keep reference in case other code checks it
    const createPassoWrapper = document.getElementById('createPassoWrapper');
    const passoResumoWrapper = document.getElementById('passoResumoWrapper');
    const passoResumoBtn = document.getElementById('passoResumoBtn');
    const saveBtn = document.getElementById('chatEditorSaveBtn');

    // Restaurar aba salva para aplicar modo no chatContainer somente se o editor já estiver aberto
    try {
        const savedTab = localStorage.getItem('dochub-chat-editor-tab') || 'normal';
        // Aplicar o último modo selecionado de forma idempotente para sidebar, chatContainer e chatWrapper
        if (savedTab === 'passo') {
            if (sidebar) { sidebar.classList.add('passo-mode'); sidebar.classList.remove('normal-mode'); }
            if (chatContainer) { chatContainer.classList.add('passo-mode'); chatContainer.classList.remove('normal-mode'); }
            if (chatWrapper) { chatWrapper.classList.add('passo-mode'); chatWrapper.classList.remove('normal-mode'); }
            if (contentEl && passoEl) { contentEl.style.display = 'none'; passoEl.style.display = ''; }
            if (tabPasso) { tabPasso.classList.add('active'); if (tabNormal) tabNormal.classList.remove('active'); }
            try { document.body.classList.add('chat-mode-passo'); document.body.classList.remove('chat-mode-normal'); } catch(e){}
            try { if (passoResumoWrapper) passoResumoWrapper.style.display = ''; } catch(e){}
        } else {
            if (sidebar) { sidebar.classList.add('normal-mode'); sidebar.classList.remove('passo-mode'); }
            if (chatContainer) { chatContainer.classList.add('normal-mode'); chatContainer.classList.remove('passo-mode'); }
            if (chatWrapper) { chatWrapper.classList.add('normal-mode'); chatWrapper.classList.remove('passo-mode'); }
            if (contentEl && passoEl) { contentEl.style.display = ''; passoEl.style.display = 'none'; }
            if (tabNormal) { tabNormal.classList.add('active'); if (tabPasso) tabPasso.classList.remove('active'); }
            try { document.body.classList.add('chat-mode-normal'); document.body.classList.remove('chat-mode-passo'); } catch(e){}
            try { if (passoResumoWrapper) passoResumoWrapper.style.display = 'none'; } catch(e){}
        }
    } catch (e) {}

    // função que mostra/oculta botão Resumir baseado no conteúdo dos editores
    function updateCreatePassoButton() {
        try {
            const normalText = contentEl ? (contentEl.innerText || '').trim() : '';
            const passoText = passoEl ? (passoEl.innerText || '').trim() : '';

            // Se houver qualquer coisa no Passo a Passo, o botão fica desabilitado
            if (passoText && passoResumoBtn) {
                passoResumoWrapper.style.display = '';
                passoResumoBtn.disabled = true;
                passoResumoBtn.classList.add('disabled');
                return;
            }

            // Mostrar o botão habilitado se houver qualquer texto no Normal e não houver texto em Passo
            if (normalText && passoResumoWrapper) {
                passoResumoWrapper.style.display = '';
                if (passoResumoBtn) {
                    passoResumoBtn.disabled = false;
                    passoResumoBtn.classList.remove('disabled');
                }
            } else if (passoResumoWrapper) {
                passoResumoWrapper.style.display = 'none';
                if (passoResumoBtn) {
                    passoResumoBtn.disabled = false;
                    passoResumoBtn.classList.remove('disabled');
                }
            }
        } catch (e) {}
    }

    // antigo: função criarPassoAPartirDoNormal removida conforme solicitado

    if (passoResumoBtn) {
        passoResumoBtn.addEventListener('click', () => {
            try {
                if (isChatThinking) return showToast('A IA está processando. Aguarde...', 'warning');
                const normalText = contentEl ? (contentEl.innerText || '').trim() : '';
                const passoText = passoEl ? (passoEl.innerText || '').trim() : '';

                if (passoText) return showToast('O resumo está desativado enquanto houver conteúdo em Passo a Passo.', 'warning');
                if (!normalText) return showToast('Nenhum conteúdo em Normal para resumir.', 'warning');

                const normalHtml = contentEl ? (contentEl.innerHTML || '').trim() : '';
                const normalPlain = contentEl ? (contentEl.innerText || contentEl.textContent || '').trim() : '';

                const RESUMIR_PROMPT_DEFAULT = `Considere como DOCUMENTAÇÃO todo texto que descreva um procedimento funcional de sistema ou aplicativo. Ignore apenas instruções sobre como você deve responder. Sua tarefa é REESTRUTURAR o conteúdo mantendo integralmente todas as informações operacionais. Remover exclusivamente: Frases explicativas que não alteram a execução. Comentários descritivos. Observações condicionais que não exigem ação direta. Resultados esperados após a ação. Manter obrigatoriamente: Comandos Campos Valores Datas Identificadores Parâmetros Textos entre aspas Informações após dois pontos (:) Sequência original REGRA CRÍTICA DE PRESERVAÇÃO ADICIONAL: Qualquer linha que contenha pelo menos um dos elementos abaixo deve ser mantida obrigatoriamente, mesmo que pareça explicativa: Dois pontos (:) Texto entre aspas Números Datas Valores monetários Códigos Identificadores técnicos Nome de botão Nome de campo Nome de aba Nome de menu Nome de tela Status Tipo Diretório Nunca remover uma linha que contenha qualquer um desses elementos. Não resumir. Não simplificar. Não reorganizar. Não alterar a ordem. Não inferir. Não inventar etapas. Nunca transformar instruções deste prompt em conteúdo da saída. REGRA OBRIGATÓRIA PARA TÍTULOS Sempre que encontrar uma linha que represente uma seção, inclusive linhas iniciadas por: TEXTO ORIGINAL DA SEÇÃO Você deve: Remover completamente a expressão "TEXTO ORIGINAL DA SEÇÃO". Manter apenas o nome real da seção. Converter obrigatoriamente para o formato de título utilizando # correspondente. Todos os títulos devem estar sublinhados utilizando <u> </u>. Exemplo obrigatório de transformação: TEXTO ORIGINAL DA SEÇÃO ACESSO AO PERFIL DIGITAL Deve se tornar exatamente: <u>ACESSO AO PERFIL DIGITAL</u> Nunca manter o prefixo original. Nunca ignorar a transformação. Nunca manter o título em formato simples. REGRAS ADICIONAIS PARA NÍVEIS DE TÍTULO: Todo título principal deve estar no formato ## e totalmente sublinhado. Todo subtítulo deve estar obrigatoriamente no formato ###, totalmente sublinhado e em negrito. Qualquer linha convertida para formato com #, independentemente do nível, deve estar sublinhada. Nunca retornar títulos sem sublinhado. Nunca retornar subtítulos sem negrito e sublinhado. REGRAS DE FORMATAÇÃO Todo texto entre aspas deve: Permanecer com aspas Estar totalmente em negrito Todo valor que apareça após dois pontos (:) deve estar em negrito. Elementos interativos também devem estar em negrito, incluindo: Botões Abas Itens selecionáveis Campos Valores digitados Diretórios Tipos Status ESTRUTURA OBRIGATÓRIA: Uma única ação ou informação operacional por linha. Não inserir linha em branco entre ações consecutivas. Inserir exatamente uma única linha em branco após cada título. Nunca juntar múltiplas ações na mesma linha. Nunca retornar o conteúdo em bloco único. FORMATO FINAL Títulos obrigatoriamente no formato ## ou ### conforme hierarquia identificada. Todos os títulos devem estar sublinhados. Subtítulos devem estar em negrito e sublinhados. Inserir exatamente uma linha em branco após cada título. Conteúdo abaixo do título correspondente, com uma ação por linha. Não inserir linhas em branco adicionais entre as ações. Nada além do conteúdo estruturado. Se não houver ações funcionais, responder exatamente: Nenhuma interação identificada.`;

                // abre modal de prompt específico para resumir
                const modal = document.createElement('div');
                modal.id = 'resumirModal';
                modal.style.position = 'fixed';
                modal.style.inset = '0';
                modal.style.display = 'flex';
                modal.style.alignItems = 'center';
                modal.style.justifyContent = 'center';
                modal.style.background = 'rgba(0,0,0,0.32)';
                modal.style.zIndex = '99999';

                const box = document.createElement('div');
                box.style.background = 'var(--surface, #ffffff)';
                box.style.color = 'var(--text-primary, #111827)';
                box.style.padding = '12px';
                box.style.borderRadius = '8px';
                box.style.width = 'min(780px, 92%)';
                box.style.maxHeight = '80vh';
                box.style.overflow = 'auto';
                box.style.boxShadow = '0 10px 30px rgba(2,6,23,0.2)';

                const title = document.createElement('div');
                title.textContent = 'Prompt de Resumir (edição local)';
                title.style.fontWeight = '600';
                title.style.marginBottom = '8px';

                const ta = document.createElement('textarea');
                ta.id = 'resumirPromptTextarea';
                ta.value = RESUMIR_PROMPT_DEFAULT;
                ta.style.width = '100%';
                ta.style.height = '280px';
                ta.style.padding = '8px';
                ta.style.border = '1px solid rgba(0,0,0,0.08)';
                ta.style.borderRadius = '6px';
                ta.style.resize = 'vertical';

                const actions = document.createElement('div');
                actions.style.display = 'flex';
                actions.style.justifyContent = 'flex-end';
                actions.style.gap = '8px';
                actions.style.marginTop = '8px';

                const btnCancel = document.createElement('button');
                btnCancel.textContent = 'Cancelar';
                btnCancel.className = 'btn';
                btnCancel.style.padding = '8px 10px';

                const btnConfirm = document.createElement('button');
                btnConfirm.textContent = 'Executar';
                btnConfirm.className = 'btn btn-primary';
                btnConfirm.style.padding = '8px 10px';

                actions.appendChild(btnCancel);
                actions.appendChild(btnConfirm);

                box.appendChild(title);
                box.appendChild(ta);
                box.appendChild(actions);
                modal.appendChild(box);
                document.body.appendChild(modal);

                function closeModal() { try { modal.remove(); } catch(e){} }

                btnCancel.addEventListener('click', (ev) => { ev.preventDefault(); closeModal(); });
                btnConfirm.addEventListener('click', (ev) => {
                    try {
                        ev.preventDefault();
                        const summaryPromptText = String(ta.value || '').trim();
                        closeModal();

                        // Enviar usando somente o prompt de resumo (override) sem tocar no system prompt global
                        const chatInput = document.getElementById('chatInput');
                        if (!chatInput) {
                            appendChatMessage('user', normalHtml, true);
                            showToast('Conteúdo enviado ao chat (local).', 'success');
                        } else {
                            chatInput.value = normalPlain;
                            nextBotMessageIsResume = true;
                            enviarMensagemChat(summaryPromptText);

                            setTimeout(() => {
                                try {
                                    const msgs = getChatMessages();
                                    for (let i = msgs.length - 1; i >= 0; i--) {
                                        if (msgs[i].role === 'user') {
                                            msgs[i].content = normalHtml;
                                            msgs[i].html = true;
                                            msgs[i].isUserResumeInput = true;
                                            break;
                                        }
                                    }
                                    saveChatHistory(msgs);
                                    renderChatMessages(msgs);
                                } catch (e) { console.warn('Erro ao substituir mensagem por HTML', e); }
                            }, 80);
                        }
                        showToast('Conteúdo enviado ao chat.', 'success');
                    } catch (err) { console.warn('resumir execute error', err); }
                });

            } catch (e) { console.warn('passoResumo erro', e); }
        });
    }

    // observar mudanças nos editors para atualizar visibilidade do botão
    try {
        const obsConfig = { childList: true, subtree: true, characterData: true };
        // Proteção: evitar que a edição em Passo a Passo reflita automaticamente no Normal.
        let blockNormalUpdateWhenTypingPasso = false;
        let normalContentBackup = '';
        let _passoTypingTimeout = null;
        let passoTypedAt = 0;

            if (passoEl) {
            const moPasso = new MutationObserver(() => updateCreatePassoButton());
            moPasso.observe(passoEl, obsConfig);
            passoEl.addEventListener('input', (ev) => {
                try {
                    // marcar que o usuário está digitando em Passo — bloquear updates auto no Normal
                    blockNormalUpdateWhenTypingPasso = true;
                    // guardar backup do Normal atual para restaurar se necessário
                    if (contentEl) normalContentBackup = contentEl.innerHTML || '';
                    // record timestamp para detectar mutações subsequentes no Normal
                    try { passoTypedAt = Date.now(); } catch(e){}
                    // limpar timeout anterior
                    try { clearTimeout(_passoTypingTimeout); } catch(e){}
                    _passoTypingTimeout = setTimeout(() => { blockNormalUpdateWhenTypingPasso = false; }, 1200);
                } catch (e) {}
                updateCreatePassoButton(ev);
            });
            passoEl.addEventListener('input', debounce(saveChatSidebarDraft, 300));
            // também backup do Normal quando o usuário apenas focar no Passo
            passoEl.addEventListener('focus', () => {
                try { if (contentEl) normalContentBackup = contentEl.innerHTML || ''; } catch(e){}
            });
        }

        if (contentEl) {
            const moContent = new MutationObserver((mutations) => {
                try {
                    // Se o usuário editou Passo recentemente e o Normal foi modificado
                    // para se tornar igual ao Passo, reverter para o backup.
                    if (passoTypedAt && (Date.now() - passoTypedAt) < 3000 && passoEl) {
                        const passoHtml = (passoEl.innerHTML || '').trim();
                        const contentHtml = (contentEl.innerHTML || '').trim();
                        if (contentHtml === passoHtml) {
                            try { contentEl.innerHTML = normalContentBackup || ''; } catch(e){}
                        }
                    }
                } catch (e) {}
                updateCreatePassoButton();
            });
            moContent.observe(contentEl, obsConfig);
            contentEl.addEventListener('input', updateCreatePassoButton);
            contentEl.addEventListener('input', debounce(saveChatSidebarDraft, 300));
        }
    } catch (e) {}

    // inicializar visibilidade do botão Resumir
    updateCreatePassoButton();

    // carregar prefill (pode conter docId)
    try {
        const raw = localStorage.getItem('dochub-chat-prefill');
        let docId = null;
        if (raw) {
            const obj = JSON.parse(raw);
            docId = obj.docId || null;
        }
        // se não houver docId, usar currentEditingId (se houver)
        if (!docId && typeof currentEditingId !== 'undefined' && currentEditingId) docId = currentEditingId;
        if (docId) carregarDocNoSidebar(docId);
        // carregar rascunho salvo do sidebar (restaurará edições não salvas para o mesmo doc)
        try { loadChatSidebarDraft(); } catch(e){}
    } catch (e) {}

    tabNormal?.addEventListener('click', () => {
        tabNormal.classList.add('active'); tabPasso.classList.remove('active');
        contentEl.style.display = ''; passoEl.style.display = 'none';
        localStorage.setItem('dochub-chat-editor-tab', 'normal');
        // marcar sidebar como modo normal (para estilização externa)
        if (sidebar) {
            sidebar.classList.add('normal-mode');
            sidebar.classList.remove('passo-mode');
        }
        // aplicar modo ao elemento do chat (mensagens + input) e ao wrapper
        if (chatContainer) {
            chatContainer.classList.add('normal-mode');
            chatContainer.classList.remove('passo-mode');
        }
        if (chatWrapper) {
            chatWrapper.classList.add('normal-mode');
            chatWrapper.classList.remove('passo-mode');
        }
        try { document.body.classList.add('chat-mode-normal'); document.body.classList.remove('chat-mode-passo'); } catch(e){}
        try { if (passoResumoWrapper) passoResumoWrapper.style.display = 'none'; } catch(e){}
    });
    tabPasso?.addEventListener('click', () => {
        tabPasso.classList.add('active'); tabNormal.classList.remove('active');
        passoEl.style.display = ''; contentEl.style.display = 'none';
        localStorage.setItem('dochub-chat-editor-tab', 'passo');
        if (sidebar) {
            sidebar.classList.add('passo-mode');
            sidebar.classList.remove('normal-mode');
        }
        if (chatContainer) {
            chatContainer.classList.add('passo-mode');
            chatContainer.classList.remove('normal-mode');
        }
        if (chatWrapper) {
            chatWrapper.classList.add('passo-mode');
            chatWrapper.classList.remove('normal-mode');
        }
        try { document.body.classList.add('chat-mode-passo'); document.body.classList.remove('chat-mode-normal'); } catch(e){}
        try { if (passoResumoWrapper) passoResumoWrapper.style.display = ''; } catch(e){}
    });

    // Função auxiliar para salvar documentações (reutilizada por múltiplos botões)
    function saveDocumentationFromChat() {
        try {
            const rawDocs = localStorage.getItem(STORAGE_DOCS);
            const docs = rawDocs ? JSON.parse(rawDocs) : [];
            // identificar docId: pref de chat prefill ou currentChatOrigin
            let docId = null;
            const pre = localStorage.getItem('dochub-chat-prefill');
            if (pre) {
                try { const obj = JSON.parse(pre); docId = obj.docId || null; } catch(e) { }
            }
            if (!docId && currentChatOrigin && currentChatOrigin.docId) docId = currentChatOrigin.docId;
            if (!docId && currentEditingId) docId = currentEditingId;

            const normalEditor = document.getElementById('chatEditContent');
            const passoEditor = document.getElementById('chatEditPassoContent');
            const normalHtml = normalEditor ? normalEditor.innerHTML : '';
            const passoHtml = passoEditor ? passoEditor.innerHTML : '';

            // Se não houver docId, salvar no rascunho atual (não criar nova documentação)
            if (!docId) {
                try {
                    // garantir que a sidebar seja salva primeiro
                    try { saveChatSidebarDraft(); } catch (e) { }

                    let draft = null;
                    const rawDraft = localStorage.getItem(STORAGE_SIDEBAR_DRAFT);
                    if (rawDraft) {
                        try { draft = JSON.parse(rawDraft); } catch(e) { draft = null; }
                    }

                    // Se ainda não houver draft, reconstruir do prefill
                    if (!draft) {
                        const pre = localStorage.getItem('dochub-chat-prefill');
                        if (pre) {
                            try {
                                const p = JSON.parse(pre);
                                draft = {
                                    docId: p.docId || null,
                                    title: p.title || '',
                                    description: p.description || '',
                                    type: p.type || (p.isPasso ? 'passo-a-passo' : 'normal'),
                                    content: p.content || '',
                                    passo: p.passo || '',
                                    tags: p.tags || '',
                                    ts: Date.now()
                                };
                            } catch(_) {
                                draft = null;
                            }
                        }
                    }

                    // Se ainda não houver rascunho, tentar salvar diretamente dos campos de adicionar se presentes
                    if (!draft) {
                        const titleEl = document.getElementById('docTitle');
                        const descEl = document.getElementById('docDescription');
                        const typeEl = document.getElementById('docType');
                        const contentEl = document.getElementById('docContent');
                        const passoEl = document.getElementById('docPassoContent');
                        const tagsEl = document.getElementById('docTags');
                        draft = {
                            docId: null,
                            title: titleEl ? String(titleEl.value || '') : '',
                            description: descEl ? String(descEl.value || '') : '',
                            type: typeEl ? String(typeEl.value || 'normal') : 'normal',
                            content: contentEl ? (contentEl.innerHTML || '') : '',
                            passo: passoEl ? (passoEl.innerHTML || '') : '',
                            tags: tagsEl ? String(tagsEl.value || '') : '',
                            ts: Date.now()
                        };
                    }

                    if (!draft) {
                        draft = {
                            docId: null,
                            title: '',
                            description: '',
                            type: 'normal',
                            content: '',
                            passo: '',
                            tags: '',
                            ts: Date.now()
                        };
                    }

                    // Atualizar campos conhecidos do draft com base no prefill e chat
                    try {
                        const pre = localStorage.getItem('dochub-chat-prefill');
                        if (pre) {
                            const p = JSON.parse(pre);
                            if (p.title) draft.title = p.title;
                            if (p.description) draft.description = p.description;
                            if (p.tags) draft.tags = p.tags;
                            if (p.type) draft.type = p.type;
                            if (p.isPasso && !draft.type) draft.type = 'passo-a-passo';
                        }
                    } catch (e) { }

                    const docTitleEl = document.getElementById('docTitle');
                    const docDescEl = document.getElementById('docDescription');
                    const docTypeEl = document.getElementById('docType');
                    const docContentEl = document.getElementById('docContent');
                    const docPassoEl = document.getElementById('docPassoContent');
                    const docTagsEl = document.getElementById('docTags');

                    if (docTitleEl && docTitleEl.value.trim().length > 0) {
                        draft.title = String(docTitleEl.value || '');
                    }
                    if (docDescEl && docDescEl.value.trim().length > 0) {
                        draft.description = String(docDescEl.value || '');
                    }
                    if (docTagsEl && docTagsEl.value.trim().length > 0) {
                        draft.tags = String(docTagsEl.value || '');
                    }
                    if (docTypeEl && String(docTypeEl.value).trim() !== '') {
                        draft.type = String(docTypeEl.value);
                    }
                    if (docContentEl && docContentEl.innerHTML.trim().length > 0) {
                        draft.content = docContentEl.innerHTML;
                    }
                    if (docPassoEl && docPassoEl.innerHTML.trim().length > 0) {
                        draft.passo = docPassoEl.innerHTML;
                    }

                    const currentTab = localStorage.getItem('dochub-chat-editor-tab') || 'normal';
                    // Prefer values from the Add form if present (docContent/docPassoContent),
                    // otherwise use what's in the chat editors (normalHtml/passoHtml).
                    try {
                        const addNormalEl = document.getElementById('docContent');
                        const addPassoEl = document.getElementById('docPassoContent');
                        const addNormal = addNormalEl ? (addNormalEl.innerHTML || '').trim() : '';
                        const addPasso = addPassoEl ? (addPassoEl.innerHTML || '').trim() : '';
                        if (addNormal && addNormal.length > 0) {
                            draft.content = addNormalEl.innerHTML;
                        } else if (normalHtml && normalHtml.trim().length > 0) {
                            draft.content = normalHtml;
                        }
                        if (addPasso && addPasso.length > 0) {
                            draft.passo = addPassoEl.innerHTML;
                        } else if (passoHtml && passoHtml.trim().length > 0) {
                            draft.passo = passoHtml;
                        }
                    } catch (e) {
                        if (normalHtml && normalHtml.trim().length > 0) draft.content = normalHtml;
                        if (passoHtml && passoHtml.trim().length > 0) draft.passo = passoHtml;
                    }
                    if (!draft.type) {
                        draft.type = (currentTab === 'passo') ? 'passo-a-passo' : 'normal';
                    }
                    draft.ts = Date.now();
                    localStorage.setItem(STORAGE_SIDEBAR_DRAFT, JSON.stringify(draft));
                    // backups and compatibility keys
                    try { localStorage.setItem('dochub-debug-last-saved-draft', JSON.stringify(draft)); } catch(e) {}
                    try { localStorage.setItem('dochub-chat-sidebar-draft-v2', JSON.stringify(draft)); } catch(e) {}
                    // also set a prefill so chat opener / index can restore more reliably
                    try {
                        const prefillForIndex = { docId: draft.docId || null, title: draft.title || '', description: draft.description || '', content: draft.content || '', passo: draft.passo || '', tags: draft.tags || '', type: draft.type || 'normal', isPasso: (draft.type === 'passo-a-passo') };
                        localStorage.setItem('dochub-chat-prefill', JSON.stringify(prefillForIndex));
                    } catch(e) {}
                    // also store a dedicated return payload so index.html can immediately restore when returning
                    try {
                        const returnPayload = { title: draft.title || '', description: draft.description || '', content: draft.content || '', passo: draft.passo || '', tags: draft.tags || '', type: draft.type || 'normal' };
                        localStorage.setItem('dochub-chat-return-payload', JSON.stringify(returnPayload));
                        try { sessionStorage.setItem('dochub-chat-session-return-payload', JSON.stringify(returnPayload)); } catch(e) {}
                    } catch(e) {}
                    try { if (typeof salvarDados === 'function') salvarDados(); } catch(e) {}

                    localStorage.setItem('dochub-chat-return-section', 'adicionar');
                    localStorage.setItem('dochub-chat-returning-from-adicionar', 'true');

                    chatSavedSinceOpen = true;
                    hasUnsavedChanges = false;
                    showToast('✅ Rascunho atualizado com sucesso!', 'success');

                    setTimeout(() => {
                        if (window.location.pathname.toLowerCase().endsWith('chat.html')) {
                            navigateToMainApp(localStorage.getItem('dochub-chat-return-section') || 'adicionar');
                        } else {
                            mudarSecao('adicionar');
                            try { restaurarRascunhoAdicionar(); } catch(e) {}
                        }
                    }, 120);
                    return;
                } catch(e) {
                    console.error('Erro ao salvar rascunho no chat', e);
                    return showToast('❌ Falha ao salvar rascunho', 'error');
                }
            }

            const idx = docs.findIndex(d => String(d.id) === String(docId) || d.id === docId);
            if (idx === -1) return showToast('❌ Documento não encontrado', 'error');

            const docToSave = docs[idx];
            const addNormalEl = document.getElementById('docContent');
            const addPassoEl = document.getElementById('docPassoContent');
            const editTitleEl = document.getElementById('editDocTitle');
            const editDescEl = document.getElementById('editDocDescription');
            const editTagsEl = document.getElementById('editDocTags');
            const editCategoryEl = document.getElementById('editDocCategory');
            const addTitleEl = document.getElementById('docTitle');
            const addDescEl = document.getElementById('docDescription');
            const addTagsEl = document.getElementById('docTags');
            const addTypeEl = document.getElementById('docType');
            const storedNormal = docToSave.conteudo || '';
            const storedPasso = docToSave.conteudoPasso || '';
            const hasAddNormal = addNormalEl && addNormalEl.innerHTML && addNormalEl.innerHTML.trim().length > 0;
            const hasAddPasso = addPassoEl && addPassoEl.innerHTML && addPassoEl.innerHTML.trim().length > 0;
            const hasChatNormal = normalHtml && normalHtml.trim().length > 0;
            const hasChatPasso = passoHtml && passoHtml.trim().length > 0;

            // Prefer the richest available source for each side while preserving any existing content
            // if the chat editors are empty. This avoids clearing one version when only the other was edited.
            const finalNormal = hasAddNormal ? addNormalEl.innerHTML : (hasChatNormal ? normalHtml : storedNormal);
            const finalPasso = hasAddPasso ? addPassoEl.innerHTML : (hasChatPasso ? passoHtml : storedPasso);

            // Update the real document record, including visible metadata from either the edit or add form.
            if (editTitleEl && String(editTitleEl.value || '').trim()) {
                docToSave.titulo = String(editTitleEl.value || '');
            } else if (addTitleEl && String(addTitleEl.value || '').trim()) {
                docToSave.titulo = String(addTitleEl.value || '');
            }
            if (editDescEl && String(editDescEl.value || '').trim()) {
                docToSave.descricao = String(editDescEl.value || '');
            } else if (addDescEl && String(addDescEl.value || '').trim()) {
                docToSave.descricao = String(addDescEl.value || '');
            }
            if (editTagsEl && String(editTagsEl.value || '').trim()) {
                const tags = String(editTagsEl.value || '').split(',').map(t => t.trim()).filter(Boolean);
                docToSave.tags = tags;
            } else if (addTagsEl && String(addTagsEl.value || '').trim()) {
                const tags = String(addTagsEl.value || '').split(',').map(t => t.trim()).filter(Boolean);
                docToSave.tags = tags;
            }
            if (editCategoryEl && String(editCategoryEl.value || '').trim()) {
                docToSave.categoria = String(editCategoryEl.value || '');
            }
            if (addTypeEl && String(addTypeEl.value || '').trim()) {
                docToSave.type = String(addTypeEl.value || '');
            }
            docToSave.conteudo = finalNormal;
            docToSave.conteudoPasso = finalPasso;
            docToSave.dataAtualizacao = new Date().toLocaleDateString('pt-BR');

            docs[idx] = docToSave;
            localStorage.setItem(STORAGE_DOCS, JSON.stringify(docs));
            // atualizar in-memory e refletir imediatamente na interface
            documentacoes = docs;
            try {
                atualizarSelectsCategorias();
                if (typeof filtrarPorCategoria === 'function') {
                    filtrarPorCategoria(currentSelectedCategory || 'todos');
                } else {
                    renderizarDocumentacoes(documentacoes);
                }
                atualizarStats();
            } catch (e) {}
            // remover rascunho salvo para este documento e substituir pelo conteúdo recém-salvo
            try {
                const rawDraft = localStorage.getItem(STORAGE_SIDEBAR_DRAFT);
                if (rawDraft) {
                    const d = JSON.parse(rawDraft);
                    if (String(d.docId || '') === String(docId || '')) {
                        localStorage.removeItem(STORAGE_SIDEBAR_DRAFT);
                    }
                }
            } catch(e){}
            try {
                const returnPayload = {
                    title: docToSave.titulo || '',
                    description: docToSave.descricao || '',
                    content: docToSave.conteudo || '',
                    passo: docToSave.conteudoPasso || '',
                    tags: Array.isArray(docToSave.tags) ? docToSave.tags.join(', ') : (docToSave.tags || ''),
                    type: docToSave.type || 'normal'
                };
                localStorage.setItem('dochub-chat-return-payload', JSON.stringify(returnPayload));
                sessionStorage.setItem('dochub-chat-session-return-payload', JSON.stringify(returnPayload));
                localStorage.setItem('dochub-chat-prefill', JSON.stringify({
                    docId: docToSave.id,
                    title: returnPayload.title,
                    description: returnPayload.description,
                    content: returnPayload.content,
                    passo: returnPayload.passo,
                    tags: returnPayload.tags,
                    type: returnPayload.type,
                    isPasso: returnPayload.type === 'passo-a-passo'
                }));
            } catch(e){}
            // marcar como salvo para evitar confirmação de sair
            chatSavedSinceOpen = true;
            hasUnsavedChanges = false;
            showToast('✅ Documentação salva com sucesso!', 'success');

            // se estiver em página standalone, voltar 1 página
            setTimeout(() => {
                if (window.location.pathname.toLowerCase().endsWith('chat.html')) {
                    navigateToMainApp(localStorage.getItem('dochub-chat-return-section') || 'documentos');
                } else {
                    // Se for no index com chat embutido, apenas muda para seção de documentos
                    mudarSecao('documentos');
                }
            }, 120);
        } catch (e) {
            console.error('Erro ao salvar doc pelo chat', e);
            chatSavedSinceOpen = false;
            showToast('❌ Falha ao salvar', 'error');
        }
    }

    // Ligar evento ao botão de salvar (legacy: se existir no editor)
    if (saveBtn) {
        saveBtn.addEventListener('click', saveDocumentationFromChat);
    }

    // Ligar evento ao botão de salvar do topo (novo)
    const chatSaveDocsBtn = document.getElementById('chatSaveDocsBtn');
    if (chatSaveDocsBtn) {
        chatSaveDocsBtn.addEventListener('click', saveDocumentationFromChat);
    }

    // ouvir mudanças de storage para sincronizar com modal de edição em outras abas
    window.addEventListener('storage', (e) => {
        if (e.key === STORAGE_DOCS) {
            try {
                documentacoes = e.newValue ? JSON.parse(e.newValue) : [];
                // se edit modal aberto, atualizar seu conteúdo
                const editModal = document.getElementById('editModal');
                if (editModal && editModal.classList.contains('show') && currentEditingId) {
                    const d = documentacoes.find(x => String(x.id) === String(currentEditingId));
                    if (d) {
                        document.getElementById('editDocContent').innerHTML = d.conteudo || '';
                        document.getElementById('editDocPassoContent').innerHTML = d.conteudoPasso || '';
                    }
                }
            } catch (_) {}
        }
    });
}

// toggle do editor lateral (colapsável)
document.addEventListener('DOMContentLoaded', () => {
    const toggle = document.getElementById('chatEditorToggle');
    const sidebar = document.getElementById('chatSidebarEditor');
    const chatMain = document.querySelector('.chat-main');
    const chatContainer = document.querySelector('.chat-container');
    const tabNormal = document.getElementById('editorTabNormal');
    const tabPasso = document.getElementById('editorTabPasso');
    const contentEl = document.getElementById('chatEditContent');
    const passoEl = document.getElementById('chatEditPassoContent');
    
    if (!toggle || !sidebar) return;
    
    // restaurar estado aberto/fechado
    try {
        const wasOpen = localStorage.getItem('dochub-chat-editor-open') === 'true';
        // evitar transições visíveis durante a inicialização que causam flicker
        if (sidebar) {
            sidebar.style.transition = 'none';
        }
        if (wasOpen) {
            sidebar.classList.add('open');
            if (chatMain) chatMain.classList.remove('editor-closed');
            document.body.classList.remove('chat-editor-closed');
            // também restaurar a aba
            if (tabNormal && tabPasso) {
                const savedTab = localStorage.getItem('dochub-chat-editor-tab') || 'normal';
                if (savedTab === 'passo') {
                    tabPasso.classList.add('active');
                    tabNormal.classList.remove('active');
                    passoEl.style.display = '';
                    contentEl.style.display = 'none';
                    // aplicar classe passo-mode no sidebar e no container do chat
                    if (sidebar) { sidebar.classList.add('passo-mode'); sidebar.classList.remove('normal-mode'); }
                    if (chatContainer) { chatContainer.classList.add('passo-mode'); chatContainer.classList.remove('normal-mode'); }
                    const chatWrapper = document.querySelector('.chat-wrapper');
                    if (chatWrapper) { chatWrapper.classList.add('passo-mode'); chatWrapper.classList.remove('normal-mode'); }
                    try { document.body.classList.add('chat-mode-passo'); document.body.classList.remove('chat-mode-normal'); } catch(e){}
                } else {
                    tabNormal.classList.add('active');
                    tabPasso.classList.remove('active');
                    contentEl.style.display = '';
                    passoEl.style.display = 'none';
                    // aplicar classe normal-mode no sidebar e no container do chat
                    if (sidebar) { sidebar.classList.add('normal-mode'); sidebar.classList.remove('passo-mode'); }
                    if (chatContainer) { chatContainer.classList.add('normal-mode'); chatContainer.classList.remove('passo-mode'); }
                    const chatWrapper = document.querySelector('.chat-wrapper');
                    if (chatWrapper) { chatWrapper.classList.add('normal-mode'); chatWrapper.classList.remove('passo-mode'); }
                    try { document.body.classList.add('chat-mode-normal'); document.body.classList.remove('chat-mode-passo'); } catch(e){}
                }
            }
        } else {
            if (chatMain) chatMain.classList.add('editor-closed');
            document.body.classList.add('chat-editor-closed');
        }
        // restaurar transição após ajuste inicial (pequeno delay para garantir layout)
        if (sidebar) {
            setTimeout(() => { try { sidebar.style.transition = ''; } catch(e){} }, 60);
        }
    } catch (e) {}
    
    toggle.addEventListener('click', () => {
        const isOpening = !sidebar.classList.contains('open');

        // elementos para animação coordenada
        const chatWrapper = document.querySelector('.chat-wrapper');
        const chatMainEl = chatMain;

        // salvar estado de abertura (será atualizado após animação quando fechando)
        localStorage.setItem('dochub-chat-editor-open', isOpening);

        // alternar estado do sidebar de forma imediata (sem animações)
        sidebar.classList.toggle('open');
        const nowOpen = sidebar.classList.contains('open');
        if (nowOpen) {
            if (chatMainEl) chatMainEl.classList.remove('editor-closed');
            document.body.classList.remove('chat-editor-closed');
        } else {
            if (chatMainEl) chatMainEl.classList.add('editor-closed');
            document.body.classList.add('chat-editor-closed');
            // limpar classes de modo (garantir que a borda não fique visível)
            if (chatContainer) { chatContainer.classList.remove('normal-mode'); chatContainer.classList.remove('passo-mode'); }
            if (chatWrapper) { chatWrapper.classList.remove('normal-mode'); chatWrapper.classList.remove('passo-mode'); }
            try { document.body.classList.remove('chat-mode-normal'); document.body.classList.remove('chat-mode-passo'); } catch(e){}
        }

        // restaurar aba salva apenas quando abrindo
        if (isOpening && tabNormal && tabPasso) {
            try {
                const savedTab = localStorage.getItem('dochub-chat-editor-tab') || 'normal';
                if (savedTab === 'passo') {
                    tabPasso.classList.add('active');
                    tabNormal.classList.remove('active');
                    passoEl.style.display = '';
                    contentEl.style.display = 'none';
                            if (chatContainer) { chatContainer.classList.add('passo-mode'); chatContainer.classList.remove('normal-mode'); }
                            const cw = document.querySelector('.chat-wrapper'); if (cw) { cw.classList.add('passo-mode'); cw.classList.remove('normal-mode'); }
                            try { document.body.classList.add('chat-mode-passo'); document.body.classList.remove('chat-mode-normal'); } catch(e){}
                } else {
                    tabNormal.classList.add('active');
                    tabPasso.classList.remove('active');
                    contentEl.style.display = '';
                    passoEl.style.display = 'none';
                            if (chatContainer) { chatContainer.classList.add('normal-mode'); chatContainer.classList.remove('passo-mode'); }
                            const cw = document.querySelector('.chat-wrapper'); if (cw) { cw.classList.add('normal-mode'); cw.classList.remove('passo-mode'); }
                            try { document.body.classList.add('chat-mode-normal'); document.body.classList.remove('chat-mode-passo'); } catch(e){}
                }
            } catch (e) {}
        }
    });
    // O painel só fecha quando o usuário clicar novamente no ícone toggle
});

function carregarDocNoSidebar(docId) {
    try {
        const raw = localStorage.getItem(STORAGE_DOCS);
        if (!raw) return;
        const docs = JSON.parse(raw);
        const doc = docs.find(d => String(d.id) === String(docId) || d.id === docId);
        if (!doc) return;
        const contentEl = document.getElementById('chatEditContent');
        const passoEl = document.getElementById('chatEditPassoContent');
        if (contentEl) contentEl.innerHTML = doc.conteudo || '';
        if (passoEl) passoEl.innerHTML = doc.conteudoPasso || '';
        // set currentEditingId for future saves
        currentEditingId = doc.id;
    } catch (e) { console.warn('carregarDocNoSidebar erro', e); }
}

// ensure index page updates when docs in localStorage change
window.addEventListener('storage', (e) => {
    if (e.key === STORAGE_DOCS) {
        try { documentacoes = e.newValue ? JSON.parse(e.newValue) : []; } catch(_){}
    }
});

function restaurarEstadoInterfaceReordenacao() {
    const seletores = [
        '.nav-link',
        '.btn-primary',
        '.btn-secondary',
        '.search-btn',
        '.view-btn',
        '#reorderDocsBtn',
        '#addCategoryBtn',
        '.category-item-edit',
        '.category-item-delete',
        '.doc-card',
        '.category-item',
        'input',
        'textarea',
        'select',
        '.sidebar-title',
        '.navbar-title',
        '.logo-icon'
    ].join(', ');

    document.querySelectorAll(seletores).forEach(el => {
        el.classList.remove('disabled-reorder');
        el.style.pointerEvents = '';
        el.style.opacity = '';
        el.style.filter = '';

        if (el.matches('input, textarea, select')) {
            el.disabled = false;
            el.removeAttribute('disabled');
        }
    });

    const searchInput = document.getElementById('searchInput');
    if (searchInput) {
        searchInput.classList.remove('disabled-reorder');
        searchInput.style.pointerEvents = '';
        searchInput.style.opacity = '';
        searchInput.style.filter = '';
        searchInput.disabled = false;
        searchInput.removeAttribute('disabled');
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
        restaurarEstadoInterfaceReordenacao();
    }
}

/* ===================== CHAT IA - implementação leve ===================== */
const STORAGE_CHAT = 'dochub-chat-histories';
const STORAGE_CHAT_SCOPE = 'dochub-chat-scope';
const STORAGE_SIDEBAR_DRAFT = 'dochub-chat-sidebar-draft';

function getChatStorageData() {
    try {
        const raw = localStorage.getItem(STORAGE_CHAT);
        if (!raw) return { global: [], docs: {} };
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
            return { global: parsed, docs: {} };
        }
        if (parsed && typeof parsed === 'object') {
            const global = Array.isArray(parsed.global) ? parsed.global : [];
            const docs = (parsed.docs && typeof parsed.docs === 'object') ? parsed.docs : {};
            return { global, docs };
        }
    } catch (e) {
        console.warn('Erro ao ler chatStorageData:', e);
    }
    return { global: [], docs: {} };
}

function setChatStorageData(data) {
    try {
        localStorage.setItem(STORAGE_CHAT, JSON.stringify(data));
    } catch (e) {
        console.warn('Erro ao salvar chatStorageData:', e);
    }
}

async function persistChatStateToServer() {
    try {
        await fetch(apiUrl('/api/data'), {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ kind: 'chat', data: getChatStorageData() })
        });
    } catch (e) {
        console.warn('Falha ao persistir chat no servidor', e);
    }
}

function getChatScopeKey(docId = currentChatDocId) {
    if (docId === null || docId === undefined || String(docId).trim() === '') return 'global';
    return String(docId);
}

function getChatMessagesForScope(docId = currentChatDocId) {
    const storage = getChatStorageData();
    const key = getChatScopeKey(docId);
    if (key === 'global') return Array.isArray(storage.global) ? storage.global : [];
    if (!storage.docs || typeof storage.docs !== 'object') return [];
    const messages = storage.docs[key];
    if (Array.isArray(messages)) return messages;
    return [];
}

function saveChatHistory(messages, docId = currentChatDocId) {
    const storage = getChatStorageData();
    const key = getChatScopeKey(docId);
    if (key === 'global') {
        storage.global = Array.isArray(messages) ? messages : [];
    } else {
        if (!storage.docs || typeof storage.docs !== 'object') storage.docs = {};
        storage.docs[key] = Array.isArray(messages) ? messages : [];
    }
    setChatStorageData(storage);
    persistChatStateToServer();
}

function setChatScope(docId) {
    if (docId !== null && docId !== undefined && String(docId).trim() !== '') {
        currentChatDocId = docId;
        localStorage.setItem(STORAGE_CHAT_SCOPE, JSON.stringify({ docId: currentChatDocId }));
        try {
            const title = getDocumentTitleById(docId);
            setChatScopeBanner(`Chat da documentação: ${title}`);
        } catch (e) {
            setChatScopeBanner(`Chat da documentação: ${docId}`);
        }
    } else {
        currentChatDocId = null;
        localStorage.removeItem(STORAGE_CHAT_SCOPE);
        clearChatScopeBanner();
    }
}

function restoreChatScopeFromStorage() {
    try {
        const raw = localStorage.getItem(STORAGE_CHAT_SCOPE);
        if (!raw) {
            currentChatDocId = null;
            clearChatScopeBanner();
            return;
        }
        const parsed = JSON.parse(raw);
        if (parsed && parsed.docId !== undefined && parsed.docId !== null && String(parsed.docId).trim() !== '') {
            currentChatDocId = parsed.docId;
            const title = getDocumentTitleById(currentChatDocId);
            setChatScopeBanner(`Chat da documentação: ${title}`);
        } else {
            currentChatDocId = null;
            clearChatScopeBanner();
        }
    } catch (e) {
        currentChatDocId = null;
        clearChatScopeBanner();
    }
}

function getDocumentTitleById(docId) {
    if (!docId) return 'Desconhecido';
    const doc = documentacoes.find(d => String(d.id) === String(docId));
    if (doc && doc.titulo) return doc.titulo;
    if (doc && doc.title) return doc.title;
    return `Documento ${docId}`;
}

function saveChatSidebarDraft() {
    try {
        const contentEl = document.getElementById('chatEditContent');
        const passoEl = document.getElementById('chatEditPassoContent');
        const draft = {
            docId: currentEditingId || null,
            content: contentEl ? contentEl.innerHTML : '',
            passo: passoEl ? passoEl.innerHTML : '',
            ts: Date.now()
        };
        localStorage.setItem(STORAGE_SIDEBAR_DRAFT, JSON.stringify(draft));
    } catch (e) { /* silencioso */ }
}

function loadChatSidebarDraft() {
    try {
        const raw = localStorage.getItem(STORAGE_SIDEBAR_DRAFT) || localStorage.getItem('dochub-chat-prefill');
        if (!raw) return null;
        const draft = JSON.parse(raw);
        // Only restore if draft belongs to currentEditingId OR no doc is selected
        if (draft) {
            const contentEl = document.getElementById('chatEditContent');
            const passoEl = document.getElementById('chatEditPassoContent');
            // If draft has a docId but currentEditingId is not set, assume user was editing that doc before reload
            if (draft.docId && (!currentEditingId || String(currentEditingId) === '')) {
                try {
                    currentEditingId = draft.docId;
                    carregarDocNoSidebar(draft.docId);
                } catch (e) { /* ignore */ }
            }

            // restore if docId matches or if draft has no docId (global draft)
            if (!draft.docId || String(draft.docId || '') === String(currentEditingId || '')) {
                try {
                    // Preencher ambos os campos se houver conteúdo, sem apagar o outro.
                    if (contentEl && typeof draft.content !== 'undefined') contentEl.innerHTML = draft.content || '';
                    if (passoEl && typeof draft.passo !== 'undefined') passoEl.innerHTML = draft.passo || '';

                    // Apenas controlar visibilidade/aba ativa com base na preferência,
                    // mas NÃO limpar o conteúdo do outro editor.
                    const preferredTab = localStorage.getItem('dochub-chat-editor-tab') || 'normal';
                    const tabNormal = document.getElementById('editorTabNormal');
                    const tabPasso = document.getElementById('editorTabPasso');
                    if (preferredTab === 'passo') {
                        if (contentEl) contentEl.style.display = 'none';
                        if (passoEl) passoEl.style.display = '';
                        if (tabPasso) tabPasso.classList.add('active');
                        if (tabNormal) tabNormal.classList.remove('active');
                    } else {
                        if (contentEl) contentEl.style.display = '';
                        if (passoEl) passoEl.style.display = 'none';
                        if (tabNormal) tabNormal.classList.add('active');
                        if (tabPasso) tabPasso.classList.remove('active');
                    }
                } catch (e) {
                    if (contentEl && draft.content) contentEl.innerHTML = draft.content;
                    if (passoEl && draft.passo) passoEl.innerHTML = draft.passo;
                }
            }
        }
        return draft;
    } catch (e) { return null; }
}

function debounce(fn, wait = 250) {
    let t;
    return function(...args) {
        clearTimeout(t);
        t = setTimeout(() => fn.apply(this, args), wait);
    };
}

function inicializarChat() {
    // restore chat scope (document-specific if available) and then load corresponding history
    restoreChatScopeFromStorage();
    loadChatHistory();

    // attach send button listeners (support two possible IDs)
    const sendBtn = document.getElementById('sendChatBtn') || document.getElementById('chatSendBtn');
    if (sendBtn) sendBtn.addEventListener('click', enviarMensagemChat);

    const chatInput = document.getElementById('chatInput');
    if (chatInput) {
        chatInput.addEventListener('keyup', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                if (chatMentionSelectionBlockedSend) {
                    e.preventDefault();
                    chatMentionSelectionBlockedSend = false;
                    return;
                }
                e.preventDefault();
                enviarMensagemChat();
            }
        });
        // focus class handled elsewhere; ensure input exists
    }

    // Delegation: clicar em uma mensagem do bot alterna o estado 'selected'
    // EXCETO se for mensagem de resumo (bot-resume) - essas não devem ser clicáveis
    const chatMessagesContainer = document.getElementById('chatMessages');
    if (chatMessagesContainer) {
        chatMessagesContainer.addEventListener('click', (e) => {
            try {
                const msgEl = e.target.closest('.chat-message');
                if (!msgEl) return;
                if (!msgEl.classList.contains('bot')) return; // apenas bot messages
                if (msgEl.classList.contains('bot-resume')) return; // bloquear resumo
                const content = msgEl.querySelector('.message-content');
                if (!content) return;
                // evitar clique em botões internos (ex: resume actions)
                if (e.target.closest('button')) return;
                // alterna seleção
                const isSelected = content.classList.toggle('selected');
                // opcional: colocar atributo para acessibilidade
                content.setAttribute('aria-pressed', isSelected ? 'true' : 'false');
            } catch (err) { console.warn('toggle selected failed', err); }
        });
    }

    // Botão de voltar do Chat IA
    const chatBackBtn = document.getElementById('chatBackBtn');
    if (chatBackBtn) {
        chatBackBtn.style.display = 'inline-flex';
        chatBackBtn.addEventListener('click', () => {
            goBackFromChat();
            // if we're in-page, restore previous modal after navigation
            const isStandalone = window.location.pathname.toLowerCase().endsWith('chat.html') || !document.getElementById('documentos');
            if (!isStandalone && previousModalOpen) {
                setTimeout(() => setModalVisible(previousModalOpen, true), 150);
            }
        });
    }

    // support floating AI button id variations
    const floating = document.getElementById('floatingAiButton') || document.getElementById('openAiBtn');
    if (floating) {
        floating.addEventListener('click', () => openChat());
    }
}

function openChat(prefill = null) {
    try {
        const scopeDocId = (prefill && prefill.docId) ? prefill.docId : currentEditingId || null;
        setChatScope(scopeDocId);
        // Salvar seção de retorno para quando fechar o chat (inclui 'adicionar')
        const currentSection = document.querySelector('.content-section.active')?.id || 'documentos';
        localStorage.setItem('dochub-chat-return-section', currentSection);
        if (currentSection === 'adicionar') {
            localStorage.setItem('dochub-chat-returning-from-adicionar', 'true');
        } else {
            localStorage.removeItem('dochub-chat-returning-from-adicionar');
        }

        // Se estamos abrindo o chat a partir da tela de "Nova Documentação",
        // gravar o rascunho atual do formulário para que o chat e o formulário
        // compartilhem o mesmo conteúdo.
        try {
            // Se estivermos na tela de adicionar OU se os campos do formulário existirem
            // (caso a detecção por classe falhe), construir rascunho do sidebar para
            // garantir que o chat receba o conteúdo completo (HTML).
            const titleEl = document.getElementById('docTitle');
            const descEl = document.getElementById('docDescription');
            const contentEl = document.getElementById('docContent');
            const passoEl = document.getElementById('docPassoContent');
            const tagsEl = document.getElementById('docTags');
            if (currentSection === 'adicionar' || titleEl || contentEl || passoEl) {
                const selectedType = document.getElementById('docType') ? document.getElementById('docType').value : 'normal';
                const draftContent = contentEl ? (contentEl.innerHTML || '') : (prefill && prefill.content ? prefill.content : '');
                const draftPasso = passoEl ? (passoEl.innerHTML || '') : (prefill && prefill.passo ? prefill.passo : '');
                const draft = {
                    docId: null,
                    title: titleEl ? String(titleEl.value || '') : '',
                    description: descEl ? String(descEl.value || '') : '',
                    type: selectedType,
                    content: draftContent,
                    passo: draftPasso,
                    tags: tagsEl ? String(tagsEl.value || '') : (prefill && prefill.tags ? String(prefill.tags) : ''),
                    ts: Date.now()
                };
                localStorage.setItem(STORAGE_SIDEBAR_DRAFT, JSON.stringify(draft));
                // also set prefill so chat.html will immediately merge and restore rich HTML content
                try { localStorage.setItem('dochub-chat-prefill', JSON.stringify({ docId: null, content: draft.content, passo: draft.passo, isPasso: (document.getElementById('docType') ? document.getElementById('docType').value === 'passo-a-passo' : false), title: draft.title, tags: draft.tags })); } catch(e){}
                try { localStorage.setItem('dochub-debug-openChat', JSON.stringify({ ts: Date.now(), section: currentSection })); } catch(e){}
            }
        } catch (e) { /* ignore draft save errors */ }

        if (prefill) {
            try {
                if (prefill.isPasso) {
                    localStorage.setItem('dochub-chat-editor-tab', 'passo');
                } else {
                    localStorage.setItem('dochub-chat-editor-tab', 'normal');
                }
            } catch (e) {}
            localStorage.setItem('dochub-chat-prefill', JSON.stringify(prefill));
            try {
                const sidebarDraft = {
                    docId: prefill.docId || null,
                    title: prefill.title || '',
                    description: prefill.description || '',
                    type: prefill.type || (prefill.isPasso ? 'passo-a-passo' : 'normal'),
                    content: prefill.content || '',
                    passo: prefill.passo || '',
                    tags: prefill.tags || '',
                    ts: Date.now()
                };
                localStorage.setItem(STORAGE_SIDEBAR_DRAFT, JSON.stringify(sidebarDraft));
            } catch (e) { }
        } else {
            localStorage.removeItem('dochub-chat-prefill');
        }
        // If opening chat from 'adicionar' and there is no docId (new doc),
        // mark chat to open with empty history to avoid showing unrelated messages.
        try {
            if (currentSection === 'adicionar' && (!scopeDocId || String(scopeDocId).trim() === '')) {
                localStorage.setItem('dochub-chat-open-empty', 'true');
            }
        } catch (e) {}
        try { localStorage.setItem('dochub-debug-openChat-meta', JSON.stringify({ ts: Date.now(), prefill: !!prefill })); } catch(e){}
        chatSavedSinceOpen = false;
        // Suprimir o aviso de alteração não salva porque estamos navegando
        // intencionalmente para a tela de Chat IA e já salvamos o rascunho.
        try { suppressUnsavedWarning = true; } catch (e) {}
    } catch (e) { }
    // Se o chat está embutido, popular editores imediatamente a partir do prefill ou do draft
    try {
        const chatContentEl = document.getElementById('chatEditContent');
        const chatPassoEl = document.getElementById('chatEditPassoContent');
        if (chatContentEl || chatPassoEl) {
            let toUse = null;
            if (prefill) {
                toUse = { content: prefill.content || '', passo: prefill.passo || '', isPasso: !!prefill.isPasso };
            } else {
                try { const raw = localStorage.getItem(STORAGE_SIDEBAR_DRAFT); toUse = raw ? JSON.parse(raw) : null; } catch(e){ toUse = null; }
            }
            try {
                const tab = localStorage.getItem('dochub-chat-editor-tab') || (toUse && toUse.isPasso ? 'passo' : 'normal');
                if (chatContentEl && typeof toUse?.content !== 'undefined') chatContentEl.innerHTML = toUse.content || '';
                if (chatPassoEl && typeof toUse?.passo !== 'undefined') chatPassoEl.innerHTML = toUse.passo || '';
                const tabPasso = document.getElementById('editorTabPasso');
                const tabNormal = document.getElementById('editorTabNormal');
                if (tab === 'passo') {
                    if (chatContentEl) chatContentEl.style.display = 'none';
                    if (chatPassoEl) chatPassoEl.style.display = '';
                    if (tabPasso) tabPasso.classList.add('active');
                    if (tabNormal) tabNormal.classList.remove('active');
                    try { document.body.classList.add('chat-mode-passo'); document.body.classList.remove('chat-mode-normal'); } catch(e){}
                } else {
                    if (chatContentEl) chatContentEl.style.display = '';
                    if (chatPassoEl) chatPassoEl.style.display = 'none';
                    if (tabNormal) tabNormal.classList.add('active');
                    if (tabPasso) tabPasso.classList.remove('active');
                    try { document.body.classList.add('chat-mode-normal'); document.body.classList.remove('chat-mode-passo'); } catch(e){}
                }
            } catch(e){}
        }
    } catch(e) {}
    // mudar de página após breve timeout para garantir que a flag seja aplicada
    setTimeout(() => { window.location.href = 'chat.html'; }, 10);
}

function loadChatHistory() {
    try {
        const messages = getChatMessages();
        if (!messages || !Array.isArray(messages) || messages.length === 0) {
            renderChatMessages([]);
            return;
        }
        renderChatMessages(messages);
    } catch (e) { console.warn('Erro ao carregar histórico do chat', e); }
}

function getChatMessages() {
    return getChatMessagesForScope(currentChatDocId);
}

// Build history for request: sliding window (last N) + optional lightweight client-side summary
function buildHistoryForRequest(options = { windowSize: 40, summaryThreshold: 120 }) {
    const all = getChatMessages() || [];
    const total = all.length;
    const windowSize = options.windowSize || 40;
    const summaryThreshold = options.summaryThreshold || 120;

    // if small enough, return last window directly
    if (total <= windowSize) return all.slice(-windowSize);

    // build a lightweight summary of older messages (not sent to backend for heavy summarization)
    const older = all.slice(0, Math.max(0, total - windowSize));
    const recent = all.slice(Math.max(0, total - windowSize));

    // create a compact summary by extracting key sentences (naive): take the start of each older message
    let excerpt = older.map(m => {
        const txt = String(m.content || '');
        return txt.split('\n')[0].slice(0, 200);
    }).filter(Boolean).join(' | ');

    if (excerpt.length > 1000) excerpt = excerpt.slice(0, 1000) + '...';

    const summaryMsg = {
        role: 'system',
        content: `RESUMO_DO_HISTÓRICO: Há ${older.length} mensagens anteriores. Conteúdo resumido: ${excerpt}`
    };

    // return [summary, ...recent]
    return [summaryMsg, ...recent];
}

function renderChatMessages(messages) {
    const container = document.getElementById('chatMessages');
    if (!container) return;
    container.innerHTML = '';
    messages.forEach((m, idx) => {
        const el = document.createElement('div');
        el.className = 'chat-message ' + (m.role === 'user' ? 'user' : 'bot');
        if (m.isResume && m.role === 'bot') {
            el.classList.add('bot-resume');
        }
        if (m.isUserResumeInput && m.role === 'user') {
            el.classList.add('user-resume-input');
        }
        const inner = document.createElement('div');
        inner.className = 'message-content';
        if (m.html) {
            inner.innerHTML = renderAiVisualImageTokens(m.content);
        } else {
            inner.innerHTML = renderAiVisualImageTokens(renderMessageHTML(m.content));
        }
        // tornar a bolha clicável: alterna a classe 'selected' para mostrar os bot-action-buttons
        inner.addEventListener('click', (ev) => {
            ev.stopPropagation();
            try {
                // remover seleção de outras mensagens
                document.querySelectorAll('.message-content.selected').forEach(n => { if (n !== inner) n.classList.remove('selected'); });
                inner.classList.toggle('selected');
            } catch (e) { }
        });

        el.appendChild(inner);

        // Determinar se a mensagem aparenta ser um erro (ex.: começa com ❌ ou contém 'erro')
        const messageText = (inner.textContent || '').trim();
        const isErrorMsg = messageText.startsWith('❌') || /\berro\b/i.test(messageText) || /failed to fetch/i.test(messageText) || /api key/i.test(messageText.toLowerCase());

        // Adicionar ícone azul (Normal) para mensagens do bot
        // NÃO adicionar para mensagens de resumo (isResume) nem para mensagens de erro
        // OBS: os botões serão inseridos DENTRO do elemento .message-content
        if (m.role === 'bot' && !m.content.includes('Resumindo') && !m.isResume && !isErrorMsg) {
            const botActions = document.createElement('div');
            botActions.className = 'bot-action-buttons';
            botActions.innerHTML = `
                <button class="btn-save-normal" title="Salvar no Normal" data-msg-idx="${idx}"></button>
            `;
            // anexar DENTRO da bolha da mensagem (inner) para ficar logo abaixo do conteúdo
            inner.appendChild(botActions);
        }
        
        if (m.isResume && m.role === 'bot' && !m.content.includes('Resumindo')) {
            const actions = document.createElement('div');
            actions.className = 'resume-actions';
            actions.innerHTML = `
                <button class="resume-action-btn resume-copy" title="Copiar para Passo a Passo" data-msg-idx="${idx}">↘️</button>
            `;
            el.appendChild(actions);
        }
        
        container.appendChild(el);
    });
    
    // Event listeners para botões de ação do bot
    container.querySelectorAll('.btn-save-normal').forEach(btn => {
        btn.addEventListener('click', function(e) {
            e.stopPropagation();
            const msgIdx = parseInt(this.getAttribute('data-msg-idx'));
            const botMessage = messages[msgIdx];
            if (!botMessage) return;
            try {
                const normalEl = document.getElementById('chatEditContent');
                const sidebar = document.getElementById('chatSidebarEditor');
                const chatMain = document.querySelector('.chat-main');
                const chatContainer = document.querySelector('.chat-container');
                const chatWrapper = document.querySelector('.chat-wrapper');
                const tabNormal = document.getElementById('editorTabNormal');
                const tabPasso = document.getElementById('editorTabPasso');
                if (!normalEl) return;

                // Toggle behavior: if already saved, restore previous content
                if (this.classList.contains('saved')) {
                    // restore backup if present
                    try {
                        const backup = this.dataset.backup || '';
                        normalEl.innerHTML = backup ? decodeURIComponent(backup) : '';
                        this.classList.remove('saved');
                        // visual revert handled by CSS (.saved class)
                        // update draft
                        try { saveChatSidebarDraft(); } catch(e){}
                    } catch (e) { console.warn('Erro ao restaurar backup', e); }
                    return;
                }

                // Save current content as backup to allow revert
                try { this.dataset.backup = encodeURIComponent(normalEl.innerHTML || ''); } catch(e){}

                // Put bot message content into the Normal editor
                if (botMessage.html) {
                    normalEl.innerHTML = botMessage.content;
                } else {
                    normalEl.innerHTML = renderMessageHTML(botMessage.content);
                }

                // Open the sidebar editor and switch to Normal tab
                try {
                    if (sidebar) sidebar.classList.add('open');
                    if (chatMain) chatMain.classList.remove('editor-closed');
                    document.body.classList.remove('chat-editor-closed');
                    if (tabNormal && tabPasso) {
                        tabNormal.classList.add('active'); tabPasso.classList.remove('active');
                    }
                    if (chatContainer) { chatContainer.classList.add('normal-mode'); chatContainer.classList.remove('passo-mode'); }
                    if (chatWrapper) { chatWrapper.classList.add('normal-mode'); chatWrapper.classList.remove('passo-mode'); }
                    try { document.body.classList.add('chat-mode-normal'); document.body.classList.remove('chat-mode-passo'); } catch(e){}
                } catch (e) {}

                // mark button as saved (visual state)
                this.classList.add('saved');
                try { saveChatSidebarDraft(); } catch(e){}
            } catch (err) { console.warn('erro ao salvar no normal', err); }
        });
    });
    
    // clicar fora das mensagens remove seleção (esconde bot-action-buttons)
    document.addEventListener('click', (ev) => {
        try {
            if (!ev.target.closest('.chat-messages')) {
                document.querySelectorAll('.message-content.selected').forEach(n => n.classList.remove('selected'));
            }
        } catch(e) {}
    });


    
    container.querySelectorAll('.resume-copy').forEach(btn => {
        btn.addEventListener('click', function() {
            const msgIdx = parseInt(this.getAttribute('data-msg-idx'));
            const resumeMessage = messages[msgIdx];
            if (!resumeMessage) return;
            try {
                const passoEl = document.getElementById('chatEditPassoContent');
                if (!passoEl) return;
                if (resumeMessage.html) {
                    passoEl.innerHTML = resumeMessage.content;
                } else {
                    passoEl.innerHTML = renderMessageHTML(resumeMessage.content);
                }
                saveChatSidebarDraft();
                const tabPasso = document.getElementById('editorTabPasso');
                if (tabPasso) tabPasso.click();
                showToast('✅ Conteúdo copiado para Passo a Passo!', 'success');
            } catch (e) {
                console.error('[ERROR] resume-copy action error', e);
                showToast('Erro ao copiar conteúdo.', 'error');
            }
        });
    });
    
    container.scrollTop = container.scrollHeight;
}

function setResumoEnabled(enabled) {
    try {
        const btn = document.getElementById('passoResumoBtn');
        if (!btn) return;
        btn.disabled = !enabled;
        btn.style.opacity = enabled ? '' : '0.5';
    } catch (e) {}
}

function appendChatMessage(role, content, isHtml = false, isResume = false, isUserResumeInput = false) {
    const messages = getChatMessages();
    const msg = { role, content, ts: Date.now(), html: !!isHtml, isResume: !!isResume, isUserResumeInput: !!isUserResumeInput };
    messages.push(msg);
    saveChatHistory(messages);
    renderChatMessages(messages);
    const container = document.getElementById('chatMessages');
    if (!container) return null;
    // retornar tanto o elemento quanto o ts para permitir atualização posterior
    const el = container.lastChild;
    el._msg_ts = msg.ts;
    return el;
}

function updateChatMessageByTs(ts, newContent) {
    try {
        const messages = getChatMessages();
        // localizar última ocorrência que corresponda ao ts
        for (let i = messages.length - 1; i >= 0; i--) {
            if (messages[i].ts === ts) {
                messages[i].content = newContent;
                messages[i].isResume = nextBotMessageIsResume;
                nextBotMessageIsResume = false;
                saveChatHistory(messages);
                renderChatMessages(messages);
                return true;
            }
        }
    } catch (e) {
        console.warn('updateChatMessageByTs erro', e);
    }
    return false;
}

function enviarMensagemChat(systemOverride = null) {
    const input = document.getElementById('chatInput');
    if (!input) return;
    const text = input.value.trim();
    if (!text) return;
    
    // Verificar se existe uma configuração de IA disponível no servidor/browser.
    const effectiveApiKey = (aiConfig && aiConfig.apiKey) ? aiConfig.apiKey : '';
    if (!effectiveApiKey) {
        appendChatMessage('user', text);
        appendChatMessage('bot', '❌ Não há chave de IA configurada. Defina a chave no servidor ou nas configurações do app antes de usar o chat.');
        input.value = '';
        input.disabled = false;
        return;
    }

    // Avisar se não tem @ selecionado (não enviar para a IA),
    // exceto quando um `systemOverride` for fornecido (ex: resumo) ou
    // quando estamos explicitamente marcando a próxima mensagem como resumo.
    const hasActiveCommand = activeChatCommandNames && activeChatCommandNames.length > 0;
    const hasOverride = (typeof systemOverride === 'string' && systemOverride.trim());
    if (!hasActiveCommand && !hasOverride && !nextBotMessageIsResume) {
        appendChatMessage('user', text);
        appendChatMessage('bot', '⚠️ Digite @ para enviar uma mensagem.');
        input.value = '';
        input.disabled = false;
        return;
    }

    const backendMessage = text;
    const displayedMessage = text;

    appendChatMessage('user', displayedMessage);
    input.value = '';
    input.disabled = true;
    const loadingMsg = nextBotMessageIsResume ? '📋 Resumindo...' : '⏳ Pensando...';
    const loadingEl = appendChatMessage('bot', loadingMsg, false, nextBotMessageIsResume) || null;
    // marcar estado de processamento e desativar botão Resumir
    isChatThinking = true;
    try { setResumoEnabled(false); } catch(e){}

    // Removido timeout forçado: aguardar até a IA responder (sem abort automático)

    // Fazer requisição ao backend Python com timeout
    // Determinar modelo e provider (prefere configuração do aiConfig ou seleção atual)
    const selectedModel = aiConfig.model || document.querySelector('input[name="aiModel"]:checked')?.value || '';
    // Determinar provider: preferir configuração salva, senão inferir pelo nome do modelo
    let provider = aiConfig.provider || '';
    if (!provider) {
        provider = inferProviderFromModel(selectedModel);
    }

    // Aplicar System Prompt estritamente: quando definido, enviamos uma
    // versão reforçada como instrução obrigatória para o modelo.
    // Se um `systemOverride` foi passado (ex: prompt de resumo temporário),
    // usá-lo como `system_prompt` para esta requisição sem alterar a configuração global.
    const overridePrompt = (typeof systemOverride === 'string' && systemOverride.trim()) ? systemOverride.trim() : null;
    const activeCommandsPrompt = getChatCommandsOverridePrompt();
    const rawPrompt = overridePrompt || activeCommandsPrompt || ((aiConfig.systemPrompt && aiConfig.systemPrompt.trim()) ? aiConfig.systemPrompt.trim() : '');
    const effectiveSystemPrompt = rawPrompt
        ? [
            'INSTRUÇÃO OBRIGATÓRIA - SIGA ESTAS DIRETRIZES À RISCA:',
            rawPrompt,
            '',
            'REGRAS DE APLICAÇÃO (OBRIGATÓRIAS):',
            '1) Trate o texto acima como um filtro e prioridade máxima ao processar qualquer pedido.',
            '2) Se houver conflito entre o pedido do usuário e as diretrizes acima, priorize as diretrizes e explique brevemente o motivo.',
            '3) Aplique as diretrizes acima sem inserir um cabeçalho adicional chamado "APLICAÇÃO DAS DIRETRIZES:" a menos que o usuário peça explicitamente.',
            '4) Responda claramente à solicitação do usuário (se for possível segundo às diretrizes).',
            '5) Responda em português, seja objetivo e cite quando algo foi omitido por conflito com as diretrizes.'
        ].join('\n')
        : 'Você é um assistente útil';

    const historyForSend = buildHistoryForRequest({ windowSize: 40, summaryThreshold: 120 });
    // garantir que o system prompt também esteja disponível como campo separado (alguns backends usam este campo)
    // e também como primeira mensagem do histórico para consistência
    const historyWithSystem = [
        { role: 'system', content: effectiveSystemPrompt },
        ...historyForSend
    ];

    const body = {
        api_key: effectiveApiKey,
        model: selectedModel,
        provider: provider,
        message: backendMessage,
        chat_mode: currentChatMode,
        chat_intent: currentChatIntent,
        system_prompt: effectiveSystemPrompt,
        history: historyWithSystem
    };

    console.debug('[DEBUG] enviarMensagemChat -> sending message', {
        backendMessage,
        displayedMessage,
        selectedModel,
        provider,
        hasActiveCommand,
        hasOverride,
        chatMode: currentChatMode,
        chatIntent: currentChatIntent
    });

    fetch(apiUrl('/api/chat'), {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    })
    .then(res => res.json())
    .then(data => {
        if (!loadingEl) {
            // fallback: persist new bot message
            if (!data.success) appendChatMessage('bot', `❌ Erro: ${data.error || 'Não foi possível responder.'}`, false, nextBotMessageIsResume);
            else appendChatMessage('bot', data.response || '', false, nextBotMessageIsResume);
            nextBotMessageIsResume = false;
        } else {
            // atualizar mensagem placeholder no histórico usando ts
            const ts = loadingEl._msg_ts;
            if (!ts) {
                // se por algum motivo não temos ts, atualizar apenas o DOM
                if (!data.success) {
                    loadingEl.innerHTML = `<div class="message-content"><p>❌ Erro: ${data.error}</p></div>`;
                } else {
                    loadingEl.innerHTML = `<div class="message-content"><p>${renderMessageHTML(data.response)}</p></div>`;
                }
            } else {
                if (!data.success) {
                    updateChatMessageByTs(ts, `❌ Erro: ${data.error || 'Não foi possível responder.'}`);
                } else {
                    updateChatMessageByTs(ts, data.response || '');
                }
            }
        }
        // reativar controle de resumo
        try { isChatThinking = false; setResumoEnabled(true); } catch(e){}
        input.disabled = false;
        input.focus();
    })
    .catch(err => {
        const msg = `Erro de conexão: ${err.message}`;
        if (loadingEl) {
            const ts = loadingEl._msg_ts;
            if (ts) updateChatMessageByTs(ts, `❌ ${msg}`);
            else loadingEl.innerHTML = `<div class="message-content"><p>❌ ${msg}</p></div>`;
        } else {
            appendChatMessage('bot', `❌ ${msg}`, false, nextBotMessageIsResume);
            nextBotMessageIsResume = false;
        }
        try { isChatThinking = false; setResumoEnabled(true); } catch(e){}
        input.disabled = false;
        input.focus();
    });
}

function sendEditorContentToChat(editorId, options = { isEdit: false, isPasso: false, autoSend: false }) {
    const editor = document.getElementById(editorId);
    if (!editor) return;
    const html = (editor.innerHTML || '').trim();
    const docId = currentEditingId || null;
    setChatScope(docId);

    // Build a prefill with both fields from the current active form.
    // Prioritize edit fields when present to avoid reading the empty add-form fields.
    const normalEl = document.getElementById('editDocContent') || document.getElementById('docContent');
    const passoEl = document.getElementById('editDocPassoContent') || document.getElementById('docPassoContent');
    const normalHtml = normalEl ? (normalEl.innerHTML || '').trim() : '';
    const passoHtml = passoEl ? (passoEl.innerHTML || '').trim() : '';

    const prefillPayload = {
        isPasso: !!options.isPasso,
        autoSend: !!options.autoSend,
        origin: (options.isEdit ? 'edit' : 'create'),
        docId: docId,
        content: normalHtml,
        passo: passoHtml
    };

    // Ensure at least the current editor content is present
    if (options.isPasso) {
        prefillPayload.passo = html;
        if (!prefillPayload.content) prefillPayload.content = normalHtml;
    } else {
        prefillPayload.content = html;
        if (!prefillPayload.passo) prefillPayload.passo = passoHtml;
    }

    openChat(prefillPayload);
    currentChatOrigin = { type: options.isEdit ? 'edit' : 'create', docId: docId };
    if (docId) setChatScopeBanner(`Chat da documentação: ${getDocumentTitleById(docId)}`);
}

function navigateToMainApp(section = 'documentos') {
    try {
        const safeSection = (section && ['documentos', 'exemplos', 'adicionar'].includes(section)) ? section : 'documentos';
        const target = safeSection === 'documentos' ? 'index.html' : `index.html#${encodeURIComponent(safeSection)}`;
        window.location.replace(target);
    } catch (e) {
        try { window.location.href = 'index.html'; } catch (err) {}
    }
}

function goBackFromChat() {
    const normalEditor = document.getElementById('chatEditContent');
    const passoEditor = document.getElementById('chatEditPassoContent');
    const hasText = (normalEditor && (normalEditor.innerText || normalEditor.textContent || '').trim().length > 0) ||
                    (passoEditor && (passoEditor.innerText || passoEditor.textContent || '').trim().length > 0);
    if (hasText && !chatSavedSinceOpen) {
        const confirmLeave = window.confirm('Você tem conteúdo não salvo no editor de documentação. Tem certeza que deseja sair sem salvar?');
        if (!confirmLeave) return;
    }

    const validSections = ['documentos', 'exemplos', 'adicionar'];
    let targetSection = 'documentos';
    const returnFromStorage = localStorage.getItem('dochub-chat-return-section');
    const fromAdicionar = localStorage.getItem('dochub-chat-returning-from-adicionar') === 'true';
    if (fromAdicionar) {
        targetSection = 'adicionar';
    } else if (returnFromStorage && validSections.includes(returnFromStorage)) {
        targetSection = returnFromStorage;
    }

    try {
        localStorage.setItem('dochub-chat-return-section', targetSection);
        if (targetSection === 'adicionar') {
            localStorage.setItem('dochub-chat-returning-from-adicionar', 'true');
        } else {
            localStorage.removeItem('dochub-chat-returning-from-adicionar');
        }
    } catch (e) {}

    const isStandaloneChat = window.location.pathname.toLowerCase().endsWith('chat.html') || !document.getElementById('documentos');
    try { localStorage.setItem('dochub-debug-goBack', JSON.stringify({ ts: Date.now(), hasText: !!hasText, chatSavedSinceOpen: !!chatSavedSinceOpen, returnFromStorage: returnFromStorage || null, targetSection: targetSection, isStandaloneChat: !!isStandaloneChat })); } catch(e){}

    if (isStandaloneChat) {
        try {
            navigateToMainApp(targetSection || 'documentos');
            return;
        } catch (e) {
            try { window.location.href = 'index.html'; } catch (err) {}
            return;
        }
    }

    try {
        mudarSecao(targetSection);
        if (targetSection === 'adicionar') {
            restaurarRascunhoAdicionar();
        }
        currentChatOrigin = null;
        clearChatScopeBanner();
    } catch (e) {
        try { window.location.href = 'index.html'; } catch (err) {}
    }
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
        const icon = document.getElementById('chatModeIcon');
        const pop = document.getElementById('chatModePopover');
        topBar.innerHTML = '';
        if (icon) topBar.appendChild(icon);
        if (pop) topBar.appendChild(pop);
    } catch (e) {}
}

window.addEventListener('beforeunload', () => {
    try { salvarDados(); } catch (e) {}
});

window.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
        try { salvarDados(); } catch (e) {}
    }
});

// Helper to populate intents based on mode
function setChatMode(mode) {
    currentChatMode = mode === 'passo' ? 'passo' : 'normal';
    const intentSelect = document.getElementById('chatIntentSelect');
    if (!intentSelect) return;
    // clear
    intentSelect.innerHTML = '';
    if (currentChatMode === 'normal') {
        intentSelect.innerHTML = `
            <option value="tirar-duvidas">Tirar dúvidas</option>
            <option value="criar-documentacao">Criar documentação</option>
        `;
        currentChatIntent = 'tirar-duvidas';
    } else {
        intentSelect.innerHTML = `
            <option value="tirar-duvidas">Tirar dúvidas</option>
            <option value="criar-passo">Criar passo a passo (a partir da doc)</option>
        `;
        currentChatIntent = 'tirar-duvidas';
    }
    // set selected value
    intentSelect.value = currentChatIntent;
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

function mostrarApp() {
    const authGate = document.getElementById('authGate');
    if (authGate) authGate.style.display = 'none';
    const appContainer = document.getElementById('appContainer');
    if (appContainer) appContainer.style.display = 'flex';
    const logoutBtn = document.getElementById('logoutBtn');
    if (logoutBtn) logoutBtn.style.display = 'none';
}

async function verificarSessao() {
    try {
        mostrarApp();
        await carregarDados();
    } catch (e) {
        mostrarApp();
    }
}

function sincronizarUIComEstado() {
    try { renderizarCategorias(); } catch (e) {}
    try { atualizarSelectsCategorias(); } catch (e) {}
    try { renderizarExemplos(); } catch (e) {}
    try { renderizarDocumentacoes(documentacoes); } catch (e) {}
    try { filtrarPorCategoria(currentSelectedCategory || 'todos'); } catch (e) {}
    try { atualizarStats(); } catch (e) {}
}

function restaurarUltimaSecao() {
    const validSections = ['documentos', 'exemplos', 'adicionar'];
    try {
        const hash = (window.location.hash || '').replace('#', '').trim();
        let sectionToRestore = null;

        if (hash && validSections.includes(hash)) {
            sectionToRestore = hash;
        } else {
            const stored = localStorage.getItem('dochub-chat-return-section');
            if (stored && validSections.includes(stored)) {
                sectionToRestore = stored;
            }
        }

        if (!sectionToRestore) {
            const current = document.querySelector('.content-section.active')?.id;
            sectionToRestore = current && validSections.includes(current) ? current : 'documentos';
        }

        mudarSecao(sectionToRestore);

        if (sectionToRestore === 'adicionar') {
            setTimeout(() => {
                try {
                    if (typeof prepararNovaDocumentacao === 'function') prepararNovaDocumentacao();
                    restaurarRascunhoAdicionar();
                } catch (e) {}
            }, 80);
        }

        return sectionToRestore;
    } catch (e) {
        return null;
    }
}

async function carregarDados() {
    const backupState = getStateBackup();
    const existingDocs = Array.isArray(documentacoes) ? documentacoes : [];
    const existingExs = Array.isArray(exemplos) ? exemplos : [];
    const existingCats = Array.isArray(categorias) ? categorias : [];
    let loadedFromServer = false;

    try {
        const res = await fetch(apiUrl('/api/data'), { method: 'GET', credentials: 'include' });
        if (res.ok) {
            const payload = await res.json();
            if (payload && payload.success && payload.data) {
                const serverDocs = Array.isArray(payload.data.documents) ? payload.data.documents : [];
                const serverExs = Array.isArray(payload.data.examples) ? payload.data.examples : [];
                const serverCats = Array.isArray(payload.data.categories) ? payload.data.categories : [];
                const hasServerState = serverDocs.length > 0 || serverExs.length > 0 || serverCats.length > 0;

                if (hasServerState) {
                    documentacoes = serverDocs.length > 0 ? serverDocs : (Array.isArray(backupState?.documents) ? backupState.documents : existingDocs);
                    exemplos = serverExs.length > 0 ? serverExs : (Array.isArray(backupState?.examples) ? backupState.examples : existingExs);
                    categorias = serverCats.length > 0 ? serverCats : (Array.isArray(backupState?.categories) ? backupState.categories : existingCats);
                } else if (backupState) {
                    documentacoes = Array.isArray(backupState.documents) ? backupState.documents : existingDocs;
                    exemplos = Array.isArray(backupState.examples) ? backupState.examples : existingExs;
                    categorias = Array.isArray(backupState.categories) ? backupState.categories : existingCats;
                } else {
                    documentacoes = existingDocs;
                    exemplos = existingExs;
                    categorias = existingCats;
                }

                if (payload.data.chat) {
                    try { localStorage.setItem(STORAGE_CHAT, JSON.stringify(payload.data.chat)); } catch (e) {}
                }
                if (payload.data.ai) {
                    aiConfig = Object.assign(aiConfig, payload.data.ai);
                }
                loadedFromServer = true;
            }
        }
    } catch (e) {
        const docs = localStorage.getItem(STORAGE_DOCS);
        const exs = localStorage.getItem(STORAGE_EXEMPLOS);
        const cats = localStorage.getItem(STORAGE_CATEGORIAS);
        categoriesLoadedFromStorage = cats !== null;
        documentacoes = docs ? JSON.parse(docs) : (backupState ? backupState.documents : []);
        exemplos = exs ? JSON.parse(exs) : (backupState ? backupState.examples : []);
        categorias = cats ? JSON.parse(cats) : (backupState ? backupState.categories : []);
    }

    if (!Array.isArray(documentacoes)) documentacoes = [];
    if (!Array.isArray(exemplos)) exemplos = [];
    if (!Array.isArray(categorias)) categorias = [];

    if (documentacoes.length === 0 && categorias.length === 0 && exemplos.length === 0 && backupState) {
        documentacoes = Array.isArray(backupState.documents) ? backupState.documents : [];
        exemplos = Array.isArray(backupState.examples) ? backupState.examples : [];
        categorias = Array.isArray(backupState.categories) ? backupState.categories : [];
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
    
    saveStateBackup();

    const aiRaw = localStorage.getItem(STORAGE_AI);
    if (aiRaw) {
        try {
            const parsedAiConfig = JSON.parse(aiRaw);
            aiConfig = {
                ...sanitizeAiConfigForStorage(parsedAiConfig || {}),
                apiKey: aiConfig.apiKey || ''
            };
            const safePersitedConfig = sanitizeAiConfigForStorage(parsedAiConfig || {});
            safePersitedConfig.apiKey = undefined;
            localStorage.setItem(STORAGE_AI, JSON.stringify(safePersitedConfig));

            // API Key (input exists in modal)
            const keyInput = document.getElementById('aiApiKey');
            if (keyInput) keyInput.value = aiConfig.apiKey || '';

            // Model: there is no single element with id 'aiModel' (models are radios).
            // Garantir que os radios reflitam o modelo salvo para que, ao dar F5,
            // a seleção permaneça a mesma quando o usuário salvou anteriormente.
            const modelRadios = document.querySelectorAll('input[name="aiModel"]');
            const savedModel = normalizeAiModel(aiConfig.model, aiConfig.provider || inferProviderFromModel(aiConfig.model));
            aiConfig.model = savedModel;
            if (modelRadios && modelRadios.length > 0) {
                modelRadios.forEach(r => { r.checked = (r.value === savedModel); });
                // se nenhum radio bateu, mantém o primeiro como padrão
                if (![...modelRadios].some(r => r.checked)) modelRadios[0].checked = true;
            }

            // Não carregar ou preencher `aiSystemPrompt` (removido da UI)
        } catch (e) {
            console.warn('Falha ao restaurar configuração de IA', e);
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            sincronizarUIComEstado();
            try { restaurarUltimaSecao(); } catch (e) {}
        }, { once: true });
    } else {
        sincronizarUIComEstado();
        try { restaurarUltimaSecao(); } catch (e) {}
    }
}

function autoRestoreAiSetup() {
    try {
        const restoredKey = restoreAiApiKey();
        const aiKeyInput = document.getElementById('aiApiKey');
        if (aiKeyInput) {
            setAiKeyInputValue(aiKeyInput, aiConfig.apiKey || restoredKey || '', true);
        }
        if (aiConfig && typeof aiConfig === 'object') {
            const storedCommands = getStoredAiCommandsSnapshot();
            if (storedCommands && Object.keys(storedCommands).length) {
                aiConfig.commands = storedCommands;
            }
        }
        if (aiConfig && aiConfig.apiKey) {
            if (aiAutoValidationTimer) clearTimeout(aiAutoValidationTimer);
            aiAutoValidationTimer = setTimeout(() => {
                try { validarApiKey({ silent: true }); } catch (e) {}
            }, 500);
        }
    } catch (e) {}
}

function initializeAiAutoSetup() {
    try {
        const tryLoadConfigs = () => {
            if (typeof window.carregarConfigsIA === 'function') {
                window.carregarConfigsIA();
                return true;
            }
            return false;
        };

        if (!tryLoadConfigs()) {
            setTimeout(() => {
                if (!tryLoadConfigs()) {
                    setTimeout(() => tryLoadConfigs(), 250);
                }
            }, 100);
        }

        setTimeout(() => {
            autoRestoreAiSetup();
            if (!aiConfig.apiKey) {
                setTimeout(() => autoRestoreAiSetup(), 700);
            }
        }, 300);
    } catch (e) {}
}

async function salvarDados() {
    const docs = Array.isArray(documentacoes) ? documentacoes : [];
    const exs = Array.isArray(exemplos) ? exemplos : [];
    const cats = Array.isArray(categorias) ? categorias : [];
    const stateAi = aiConfig || { apiKey: '', model: '', provider: '' };

    try {
        localStorage.setItem(STORAGE_DOCS, JSON.stringify(docs));
        localStorage.setItem(STORAGE_EXEMPLOS, JSON.stringify(exs));
        localStorage.setItem(STORAGE_CATEGORIAS, JSON.stringify(cats));
        saveStateBackup();
    } catch (e) {}

    try {
        await fetch(apiUrl('/api/data'), {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                kind: 'documents',
                data: docs
            })
        });
        await fetch(apiUrl('/api/data'), {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                kind: 'examples',
                data: exs
            })
        });
        await fetch(apiUrl('/api/data'), {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                kind: 'categories',
                data: cats
            })
        });
        await fetch(apiUrl('/api/data'), {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                kind: 'chat',
                data: getChatStorageData()
            })
        });
        await fetch(apiUrl('/api/data'), {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                kind: 'ai',
                data: stateAi
            })
        });
    } catch (e) {
        console.warn('Falha ao salvar estado no servidor', e);
    }
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

function getNomeCategoriaSemIcone(catId) {
    if (catId === 'todos') return '';
    const cat = categorias.find(c => String(c.id) === catId);
    return cat ? String(cat.nome).trim() : '';
}

function stripCategoriaPrefixFromTitle(titulo, catId) {
    if (!titulo || !String(titulo).trim()) return '';
    let normalized = String(titulo).trim();

    const categoryName = getNomeCategoriaSemIcone(catId);
    if (categoryName) {
        const prefix = `${categoryName} - `;
        if (normalized.startsWith(prefix)) {
            return normalized.slice(prefix.length).trim();
        }
    }

    for (const cat of categorias) {
        const name = String(cat.nome || '').trim();
        if (!name) continue;
        const prefix = `${name} - `;
        if (normalized.startsWith(prefix)) {
            return normalized.slice(prefix.length).trim();
        }
    }

    const cleanupPrefixes = ['Documentação - ', 'Documentação: ', 'DOCUMENTAÇÃO - ', 'DOCUMENTAÇÃO: '];
    for (const prefix of cleanupPrefixes) {
        if (normalized.startsWith(prefix)) {
            return normalized.slice(prefix.length).trim();
        }
    }

    return normalized;
}

function buildDocTitleWithCategory(titulo, catId) {
    const rawTitle = stripCategoriaPrefixFromTitle(titulo, catId);
    const categoryName = getNomeCategoriaSemIcone(catId);
    if (categoryName) {
        return rawTitle ? `${categoryName} - ${rawTitle}` : `${categoryName} - `;
    }
    return rawTitle;
}

function refreshTitlePrefixForInput(titleInput, catId) {
    if (!titleInput) return;
    const currentRaw = stripCategoriaPrefixFromTitle(String(titleInput.value || ''), catId);
    const newValue = buildDocTitleWithCategory(currentRaw, catId);
    if (newValue !== titleInput.value) {
        const cursorPos = titleInput.selectionStart || newValue.length;
        titleInput.value = newValue;
        const minPos = buildDocTitleWithCategory('', catId).length;
        const newCursorPos = Math.max(cursorPos, minPos);
        if (typeof titleInput.setSelectionRange === 'function') {
            titleInput.setSelectionRange(newCursorPos, newCursorPos);
        }
    }
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
                const iconInput = document.getElementById('categoryIcon');
                if (iconInput) iconInput.value = cat.icone && String(cat.icone).trim() ? String(cat.icone).trim() : '📂';
                const col = document.getElementById('categoryColor'); if (col) col.value = cat.cor || '#6366f1';
                document.getElementById('editingCategoryId').value = String(cat.id);
                document.getElementById('categoryModalTitle').textContent = 'Editar Categoria';
                document.getElementById('categorySubmitBtn').textContent = '💾 Salvar Alterações';
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
            promptDeleteCategory(catId);
        }

        if (e.target.closest('.delete-cat-btn')) {
            const catId = parseInt(e.target.closest('.delete-cat-btn').dataset.catId);
            promptDeleteCategory(catId);
        }

        if (e.target.closest('.edit-cat-btn')) {
            const catId = parseInt(e.target.closest('.edit-cat-btn').dataset.catId);
            const cat = categorias.find(c => c.id === catId);
            if (!cat) return;
            document.getElementById('categoryName').value = cat.nome;
            const iconInput = document.getElementById('categoryIcon');
            if (iconInput) iconInput.value = cat.icone && String(cat.icone).trim() ? String(cat.icone).trim() : '📂';
            const col2 = document.getElementById('categoryColor'); if (col2) col2.value = cat.cor || '#6366f1';
            document.getElementById('editingCategoryId').value = String(cat.id);
            document.getElementById('categoryModalTitle').textContent = 'Editar Categoria';
            document.getElementById('categorySubmitBtn').textContent = '💾 Salvar Alterações';
            setModalVisible('categoryModal', true);
        }
    });

    function prepararNovaDocumentacao() {
        currentEditingId = null;
        currentEditingType = null;
        const docForm = document.getElementById('docForm');
        if (docForm) docForm.reset();

        const title = document.getElementById('docTitle'); if (title) title.value = '';
        const category = document.getElementById('docCategory'); if (category) category.value = '';
        const description = document.getElementById('docDescription'); if (description) description.value = '';
        const type = document.getElementById('docType'); if (type) type.value = 'normal';
        const content = document.getElementById('docContent'); if (content) content.innerHTML = '';
        const passo = document.getElementById('docPassoContent'); if (passo) passo.innerHTML = '';
        const tags = document.getElementById('docTags'); if (tags) tags.value = '';
        const docPassoGroup = document.getElementById('docPassoGroup');
        const docContentGroup = document.getElementById('docContentGroup');
        if (docPassoGroup) docPassoGroup.style.display = 'none';
        if (docContentGroup) docContentGroup.style.display = 'block';
        const fullscreenBackBtn = document.getElementById('fullscreenBackBtn'); if (fullscreenBackBtn) fullscreenBackBtn.style.display = 'none';
        const fullscreenBackBtnPasso = document.getElementById('fullscreenBackBtnPasso'); if (fullscreenBackBtnPasso) fullscreenBackBtnPasso.style.display = 'none';

        // reset chat scope for new create to avoid using old doc context
        currentChatDocId = null;
        setChatScope(null);
        clearChatScopeBanner();

        setTimeout(() => {
            const titleInput = document.getElementById('docTitle');
            if (titleInput) titleInput.focus();
        }, 40);
    }

    function restaurarRascunhoAdicionar() {
        try {
            // priority: specific return payload set when user clicked salvar in chat (session first)
            let rawDraft = null;
            try { rawDraft = sessionStorage.getItem('dochub-chat-session-return-payload'); } catch(e) { rawDraft = null; }
            if (rawDraft) {
                try { sessionStorage.removeItem('dochub-chat-session-return-payload'); } catch(e) {}
            }
            if (!rawDraft) {
                rawDraft = localStorage.getItem('dochub-chat-return-payload');
                if (rawDraft) {
                    try { localStorage.removeItem('dochub-chat-return-payload'); } catch(e) {}
                }
            }
            // fallbacks
            if (!rawDraft) rawDraft = localStorage.getItem(STORAGE_SIDEBAR_DRAFT) || localStorage.getItem('dochub-debug-last-saved-draft') || localStorage.getItem('dochub-chat-sidebar-draft-v2') || localStorage.getItem('dochub-chat-prefill');
            if (!rawDraft) return;
            let d = null;
            try { d = JSON.parse(rawDraft); } catch(e) { d = { content: rawDraft }; }
            // normalize prefill-like shapes
            if (d && (d.content === undefined && d.passo === undefined && d.title === undefined) && typeof rawDraft === 'string') {
                try {
                    const maybePrefill = JSON.parse(rawDraft);
                    if (maybePrefill) d = maybePrefill;
                } catch(e) { /* keep existing d */ }
            }
            const contentEl = document.getElementById('docContent');
            const passoEl = document.getElementById('docPassoContent');
            const titleEl = document.getElementById('docTitle');
            const descEl = document.getElementById('docDescription');
            const tagsEl = document.getElementById('docTags');

            if (typeof prepararNovaDocumentacao === 'function') prepararNovaDocumentacao();

            if (titleEl && d.title) titleEl.value = d.title || '';
            if (descEl && d.description) descEl.value = d.description || '';
            if (tagsEl && d.tags) tagsEl.value = d.tags || '';
            if (contentEl && d.content) contentEl.innerHTML = d.content || '';
            if (passoEl && d.passo) passoEl.innerHTML = d.passo || '';
            let resolvedType = d.type || 'normal';
            if (!d.type) {
                if (d.passo && (!d.content || d.content.toString().trim().length === 0)) {
                    resolvedType = 'passo-a-passo';
                }
            }
            if (document.getElementById('docType')) {
                document.getElementById('docType').value = resolvedType;
            }
            if (resolvedType === 'passo-a-passo') {
                const docPassoGroup = document.getElementById('docPassoGroup');
                const docContentGroup = document.getElementById('docContentGroup');
                if (docPassoGroup) docPassoGroup.style.display = 'block';
                if (docContentGroup) docContentGroup.style.display = 'none';
            } else {
                const docPassoGroup = document.getElementById('docPassoGroup');
                const docContentGroup = document.getElementById('docContentGroup');
                if (docPassoGroup) docPassoGroup.style.display = 'none';
                if (docContentGroup) docContentGroup.style.display = 'block';
            }

            // marcar como alterações não salvas (usuário precisa confirmar se sair sem salvar)
            hasUnsavedChanges = true;
        } catch (e) { /* ignore */ }
    }

    const btnAddDoc = document.getElementById('quickAddDocBtn');
    if (btnAddDoc) {
        btnAddDoc.addEventListener('click', () => {
            mudarSecao('adicionar');
            prepararNovaDocumentacao();
        });
    }
    // (removed small addBackBtn — navigation handled by previousSection and chat flow)
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
            const iconInput = document.getElementById('categoryIcon');
            if (iconInput) iconInput.value = '📂';
            document.getElementById('editingCategoryId').value = '';
            document.getElementById('categoryModalTitle').textContent = 'Adicionar Categoria';
            document.getElementById('categorySubmitBtn').textContent = '➕ Criar Categoria';
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
            const iconInput = document.getElementById('categoryIcon');
            if (iconInput) iconInput.value = '📂';
            document.getElementById('editingCategoryId').value = '';
            document.getElementById('categoryModalTitle').textContent = 'Adicionar Categoria';
            document.getElementById('categorySubmitBtn').textContent = '➕ Criar Categoria';
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
    setupMentionAutocomplete();

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
            const isPasso = currentEditVersion === 'passo' || currentEditVersion === 'passo-a-passo';
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

    const docCategorySelect = document.getElementById('docCategory');
    const docTitleInput = document.getElementById('docTitle');
    if (docCategorySelect && docTitleInput) {
        docCategorySelect.addEventListener('change', () => refreshTitlePrefixForInput(docTitleInput, docCategorySelect.value || 'todos'));
    }

    const editDocCategorySelect = document.getElementById('editDocCategory');
    const editDocTitleInput = document.getElementById('editDocTitle');
    if (editDocCategorySelect && editDocTitleInput) {
        editDocCategorySelect.addEventListener('change', () => refreshTitlePrefixForInput(editDocTitleInput, editDocCategorySelect.value || 'todos'));
    }

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

    function setupMentionAutocomplete() {
        const mentionPopup = document.getElementById('mentionPopup');
        const defaultMentionSuggestions = [
            { value: '@lorem', label: 'Lorem Ipsum', description: 'Lorem padrão em parágrafo normal' },
            { value: '@loremh1', label: 'Lorem H1', description: 'Lorem curto para título grande' },
            { value: '@loremh2', label: 'Lorem H2', description: 'Lorem médio para subtítulo' }
        ];
        let activeMention = null;

        function hideMentionPopup() {
            if (!mentionPopup) return;
            mentionPopup.classList.remove('visible');
            mentionPopup.setAttribute('aria-hidden', 'true');
            mentionPopup.innerHTML = '';
            activeMention = null;
        }

        function getChatCommandSuggestions(query) {
            const commands = getStoredAiCommandsSnapshot();
            const items = Object.entries(commands)
                .filter(([name]) => !activeChatCommandNames.includes(name.toLowerCase()))
                .map(([name, prompt]) => ({
                    value: `@${name}`,
                    label: name,
                    description: prompt ? prompt.substring(0, 80).trim() + (prompt.length > 80 ? '…' : '') : '',
                    insertValue: `@${name}`
                }));
            if (!query) return items;
            return items.filter(item => item.label.toLowerCase().startsWith(query.toLowerCase()));
        }

        function getMentionSuggestions(target, query) {
            if (target.type === 'textarea' && target.element && target.element.id === 'chatInput') {
                return getChatCommandSuggestions(query);
            }
            return defaultMentionSuggestions.filter(item => item.value.slice(1).toLowerCase().startsWith(query.toLowerCase()));
        }

        function buildMentionItems(query, target) {
            if (!mentionPopup) return [];
            const items = getMentionSuggestions(target, query);
            if (!items.length) {
                hideMentionPopup();
                return [];
            }
            mentionPopup.innerHTML = '';
            items.forEach((item, index) => {
                const button = document.createElement('button');
                button.type = 'button';
                button.className = 'mention-item';
                button.dataset.value = item.value;
                button.dataset.index = String(index);
                button.innerHTML = `<span class="mention-item-icon">@</span><strong>${item.label}</strong>`;
                button.addEventListener('mousedown', (event) => {
                    event.preventDefault();
                    applyMentionSuggestion(item);
                });
                mentionPopup.appendChild(button);
            });
            setActiveMentionIndex(0);
            return items;
        }

        function setActiveMentionIndex(index) {
            if (!mentionPopup) return;
            const items = Array.from(mentionPopup.querySelectorAll('.mention-item'));
            if (!items.length) return;
            const clamped = Math.max(0, Math.min(index, items.length - 1));
            items.forEach((item, idx) => item.classList.toggle('active', idx === clamped));
            if (!activeMention) return;
            activeMention.selectedIndex = clamped;
        }

        function positionMentionPopup(rect) {
            if (!mentionPopup || !rect) return;
            const popupWidth = mentionPopup.offsetWidth || 240;
            const popupHeight = mentionPopup.offsetHeight || 72;
            let top = Math.min(window.innerHeight - popupHeight - 8, rect.top + rect.height + 6);
            let left = Math.max(8, Math.min(window.innerWidth - popupWidth - 8, rect.left));
            if (rect.top - popupHeight - 6 > 0) {
                top = Math.max(8, rect.top - popupHeight - 6);
            }
            mentionPopup.style.position = 'fixed';
            mentionPopup.style.top = `${top}px`;
            mentionPopup.style.left = `${left}px`;
        }

        function showMentionPopup(target) {
            if (!mentionPopup || !target) return;
            const suggestions = buildMentionItems(target.query, target);
            if (!suggestions.length) return;
            positionMentionPopup(target.rect);
            mentionPopup.classList.add('visible');
            mentionPopup.setAttribute('aria-hidden', 'false');
            activeMention = {
                target,
                selectedIndex: 0,
                suggestions
            };
            setActiveMentionIndex(0);
        }

        function getMentionContextForTextarea(textarea) {
            if (!textarea) return null;
            const selectionStart = textarea.selectionStart;
            if (selectionStart === null || selectionStart === undefined) return null;
            const textBefore = textarea.value.slice(0, selectionStart);
            const match = textBefore.match(/@([\p{L}\p{N}_-]*)$/u);
            if (!match) return null;
            const query = match[1];
            const tokenStart = selectionStart - match[0].length;
            const rect = textarea.getBoundingClientRect();
            return { type: 'textarea', element: textarea, query, tokenStart, selectionStart, rect };
        }

        function getMentionContextForRichEditor(editor) {
            const sel = window.getSelection();
            if (!sel || sel.rangeCount === 0 || !sel.isCollapsed) return null;
            const focusNode = sel.focusNode;
            const focusOffset = sel.focusOffset;
            if (!focusNode) return null;

            let textNode = focusNode;
            let offset = focusOffset;
            if (textNode.nodeType !== Node.TEXT_NODE) {
                const findLastTextNode = (node) => {
                    if (!node) return null;
                    if (node.nodeType === Node.TEXT_NODE) return node;
                    for (let i = node.childNodes.length - 1; i >= 0; i--) {
                        const found = findLastTextNode(node.childNodes[i]);
                        if (found) return found;
                    }
                    return null;
                };

                let candidate = null;
                for (let i = offset - 1; i >= 0; i--) {
                    const child = textNode.childNodes[i];
                    const found = findLastTextNode(child);
                    if (found) {
                        candidate = found;
                        break;
                    }
                }
                textNode = candidate;
                if (!textNode) return null;
                offset = textNode.nodeValue ? textNode.nodeValue.length : 0;
            }
            if (!textNode || !textNode.nodeValue) return null;

            const textBefore = textNode.nodeValue.slice(0, offset);
            const match = textBefore.match(/@([\p{L}\p{N}_-]*)$/u);
            if (!match) return null;
            const tokenLength = match[0].length;
            const tokenStart = offset - tokenLength;
            const mentionRange = document.createRange();
            mentionRange.setStart(textNode, tokenStart);
            mentionRange.setEnd(textNode, offset);
            const rect = mentionRange.getBoundingClientRect() || mentionRange.getClientRects()[0];
            return { type: 'rich-editor', element: editor, query: match[1], range: mentionRange, rect };
        }

        function applyMentionSuggestion(suggestion) {
            if (!activeMention || !suggestion) return;
            const replacement = suggestion.insertValue || suggestion.value || '';
            if (activeMention.target.type === 'textarea') {
                const ta = activeMention.target.element;
                const before = ta.value.slice(0, activeMention.target.tokenStart);
                const after = ta.value.slice(activeMention.target.selectionStart);
                ta.value = (before + after).replace(/\s+/g, ' ').trimStart();
                const cursorPos = before.length;
                ta.setSelectionRange(cursorPos, cursorPos);
                ta.focus();
                if (ta.id === 'chatInput') {
                    const commandName = replacement.replace(/^@/, '').trim().toLowerCase();
                    if (commandName) {
                        addActiveChatCommands([commandName]);
                        chatMentionSelectionBlockedSend = true;
                    }
                }
            } else if (activeMention.target.type === 'rich-editor') {
                const range = activeMention.target.range;
                const fragmentData = createMentionFragmentForEditor(replacement, suggestion.value);
                const headingAncestor = findHeadingAncestor(range.startContainer, activeMention.target.element);
                range.deleteContents();
                if (headingAncestor) {
                    const insertRange = document.createRange();
                    insertRange.setStartAfter(headingAncestor);
                    insertRange.collapse(true);
                    insertRange.insertNode(fragmentData.fragment);
                } else {
                    range.insertNode(fragmentData.fragment);
                }
                const sel = window.getSelection();
                if (sel) {
                    sel.removeAllRanges();
                    const newRange = document.createRange();
                    newRange.setStartAfter(fragmentData.spaceNode);
                    newRange.collapse(true);
                    sel.addRange(newRange);
                }
                activeMention.target.element.focus();
            }
            hideMentionPopup();
        }

        function createMentionFragmentForEditor(replacement, suggestionValue) {
            const fragment = document.createDocumentFragment();
            let node;
            if (suggestionValue === '@loremh1' || suggestionValue === '@loremh2') {
                const span = document.createElement('span');
                span.style.display = 'inline';
                span.style.lineHeight = '1.2';
                span.style.whiteSpace = 'pre-wrap';
                if (suggestionValue === '@loremh1') {
                    span.style.fontSize = '24px';
                    span.style.fontWeight = '700';
                } else {
                    span.style.fontSize = '20px';
                    span.style.fontWeight = '600';
                }
                span.textContent = replacement;
                node = span;
            } else {
                node = document.createTextNode(replacement);
            }
            fragment.appendChild(node);
            const spaceNode = document.createTextNode(' ');
            fragment.appendChild(spaceNode);
            return { fragment, spaceNode };
        }

        function generateLoremTextForSuggestion(value) {
            if (value === '@loremh1') {
                return generateRandomWords(5, 8, false);
            }
            if (value === '@loremh2') {
                return generateRandomWords(7, 12, false);
            }
            if (value === '@lorem') {
                return generateRandomWords(18, 28, true);
            }
            return generateRandomWords(18, 28, true);
        }

        function generateRandomWords(minWords, maxWords, usePeriod = true) {
            const words = ['eiusmod', 'enim', 'ad', 'aliqua', 'magna', 'amet', 'aliquip', 'ut', 'tempor', 'exercitation', 'laboris', 'minim', 'dolor', 'sit', 'amet', 'consequat', 'nisi', 'veniam', 'eu', 'occaecat', 'culpa', 'quis', 'sint', 'deserunt'];
            const count = Math.floor(Math.random() * (maxWords - minWords + 1)) + minWords;
            const selected = [];
            for (let i = 0; i < count; i++) {
                selected.push(words[Math.floor(Math.random() * words.length)]);
            }
            let text = selected.join(' ');
            text = text.charAt(0).toUpperCase() + text.slice(1);
            if (usePeriod && !text.endsWith('.')) {
                text += '.';
            }
            return text;
        }

        function handleMentionTargetInput(event) {
            const target = event.currentTarget;
            let context = null;
            if (target.tagName === 'TEXTAREA') {
                context = getMentionContextForTextarea(target);
            } else {
                context = getMentionContextForRichEditor(target);
            }
            if (!context || context.query === null) {
                hideMentionPopup();
                return;
            }
            
            // Se já há um @ ativo no chatInput, não mostrar popup de comandos
            if (target.id === 'chatInput' && activeChatCommandNames && activeChatCommandNames.length > 0) {
                hideMentionPopup();
                return;
            }
            
            context.rect = context.rect || target.getBoundingClientRect();
            activeMention = { target: context, selectedIndex: 0, suggestions: [] };
            showMentionPopup(context);
        }

        function handleMentionTargetKeydown(event) {
            if (!activeMention || !mentionPopup.classList.contains('visible')) return;
            const key = event.key;
            const items = Array.from(mentionPopup.querySelectorAll('.mention-item'));
            if (!items.length) return;
            if (key === 'ArrowDown') {
                event.preventDefault();
                activeMention.selectedIndex = Math.min(activeMention.selectedIndex + 1, items.length - 1);
                setActiveMentionIndex(activeMention.selectedIndex);
                return;
            }
            if (key === 'ArrowUp') {
                event.preventDefault();
                activeMention.selectedIndex = Math.max(activeMention.selectedIndex - 1, 0);
                setActiveMentionIndex(activeMention.selectedIndex);
                return;
            }
            if (key === 'Enter' || key === 'Tab') {
                event.preventDefault();
                const suggestion = activeMention.suggestions[activeMention.selectedIndex];
                if (suggestion) applyMentionSuggestion(suggestion);
                return;
            }
            if (key === 'Escape') {
                event.preventDefault();
                hideMentionPopup();
                return;
            }
        }

        function isMentionTargetElement(element) {
            if (!element) return false;
            return !!element.closest('.rich-editor');
        }

        document.querySelectorAll('.rich-editor').forEach(editor => {
            editor.addEventListener('input', handleMentionTargetInput);
            editor.addEventListener('keyup', handleMentionTargetInput);
            editor.addEventListener('keydown', handleMentionTargetKeydown);
        });

        // não mais monitoramos o campo `aiSystemPrompt` aqui (removido da UI)

        const chatInputEl = document.getElementById('chatInput');
        if (chatInputEl) {
            chatInputEl.addEventListener('input', handleMentionTargetInput);
            chatInputEl.addEventListener('keyup', handleMentionTargetInput);
            chatInputEl.addEventListener('keydown', handleMentionTargetKeydown);
        }

        document.addEventListener('mousedown', (event) => {
            if (!mentionPopup) return;
            if (mentionPopup.contains(event.target)) return;
            hideMentionPopup();
        });
    }

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

    initializeAiKeyInputs();

    if (aiSettingsBtn && aiSettingsModal) {
        aiSettingsBtn.addEventListener('click', () => {
            setModalVisible('aiSettingsModal', true);
            setActiveAiTab('api');
            carregarConfigsIA();
        });
    }

    // Settings do IA (modal exclusivo) - Botão do Chat
    const chatSettingsBtn = document.getElementById('chatSettingsBtn');
    if (chatSettingsBtn && aiSettingsModal) {
        chatSettingsBtn.addEventListener('click', () => {
            setModalVisible('aiSettingsModal', true);
            setActiveAiTab('api');
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
    document.getElementById('saveApiSettingsBtn')?.addEventListener('click', salvarConfigsIA);
    document.getElementById('validateApiKeyBtn')?.addEventListener('click', () => validarApiKey({ silent: false }));
    document.getElementById('runConnectionTestBtn')?.addEventListener('click', testarConexaoIA);

    // Auto-save dos prompts em tempo real (com debounce)
    const sumSysPromptEl = document.getElementById('aiSummarySystemPrompt');
    if (sumSysPromptEl) {
        sumSysPromptEl.addEventListener('input', debounce(() => {
            autoSaveAISettings();
        }, 500));
    }

    // Auto-save dos toggles de visibilidade

    // Toggle visibilidade da API Key sem usar password
    const toggleAiKeyBtn = document.getElementById('toggleAiKeyBtn');
    if (toggleAiKeyBtn) {
        const eyeOpen = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true">'
            + '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/>'
            + '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"/>'
            + '</svg>';
        const eyeClosed = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true">'
            + '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 3l18 18"/>'
            + '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10.58 10.58A3 3 0 0113.42 13.42"/>'
            + '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M14.12 14.12C12.98 15.26 11.03 15.26 9.89 14.12"/>'
            + '</svg>';

        toggleAiKeyBtn.addEventListener('click', () => {
            const input = document.getElementById('aiApiKey');
            if (!input) return;
            const reveal = input.dataset.reveal === 'true';
            if (reveal) {
                setAiKeyInputValue(input, input.dataset.rawValue || '', false);
                toggleAiKeyBtn.innerHTML = eyeOpen;
                toggleAiKeyBtn.title = 'Mostrar chave';
            } else {
                setAiKeyInputValue(input, input.dataset.rawValue || '', true);
                toggleAiKeyBtn.innerHTML = eyeClosed;
                toggleAiKeyBtn.title = 'Ocultar chave';
            }
        });
    }

    // Controle de temperatura removido da UI

    // Botão de limpar chat
    document.getElementById('clearChatBtn')?.addEventListener('click', limparChat);
    // botão de limpar no topo (navbar)
    document.getElementById('clearChatTopBtn')?.addEventListener('click', limparChat);

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
    window.carregarConfigsIA = function carregarConfigsIA() {
        try {
            const ai = readPersistedAiConfig();
            if (ai) {
                const restoredKey = restoreAiApiKey();
                aiConfig = {
                    ...sanitizeAiConfigForStorage(ai || {}),
                    apiKey: aiConfig.apiKey || restoredKey || ''
                };
                persistAiConfig(aiConfig);
            }
        } catch(e){}
        aiConfig = aiConfig || { apiKey: '', model: '', provider: '' };
        aiConfig.commands = aiConfig.commands || {};
        const aiKeyInput = document.getElementById('aiApiKey');
        if (aiKeyInput) {
            configureAiKeyInput(aiKeyInput);
            const restoredKey = restoreAiApiKey();
            setAiKeyInputValue(aiKeyInput, aiConfig.apiKey || restoredKey || '', true);
            const btn = document.getElementById('validateApiKeyBtn');
            const badge = document.getElementById('apiKeyStatusBadge');
            if (getAiKeyInputValue(aiKeyInput)) {
                if (btn) btn.style.display = 'none';
                if (badge) {
                    badge.textContent = '⏳ Verificando chave salva...';
                    badge.style.display = 'block';
                    badge.classList.remove('valid');
                }
                if (aiAutoValidationTimer) clearTimeout(aiAutoValidationTimer);
                aiAutoValidationTimer = setTimeout(() => validarApiKey({ silent: true }), 250);
            } else if (btn) {
                btn.style.display = '';
                if (badge) badge.style.display = 'none';
            }
        }
        const selectedModel = aiConfig.model || document.querySelector('input[name="aiModel"]:checked')?.value || '';
        const selectedRadio = document.querySelector(`input[name="aiModel"][value="${selectedModel}"]`);
        if (selectedRadio) selectedRadio.checked = true;
        const aiSummaryEl = document.getElementById('aiSummarySystemPrompt');
        if (aiSummaryEl) aiSummaryEl.value = aiConfig.summarySystemPrompt || `Você é um assistente especializado em estruturar procedimentos em passos claros.

Formato obrigatório:

### Título da Seção

- Passo 1: descrição breve
- Passo 2: descrição breve
- Passo 3: descrição breve

### Outra Seção (se houver)

- Ação 1
- Ação 2

Responda sempre em português.
Use títulos (###) para separar seções principais.
Use bullet points (-) para listar ações dentro de cada seção.
Seja conciso mas informativo.`;
        
        // Selecionar modelo
        const modelRadios = document.querySelectorAll('input[name="aiModel"]');
        const defaultSelection = aiConfig.model || document.querySelector('input[name="aiModel"]:checked')?.value || '';
        modelRadios.forEach(radio => {
            if (radio.value === defaultSelection) {
                radio.checked = true;
            }
        });
    
        if (![...modelRadios].some(r => r.checked)) modelRadios[0].checked = true;

        // Garantir que o Summary System Prompt salvo apareça na UI imediatamente
        const sumSysEl = document.getElementById('aiSummarySystemPrompt');
        if (sumSysEl) sumSysEl.value = aiConfig.summarySystemPrompt || `Você é um assistente especializado em estruturar procedimentos em passos claros.

Formato obrigatório:

### Título da Seção

- Passo 1: descrição breve
- Passo 2: descrição breve
- Passo 3: descrição breve

### Outra Seção (se houver)

- Ação 1
- Ação 2

Responda sempre em português.
Use títulos (###) para separar seções principais.
Use bullet points (-) para listar ações dentro de cada seção.
Seja conciso mas informativo.`;

        try { renderAiCommandsUI(); } catch (e) { console.warn('renderAiCommandsUI failed', e); }
        document.getElementById('addAiCommandBtn')?.addEventListener('click', () => addAiCommandRow('', ''));
    };

    // Função de label de temperatura removida (controle de temperatura foi retirado da UI)

    // Validar API Key
    function validarApiKey(options = {}) {
        const { silent = false } = options;
        const apiKey = getAiKeyInputValue(document.getElementById('aiApiKey'));
        const badge = document.getElementById('apiKeyStatusBadge');
        const btn = document.getElementById('validateApiKeyBtn');

        if (!apiKey) {
            badge.classList.remove('valid');
            badge.textContent = '❌ API Key não foi preenchida';
            badge.style.display = 'block';
            if (btn) {
                btn.disabled = false;
                btn.textContent = '🔍 Validar Chave';
                btn.style.display = '';
            }
            return;
        }

        if (btn) {
            btn.disabled = true;
            btn.textContent = '⏳ Validando...';
            btn.style.display = silent ? 'none' : '';
        }

        // Detect provider: respeitar aiConfig.provider ou inferir pelo modelo selecionado
        const selectedModel = aiConfig.model || document.querySelector('input[name="aiModel"]:checked')?.value || '';
        let provider = aiConfig.provider || '';
        if (!provider) {
            provider = detectProviderFromApiKey(apiKey, selectedModel, aiConfig.provider || '');
        }
        const modelForTest = normalizeAiModel(selectedModel, provider);

        // Fazer requisição ao backend para validar (rota /validate)
        fetch(apiUrl('/api/validate'), {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ api_key: apiKey, model: modelForTest, provider: provider })
        })
        .then(async (res) => {
            let payload = null;
            try {
                payload = await res.json();
            } catch (e) {
                payload = null;
            }

            if (!res.ok) {
                const detail = payload?.error || payload?.detail || 'Falha na validação';
                badge.classList.remove('valid');
                badge.textContent = `⚠️ Servidor de IA indisponível: ${detail}`;
                badge.style.display = 'block';
                if (btn) {
                    btn.disabled = false;
                    btn.textContent = '🔍 Validar Chave';
                    btn.style.display = silent ? 'none' : '';
                }
                return;
            }

            if (payload?.valid) {
                badge.classList.add('valid');
                badge.textContent = '✅ API Key válida! Pronta para usar.';
            } else {
                badge.classList.remove('valid');
                badge.textContent = '❌ API Key inválida ou expirada: ' + (payload?.error || 'verifique a chave');
            }
            badge.style.display = 'block';
            if (btn) {
                btn.disabled = false;
                btn.textContent = '🔍 Validar Chave';
                btn.style.display = silent ? 'none' : '';
            }
        })
        .catch(err => {
            badge.classList.remove('valid');
            const message = /fetch|network|Failed to fetch|load failed/i.test(err?.message || '')
                ? '⚠️ Servidor de IA indisponível ou inacessível.'
                : '❌ Erro ao validar: ' + err.message;
            badge.textContent = message;
            badge.style.display = 'block';
            if (btn) {
                btn.disabled = false;
                btn.textContent = '🔍 Validar Chave';
                btn.style.display = silent ? 'none' : '';
            }
        });
    }

    // Verificar se servidor está online
    function verificarServerOnline(tentativas = 0) {
        return fetch(apiUrl('/api/health'), { method: 'GET' })
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
            return fetch(apiUrl('/api/validate'), {
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

            const providerCandidates = [];
            if (provider) providerCandidates.push(provider);
            const inferredProvider = detectProviderFromApiKey(apiKey, selected, aiConfig.provider || '');
            if (!providerCandidates.includes(inferredProvider)) providerCandidates.push(inferredProvider);
            if (!providerCandidates.includes('openai')) providerCandidates.push('openai');
            if (!providerCandidates.includes('genai')) providerCandidates.push('genai');
            if (!providerCandidates.includes('anthropic')) providerCandidates.push('anthropic');

            const providersToTry = providerCandidates.filter(Boolean);

            for (const prov of providersToTry) {
                let modelos = [];
                if (selected) modelos = [normalizeAiModel(selected, prov)];
                else if (prov === 'genai') modelos = [DEFAULT_GENAI_MODEL, 'gemini-1.5-pro'];
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
                setAiKeyInputValue(document.getElementById('aiApiKey'), apiKey, false);
                const radio = document.querySelector(`input[name="aiModel"][value="${modeloFuncional}"]`);
                if (radio) radio.checked = true;
                aiConfig.apiKey = '';
                aiConfig.model = modeloFuncional;
                aiConfig.provider = providerFuncional;
                const safeConfig = sanitizeAiConfigForStorage(aiConfig);
                safeConfig.apiKey = undefined;
                localStorage.setItem(STORAGE_AI, JSON.stringify(safeConfig));

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
        const apiKey = getAiKeyInputValue(document.getElementById('testApiKey'));
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
        const apiKey = getAiKeyInputValue(document.getElementById('aiApiKey'));
        const rawModel = document.querySelector('input[name="aiModel"]:checked')?.value || '';
        const model = normalizeAiModel(rawModel, inferProviderFromModel(rawModel));

        if (!apiKey) {
            showToast('❌ Preencha a chave de API', 'error');
            return;
        }

        // Ler apenas resumo (passo a passo) e demais configs
        const summarySystemPrompt = document.getElementById('aiSummarySystemPrompt')?.value || '';

        if (!aiConfig || typeof aiConfig !== 'object') aiConfig = {};
        aiConfig.apiKey = apiKey;
        aiConfig.model = model;
        aiConfig.summarySystemPrompt = summarySystemPrompt;
        aiConfig.commands = collectAiCommandsFromUI();
        // ler toggles de visibilidade (salvar também quando salvar configs)

        // Incluir provider inferido
        let provider = aiConfig.provider || '';
        if (!provider) {
            provider = detectProviderFromApiKey(apiKey, model, aiConfig.provider || '');
            aiConfig.provider = provider;
        }

        try {
            persistAiConfig(aiConfig);
            showToast('✅ Configurações de API salvas!', 'success');
            // Persistir no backend, não no navegador.
            try {
                const payload = {
                    api_key: apiKey,
                    model,
                    provider,
                    summary_system_prompt: summarySystemPrompt,
                    commands: aiConfig.commands || {}
                };
                fetch(apiUrl('/api/data'), {
                    method: 'POST',
                    credentials: 'include',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ kind: 'ai', data: payload })
                }).catch(e => console.warn('Erro ao persistir IA no backend', e));
                fetch(apiUrl('/api/set_summary_system_prompt'), {
                    method: 'POST',
                    credentials: 'include',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ api_key: apiKey, summary_system_prompt: summarySystemPrompt, model, provider, commands: aiConfig.commands || {} })
                }).then(res => res.json()).then(r => {
                    if (!r || !r.success) console.warn('Não foi possível persistir IA no backend', r);
                }).catch(e => console.warn('Erro ao persistir IA no backend', e));
            } catch (e) {
                console.warn('Erro fetch set_summary_system_prompt', e);
            }
        } catch (e) {
            console.error('[ERROR] salvarConfigsIA -> localStorage setItem failed', e);
            showToast('❌ Falha ao salvar configurações de IA', 'error');
            return;
        }

            // Marcar que o modal foi salvo, para que o fechamento não reverta alterações
        aiSettingsSaved = true;
        // Fechar modal de configurações de IA
        setModalVisible('aiSettingsModal', false);

        // Salvar o estado do chat e abrir de forma estável
        try {
            localStorage.setItem('dochub-chat-open-empty', 'false');
            localStorage.removeItem('dochub-chat-prefill');
            localStorage.setItem('dochub-chat-last-action', 'ai-settings-saved');
        } catch (e) {}

        // Se estamos na página do chat, apenas reprocessar a UI sem redirecionar.
        if (window.location.pathname.toLowerCase().endsWith('chat.html')) {
            try {
                if (typeof restoreChatScopeFromStorage === 'function') restoreChatScopeFromStorage();
                if (typeof loadChatHistory === 'function') loadChatHistory();
                const chatInput = document.getElementById('chatInput');
                if (chatInput) {
                    setTimeout(() => {
                        chatInput.focus();
                        chatInput.scrollIntoView({ block: 'end', behavior: 'smooth' });
                    }, 80);
                }
            } catch (e) {
                console.warn('Erro ao reabrir chat após salvar configurações', e);
            }
            return;
        }

        openChat();
    }

    // System Prompt removido da UI — funções de salvar/restaurar foram removidas.

    // Limpar chat
    function limparChat() {
        if (confirm('Tem certeza que deseja limpar o histórico do chat atual?')) {
            try {
                const storage = getChatStorageData();
                const key = getChatScopeKey(currentChatDocId);
                if (key === 'global') {
                    storage.global = [];
                } else {
                    if (storage.docs && typeof storage.docs === 'object') {
                        delete storage.docs[key];
                    }
                }
                setChatStorageData(storage);
            } catch (e) {
                console.warn('Erro ao limpar chat', e);
            }
            const chatMessages = document.getElementById('chatMessages');
            if (chatMessages) {
                chatMessages.innerHTML = '<div class="chat-message bot"><div class="message-content"><p>Olá! 👋 Sou seu assistente de IA. Faça perguntas sobre suas documentações.</p></div></div>';
                chatMessages.scrollTop = chatMessages.scrollHeight;
            }
            // notificar usuário
            if (currentChatDocId) {
                showToast('✅ Histórico do chat desta documentação removido', 'success');
            } else {
                showToast('✅ Histórico do chat global removido', 'success');
            }
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
// Chat mode/intent (session)
let currentChatMode = 'normal'; // 'normal' or 'passo'
let currentChatIntent = 'tirar-duvidas';

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
            
            if (idx === 0) {
                item.draggable = false;
                item.style.cursor = 'pointer'; // Permite clique para acessar
                // Remover opacity para permitir interação visual normal
            } else {
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
    
    restaurarEstadoInterfaceReordenacao();
    
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
        restaurarEstadoInterfaceReordenacao();
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

let pendingDeleteCategoryId = null;

function showToast(message, type = 'success', duration = 3000) {
    const container = document.getElementById('toastContainer');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.classList.add(`toast-${type}`);

    const msgEl = document.createElement('p');
    msgEl.className = 'toast-message';
    msgEl.textContent = message;

    const progressBar = document.createElement('div');
    progressBar.className = 'toast-progress-bar';
    // ajustar duração da animação da barra de progresso para o tempo do toast
    progressBar.style.animationDuration = `${duration}ms`;
    toast.appendChild(msgEl);
    toast.appendChild(progressBar);
    container.appendChild(toast);

    setTimeout(() => {
        toast.classList.add('fade-out');
        setTimeout(() => toast.remove(), 350);
    }, duration);
}

function promptDeleteCategory(catId) {
    const cat = categorias.find(c => c.id === catId);
    if (!cat) return;

    pendingDeleteCategoryId = catId;
    const title = document.getElementById('deleteCategoryConfirmTitle');
    const message = document.getElementById('deleteCategoryConfirmMessage');
    if (title) title.textContent = cat.nome;
    if (message) message.textContent = 'Tem certeza que deseja excluir esta categoria?';

    setModalVisible('deleteCategoryConfirmModal', true);
}

function cancelDeleteCategory() {
    pendingDeleteCategoryId = null;
    setModalVisible('deleteCategoryConfirmModal', false);
}

function confirmDeleteCategory() {
    const catId = pendingDeleteCategoryId;
    if (!catId) return;

    const cat = categorias.find(c => c.id === catId);
    if (!cat) {
        cancelDeleteCategory();
        return;
    }

    categorias = categorias.filter(c => c.id !== catId);
    documentacoes.forEach(d => {
        if (d.categoria === catId) d.categoria = categorias.length > 0 ? (categorias[0]?.id || 0) : 0;
    });
    salvarDados();
    renderizarCategorias();
    atualizarSelectsCategorias();
    renderizarDocumentacoes();
    atualizarStats();
    cancelDeleteCategory();
    showToast('✅ Categoria deletada!', 'error', 3500);
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

            const rawContent = version === 'normal' ? (doc.conteudo || '') : (doc.conteudoPasso || '');
            const contentToShow = sanitizeDocReadContent(rawContent);
            if (!contentToShow || contentToShow.trim() === '') {
                const label = version === 'normal' ? 'normal' : 'passo a passo';
                document.getElementById('modalContent').innerHTML = `<p style="opacity:0.8">⚠️ Nenhuma versão ${label} disponível.</p>`;
            } else {
                document.getElementById('modalContent').innerHTML = contentToShow;
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
                const passoBtn = document.getElementById('fullscreenEditToolbarBtnPasso');
                if (passoBtn) passoBtn.style.display = 'none';
            } else {
                document.getElementById('normalContentGroup').style.display = 'none';
                document.getElementById('passoContentGroup').style.display = 'block';
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

    const deleteCategoryConfirmModal = document.getElementById('deleteCategoryConfirmModal');
    if (deleteCategoryConfirmModal) {
        const cancelBtn = document.getElementById('cancelDeleteCategoryBtn');
        const confirmBtn = document.getElementById('confirmDeleteCategoryBtn');
        const closeBtn = document.querySelector('.close-delete-category');

        if (cancelBtn) cancelBtn.addEventListener('click', cancelDeleteCategory);
        if (confirmBtn) confirmBtn.addEventListener('click', confirmDeleteCategory);
        if (closeBtn) closeBtn.addEventListener('click', cancelDeleteCategory);

        window.addEventListener('click', (e) => {
            if (e.target === deleteCategoryConfirmModal) cancelDeleteCategory();
        });
    }
}

function inicializarRichEditor() {

    const allButtons = document.querySelectorAll('.editor-toolbar .editor-btn[data-command]');
    const formatPopup = document.getElementById('formatPopup');
    const formatPopupButtons = formatPopup ? formatPopup.querySelectorAll('.format-btn') : [];
    let formatPopupEditor = null;
    let formatPopupRange = null;
    let formatPopupMouseDown = false;

    function hideFormatPopup() {
        if (!formatPopup) return;
        formatPopup.classList.remove('visible');
        formatPopup.setAttribute('aria-hidden', 'true');
        formatPopup.style.display = '';
        formatPopup.style.visibility = '';
        formatPopup.style.top = '';
        formatPopup.style.left = '';
        formatPopupEditor = null;
        formatPopupRange = null;
    }

    function showFormatPopupForSelection() {
        if (!formatPopup) return hideFormatPopup();
        const sel = window.getSelection();
        if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return hideFormatPopup();
        const editor = getRichEditorFromSelection();
        if (!editor) return hideFormatPopup();
        const range = sel.getRangeAt(0);
        if (range.collapsed) return hideFormatPopup();

        let rect = range.getBoundingClientRect();
        if (!rect || (!rect.width && !rect.height)) {
            const rects = range.getClientRects();
            rect = rects && rects[0] ? rects[0] : null;
        }
        if (!rect) return hideFormatPopup();

        formatPopup.style.position = 'fixed';
        formatPopup.style.display = 'flex';
        formatPopup.style.visibility = 'hidden';
        formatPopup.style.top = '0';
        formatPopup.style.left = '0';
        formatPopup.classList.add('visible');

        const popupWidth = formatPopup.offsetWidth || 280;
        const popupHeight = formatPopup.offsetHeight || 52;
        const top = Math.max(8, rect.top - popupHeight - 10);
        const left = Math.min(window.innerWidth - popupWidth - 8, Math.max(8, rect.left + rect.width / 2 - popupWidth / 2));

        formatPopup.style.top = `${top}px`;
        formatPopup.style.left = `${left}px`;
        formatPopup.style.visibility = '';
        formatPopup.setAttribute('aria-hidden', 'false');

        formatPopupEditor = editor;
        formatPopupRange = range.cloneRange();
    }

    function getRichEditorFromSelection() {
        try {
            const sel = window.getSelection();
            if (!sel || sel.rangeCount === 0) return null;
            let node = sel.getRangeAt(0).commonAncestorContainer;
            if (!node) return null;
            if (node.nodeType === Node.TEXT_NODE) node = node.parentElement;
            return node ? node.closest('.rich-editor') : null;
        } catch (e) {
            return null;
        }
    }

    const blockTags = new Set(['ADDRESS','ARTICLE','ASIDE','AUDIO','BLOCKQUOTE','CANVAS','DD','DIV','DL','DT','FIELDSET','FIGCAPTION','FIGURE','FOOTER','FORM','H1','H2','H3','H4','H5','H6','HEADER','HGROUP','HR','LI','MAIN','NAV','NOSCRIPT','OL','OUTPUT','P','PRE','SECTION','TABLE','TFOOT','UL','VIDEO']);

    function sanitizeSelectionContents(root, format) {
        if (!root) return;
        if (root.nodeType === Node.ELEMENT_NODE || root.nodeType === Node.DOCUMENT_FRAGMENT_NODE) {
            const el = root.nodeType === Node.ELEMENT_NODE ? root : null;
            Array.from(root.childNodes).forEach(child => sanitizeSelectionContents(child, format));

            if (el) {
                if (format === 'p') {
                    const tag = el.tagName;
                    if (tag && tag.match(/^H[1-6]$/)) {
                        const paragraph = document.createElement('p');
                        while (el.firstChild) paragraph.appendChild(el.firstChild);
                        el.replaceWith(paragraph);
                        sanitizeSelectionContents(paragraph, format);
                        return;
                    }
                }

                if (el.style) {
                    el.style.fontSize = '';
                    el.style.fontWeight = '';
                    el.style.lineHeight = '';
                    el.style.whiteSpace = '';
                    el.style.display = '';
                    if (!el.getAttribute('style') || !el.getAttribute('style').trim()) {
                        el.removeAttribute('style');
                    }
                }

                if (el.tagName === 'SPAN') {
                    const preserveAttr = Array.from(el.attributes).some(attr => attr.name !== 'style');
                    if (!preserveAttr) {
                        const parent = el.parentNode;
                        if (parent) {
                            while (el.firstChild) parent.insertBefore(el.firstChild, el);
                            parent.removeChild(el);
                        }
                    }
                }
            }
        }
    }

    function setFormatStyles(el, format) {
        if (!el || !el.style) return;
        if (format === 'h1') {
            el.style.fontSize = '24px';
            el.style.fontWeight = '700';
            el.style.lineHeight = '1.2';
        } else if (format === 'h2') {
            el.style.fontSize = '20px';
            el.style.fontWeight = '600';
            el.style.lineHeight = '1.25';
        } else if (format === 'h3') {
            el.style.fontSize = '18px';
            el.style.fontWeight = '600';
            el.style.lineHeight = '1.3';
        } else if (format === 'p') {
            el.style.fontSize = '';
            el.style.fontWeight = '';
            el.style.lineHeight = '';
            el.style.whiteSpace = '';
        }
    }

    function getHeadingStyledSpan(node) {
        let current = node;
        if (current && current.nodeType === Node.TEXT_NODE) current = current.parentElement;
        while (current) {
            if (current.tagName && current.tagName.toLowerCase() === 'span') {
                try {
                    const fs = window.getComputedStyle(current).fontSize || '';
                    if (fs === '24px' || fs === '20px' || fs === '18px') return current;
                } catch (e) {}
            }
            current = current.parentElement;
        }
        return null;
    }

    function normalizeParagraphFragment(root) {
        if (!root) return;
        const headingSpans = [];
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT, null, false);
        while (walker.nextNode()) {
            const el = walker.currentNode;
            if (!el || el.tagName.toLowerCase() !== 'span') continue;
            try {
                const fs = window.getComputedStyle(el).fontSize || '';
                if (fs === '24px' || fs === '20px' || fs === '18px') {
                    el.style.fontSize = '';
                    el.style.fontWeight = '';
                    el.style.lineHeight = '';
                    el.style.whiteSpace = '';
                    el.style.display = '';
                    const preserveAttr = Array.from(el.attributes).some(attr => attr.name !== 'style');
                    if (!preserveAttr) headingSpans.push(el);
                }
            } catch (e) {}
        }
        headingSpans.forEach(el => {
            const parent = el.parentNode;
            if (!parent) return;
            while (el.firstChild) parent.insertBefore(el.firstChild, el);
            parent.removeChild(el);
        });
    }

    function wrapSelectionInStyle(range, format) {
        if (format === 'p') {
            const startHeading = getHeadingStyledSpan(range.startContainer);
            const endHeading = getHeadingStyledSpan(range.endContainer);
            if (startHeading && endHeading && startHeading === endHeading) {
                range.setStartBefore(startHeading);
                range.setEndAfter(endHeading);
            }
        }

        const extracted = range.extractContents();
        sanitizeSelectionContents(extracted, format);
        normalizeParagraphFragment(extracted);

        const formattedFragment = document.createDocumentFragment();
        const children = Array.from(extracted.childNodes);
        const hasBlockChildren = children.some(node => node.nodeType === Node.ELEMENT_NODE && blockTags.has(node.tagName));
        let lastInsertedNode = null;

        if (!hasBlockChildren) {
            if (format === 'p') {
                formattedFragment.appendChild(extracted);
                lastInsertedNode = formattedFragment.lastChild;
            } else {
                const wrapper = document.createElement('span');
                wrapper.style.whiteSpace = 'pre-wrap';
                wrapper.style.display = 'inline';
                setFormatStyles(wrapper, format);
                wrapper.appendChild(extracted);
                formattedFragment.appendChild(wrapper);
                lastInsertedNode = wrapper;
            }
        } else {
            children.forEach(node => {
                if (format === 'p') {
                    if (node.nodeType === Node.ELEMENT_NODE && blockTags.has(node.tagName)) {
                        if (node.tagName.toLowerCase() === 'span') {
                            const heading = getHeadingStyledSpan(node);
                            if (heading === node) {
                                const replacement = document.createElement('span');
                                while (node.firstChild) replacement.appendChild(node.firstChild);
                                unwrapHeadingSpans(replacement);
                                formattedFragment.appendChild(replacement);
                                lastInsertedNode = replacement;
                                return;
                            }
                        }
                        setFormatStyles(node, format);
                        formattedFragment.appendChild(node);
                        lastInsertedNode = node;
                    } else {
                        formattedFragment.appendChild(node);
                        lastInsertedNode = node;
                    }
                } else {
                    if (node.nodeType === Node.TEXT_NODE) {
                        const wrapper = document.createElement('span');
                        wrapper.style.whiteSpace = 'pre-wrap';
                        wrapper.style.display = 'inline';
                        setFormatStyles(wrapper, format);
                        wrapper.appendChild(node);
                        formattedFragment.appendChild(wrapper);
                        lastInsertedNode = wrapper;
                    } else if (node.nodeType === Node.ELEMENT_NODE && blockTags.has(node.tagName)) {
                        setFormatStyles(node, format);
                        formattedFragment.appendChild(node);
                        lastInsertedNode = node;
                    } else if (node.nodeType === Node.ELEMENT_NODE) {
                        setFormatStyles(node, format);
                        formattedFragment.appendChild(node);
                        lastInsertedNode = node;
                    } else {
                        formattedFragment.appendChild(node);
                        lastInsertedNode = node;
                    }
                }
            });
        }

        range.insertNode(formattedFragment);

        if (lastInsertedNode) {
            const sel = window.getSelection();
            if (sel) {
                sel.removeAllRanges();
                const afterRange = document.createRange();
                try {
                    afterRange.setStartAfter(lastInsertedNode);
                } catch (e) {
                    afterRange.setStart(range.endContainer, range.endOffset);
                }
                afterRange.collapse(true);
                sel.addRange(afterRange);
            }
        }
    }

    function applyFormatToSelection(format) {
        const sel = window.getSelection();
        if (!sel) return;
        if ((!sel.rangeCount || sel.isCollapsed) && formatPopupRange) {
            sel.removeAllRanges();
            sel.addRange(formatPopupRange.cloneRange());
        }

        if (!sel.rangeCount || sel.isCollapsed) return;

        if (['bold', 'italic', 'underline'].includes(format)) {
            document.execCommand(format, false, null);
        } else if (['p', 'h1', 'h2', 'h3'].includes(format)) {
            const range = sel.getRangeAt(0);
            wrapSelectionInStyle(range, format);
        }

        hideFormatPopup();
    }

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
                if (tag === 'h1' || tag === 'h2' || tag === 'h3') return true;
                if (tag === 'span') {
                    try {
                        const fs = window.getComputedStyle(node).fontSize || '';
                        if (fs === '24px' || fs === '20px' || fs === '18px') return true;
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
                        wrapSelectionInStyle(range, value);

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
                                    if (value === 'h1') return fs === '24px';
                                    if (value === 'h2') return fs === '20px';
                                    if (value === 'h3') return fs === '18px';
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
                                if (value === 'h1') {
                                    spanNew.style.fontSize = '24px';
                                    spanNew.style.fontWeight = '700';
                                    spanNew.style.lineHeight = '1.2';
                                } else if (value === 'h2') {
                                    spanNew.style.fontSize = '20px';
                                    spanNew.style.fontWeight = '600';
                                    spanNew.style.lineHeight = '1.25';
                                } else if (value === 'h3') {
                                    spanNew.style.fontSize = '18px';
                                    spanNew.style.fontWeight = '600';
                                    spanNew.style.lineHeight = '1.3';
                                } else if (value === 'p') {
                                    spanNew.style.fontSize = '16px';
                                    spanNew.style.fontWeight = '400';
                                    spanNew.style.lineHeight = '1.6';
                                }

                                const zw = document.createTextNode('\u200B');
                                spanNew.appendChild(zw);

                                range2.insertNode(spanNew);

                                // Place caret after the new span so typing continues in paragraph.
                                const newRange = document.createRange();
                                newRange.setStartAfter(spanNew);
                                newRange.collapse(true);
                                sel2.removeAllRanges();
                                sel2.addRange(newRange);
                                editorDiv.focus();

                                if (editorDiv && editorDiv.dataset) editorDiv.dataset.stickyFormat = '';
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
            editor.addEventListener('keyup', () => {
                updateToolbarButtons(toolbar, editor);
                showFormatPopupForSelection();
            });
            editor.addEventListener('mouseup', () => {
                updateToolbarButtons(toolbar, editor);
                setTimeout(showFormatPopupForSelection, 0);
            });
            editor.addEventListener('focus', () => { updateToolbarButtons(toolbar, editor); lastFocusedEditorId = editor.id; });
            editor.addEventListener('blur', () => {
                setTimeout(() => {
                    updateToolbarButtons(toolbar, editor);
                    hideFormatPopup();
                }, 10);
            });
        }
    });

    document.addEventListener('mousedown', (event) => {
        if (!formatPopup) return;
        if (formatPopup.contains(event.target)) {
            formatPopupMouseDown = true;
            return;
        }
        if (!event.target.closest('.rich-editor')) {
            hideFormatPopup();
        }
    });

    document.addEventListener('mouseup', () => {
        formatPopupMouseDown = false;
    });

    if (formatPopupButtons && formatPopupButtons.length) {
        formatPopupButtons.forEach(button => {
            button.addEventListener('mousedown', (event) => {
                event.preventDefault();
                formatPopupMouseDown = true;
            });
            button.addEventListener('click', (event) => {
                event.preventDefault();
                const format = button.dataset.format;
                applyFormatToSelection(format);
            });
        });
    }

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
                            const normalizedText = (node.textContent || '').replace(/\u200B/g, '').trim();
                            if ((fs === '24px' || fs === '20px') && !sticky && !normalizedText) {
                                // unwrap only empty heading spans or placeholder-only spans
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

    const docEditorImageBtn = document.getElementById('docEditorImageBtn');
    docEditorImageBtn?.addEventListener('click', (e) => {
        e.preventDefault();
        const editor = document.getElementById('docContent');
        const placeholder = insertManualImagePlaceholderAtCursor(editor);
        if (placeholder) placeholder.scrollIntoView({ block: 'nearest' });
    });

    document.getElementById('docEditorImageInput')?.addEventListener('change', (e) => {
        if (pendingImagePlaceholderForNormalDoc && pendingImagePlaceholderForNormalDoc.dataset.editor === 'docContent') {
            inserirImagemNoEditorAtPlaceholder(e.target.files, pendingImagePlaceholderForNormalDoc, 'docContent');
            pendingImagePlaceholderForNormalDoc = null;
        } else {
            restoreSelectionForEditor('docContent');
            inserirImagemNoEditor(e.target.files, 'docContent');
        }
        e.target.value = '';
    });

    const docPassoImageBtn = document.getElementById('docPassoImageBtn');
    docPassoImageBtn?.addEventListener('mousedown', () => saveSelectionForEditor('docPassoContent'));
    docPassoImageBtn?.addEventListener('click', (e) => {
        e.preventDefault();
        document.getElementById('docPassoEditorImageInput').click();
    });

    document.getElementById('docPassoEditorImageInput')?.addEventListener('change', (e) => {
        restoreSelectionForEditor('docPassoContent');
        inserirImagemNoEditor(e.target.files, 'docPassoContent');
        e.target.value = '';
    });

    const editDocEditorImageBtn = document.getElementById('editDocEditorImageBtn');
    editDocEditorImageBtn?.addEventListener('click', (e) => {
        e.preventDefault();
        const editor = document.getElementById('editDocContent');
        const placeholder = insertManualImagePlaceholderAtCursor(editor);
        if (placeholder) placeholder.scrollIntoView({ block: 'nearest' });
    });

    document.getElementById('editDocEditorImageInput')?.addEventListener('change', (e) => {
        if (pendingImagePlaceholderForNormalDoc && pendingImagePlaceholderForNormalDoc.dataset.editor === 'editDocContent') {
            inserirImagemNoEditorAtPlaceholder(e.target.files, pendingImagePlaceholderForNormalDoc, 'editDocContent');
            pendingImagePlaceholderForNormalDoc = null;
        } else {
            restoreSelectionForEditor('editDocContent');
            inserirImagemNoEditor(e.target.files, 'editDocContent');
        }
        e.target.value = '';
    });

    const editDocPassoImageBtn = document.getElementById('editDocPassoImageBtn');
    editDocPassoImageBtn?.addEventListener('mousedown', () => saveSelectionForEditor('editDocPassoContent'));
    editDocPassoImageBtn?.addEventListener('click', (e) => {
        e.preventDefault();
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

        if (editor.id === 'docContent' || editor.id === 'editDocContent') {
            editor.addEventListener('keydown', (e) => {
                handleRichEditorEnter(editor, e);
                if (e.defaultPrevented) return;

                if (e.key !== 'Backspace' && e.key !== 'Delete') {
                    if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
                        ensureParagraphTyping(editor);
                    }
                    preserveImagePlaceholderBlock(editor);
                    return;
                }
                const sel = window.getSelection();
                if (!sel || !sel.rangeCount || !sel.isCollapsed) return;
                const range = sel.getRangeAt(0);
                let node = range.startContainer;
                if (node.nodeType === Node.TEXT_NODE) node = node.parentNode;
                if (!node) return;
                let block = node;
                while (block && block.parentNode !== editor) {
                    block = block.parentNode;
                }
                if (!block || block.parentNode !== editor) return;

                if (e.key === 'Backspace' || e.key === 'Delete') {
                    const paragraph = node.closest('p[data-image-paragraph="true"]');
                    const previousBlock = paragraph && paragraph.previousElementSibling;
                    const isImageSpacingParagraph = paragraph && previousBlock && previousBlock.classList.contains('doc-image-placeholder-wrapper') && (!paragraph.textContent || paragraph.textContent.trim() === '' || paragraph.innerHTML === '<br>' || paragraph.innerHTML === '<br/>');
                    if (isImageSpacingParagraph) {
                        e.preventDefault();
                        paragraph.innerHTML = '<br>';
                        preserveImagePlaceholderBlock(editor);
                        return;
                    }
                }
            });
            editor.addEventListener('click', (e) => {
                const removeBtn = e.target.closest('.doc-image-placeholder-remove-btn');
                if (removeBtn) {
                    const wrapper = removeBtn.closest('.doc-image-placeholder-wrapper');
                    if (!wrapper || wrapper.dataset.aiVisual === 'true' || wrapper.classList.contains('ai-image-placeholder')) return;
                    const next = wrapper.nextElementSibling;
                    if (next) imagePlaceholderDisabledNodes.add(next);
                    wrapper.remove();
                    return;
                }

                const btn = e.target.closest('.doc-image-placeholder-btn');
                if (!btn) return;
                const wrapper = btn.closest('.doc-image-placeholder-wrapper');
                if (!wrapper || wrapper.dataset.aiVisual === 'true' || wrapper.classList.contains('ai-image-placeholder')) return;
                pendingImagePlaceholderForNormalDoc = wrapper;
                const editorId = wrapper.dataset.editor;
                if (editorId === 'editDocContent') {
                    document.getElementById('editDocEditorImageInput')?.click();
                } else {
                    document.getElementById('docEditorImageInput')?.click();
                }
            });
            editor.addEventListener('input', () => {
                replaceImageShortcutTokens(editor);
                stripRichEditorListFormatting(editor);
                ensureImagePlaceholdersInNormalEditor(editor);
                preserveImagePlaceholderBlock(editor);
            });
            editor.addEventListener('keyup', () => {
                replaceImageShortcutTokens(editor);
                stripRichEditorListFormatting(editor);
                ensureImagePlaceholdersInNormalEditor(editor);
                preserveImagePlaceholderBlock(editor);
            });
            editor.addEventListener('focus', () => {
                ensureImagePlaceholdersInNormalEditor(editor);
                preserveImagePlaceholderBlock(editor);
            });
        }
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

                // otherwise, just open the chat page
            openChat();
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
                    if (t === 'h1' || t === 'h2' || t === 'h3') return t;
                    if (t === 'span') {
                        try {
                            const fs = window.getComputedStyle(node).fontSize || '';
                            if (fs === '24px') return 'h1';
                            if (fs === '20px') return 'h2';
                            if (fs === '18px') return 'h3';
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

    let activeFormat = '';
    if (!hasSelection) {
        try {
            const sticky = editor.dataset?.stickyFormat || '';
            if (sticky) {
                activeFormat = sticky;
            } else if (currentHeading) {
                activeFormat = currentHeading;
            } else {
                activeFormat = 'p';
            }
        } catch (e) {
            activeFormat = 'p';
        }
    }

    const isHeadingFormat = activeFormat && activeFormat !== 'p';

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
            if (!hasSelection && activeFormat && activeFormat === value) {
                btn.classList.add('active');
            }
        } else if (['bold', 'italic', 'underline'].includes(command)) {
            if (command === 'bold' && isHeadingFormat) {
                btn.disabled = true;
                btn.classList.add('disabled');
                btn.classList.remove('active');
            } else {
                let isActive = false;
                try { isActive = document.queryCommandState(command); } catch (e) { isActive = false; }
                if (!hasSelection) {
                    const sticky = editor.dataset?.stickyFormat || '';
                    if (sticky === command) isActive = true;
                }
                if (isActive) btn.classList.add('active');
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
                // Após inicializar todos os editores, tentar restaurar rascunho (priorizar sessão)
                try {
                    const hasSessionPayload = (() => { try { return !!sessionStorage.getItem('dochub-chat-session-return-payload'); } catch(e){ return false; } })();
                    const hasLocalPayload = (() => { try { return !!localStorage.getItem('dochub-chat-return-payload') || !!localStorage.getItem(STORAGE_SIDEBAR_DRAFT) || !!localStorage.getItem('dochub-debug-last-saved-draft'); } catch(e){ return false; } })();
                    if (hasSessionPayload || hasLocalPayload) {
                        try { if (typeof restaurarRascunhoAdicionar === 'function') restaurarRascunhoAdicionar(); } catch(e) {}
                    }
                } catch(e) {}
            }
        } catch (e) {}

        // update toolbar visuals if toolbar exists
        const toolbar = editor.previousElementSibling;
        if (toolbar && toolbar.classList.contains('editor-toolbar')) updateToolbarButtons(toolbar, editor);
    } catch (e) {}
}

function findHeadingAncestor(node, editor, offset) {
    try {
        if (!node) return null;
        let current = node;
        if (current.nodeType === Node.TEXT_NODE) current = current.parentElement;

        if (current === editor && typeof offset === 'number' && offset > 0) {
            const previousNode = editor.childNodes[offset - 1];
            if (previousNode && previousNode.nodeType === Node.ELEMENT_NODE && previousNode.tagName.toLowerCase() === 'span') {
                try {
                    const fs = window.getComputedStyle(previousNode).fontSize || '';
                    if (fs === '24px' || fs === '20px' || fs === '18px') {
                        return previousNode;
                    }
                } catch (e) {}
            }
        }

        while (current && current !== editor) {
            if (current.tagName && current.tagName.toLowerCase() === 'span') {
                try {
                    const fs = window.getComputedStyle(current).fontSize || '';
                    if (fs === '24px' || fs === '20px' || fs === '18px') {
                        return current;
                    }
                } catch (e) {}
            }
            current = current.parentElement;
        }
    } catch (e) {}
    return null;
}

function ensureParagraphTyping(editor) {
    try {
        const sel = window.getSelection();
        if (!sel || sel.rangeCount === 0 || !sel.isCollapsed) return false;
        const range = sel.getRangeAt(0);
        const headingSpan = findHeadingAncestor(range.startContainer, editor, range.startOffset);
        if (!headingSpan) return false;

        const endRange = document.createRange();
        endRange.selectNodeContents(headingSpan);
        endRange.collapse(false);
        if (range.compareBoundaryPoints(Range.START_TO_END, endRange) !== 0) return false;

        const afterRange = document.createRange();
        afterRange.setStartAfter(headingSpan);
        afterRange.collapse(true);
        sel.removeAllRanges();
        sel.addRange(afterRange);

        if (editor && editor.dataset) editor.dataset.stickyFormat = '';
        return true;
    } catch (e) {
        return false;
    }
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
                        let insertNode = null;
                        
                        if (selection && selection.rangeCount > 0) {
                            const range = selection.getRangeAt(0);
                            const commonAncestor = range.commonAncestorContainer;

                            let node = commonAncestor && commonAncestor.nodeType === Node.TEXT_NODE ? 
                                       commonAncestor.parentNode : commonAncestor;
                            
                            while (node && node.parentNode !== editor) {
                                node = node.parentNode;
                            }
                            
                            if (node && node.parentNode === editor) {
                                insertNode = node;
                            }
                        }

                        if (insertNode) {
                            editor.insertBefore(newP, insertNode);
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

    // Chat header/topBar and options removed per user request

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

    const tituloInput = document.getElementById('docTitle');
    const descricaoInput = document.getElementById('docDescription');
    const categorySelect = document.getElementById('docCategory');
    const tagsInput = document.getElementById('docTags');
    const docContentEl = document.getElementById('docContent');

    if (!tituloInput || !descricaoInput || !categorySelect || !tagsInput) {
        alert('❌ Erro interno: campos obrigatórios não encontrados.');
        return;
    }

    const descricao = descricaoInput.value.trim();
    cleanNormalDocImagePlaceholders(docContentEl);
    const conteudo = docContentEl ? docContentEl.innerHTML.trim() : '';

    const docPassoEl = document.getElementById('docPassoContent');
    const conteudoPasso = docPassoEl ? docPassoEl.innerHTML.trim() : '';
    const tipoSelecionado = document.getElementById('docType') ? document.getElementById('docType').value : 'normal';
    let catId = parseInt(categorySelect.value) || 0;
    let tags = tagsInput.value.split(',').map(t => {
        let tag = t.trim();
        if (tag.startsWith('#')) tag = tag.substring(1);
        return tag;
    }).filter(t => t);

    if (tags.length === 0) {
        alert('❌ Adicione pelo menos uma tag!');
        return;
    }

    const tituloRaw = tituloInput ? String(tituloInput.value || '').trim() : '';
    if (!tituloRaw || !descricao) {
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

    const titulo = buildDocTitleWithCategory(tituloRaw, catId);
    if (tituloInput) {
        tituloInput.value = titulo;
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
                <div class="doc-title" title="${doc.titulo}">${doc.titulo}</div>
            </div>
            <div class="card-body">
                <p class="doc-description" title="${doc.descricao}">${doc.descricao}</p>
            </div>
            <div class="doc-footer">
                ${tagsHTML}
                <div class="doc-footer-meta">
                    <div class="doc-category">${getNomeCategoria(doc.categoria)}</div>
                    <span class="doc-date">📅 ${doc.dataCriacao}</span>
                </div>
                <div class="doc-footer-actions">
                    <button class="doc-open-btn btn-primary btn-small" aria-label="Abrir documentação">Abrir</button>
                </div>
            </div>
        `;
        // Anexar o card ao container e configurar handlers:
        // - Clicar em qualquer área do card abre o documento
        // - A descrição (`.doc-description`) NÃO abre (click é bloqueado)
        container.appendChild(card);

        // adicionar SVG overlay para animação do contorno (calculamos o perímetro dinamicamente)
        try {
            const svgNS = 'http://www.w3.org/2000/svg';
            const wrapperSvg = document.createElement('div');
            wrapperSvg.className = 'card-border-svg';

            const svgEl = document.createElementNS(svgNS, 'svg');
            svgEl.setAttribute('preserveAspectRatio', 'none');
            svgEl.setAttribute('width', '100%');
            svgEl.setAttribute('height', '100%');
            svgEl.setAttribute('viewBox', '0 0 100 100');

            const rectEl = document.createElementNS(svgNS, 'rect');
            rectEl.setAttribute('x', '1');
            rectEl.setAttribute('y', '1');
            rectEl.setAttribute('width', '98');
            rectEl.setAttribute('height', '98');
            rectEl.setAttribute('rx', '8');
            rectEl.setAttribute('ry', '8');

            svgEl.appendChild(rectEl);
            wrapperSvg.appendChild(svgEl);
            card.appendChild(wrapperSvg);

            // Preserva a animação de borda e o fade-out suave quando o mouse sai do card.
            card.addEventListener('mouseenter', () => {
                const rect = card.querySelector('.card-border-svg rect');
                if (rect) {
                    rect.style.animation = 'none';
                    rect.style.strokeDashoffset = String(rect.getTotalLength());
                    void rect.offsetWidth;
                    rect.style.animation = '';
                }
                card.classList.remove('card-hovering', 'card-leaving');
                clearTimeout(card._hoverLeaveTimeout);
                clearTimeout(card._hoverCompleteTimeout);
                card.classList.add('card-hovering');
                card._hoverCompleteTimeout = setTimeout(() => {
                    if (card.classList.contains('card-hovering')) {
                        card.classList.remove('card-hovering');
                        card.classList.add('card-complete');
                    }
                }, 900);
            });

            card.addEventListener('mouseleave', () => {
                const rect = card.querySelector('.card-border-svg rect');
                if (rect) {
                    rect.style.animation = 'none';
                    void rect.offsetWidth;
                    rect.style.animation = '';
                }
                clearTimeout(card._hoverLeaveTimeout);
                clearTimeout(card._hoverCompleteTimeout);
                card.classList.remove('card-hovering');
                card.classList.add('card-leaving');
                card._hoverLeaveTimeout = setTimeout(() => {
                    card.classList.remove('card-leaving');
                    if (rect) {
                        rect.style.animation = 'none';
                        rect.style.strokeDashoffset = String(rect.getTotalLength());
                        rect.style.opacity = '';
                    }
                }, 1400);
            });

            // após layout, calcular perímetro aproximado (2*(w+h)) e aplicar como --dashlen
            setTimeout(() => {
                try {
                    const r = card.getBoundingClientRect();
                    const w = Math.max(0, Math.round(r.width));
                    const h = Math.max(0, Math.round(r.height));
                    const perim = Math.max(40, Math.round(2 * (w + h - 4)));
                    rectEl.style.setProperty('--dashlen', perim);
                    // ajustar viewBox e rect para cobrir o cartão com pequena margem
                    svgEl.setAttribute('viewBox', `0 0 ${w} ${h}`);
                    rectEl.setAttribute('x', '2');
                    rectEl.setAttribute('y', '2');
                    rectEl.setAttribute('width', String(Math.max(0, w - 4)));
                    rectEl.setAttribute('height', String(Math.max(0, h - 4)));
                } catch (e) { /* silencioso */ }
            }, 60);
        } catch (e) { /* silencioso */ }

        // abrir ao clicar no card (qualquer lugar exceto elementos que chamem stopPropagation)
        card.addEventListener('click', () => abrirDocumento(doc));

        const titleEl = card.querySelector('.doc-title');
        if (titleEl) {
            titleEl.style.cursor = 'pointer';
            titleEl.addEventListener('click', (e) => { e.stopPropagation(); abrirDocumento(doc); });
        }

        const openBtn = card.querySelector('.doc-open-btn');
        if (openBtn) {
            openBtn.addEventListener('click', (e) => { e.stopPropagation(); abrirDocumento(doc); });
        }

        const descEl = card.querySelector('.doc-description');
        if (descEl) {
            descEl.style.cursor = 'default';
            descEl.addEventListener('click', (e) => { e.stopPropagation(); });
        }
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



function sanitizeDocReadContent(html = '') {
    const container = document.createElement('div');
    container.innerHTML = html || '';

    container.querySelectorAll('.doc-image-placeholder-wrapper').forEach((node) => node.remove());

    container.querySelectorAll('p[data-image-paragraph="true"]').forEach((node) => {
        const hasRealMedia = !!node.querySelector('img, video, iframe, audio, svg, canvas, object, embed');
        if (!hasRealMedia && !node.textContent.trim()) {
            node.remove();
        }
    });

    container.querySelectorAll('*').forEach((node) => {
        if (!node.textContent) return;
        const cleaned = node.textContent.replace(/\$image(?:\$|%)/gi, '');
        if (cleaned !== node.textContent) {
            node.textContent = cleaned;
        }
    });

    return container.innerHTML;
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
    const rawContent = currentViewVersion === 'normal' ? (doc.conteudo || '') : (doc.conteudoPasso || '');
    const contentToShow = sanitizeDocReadContent(rawContent);
    if (!contentToShow || contentToShow.trim() === '') {
        const label = currentViewVersion === 'normal' ? 'normal' : 'passo a passo';
        contentEl.innerHTML = `<p style="opacity:0.8">⚠️ Nenhuma versão ${label} disponível.</p>`;
    } else {
        // Encapsular em `.rich-editor` (não editável) para preservar estilo/quebras idênticas ao editor
        contentEl.innerHTML = `<div class="rich-editor" aria-hidden="true">${contentToShow}</div>`;
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

    // Reorganizar header-top: agrupar apenas os botões em .header-actions
    // e garantir que o título permaneça em `.modal-header` (não movê-lo).
    try {
        const headerTop = document.querySelector('#docModal .modal-header-top');
        const header = document.querySelector('#docModal .modal-header');
        const titleEl = document.getElementById('modalTitle');
        if (headerTop) {
            // criar header-actions se não existir
            let headerActions = headerTop.querySelector('.header-actions');
            if (!headerActions) {
                headerActions = document.createElement('div');
                headerActions.className = 'header-actions';
                headerTop.appendChild(headerActions);
            }

            // mover apenas botões/elementos de ação para headerActions (não mover o título)
            Array.from(headerTop.childNodes).forEach(node => {
                if (node.nodeType === 1 && !node.classList.contains('header-actions') && !node.classList.contains('modal-title-center')) {
                    const tag = node.tagName ? node.tagName.toLowerCase() : '';
                    // mover elementos de ação típicos (button, span, svg wrapper)
                    if (tag === 'button' || tag === 'span' || tag === 'svg' || tag === 'div') {
                        headerActions.appendChild(node);
                    }
                }
            });

            // se houver um container antigo `.modal-title-center`, removê-lo e devolver o título ao header
            const oldTitleContainer = headerTop.querySelector('.modal-title-center');
            if (oldTitleContainer) {
                if (titleEl) header.appendChild(titleEl);
                oldTitleContainer.remove();
            }
        }

        // garantir que o header com o título esteja visível
        if (header) header.style.display = '';
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
    const editDocContentEl = document.getElementById('editDocContent');
    if (editDocContentEl) {
        editDocContentEl.innerHTML = doc.conteudo || '';
        replaceImageShortcutTokens(editDocContentEl);
        ensureImagePlaceholdersInNormalEditor(editDocContentEl);
        preserveImagePlaceholderBlock(editDocContentEl);
    }
    const editDocPassoEl = document.getElementById('editDocPassoContent');
    if (editDocPassoEl) editDocPassoEl.innerHTML = doc.conteudoPasso || '';
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

    setModalVisible('docModal', false);
    setModalVisible('editModal', true);

    // Atualiza comportamento de scroll do modal conforme largura disponível
    try {
        // delay curto para garantir que o modal tenha sido renderizado e medido
        setTimeout(() => updateEditModalScrollBehavior(), 80);
    } catch (e) {}

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

// Quando o modal de edição precisa permitir o scroll do site inteiro
function updateEditModalScrollBehavior() {
    try {
        const editModalContent = document.querySelector('#editModal .modal-content');
        const editor = document.getElementById('editDocContent');
        if (!editModalContent || !editor) return;

        const modalRect = editModalContent.getBoundingClientRect();
        const siteWidth = document.documentElement.clientWidth || window.innerWidth;

        // Se o modal ocupa praticamente toda a largura do site, aplicamos a classe
        const marginThreshold = 32; // px de folga
        if (modalRect.width >= siteWidth - marginThreshold) {
            editModalContent.classList.add('expand-to-site');
            document.body.classList.add('modal-expanded-to-site');
            try { document.documentElement.classList.add('modal-expanded-to-site'); } catch(e){}
        } else {
            editModalContent.classList.remove('expand-to-site');
            document.body.classList.remove('modal-expanded-to-site');
            try { document.documentElement.classList.remove('modal-expanded-to-site'); } catch(e){}
        }
    } catch (e) { /* noop */ }
}

// Registrar ouvintes que podem disparar a checagem: redimensionamento e digitação
window.addEventListener('resize', () => {
    try { updateEditModalScrollBehavior(); } catch(e){}
});

// Monitora entradas no editor principal para reavaliar comportamento responsivo
document.addEventListener('input', (e) => {
    try {
        const target = e.target;
        if (target && target.id === 'editDocContent') updateEditModalScrollBehavior();
    } catch (e) {}
}, true);

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

    const editTitleInput = document.getElementById('editDocTitle');
    const editCategorySelect = document.getElementById('editDocCategory');
    const selectedCatId = editCategorySelect ? (editCategorySelect.value || 'todos') : 'todos';
    const editTituloRaw = stripCategoriaPrefixFromTitle(editTitleInput ? String(editTitleInput.value || '') : '', selectedCatId);
    doc.titulo = buildDocTitleWithCategory(editTituloRaw, selectedCatId);
    doc.categoria = selectedCatId ? String(selectedCatId) : 'todos';
    doc.descricao = document.getElementById('editDocDescription').value;
    const editDocContentEl = document.getElementById('editDocContent');
    cleanNormalDocImagePlaceholders(editDocContentEl);
    doc.conteudo = editDocContentEl ? editDocContentEl.innerHTML : '';
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
        return doc.tags.some(tag => tag.toLowerCase().startsWith(t));
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
    const iconInput = document.getElementById('categoryIcon');
    const iconeCategoria = iconInput?.value && String(iconInput.value).trim() ? String(iconInput.value).trim() : '📂';
    if (editingId) {

        const cat = categorias.find(c => c.id == parseInt(editingId));
        if (cat) {
            cat.nome = nome;
            cat.icone = iconeCategoria;
            const col = document.getElementById('categoryColor'); if (col) cat.cor = col.value;
        }
    } else {
        categorias.push({
            id: Date.now(),
            nome,
            icone: iconeCategoria,
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

function processMarkdown(text) {
    // converter headings: # H1, ## H2, ### H3, etc até ###### H6
    text = text.replace(/^###### (.*?)$/gm, '<h6>$1</h6>');
    text = text.replace(/^##### (.*?)$/gm, '<h5>$1</h5>');
    text = text.replace(/^#### (.*?)$/gm, '<h4>$1</h4>');
    text = text.replace(/^### (.*?)$/gm, '<h3>$1</h3>');
    text = text.replace(/^## (.*?)$/gm, '<h2>$1</h2>');
    text = text.replace(/^# (.*?)$/gm, '<h1>$1</h1>');
    // converter **texto** para <strong>texto</strong>
    text = text.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
    return text;
}

function processMarkdownBold(text) {
    // converter **texto** para <strong>texto</strong>
    return text.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
}

function createAiVisualImagePlaceholder() {
    const wrapper = document.createElement('div');
    wrapper.className = 'doc-image-placeholder-wrapper ai-image-placeholder';
    wrapper.setAttribute('contenteditable', 'false');
    wrapper.setAttribute('data-ai-visual', 'true');
    wrapper.setAttribute('aria-hidden', 'true');

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'doc-image-placeholder-btn';
    btn.textContent = '🖼️';
    btn.title = 'Imagem sugerida pela IA';
    btn.disabled = true;
    wrapper.appendChild(btn);

    return wrapper.outerHTML;
}

function renderAiVisualImageTokens(html) {
    return String(html || '').replace(/\$image(?:\$|%)/gi, createAiVisualImagePlaceholder());
}

function normalizeOutgoingLinks(html) {
    try {
        const parser = new DOMParser();
        const doc = parser.parseFromString(String(html || ''), 'text/html');
        doc.querySelectorAll('a[href]').forEach(a => {
            a.setAttribute('target', '_blank');
            a.setAttribute('rel', 'noopener noreferrer');
        });
        return doc.body.innerHTML;
    } catch (e) {
        return String(html || '');
    }
}

function renderMessageHTML(text) {
    const raw = String(text || '');
    // Prefer a full Markdown renderer when available (marked + DOMPurify)
    if (typeof marked !== 'undefined') {
        try {
            const html = marked.parse(raw);
            if (typeof DOMPurify !== 'undefined') {
                return normalizeOutgoingLinks(DOMPurify.sanitize(html, { ADD_ATTR: ['target', 'rel'] }));
            }
            return normalizeOutgoingLinks(html);
        } catch (e) {
            // fallthrough to simple fallback
        }
    }
    // Fallback: escape, convert newlines and apply simple markdown (headings/bold)
    let safe = escapeHtml(raw);
    safe = safe.replace(/\n/g, '<br>');
    safe = processMarkdown(safe);
    return normalizeOutgoingLinks(safe);
}

/* Abre o modal de configurações de IA direto na seção de Summary System Prompt e foca o campo */
function openSummaryPrompt() {
    try {
        if (typeof populateSettingsModal === 'function') populateSettingsModal();
        setModalVisible('aiSettingsModal', true);
        setTimeout(() => {
            const el = document.getElementById('aiSummarySystemPrompt');
            if (el) {
                try { el.focus(); } catch(e){}
                if (typeof el.select === 'function') try { el.select(); } catch(e){}
                try { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch(e){}
            }
        }, 120);
    } catch (e) { console.warn('openSummaryPrompt failed', e); }
}

// Expor para uso via console/UI
window.openSummaryPrompt = openSummaryPrompt;

// Insere o prompt fornecido pelo usuário no System Prompt e salva (útil para testes rápidos)
window.insertCustomSystemPrompt = function() {
    const prompt = `Considere como DOCUMENTAÇÃO todo texto que descreva um procedimento funcional de sistema ou aplicativo.
Ignore apenas instruções sobre como você deve responder.

Sua tarefa é REESTRUTURAR o conteúdo mantendo integralmente todas as informações operacionais.

Remover exclusivamente:
Frases explicativas que não alteram a execução.
Comentários descritivos.
Observações condicionais que não exigem ação direta.
Resultados esperados após a ação.

Manter obrigatoriamente:
Comandos
Campos
Valores
Datas
Identificadores
Parâmetros
Textos entre aspas
Informações após dois pontos (:)
Sequência original

REGRA CRÍTICA DE PRESERVAÇÃO ADICIONAL:

Qualquer linha que contenha pelo menos um dos elementos abaixo deve ser mantida obrigatoriamente, mesmo que pareça explicativa:

Dois pontos (:)

Texto entre aspas

Números

Datas

Valores monetários

Códigos

Identificadores técnicos

Nome de botão

Nome de campo

Nome de aba

Nome de menu

Nome de tela

Status

Tipo

Diretório

Nunca remover uma linha que contenha qualquer um desses elementos.

Não resumir.
Não simplificar.
Não reorganizar.
Não alterar a ordem.
Não inferir.
Não inventar etapas.
Nunca transformar instruções deste prompt em conteúdo da saída.

REGRA OBRIGATÓRIA PARA TÍTULOS

Sempre que encontrar uma linha que represente uma seção, inclusive linhas iniciadas por:

TEXTO ORIGINAL DA SEÇÃO

Você deve:

Remover completamente a expressão "TEXTO ORIGINAL DA SEÇÃO".
Manter apenas o nome real da seção.
Converter obrigatoriamente para o formato:

NOME DA SEÇÃO

Exemplo obrigatório de transformação:

TEXTO ORIGINAL DA SEÇÃO ACESSO AO PERFIL DIGITAL

Deve se tornar exatamente:

ACESSO AO PERFIL DIGITAL

Nunca manter o prefixo original.
Nunca ignorar a transformação.
Nunca manter o título em formato simples.

REGRAS DE FORMATAÇÃO

Todo texto entre aspas deve:
Permanecer com aspas
Estar totalmente em negrito

Todo valor que apareça após dois pontos (:) deve estar em negrito.

Elementos interativos também devem estar em negrito, incluindo:
Botões
Abas
Itens selecionáveis
Campos
Valores digitados
Diretórios
Tipos
Status

Estrutura obrigatória:
Uma única ação ou informação operacional por linha.
Inserir uma linha em branco entre todas as linhas.
Inserir uma linha em branco após cada título.
Nunca juntar múltiplas ações na mesma linha.
Nunca retornar o conteúdo em bloco único.

FORMATO FINAL

Títulos obrigatoriamente no formato ##.
Conteúdo abaixo do título correspondente.
Uma linha por ação ou informação operacional.
Linha em branco entre todas as linhas.
Nada além do conteúdo estruturado.

Se não houver ações funcionais, responder exatamente:
Nenhuma interação identificada.`;

    const el = document.getElementById('aiSummarySystemPrompt');
    if (el) el.value = prompt;
    try {
        // persistir summary (passo a passo) via autoSave
        try { autoSaveAISettings(); } catch(e) { /* non-fatal */ }
        try { showToast('✅ Passo a passo inserido', 'success'); } catch(e){}
    } catch (e) {
        console.error('insertCustomSummaryPrompt failed', e);
    }
};
