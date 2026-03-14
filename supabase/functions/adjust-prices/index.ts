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

    const { data: plans, error: plansError } = await supabase
      .from("plans")
      .select("*")
      .eq("is_active", true)
      .eq("is_free_trial", false);

    if (plansError) throw plansError;

    const { data: history, error: histError } = await supabase
      .from("plan_prices_history")
      .select("plan_id, new_price_ars, inflation_percentage, applied_at")
      .order("applied_at", { ascending: false })
      .limit(50);

    if (histError) throw histError;

    const results = [];

    for (const plan of plans || []) {
      const latestChange = history?.find(h => h.plan_id === plan.id);
      if (!latestChange) {
        results.push({ plan_id: plan.id, name: plan.name, status: "no_history", synced: false });
        continue;
      }

      if (plan.price_ars !== latestChange.new_price_ars) {
        results.push({ plan_id: plan.id, name: plan.name, status: "price_mismatch", current: plan.price_ars, expected: latestChange.new_price_ars });
        continue;
      }

      results.push({
        plan_id: plan.id,
        name: plan.name,
        status: "ok",
        current_price: plan.price_ars,
        mp_synced: true,
      });
    }

    return new Response(JSON.stringify({ success: true, results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ success: false, error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
