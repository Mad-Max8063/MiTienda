import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import Stripe from "npm:stripe@14";

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

    const { discountId } = await req.json();
    if (!discountId) {
      return new Response(JSON.stringify({ error: "discountId es requerido" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: discount, error: discountError } = await supabase
      .from("loyalty_discounts")
      .select("*, plan:plans(*)")
      .eq("id", discountId)
      .eq("user_id", user.id)
      .eq("status", "accepted")
      .maybeSingle();

    if (discountError || !discount) {
      return new Response(JSON.stringify({ error: "Descuento no encontrado o no aceptado" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
    if (!stripeKey) {
      return new Response(JSON.stringify({ error: "Stripe no configurado" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const stripe = new Stripe(stripeKey, { apiVersion: "2024-06-20" });

    const { data: userSub } = await supabase
      .from("user_subscriptions")
      .select("stripe_customer_id, stripe_subscription_id")
      .eq("user_id", user.id)
      .maybeSingle();

    if (!userSub?.stripe_subscription_id) {
      return new Response(JSON.stringify({ error: "No hay suscripcion activa en Stripe" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const coupon = await stripe.coupons.create({
      percent_off: discount.discount_percentage,
      duration: "repeating",
      duration_in_months: discount.discount_duration_months,
      name: `Descuento Lealtad ${discount.discount_percentage}% x ${discount.discount_duration_months} meses`,
      metadata: {
        supabase_user_id: user.id,
        supabase_discount_id: discountId,
      },
    });

    await stripe.subscriptions.update(userSub.stripe_subscription_id, {
      coupon: coupon.id,
    });

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    await supabaseAdmin
      .from("loyalty_discounts")
      .update({
        stripe_coupon_id: coupon.id,
        status: "applied",
        updated_at: new Date().toISOString(),
      })
      .eq("id", discountId);

    await supabaseAdmin
      .from("user_subscriptions")
      .update({
        status: "loyalty_discount",
        stripe_coupon_id: coupon.id,
        updated_at: new Date().toISOString(),
      })
      .eq("user_id", user.id);

    return new Response(
      JSON.stringify({ success: true, couponId: coupon.id }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("create-loyalty-coupon error:", err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "Error interno" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
