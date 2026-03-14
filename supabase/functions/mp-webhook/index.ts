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
    const mpAccessToken = Deno.env.get("MERCADOPAGO_ACCESS_TOKEN");
    if (!mpAccessToken) {
      return new Response(JSON.stringify({ error: "MercadoPago no configurado" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const body = await req.json();
    const { type, data } = body;

    if (type === "payment" && data?.id) {
      const paymentResp = await fetch(`https://api.mercadopago.com/v1/payments/${data.id}`, {
        headers: { "Authorization": `Bearer ${mpAccessToken}` },
      });

      if (!paymentResp.ok) {
        return new Response(JSON.stringify({ received: true }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const payment = await paymentResp.json();
      const externalRef = payment.external_reference;

      let userId: string | null = null;
      let planId: string | null = null;

      try {
        const parsed = JSON.parse(externalRef);
        userId = parsed.supabase_user_id;
        planId = parsed.supabase_plan_id;
      } catch {
        console.error("external_reference invalido:", externalRef);
      }

      if (!userId || !planId) {
        return new Response(JSON.stringify({ received: true }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const mpPayerId = String(payment.payer?.id || "");
      const mpPaymentId = String(payment.id);
      const now = new Date();
      const periodEnd = new Date(now);
      periodEnd.setDate(periodEnd.getDate() + 30);

      if (payment.status === "approved") {
        const { data: existingSub } = await supabase
          .from("user_subscriptions")
          .select("id, status")
          .eq("user_id", userId)
          .maybeSingle();

        if (existingSub) {
          await supabase
            .from("user_subscriptions")
            .update({
              plan_id: planId,
              status: "active",
              mp_payer_id: mpPayerId,
              mp_preapproval_id: mpPaymentId,
              trial_ends_at: null,
              current_period_start: now.toISOString(),
              current_period_end: periodEnd.toISOString(),
              updated_at: now.toISOString(),
            })
            .eq("user_id", userId);
        } else {
          await supabase.from("user_subscriptions").insert({
            user_id: userId,
            plan_id: planId,
            status: "active",
            mp_payer_id: mpPayerId,
            mp_preapproval_id: mpPaymentId,
            current_period_start: now.toISOString(),
            current_period_end: periodEnd.toISOString(),
          });
        }

        await supabase.from("plan_change_log").insert({
          user_id: userId,
          new_plan_id: planId,
          change_reason: "initial_subscription",
          triggered_by: "mp_webhook",
          notes: `Pago aprobado. MercadoPago payment_id: ${mpPaymentId}`,
        });

      } else if (payment.status === "pending" || payment.status === "in_process") {
        const { data: existingSub } = await supabase
          .from("user_subscriptions")
          .select("id")
          .eq("user_id", userId)
          .maybeSingle();

        if (existingSub) {
          await supabase
            .from("user_subscriptions")
            .update({
              plan_id: planId,
              status: "trial",
              mp_payer_id: mpPayerId,
              mp_preapproval_id: mpPaymentId,
              trial_ends_at: periodEnd.toISOString(),
              current_period_start: now.toISOString(),
              current_period_end: periodEnd.toISOString(),
              updated_at: now.toISOString(),
            })
            .eq("user_id", userId);
        } else {
          await supabase.from("user_subscriptions").insert({
            user_id: userId,
            plan_id: planId,
            status: "trial",
            mp_payer_id: mpPayerId,
            mp_preapproval_id: mpPaymentId,
            trial_ends_at: periodEnd.toISOString(),
            current_period_start: now.toISOString(),
            current_period_end: periodEnd.toISOString(),
          });
        }

      } else if (payment.status === "rejected" || payment.status === "cancelled") {
        await supabase
          .from("user_subscriptions")
          .update({
            status: "past_due",
            updated_at: now.toISOString(),
          })
          .eq("user_id", userId);

        await supabase.from("plan_change_log").insert({
          user_id: userId,
          new_plan_id: planId,
          change_reason: "payment_failed",
          triggered_by: "mp_webhook",
          notes: `Pago ${payment.status}. MercadoPago payment_id: ${mpPaymentId}`,
        });
      }
    }

    if (type === "subscription_preapproval" && data?.id) {
      const subResp = await fetch(`https://api.mercadopago.com/preapproval/${data.id}`, {
        headers: { "Authorization": `Bearer ${mpAccessToken}` },
      });

      if (!subResp.ok) {
        return new Response(JSON.stringify({ received: true }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const subscription = await subResp.json();
      const externalRef = subscription.external_reference;

      let userId: string | null = null;
      try {
        const parsed = JSON.parse(externalRef || "{}");
        userId = parsed.supabase_user_id;
      } catch {
        console.error("external_reference invalido:", externalRef);
      }

      if (!userId) {
        return new Response(JSON.stringify({ received: true }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const statusMap: Record<string, string> = {
        authorized: "active",
        pending: "trial",
        paused: "at_risk",
        cancelled: "cancelled",
      };

      const newStatus = statusMap[subscription.status] || subscription.status;

      await supabase
        .from("user_subscriptions")
        .update({
          status: newStatus,
          mp_preapproval_id: String(subscription.id),
          updated_at: new Date().toISOString(),
        })
        .eq("user_id", userId);

      if (subscription.status === "cancelled") {
        await supabase.from("plan_change_log").insert({
          user_id: userId,
          new_plan_id: subscription.external_reference,
          change_reason: "payment_failed",
          triggered_by: "mp_webhook",
          notes: `Suscripcion cancelada en MercadoPago: ${subscription.id}`,
        });
      }
    }

    return new Response(JSON.stringify({ received: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("mp-webhook error:", err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "Error interno" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
