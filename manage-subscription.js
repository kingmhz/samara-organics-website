const token = new URLSearchParams(location.search).get('token') || '';
const statusBox = document.querySelector('#manage-status');
const panels = ['#manage-panel', '#skip-panel', '#update-panel'].map(selector => document.querySelector(selector));
const api = `/api/subscriptions/manage/${encodeURIComponent(token)}`;

async function request(method = 'GET', body) {
  const response = await fetch(api, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined, cache: 'no-store' });
  const data = await response.json();
  if (!response.ok || !data.success) throw new Error(data.message || 'Request failed.');
  return data;
}

async function load() {
  try {
    const { subscription: item } = await request();
    statusBox.textContent = '';
    panels.forEach(panel => { panel.hidden = false; });
    document.querySelector('#subscription-product').textContent = item.product_name;
    const planDates = item.end_date ? `${item.start_date} to ${item.end_date}` : `${item.start_date || 'Current'} onward`;
    document.querySelector('#subscription-summary').textContent = `${item.status} · ${item.qty} × ${item.schedule} · ${planDates} · ${item.delivery_slot} · mobile ${item.phone}`;
    document.querySelector('#manage-qty').value = item.qty;
    document.querySelector('#manage-address').value = item.address;
    document.querySelector('#manage-pin').value = item.pincode;
    const skipDate = document.querySelector('#skip-date');
    const indiaDate = offsetDays => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(Date.now() + offsetDays * 86400000));
    skipDate.min = [indiaDate(), item.start_date].filter(Boolean).sort().at(-1);
    skipDate.max = item.end_date || indiaDate(180);
    document.querySelector('#skipped-list').textContent = item.skipped_dates.length ? `Skipped: ${item.skipped_dates.join(', ')}` : 'No skipped dates.';
  } catch (error) { statusBox.textContent = error.message; }
}

async function update(body) {
  statusBox.textContent = 'Saving…';
  try { await request('PATCH', body); statusBox.textContent = 'Saved successfully.'; await load(); }
  catch (error) { statusBox.textContent = error.message; }
}

document.querySelectorAll('[data-action]').forEach(button => button.addEventListener('click', () => {
  if (button.dataset.action === 'cancel' && !confirm('Cancel this subscription? This cannot be reversed online.')) return;
  update({ action: button.dataset.action });
}));
document.querySelector('#skip-form').addEventListener('submit', event => { event.preventDefault(); update({ action: 'skip', date: document.querySelector('#skip-date').value }); });
document.querySelector('#update-form').addEventListener('submit', event => { event.preventDefault(); update({ action: 'update', qty: Number(document.querySelector('#manage-qty').value), address: document.querySelector('#manage-address').value, pincode: document.querySelector('#manage-pin').value }); });
load();
