/*
  # Configurar scheduler mensual para evaluate-subscriptions

  ## Descripcion
  Habilita pg_cron y pg_net para programar la ejecucion automatica de la Edge Function
  evaluate-subscriptions el primer dia de cada mes a las 6am UTC.

  ## Cambios
  - Instala la extension pg_cron para scheduling de tareas en Postgres
  - Instala la extension pg_net para realizar llamadas HTTP desde Postgres
  - Crea un cron job que llama a la Edge Function evaluate-subscriptions el dia 1 de cada mes

  ## Notas
  - El cron se ejecuta el dia 1 de cada mes a las 06:00 UTC
  - Usa el service role key almacenado como variable de entorno de Supabase
  - Si el job ya existe, lo elimina y lo recrea para evitar duplicados
*/

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

SELECT cron.unschedule('evaluate-subscriptions-monthly')
WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'evaluate-subscriptions-monthly'
);

SELECT cron.schedule(
  'evaluate-subscriptions-monthly',
  '0 6 1 * *',
  $$
  SELECT net.http_post(
    url := current_setting('app.supabase_url') || '/functions/v1/evaluate-subscriptions',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('app.supabase_service_role_key')
    ),
    body := '{}'::jsonb
  );
  $$
);
