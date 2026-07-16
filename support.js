const form = document.querySelector('#support-form');
const alertBox = document.querySelector('#support-alert');
const statusPanel = document.querySelector('#ticket-status');
const ticketState = document.querySelector('#ticket-state');
let idempotencyKey = null;
const privateToken = new URLSearchParams(location.search).get('token');
const isPrivateToken = value => /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);

async function readApiJson(response, fallbackMessage) {
  try {
    const data = await response.json();
    if (!data || typeof data !== 'object') throw new Error();
    return data;
  } catch {
    throw new Error(fallbackMessage);
  }
}

const customerError = (error, fallbackMessage) => error instanceof TypeError ? fallbackMessage : error?.message || fallbackMessage;

const formatDate = value => value ? new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata' }).format(new Date(`${value.replace(' ', 'T')}Z`)) : '—';

function presentStatus(element, value) {
  element.textContent = value;
  element.dataset.state = value.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  element.classList.remove('portal-status-reveal');
  requestAnimationFrame(() => element.classList.add('portal-status-reveal'));
}

async function loadStatus(token, { focus = false } = {}) {
  alertBox.textContent = 'Loading your support request…';
  try {
    const response = await fetch(`/api/support/tickets/${encodeURIComponent(token)}`, { cache: 'no-store' });
    const data = await readApiJson(response, 'The support service returned an unreadable response. Please try again.');
    if (!response.ok || !data.success) throw new Error(data.message || 'Support request not found.');
    const ticket = data.ticket;
    document.querySelector('#ticket-reference').textContent = ticket.public_reference;
    document.querySelector('#ticket-category').textContent = ticket.category;
    presentStatus(ticketState, ticket.status);
    document.querySelector('#ticket-created').textContent = formatDate(ticket.created_at);
    document.querySelector('#ticket-updated').textContent = formatDate(ticket.updated_at);
    document.querySelector('#ticket-resolution').textContent = ticket.resolution_note || 'Our customer-care team is reviewing your request.';
    statusPanel.hidden = false;
    if (focus) statusPanel.focus({ preventScroll: false });
    alertBox.textContent = '';
  } catch (error) { alertBox.textContent = customerError(error, 'Support status is temporarily unavailable. Please try again.'); }
}

form.addEventListener('input', () => { idempotencyKey = null; });
form.addEventListener('submit', async event => {
  event.preventDefault();
  const button = form.querySelector('button');
  form.setAttribute('aria-busy', 'true');
  button.disabled = true;
  button.textContent = 'SUBMITTING…';
  alertBox.textContent = 'Recording your request…';
  idempotencyKey ||= `support:${crypto.randomUUID()}`;
  try {
    const response = await fetch('/api/support/tickets', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey }, body: JSON.stringify({ name: document.querySelector('#support-name').value, phone: document.querySelector('#support-phone').value, email: document.querySelector('#support-email').value, category: document.querySelector('#support-category').value, order_reference: document.querySelector('#support-order').value, message: document.querySelector('#support-message').value }) });
    const data = await readApiJson(response, 'The support service returned an unreadable response. Please try again.');
    if (!response.ok || !data.success) throw new Error(data.message || 'Unable to submit the request.');
    idempotencyKey = null;
    const url = new URL(data.statusUrl, location.href);
    history.replaceState({}, '', url);
    form.reset();
    await loadStatus(data.statusToken, { focus: true });
    alertBox.innerHTML = `Request <strong>${data.reference}</strong> was received. Bookmark this private page to check its status.`;
  } catch (error) { alertBox.textContent = customerError(error, 'Support requests are temporarily unavailable. Please try again.'); }
  finally { form.removeAttribute('aria-busy'); button.disabled = false; button.innerHTML = 'SUBMIT REQUEST <span>→</span>'; }
});

if (privateToken) {
  if (isPrivateToken(privateToken)) loadStatus(privateToken);
  else alertBox.textContent = 'This support link is incomplete. Please use the complete private link from your confirmation.';
}
