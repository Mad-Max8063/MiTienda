import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

async function verifyMpSignature(req: Request, rawBody: string): Promise<boolean> {
  const secret = Deno.env.get("MERCADOPAGO_WEBHOOK_SECRET");
  if (!secret) return true;

  const xSignature = req.headers.get("x-signature");
  const xRequestId = req.headers.get("x-request-id");
  if (!xSignature) return false;

  const params = new URL(req.url).searchParams;
  const dataId = params.get("data.id") || params.get("id") || "";

  const tsPart = xSignature.split(",").find(p => p.trim().startsWith("ts="));
  const v1Part = xSignature.split(",").find(p => p.trim().startsWith("v1="));
  if (!tsPart || !v1Part) return false;

  const ts = tsPart.trim().replace("ts=", "");
  const v1 = v1Part.trim().replace("v1=", "");

  const manifest = `id:${dataId};request-id:${xRequestId || ""};ts:${ts};`;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(manifest));
  const computed = Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, "0")).join("");

  return computed === v1;
}

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

    const rawBody = await req.text();
    const signatureValid = await verifyMpSignature(req, rawBody);
    if (!signatureValid) {
      return new Response(JSON.stringify({ error: "Firma invalida" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = JSON.parse(rawBody);
    const { type, data } = body;

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

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
        let cancelledPlanId: string | null = null;
        try {
          const parsedRef = JSON.parse(subscription.external_reference || "{}");
          cancelledPlanId = parsedRef.supabase_plan_id || null;
        } catch {
          console.error("No se pudo parsear external_reference en cancelacion:", subscription.external_reference);
        }

        if (cancelledPlanId) {
          await supabase.from("plan_change_log").insert({
            user_id: userId,
            new_plan_id: cancelledPlanId,
            change_reason: "payment_failed",
            triggered_by: "mp_webhook",
            notes: `Suscripcion cancelada en MercadoPago: ${subscription.id}`,
          });
        }
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
