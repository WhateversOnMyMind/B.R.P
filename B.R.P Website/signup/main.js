const form = document.getElementById('signup');

form.addEventListener('submit', async (e) => {
    e.preventDefault();

    const name = document.getElementById('name').value;
    const id = document.getElementById('id').value;
    const blind = document.getElementById('blind').checked ? "TRUE" : "FALSE";
    const event = document.getElementById('event').value; // Use `.value`, not `.valueAsNumber`
    const record = document.getElementById('record').value || "";

    // Create a hidden iframe
    const iframe = document.createElement('iframe');
    iframe.style.display = 'none';
    iframe.name = 'hidden-iframe';
    document.body.appendChild(iframe);

    // Create form that submits to the hidden iframe
    const hiddenForm = document.createElement('form');
    hiddenForm.method = 'POST';
    hiddenForm.action = 'https://script.google.com/macros/s/AKfycbyGICmPIv5MoAG_g00EYbAM05sFYT9bZjBoAadXZyUFtRIloLAPKQfAzX1lkgUMqN1e5Q/exec';
    hiddenForm.target = 'hidden-iframe';

    const fields = [
        { name: 'name', value: name },
        { name: 'id', value: id },
        { name: 'blind', value: blind },
        { name: 'event', value: event },
        { name: 'record', value: record },
        { name: 'checkin', value: 'FALSE' }
    ];

    fields.forEach(field => {
        const input = document.createElement('input');
        input.type = 'hidden';
        input.name = field.name;
        input.value = field.value;
        hiddenForm.appendChild(input);
    });

    document.body.appendChild(hiddenForm);
    hiddenForm.submit();

    setTimeout(() => {
        document.body.removeChild(hiddenForm);
        document.body.removeChild(iframe);
    }, 2000);

    alert("신청이 제출되었습니다!");
    form.reset();
});
