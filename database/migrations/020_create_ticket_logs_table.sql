-- Migration: Criar tabela ticket_logs para histórico de tickets
-- Data: 2026-02-01

CREATE TABLE IF NOT EXISTS ticket_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id UUID NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  author_type TEXT NOT NULL CHECK (author_type IN ('system', 'human')),
  author_id UUID, -- ID do usuário (se author_type = 'human')
  action_type TEXT NOT NULL CHECK (action_type IN ('created', 'status_changed', 'note_added', 'assigned', 'unassigned')),
  from_status TEXT, -- Status anterior (para status_changed)
  to_status TEXT, -- Status novo (para status_changed)
  note TEXT, -- Nota livre do usuário
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Índices para performance
CREATE INDEX IF NOT EXISTS idx_ticket_logs_ticket_id ON ticket_logs(ticket_id);
CREATE INDEX IF NOT EXISTS idx_ticket_logs_created_at ON ticket_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ticket_logs_action_type ON ticket_logs(action_type);

-- Comentários
COMMENT ON TABLE ticket_logs IS 'Histórico de todas as ações e mudanças em tickets (auditável, nunca editado)';
COMMENT ON COLUMN ticket_logs.author_type IS 'Tipo de autor: system (automático) ou human (usuário)';
COMMENT ON COLUMN ticket_logs.author_id IS 'ID do usuário que fez a ação (se author_type = human)';
COMMENT ON COLUMN ticket_logs.action_type IS 'Tipo de ação: created, status_changed, note_added, assigned, unassigned';
COMMENT ON COLUMN ticket_logs.from_status IS 'Status anterior (apenas para status_changed)';
COMMENT ON COLUMN ticket_logs.to_status IS 'Status novo (apenas para status_changed)';
COMMENT ON COLUMN ticket_logs.note IS 'Nota livre do usuário (para note_added ou status_changed)';
