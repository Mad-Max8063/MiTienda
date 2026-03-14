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

    const stripeKey = Deno.env.get("STRIPE_SECRET_KEY") || "";

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

      let stripeSync = false;
      if (stripeKey && plan.stripe_price_id) {
        try {
          const priceInCents = Math.round(plan.price_ars * 100);
          const newPriceResp = await fetch("https://api.stripe.com/v1/prices", {
            method: "POST",
            headers: {
              "Authorization": `Bearer ${stripeKey}`,
              "Content-Type": "application/x-www-form-urlencoded",
            },
            body: new URLSearchParams({
              unit_amount: String(priceInCents),
              currency: "ars",
              recurring: JSON.stringify({ interval: "month" }),
              product: plan.stripe_product_id || "",
              nickname: `${plan.name} - ${new Date().toISOString().substring(0, 7)}`,
            }),
          });

          if (newPriceResp.ok) {
            const newPrice = await newPriceResp.json();

            await fetch(`https://api.stripe.com/v1/prices/${plan.stripe_price_id}`, {
              method: "POST",
              headers: {
                "Authorization": `Bearer ${stripeKey}`,
                "Content-Type": "application/x-www-form-urlencoded",
              },
              body: new URLSearchParams({ active: "false" }),
            });

            await supabase
              .from("plans")
              .update({ stripe_price_id: newPrice.id, updated_at: new Date().toISOString() })
              .eq("id", plan.id);

            stripeSync = true;
          }
        } catch (stripeErr) {
          console.error("Stripe sync error for plan", plan.id, stripeErr);
        }
      }

      results.push({ plan_id: plan.id, name: plan.name, status: "ok", current_price: plan.price_ars, stripe_synced: stripeSync });
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
