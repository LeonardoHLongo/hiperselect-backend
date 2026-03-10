-- Migration: Create notifications table
-- Tabela para notificações internas (handoff, alertas, etc.)

DO $$
BEGIN
  -- Create notifications table if it doesn't exist
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'notifications') THEN
    CREATE TABLE notifications (
      id TEXT PRIMARY KEY,
      tenant_id UUID NOT NULL,
      type TEXT NOT NULL, -- 'handoff_requested', 'ai_disabled', etc.
      conversation_id TEXT NOT NULL,
      is_read BOOLEAN NOT NULL DEFAULT false,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      metadata JSONB, -- Dados adicionais (reason, store_id, etc.)
      
      CONSTRAINT fk_notifications_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
      CONSTRAINT fk_notifications_conversation FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
    );

    -- Indexes for performance
    CREATE INDEX idx_notifications_tenant_type ON notifications(tenant_id, type);
    CREATE INDEX idx_notifications_conversation ON notifications(conversation_id, tenant_id);
    CREATE INDEX idx_notifications_unread ON notifications(tenant_id, is_read) WHERE is_read = false;
    CREATE INDEX idx_notifications_created_at ON notifications(tenant_id, created_at DESC);
  END IF;
END $$;

COMMENT ON TABLE notifications IS 'Notificações internas do sistema (handoff, alertas, etc.)';
COMMENT ON COLUMN notifications.type IS 'Tipo de notificação: handoff_requested, ai_disabled, etc.';
COMMENT ON COLUMN notifications.metadata IS 'Dados adicionais em JSON (reason, store_id, last_message_preview, etc.)';
