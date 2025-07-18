const form = document.getElementById('signup');

form.addEventListener('submit', async (e) => {
    e.preventDefault();

    const name = document.getElementById('name').value;
    const blind = document.getElementById('blind').checked;
    const event = document.getElementById('event').valueAsNumber;
    const record = document.getElementById('record').valueAsNumber || null;

    // Create a form and submit it directly
    const hiddenForm = document.createElement('form');
    hiddenForm.method = 'POST';
    hiddenForm.action = 'https://script.google.com/macros/s/AKfycbyKfsd4IadqbjbPcWfg7AHLEIGCfdlnbscEKvNGSWl7CiGQhR5-DyeF1E6U38x4o20uOA/exec';
    hiddenForm.target = '_blank'; // Opens in new tab

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
    document.body.removeChild(hiddenForm);

    // Show success message
    alert("신청이 제출되었습니다!");
    form.reset();
});