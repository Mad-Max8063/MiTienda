/*
  # Sistema de Planes Dinamicos con Ajuste por Inflacion, Escalado Automatico y Lealtad

  ## Resumen
  Crea toda la estructura de base de datos para gestionar planes de suscripcion con precios
  ajustables por inflacion (sin tocar Stripe desde el panel), escalado/desescalado automatico
  basado en ventas mensuales, y un sistema de descuentos de lealtad para emprendedores.

  ## Tablas Nuevas

  ### 1. plans
  - Definicion de cada nivel de plan (Prueba, Inicial, Crecimiento, Pro)
  - Precio base actual, limites de productos y ventas, prestaciones
  - Orden jerarquico entre planes

  ### 2. plan_prices_history
  - Historial de cada ajuste de precio con fecha, precio anterior y nuevo
  - Para transparencia y auditoria

  ### 3. user_subscriptions
  - Suscripcion activa de cada usuario
  - Plan actual, estado, configuracion de escalado automatico
  - Referencia al cliente y suscripcion en Stripe

  ### 4. monthly_sales_metrics
  - Ventas por usuario por mes (cantidad de ordenes, monto total, productos activos)
  - Base para calcular cambios de plan automaticos

  ### 5. plan_change_log
  - Registro de cada cambio de plan con motivo
  - Transparencia total para el usuario y el admin

  ### 6. loyalty_discounts
  - Descuentos generados automaticamente para usuarios leales con caida de ventas
  - Porcentaje, duracion, plan al que aplica, estado de aceptacion

  ### 7. admin_settings
  - Configuracion global: porcentaje de inflacion mensual, umbrales para cambio de plan,
    meses de antiguedad para descuento de lealtad, porcentaje de descuento

  ## Seguridad
  - RLS habilitado en todas las tablas
  - Usuarios solo ven sus propios datos
  - Admin puede ver y modificar todo

  ## Notas importantes
  1. La tabla admin_settings tiene una sola fila (singleton) con los parametros globales
  2. Los planes tienen orden jerarquico del 0 (prueba) al 3 (pro)
  3. Los precios base se guardan en centavos (para evitar problemas de punto flotante)
  4. Se insertan datos iniciales de planes de ejemplo
*/

-- Tabla de planes
CREATE TABLE IF NOT EXISTS plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text UNIQUE NOT NULL,
  description text DEFAULT '',
  price_ars integer NOT NULL DEFAULT 0,
  price_usd_cents integer NOT NULL DEFAULT 0,
  max_products integer NOT NULL DEFAULT 10,
  max_monthly_sales_amount integer NOT NULL DEFAULT 100000,
  min_monthly_sales_amount integer NOT NULL DEFAULT 0,
  features jsonb NOT NULL DEFAULT '[]',
  hierarchy_order integer NOT NULL DEFAULT 0,
  is_free_trial boolean NOT NULL DEFAULT false,
  trial_days integer NOT NULL DEFAULT 30,
  stripe_product_id text DEFAULT '',
  stripe_price_id text DEFAULT '',
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE plans ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Planes visibles para todos los autenticados"
  ON plans FOR SELECT
  TO authenticated
  USING (is_active = true);

CREATE POLICY "Solo admins pueden insertar planes"
  ON plans FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM auth.users
      WHERE auth.users.id = auth.uid()
      AND (auth.users.raw_app_meta_data->>'role') = 'admin'
    )
  );

CREATE POLICY "Solo admins pueden actualizar planes"
  ON plans FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM auth.users
      WHERE auth.users.id = auth.uid()
      AND (auth.users.raw_app_meta_data->>'role') = 'admin'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM auth.users
      WHERE auth.users.id = auth.uid()
      AND (auth.users.raw_app_meta_data->>'role') = 'admin'
    )
  );

-- Historial de precios
CREATE TABLE IF NOT EXISTS plan_prices_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id uuid NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
  previous_price_ars integer NOT NULL DEFAULT 0,
  new_price_ars integer NOT NULL DEFAULT 0,
  inflation_percentage numeric(5,2) NOT NULL DEFAULT 0,
  applied_by uuid REFERENCES auth.users(id),
  applied_at timestamptz DEFAULT now(),
  notes text DEFAULT ''
);

ALTER TABLE plan_prices_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins ven historial de precios"
  ON plan_prices_history FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM auth.users
      WHERE auth.users.id = auth.uid()
      AND (auth.users.raw_app_meta_data->>'role') = 'admin'
    )
  );

CREATE POLICY "Admins insertan historial de precios"
  ON plan_prices_history FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM auth.users
      WHERE auth.users.id = auth.uid()
      AND (auth.users.raw_app_meta_data->>'role') = 'admin'
    )
  );

-- Suscripciones de usuarios
CREATE TABLE IF NOT EXISTS user_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  plan_id uuid NOT NULL REFERENCES plans(id),
  status text NOT NULL DEFAULT 'trial' CHECK (status IN ('trial', 'active', 'loyalty_discount', 'at_risk', 'cancelled', 'past_due')),
  auto_scale_enabled boolean NOT NULL DEFAULT true,
  trial_ends_at timestamptz,
  current_period_start timestamptz DEFAULT now(),
  current_period_end timestamptz,
  stripe_customer_id text DEFAULT '',
  stripe_subscription_id text DEFAULT '',
  stripe_coupon_id text DEFAULT '',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(user_id)
);

ALTER TABLE user_subscriptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Usuarios ven su propia suscripcion"
  ON user_subscriptions FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Usuarios actualizan su propia suscripcion"
  ON user_subscriptions FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Sistema inserta suscripciones"
  ON user_subscriptions FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Admins ven todas las suscripciones"
  ON user_subscriptions FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM auth.users
      WHERE auth.users.id = auth.uid()
      AND (auth.users.raw_app_meta_data->>'role') = 'admin'
    )
  );

-- Metricas mensuales de ventas
CREATE TABLE IF NOT EXISTS monthly_sales_metrics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  year integer NOT NULL,
  month integer NOT NULL CHECK (month >= 1 AND month <= 12),
  total_orders integer NOT NULL DEFAULT 0,
  total_amount integer NOT NULL DEFAULT 0,
  active_products integer NOT NULL DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(user_id, year, month)
);

ALTER TABLE monthly_sales_metrics ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Usuarios ven sus metricas"
  ON monthly_sales_metrics FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Usuarios insertan sus metricas"
  ON monthly_sales_metrics FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Usuarios actualizan sus metricas"
  ON monthly_sales_metrics FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Admins ven todas las metricas"
  ON monthly_sales_metrics FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM auth.users
      WHERE auth.users.id = auth.uid()
      AND (auth.users.raw_app_meta_data->>'role') = 'admin'
    )
  );

-- Log de cambios de plan
CREATE TABLE IF NOT EXISTS plan_change_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  previous_plan_id uuid REFERENCES plans(id),
  new_plan_id uuid NOT NULL REFERENCES plans(id),
  change_reason text NOT NULL CHECK (change_reason IN (
    'auto_upgrade', 'auto_downgrade', 'loyalty_discount', 'manual_admin', 'manual_user',
    'trial_end', 'payment_failed', 'initial_subscription'
  )),
  triggered_by text NOT NULL DEFAULT 'system',
  sales_amount_at_change integer DEFAULT 0,
  notes text DEFAULT '',
  created_at timestamptz DEFAULT now()
);

ALTER TABLE plan_change_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Usuarios ven su propio historial de planes"
  ON plan_change_log FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Sistema inserta log de cambios"
  ON plan_change_log FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Admins ven todo el log de cambios"
  ON plan_change_log FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM auth.users
      WHERE auth.users.id = auth.uid()
      AND (auth.users.raw_app_meta_data->>'role') = 'admin'
    )
  );

-- Descuentos de lealtad
CREATE TABLE IF NOT EXISTS loyalty_discounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  plan_id uuid NOT NULL REFERENCES plans(id),
  discount_percentage integer NOT NULL DEFAULT 30 CHECK (discount_percentage > 0 AND discount_percentage <= 100),
  discount_duration_months integer NOT NULL DEFAULT 3,
  valid_from timestamptz DEFAULT now(),
  valid_until timestamptz,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'rejected', 'expired', 'applied')),
  trigger_reason text NOT NULL DEFAULT 'auto_low_sales',
  stripe_coupon_id text DEFAULT '',
  message text DEFAULT '',
  accepted_at timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE loyalty_discounts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Usuarios ven sus descuentos de lealtad"
  ON loyalty_discounts FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Usuarios actualizan sus descuentos de lealtad"
  ON loyalty_discounts FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Admins insertan descuentos de lealtad"
  ON loyalty_discounts FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM auth.users
      WHERE auth.users.id = auth.uid()
      AND (auth.users.raw_app_meta_data->>'role') = 'admin'
    )
  );

CREATE POLICY "Admins ven todos los descuentos de lealtad"
  ON loyalty_discounts FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM auth.users
      WHERE auth.users.id = auth.uid()
      AND (auth.users.raw_app_meta_data->>'role') = 'admin'
    )
  );

-- Configuracion global del sistema
CREATE TABLE IF NOT EXISTS admin_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  monthly_inflation_percentage numeric(5,2) NOT NULL DEFAULT 5.0,
  months_to_downgrade integer NOT NULL DEFAULT 1,
  loyalty_months_threshold integer NOT NULL DEFAULT 6,
  loyalty_discount_percentage integer NOT NULL DEFAULT 30,
  loyalty_discount_duration_months integer NOT NULL DEFAULT 3,
  auto_scale_default boolean NOT NULL DEFAULT true,
  warning_threshold_percentage integer NOT NULL DEFAULT 80,
  last_inflation_applied_at timestamptz,
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE admin_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Todos los autenticados ven la configuracion"
  ON admin_settings FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Solo admins actualizan la configuracion"
  ON admin_settings FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM auth.users
      WHERE auth.users.id = auth.uid()
      AND (auth.users.raw_app_meta_data->>'role') = 'admin'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM auth.users
      WHERE auth.users.id = auth.uid()
      AND (auth.users.raw_app_meta_data->>'role') = 'admin'
    )
  );

-- Insertar configuracion inicial
INSERT INTO admin_settings (
  monthly_inflation_percentage,
  months_to_downgrade,
  loyalty_months_threshold,
  loyalty_discount_percentage,
  loyalty_discount_duration_months,
  auto_scale_default,
  warning_threshold_percentage
) VALUES (
  5.0, 1, 6, 30, 3, true, 80
) ON CONFLICT DO NOTHING;

-- Insertar planes iniciales
INSERT INTO plans (name, slug, description, price_ars, max_products, max_monthly_sales_amount, min_monthly_sales_amount, features, hierarchy_order, is_free_trial, trial_days, is_active) VALUES
(
  'Prueba Gratuita',
  'trial',
  'Proba la plataforma sin compromiso durante 30 dias',
  0,
  5,
  50000,
  0,
  '["Hasta 5 productos", "Hasta $50.000 en ventas/mes", "Soporte por email", "30 dias gratis"]',
  0,
  true,
  30,
  true
),
(
  'Inicial',
  'starter',
  'Para emprendedores que estan arrancando su tienda',
  15000,
  25,
  200000,
  0,
  '["Hasta 25 productos", "Hasta $200.000 en ventas/mes", "Soporte por email", "Estadisticas basicas", "Escalado automatico"]',
  1,
  false,
  0,
  true
),
(
  'Crecimiento',
  'growth',
  'Para tiendas en expansion con mas volumen de ventas',
  35000,
  100,
  800000,
  200001,
  '["Hasta 100 productos", "Hasta $800.000 en ventas/mes", "Soporte prioritario", "Estadisticas avanzadas", "Escalado automatico", "Descuentos de lealtad"]',
  2,
  false,
  0,
  true
),
(
  'Pro',
  'pro',
  'Para tiendas establecidas con alto volumen',
  75000,
  999999,
  999999999,
  800001,
  '["Productos ilimitados", "Ventas ilimitadas", "Soporte dedicado 24/7", "Estadisticas premium", "Escalado automatico", "Descuentos de lealtad", "Integraciones avanzadas"]',
  3,
  false,
  0,
  true
)
ON CONFLICT (slug) DO NOTHING;

-- Indices para performance
CREATE INDEX IF NOT EXISTS idx_user_subscriptions_user_id ON user_subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_user_subscriptions_plan_id ON user_subscriptions(plan_id);
CREATE INDEX IF NOT EXISTS idx_monthly_sales_metrics_user_month ON monthly_sales_metrics(user_id, year, month);
CREATE INDEX IF NOT EXISTS idx_plan_change_log_user_id ON plan_change_log(user_id);
CREATE INDEX IF NOT EXISTS idx_loyalty_discounts_user_id ON loyalty_discounts(user_id);
CREATE INDEX IF NOT EXISTS idx_loyalty_discounts_status ON loyalty_discounts(status);
