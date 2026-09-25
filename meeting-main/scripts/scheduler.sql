-- Run in Supabase SQL Editor AFTER storing the worker URL and token in Vault.
-- Vault names: meet_worker_url = https://<deployment>/api/worker
--              meet_worker_token = same value as Vercel CRON_SECRET.
-- Do not put actual secret values in this file or version control.
create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;
select cron.schedule('meet-durable-worker','30 seconds',$$
 select net.http_post(
   url := (select decrypted_secret from vault.decrypted_secrets where name='meet_worker_url'),
   headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||(select decrypted_secret from vault.decrypted_secrets where name='meet_worker_token')),
   body := '{}'::jsonb,
   timeout_milliseconds := 55000
 );
$$);
