begin;
alter table public.meet_files add column audio_group text;
alter table public.meet_files add column audio_offset_ms bigint not null default 0;
commit;
