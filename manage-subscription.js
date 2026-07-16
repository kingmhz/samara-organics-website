const token = (new URLSearchParams(location.search).get('token') || '').trim().toLowerCase();
const isPrivateToken = value => /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
const statusBox = document.querySelector('#manage-status');
const managerRoot = document.querySelector('#subscription-manager');
const managePanel = document.querySelector('#manage-panel');
const skipPanel = document.querySelector('#skip-panel');
const updatePanel = document.querySelector('#update-panel');
const actionButtons = [...document.querySelectorAll('[data-action]')];
const pauseButton = document.querySelector('[data-action="pause"]');
const resumeButton = document.querySelector('[data-action="resume"]');
const cancelButton = document.querySelector('[data-action="cancel"]');
const subscriptionState = document.querySelector('#subscription-state');
const api = `/api/subscriptions/manage/${encodeURIComponent(token)}`;
let cancelConfirmationTimer;

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

function presentStatus(element, value) {
  element.textContent = value;
  element.dataset.state = value.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  element.classList.remove('portal-status-reveal');
  requestAnimationFrame(() => element.classList.add('portal-status-reveal'));
}

function setBusy(active) {
  managerRoot?.toggleAttribute('aria-busy', active);
  document.querySelectorAll('.subscription-manager button').forEach(button => { button.disabled = active; });
}

function resetCancelConfirmation() {
  clearTimeout(cancelConfirmationTimer);
  if (!cancelButton) return;
  cancelButton.dataset.confirming = 'false';
  cancelButton.textContent = 'Cancel';
}

async function request(method = 'GET', body) {
  const response = await fetch(api, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined, cache: 'no-store' });
  const data = await readApiJson(response, 'The subscription service returned an unreadable response. Please try again.');
  if (!response.ok || !data.success) throw new Error(data.message || 'Request failed.');
  return data;
}

async function load({ clearStatus = true } = {}) {
  const { subscription: item } = await request();
  if (clearStatus) statusBox.textContent = '';
  managePanel.hidden = false;
  const cancelled = item.status === 'Cancelled';
  skipPanel.hidden = cancelled;
  updatePanel.hidden = cancelled;
  pauseButton.hidden = item.status !== 'Active';
  resumeButton.hidden = item.status !== 'Paused';
  cancelButton.hidden = cancelled;
  resetCancelConfirmation();
  document.querySelector('#subscription-product').textContent = item.product_name;
  presentStatus(subscriptionState, item.status);
  const planDates = item.end_date ? `${item.start_date} to ${item.end_date}` : `${item.start_date || 'Current'} onward`;
  document.querySelector('#subscription-summary').textContent = `${item.qty} × ${item.schedule} · ${planDates} · ${item.delivery_slot} · mobile ${item.phone}`;
  document.querySelector('#manage-qty').value = item.qty;
  document.querySelector('#manage-address').value = item.address;
  document.querySelector('#manage-pin').value = item.pincode;
  const skipDate = document.querySelector('#skip-date');
  const indiaDate = offsetDays => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(Date.now() + offsetDays * 86400000));
  skipDate.min = [indiaDate(), item.start_date].filter(Boolean).sort().at(-1);
  skipDate.max = item.end_date || indiaDate(180);
  document.querySelector('#skipped-list').textContent = item.skipped_dates.length ? `Skipped: ${item.skipped_dates.join(', ')}` : 'No skipped dates.';
}

async function update(body) {
  setBusy(true);
  statusBox.textContent = 'Saving…';
  try { await request('PATCH', body); await load({ clearStatus: false }); statusBox.textContent = 'Saved successfully.'; }
  catch (error) { statusBox.textContent = customerError(error, 'Subscription changes are temporarily unavailable. Please try again.'); }
  finally { setBusy(false); }
}

actionButtons.forEach(button => button.addEventListener('click', () => {
  if (button.dataset.action === 'cancel' && button.dataset.confirming !== 'true') {
    resetCancelConfirmation();
    button.dataset.confirming = 'true';
    button.textContent = 'Confirm cancellation';
    statusBox.textContent = 'Select “Confirm cancellation” again to permanently cancel this subscription.';
    cancelConfirmationTimer = setTimeout(() => {
      resetCancelConfirmation();
      statusBox.textContent = 'Cancellation confirmation expired. No changes were made.';
    }, 8000);
    return;
  }
  resetCancelConfirmation();
  update({ action: button.dataset.action });
}));
document.querySelector('#skip-form').addEventListener('submit', event => { event.preventDefault(); update({ action: 'skip', date: document.querySelector('#skip-date').value }); });
document.querySelector('#update-form').addEventListener('submit', event => { event.preventDefault(); update({ action: 'update', qty: Number(document.querySelector('#manage-qty').value), address: document.querySelector('#manage-address').value, pincode: document.querySelector('#manage-pin').value }); });
if (isPrivateToken(token)) {
  setBusy(true);
  load()
    .catch(error => { statusBox.textContent = customerError(error, 'Subscription details are temporarily unavailable. Please try again.'); })
    .finally(() => setBusy(false));
} else {
  statusBox.textContent = 'Open this page using the complete private management link supplied with your subscription confirmation.';
}
