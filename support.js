const form = document.querySelector('#support-form');
const alertBox = document.querySelector('#support-alert');
const statusPanel = document.querySelector('#ticket-status');
let idempotencyKey = null;
const privateToken = new URLSearchParams(location.search).get('token');

const formatDate = value => value ? new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata' }).format(new Date(`${value.replace(' ', 'T')}Z`)) : '—';

async function loadStatus(token) {
  alertBox.textContent = 'Loading your support request…';
  try {
    const response = await fetch(`/api/support/tickets/${encodeURIComponent(token)}`, { cache: 'no-store' });
    const data = await response.json();
    if (!response.ok || !data.success) throw new Error(data.message || 'Support request not found.');
    const ticket = data.ticket;
    document.querySelector('#ticket-reference').textContent = ticket.public_reference;
    document.querySelector('#ticket-category').textContent = ticket.category;
    document.querySelector('#ticket-state').textContent = ticket.status;
    document.querySelector('#ticket-created').textContent = formatDate(ticket.created_at);
    document.querySelector('#ticket-updated').textContent = formatDate(ticket.updated_at);
    document.querySelector('#ticket-resolution').textContent = ticket.resolution_note || 'Our customer-care team is reviewing your request.';
    statusPanel.hidden = false;
    alertBox.textContent = '';
  } catch (error) { alertBox.textContent = error.message; }
}

form.addEventListener('input', () => { idempotencyKey = null; });
form.addEventListener('submit', async event => {
  event.preventDefault();
  const button = form.querySelector('button');
  button.disabled = true;
  alertBox.textContent = 'Recording your request…';
  idempotencyKey ||= `support:${crypto.randomUUID()}`;
  try {
    const response = await fetch('/api/support/tickets', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey }, body: JSON.stringify({ name: document.querySelector('#support-name').value, phone: document.querySelector('#support-phone').value, email: document.querySelector('#support-email').value, category: document.querySelector('#support-category').value, order_reference: document.querySelector('#support-order').value, message: document.querySelector('#support-message').value }) });
    const data = await response.json();
    if (!response.ok || !data.success) throw new Error(data.message || 'Unable to submit the request.');
    idempotencyKey = null;
    const url = new URL(data.statusUrl, location.href);
    history.replaceState({}, '', url);
    form.reset();
    await loadStatus(data.statusToken);
    alertBox.innerHTML = `Request <strong>${data.reference}</strong> was received. Bookmark this private page to check its status.`;
  } catch (error) { alertBox.textContent = error.message; }
  finally { button.disabled = false; }
});

if (privateToken) loadStatus(privateToken);
