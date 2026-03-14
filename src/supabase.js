import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

const SUPABASE_URL = 'https://dpfmozdorvuivfhmreit.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRwZm1vemRvcnZ1aXZmaG1yZWl0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM0ODQyOTYsImV4cCI6MjA4OTA2MDI5Nn0.-9bZYXOytaBYR_VHdV3oJF09AurgwaolziC3WWqZehc';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
