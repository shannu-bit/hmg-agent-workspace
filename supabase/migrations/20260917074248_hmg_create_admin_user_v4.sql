/*
# Create initial admin user (proper way)

Email: admin@hostmyguest.com
Password: HMGadmin2026!
*/

DO $$
DECLARE
  v_user_id uuid := gen_random_uuid();
BEGIN
  INSERT INTO auth.users (
    instance_id,
    id,
    aud,
    role,
    email,
    email_confirmed_at,
    phone,
    phone_confirmed_at,
    confirmation_token,
    email_change,
    email_change_token_new,
    email_change_token_current,
    reauthentication_token,
    recovery_token,
    encrypted_password,
    raw_app_meta_data,
    raw_user_meta_data,
    is_super_admin,
    created_at,
    updated_at,
    is_sso_user,
    is_anonymous,
    deleted_at,
    email_change_confirm_status
  ) VALUES (
    '00000000-0000-0000-0000-000000000000'::uuid,
    v_user_id,
    'authenticated',
    'authenticated',
    'admin@hostmyguest.com',
    now(),
    NULL,
    NULL,
    '',
    '',
    '',
    '',
    '',
    '',
    crypt('HMGadmin2026!', gen_salt('bf')),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{}'::jsonb,
    false,
    now(),
    now(),
    false,
    false,
    NULL,
    0
  );

  -- provider_id for email provider is typically the user's uuid
  INSERT INTO auth.identities (
    provider_id,
    user_id,
    identity_data,
    provider,
    last_sign_in_at,
    created_at,
    updated_at
  ) VALUES (
    v_user_id::text,
    v_user_id,
    jsonb_build_object(
      'sub', v_user_id::text,
      'email', 'admin@hostmyguest.com',
      'email_verified', true
    ),
    'email',
    now(),
    now(),
    now()
  );

  INSERT INTO agents (user_id, display_name, phone, role, presence, is_active)
  VALUES (v_user_id, 'HMG Admin', '+910000000000', 'admin', 'offline', true);

  RAISE NOTICE 'Admin user created with id: %', v_user_id;
END $$;
