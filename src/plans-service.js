import { supabase } from './supabase.js';

export async function getPlans() {
  const { data, error } = await supabase
    .from('plans')
    .select('*')
    .eq('is_active', true)
    .order('hierarchy_order', { ascending: true });
  if (error) throw error;
  return data;
}

export async function getUserSubscription(userId) {
  const { data, error } = await supabase
    .from('user_subscriptions')
    .select('*, plan:plans(*)')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function createSubscription(userId, planId, isTrial = false) {
  const trialEndsAt = isTrial
    ? new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
    : null;
  const { data, error } = await supabase
    .from('user_subscriptions')
    .insert({
      user_id: userId,
      plan_id: planId,
      status: isTrial ? 'trial' : 'active',
      trial_ends_at: trialEndsAt,
      current_period_start: new Date().toISOString(),
      current_period_end: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
    })
    .select('*, plan:plans(*)')
    .single();
  if (error) throw error;
  return data;
}

export async function updateAutoScale(userId, enabled) {
  const { error } = await supabase
    .from('user_subscriptions')
    .update({ auto_scale_enabled: enabled, updated_at: new Date().toISOString() })
    .eq('user_id', userId);
  if (error) throw error;
}

export async function getMonthlyMetrics(userId) {
  const now = new Date();
  const { data, error } = await supabase
    .from('monthly_sales_metrics')
    .select('*')
    .eq('user_id', userId)
    .order('year', { ascending: false })
    .order('month', { ascending: false })
    .limit(6);
  if (error) throw error;
  return data;
}

export async function getCurrentMonthMetrics(userId) {
  const now = new Date();
  const { data, error } = await supabase
    .from('monthly_sales_metrics')
    .select('*')
    .eq('user_id', userId)
    .eq('year', now.getFullYear())
    .eq('month', now.getMonth() + 1)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function upsertMonthlyMetrics(userId, totalAmount, totalOrders, activeProducts) {
  const now = new Date();
  const { error } = await supabase
    .from('monthly_sales_metrics')
    .upsert({
      user_id: userId,
      year: now.getFullYear(),
      month: now.getMonth() + 1,
      total_amount: totalAmount,
      total_orders: totalOrders,
      active_products: activeProducts,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id,year,month' });
  if (error) throw error;
}

export async function getPlanChangeLog(userId) {
  const { data, error } = await supabase
    .from('plan_change_log')
    .select('*, previous_plan:plans!plan_change_log_previous_plan_id_fkey(*), new_plan:plans!plan_change_log_new_plan_id_fkey(*)')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(10);
  if (error) throw error;
  return data;
}

export async function getPendingLoyaltyDiscount(userId) {
  const { data, error } = await supabase
    .from('loyalty_discounts')
    .select('*, plan:plans(*)')
    .eq('user_id', userId)
    .eq('status', 'pending')
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function respondToLoyaltyDiscount(discountId, accept) {
  const { error } = await supabase
    .from('loyalty_discounts')
    .update({
      status: accept ? 'accepted' : 'rejected',
      accepted_at: accept ? new Date().toISOString() : null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', discountId);
  if (error) throw error;
}

export async function getAdminSettings() {
  const { data, error } = await supabase
    .from('admin_settings')
    .select('*')
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function updateAdminSettings(settings) {
  const { data, error } = await supabase
    .from('admin_settings')
    .update({ ...settings, updated_at: new Date().toISOString() })
    .neq('id', '00000000-0000-0000-0000-000000000000')
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function getAllSubscriptionsAdmin() {
  const { data, error } = await supabase
    .from('user_subscriptions')
    .select('*, plan:plans(*)')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data;
}

export async function applyInflationToPlan(planId, newPriceArs, previousPriceArs, inflationPct, adminId, notes) {
  const { error: planError } = await supabase
    .from('plans')
    .update({ price_ars: newPriceArs, updated_at: new Date().toISOString() })
    .eq('id', planId);
  if (planError) throw planError;

  const { error: histError } = await supabase
    .from('plan_prices_history')
    .insert({
      plan_id: planId,
      previous_price_ars: previousPriceArs,
      new_price_ars: newPriceArs,
      inflation_percentage: inflationPct,
      applied_by: adminId,
      notes: notes || `Ajuste por inflacion ${inflationPct}%`,
    });
  if (histError) throw histError;
}

export async function getPlanPricesHistory() {
  const { data, error } = await supabase
    .from('plan_prices_history')
    .select('*, plan:plans(name, slug)')
    .order('applied_at', { ascending: false })
    .limit(30);
  if (error) throw error;
  return data;
}

export async function createLoyaltyDiscountAdmin(userId, planId, discountPct, durationMonths, message) {
  const validUntil = new Date();
  validUntil.setMonth(validUntil.getMonth() + 7);
  const { error } = await supabase
    .from('loyalty_discounts')
    .insert({
      user_id: userId,
      plan_id: planId,
      discount_percentage: discountPct,
      discount_duration_months: durationMonths,
      valid_until: validUntil.toISOString(),
      status: 'pending',
      trigger_reason: 'manual_admin',
      message: message || `Descuento especial del ${discountPct}% por ${durationMonths} meses`,
    });
  if (error) throw error;
}

export function formatARS(cents) {
  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'ARS',
    minimumFractionDigits: 0,
  }).format(cents);
}

export function getMonthName(month) {
  const names = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
  return names[month - 1] || '';
}
