import {
  getPlans, getAdminSettings, updateAdminSettings, applyInflationToPlan,
  getPlanPricesHistory, getAllSubscriptionsAdmin, createLoyaltyDiscountAdmin,
  formatARS, getMonthName
} from './plans-service.js';

export async function renderAdminPage(container, user) {
  if (!user) {
    container.innerHTML = `<div class="max-w-md mx-auto mt-16 text-center"><p class="text-gray-500">Acceso restringido.</p></div>`;
    return;
  }

  container.innerHTML = `<div class="flex items-center justify-center py-16"><div class="loader ease-linear rounded-full border-4 border-t-4 border-gray-200 h-12 w-12"></div></div>`;

  try {
    const [plans, settings, history, subscriptions] = await Promise.all([
      getPlans(),
      getAdminSettings(),
      getPlanPricesHistory(),
      getAllSubscriptionsAdmin(),
    ]);

    container.innerHTML = buildAdminHTML(plans, settings, history, subscriptions);
    attachAdminEvents(container, plans, settings, subscriptions, user);
  } catch (e) {
    container.innerHTML = `<p class="text-red-500 text-center py-8">Error: ${e.message}</p>`;
  }
}

function buildAdminHTML(plans, settings, history, subscriptions) {
  return `
  <div class="max-w-5xl mx-auto px-4 py-10">
    <div class="flex items-center justify-between mb-8">
      <h2 class="text-3xl font-bold text-gray-900">Panel de Administracion</h2>
      <span class="bg-gray-100 text-gray-600 text-sm font-medium px-3 py-1 rounded-full">Admin</span>
    </div>

    <div class="grid md:grid-cols-4 gap-4 mb-10">
      <div class="bg-white rounded-xl border border-gray-200 p-5 shadow-sm">
        <p class="text-xs text-gray-400 uppercase font-semibold mb-1">Suscriptores</p>
        <p class="text-3xl font-bold text-gray-900">${subscriptions.length}</p>
      </div>
      <div class="bg-white rounded-xl border border-gray-200 p-5 shadow-sm">
        <p class="text-xs text-gray-400 uppercase font-semibold mb-1">Activos</p>
        <p class="text-3xl font-bold text-green-600">${subscriptions.filter(s => s.status === 'active').length}</p>
      </div>
      <div class="bg-white rounded-xl border border-gray-200 p-5 shadow-sm">
        <p class="text-xs text-gray-400 uppercase font-semibold mb-1">En prueba</p>
        <p class="text-3xl font-bold text-blue-600">${subscriptions.filter(s => s.status === 'trial').length}</p>
      </div>
      <div class="bg-white rounded-xl border border-gray-200 p-5 shadow-sm">
        <p class="text-xs text-gray-400 uppercase font-semibold mb-1">Inflacion mensual</p>
        <p class="text-3xl font-bold text-amber-600">${settings?.monthly_inflation_percentage || 5}%</p>
      </div>
    </div>

    <div class="grid md:grid-cols-2 gap-8 mb-8">
      ${buildInflationPanel(plans, settings)}
      ${buildSettingsPanel(settings)}
    </div>

    ${buildPriceHistoryPanel(history)}
    ${buildSubscribersPanel(subscriptions, plans)}
  </div>`;
}

function buildInflationPanel(plans, settings) {
  const paidPlans = plans.filter(p => !p.is_free_trial);
  return `
  <div class="bg-white rounded-2xl border border-gray-200 p-6 shadow-sm">
    <h3 class="font-bold text-gray-900 mb-1">Ajuste por inflacion</h3>
    <p class="text-gray-500 text-sm mb-5">Aplica el aumento mensual a todos los planes sin tocar Stripe.</p>

    <div class="mb-4">
      <label class="block text-sm font-medium text-gray-700 mb-1">Porcentaje de ajuste</label>
      <div class="flex gap-2 items-center">
        <input
          type="number"
          id="inflation-pct"
          value="${settings?.monthly_inflation_percentage || 5}"
          min="0.1"
          max="200"
          step="0.1"
          class="border border-gray-300 rounded-lg px-3 py-2 w-24 text-center font-semibold focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
        />
        <span class="text-gray-500">% de aumento</span>
      </div>
    </div>

    <div class="space-y-2 mb-5">
      ${paidPlans.map(p => `
        <div class="flex justify-between items-center text-sm">
          <span class="text-gray-600">${p.name}</span>
          <div class="flex items-center gap-2">
            <span class="text-gray-400">${formatARS(p.price_ars)}</span>
            <span class="text-gray-400">→</span>
            <span class="font-semibold text-green-700 preview-price" data-plan-id="${p.id}" data-current-price="${p.price_ars}">
              ${formatARS(Math.round(p.price_ars * (1 + (settings?.monthly_inflation_percentage || 5) / 100)))}
            </span>
          </div>
        </div>
      `).join('')}
    </div>

    <div class="mb-4">
      <label class="block text-sm font-medium text-gray-700 mb-1">Nota interna (opcional)</label>
      <input type="text" id="inflation-notes" placeholder="Ej: Ajuste IPC Marzo 2025" class="border border-gray-300 rounded-lg px-3 py-2 w-full text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none" />
    </div>

    <button data-action="apply-inflation" class="w-full bg-blue-600 text-white py-3 rounded-xl font-semibold hover:bg-blue-700 transition-colors text-sm">
      Aplicar ajuste de precios
    </button>
  </div>`;
}

function buildSettingsPanel(settings) {
  return `
  <div class="bg-white rounded-2xl border border-gray-200 p-6 shadow-sm">
    <h3 class="font-bold text-gray-900 mb-1">Configuracion del sistema</h3>
    <p class="text-gray-500 text-sm mb-5">Parametros de escalado automatico y descuentos de lealtad.</p>

    <form id="settings-form" class="space-y-4">
      <div>
        <label class="block text-sm font-medium text-gray-700 mb-1">Meses consecutivos para bajar de plan</label>
        <input type="number" name="months_to_downgrade" value="${settings?.months_to_downgrade || 1}" min="1" max="12"
          class="border border-gray-300 rounded-lg px-3 py-2 w-full text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
      </div>
      <div>
        <label class="block text-sm font-medium text-gray-700 mb-1">Meses de antiguedad para descuento de lealtad</label>
        <input type="number" name="loyalty_months_threshold" value="${settings?.loyalty_months_threshold || 6}" min="1" max="36"
          class="border border-gray-300 rounded-lg px-3 py-2 w-full text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
      </div>
      <div>
        <label class="block text-sm font-medium text-gray-700 mb-1">Porcentaje de descuento por lealtad (%)</label>
        <input type="number" name="loyalty_discount_percentage" value="${settings?.loyalty_discount_percentage || 30}" min="5" max="70"
          class="border border-gray-300 rounded-lg px-3 py-2 w-full text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
      </div>
      <div>
        <label class="block text-sm font-medium text-gray-700 mb-1">Duracion del descuento (meses)</label>
        <input type="number" name="loyalty_discount_duration_months" value="${settings?.loyalty_discount_duration_months || 3}" min="1" max="12"
          class="border border-gray-300 rounded-lg px-3 py-2 w-full text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
      </div>
      <div>
        <label class="block text-sm font-medium text-gray-700 mb-1">Alerta de limite de ventas (%)</label>
        <input type="number" name="warning_threshold_percentage" value="${settings?.warning_threshold_percentage || 80}" min="50" max="99"
          class="border border-gray-300 rounded-lg px-3 py-2 w-full text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
      </div>
      <button type="submit" class="w-full bg-gray-900 text-white py-3 rounded-xl font-semibold hover:bg-gray-800 transition-colors text-sm">
        Guardar configuracion
      </button>
    </form>
  </div>`;
}

function buildPriceHistoryPanel(history) {
  if (!history || history.length === 0) {
    return `<div class="bg-white rounded-2xl border border-gray-200 p-6 shadow-sm mb-8"><h3 class="font-bold text-gray-900 mb-2">Historial de ajustes de precios</h3><p class="text-gray-400 text-sm">Sin ajustes registrados todavia.</p></div>`;
  }
  return `
  <div class="bg-white rounded-2xl border border-gray-200 p-6 shadow-sm mb-8">
    <h3 class="font-bold text-gray-900 mb-4">Historial de ajustes de precios</h3>
    <div class="overflow-x-auto">
      <table class="w-full text-sm">
        <thead>
          <tr class="text-left text-xs text-gray-400 uppercase border-b border-gray-100">
            <th class="pb-3 pr-4">Plan</th>
            <th class="pb-3 pr-4">Precio anterior</th>
            <th class="pb-3 pr-4">Precio nuevo</th>
            <th class="pb-3 pr-4">Ajuste</th>
            <th class="pb-3">Fecha</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-gray-50">
          ${history.map(h => `
            <tr>
              <td class="py-3 pr-4 font-medium text-gray-900">${h.plan?.name || 'Plan'}</td>
              <td class="py-3 pr-4 text-gray-400">${formatARS(h.previous_price_ars)}</td>
              <td class="py-3 pr-4 text-green-700 font-semibold">${formatARS(h.new_price_ars)}</td>
              <td class="py-3 pr-4"><span class="bg-amber-100 text-amber-700 text-xs font-bold px-2 py-0.5 rounded-full">+${h.inflation_percentage}%</span></td>
              <td class="py-3 text-gray-400">${new Date(h.applied_at).toLocaleDateString('es-AR', { day: 'numeric', month: 'short', year: 'numeric' })}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  </div>`;
}

function buildSubscribersPanel(subscriptions, plans) {
  const statusLabels = {
    trial: { label: 'Prueba', color: 'bg-blue-100 text-blue-700' },
    active: { label: 'Activo', color: 'bg-green-100 text-green-700' },
    loyalty_discount: { label: 'Descuento', color: 'bg-amber-100 text-amber-700' },
    at_risk: { label: 'En riesgo', color: 'bg-red-100 text-red-700' },
    cancelled: { label: 'Cancelado', color: 'bg-gray-100 text-gray-500' },
    past_due: { label: 'Vencido', color: 'bg-red-100 text-red-700' },
  };

  return `
  <div class="bg-white rounded-2xl border border-gray-200 p-6 shadow-sm">
    <div class="flex items-center justify-between mb-4">
      <h3 class="font-bold text-gray-900">Suscriptores</h3>
      <span class="text-xs text-gray-400">${subscriptions.length} total</span>
    </div>
    ${subscriptions.length === 0
      ? '<p class="text-gray-400 text-sm">Sin suscriptores todavia.</p>'
      : `
    <div class="overflow-x-auto">
      <table class="w-full text-sm">
        <thead>
          <tr class="text-left text-xs text-gray-400 uppercase border-b border-gray-100">
            <th class="pb-3 pr-4">Usuario</th>
            <th class="pb-3 pr-4">Plan</th>
            <th class="pb-3 pr-4">Estado</th>
            <th class="pb-3 pr-4">Escalado</th>
            <th class="pb-3">Descuento</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-gray-50">
          ${subscriptions.map(s => {
            const st = statusLabels[s.status] || { label: s.status, color: 'bg-gray-100 text-gray-500' };
            return `
            <tr>
              <td class="py-3 pr-4 font-mono text-xs text-gray-500">${s.user_id.substring(0, 12)}...</td>
              <td class="py-3 pr-4 font-medium text-gray-900">${s.plan?.name || '-'}</td>
              <td class="py-3 pr-4"><span class="text-xs font-bold px-2 py-0.5 rounded-full ${st.color}">${st.label}</span></td>
              <td class="py-3 pr-4"><span class="${s.auto_scale_enabled ? 'text-green-600' : 'text-gray-400'} text-xs font-semibold">${s.auto_scale_enabled ? 'Activo' : 'Inactivo'}</span></td>
              <td class="py-3">
                <button
                  data-action="send-discount"
                  data-user-id="${s.user_id}"
                  data-plan-id="${s.plan_id}"
                  class="text-xs text-amber-600 hover:text-amber-700 font-semibold hover:underline"
                >Enviar descuento</button>
              </td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>`}

    ${buildSendDiscountModal(plans)}
  </div>`;
}

function buildSendDiscountModal(plans) {
  const paidPlans = plans.filter(p => !p.is_free_trial);
  return `
  <div id="discount-modal" class="hidden fixed inset-0 bg-gray-900 bg-opacity-50 flex items-center justify-center z-50">
    <div class="bg-white rounded-2xl p-8 max-w-md w-full mx-4 shadow-2xl">
      <h3 class="text-xl font-bold text-gray-900 mb-5">Enviar descuento de lealtad</h3>
      <form id="discount-form" class="space-y-4">
        <input type="hidden" id="discount-user-id" />
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">Plan al que aplica</label>
          <select id="discount-plan-id" class="border border-gray-300 rounded-lg px-3 py-2 w-full text-sm focus:ring-2 focus:ring-blue-500 outline-none">
            ${paidPlans.map(p => `<option value="${p.id}">${p.name} - ${formatARS(p.price_ars)}/mes</option>`).join('')}
          </select>
        </div>
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">Porcentaje de descuento (%)</label>
          <input type="number" id="discount-pct" value="30" min="5" max="70"
            class="border border-gray-300 rounded-lg px-3 py-2 w-full text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
        </div>
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">Duracion (meses)</label>
          <input type="number" id="discount-duration" value="3" min="1" max="12"
            class="border border-gray-300 rounded-lg px-3 py-2 w-full text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
        </div>
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">Mensaje para el usuario</label>
          <textarea id="discount-message" rows="2" placeholder="Mensaje personalizado (opcional)"
            class="border border-gray-300 rounded-lg px-3 py-2 w-full text-sm focus:ring-2 focus:ring-blue-500 outline-none resize-none"></textarea>
        </div>
        <div class="flex gap-3">
          <button type="submit" class="flex-1 bg-amber-600 text-white py-2 rounded-xl font-semibold hover:bg-amber-700 transition-colors text-sm">Enviar descuento</button>
          <button type="button" data-action="close-discount-modal" class="flex-1 bg-gray-100 text-gray-700 py-2 rounded-xl font-semibold hover:bg-gray-200 transition-colors text-sm">Cancelar</button>
        </div>
      </form>
    </div>
  </div>`;
}

function attachAdminEvents(container, plans, settings, subscriptions, user) {
  const inflationInput = container.querySelector('#inflation-pct');
  if (inflationInput) {
    inflationInput.addEventListener('input', () => {
      const pct = parseFloat(inflationInput.value) || 0;
      container.querySelectorAll('.preview-price').forEach(el => {
        const current = parseInt(el.dataset.currentPrice) || 0;
        el.textContent = formatARS(Math.round(current * (1 + pct / 100)));
      });
    });
  }

  container.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const action = btn.dataset.action;

    if (action === 'apply-inflation') {
      const pct = parseFloat(container.querySelector('#inflation-pct')?.value || '5');
      const notes = container.querySelector('#inflation-notes')?.value || '';
      if (isNaN(pct) || pct <= 0) { alert('Ingresa un porcentaje valido.'); return; }

      const paidPlans = plans.filter(p => !p.is_free_trial);
      if (!confirm(`Confirmas aplicar un ajuste del ${pct}% a ${paidPlans.length} planes?`)) return;

      btn.disabled = true;
      btn.textContent = 'Aplicando...';
      try {
        for (const plan of paidPlans) {
          const newPrice = Math.round(plan.price_ars * (1 + pct / 100));
          await applyInflationToPlan(plan.id, newPrice, plan.price_ars, pct, user.id, notes);
        }
        alert(`Precios actualizados correctamente.`);
        window.navigateTo && window.navigateTo('admin');
      } catch (err) {
        btn.disabled = false;
        btn.textContent = 'Aplicar ajuste de precios';
        alert('Error: ' + err.message);
      }
    }

    if (action === 'send-discount') {
      const modal = container.querySelector('#discount-modal');
      const uidInput = container.querySelector('#discount-user-id');
      if (modal && uidInput) {
        uidInput.value = btn.dataset.userId;
        const planSelect = container.querySelector('#discount-plan-id');
        if (planSelect && btn.dataset.planId) planSelect.value = btn.dataset.planId;
        modal.classList.remove('hidden');
      }
    }

    if (action === 'close-discount-modal') {
      const modal = container.querySelector('#discount-modal');
      if (modal) modal.classList.add('hidden');
    }
  });

  const settingsForm = container.querySelector('#settings-form');
  if (settingsForm) {
    settingsForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const formData = new FormData(settingsForm);
      const newSettings = {
        months_to_downgrade: parseInt(formData.get('months_to_downgrade')),
        loyalty_months_threshold: parseInt(formData.get('loyalty_months_threshold')),
        loyalty_discount_percentage: parseInt(formData.get('loyalty_discount_percentage')),
        loyalty_discount_duration_months: parseInt(formData.get('loyalty_discount_duration_months')),
        warning_threshold_percentage: parseInt(formData.get('warning_threshold_percentage')),
      };
      const submitBtn = settingsForm.querySelector('[type="submit"]');
      submitBtn.disabled = true;
      submitBtn.textContent = 'Guardando...';
      try {
        await updateAdminSettings(newSettings);
        submitBtn.textContent = 'Guardado!';
        setTimeout(() => { submitBtn.disabled = false; submitBtn.textContent = 'Guardar configuracion'; }, 2000);
      } catch (err) {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Guardar configuracion';
        alert('Error: ' + err.message);
      }
    });
  }

  const discountForm = container.querySelector('#discount-form');
  if (discountForm) {
    discountForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const userId = container.querySelector('#discount-user-id')?.value;
      const planId = container.querySelector('#discount-plan-id')?.value;
      const pct = parseInt(container.querySelector('#discount-pct')?.value || '30');
      const duration = parseInt(container.querySelector('#discount-duration')?.value || '3');
      const message = container.querySelector('#discount-message')?.value || '';
      const submitBtn = discountForm.querySelector('[type="submit"]');
      submitBtn.disabled = true;
      submitBtn.textContent = 'Enviando...';
      try {
        await createLoyaltyDiscountAdmin(userId, planId, pct, duration, message);
        const modal = container.querySelector('#discount-modal');
        if (modal) modal.classList.add('hidden');
        alert('Descuento enviado correctamente. El usuario lo vera en su panel.');
        submitBtn.disabled = false;
        submitBtn.textContent = 'Enviar descuento';
      } catch (err) {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Enviar descuento';
        alert('Error: ' + err.message);
      }
    });
  }
}
