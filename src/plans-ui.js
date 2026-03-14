import {
  getPlans, getUserSubscription, createSubscription, updateAutoScale,
  getMonthlyMetrics, getCurrentMonthMetrics, getPlanChangeLog,
  getPendingLoyaltyDiscount, respondToLoyaltyDiscount, getAdminSettings,
  formatARS, getMonthName, createMercadoPagoCheckout, applyLoyaltyCoupon
} from './plans-service.js';
import { buildLogoSVG } from './logo.js';

let _supabaseAuth = null;

export function setAuth(auth) {
  _supabaseAuth = auth;
}

function currentUser() {
  return _supabaseAuth;
}

export async function renderPlansPage(container) {
  container.innerHTML = `<div class="flex items-center justify-center py-16"><div class="loader ease-linear rounded-full border-4 border-t-4 border-gray-200 h-12 w-12"></div></div>`;
  try {
    const plans = await getPlans();
    const user = currentUser();
    let userSub = null;
    if (user) userSub = await getUserSubscription(user.uid);

    container.innerHTML = buildPlansPageHTML(plans, userSub, user);
    attachPlansPageEvents(container, plans, userSub, user);
  } catch (e) {
    container.innerHTML = `<p class="text-red-500 text-center py-8">Error cargando planes: ${e.message}</p>`;
  }
}

function buildPlansPageHTML(plans, userSub, user) {
  const trialPlan = plans.find(p => p.is_free_trial);
  const paidPlans = plans.filter(p => !p.is_free_trial);

  return `
  <div class="max-w-6xl mx-auto px-4 py-10">
    <div class="text-center mb-14">
      <span class="inline-block bg-blue-100 text-blue-700 text-sm font-semibold px-4 py-1 rounded-full mb-4 tracking-wide uppercase">Planes y Precios</span>
      <h2 class="text-4xl font-bold text-gray-900 mb-4">Si vos crecés, nosotros también</h2>
      <p class="text-lg text-gray-500 max-w-2xl mx-auto">Tu plan se adapta automáticamente a como le va a tu negocio. Cuando vendés más, subís. Cuando las cosas se complican, bajamos el plan para que pagues menos. Sin trámites.</p>
    </div>

    ${userSub ? buildCurrentPlanBanner(userSub) : buildTrialBanner(trialPlan)}

    <div class="grid md:grid-cols-3 gap-8 mt-10">
      ${paidPlans.map((plan, i) => buildPlanCard(plan, userSub, i)).join('')}
    </div>

    <div class="mt-20 grid md:grid-cols-3 gap-8">
      <div class="text-center p-6">
        <div class="w-14 h-14 bg-blue-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
          <svg class="w-7 h-7 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6"/></svg>
        </div>
        <h3 class="font-bold text-gray-900 mb-2">Escalado automatico</h3>
        <p class="text-gray-500 text-sm">Sube de plan cuando tus ventas crecen, sin que tengas que hacer nada.</p>
      </div>
      <div class="text-center p-6">
        <div class="w-14 h-14 bg-green-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
          <svg class="w-7 h-7 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
        </div>
        <h3 class="font-bold text-gray-900 mb-2">Baja automatica si no va bien</h3>
        <p class="text-gray-500 text-sm">Si tus ventas caen, bajamos tu plan para que pagues menos y no te quedes sin presupuesto.</p>
      </div>
      <div class="text-center p-6">
        <div class="w-14 h-14 bg-amber-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
          <svg class="w-7 h-7 text-amber-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z"/></svg>
        </div>
        <h3 class="font-bold text-gray-900 mb-2">Descuento por lealtad</h3>
        <p class="text-gray-500 text-sm">Si llevas tiempo con nosotros y tenes un mal mes, te ofrecemos un descuento especial para ayudarte a levantar.</p>
      </div>
    </div>

    <div class="mt-16 bg-gray-50 rounded-2xl p-8 text-center">
      <h3 class="text-xl font-bold text-gray-900 mb-2">Precios actualizados mensualmente</h3>
      <p class="text-gray-500 max-w-xl mx-auto">Para no quedar desactualizados frente a la inflacion, nuestros precios se ajustan cada mes. Te avisamos con anticipacion antes de cualquier cambio en tu proximo ciclo de cobro.</p>
    </div>
  </div>
  `;
}

function buildCurrentPlanBanner(userSub) {
  const daysLeft = userSub.trial_ends_at
    ? Math.max(0, Math.ceil((new Date(userSub.trial_ends_at) - Date.now()) / 86400000))
    : null;
  const statusLabels = {
    trial: `<span class="bg-blue-100 text-blue-700 text-xs font-semibold px-3 py-1 rounded-full">Prueba gratuita${daysLeft !== null ? ` · ${daysLeft} dias restantes` : ''}</span>`,
    active: `<span class="bg-green-100 text-green-700 text-xs font-semibold px-3 py-1 rounded-full">Activo</span>`,
    loyalty_discount: `<span class="bg-amber-100 text-amber-700 text-xs font-semibold px-3 py-1 rounded-full">Con descuento de lealtad</span>`,
    at_risk: `<span class="bg-red-100 text-red-700 text-xs font-semibold px-3 py-1 rounded-full">En riesgo</span>`,
  };
  return `
  <div class="bg-blue-50 border border-blue-200 rounded-2xl p-6 flex items-center justify-between flex-wrap gap-4">
    <div>
      <p class="text-sm text-blue-600 font-medium mb-1">Tu plan actual</p>
      <div class="flex items-center gap-3 flex-wrap">
        <span class="text-2xl font-bold text-gray-900">${userSub.plan?.name || 'Plan'}</span>
        ${statusLabels[userSub.status] || ''}
      </div>
    </div>
    <button data-action="go-my-plan" class="bg-blue-600 text-white px-5 py-2 rounded-xl text-sm font-semibold hover:bg-blue-700 transition-colors">Ver mi plan</button>
  </div>`;
}

function buildTrialBanner(trialPlan) {
  if (!trialPlan) return '';
  return `
  <div class="bg-gradient-to-r from-blue-600 to-blue-700 rounded-2xl p-8 text-white text-center">
    <h3 class="text-2xl font-bold mb-2">30 dias gratis, sin tarjeta</h3>
    <p class="text-blue-100 mb-6">Empeza a vender hoy. No necesitas dar datos de pago para probar la plataforma completa.</p>
    <button data-action="start-trial" data-plan-id="${trialPlan.id}" class="bg-white text-blue-700 font-bold px-8 py-3 rounded-xl hover:bg-blue-50 transition-colors">Comenzar prueba gratuita</button>
  </div>`;
}

function buildPlanCard(plan, userSub, index) {
  const isCurrentPlan = userSub?.plan_id === plan.id;
  const features = Array.isArray(plan.features) ? plan.features : JSON.parse(plan.features || '[]');
  const highlighted = index === 1;

  return `
  <div class="relative bg-white rounded-2xl border ${highlighted ? 'border-blue-500 shadow-xl shadow-blue-100' : 'border-gray-200 shadow-sm'} p-8 flex flex-col transition-all hover:-translate-y-1 hover:shadow-lg">
    ${highlighted ? '<div class="absolute -top-3 left-1/2 -translate-x-1/2 bg-blue-600 text-white text-xs font-bold px-4 py-1 rounded-full">MAS POPULAR</div>' : ''}
    <div class="mb-6">
      <div class="mb-3">${buildLogoSVG(0.6 + index * 0.4)}</div>
      <h3 class="text-xl font-bold text-gray-900 mb-1">${plan.name}</h3>
      <p class="text-gray-500 text-sm">${plan.description}</p>
    </div>
    <div class="mb-6">
      <span class="text-4xl font-bold text-gray-900">${formatARS(plan.price_ars)}</span>
      <span class="text-gray-400 text-sm">/mes</span>
    </div>
    <ul class="space-y-3 flex-grow mb-8">
      ${features.map(f => `
        <li class="flex items-center gap-2 text-sm text-gray-700">
          <svg class="w-4 h-4 text-green-500 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M5 13l4 4L19 7"/></svg>
          ${f}
        </li>`).join('')}
    </ul>
    <button
      data-action="select-plan"
      data-plan-id="${plan.id}"
      class="${isCurrentPlan
        ? 'bg-gray-100 text-gray-400 cursor-default'
        : highlighted
          ? 'bg-blue-600 text-white hover:bg-blue-700'
          : 'bg-gray-900 text-white hover:bg-gray-800'
      } w-full py-3 rounded-xl font-semibold transition-colors text-sm"
      ${isCurrentPlan ? 'disabled' : ''}
    >
      ${isCurrentPlan ? 'Plan actual' : 'Seleccionar plan'}
    </button>
  </div>`;
}

function attachPlansPageEvents(container, plans, userSub, user) {
  container.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const action = btn.dataset.action;

    if (action === 'start-trial') {
      if (!user) { window.navigateTo && window.navigateTo('login'); return; }
      try {
        btn.disabled = true;
        btn.textContent = 'Procesando...';
        const planId = btn.dataset.planId;
        await createSubscription(user.uid, planId, true);
        window.navigateTo && window.navigateTo('my-plan');
      } catch (err) {
        btn.disabled = false;
        btn.textContent = 'Comenzar prueba gratuita';
        alert('Error: ' + err.message);
      }
    }

    if (action === 'select-plan') {
      if (!user) { window.navigateTo && window.navigateTo('login'); return; }
      try {
        btn.disabled = true;
        btn.textContent = 'Redirigiendo...';
        const planId = btn.dataset.planId;
        const { url } = await createMercadoPagoCheckout(planId);
        window.location.href = url;
      } catch (err) {
        btn.disabled = false;
        btn.textContent = 'Seleccionar plan';
        alert('Error al iniciar el pago: ' + err.message);
      }
    }

    if (action === 'go-my-plan') {
      window.navigateTo && window.navigateTo('my-plan');
    }
  });
}

export async function renderMyPlanPage(container, user) {
  if (!user) {
    container.innerHTML = `<div class="max-w-md mx-auto mt-16 text-center"><p class="text-gray-500 mb-4">Necesitas iniciar sesion para ver tu plan.</p><button data-page="login" class="bg-blue-600 text-white px-6 py-2 rounded-xl">Iniciar sesion</button></div>`;
    return;
  }

  container.innerHTML = `<div class="flex items-center justify-center py-16"><div class="loader ease-linear rounded-full border-4 border-t-4 border-gray-200 h-12 w-12"></div></div>`;

  try {
    const [userSub, plans, metrics, changeLog, pendingDiscount, settings] = await Promise.all([
      getUserSubscription(user.uid),
      getPlans(),
      getMonthlyMetrics(user.uid),
      getPlanChangeLog(user.uid),
      getPendingLoyaltyDiscount(user.uid),
      getAdminSettings(),
    ]);

    if (!userSub) {
      container.innerHTML = buildNoSubscriptionHTML();
      attachNoSubEvents(container, user, plans);
      return;
    }

    const currentMetrics = metrics.find(m => {
      const now = new Date();
      return m.year === now.getFullYear() && m.month === now.getMonth() + 1;
    });

    container.innerHTML = buildMyPlanHTML(userSub, plans, metrics, currentMetrics, changeLog, pendingDiscount, settings);
    attachMyPlanEvents(container, user, userSub, pendingDiscount);
  } catch (e) {
    container.innerHTML = `<p class="text-red-500 text-center py-8">Error cargando tu plan: ${e.message}</p>`;
  }
}

function buildNoSubscriptionHTML() {
  return `
  <div class="max-w-lg mx-auto mt-16 text-center">
    <div class="w-20 h-20 bg-blue-100 rounded-full flex items-center justify-center mx-auto mb-6">
      <svg class="w-10 h-10 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4"/></svg>
    </div>
    <h2 class="text-2xl font-bold text-gray-900 mb-3">No tenes un plan activo</h2>
    <p class="text-gray-500 mb-8">Elegí un plan para empezar a vender. Tenes 30 dias gratis para probar todo sin compromisos.</p>
    <button data-action="go-plans" class="bg-blue-600 text-white px-8 py-3 rounded-xl font-semibold hover:bg-blue-700 transition-colors">Ver planes disponibles</button>
  </div>`;
}

function attachNoSubEvents(container, user, plans) {
  container.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    if (btn.dataset.action === 'go-plans') window.navigateTo && window.navigateTo('plans');
  });
}

function buildMyPlanHTML(userSub, plans, metrics, currentMetrics, changeLog, pendingDiscount, settings) {
  const currentPlan = userSub.plan;
  const nextPlan = plans.find(p => p.hierarchy_order === (currentPlan?.hierarchy_order || 0) + 1);
  const salesAmount = currentMetrics?.total_amount || 0;
  const maxSales = currentPlan?.max_monthly_sales_amount || 1;
  const salesPct = Math.min(100, Math.round((salesAmount / maxSales) * 100));
  const warningThreshold = settings?.warning_threshold_percentage || 80;

  const daysLeft = userSub.trial_ends_at
    ? Math.max(0, Math.ceil((new Date(userSub.trial_ends_at) - Date.now()) / 86400000))
    : null;

  const statusBadges = {
    trial: `<span class="bg-blue-100 text-blue-700 text-xs font-bold px-3 py-1 rounded-full">PRUEBA GRATUITA${daysLeft !== null ? ` · ${daysLeft} dias` : ''}</span>`,
    active: `<span class="bg-green-100 text-green-700 text-xs font-bold px-3 py-1 rounded-full">ACTIVO</span>`,
    loyalty_discount: `<span class="bg-amber-100 text-amber-700 text-xs font-bold px-3 py-1 rounded-full">DESCUENTO LEALTAD</span>`,
    at_risk: `<span class="bg-red-100 text-red-700 text-xs font-bold px-3 py-1 rounded-full">NECESITA ATENCION</span>`,
  };

  const progressColor = salesPct >= warningThreshold
    ? salesPct >= 100 ? 'bg-green-500' : 'bg-amber-500'
    : 'bg-blue-500';

  return `
  <div class="max-w-4xl mx-auto px-4 py-10">
    <h2 class="text-3xl font-bold text-gray-900 mb-8">Mi Plan</h2>

    ${pendingDiscount ? buildLoyaltyDiscountBanner(pendingDiscount) : ''}

    <div class="grid md:grid-cols-2 gap-6 mb-8">
      <div class="bg-white rounded-2xl border border-gray-200 p-6 shadow-sm">
        <div class="flex items-center justify-between mb-4">
          <h3 class="font-bold text-gray-900">Plan actual</h3>
          ${statusBadges[userSub.status] || ''}
        </div>
        <p class="text-3xl font-bold text-gray-900 mb-1">${currentPlan?.name || 'Sin plan'}</p>
        <p class="text-gray-500 text-sm mb-4">${formatARS(currentPlan?.price_ars || 0)}/mes</p>
        <div class="flex items-center gap-2">
          <span class="text-sm text-gray-500">Escalado automatico</span>
          <button
            data-action="toggle-autoscale"
            data-enabled="${userSub.auto_scale_enabled}"
            class="relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${userSub.auto_scale_enabled ? 'bg-blue-600' : 'bg-gray-200'}"
            role="switch"
          >
            <span class="inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${userSub.auto_scale_enabled ? 'translate-x-6' : 'translate-x-1'}"></span>
          </button>
        </div>
      </div>

      <div class="bg-white rounded-2xl border border-gray-200 p-6 shadow-sm">
        <h3 class="font-bold text-gray-900 mb-4">Ventas este mes</h3>
        <p class="text-3xl font-bold text-gray-900 mb-1">${formatARS(salesAmount)}</p>
        <p class="text-gray-500 text-sm mb-4">de ${formatARS(maxSales)} del limite de tu plan</p>
        <div class="w-full bg-gray-100 rounded-full h-3 mb-2">
          <div class="${progressColor} h-3 rounded-full transition-all" style="width: ${salesPct}%"></div>
        </div>
        <p class="text-xs text-gray-400">${salesPct}% del limite</p>
        ${salesPct >= warningThreshold && salesPct < 100 ? `
          <p class="mt-3 text-xs text-amber-600 font-medium">Estas cerca del limite. Si seguís creciendo, subiremos tu plan automaticamente.</p>
        ` : ''}
        ${salesPct >= 100 ? `
          <p class="mt-3 text-xs text-green-600 font-medium">Superaste el limite de tu plan. Vas a subir de nivel en el proximo ciclo.</p>
        ` : ''}
      </div>
    </div>

    ${nextPlan && salesPct >= 60 ? `
    <div class="bg-green-50 border border-green-200 rounded-2xl p-5 mb-6 flex items-center justify-between flex-wrap gap-3">
      <div>
        <p class="font-semibold text-green-800 mb-1">Siguente nivel: ${nextPlan.name}</p>
        <p class="text-green-600 text-sm">Con ${formatARS(nextPlan.min_monthly_sales_amount)}/mes en ventas, subiras automaticamente.</p>
      </div>
      <span class="text-green-700 text-sm font-semibold">${formatARS(nextPlan.price_ars)}/mes</span>
    </div>` : ''}

    <div class="bg-white rounded-2xl border border-gray-200 p-6 shadow-sm mb-6">
      <h3 class="font-bold text-gray-900 mb-4">Historial de ventas (ultimos 6 meses)</h3>
      ${metrics.length > 0 ? buildSalesChart(metrics) : '<p class="text-gray-400 text-sm">Sin datos de ventas todavia.</p>'}
    </div>

    ${changeLog && changeLog.length > 0 ? `
    <div class="bg-white rounded-2xl border border-gray-200 p-6 shadow-sm">
      <h3 class="font-bold text-gray-900 mb-4">Historial de cambios de plan</h3>
      <div class="space-y-3">
        ${changeLog.map(c => buildChangeLogRow(c)).join('')}
      </div>
    </div>` : ''}
  </div>`;
}

function buildLoyaltyDiscountBanner(discount) {
  return `
  <div class="bg-amber-50 border-2 border-amber-300 rounded-2xl p-6 mb-6">
    <div class="flex items-start gap-4 flex-wrap">
      <div class="w-12 h-12 bg-amber-100 rounded-xl flex items-center justify-center flex-shrink-0">
        <svg class="w-6 h-6 text-amber-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z"/></svg>
      </div>
      <div class="flex-grow">
        <h3 class="font-bold text-amber-900 text-lg mb-1">Tenes un descuento especial disponible</h3>
        <p class="text-amber-700 text-sm mb-3">${discount.message || `Como llevas tiempo con nosotros, te ofrecemos un ${discount.discount_percentage}% de descuento durante ${discount.discount_duration_months} meses en el plan ${discount.plan?.name}.`}</p>
        <div class="flex gap-3 flex-wrap">
          <button data-action="accept-discount" data-discount-id="${discount.id}" class="bg-amber-600 text-white px-5 py-2 rounded-xl text-sm font-semibold hover:bg-amber-700 transition-colors">Aceptar descuento</button>
          <button data-action="reject-discount" data-discount-id="${discount.id}" class="text-amber-600 px-5 py-2 rounded-xl text-sm font-semibold hover:bg-amber-100 transition-colors">No gracias</button>
        </div>
      </div>
    </div>
  </div>`;
}

function buildSalesChart(metrics) {
  const maxAmount = Math.max(...metrics.map(m => m.total_amount), 1);
  const sorted = [...metrics].sort((a, b) => a.year !== b.year ? a.year - b.year : a.month - b.month);

  return `
  <div class="flex items-end gap-2 h-32">
    ${sorted.map(m => {
      const pct = Math.round((m.total_amount / maxAmount) * 100);
      return `
      <div class="flex flex-col items-center flex-1 gap-1">
        <span class="text-xs text-gray-400">${formatARS(m.total_amount).replace('AR$', '$')}</span>
        <div class="w-full bg-blue-500 rounded-t-md" style="height: ${Math.max(4, pct)}%"></div>
        <span class="text-xs text-gray-500">${getMonthName(m.month)}</span>
      </div>`;
    }).join('')}
  </div>`;
}

function buildChangeLogRow(c) {
  const icons = {
    auto_upgrade: { icon: '↑', color: 'text-green-600 bg-green-100', label: 'Subida automatica' },
    auto_downgrade: { icon: '↓', color: 'text-blue-600 bg-blue-100', label: 'Bajada automatica' },
    loyalty_discount: { icon: '♥', color: 'text-amber-600 bg-amber-100', label: 'Descuento de lealtad' },
    manual_admin: { icon: '✎', color: 'text-gray-600 bg-gray-100', label: 'Cambio manual' },
    manual_user: { icon: '✎', color: 'text-gray-600 bg-gray-100', label: 'Cambio manual' },
    trial_end: { icon: '▶', color: 'text-blue-600 bg-blue-100', label: 'Fin de prueba' },
    initial_subscription: { icon: '★', color: 'text-blue-600 bg-blue-100', label: 'Suscripcion inicial' },
    payment_failed: { icon: '!', color: 'text-red-600 bg-red-100', label: 'Pago fallido' },
  };
  const info = icons[c.change_reason] || { icon: '•', color: 'text-gray-600 bg-gray-100', label: c.change_reason };
  const date = new Date(c.created_at).toLocaleDateString('es-AR', { day: 'numeric', month: 'short', year: 'numeric' });

  return `
  <div class="flex items-center gap-3">
    <div class="w-8 h-8 ${info.color} rounded-full flex items-center justify-center text-sm font-bold flex-shrink-0">${info.icon}</div>
    <div class="flex-grow">
      <p class="text-sm font-medium text-gray-900">${info.label}</p>
      <p class="text-xs text-gray-400">${c.previous_plan?.name ? `${c.previous_plan.name} → ` : ''}${c.new_plan?.name || ''}</p>
    </div>
    <span class="text-xs text-gray-400">${date}</span>
  </div>`;
}

function attachMyPlanEvents(container, user, userSub, pendingDiscount) {
  container.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const action = btn.dataset.action;

    if (action === 'toggle-autoscale') {
      const currentEnabled = btn.dataset.enabled === 'true';
      const newEnabled = !currentEnabled;
      try {
        await updateAutoScale(user.uid, newEnabled);
        btn.dataset.enabled = String(newEnabled);
        btn.className = `relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${newEnabled ? 'bg-blue-600' : 'bg-gray-200'}`;
        btn.querySelector('span').className = `inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${newEnabled ? 'translate-x-6' : 'translate-x-1'}`;
      } catch (err) {
        alert('Error actualizando preferencia: ' + err.message);
      }
    }

    if (action === 'accept-discount' || action === 'reject-discount') {
      const discountId = btn.dataset.discountId;
      const accept = action === 'accept-discount';
      try {
        btn.disabled = true;
        await respondToLoyaltyDiscount(discountId, accept);
        if (accept) {
          try {
            await applyLoyaltyCoupon(discountId);
          } catch (_couponErr) {
          }
        }
        const banner = btn.closest('.bg-amber-50') || container.querySelector('.bg-amber-50');
        if (banner) {
          banner.innerHTML = accept
            ? `<p class="text-green-700 font-semibold text-center py-2">Descuento aplicado. Se vera reflejado en tu proximo cobro.</p>`
            : `<p class="text-gray-500 text-center py-2">Descuento rechazado. Seguimos con vos.</p>`;
        }
      } catch (err) {
        btn.disabled = false;
        alert('Error: ' + err.message);
      }
    }

    if (action === 'go-plans') {
      window.navigateTo && window.navigateTo('plans');
    }
  });
}
