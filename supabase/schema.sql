-- Enable UUID extension
create extension if not exists "uuid-ossp";

-- Waitlist table
create table if not exists waitlist (
  id uuid default gen_random_uuid() primary key,
  email text unique not null,
  created_at timestamp with time zone default now(),
  source text default 'landing_page',
  position integer,
  notified boolean default false
);

-- Video jobs table
create table if not exists video_jobs (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users on delete cascade,
  product_url text not null,
  product_description text,
  video_length integer default 60,
  tone text default 'professional',
  features_to_highlight text,
  status text default 'pending',
  progress integer default 0,
  progress_message text,
  product_understanding jsonb,
  script jsonb,
  recording_url text,
  final_video_url text,
  error_message text,
  created_at timestamp with time zone default now(),
  completed_at timestamp with time zone
);

-- User profiles (created automatically on signup)
create table if not exists users_profile (
  id uuid references auth.users on delete cascade primary key,
  full_name text,
  company_name text,
  plan text default 'free',
  videos_generated integer default 0,
  created_at timestamp with time zone default now()
);

-- Row Level Security
alter table waitlist enable row level security;
alter table video_jobs enable row level security;
alter table users_profile enable row level security;

-- Policies
create policy "Public can join waitlist"
  on waitlist for insert with check (true);

create policy "Users can view their own jobs"
  on video_jobs for select using (auth.uid() = user_id);

create policy "Users can create their own jobs"
  on video_jobs for insert with check (auth.uid() = user_id);

create policy "Users can update their own jobs"
  on video_jobs for update using (auth.uid() = user_id);

create policy "Users can view their own profile"
  on users_profile for select using (auth.uid() = id);

create policy "Users can update their own profile"
  on users_profile for update using (auth.uid() = id);

-- Auto-create profile on signup
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.users_profile (id, full_name)
  values (new.id, new.raw_user_meta_data->>'full_name');
  return new;
end;
$$ language plpgsql security definer;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();
