const form = document.querySelector('#tracking-form');
const input = document.querySelector('#tracking-token');
const errorBox = document.querySelector('.tracking-error');
const result = document.querySelector('.tracking-result');
const stages = ['Pending', 'Confirmed', 'Out for Delivery', 'Delivered'];
const cancelButton = document.querySelector('#cancel-order');
const statusHeading = document.querySelector('#track-status');
let activeToken = '';
let cancelConfirmationTimer;
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

function resetCancelConfirmation() {
  clearTimeout(cancelConfirmationTimer);
  cancelButton.dataset.confirming = 'false';
  cancelButton.textContent = 'CANCEL PENDING ORDER';
}

function presentStatus(element, value) {
  element.textContent = value;
  element.dataset.state = value.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  element.classList.remove('portal-status-reveal');
  requestAnimationFrame(() => element.classList.add('portal-status-reveal'));
}

function formatDate(value) {
  const date = new Date(`${value.replace(' ', 'T')}Z`);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata' }).format(date);
}

function renderOrder(order) {
  document.querySelector('#track-order-id').textContent = `#${order.id}`;
  document.querySelector('#track-created').textContent = formatDate(order.createdAt);
  document.querySelector('#track-slot').textContent = `${order.deliveryDate || 'To be confirmed'} · ${order.deliverySlot}`;
  document.querySelector('#track-payment').textContent = order.paymentStatus;
  document.querySelector('#track-total').textContent = `₹${order.total}`;
  presentStatus(statusHeading, order.status);
  cancelButton.hidden = !['Pending', 'Awaiting Payment Verification'].includes(order.status);
  resetCancelConfirmation();
  const items = document.querySelector('#tracking-items');
  items.replaceChildren(...order.items.map(item => {
    const row = document.createElement('div');
    const name = document.createElement('b');
    const detail = document.createElement('span');
    name.textContent = item.name;
    detail.textContent = `${item.qty} × ${item.unit}${item.delivery !== 'one-time' ? ` · ${item.delivery}` : ''}`;
    row.append(name, detail);
    return row;
  }));
  const effectiveStatus = order.status === 'Awaiting Payment Verification' ? 'Pending' : order.status;
  const currentIndex = stages.indexOf(effectiveStatus);
  document.querySelectorAll('.status-journey li').forEach((element, index) => {
    element.classList.toggle('complete', currentIndex >= index);
    element.classList.toggle('current', currentIndex === index);
  });
  result.hidden = false;
  result.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
  result.focus({ preventScroll: true });
}

async function track(token) {
  activeToken = token;
  errorBox.textContent = '';
  result.hidden = true;
  const button = form.querySelector('button');
  form.setAttribute('aria-busy', 'true');
  button.disabled = true;
  button.textContent = 'CHECKING…';
  try {
    const response = await fetch(`/api/orders/track/${encodeURIComponent(token)}`, { cache: 'no-store' });
    const data = await readApiJson(response, 'The order service returned an unreadable response. Please try again.');
    if (!response.ok || !data.success) throw new Error(data.message || 'Order not found.');
    renderOrder(data.order);
  } catch (error) {
    errorBox.textContent = customerError(error, 'The order service is temporarily unavailable. Please try again.');
  } finally {
    form.removeAttribute('aria-busy');
    button.disabled = false;
    button.innerHTML = 'CHECK STATUS <span>→</span>';
  }
}

cancelButton.addEventListener('click', async () => {
  if (!activeToken) return;
  if (cancelButton.dataset.confirming !== 'true') {
    resetCancelConfirmation();
    cancelButton.dataset.confirming = 'true';
    cancelButton.textContent = 'CONFIRM ORDER CANCELLATION';
    errorBox.textContent = 'Select “Confirm order cancellation” again to release reserved inventory.';
    cancelConfirmationTimer = setTimeout(() => {
      resetCancelConfirmation();
      errorBox.textContent = 'Cancellation confirmation expired. Your order was not changed.';
    }, 8000);
    return;
  }
  resetCancelConfirmation();
  cancelButton.disabled = true;
  cancelButton.setAttribute('aria-busy', 'true');
  errorBox.textContent = 'Cancelling order…';
  try {
    const response = await fetch(`/api/orders/track/${encodeURIComponent(activeToken)}/cancel`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    const data = await readApiJson(response, 'The cancellation service returned an unreadable response. Please try again.');
    if (!response.ok || !data.success) throw new Error(data.message || 'Unable to cancel this order.');
    await track(activeToken);
    errorBox.textContent = data.message;
  } catch (error) { errorBox.textContent = customerError(error, 'Order cancellation is temporarily unavailable. Please try again.'); }
  finally { cancelButton.disabled = false; cancelButton.removeAttribute('aria-busy'); }
});

input.addEventListener('input', resetCancelConfirmation);

form.addEventListener('submit', event => {
  event.preventDefault();
  const token = input.value.trim().toLowerCase();
  if (!isPrivateToken(token)) {
    errorBox.textContent = 'Please enter the complete private tracking reference.';
    return;
  }
  const url = new URL(location.href);
  url.searchParams.set('token', token);
  history.replaceState({}, '', url);
  track(token);
});

const token = new URLSearchParams(location.search).get('token');
if (token) {
  const normalizedToken = token.trim().toLowerCase();
  input.value = normalizedToken;
  if (isPrivateToken(normalizedToken)) track(normalizedToken);
  else errorBox.textContent = 'This tracking link is incomplete. Please use the complete private link from your order confirmation.';
}
