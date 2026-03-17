document.addEventListener('DOMContentLoaded', () => {

    fetch('/api/me').then(res => {
        if (res.ok) window.location.href = '/dashboard.html';
    });

    const loginForm = document.getElementById('login-form');
    if (loginForm) {
        loginForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const username = document.getElementById('username').value.trim();
            const password = document.getElementById('password').value;
            const errorEl = document.getElementById('error-message');
            errorEl.textContent = '';

            try {
                const res = await fetch('/api/login', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ username, password })
                });
                const data = await res.json();
                if (data.success) {
                    window.location.href = '/dashboard.html';
                } else {
                    errorEl.textContent = data.error;
                }
            } catch {
                errorEl.textContent = 'Ошибка соединения с сервером';
            }
        });
    }

    const registerForm = document.getElementById('register-form');
    if (registerForm) {
        registerForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const username = document.getElementById('username').value.trim();
            const password = document.getElementById('password').value;
            const errorEl = document.getElementById('error-message');
            errorEl.textContent = '';

            if (username.length > 14) {
                errorEl.textContent = 'Имя пользователя — не более 14 символов';
                return;
            }

            try {
                const res = await fetch('/api/register', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ username, password })
                });
                const data = await res.json();
                if (data.success) {
                    window.location.href = '/dashboard.html';
                } else {
                    errorEl.textContent = data.error;
                }
            } catch {
                errorEl.textContent = 'Ошибка соединения с сервером';
            }
        });
    }
});