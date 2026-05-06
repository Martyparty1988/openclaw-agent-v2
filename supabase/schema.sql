-- Supabase schema for Martybot online memory.
-- Run this in Supabase SQL Editor.

create table if not exists public.martybot_memory (
  user_id text primary key,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists martybot_memory_updated_at_idx
  on public.martybot_memory (updated_at desc);

-- Keep the table private. Martybot writes from Railway using SUPABASE_SERVICE_ROLE_KEY.
alter table public.martybot_memory enable row level security;

-- No public policies are created on purpose.
-- Do not use the service role key in frontend/Vercel browser code.

-- Trvalé nastavení agenta
CREATE TABLE IF NOT EXISTS agent_config (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  agent_type VARCHAR(100) NOT NULL,
  config JSONB NOT NULL,
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Paměť agenta
CREATE TABLE IF NOT EXISTS agent_memory (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  session_id VARCHAR(255),
  context TEXT,
  data JSONB,
  timestamp TIMESTAMP DEFAULT NOW()
);
