document.addEventListener('DOMContentLoaded', () => {
    const form = document.getElementById('login-form');
    const errorMsg = document.getElementById('login-error');

    // Si ya hay un token guardado, ir directo al panel
    if (localStorage.getItem('adminToken')) {
        window.location.href = 'panel.html';
        return;
    }

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        errorMsg.style.display = 'none';

        const username = document.getElementById('username').value;
        const password = document.getElementById('password').value;

        try {
            const response = await fetch(`${API_URL}/admin/login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, password }),
            });

            if (!response.ok) {
                errorMsg.style.display = 'block';
                return;
            }

            const data = await response.json();
            localStorage.setItem('adminToken', data.token);
            window.location.href = 'panel.html';
        } catch (error) {
            console.error('Error al iniciar sesión:', error);
            errorMsg.textContent = 'No se pudo conectar con el servidor.';
            errorMsg.style.display = 'block';
        }
    });
});
