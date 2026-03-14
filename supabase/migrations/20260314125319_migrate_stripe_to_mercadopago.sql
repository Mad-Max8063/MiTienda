/*
  # Migrar columnas de Stripe a MercadoPago

  ## Resumen
  Renombra todas las columnas relacionadas con Stripe en las tablas
  `plans`, `user_subscriptions` y `loyalty_discounts` para usar
  nombres correspondientes a MercadoPago.

  ## Cambios en tablas

  ### plans
  - `stripe_product_id` → `mp_plan_id` (ID del plan de suscripcion en MercadoPago)
  - `stripe_price_id` → `mp_preapproval_plan_id` (ID del preapproval plan en MercadoPago)

  ### user_subscriptions
  - `stripe_customer_id` → `mp_payer_id` (ID del pagador en MercadoPago)
  - `stripe_subscription_id` → `mp_preapproval_id` (ID de la suscripcion preapproval)
  - `stripe_coupon_id` → `mp_coupon_id` (ID del cupon de descuento)

  ### loyalty_discounts
  - `stripe_coupon_id` → `mp_coupon_id` (ID del cupon de descuento)

  ## Notas
  - Se preservan todos los datos existentes durante el renombrado
  - Se usa ADD COLUMN + UPDATE para garantizar compatibilidad
*/

DO $$
BEGIN
  -- plans: stripe_product_id -> mp_plan_id
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'plans' AND column_name = 'stripe_product_id') THEN
    ALTER TABLE plans RENAME COLUMN stripe_product_id TO mp_plan_id;
  END IF;

  -- plans: stripe_price_id -> mp_preapproval_plan_id
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'plans' AND column_name = 'stripe_price_id') THEN
    ALTER TABLE plans RENAME COLUMN stripe_price_id TO mp_preapproval_plan_id;
  END IF;

  -- user_subscriptions: stripe_customer_id -> mp_payer_id
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'user_subscriptions' AND column_name = 'stripe_customer_id') THEN
    ALTER TABLE user_subscriptions RENAME COLUMN stripe_customer_id TO mp_payer_id;
  END IF;

  -- user_subscriptions: stripe_subscription_id -> mp_preapproval_id
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'user_subscriptions' AND column_name = 'stripe_subscription_id') THEN
    ALTER TABLE user_subscriptions RENAME COLUMN stripe_subscription_id TO mp_preapproval_id;
  END IF;

  -- user_subscriptions: stripe_coupon_id -> mp_coupon_id
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'user_subscriptions' AND column_name = 'stripe_coupon_id') THEN
    ALTER TABLE user_subscriptions RENAME COLUMN stripe_coupon_id TO mp_coupon_id;
  END IF;

  -- loyalty_discounts: stripe_coupon_id -> mp_coupon_id
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'loyalty_discounts' AND column_name = 'stripe_coupon_id') THEN
    ALTER TABLE loyalty_discounts RENAME COLUMN stripe_coupon_id TO mp_coupon_id;
  END IF;
END $$;
