/*
# Add increment_unread helper function

Adds a SECURITY DEFINER function to atomically increment the unread_count
of a conversation. Used by the inbound webhook to avoid race conditions
when multiple messages arrive simultaneously.
*/

CREATE OR REPLACE FUNCTION increment_unread(p_conv_id uuid)
RETURNS void AS $$
BEGIN
  UPDATE conversations
  SET unread_count = unread_count + 1
  WHERE id = p_conv_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
