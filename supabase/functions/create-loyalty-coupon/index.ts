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

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const couponCode = `LEALTAD-${user.id.substring(0, 8).toUpperCase()}-${Date.now()}`;

    await supabaseAdmin
      .from("loyalty_discounts")
      .update({
        mp_coupon_id: couponCode,
        status: "applied",
        updated_at: new Date().toISOString(),
      })
      .eq("id", discountId);

    await supabaseAdmin
      .from("user_subscriptions")
      .update({
        status: "loyalty_discount",
        mp_coupon_id: couponCode,
        updated_at: new Date().toISOString(),
      })
      .eq("user_id", user.id);

    return new Response(
      JSON.stringify({ success: true, couponId: couponCode }),
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
