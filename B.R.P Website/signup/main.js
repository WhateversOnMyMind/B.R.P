const form = document.getElementById('signup');

form.addEventListener('submit', async (e) => {
    e.preventDefault();

    const name = document.getElementById('name').value;
    const blind = document.getElementById('blind').checked;
    const event = document.getElementById('event').valueAsNumber;
    const record = document.getElementById('record').valueAsNumber || null;

    // Create a hidden iframe
    const iframe = document.createElement('iframe');
    iframe.style.display = 'none';
    iframe.name = 'hidden-iframe';
    document.body.appendChild(iframe);

    // Create form that submits to the hidden iframe
    const hiddenForm = document.createElement('form');
    hiddenForm.method = 'POST';
    hiddenForm.action = 'YOUR_APPS_SCRIPT_URL_HERE';
    hiddenForm.target = 'hidden-iframe'; // Submit to hidden iframe instead of new tab

    const fields = [
        { name: 'name', value: name },
        { name: 'blind', value: blind },
        { name: 'event', value: event },
        { name: 'record', value: record }
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

    // Clean up
    document.body.removeChild(hiddenForm);
    setTimeout(() => {
        document.body.removeChild(iframe);
    }, 1000);

    // Show success message
    alert("신청이 제출되었습니다!");
    form.reset();
});