document.addEventListener('DOMContentLoaded', () => {

    let currentUser = null;
    let passwordVisible = false;
    let currentViewRequest = null;
    let currentViewType = null;
    let searchTimeout = null;
    let selectedFiles = [];
    let unreadCounts = {};
    const socket = io();

    /* проверка авторизации */
    async function checkAuth() {
        try {
            const res = await fetch('/api/me');
            if (res.status === 401) {
                window.location.href = '/login.html';
                return;
            }
            currentUser = await res.json();
            socket.emit('register', currentUser.id);
            loadProfile();
            checkNotifications();
            loadUnreadCounts();
        } catch {
            window.location.href = '/login.html';
        }
    }

    checkAuth();

    /* получение уведомления о новом сообщении через websocket */
    socket.on('new-message', (data) => {
        loadUnreadCounts();

        /* если чат с этой заявкой открыт - обновляем сообщения и отмечаем как прочитанные */
        const chatModal = document.getElementById('modal-chat');
        if (chatModal.classList.contains('active') && currentViewRequest && currentViewRequest.id === data.request_id) {
            loadMessages(data.request_id);
            markAsRead(data.request_id);
        }
    });

    /* загрузка количества непрочитанных сообщений */
    async function loadUnreadCounts() {
        try {
            const res = await fetch('/api/unread-counts');
            const list = await res.json();
            unreadCounts = {};
            list.forEach(item => {
                unreadCounts[item.request_id] = item.unread_count;
            });
            updateUnreadBadges();
        } catch (err) {
            console.error('ошибка загрузки непрочитанных:', err);
        }
    }

    /* обновление бейджей непрочитанных на заявках */
    function updateUnreadBadges() {
        document.querySelectorAll('.request-item').forEach(item => {
            const id = parseInt(item.dataset.id);
            const existingBadge = item.querySelector('.unread-badge');
            if (existingBadge) existingBadge.remove();

            if (unreadCounts[id] && unreadCounts[id] > 0) {
                const badge = document.createElement('span');
                badge.className = 'unread-badge';
                badge.textContent = unreadCounts[id];
                item.querySelector('.request-right').appendChild(badge);
            }
        });
    }

    /* отметить как прочитанное */
    async function markAsRead(requestId) {
        try {
            await fetch('/api/comments/read', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ request_id: requestId })
            });
            if (unreadCounts[requestId]) {
                delete unreadCounts[requestId];
                updateUnreadBadges();
            }
        } catch (err) {
            console.error('ошибка отметки прочитанного:', err);
        }
    }

    /* проверка уведомлений о необработанных заявках */
    async function checkNotifications() {
        try {
            const res = await fetch('/api/requests/assigned?filter=0');
            const list = await res.json();
            const dot = document.getElementById('notif-dot');
            if (list.length > 0) {
                dot.classList.add('visible');
            } else {
                dot.classList.remove('visible');
            }
        } catch (err) {
            console.error('ошибка проверки уведомлений:', err);
        }
    }

    /* навигация по боковой панели */
    const sidebarBtns = document.querySelectorAll('.sidebar-btn[data-page]');
    const pages = document.querySelectorAll('.page');

    sidebarBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            const pageId = btn.dataset.page;

            document.querySelectorAll('.sidebar-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');

            pages.forEach(p => p.classList.remove('active'));
            document.getElementById(pageId).classList.add('active');

            if (pageId === 'page-profile') loadProfile();
            if (pageId === 'page-create') loadCreatedRequests();
            if (pageId === 'page-process') loadAssignedRequests();
        });
    });

    /* кнопка выхода */
    document.getElementById('butt4').addEventListener('click', async () => {
        await fetch('/api/logout', { method: 'POST' });
        window.location.href = '/login.html';
    });

    /* загрузка профиля и статистики */
    async function loadProfile() {
        if (!currentUser) return;

        document.getElementById('profile-username').textContent = currentUser.username;
        renderPassword();

        try {
            const res = await fetch('/api/stats');
            const s = await res.json();
            document.getElementById('stat-created').textContent = s.created_total;
            document.getElementById('stat-created-closed').textContent = s.created_closed;
            document.getElementById('stat-created-open').textContent = s.created_open;
            document.getElementById('stat-assigned-closed').textContent = s.assigned_closed;
            document.getElementById('stat-assigned-open').textContent = s.assigned_open;
        } catch (err) {
            console.error('ошибка загрузки статистики:', err);
        }
    }

    /* показ/скрытие пароля */
    function renderPassword() {
        const el = document.getElementById('profile-password');
        el.textContent = passwordVisible
            ? currentUser.password
            : '•'.repeat(currentUser.password.length);
    }

    document.getElementById('toggle-password').addEventListener('click', () => {
        passwordVisible = !passwordVisible;
        renderPassword();
    });

    /* заполнение выпадающего списка срока */
    const deadlineType = document.getElementById('req-deadline-type');
    const deadlineValue = document.getElementById('req-deadline-value');

    function fillDeadlineValues(type) {
        deadlineValue.innerHTML = '';
        const max = type === 'd' ? 30 : 24;
        for (let i = 1; i <= max; i++) {
            const opt = document.createElement('option');
            opt.value = i;
            opt.textContent = i;
            deadlineValue.appendChild(opt);
        }
    }

    deadlineType.addEventListener('change', () => fillDeadlineValues(deadlineType.value));
    fillDeadlineValues('d');

    /* открытие/закрытие модалок */
    function openModal(id) {
        document.getElementById(id).classList.add('active');
    }

    function closeModal(id) {
        document.getElementById(id).classList.remove('active');
    }

    document.querySelectorAll('.modal-close').forEach(btn => {
        btn.addEventListener('click', () => closeModal(btn.dataset.modal));
    });

    document.querySelectorAll('.modal-overlay').forEach(overlay => {
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) overlay.classList.remove('active');
        });
    });

    /* управление выбранными файлами */
    const fileInput = document.getElementById('req-files');
    const selectedFilesDiv = document.getElementById('selected-files');

    fileInput.addEventListener('change', () => {
        for (const file of fileInput.files) {
            selectedFiles.push(file);
        }
        fileInput.value = '';
        renderSelectedFiles();
    });

    function renderSelectedFiles() {
        selectedFilesDiv.innerHTML = '';
        selectedFiles.forEach((file, index) => {
            const div = document.createElement('div');
            div.className = 'selected-file';
            div.innerHTML = `<span>${esc(file.name)}</span><span class="file-remove" data-index="${index}">✕</span>`;
            selectedFilesDiv.appendChild(div);
        });

        selectedFilesDiv.querySelectorAll('.file-remove').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                selectedFiles.splice(parseInt(btn.dataset.index), 1);
                renderSelectedFiles();
            });
        });
    }

    /* открытие модалки создания заявки */
    document.getElementById('btn-open-create-modal').addEventListener('click', async () => {
        try {
            const res = await fetch('/api/users');
            const users = await res.json();
            const sel = document.getElementById('req-assignee');
            sel.innerHTML = '';

            if (users.length === 0) {
                const opt = document.createElement('option');
                opt.textContent = 'Нет доступных пользователей';
                opt.disabled = true;
                sel.appendChild(opt);
            } else {
                users.forEach(u => {
                    const opt = document.createElement('option');
                    opt.value = u.id;
                    opt.textContent = u.username;
                    sel.appendChild(opt);
                });
            }
        } catch (err) {
            console.error('ошибка загрузки пользователей:', err);
        }

        document.getElementById('req-title').value = '';
        document.getElementById('req-description').value = '';
        selectedFiles = [];
        selectedFilesDiv.innerHTML = '';
        fileInput.value = '';
        deadlineType.value = 'd';
        fillDeadlineValues('d');

        openModal('modal-create');
    });

    /* отправка новой заявки */
    document.getElementById('btn-submit-request').addEventListener('click', async () => {
        const title = document.getElementById('req-title').value.trim();
        const description = document.getElementById('req-description').value.trim();
        const dtype = deadlineType.value;
        const dvalue = parseInt(deadlineValue.value);
        const assignee_id = document.getElementById('req-assignee').value;

        if (!title) return alert('Введите название заявки');
        if (!assignee_id) return alert('Выберите адресата');

        const formData = new FormData();
        formData.append('title', title);
        formData.append('description', description);
        formData.append('deadline_type', dtype);
        formData.append('deadline_value', dvalue);
        formData.append('assignee_id', assignee_id);

        for (const file of selectedFiles) {
            formData.append('files', file);
        }

        try {
            const res = await fetch('/api/requests', {
                method: 'POST',
                body: formData
            });
            const data = await res.json();
            if (data.success) {
                closeModal('modal-create');
                loadCreatedRequests();
            } else {
                alert(data.error);
            }
        } catch {
            alert('Ошибка при создании заявки');
        }
    });

    /* поиск с задержкой */
    function debounceSearch(callback) {
        clearTimeout(searchTimeout);
        searchTimeout = setTimeout(callback, 300);
    }

    /* загрузка созданных заявок */
    async function loadCreatedRequests() {
        const filter = document.getElementById('filter-created').value;
        const search = document.getElementById('search-created').value;
        try {
            const res = await fetch(`/api/requests/created?filter=${filter}&search=${encodeURIComponent(search)}`);
            const list = await res.json();
            const container = document.getElementById('created-list');

            if (list.length === 0) {
                container.innerHTML = '<p class="empty-message">Заявок нет</p>';
                return;
            }

            container.innerHTML = list.map(r => `
                <div class="request-item" data-id="${r.id}">
                    <div class="request-info">
                        <span class="request-user">${esc(r.assignee_name)}</span>
                        <span class="request-sep">—</span>
                        <span class="request-title-text">${esc(r.title)}</span>
                    </div>
                    <div class="request-right">
                        <span class="request-status ${r.status === 1 ? 'status-closed' : 'status-open'}">
                            ${r.status === 1 ? 'Закрыта' : 'Не закрыта'}
                        </span>
                    </div>
                </div>
            `).join('');

            container.querySelectorAll('.request-item').forEach(item => {
                item.addEventListener('click', () => {
                    const req = list.find(r => r.id === parseInt(item.dataset.id));
                    showDetail(req, 'created');
                });
            });

            updateUnreadBadges();
        } catch (err) {
            console.error('ошибка загрузки созданных заявок:', err);
        }
    }

    document.getElementById('filter-created').addEventListener('change', loadCreatedRequests);
    document.getElementById('search-created').addEventListener('input', () => {
        debounceSearch(loadCreatedRequests);
    });

    /* загрузка назначенных заявок */
    async function loadAssignedRequests() {
        const filter = document.getElementById('filter-assigned').value;
        const search = document.getElementById('search-assigned').value;
        try {
            const res = await fetch(`/api/requests/assigned?filter=${filter}&search=${encodeURIComponent(search)}`);
            const list = await res.json();
            const container = document.getElementById('assigned-list');

            if (list.length === 0) {
                container.innerHTML = '<p class="empty-message">Заявок нет</p>';
                return;
            }

            container.innerHTML = list.map(r => `
                <div class="request-item" data-id="${r.id}">
                    <div class="request-info">
                        <span class="request-user">${esc(r.creator_name)}</span>
                        <span class="request-sep">—</span>
                        <span class="request-title-text">${esc(r.title)}</span>
                    </div>
                    <div class="request-right">
                        <span class="request-status ${r.status === 1 ? 'status-closed' : 'status-open'}">
                            ${r.status === 1 ? 'Закрыта' : 'Не закрыта'}
                        </span>
                    </div>
                </div>
            `).join('');

            container.querySelectorAll('.request-item').forEach(item => {
                item.addEventListener('click', () => {
                    const req = list.find(r => r.id === parseInt(item.dataset.id));
                    showDetail(req, 'assigned');
                });
            });

            updateUnreadBadges();
        } catch (err) {
            console.error('ошибка загрузки назначенных заявок:', err);
        }
    }

    document.getElementById('filter-assigned').addEventListener('change', loadAssignedRequests);
    document.getElementById('search-assigned').addEventListener('input', () => {
        debounceSearch(loadAssignedRequests);
    });

    /* получить иконку по расширению файла */
    function getFileIcon(filename) {
        const ext = filename.split('.').pop().toLowerCase();
        const icons = {
            'pdf': '📕', 'doc': '📘', 'docx': '📘',
            'xls': '📗', 'xlsx': '📗', 'ppt': '📙', 'pptx': '📙',
            'txt': '📄', 'jpg': '🖼️', 'jpeg': '🖼️', 'png': '🖼️', 'gif': '🖼️',
            'zip': '📦', 'rar': '📦', '7z': '📦',
            'mp3': '🎵', 'mp4': '🎬', 'avi': '🎬', 'mkv': '🎬'
        };
        return icons[ext] || '📎';
    }

    /* форматирование размера файла */
    function formatFileSize(bytes) {
        if (bytes < 1024) return bytes + ' Б';
        if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' КБ';
        return (bytes / (1024 * 1024)).toFixed(1) + ' МБ';
    }

    /* показ деталей заявки */
    async function showDetail(req, type) {
        currentViewRequest = req;
        currentViewType = type;

        const body = document.getElementById('modal-view-body');
        const footer = document.getElementById('modal-view-footer');

        const deadline = formatDeadline(req.deadline_type, req.deadline_value);
        const statusText = req.status === 1 ? 'Закрыта' : 'Не закрыта';
        const statusClass = req.status === 1 ? 'status-closed' : 'status-open';
        const userLabel = type === 'created' ? 'Адресат' : 'Создатель';
        const userName = type === 'created' ? req.assignee_name : req.creator_name;

        let attachmentsHtml = '';
        try {
            const res = await fetch(`/api/attachments/${req.id}`);
            const files = await res.json();

            if (files.length > 0) {
                attachmentsHtml = `
                    <div class="attachments-section">
                        <div class="attachments-title">Прикреплённые файлы</div>
                        <div class="attachments-list">
                            ${files.map(f => `
                                <a href="/api/download/${f.id}" class="attachment-item">
                                    <span class="attachment-icon">${getFileIcon(f.original_name)}</span>
                                    <div class="attachment-info">
                                        <span class="attachment-name">${esc(f.original_name)}</span>
                                        <span class="attachment-size">${formatFileSize(f.file_size)}</span>
                                    </div>
                                </a>
                            `).join('')}
                        </div>
                    </div>
                `;
            } else {
                attachmentsHtml = `
                    <div class="attachments-section">
                        <div class="attachments-title">Прикреплённые файлы</div>
                        <p class="no-attachments">Нет прикреплённых файлов</p>
                    </div>
                `;
            }
        } catch (err) {
            console.error('ошибка загрузки файлов:', err);
        }

        body.innerHTML = `
            <div class="detail-row">
                <div class="detail-label">Название</div>
                <div class="detail-value">${esc(req.title)}</div>
            </div>
            <div class="detail-row">
                <div class="detail-label">Описание</div>
                <div class="detail-value">${esc(req.description) || '—'}</div>
            </div>
            <div class="detail-row">
                <div class="detail-label">Срок выполнения</div>
                <div class="detail-value">${deadline}</div>
            </div>
            <div class="detail-row">
                <div class="detail-label">${userLabel}</div>
                <div class="detail-value">${esc(userName)}</div>
            </div>
            <div class="detail-row">
                <div class="detail-label">Статус</div>
                <div class="detail-value">
                    <span class="request-status ${statusClass}">${statusText}</span>
                </div>
            </div>
            <div class="detail-row">
                <div class="detail-label">Дата создания</div>
                <div class="detail-value">${new Date(req.created_at).toLocaleString('ru-RU')}</div>
            </div>
            ${attachmentsHtml}
        `;

        if (type === 'created') {
            footer.innerHTML = `
                <button class="btn-blue" id="btn-discussion">Обсуждение</button>
                <button class="btn-red" id="btn-action">Удалить заявку</button>
            `;
            document.getElementById('btn-action').addEventListener('click', async () => {
                if (!confirm('Удалить заявку?')) return;
                try {
                    const res = await fetch(`/api/requests/${req.id}`, { method: 'DELETE' });
                    const data = await res.json();
                    if (data.success) {
                        closeModal('modal-view');
                        loadCreatedRequests();
                    } else {
                        alert(data.error);
                    }
                } catch {
                    alert('Ошибка при удалении');
                }
            });
        } else {
            if (req.status === 1) {
                footer.innerHTML = `
                    <button class="btn-blue" id="btn-discussion">Обсуждение</button>
                    <button class="btn-disabled" disabled>Заявка закрыта</button>
                `;
            } else {
                footer.innerHTML = `
                    <button class="btn-blue" id="btn-discussion">Обсуждение</button>
                    <button class="btn-red" id="btn-action">Закрыть заявку</button>
                `;
                document.getElementById('btn-action').addEventListener('click', async () => {
                    if (!confirm('Закрыть заявку?')) return;
                    try {
                        const res = await fetch(`/api/requests/${req.id}/close`, { method: 'PATCH' });
                        const data = await res.json();
                        if (data.success) {
                            closeModal('modal-view');
                            loadAssignedRequests();
                            checkNotifications();
                        } else {
                            alert(data.error);
                        }
                    } catch {
                        alert('Ошибка при закрытии');
                    }
                });
            }
        }

        document.getElementById('btn-discussion').addEventListener('click', () => {
            closeModal('modal-view');
            openChat(req, type);
        });

        openModal('modal-view');
    }

    /* чат */
    async function openChat(req, type) {
        const companionName = type === 'created' ? req.assignee_name : req.creator_name;
        document.getElementById('chat-title').textContent = `Обсуждение с ${companionName}`;
        document.getElementById('chat-input').value = '';

        await markAsRead(req.id);
        await loadMessages(req.id);
        openModal('modal-chat');

        const messagesDiv = document.getElementById('chat-messages');
        messagesDiv.scrollTop = messagesDiv.scrollHeight;
    }

    async function loadMessages(requestId) {
        const container = document.getElementById('chat-messages');
        try {
            const res = await fetch(`/api/comments/${requestId}`);
            const messages = await res.json();

            if (messages.length === 0) {
                container.innerHTML = '<p class="chat-empty">Сообщений пока нет. Напишите первое!</p>';
                return;
            }

            container.innerHTML = messages.map(m => {
                const isMine = m.user_id === currentUser.id;
                const time = new Date(m.created_at).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
                return `
                    <div class="chat-message ${isMine ? 'mine' : 'other'}">
                        ${esc(m.text)}
                        <span class="chat-message-time">${time}</span>
                    </div>
                `;
            }).join('');

            container.scrollTop = container.scrollHeight;
        } catch (err) {
            console.error('ошибка загрузки сообщений:', err);
        }
    }

    /* отправка сообщения */
    document.getElementById('btn-send-message').addEventListener('click', async () => {
        const input = document.getElementById('chat-input');
        const text = input.value.trim();
        if (!text || !currentViewRequest) return;

        try {
            const res = await fetch('/api/comments', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    request_id: currentViewRequest.id,
                    text: text
                })
            });
            const data = await res.json();
            if (data.success) {
                input.value = '';
                await loadMessages(currentViewRequest.id);
                await markAsRead(currentViewRequest.id);
            } else {
                alert(data.error);
            }
        } catch {
            alert('Ошибка при отправке сообщения');
        }
    });

    /* отправка сообщения по enter */
    document.getElementById('chat-input').addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            document.getElementById('btn-send-message').click();
        }
    });

    /* кнопка назад в чате */
    document.getElementById('btn-chat-back').addEventListener('click', () => {
        closeModal('modal-chat');
        showDetail(currentViewRequest, currentViewType);
    });

    /* кнопка закрыть в чате */
    document.getElementById('btn-chat-close').addEventListener('click', () => {
        closeModal('modal-chat');
    });

    /* форматирование срока */
    function formatDeadline(type, value) {
        if (type === 'd') {
            const l2 = value % 100;
            const l1 = value % 10;
            let w = 'дней';
            if (l2 >= 11 && l2 <= 19) w = 'дней';
            else if (l1 === 1) w = 'день';
            else if (l1 >= 2 && l1 <= 4) w = 'дня';
            return `${value} ${w}`;
        } else {
            const l2 = value % 100;
            const l1 = value % 10;
            let w = 'часов';
            if (l2 >= 11 && l2 <= 19) w = 'часов';
            else if (l1 === 1) w = 'час';
            else if (l1 >= 2 && l1 <= 4) w = 'часа';
            return `${value} ${w}`;
        }
    }

    /* экранирование текста */
    function esc(text) {
        if (!text) return '';
        const d = document.createElement('div');
        d.textContent = text;
        return d.innerHTML;
    }
});