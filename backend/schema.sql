-- ระบบสมาชิกและเครดิต (Supabase / PostgreSQL)
-- รันใน SQL Editor ของโปรเจกต์ Supabase หนึ่งครั้ง

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  credits integer not null default 0 check (credits >= 0),
  created_at timestamptz not null default now()
);

create table if not exists public.credit_ledger (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  delta integer not null,
  reason text not null,
  ref text,
  created_at timestamptz not null default now()
);

create table if not exists public.payments (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  omise_charge_id text not null unique,
  amount_satang integer not null,
  credits integer not null,
  status text not null default 'pending',
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;
alter table public.credit_ledger enable row level security;
alter table public.payments enable row level security;

-- ผู้ใช้อ่านได้เฉพาะข้อมูลของตัวเอง ไม่มีสิทธิ์แก้เครดิตโดยตรง
create policy "own profile read" on public.profiles for select using (auth.uid() = id);
create policy "own ledger read" on public.credit_ledger for select using (auth.uid() = user_id);
create policy "own payments read" on public.payments for select using (auth.uid() = user_id);

-- สร้างโปรไฟล์ และให้เครดิตฟรีตอนสมัคร (ค่า 15 เป็นค่าเริ่มต้นชั่วคราว แก้ได้)
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, credits) values (new.id, 15);
  insert into public.credit_ledger (user_id, delta, reason) values (new.id, 15, 'signup_bonus');
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- หักเครดิตจากเซิร์ฟเวอร์เท่านั้น: ตรวจยอดและหักในธุรกรรมเดียวกัน ป้องกันการหักซ้ำพร้อมกัน
create or replace function public.spend_credits(p_cost integer, p_reason text)
returns integer language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_left integer;
begin
  if v_uid is null then raise exception 'not_signed_in'; end if;
  if p_cost <= 0 then raise exception 'bad_cost'; end if;
  update public.profiles set credits = credits - p_cost
    where id = v_uid and credits >= p_cost
    returning credits into v_left;
  if not found then raise exception 'insufficient_credits'; end if;
  insert into public.credit_ledger (user_id, delta, reason) values (v_uid, -p_cost, p_reason);
  return v_left;
end $$;

revoke all on function public.spend_credits(integer, text) from public, anon;
grant execute on function public.spend_credits(integer, text) to authenticated;

-- เพิ่มเครดิตหลังจ่ายเงินสำเร็จ ใช้จากเซิร์ฟเวอร์ที่มี service role เท่านั้น
create or replace function public.grant_credits(p_user uuid, p_credits integer, p_ref text)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.profiles set credits = credits + p_credits where id = p_user;
  insert into public.credit_ledger (user_id, delta, reason, ref) values (p_user, p_credits, 'purchase', p_ref);
end $$;

revoke all on function public.grant_credits(uuid, integer, text) from public, anon, authenticated;
