const form = document.querySelector('#tracking-form');
const input = document.querySelector('#tracking-token');
const errorBox = document.querySelector('.tracking-error');
const result = document.querySelector('.tracking-result');
const stages = ['Pending', 'Confirmed', 'Out for Delivery', 'Delivered'];
const cancelButton = document.querySelector('#cancel-order');
let activeToken = '';

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
  document.querySelector('#track-status').textContent = order.status;
  cancelButton.hidden = !['Pending', 'Awaiting Payment Verification'].includes(order.status);
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
}

async function track(token) {
  activeToken = token;
  errorBox.textContent = '';
  result.hidden = true;
  const button = form.querySelector('button');
  button.disabled = true;
  button.textContent = 'CHECKING…';
  try {
    const response = await fetch(`/api/orders/track/${encodeURIComponent(token)}`);
    const data = await response.json();
    if (!response.ok || !data.success) throw new Error(data.message || 'Order not found.');
    renderOrder(data.order);
  } catch (error) {
    errorBox.textContent = error.message;
  } finally {
    button.disabled = false;
    button.innerHTML = 'CHECK STATUS <span>→</span>';
  }
}

cancelButton.addEventListener('click', async () => {
  if (!activeToken || !confirm('Cancel this pending order? Reserved inventory will be released.')) return;
  cancelButton.disabled = true;
  errorBox.textContent = 'Cancelling order…';
  try {
    const response = await fetch(`/api/orders/track/${encodeURIComponent(activeToken)}/cancel`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    const data = await response.json();
    if (!response.ok || !data.success) throw new Error(data.message || 'Unable to cancel this order.');
    await track(activeToken);
    errorBox.textContent = data.message;
  } catch (error) { errorBox.textContent = error.message; }
  finally { cancelButton.disabled = false; }
});

form.addEventListener('submit', event => {
  event.preventDefault();
  const token = input.value.trim().toLowerCase();
  if (!/^[0-9a-f-]{36}$/.test(token)) {
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
  input.value = token;
  track(token.trim().toLowerCase());
}
