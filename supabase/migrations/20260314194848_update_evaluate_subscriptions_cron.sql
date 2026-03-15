/*
  # Actualizar cron job para evaluate-subscriptions

  ## Descripcion
  Actualiza el cron job para usar la URL hardcodeada de Supabase y la anon key,
  ya que la funcion evaluate-subscriptions no requiere JWT (verifyJWT: false).

  ## Cambios
  - Elimina el cron job anterior que dependia de variables de entorno no configuradas
  - Crea un nuevo cron job con la URL y anon key directas
  - El job se ejecuta el dia 1 de cada mes a las 06:00 UTC
*/

SELECT cron.unschedule('evaluate-subscriptions-monthly')
WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'evaluate-subscriptions-monthly'
);

SELECT cron.schedule(
  'evaluate-subscriptions-monthly',
  '0 6 1 * *',
  $$
  SELECT net.http_post(
    url := 'https://dpfmozdorvuivfhmreit.supabase.co/functions/v1/evaluate-subscriptions',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body := '{}'::jsonb
  );
  $$
);
