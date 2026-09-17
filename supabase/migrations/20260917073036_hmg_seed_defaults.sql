/*
# Seed default WhatsApp template and app settings defaults

1. Inserts a default first-response WhatsApp template for use outside the 24h window.
2. Inserts default app_settings keys for Exotel configuration.
*/

INSERT INTO whatsapp_templates (name, body, language, is_active)
VALUES (
  'first_response',
  'Hello, thank you for contacting HostMyGuest. One of our team members will be with you shortly. How can we help you today?',
  'en',
  true
)
ON CONFLICT DO NOTHING;

INSERT INTO app_settings (key, value, description) VALUES
  ('exotel_sid', '', 'Exotel account SID'),
  ('exotel_api_key', '', 'Exotel API key (stored as secret in edge function env, this is a placeholder reference)'),
  ('exotel_api_token', '', 'Exotel API token (stored as secret in edge function env, this is a placeholder reference)'),
  ('exotel_whatsapp_number', '', 'Exotel WhatsApp sender number/namespace'),
  ('exotel_caller_id', '', 'Exotel virtual number used as caller ID for outgoing calls'),
  ('exotel_app_id', '', 'Exotel app ID for call webhook correlation'),
  ('exotel_webhook_secret', '', 'Shared secret for validating Exotel webhooks')
ON CONFLICT (key) DO NOTHING;
