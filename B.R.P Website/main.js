import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm';

const SUPABASE_URL = 'https://omamkwxsjonaxpdvbfyp.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9tYW1rd3hzam9uYXhwZHZiZnlwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTE1MjkyMDQsImV4cCI6MjA2NzEwNTIwNH0.FnSFKxb2_2RuDGJoUrvmSzOkUy2Oec1KDoUGcp4xh2U';

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const form = document.getElementById('signup');

form.addEventListener('submit', async (e) => {
    e.preventDefault();

    const name = document.getElementById('name').value;
    const blind = document.getElementById('blind').checked;
    const record = document.getElementById('record').valueAsNumber;
    const event = document.getElementById('event').valueAsNumber;
    console.log("Form values:", { name, blind, event });

    const { data, error } = await supabase
        .from('runners')
        .insert([{ name, blind, event }]);

    if (error) {
        console.error("Supabase error:", error);
        alert('에러 발생: ' + error.message);
    } else {
        console.log("Inserted:", data);
        alert('신청 완료!');
        form.reset();
    }
});