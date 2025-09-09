(function () {
    const form = document.getElementById('checkin');
    if (!form) return;

    const byId = (id) => document.getElementById(id);
    const v = (id) => (byId(id)?.value ?? '').trim().replace(/\s+/g, ' ');

    form.addEventListener('submit', function (e) {
        e.preventDefault(); // stop browser navigation

        // Collect values, normalized like signup.js
        const payload = {
            name: v('name'),
            id: v('id'),
            blind: byId('blind')?.checked ? 'TRUE' : 'FALSE',
            event: v('event'),
            record: v('record'),
            checkin: 'TRUE'
        };

        // Hidden iframe trick
        const iframe = document.createElement('iframe');
        iframe.style.display = 'none';
        iframe.name = 'hidden-iframe-' + Math.random().toString(36).slice(2);
        document.body.appendChild(iframe);

        const f = document.createElement('form');
        f.method = 'POST';
        f.action = 'https://script.google.com/macros/s/AKfycbyGICmPIv5MoAG_g00EYbAM05sFYT9bZjBoAadXZyUFtRIloLAPKQfAzX1lkgUMqN1e5Q/exec';
        f.target = iframe.name;

        Object.entries(payload).forEach(([k, val]) => {
            const input = document.createElement('input');
            input.type = 'hidden';
            input.name = k;
            input.value = val;
            f.appendChild(input);
        });

        document.body.appendChild(f);
        f.submit();

        setTimeout(() => {
            document.body.removeChild(f);
            document.body.removeChild(iframe);
        }, 1500);

        alert('체크인 요청을 전송했습니다.');
        form.reset();
    });
})();
