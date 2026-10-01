/* =========================================
   LOCAL API
   ========================================= */
const API_BASE = '/api';

const FIELDS = ['Order', 'Customer PO', '_1', 'Planned Delivery Date', 'Carrier/LSP', 'Status'];
const STATUS_OPTIONS = ['OPEN', 'CHECKED IN', 'SHIPPED', 'LATE', 'CANCEL'];

let currentOrders = [];
let currentSort = 'delivery';
let editingOrderKey = null; // null = add mode, otherwise edit mode
let eventSource = null;
let reconnectTimer = null;

/* =========================================
   SSE CONNECTION
   ========================================= */
function connectSSE() {
  setConnection('connecting');

  // Close any existing connection
  if (eventSource) {
    try { eventSource.close(); } catch {}
    eventSource = null;
  }

  eventSource = new EventSource(API_BASE + '/orders/stream');

  eventSource.onopen = () => {
    setConnection('online');
  };

  eventSource.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      if (Array.isArray(data)) {
        currentOrders = data;
        if (currentOrders.length > 0) {
          sortOrders(currentSort);
        } else {
          document.getElementById('orderList').innerHTML = `
            <tr><td colspan="7" style="text-align:center;padding:20px;color:#777;font-weight:600;">
              No orders yet. Click "+ Add Order" or "Upload Excel"
            </td></tr>
          `;
        }
      }
    } catch (err) {
      console.error('Bad SSE payload:', err, event.data);
    }
  };

  eventSource.onerror = () => {
    setConnection('offline');
    if (eventSource) {
      try { eventSource.close(); } catch {}
      eventSource = null;
    }
    clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(connectSSE, 3000);
  };
}

/* =========================================
   TIME DROPDOWN (06:00 → 16:00, hourly)
   ========================================= */
function populateTimeDropdown(selectedValue) {
  const select = document.getElementById('field_Planned Delivery Date');
  select.innerHTML = '<option value="">-- Select Time --</option>';
  for (let hour = 6; hour <= 16; hour++) {
    const hh = String(hour).padStart(2, '0');
    const timeStr = hh + ':00';
    const opt = document.createElement('option');
    opt.value = timeStr;
    opt.textContent = timeStr;
    if (selectedValue && String(selectedValue).trim() === timeStr) opt.selected = true;
    select.appendChild(opt);
  }
}

/* =========================================
   ORDER MODAL (Add / Edit)
   ========================================= */
function showAddModal() {
  editingOrderKey = null;
  document.getElementById('orderModalTitle').textContent = '➕ Add New Order';
  document.getElementById('orderModalSaveBtn').textContent = 'Save Order';
  document.getElementById('field_Order').value = '';
  document.getElementById('field_Order').disabled = false;
  document.getElementById('field_Customer PO').value = '';
  document.getElementById('field__1').value = '';
  document.getElementById('field_Carrier/LSP').value = '';
  document.getElementById('field_Status').value = 'OPEN';
  populateTimeDropdown('');
  document.getElementById('orderModal').style.display = 'flex';
  setTimeout(() => document.getElementById('field_Order').focus(), 100);
}

function showEditModal(order) {
  if (!order) return;
  const orderKey = getOrderKey(order);
  editingOrderKey = orderKey;

  document.getElementById('orderModalTitle').textContent = '✏️ Edit Order';
  document.getElementById('orderModalSaveBtn').textContent = 'Update Order';
  document.getElementById('field_Order').value = order['Order'] || '';
  document.getElementById('field_Order').disabled = false;
  document.getElementById('field_Customer PO').value = order['Customer PO'] || '';
  document.getElementById('field__1').value = order['_1'] || '';
  document.getElementById('field_Carrier/LSP').value = order['Carrier/LSP'] || '';

  const status = String(order['Status'] || 'OPEN').toUpperCase();
  document.getElementById('field_Status').value = STATUS_OPTIONS.includes(status) ? status : 'OPEN';

  populateTimeDropdown(order['Planned Delivery Date'] || '');

  document.getElementById('orderModal').style.display = 'flex';
  setTimeout(() => document.getElementById('field_Customer PO').focus(), 100);
}

function closeOrderModal() {
  document.getElementById('orderModal').style.display = 'none';
  editingOrderKey = null;
}

/* =========================================
   SUBMIT ORDER (Add or Update)
   ========================================= */
async function submitOrder() {
  const orderVal = document.getElementById('field_Order').value.trim();
  if (!orderVal) {
    showError('Order is required');
    return;
  }

  const formData = {
    'Order': orderVal,
    'Customer PO': document.getElementById('field_Customer PO').value.trim(),
    '_1': document.getElementById('field__1').value.trim(),
    'Planned Delivery Date': document.getElementById('field_Planned Delivery Date').value,
    'Carrier/LSP': document.getElementById('field_Carrier/LSP').value.trim(),
    'Status': document.getElementById('field_Status').value
  };

  const saveBtn = document.getElementById('orderModalSaveBtn');
  const originalText = saveBtn.textContent;
  saveBtn.disabled = true;
  saveBtn.innerHTML = '<span class="spinner"></span>Saving...';

  try {
    if (editingOrderKey) {
      const body = { column: editingOrderKey.column };
      for (const [k, v] of Object.entries(formData)) body[k] = v;

      const response = await fetch(API_BASE + '/orders/' + encodeURIComponent(editingOrderKey.value), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error || 'Failed to update order');
      }
      showSuccess('✅ Order updated successfully!');
    } else {
      const response = await fetch(API_BASE + '/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData)
      });
      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error || 'Failed to insert order');
      }
      showSuccess('✅ Order added successfully!');
    }
    closeOrderModal();
    // No manual reload — SSE broadcast will push the update.
  } catch (e) {
    showError('Error: ' + e.message);
  } finally {
    saveBtn.disabled = false;
    saveBtn.textContent = originalText;
  }
}

/* =========================================
   ORDER KEY
   ========================================= */
function getOrderKey(order) {
  if (!order) return null;
  const val = order['Order'];
  if (val === undefined || val === null || String(val).trim() === '') return null;
  return { column: 'Order', value: val };
}

/* =========================================
   REMOVE ALL
   ========================================= */
function showRemoveAllModal() {
  document.getElementById('orderCountText').textContent = 'Total orders: ' + currentOrders.length;
  document.getElementById('removeAllModal').style.display = 'flex';
}
function closeRemoveAllModal() {
  document.getElementById('removeAllModal').style.display = 'none';
}

async function removeAllOrders() {
  try {
    if (currentOrders.length === 0) {
      showError('No orders to remove.');
      closeRemoveAllModal();
      return;
    }
    const response = await fetch(API_BASE + '/orders', { method: 'DELETE' });
    if (!response.ok) {
      const err = await response.json();
      throw new Error(err.error || 'Failed to delete all orders');
    }
    const result = await response.json();
    showSuccess('✅ Removed ' + result.deletedCount + ' order(s) successfully!');
    closeRemoveAllModal();
    // SSE broadcast handles refresh.
  } catch (e) {
    showError('Error: ' + e.message);
    closeRemoveAllModal();
  }
}

/* =========================================
   EXCEL / CSV UPLOAD
   ========================================= */
function triggerUpload() {
  document.getElementById('fileInput').click();
}

document.getElementById('fileInput').addEventListener('change', async function () {
  const file = this.files && this.files[0];
  if (!file) return;

  const btn = document.getElementById('uploadBtn');
  const originalText = btn.textContent;
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span>Uploading...';

  try {
    const formData = new FormData();
    formData.append('file', file);

    const response = await fetch(API_BASE + '/orders/upload', {
      method: 'POST',
      body: formData
    });

    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Upload failed');

    showSuccess('✅ Imported ' + result.imported + ' row(s) from ' + file.name);
    // SSE broadcast handles refresh.
  } catch (e) {
    showError('Upload error: ' + e.message);
  } finally {
    btn.disabled = false;
    btn.textContent = originalText;
    this.value = '';
  }
});

/* =========================================
   DATE PARSING
   ========================================= */
function parseDeliveryDate(value) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  if (!text) return null;

  let m = text.match(/^(\d{1,2}):(\d{2})/);
  if (m) {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), now.getDate(), Number(m[1]), Number(m[2])).getTime();
  }

  const native = new Date(text);
  if (!isNaN(native.getTime())) return native.getTime();

  m = text.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})/);
  if (m) {
    let day = Number(m[1]);
    let month = Number(m[2]);
    let year = Number(m[3]);
    if (year < 100) year += 2000;
    return new Date(year, month - 1, day).getTime();
  }

  m = text.match(/^(\d{4})[\/\-.](\d{1,2})[\/\-.](\d{1,2})/);
  if (m) {
    return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getTime();
  }

  return null;
}

/* =========================================
   SORTING
   ========================================= */
function sortOrders(sortType) {
  currentSort = sortType;
  document.querySelectorAll('.sort-btn').forEach(btn => btn.classList.remove('active'));
  const btnMap = { delivery: 'sortDelivery', status: 'sortStatus', customer: 'sortCustomer' };
  const activeBtn = document.getElementById(btnMap[sortType]);
  if (activeBtn) activeBtn.classList.add('active');
  if (!currentOrders || currentOrders.length === 0) return;

  let sortedOrders = [...currentOrders];

  if (sortType === 'delivery') {
    sortedOrders.sort((a, b) => {
      const timeA = parseDeliveryDate(a['Planned Delivery Date']);
      const timeB = parseDeliveryDate(b['Planned Delivery Date']);
      if (timeA === null && timeB === null) return 0;
      if (timeA === null) return 1;
      if (timeB === null) return -1;
      return timeA - timeB;
    });
  } else if (sortType === 'status') {
    const statusOrder = { 'OPEN': 0, 'CHECKED IN': 1, 'SHIPPED': 2, 'LATE': 3, 'CANCEL': 4 };
    sortedOrders.sort((a, b) => {
      const statusA = String(a['Status'] || 'OPEN').toUpperCase();
      const statusB = String(b['Status'] || 'OPEN').toUpperCase();
      const cmp = (statusOrder[statusA] ?? 0) - (statusOrder[statusB] ?? 0);
      if (cmp !== 0) return cmp;
      const timeA = parseDeliveryDate(a['Planned Delivery Date']);
      const timeB = parseDeliveryDate(b['Planned Delivery Date']);
      if (timeA === null && timeB === null) return 0;
      if (timeA === null) return 1;
      if (timeB === null) return -1;
      return timeA - timeB;
    });
  } else if (sortType === 'customer') {
    sortedOrders.sort((a, b) => {
      const customerA = String(a['_1'] ?? '').trim();
      const customerB = String(b['_1'] ?? '').trim();
      const cmp = customerA.localeCompare(customerB, undefined, { sensitivity: 'base' });
      if (cmp !== 0) return cmp;
      const timeA = parseDeliveryDate(a['Planned Delivery Date']);
      const timeB = parseDeliveryDate(b['Planned Delivery Date']);
      if (timeA === null && timeB === null) return 0;
      if (timeA === null) return 1;
      if (timeB === null) return -1;
      return timeA - timeB;
    });
  }
  renderOrders(sortedOrders);
}

/* =========================================
   UPDATE STATUS / DELETE / LOAD / RENDER
   ========================================= */
async function updateStatus(orderKey, newStatus) {
  try {
    if (!orderKey || !orderKey.column || orderKey.value === undefined || orderKey.value === null) {
      showError('Could not identify order to update');
      return;
    }
    const response = await fetch(API_BASE + '/orders/' + encodeURIComponent(orderKey.value), {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ column: orderKey.column, 'Status': newStatus })
    });
    if (!response.ok) {
      const err = await response.json();
      throw new Error(err.error || 'Failed to update status');
    }
    showSuccess('✅ Status updated to ' + newStatus);
    // SSE broadcast handles refresh.
  } catch (e) {
    showError('Error: ' + e.message);
  }
}

/* Kept for manual refresh (e.g. after reconnect) */
async function loadOrders() {
  try {
    const response = await fetch(API_BASE + '/orders');
    if (!response.ok) throw new Error('Server responded with ' + response.status);
    const data = await response.json();
    setConnection('online');
    currentOrders = data || [];

    if (data && data.length > 0) {
      sortOrders(currentSort);
    } else {
      document.getElementById("orderList").innerHTML = `
        <tr><td colspan="7" style="text-align:center;padding:20px;color:#777;font-weight:600;">
          No orders yet. Click "+ Add Order" or "Upload Excel"
        </td></tr>
      `;
    }
  } catch (e) {
    showError('Error loading orders: ' + e.message);
    setConnection('offline');
  }
}

function renderOrders(orders) {
  const list = document.getElementById("orderList");
  list.innerHTML = "";
  if (!orders || orders.length === 0) {
    list.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:20px;color:#777;font-weight:600;">No orders yet.</td></tr>`;
    return;
  }

  orders.forEach((order) => {
    const row = document.createElement("tr");
    const orderVal        = order['Order'] || '';
    const customerPO      = order['Customer PO'] || '';
    const customer        = order['_1'] || '';
    const plannedDelivery = order['Planned Delivery Date'] || '';
    const carrier         = order['Carrier/LSP'] || '';
    const currentStatus   = order['Status'] || 'OPEN';

    const statusClass = String(currentStatus).toUpperCase().replace(/ /g, '-');
    let rowClass = 'row-OPEN';
    if (statusClass === 'CHECKED-IN') rowClass = 'row-CHECKED-IN';
    else if (statusClass === 'SHIPPED') rowClass = 'row-SHIPPED';
    else if (statusClass === 'LATE') rowClass = 'row-LATE';
    else if (statusClass === 'CANCEL') rowClass = 'row-CANCEL';
    row.className = rowClass;

    const orderKey = getOrderKey(order);

    const statusSelect = document.createElement('select');
    statusSelect.className = 'status-select ' + statusClass;

    STATUS_OPTIONS.forEach(option => {
      const opt = document.createElement('option');
      opt.value = option;
      opt.textContent = option;
      if (option.toLowerCase() === String(currentStatus).toLowerCase()) opt.selected = true;
      statusSelect.appendChild(opt);
    });

    statusSelect.addEventListener('change', function() {
      updateStatus(orderKey, this.value);
    });

    row.innerHTML = `
      <td><span class="data-value">${escapeHtml(String(orderVal))}</span></td>
      <td><span class="data-value">${escapeHtml(String(customerPO))}</span></td>
      <td><span class="data-value">${escapeHtml(String(customer))}</span></td>
      <td><span class="data-value">${escapeHtml(String(plannedDelivery))}</span></td>
      <td><span class="data-value">${escapeHtml(String(carrier))}</span></td>
      <td></td>
      <td><div class="action-cell">
        <button class="edit-btn">Edit</button>
        <button class="remove-btn">Remove</button>
      </div></td>
    `;

    row.querySelector('td:nth-child(6)').appendChild(statusSelect);
    row.querySelector('.edit-btn').addEventListener('click', () => showEditModal(order));
    row.querySelector('.remove-btn').addEventListener('click', () => removeOrder(orderKey));
    list.appendChild(row);
  });
}

async function removeOrder(orderKey) {
  try {
    if (!orderKey || !orderKey.column || orderKey.value === undefined || orderKey.value === null) {
      showError('Could not identify order to remove');
      return;
    }
    const response = await fetch(API_BASE + '/orders/' + encodeURIComponent(orderKey.value), {
      method: 'DELETE'
    });
    if (!response.ok) {
      const err = await response.json();
      throw new Error(err.error || 'Failed to delete order');
    }
    showSuccess('✅ Order removed successfully!');
    // SSE broadcast handles refresh.
  } catch (e) {
    showError('Delete error: ' + e.message);
  }
}

/* =========================================
   HELPERS
   ========================================= */
function setConnection(state) {
  const dot = document.getElementById("connectionDot");
  const text = document.getElementById("connectionText");

  dot.classList.remove("online-dot", "offline-dot", "connecting-dot");

  if (state === 'online') {
    dot.classList.add("online-dot");
    text.textContent = "Live — connected";
  } else if (state === 'offline') {
    dot.classList.add("offline-dot");
    text.textContent = "Offline — retrying…";
  } else {
    dot.classList.add("connecting-dot");
    text.textContent = "Connecting…";
  }
}

function showSuccess(message) {
  const box = document.getElementById("successMessage");
  box.textContent = message;
  box.style.display = "block";
  setTimeout(() => { box.style.display = "none"; }, 5000);
}

function showError(message) {
  const box = document.getElementById("errorMessage");
  box.textContent = "Error: " + message;
  box.style.display = "block";
  setTimeout(() => { box.style.display = "none"; }, 6000);
}

function showInfo(message) {
  const box = document.getElementById("infoMessage");
  box.textContent = message;
  box.style.display = "block";
  setTimeout(() => { box.style.display = "none"; }, 6000);
}

function escapeHtml(value) {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

/* =========================================
   CLOSE MODAL ON OUTSIDE CLICK
   ========================================= */
document.addEventListener('click', function (event) {
  const orderModal = document.getElementById('orderModal');
  const removeAllModal = document.getElementById('removeAllModal');

  if (event.target === orderModal) closeOrderModal();
  if (event.target === removeAllModal) closeRemoveAllModal();
});

/* =========================================   INIT
   ========================================= */
function init() {
  loadOrders();   // initial fallback snapshot (in case SSE is slow)
  connectSSE();   // live updates
}

window.addEventListener('beforeunload', () => {
  if (eventSource) {
    try { eventSource.close(); } catch {}
  }
  clearTimeout(reconnectTimer);
});

init();