/*
# Create initial admin user

Creates the first admin agent account so the application can be accessed.
Email: admin@hostmyguest.com
Password: HMGadmin2026!

This is a bootstrap admin — change the password after first login.
*/

-- Create the auth user
INSERT INTO auth.users (
  instance_id,
  id,
  aud,
  role,
  email,
  email_confirmed_at,
  encrypted_password,
  raw_app_meta_data,
  raw_user_meta_data,
  created_at,
  updated_at,
  confirmation_token,
  email_change,
  email_change_token_new,
  email_change_token_current
) VALUES (
  '00000000-0000-0000-0000-000000000000',
  gen_random_uuid(),
  'authenticated',
  'authenticated',
  'admin@hostmyguest.com',
  now(),
  crypt('HMGadmin2026!', gen_salt('bf')),
  '{"provider":"email","providers":["email"]}',
  '{}',
  now(),
  now(),
  '',
  '',
  '',
  ''
);

-- Create the agent profile linked to this user
INSERT INTO agents (user_id, display_name, phone, role, presence, is_active)
SELECT id, 'HMG Admin', '+910000000000', 'admin', 'offline', true
FROM auth.users
WHERE email = 'admin@hostmyguest.com';
