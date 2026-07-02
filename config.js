const API_URL = (function () {
    const host = window.location.hostname;
    const esLocal = host === 'localhost' || host === '127.0.0.1' || host === '';
    return esLocal
        ? 'http://localhost:3000/api'
        : 'https://verduleria-web.onrender.com/api';
})();