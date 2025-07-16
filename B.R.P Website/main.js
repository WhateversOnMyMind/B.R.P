const form = document.getElementById('signup');

form.addEventListener('submit', async (e) => {
    e.preventDefault();

    const name = document.getElementById('name').value;
    const blind = document.getElementById('blind').checked;
    const event = document.getElementById('event').valueAsNumber;
    const record = document.getElementById('record').valueAsNumber || null;

    const payload = {
        name,
        blind,
        event,
        record
    };

    try {
        const response = await fetch("https://script.google.com/macros/s/AKfycbwR2b9gRh2o8iESgJqwBQEtBm3W2nMeO41yKUzpJCMw3u1dtBDyW4aWUwhmGFA2ozicJg/exec", {
            method: "POST",
            body: JSON.stringify(payload),
            headers: {
                "Content-Type": "application/json"
            }
        });

        const result = await response.json();

        if (result.success) {
            alert("신청 완료!");
            form.reset();
        } else {
            throw new Error("전송 실패");
        }
    } catch (err) {
        alert("에러 발생: " + err.message);
        console.error(err);
    }
});
