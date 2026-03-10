/**
 * WhatsApp Connection Watchdog
 * 
 * Monitora a conexão WhatsApp e envia alertas de emergência quando:
 * - Status muda para 'close' ou 'disconnected'
 * - Reconexão falha por mais de 20 segundos
 * - Sistema fica offline por tempo prolongado
 */

import { logger } from '../utils/logger';
import type { WhatsAppAdapter } from './adapter';

// Callback para notificar mudanças de status (usado pelo SSE)
let statusChangeCallback: ((status: { status: string; reason?: string; error?: string }) => void) | null = null;

export function setStatusChangeCallback(callback: (status: { status: string; reason?: string; error?: string }) => void): void {
  statusChangeCallback = callback;
}

type WatchdogConfig = {
  alertPhoneNumber?: string; // Número para enviar alertas (opcional)
  webhookUrl?: string; // URL de webhook para alertas (opcional)
  reconnectTimeoutMs?: number; // Tempo máximo para reconexão antes de alertar (default: 20000)
  enableAlerts?: boolean; // Habilitar/desabilitar alertas (default: true)
};

type ConnectionState = {
  status: 'connected' | 'disconnected' | 'connecting' | 'error';
  lastStatusChange: number;
  lastConnectedTime: number | null;
  reconnectStartTime: number | null;
  alertSent: boolean; // Flag para evitar spam de alertas
  isManualDisconnect: boolean; // Flag para diferenciar desconexão manual
};

export class WhatsAppWatchdog {
  private state: ConnectionState;
  private reconnectTimeout: NodeJS.Timeout | null = null;
  private alertCooldown: number = 5 * 60 * 1000; // 5 minutos entre alertas
  private lastAlertTime: number = 0;

  constructor(
    private adapter: WhatsAppAdapter,
    private config: WatchdogConfig = {}
  ) {
    this.config = {
      reconnectTimeoutMs: 60000, // 60 segundos (aumentado para autenticação híbrida)
      enableAlerts: true,
      ...config,
    };

    this.state = {
      status: 'disconnected',
      lastStatusChange: Date.now(),
      lastConnectedTime: null,
      reconnectStartTime: null,
      alertSent: false,
      isManualDisconnect: false,
    };

    logger.pipeline('✅ WhatsApp Watchdog inicializado', {
      alertPhoneNumber: this.config.alertPhoneNumber ? 'configurado' : 'não configurado',
      webhookUrl: this.config.webhookUrl ? 'configurado' : 'não configurado',
      reconnectTimeoutMs: this.config.reconnectTimeoutMs,
      enableAlerts: this.config.enableAlerts,
    });
  }

  /**
   * Atualiza o estado do watchdog quando há mudança de status
   */
  onStatusChange(newStatus: 'connected' | 'disconnected' | 'connecting' | 'error', isManual: boolean = false): void {
    const previousStatus = this.state.status;
    const now = Date.now();

    // Se mudou de connected para qualquer outro status, registrar tempo
    if (previousStatus === 'connected' && newStatus !== 'connected') {
      this.state.lastConnectedTime = now;
      this.state.isManualDisconnect = isManual;
      
      logger.warning('⚠️ Watchdog: Conexão perdida', {
        previousStatus,
        newStatus,
        isManual,
        timestamp: new Date(now).toISOString(),
      });
    }

    // Se mudou para connecting, iniciar timer de reconexão
    if (newStatus === 'connecting' && previousStatus !== 'connecting') {
      this.state.reconnectStartTime = now;
      this.state.alertSent = false;
      
      // Limpar timeout anterior se existir
      if (this.reconnectTimeout) {
        clearTimeout(this.reconnectTimeout);
      }

      // Configurar timeout para alertar se reconexão demorar muito
      this.reconnectTimeout = setTimeout(() => {
        if (this.state.status === 'connecting' || this.state.status === 'disconnected') {
          const timeoutSeconds = (this.config.reconnectTimeoutMs || 60000) / 1000;
          logger.error(`🚨 Watchdog: Reconexão demorou mais de ${timeoutSeconds}s - enviando alerta`, {
            reconnectStartTime: this.state.reconnectStartTime,
            elapsed: Date.now() - (this.state.reconnectStartTime || now),
          });
          this.sendEmergencyAlert(`Reconexão falhou após ${timeoutSeconds} segundos`);
        }
      }, this.config.reconnectTimeoutMs || 60000);
    }

    // Se conectou com sucesso, limpar timers e flags
    if (newStatus === 'connected') {
      if (this.reconnectTimeout) {
        clearTimeout(this.reconnectTimeout);
        this.reconnectTimeout = null;
      }
      this.state.reconnectStartTime = null;
      this.state.alertSent = false;
      this.state.isManualDisconnect = false;
      
      if (previousStatus !== 'connected') {
        logger.success('✅ Watchdog: Conexão restaurada', {
          previousStatus,
          downtime: this.state.lastConnectedTime 
            ? Date.now() - this.state.lastConnectedTime 
            : null,
        });
      }
    }

    // Se status mudou para close/disconnected/error, verificar se precisa alertar
    if ((newStatus === 'close' || newStatus === 'disconnected' || newStatus === 'error') && previousStatus === 'connected') {
      // Alertar imediatamente se não foi desconexão manual
      if (!isManual && this.config.enableAlerts) {
        // Pequeno delay para evitar alertas em reconexões rápidas
        setTimeout(() => {
          if (this.state.status !== 'connected') {
            this.sendEmergencyAlert('Conexão perdida');
          }
        }, 3000); // Aguardar 3s para ver se reconecta rapidamente
      } else if (isManual) {
        logger.info('ℹ️ Watchdog: Desconexão manual detectada', {
          timestamp: new Date(now).toISOString(),
        });
      }
    }

    this.state.status = newStatus;
    this.state.lastStatusChange = now;

    // Notificar callback de mudança de status (para SSE)
    if (statusChangeCallback) {
      statusChangeCallback({
        status: newStatus,
        reason: newStatus === 'disconnected' || newStatus === 'error' ? 'connection_lost' : undefined,
        error: newStatus === 'error' ? 'Connection error' : undefined,
      });
    }
  }

  /**
   * Envia alerta de emergência via webhook ou WhatsApp
   */
  private async sendEmergencyAlert(reason: string): Promise<void> {
    const now = Date.now();
    
    // Cooldown: não enviar alertas muito frequentes
    if (now - this.lastAlertTime < this.alertCooldown) {
      logger.warning('⚠️ Watchdog: Alert em cooldown, ignorando', {
        lastAlertTime: new Date(this.lastAlertTime).toISOString(),
        cooldownRemaining: Math.round((this.alertCooldown - (now - this.lastAlertTime)) / 1000),
      });
      return;
    }

    if (this.state.alertSent) {
      logger.warning('⚠️ Watchdog: Alerta já enviado, ignorando duplicado');
      return;
    }

    const alertMessage = `⚠️ ALERTA HIPER SELECT: O backend do WhatsApp perdeu a conexão e está tentando retornar.\n\nMotivo: ${reason}\nStatus atual: ${this.state.status}\nTimestamp: ${new Date().toISOString()}`;

    logger.error('🚨 Watchdog: Enviando alerta de emergência', {
      reason,
      status: this.state.status,
      alertPhoneNumber: this.config.alertPhoneNumber ? 'configurado' : 'não configurado',
      webhookUrl: this.config.webhookUrl ? 'configurado' : 'não configurado',
    });

    try {
      // Tentar webhook primeiro (mais rápido)
      if (this.config.webhookUrl) {
        await this.sendWebhookAlert(alertMessage);
      }

      // Tentar WhatsApp se configurado e se o adapter estiver conectado
      if (this.config.alertPhoneNumber) {
        const adapterStatus = this.adapter.getConnectionStatus();
        if (adapterStatus.status === 'connected') {
          await this.sendWhatsAppAlert(alertMessage);
        } else {
          logger.warning('⚠️ Watchdog: WhatsApp offline, não é possível enviar alerta via WhatsApp', {
            status: adapterStatus.status,
          });
        }
      }

      this.state.alertSent = true;
      this.lastAlertTime = now;
      
      logger.success('✅ Watchdog: Alerta de emergência enviado', {
        reason,
        timestamp: new Date(now).toISOString(),
      });
    } catch (error) {
      logger.error('❌ Watchdog: Erro ao enviar alerta de emergência', {
        error: error instanceof Error ? error.message : String(error),
        reason,
      });
    }
  }

  /**
   * Envia alerta via webhook
   */
  private async sendWebhookAlert(message: string): Promise<void> {
    if (!this.config.webhookUrl) {
      return;
    }

    try {
      const response = await fetch(this.config.webhookUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          text: message,
          timestamp: new Date().toISOString(),
          service: 'hiperselect-whatsapp-watchdog',
          status: this.state.status,
        }),
      });

      if (!response.ok) {
        throw new Error(`Webhook returned ${response.status}: ${response.statusText}`);
      }

      logger.success('✅ Watchdog: Alerta enviado via webhook', {
        webhookUrl: this.config.webhookUrl,
        status: response.status,
      });
    } catch (error) {
      logger.error('❌ Watchdog: Erro ao enviar webhook', {
        error: error instanceof Error ? error.message : String(error),
        webhookUrl: this.config.webhookUrl,
      });
      throw error;
    }
  }

  /**
   * Envia alerta via WhatsApp (usando o próprio adapter)
   */
  private async sendWhatsAppAlert(message: string): Promise<void> {
    if (!this.config.alertPhoneNumber) {
      return;
    }

    try {
      await this.adapter.sendMessage(this.config.alertPhoneNumber, message);
      logger.success('✅ Watchdog: Alerta enviado via WhatsApp', {
        phoneNumber: this.config.alertPhoneNumber,
      });
    } catch (error) {
      logger.error('❌ Watchdog: Erro ao enviar alerta via WhatsApp', {
        error: error instanceof Error ? error.message : String(error),
        phoneNumber: this.config.alertPhoneNumber,
      });
      throw error;
    }
  }

  /**
   * Obtém o estado atual do watchdog
   */
  getState(): ConnectionState {
    return { ...this.state };
  }

  /**
   * Reseta o estado do watchdog (útil para testes ou reset manual)
   */
  reset(): void {
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
    this.state.alertSent = false;
    this.lastAlertTime = 0;
    logger.info('ℹ️ Watchdog: Estado resetado');
  }
}
