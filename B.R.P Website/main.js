const SUPABASE_URL = 'https://omamkwxsjonaxpdvbfyp.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9tYW1rd3hzam9uYXhwZHZiZnlwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTE1MjkyMDQsImV4cCI6MjA2NzEwNTIwNH0.FnSFKxb2_2RuDGJoUrvmSzOkUy2Oec1KDoUGcp4xh2U';
const supabase = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const form = document.getElementById('signup');

form.addEventListener('submit', async (e) => {
    e.preventDefault();

    const name = document.getElementById('name').value;
    const blind = document.getElementById('blind').checked;
    const event = parseInt(document.getElementById('event').value);

    const { data, error } = await supabase
        .from('runners') // <-- change this to your actual table name
        .insert([{ name, blind, event }]);

    if (error) {
        alert('다시 시도해주십시오. 에러코드: ' + error.message);
    } else {
        alert('신청 완료!');
        form.reset();
    }
});