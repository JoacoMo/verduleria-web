// Detecta automáticamente si estás probando en tu compu (localhost) o en el sitio real,
// y usa la URL de backend correspondiente. No hace falta tocar este archivo a mano.
const API_URL = (function () {
    const host = window.location.hostname;
    const esLocal = host === 'localhost' || host === '127.0.0.1' || host === '';
    return esLocal
        ? 'http://localhost:3000/api'
        : 'https://verduleria-backend-beuj.onrender.com/api';
})();
