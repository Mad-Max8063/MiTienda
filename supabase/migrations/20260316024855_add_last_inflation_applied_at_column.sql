/*
  # Add inflation double-application control column

  1. Modified Tables
    - `admin_settings`
      - `last_inflation_applied_at` (timestamptz, nullable) - Timestamp of the last inflation adjustment applied. Used to prevent double application in the same month.

  2. Notes
    - Uses IF NOT EXISTS to safely run migration multiple times
*/

ALTER TABLE admin_settings 
ADD COLUMN IF NOT EXISTS last_inflation_applied_at TIMESTAMPTZ;

COMMENT ON COLUMN admin_settings.last_inflation_applied_at IS 
  'Timestamp de la última aplicación de ajuste por inflación. Usado para prevenir doble aplicación en el mismo mes.';
