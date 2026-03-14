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
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "No autorizado" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      return new Response(JSON.stringify({ error: "No autorizado" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { planId, successUrl, cancelUrl } = await req.json();
    if (!planId) {
      return new Response(JSON.stringify({ error: "planId es requerido" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: plan, error: planError } = await supabase
      .from("plans")
      .select("*")
      .eq("id", planId)
      .eq("is_active", true)
      .maybeSingle();

    if (planError || !plan) {
      return new Response(JSON.stringify({ error: "Plan no encontrado" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const mpAccessToken = Deno.env.get("MERCADOPAGO_ACCESS_TOKEN");
    if (!mpAccessToken) {
      return new Response(JSON.stringify({ error: "MercadoPago no configurado" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const origin = successUrl?.split("/").slice(0, 3).join("/") || "http://localhost:5173";

    const preference = {
      items: [
        {
          id: plan.id,
          title: plan.name,
          description: plan.description || plan.name,
          quantity: 1,
          currency_id: "ARS",
          unit_price: plan.price_ars,
        },
      ],
      payer: {
        email: user.email,
      },
      back_urls: {
        success: successUrl || `${origin}?checkout=success&plan_id=${plan.id}`,
        failure: cancelUrl || `${origin}?checkout=cancelled`,
        pending: `${origin}?checkout=pending&plan_id=${plan.id}`,
      },
      auto_return: "approved",
      external_reference: JSON.stringify({
        supabase_user_id: user.id,
        supabase_plan_id: plan.id,
      }),
      notification_url: `${Deno.env.get("SUPABASE_URL")}/functions/v1/mp-webhook`,
      metadata: {
        supabase_user_id: user.id,
        supabase_plan_id: plan.id,
      },
    };

    const mpResponse = await fetch("https://api.mercadopago.com/checkout/preferences", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${mpAccessToken}`,
        "Content-Type": "application/json",
        "X-Idempotency-Key": `checkout-${user.id}-${plan.id}-${Date.now()}`,
      },
      body: JSON.stringify(preference),
    });

    if (!mpResponse.ok) {
      const mpError = await mpResponse.json();
      console.error("MercadoPago error:", mpError);
      return new Response(JSON.stringify({ error: "Error al crear el checkout en MercadoPago" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const mpData = await mpResponse.json();

    return new Response(
      JSON.stringify({ url: mpData.init_point, preferenceId: mpData.id }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("create-checkout error:", err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "Error interno" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
