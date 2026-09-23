/**
 * Idempotent schema setup for Cold Case Archives (self-hosted Supabase).
 * Creates tables, permissive RLS policies, and the realtime publication.
 * Usage: npm run db:setup  (needs DATABASE_URL in .env.local)
 */
import { Client } from "pg";

const DDL = `
create table if not exists rooms (
  id uuid primary key default gen_random_uuid(),
  code text unique not null,
  case_id text not null,
  current_stage int default 1,
  solved boolean default false,
  created_at timestamptz default now()
);

create table if not exists room_state (
  room_id uuid references rooms(id) on delete cascade primary key,
  unlocked_evidence text[] default '{doc-1,doc-2,doc-3}',
  shared_notes text default '',
  corkboard_pins jsonb default '[]'::jsonb,
  last_updated_by text,
  updated_at timestamptz default now()
);

create table if not exists deduction_logs (
  id uuid primary key default gen_random_uuid(),
  room_id uuid references rooms(id) on delete cascade,
  stage int not null,
  submitted_by text not null,
  theory text not null,
  is_correct boolean not null,
  feedback text not null,
  created_at timestamptz default now()
);

alter table rooms enable row level security;
alter table room_state enable row level security;
alter table deduction_logs enable row level security;

drop policy if exists anon_rooms_all on rooms;
create policy anon_rooms_all on rooms for all using (true) with check (true);

drop policy if exists anon_room_state_all on room_state;
create policy anon_room_state_all on room_state for all using (true) with check (true);

drop policy if exists anon_deduction_logs_all on deduction_logs;
create policy anon_deduction_logs_all on deduction_logs for all using (true) with check (true);

-- realtime publication (exists on any Supabase install; create as a safety net)
do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
end $$;

do $$
begin
  if not exists (select 1 from pg_publication_tables p where p.pubname = 'supabase_realtime' and p.schemaname = 'public' and p.tablename = 'rooms') then
    alter publication supabase_realtime add table public.rooms;
  end if;
  if not exists (select 1 from pg_publication_tables p where p.pubname = 'supabase_realtime' and p.schemaname = 'public' and p.tablename = 'room_state') then
    alter publication supabase_realtime add table public.room_state;
  end if;
  if not exists (select 1 from pg_publication_tables p where p.pubname = 'supabase_realtime' and p.schemaname = 'public' and p.tablename = 'deduction_logs') then
    alter publication supabase_realtime add table public.deduction_logs;
  end if;
end $$;

-- full old-record payloads for realtime UPDATE events
alter table room_state replica identity full;
`;

function die(msg: string): never {
  console.error(`\n✖ ${msg}`);
  process.exit(1);
}

async function main() {
  const raw = process.env.DATABASE_URL ?? die("DATABASE_URL is not set (check .env.local)");
  const u = new URL(raw);
  // pg needs a database name; Supabase's default database is "postgres"
  if (!u.pathname || u.pathname === "/") u.pathname = "/postgres";

  // password comes from DB_PASSWORD_B64 (plaintext secrets get masked in .env tooling)
  const password =
    u.password ||
    (process.env.DB_PASSWORD_B64
      ? Buffer.from(process.env.DB_PASSWORD_B64, "base64").toString("utf8")
      : "");

  const client = new Client({
    host: u.hostname,
    port: Number(u.port) || 5432,
    user: u.username || "postgres",
    password,
    database: u.pathname.replace(/^\//, "") || "postgres",
    connectionTimeoutMillis: 10_000,
  });
  console.log(`→ connecting to ${u.protocol}//${u.hostname}:${u.port}${u.pathname}`);
  await client.connect();
  console.log("✔ connected (postgres reachable)");

  await client.query(DDL);
  console.log("✔ applied: 3 tables, RLS enabled, permissive anon policies");

  const tables = await client.query(
    `select table_name from information_schema.tables
     where table_schema = 'public' and table_name in ('rooms','room_state','deduction_logs')
     order by table_name`
  );
  console.log(`✔ tables present: ${tables.rows.map((r: { table_name: string }) => r.table_name).join(", ")}`);

  const policies = await client.query(
    `select tablename, policyname, permissive, roles::text from pg_policies
     where schemaname = 'public' order by tablename`
  );
  for (const p of policies.rows) console.log(`✔ rls policy: ${p.policyname} on ${p.tablename} (permissive=${p.permissive})`);

  const pub = await client.query(
    `select tablename from pg_publication_tables
     where pubname = 'supabase_realtime' order by tablename`
  );
  for (const r of pub.rows) console.log(`✔ realtime: ${r.tablename} in supabase_realtime`);
  if (pub.rows.length === 0) die("supabase_realtime publication has no tables");

  await client.end();
  console.log("\n✔ database setup complete");
}

main().catch((e) => die(e instanceof Error ? e.message : String(e)));