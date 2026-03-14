import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data: settings } = await supabase
      .from("admin_settings")
      .select("*")
      .limit(1)
      .maybeSingle();

    const loyaltyThreshold = settings?.loyalty_months_threshold || 6;
    const loyaltyDiscountPct = settings?.loyalty_discount_percentage || 30;
    const loyaltyDurationMonths = settings?.loyalty_discount_duration_months || 3;

    const { data: plans } = await supabase
      .from("plans")
      .select("*")
      .eq("is_active", true)
      .order("hierarchy_order", { ascending: true });

    const { data: subscriptions } = await supabase
      .from("user_subscriptions")
      .select("*, plan:plans(*)")
      .in("status", ["active", "trial", "loyalty_discount"]);

    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth() + 1;
    const prevMonth = currentMonth === 1 ? 12 : currentMonth - 1;
    const prevYear = currentMonth === 1 ? currentYear - 1 : currentYear;

    const results = { upgraded: 0, downgraded: 0, loyalty_offered: 0, unchanged: 0 };

    for (const sub of subscriptions || []) {
      if (!sub.auto_scale_enabled) { results.unchanged++; continue; }

      const { data: prevMetrics } = await supabase
        .from("monthly_sales_metrics")
        .select("*")
        .eq("user_id", sub.user_id)
        .eq("year", prevYear)
        .eq("month", prevMonth)
        .maybeSingle();

      if (!prevMetrics) { results.unchanged++; continue; }

      const salesAmount = prevMetrics.total_amount || 0;
      const currentPlan = sub.plan;
      if (!currentPlan) { results.unchanged++; continue; }

      const nextPlan = plans?.find(p => p.hierarchy_order === currentPlan.hierarchy_order + 1);
      const prevPlan = plans?.find(p => p.hierarchy_order === currentPlan.hierarchy_order - 1);

      if (nextPlan && salesAmount > currentPlan.max_monthly_sales_amount) {
        await supabase.from("user_subscriptions").update({
          plan_id: nextPlan.id,
          status: "active",
          updated_at: new Date().toISOString(),
        }).eq("id", sub.id);

        await supabase.from("plan_change_log").insert({
          user_id: sub.user_id,
          previous_plan_id: currentPlan.id,
          new_plan_id: nextPlan.id,
          change_reason: "auto_upgrade",
          triggered_by: "system",
          sales_amount_at_change: salesAmount,
          notes: `Ventas del mes anterior: $${salesAmount}. Limite del plan: $${currentPlan.max_monthly_sales_amount}`,
        });
        results.upgraded++;
        continue;
      }

      if (prevPlan && salesAmount < currentPlan.min_monthly_sales_amount && currentPlan.min_monthly_sales_amount > 0) {
        await supabase.from("user_subscriptions").update({
          plan_id: prevPlan.id,
          status: "active",
          updated_at: new Date().toISOString(),
        }).eq("id", sub.id);

        await supabase.from("plan_change_log").insert({
          user_id: sub.user_id,
          previous_plan_id: currentPlan.id,
          new_plan_id: prevPlan.id,
          change_reason: "auto_downgrade",
          triggered_by: "system",
          sales_amount_at_change: salesAmount,
          notes: `Ventas del mes anterior: $${salesAmount}. Minimo del plan: $${currentPlan.min_monthly_sales_amount}`,
        });
        results.downgraded++;

        const subCreatedAt = new Date(sub.created_at);
        let monthsActive = (now.getFullYear() - subCreatedAt.getFullYear()) * 12 + (now.getMonth() - subCreatedAt.getMonth());
        if (now.getDate() < subCreatedAt.getDate()) monthsActive--;

        if (monthsActive >= loyaltyThreshold) {
          const { data: existingDiscount } = await supabase
            .from("loyalty_discounts")
            .select("id")
            .eq("user_id", sub.user_id)
            .eq("status", "pending")
            .maybeSingle();

          if (!existingDiscount) {
            const validUntil = new Date();
            validUntil.setMonth(validUntil.getMonth() + 7);

            await supabase.from("loyalty_discounts").insert({
              user_id: sub.user_id,
              plan_id: currentPlan.id,
              discount_percentage: loyaltyDiscountPct,
              discount_duration_months: loyaltyDurationMonths,
              valid_until: validUntil.toISOString(),
              status: "pending",
              trigger_reason: "auto_low_sales",
              message: `Entendemos que los negocios tienen altibajos. Como llevas ${monthsActive} meses con nosotros, te ofrecemos un ${loyaltyDiscountPct}% de descuento durante ${loyaltyDurationMonths} meses para ayudarte a levantar.`,
            });
            results.loyalty_offered++;
          }
        }
        continue;
      }

      results.unchanged++;
    }

    return new Response(JSON.stringify({ success: true, processed: subscriptions?.length || 0, results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ success: false, error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
