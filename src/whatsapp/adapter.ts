import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  Browsers,
  makeCacheableSignalKeyStore,
  isJidBroadcast,
  isJidNewsletter,
  isJidStatusBroadcast,
  type WASocket,
  type WAMessage,
  proto,
} from '@whiskeysockets/baileys';
import { getContentType, downloadMediaMessage } from '@whiskeysockets/baileys';
import pino from 'pino';
import QRCode from 'qrcode';
import fs from 'fs';
import path from 'path';
import NodeCache from 'node-cache';
import { emitConnectionStatus, emitMessageReceived, emitMessageSent, emitContactUpdated } from './events';

type AdapterConfig = {
  sessionPath: string;
  messageService?: any; // MessageService opcional para buscar mensagens no banco
};

// Cache global para msgRetryCounterCache (compartilhado entre reconexões)
const globalMsgRetryCounterCache = new NodeCache({
  stdTTL: 3600, // TTL padrão: 1 hora
  checkperiod: 600, // Verificar expiração a cada 10 minutos
  useClones: false, // Performance: não clonar valores
});

class WhatsAppAdapter {
  private socket: WASocket | null = null;
  private config: AdapterConfig;
  private isConnecting = false;
  private currentQR: string | null = null;
  private connectionStatus: 'connected' | 'disconnected' | 'connecting' | 'error' = 'disconnected';
  private connectionError: string | null = null;
  private hadInvalidSession = false; // Track if previous session was invalid
  private hasReceivedQR = false; // Flag: já recebeu QR code nesta tentativa?
  private shouldRetryOnExpired = true; // Flag: deve tentar novamente se expirar?
  private connectingStartTime: number | null = null; // Timestamp quando começou a conectar
  private qrWaitingTimeout: NodeJS.Timeout | null = null; // Timeout para prevenir "Waiting for QR"
  private watchdog?: any; // WhatsAppWatchdog - será injetado
  private isManualDisconnect: boolean = false; // Flag para diferenciar desconexão manual
  // Cache de contatos: jid -> { name, jid }
  private contactsCache: Map<string, { name: string; jid: string }> = new Map();
  // Referência ao auth state para reparo silencioso
  private currentAuthState: any = null;
  // Rastreamento de erros "Bad MAC" por contato (JID) para evitar soft-reconnects desnecessários
  // Um único contato com sessão corrompida não deve derrubar toda a conexão
  private badMacPerContact: Map<string, { count: number; lastTime: number }> = new Map();
  private badMacGlobalCount: number = 0;
  private lastBadMacErrorTime: number = 0;
  private readonly BAD_MAC_THRESHOLD_PER_CONTACT = 15; // Erros tolerados por contato antes de ignorar silenciosamente
  private readonly BAD_MAC_THRESHOLD_GLOBAL = 50; // Soft reconnect somente se MUITOS contatos falharem
  private readonly BAD_MAC_RESET_WINDOW = 300000; // Resetar contador após 5 minutos sem erros
  private readonly BAD_MAC_REPAIR_THRESHOLD = 10; // Tentar reparo silencioso após 10 erros globais
  private lastRepairAttempt: number = 0; // Timestamp da última tentativa de reparo
  // MessageService opcional para buscar mensagens no banco durante retry
  private messageService?: any;

  constructor(config: AdapterConfig) {
    this.config = config;
    this.messageService = config.messageService;
    // Interceptar erros não capturados do processo (incluindo erros do libsignal)
    this.setupProcessErrorHandlers();
  }

  /**
   * Configura handlers para interceptar erros do processo, incluindo erros do libsignal.
   * 
   * IMPORTANTE (Baileys Issue #1769): Erros "Bad MAC" e "Failed to decrypt" são CONHECIDOS
   * e se auto-resolvem quando o contato envia um novo PreKeyBundle. O Baileys lida internamente.
   * Aqui apenas rastreamos silenciosamente para diagnóstico, sem poluir o terminal.
   */
  private setupProcessErrorHandlers(): void {
    // Interceptar eventos customizados de "Bad MAC"
    process.on('whatsapp:bad-mac', (error: Error) => {
      this.handleSocketError(error);
    });

    // Padrões de ruído do libsignal/Baileys que devem ser suprimidos
    // Esses erros são NORMAIS e se auto-resolvem via re-negociação de PreKey (Issue #1769)
    const NOISE_PATTERNS = [
      'Bad MAC', 'bad mac', 'Failed to decrypt', 'No matching sessions',
      'No sessions', 'session_cipher', 'Closing session', 'Closing open session',
      'SessionError', 'SessionEntry', '_chains', 'chainKey', 'chainType',
      'ephemeralKeyPair', 'rootKey', 'indexInfo', 'baseKey', 'baseKeyType',
      'remoteIdentityKey', 'pendingPreKey', 'registrationId', 'currentRatchet',
    ];

    const isNoisy = (text: string): boolean => NOISE_PATTERNS.some(p => text.includes(p));

    if (!(global as any).__whatsappConsoleIntercepted) {
      (global as any).__whatsappConsoleIntercepted = true;

      // Interceptar console.error (erros do libsignal)
      const originalConsoleError = console.error;
      console.error = (...args: any[]) => {
        const errorString = args.map(arg => {
          if (arg instanceof Error) return arg.message + ' ' + (arg.stack || '');
          return String(arg);
        }).join(' ');
        
        if (isNoisy(errorString)) {
          process.emit('whatsapp:bad-mac', new Error(`BadMAC: ${errorString.substring(0, 200)}`));
          return; // SUPRIMIR
        }
        originalConsoleError.apply(console, args);
      };

      // Interceptar console.log (Baileys imprime "Failed to decrypt..." e SessionEntry via console.log)
      const originalConsoleLog = console.log;
      console.log = (...args: any[]) => {
        const logString = args.map(arg => {
          if (arg instanceof Error) return arg.message;
          if (typeof arg === 'object' && arg !== null) {
            // SessionEntry objects têm _chains, registrationId, currentRatchet
            if (arg._chains || arg.registrationId || arg.currentRatchet || arg.indexInfo) {
              return 'SessionEntry';
            }
            return '';
          }
          return String(arg);
        }).join(' ');

        if (isNoisy(logString)) {
          return; // SUPRIMIR silenciosamente (não precisa rastrear, já é rastreado via console.error)
        }
        originalConsoleLog.apply(console, args);
      };
    }
  }

  /**
   * Injeta o watchdog para monitoramento de conexão
   */
  setWatchdog(watchdog: any): void {
    this.watchdog = watchdog;
    console.log('[WhatsApp] ✅ Watchdog injetado no adapter');
  }

  getQRCode(): string | null {
    return this.currentQR;
  }

  getConnectionStatus(): {
    status: 'connected' | 'disconnected' | 'connecting' | 'error';
    error?: string;
  } {
    return {
      status: this.connectionStatus,
      error: this.connectionError || undefined,
    };
  }

  /**
   * Verifica se há uma sessão válida disponível para reconexão automática
   * Retorna true se há credenciais válidas e não há erro de sessão inválida
   */
  async hasValidSession(): Promise<boolean> {
    try {
      const { state } = await useMultiFileAuthState(this.config.sessionPath);
      const credsKeys = Object.keys(state.creds || {});
      
      // Verificar se há credenciais válidas
      const hasValidCreds = state.creds && (
        state.creds.me?.id || 
        state.creds.registered || 
        state.creds.account?.accountSyncType
      );
      
      console.log(`[WhatsApp] Session check: ${credsKeys.length} creds keys, valid: ${!!hasValidCreds}`);
      
      return credsKeys.length > 0 && !!hasValidCreds;
    } catch (error) {
      console.error('[WhatsApp] Error checking session:', error);
      return false;
    }
  }

  async connect(): Promise<void> {
    console.log('\n=== WHATSAPP CONNECT ===');
    console.log(`[${new Date().toISOString()}] Starting WhatsApp connection...`);
    console.log(`Session path: ${this.config.sessionPath}`);
    console.log(`Current status: ${this.connectionStatus}`);
    console.log(`Is connecting: ${this.isConnecting}`);
    
    if (this.isConnecting) {
      console.log('[WhatsApp] Connection already in progress...');
      return;
    }

    if (this.socket && this.socket.user) {
      console.log('[WhatsApp] Already connected');
      this.connectionStatus = 'connected';
      return;
    }

    // Usar flag interna ou verificar erro anterior
    const hadInvalidSession = this.hadInvalidSession || (this.connectionError && (
      this.connectionError.includes('Sessão inválida') || 
      this.connectionError.includes('405') ||
      this.connectionError.includes('loggedOut')
    ));

    // Limpar socket antigo se existir
    if (this.socket) {
      console.log('[WhatsApp] Cleaning up old socket before new connection...');
      try {
        this.socket.end(undefined);
      } catch (e) {
        // Ignore
      }
      this.socket = null;
    }

    this.isConnecting = true;
    this.connectionStatus = 'connecting';
    this.connectionError = null;
    this.connectingStartTime = Date.now(); // Registrar início da conexão
    // Resetar flags de controle para nova tentativa (PRÁTICA DA DOCUMENTAÇÃO)
    this.hasReceivedQR = false;
    this.shouldRetryOnExpired = true;
    // NÃO resetar currentQR aqui - pode estar aguardando QR de conexão anterior
    
    // PREVENÇÃO DE "WAITING FOR QR": Timeout de 30 segundos
    if (this.qrWaitingTimeout) {
      clearTimeout(this.qrWaitingTimeout);
    }
    this.qrWaitingTimeout = setTimeout(() => {
      if (this.connectionStatus === 'connecting' && !this.currentQR && !this.socket?.user) {
        console.log('\n═══════════════════════════════════════════════════════════');
        console.log('⚠️⚠️⚠️  TIMEOUT: Conectando há mais de 30s sem QR code  ⚠️⚠️⚠️');
        console.log('═══════════════════════════════════════════════════════════');
        console.log('[WhatsApp] 🔄 Forçando reinício da conexão...');
        console.log('═══════════════════════════════════════════════════════════\n');
        
        // Resetar estado e tentar novamente
        this.resetSocketState();
        this.isConnecting = false;
        setTimeout(async () => {
          try {
            await this.connect();
          } catch (error) {
            console.error('[WhatsApp] ❌ Erro ao reiniciar conexão após timeout:', error);
          }
        }, 2000);
      }
    }, 30000); // 30 segundos

    try {
      // Se houve erro 405 anterior, limpar sessão COMPLETAMENTE antes de carregar auth state
      // Isso força o Baileys a gerar um novo QR code
      if (hadInvalidSession) {
        console.log('[WhatsApp] ⚠️  Previous invalid session detected. Performing FULL cleanup...');
        this.clearInvalidSession();
        // Aguardar para garantir que os arquivos foram removidos
        await new Promise((resolve) => setTimeout(resolve, 2000));
        console.log('[WhatsApp] ✅ Cleanup complete. Will now load fresh auth state.');
        // Reset flag após limpeza
        this.hadInvalidSession = false;
        // Resetar flags de QR também
        this.hasReceivedQR = false;
        this.currentQR = null;
      }

      console.log('[WhatsApp] Loading auth state...');
      
      let state: any;
      let originalSaveCreds: () => Promise<void>;
      
      // Sistema de autenticação simplificado: apenas arquivos locais
      console.log('[WhatsApp] 📁 Using FILE-BASED auth state (100% local)');
      
      // Garantir que a pasta existe
      if (!fs.existsSync(this.config.sessionPath)) {
        fs.mkdirSync(this.config.sessionPath, { recursive: true });
        console.log(`[WhatsApp] ✅ Pasta de sessão criada: ${this.config.sessionPath}`);
      }
      
      console.log(`[WhatsApp] 📂 Session path: ${this.config.sessionPath}`);
      const { state: fileState, saveCreds: fileSaveCreds } = await useMultiFileAuthState(this.config.sessionPath);
      state = fileState;
      originalSaveCreds = fileSaveCreds;
      console.log('[WhatsApp] ✅ File auth state loaded');
      
      // Criar wrapper atômico para saveCreds para evitar escrita incompleta durante queda de conexão
      const saveCreds = this.createAtomicSaveCreds(originalSaveCreds);
      const credsKeys = Object.keys(state.creds || {});
      console.log('[WhatsApp] Creds keys found:', credsKeys.length);
      
      // Verificar se há credenciais válidas (não apenas keys vazias)
      const hasValidCreds = state.creds && (
        state.creds.me?.id || 
        state.creds.registered || 
        state.creds.account?.accountSyncType
      );
      
      // REGRA CRÍTICA: NÃO limpar sessão se há QR em memória aguardando escaneamento
      if (this.currentQR) {
        console.log('[WhatsApp] ⚠️  QR code exists in memory - DO NOT clear session');
        console.log('[WhatsApp] QR code is waiting to be scanned');
        // Se já há QR, verificar se socket existe
        if (this.socket) {
          console.log('[WhatsApp] Socket already exists, waiting for QR scan...');
          return;
        } else {
          console.log('[WhatsApp] QR exists but no socket - will create socket to maintain QR');
        }
      }
      
      // Se há creds mas não são válidas E não há QR ainda, limpar sessão
      if (credsKeys.length > 0 && !hasValidCreds && !this.currentQR) {
        console.log('[WhatsApp] ⚠️  Found creds keys but no valid credentials. Clearing session...');
        console.log('[WhatsApp] ⚠️  No QR code in memory, safe to clear session');
        this.clearInvalidSession();
        await new Promise((resolve) => setTimeout(resolve, 2000));
        // Recarregar auth state após limpeza
        const { state: freshState, saveCreds: freshSaveCreds } = await useMultiFileAuthState(this.config.sessionPath);
        const freshCredsKeys = Object.keys(freshState.creds || {});
        console.log('[WhatsApp] Fresh auth state loaded. Creds keys:', freshCredsKeys.length);
        if (freshCredsKeys.length === 0) {
          console.log('[WhatsApp] ✅ Session fully cleared - QR code will be generated');
        }
        // Usar o estado fresco
        await this.createSocket(freshState, freshSaveCreds);
        return;
      }
      
      if (credsKeys.length === 0 || !hasValidCreds) {
        console.log('[WhatsApp] ✅ No valid session found - QR code will be generated');
      } else {
        console.log('[WhatsApp] ⚠️  Existing session found with', credsKeys.length, 'keys');
        console.log('[WhatsApp] Will attempt connection. If it fails with 405, session will be cleared.');
      }
      
      await this.createSocket(state, saveCreds);
    } catch (error) {
      this.isConnecting = false;
      this.connectionStatus = 'error';
      this.connectionError = error instanceof Error ? error.message : 'Unknown error';
      console.error('[WhatsApp] ❌ Connection error:', error);
      emitConnectionStatus(
        { status: 'error', error: this.connectionError },
        this.generateTraceId()
      );
      throw error;
    }
  }

  private async createSocket(state: any, saveCreds: () => Promise<void>): Promise<void> {
    try {
      // Logger custom que filtra ruído de descriptografia do Baileys (pino v10)
      // Erros "failed to decrypt" e "sent retry receipt" são internos e se auto-resolvem (Issue #1769)
      // Usamos um write stream custom para filtrar silenciosamente
      const baileysLogFilter = new (require('stream').Writable)({
        write(chunk: Buffer, _encoding: string, callback: () => void) {
          const line = chunk.toString();
          // Suprimir ruído de descriptografia (esses erros são normais e auto-reparáveis)
          if (line.includes('failed to decrypt') ||
              line.includes('Bad MAC') ||
              line.includes('No matching sessions') ||
              line.includes('sent retry receipt') ||
              line.includes('Closing open session') ||
              line.includes('Closing session') ||
              line.includes('session_cipher') ||
              line.includes('Decrypted message with closed session')) {
            callback();
            return; // Suprimir
          }
          process.stdout.write(chunk);
          callback();
        },
      });
      const logger = pino({ level: 'info' }, baileysLogFilter);

      console.log('[WhatsApp] Creating socket with Baileys...');
      console.log('[WhatsApp] Browser config: HiperSelect, Chrome, 1.0.0');
      
      // BUSCAR VERSÃO MAIS RECENTE DO BAILEYS (garantir compatibilidade)
      // Versão fixa pode estar desatualizada e causar erro 405
      console.log('[WhatsApp] Fetching latest Baileys version...');
      const { version } = await fetchLatestBaileysVersion();
      console.log(`[WhatsApp] ✅ Using Baileys version: ${version.join('.')}`);
      
      // Validar state antes de criar socket
      if (!state) {
        throw new Error('State is null or undefined');
      }
      if (!state.creds || typeof state.creds !== 'object') {
        console.log('[WhatsApp] ⚠️  State.creds inválido, criando objeto vazio');
        state.creds = {};
      }
      if (!state.keys) {
        throw new Error('State.keys is missing - keyStore not initialized');
      }

      console.log('[WhatsApp] Validando state antes de criar socket:', {
        hasCreds: !!state.creds,
        credsKeys: Object.keys(state.creds || {}),
        hasKeys: !!state.keys,
        keysType: typeof state.keys,
      });

      // Envolver keys com makeCacheableSignalKeyStore para cache em memória
      // CORREÇÃO CRÍTICA: Reduz drasticamente erros "Bad MAC" mantendo sessões Signal em cache RAM
      // Recomendação #1 da comunidade Baileys (Issue #1769)
      const cachedState = {
        creds: state.creds,
        keys: makeCacheableSignalKeyStore(state.keys, pino({ level: 'silent' })),
      };

      // Armazenar referência ao state para reparo silencioso
      this.currentAuthState = cachedState;
      
      // Criar socket com configuração otimizada para estabilidade
      console.log('[WhatsApp] ⚙️  Configuração: Browser macOS, syncFullHistory=false, logger=info, cachedKeyStore=true');
      console.log('[WhatsApp] ⚙️  Network: keepAlive=10s, retryDelay=250ms, connectTimeout=60s');
      
      this.socket = makeWASocket({
        version,
        auth: cachedState,
        logger, // Logger em nível info (limpo, foca em erros reais)
        // Browser nativo macOS (menos bloqueado pelo WhatsApp)
        browser: Browsers.macOS('Desktop'),
        // Desativar histórico completo (CRUCIAL: não baixa conversas antigas - única otimização mantida)
        syncFullHistory: false,
        // Imprimir QR no terminal para debug
        printQRInTerminal: true,
        // Ignorar JIDs de broadcast/newsletter/status - reduz tentativas de descriptografia inúteis
        shouldIgnoreJid: (jid: string) => {
          return isJidBroadcast(jid) || isJidNewsletter(jid) || isJidStatusBroadcast(jid);
        },
        // LIMITE DE RETRIES: Máximo 5 tentativas de re-descriptografia por mensagem (Issue #853)
        // Sem isso, o Baileys tenta infinitamente descriptografar mensagens corrompidas
        maxMsgRetryCount: 5,
        // Configurações de rede para estabilidade
        keepAliveIntervalMs: 10000, // 10 segundos - manter WebSocket ativo
        retryRequestDelayMs: 250, // 250ms - responder rapidamente a pedidos de chave
        connectTimeoutMs: 60000, // 60 segundos - timeout de conexão
        // Cache de retry usando NodeCache global (compartilhado entre reconexões)
        msgRetryCounterCache: {
          get: (key: string) => {
            const value = globalMsgRetryCounterCache.get<number>(key);
            return value !== undefined ? value : 0;
          },
          set: (key: string, value: number) => {
            globalMsgRetryCounterCache.set(key, value, 3600); // TTL: 1 hora
          },
          delete: (key: string) => {
            globalMsgRetryCounterCache.del(key);
          },
        },
        // Filtragem de sync: ignorar mensagens antigas ou de status
        shouldSyncHistoryMessage: (msg: any) => {
          // Ignorar mensagens muito antigas (mais de 7 dias)
          const MAX_HISTORY_AGE = 7 * 24 * 60 * 60 * 1000; // 7 dias em milissegundos
          const rawTs = msg?.messageTimestamp || msg?.message?.messageTimestamp;
          const messageTimestamp = rawTs ? Number(rawTs) : 0;
          
          if (messageTimestamp > 0) {
            const messageAge = Date.now() - (messageTimestamp * 1000);
            if (messageAge > MAX_HISTORY_AGE) {
              return false; // Não sincronizar mensagens muito antigas
            }
          }
          
          // Ignorar mensagens de status (stories)
          const messageType = msg?.message?.stubType || msg?.stubType;
          if (messageType === 'STATUS' || messageType === 'REVOKE' || messageType === 'CIPHERTEXT') {
            return false; // Não sincronizar mensagens de status
          }
          
          // Ignorar mensagens de sistema (notificações de grupo, etc)
          const isSystemMessage = msg?.key?.fromMe === false && 
                                  (msg?.message?.protocolMessage || 
                                   msg?.message?.senderKeyDistributionMessage ||
                                   msg?.message?.messageContextInfo?.isForwarded);
          
          if (isSystemMessage) {
            return false; // Não sincronizar mensagens de sistema
          }
          
          // Sincronizar apenas mensagens de chat recentes e relevantes
          return true;
        },
        getMessage: async (key) => {
          if (!key || !key.id) {
            return undefined;
          }

          const messageId = key.id;
          const remoteJid = key.remoteJid;
          
          // 1. Tentar buscar no store do Baileys primeiro (mais rápido)
          if (this.socket?.store?.messages) {
            try {
              const storeMessages = this.socket.store.messages;
              if (storeMessages instanceof Map) {
                const conversationMessages = storeMessages.get(remoteJid);
                if (conversationMessages && conversationMessages instanceof Map) {
                  const message = conversationMessages.get(messageId);
                  if (message && message.message) {
                    return message.message;
                  }
                }
              } else if (typeof storeMessages === 'object' && storeMessages !== null) {
                const conversationMessages = (storeMessages as any)[remoteJid];
                if (conversationMessages && typeof conversationMessages === 'object') {
                  const message = conversationMessages[messageId];
                  if (message && message.message) {
                    return message.message;
                  }
                }
              }
            } catch (_) {
              // Silenciar erro de store
            }
          }

          // 2. Tentar buscar no banco de dados (se MessageService estiver disponível)
          if (this.messageService && remoteJid) {
            try {
              const message = await this.messageService.getMessageById(messageId);
              if (message && message.baileysMessage) {
                return message.baileysMessage.message;
              }
            } catch (_) {
              // Silenciar erro de banco
            }
          }

          // 3. Mensagem não encontrada: retornar undefined
          // NÃO retornar mensagem fake - isso corrompe o retry do Baileys
          // O maxMsgRetryCount: 5 garante que o loop para após 5 tentativas
          return undefined;
        },
      });
      console.log('[WhatsApp] ✅ Socket created successfully');

      // REGISTRAR LISTENERS IMEDIATAMENTE após criar o socket
      console.log('[WhatsApp] Setting up event listeners...');
      
      // Listener de creds.update com log explosivo quando emparelhamento concluir
      this.socket.ev.on('creds.update', async (creds) => {
        // Verificar se emparelhamento foi concluído (me preenchido = login feito)
        if (creds && creds.me && creds.me.id) {
          console.log('\n🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉');
          console.log('🎉🎉🎉  EMPARELHAMENTO CONCLUÍDO COM SUCESSO!  🎉🎉🎉');
          console.log('🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉');
          console.log(`[WhatsApp] ✅ Usuário autenticado: ${creds.me.id}`);
          console.log(`[WhatsApp] ✅ Nome: ${creds.me.name || 'N/A'}`);
          console.log(`[WhatsApp] ✅ Registrado: ${creds.registered ? 'Sim' : 'Não'}`);
          console.log('🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉\n');
        }
        // Salvar credenciais
        await saveCreds();
      });
      console.log('[WhatsApp] ✅ Creds update listener registered');

      // FLAGS DE CONTROLE (PRÁTICA DA DOCUMENTAÇÃO)
      // Essas flags são locais ao handler para evitar problemas de estado
      let hasReceivedQR = this.hasReceivedQR;        // Usar flag da classe
      let shouldRetryOnExpired = this.shouldRetryOnExpired;  // Usar flag da classe
      
      // Listener de connection.update - DEVE SER REGISTRADO IMEDIATAMENTE
      // Este é o listener que captura o QR code
      this.socket.ev.on('connection.update', (update) => {
        // Log detalhado para debug (temporário para diagnosticar problema de QR)
        console.log('\n=== CONNECTION UPDATE ===');
        console.log(`[${new Date().toISOString()}] Connection update:`, JSON.stringify({
          connection: update.connection,
          hasQR: !!update.qr,
          qrLength: update.qr?.length || 0,
          isNewLogin: update.isNewLogin,
          lastDisconnect: update.lastDisconnect ? {
            error: update.lastDisconnect.error?.message,
            statusCode: (update.lastDisconnect.error as any)?.output?.statusCode,
            date: update.lastDisconnect.date,
          } : null,
        }, null, 2));
        
        const { connection, lastDisconnect, qr, isNewLogin } = update;

        // CAPTURAR QR CODE - PRIORIDADE MÁXIMA (PRÁTICA DA DOCUMENTAÇÃO)
        if (qr) {
          // MARCAR FLAG: QR recebido
          hasReceivedQR = true;
          this.hasReceivedQR = true;
          
          // PERSISTIR QR EM MEMÓRIA IMEDIATAMENTE
          this.currentQR = qr;
          this.connectionStatus = 'connecting';
          this.connectionError = null;
          this.isConnecting = true;
          
          console.log('\n═══════════════════════════════════════════════════════════');
          console.log('[WhatsApp] ✅✅✅ QR CODE CAPTURADO DO Baileys! ✅✅✅');
          console.log(`[WhatsApp] QR Code length: ${qr.length} characters`);
          console.log(`[WhatsApp] QR Code stored in: this.currentQR`);
          console.log(`[WhatsApp] QR Code preview: ${qr.substring(0, 50)}...`);
          console.log('═══════════════════════════════════════════════════════════\n');
          
          // Imprimir QR code no terminal
          try {
            QRCode.toString(qr, { type: 'terminal', small: true }, (err: Error | null, qrString: string) => {
              if (!err && qrString) {
                console.log('\n═══════════════════════════════════════════════════════════');
                console.log('                    QR CODE PARA CONECTAR');
                console.log('═══════════════════════════════════════════════════════════\n');
                console.log(qrString);
                console.log('\n═══════════════════════════════════════════════════════════');
                console.log('Escaneie este QR code com o WhatsApp no seu celular');
                console.log('O QR code está disponível via GET /api/whatsapp/qr');
                console.log('═══════════════════════════════════════════════════════════\n');
              } else {
                console.log('[WhatsApp] ⚠️  Could not generate QR code for terminal display');
                if (err) {
                  console.error('[WhatsApp] QR Code error:', err);
                }
              }
            });
          } catch (error) {
            console.error('[WhatsApp] Error printing QR code:', error);
          }
          
          // Emitir evento para que frontend possa buscar
          emitConnectionStatus({ status: 'connecting' }, this.generateTraceId());
        } else if (connection === 'connecting' && !this.currentQR) {
          // Ainda aguardando QR - NÃO limpar sessão
          console.log('[WhatsApp] ⏳ Waiting for QR code... (connection: connecting, no QR yet)');
          console.log('[WhatsApp] ⚠️  DO NOT clear session while waiting for QR');
        }

        // HANDLE CONNECTION CLOSE - NÃO LIMPAR QR ENQUANTO AGUARDA
        if (connection === 'close') {
          const statusCode = (lastDisconnect?.error as any)?.output?.statusCode;
          const errorMessage = (lastDisconnect?.error as any)?.message || 'Connection closed';
          const previousStatus = this.connectionStatus;
          
          console.log(`[WhatsApp] Connection closed. Status code: ${statusCode}, Message: ${errorMessage}`);
          
          // Log crítico quando conexão fecha (mudança de status)
          if (previousStatus === 'connected' || previousStatus === 'connecting') {
            this.logCriticalConnectionChange('disconnected', `Status code: ${statusCode}, ${errorMessage}`);
            
            // Notificar watchdog sobre desconexão (não manual, pois foi erro)
            if (this.watchdog) {
              this.watchdog.onStatusChange('disconnected', this.isManualDisconnect);
            }
          }

          // TRATAMENTO DE LOGGED OUT (PRÁTICA DA DOCUMENTAÇÃO)
          const isLoggedOut = statusCode === DisconnectReason.loggedOut;
          
          if (isLoggedOut) {
            console.log('[WhatsApp] ⚠️  Logged out detected (401)');
            
            // CASO 1: Credenciais expiradas ANTES de gerar QR
            // SOLUÇÃO: Limpar credenciais e criar novo socket sem credenciais
            if (!hasReceivedQR && shouldRetryOnExpired) {
              shouldRetryOnExpired = false; // Evita loop infinito
              this.shouldRetryOnExpired = false;
              
              console.log('[WhatsApp] ⚠️  Credenciais expiradas ANTES de gerar QR');
              console.log('[WhatsApp] 🔧 Limpando credenciais e tentando novamente...');
              
              // Limpar socket atual
              if (this.socket) {
                try {
                  this.socket.end(undefined);
                } catch (e) {
                  // Ignore
                }
                this.socket = null;
              }
              
              this.connectionStatus = 'disconnected';
              this.isConnecting = false;
              this.currentQR = null;
              this.hadInvalidSession = true;
              
              // Limpar credenciais expiradas
              this.clearInvalidSession();
              
              // Aguardar 1 segundo e criar novo socket SEM credenciais
              setTimeout(async () => {
                if (!this.isConnecting && !this.socket) {
                  console.log('[WhatsApp] 🔄 Tentando reconectar com credenciais limpas...');
                  try {
                    await this.connect();
                  } catch (error) {
                    console.error('[WhatsApp] ❌ Erro na reconexão:', error);
                  }
                }
              }, 1000);
              
              return; // Sai do handler
            }
            
            // CASO 2: Sessão expirada DEPOIS de já ter recebido QR
            // Usuário já tinha conectado antes, sessão expirou
            if (hasReceivedQR) {
              console.log('[WhatsApp] ⚠️  Sessão expirada. Escaneie o QR Code novamente.');
            }
            
            // Cleanup geral
            this.connectionStatus = 'disconnected';
            this.currentQR = null;
            this.connectionError = 'Desconectado. Por favor, reconecte manualmente.';
            this.isConnecting = false;
            this.hadInvalidSession = true;
            
            if (this.socket) {
              try {
                this.socket.end(undefined);
              } catch (e) {
                // Ignore
              }
              this.socket = null;
            }
            
            // Limpar sessão apenas em loggedOut
            this.clearInvalidSession();
            emitConnectionStatus({ status: 'disconnected' }, this.generateTraceId());
          } else if (statusCode === 405 || statusCode === DisconnectReason.badSession) {
            // 405 ou badSession - CRÍTICO: Limpar sessão IMEDIATAMENTE e tentar novamente
            // Se não limpar agora, o QR code nunca será gerado
            console.log('[WhatsApp] ⚠️  Invalid session detected (405/badSession). Clearing session IMMEDIATELY...');
            
            // Limpar socket primeiro
            if (this.socket) {
              try {
                this.socket.ev.removeAllListeners();
                this.socket.end(undefined);
              } catch (e) {
                // Ignore
              }
              this.socket = null;
            }
            
            // Limpar sessão IMEDIATAMENTE (não esperar próxima conexão)
            this.clearInvalidSession();
            
            // Resetar flags
            this.connectionStatus = 'disconnected';
            this.connectionError = 'Sessão inválida. Limpando e tentando novamente...';
            this.isConnecting = false;
            this.hadInvalidSession = false; // Já limpamos, não precisa flag
            this.currentQR = null;
            this.hasReceivedQR = false;
            
            emitConnectionStatus({ status: 'disconnected' }, this.generateTraceId());
            
            // Tentar reconectar automaticamente após limpar sessão
            console.log('[WhatsApp] 🔄 Aguardando 2 segundos e tentando reconectar com sessão limpa...');
            setTimeout(async () => {
              if (!this.isConnecting && !this.socket) {
                try {
                  await this.connect();
                } catch (error) {
                  console.error('[WhatsApp] ❌ Erro na reconexão após limpar sessão:', error);
                }
              }
            }, 2000);
          } else {
            // Outros erros (incluindo 428 = Connection Terminated, 515 = Stream Errored, 503 = Service Unavailable)
            const isStreamError = statusCode === 515;
            const isConnectionTerminated = statusCode === 428;
            const isServiceUnavailable = statusCode === 503;
            
            // Preparar reason para notificação
            let disconnectReason = 'unknown';
            if (isConnectionTerminated) {
              disconnectReason = '428_terminated';
            } else if (isStreamError) {
              disconnectReason = '515_stream_error';
            } else if (isServiceUnavailable) {
              disconnectReason = '503_service_unavailable';
            } else {
              disconnectReason = `error_${statusCode}`;
            }
            
            if (isStreamError || isConnectionTerminated || isServiceUnavailable) {
              const errorType = isConnectionTerminated ? '428 Connection Terminated' 
                : isStreamError ? '515 Stream Errored' 
                : '503 Service Unavailable';
              
              console.log(`\n═══════════════════════════════════════════════════════════`);
              console.log(`⚠️⚠️⚠️  ERRO CRÍTICO: ${errorType}  ⚠️⚠️⚠️`);
              console.log(`═══════════════════════════════════════════════════════════`);
              
              if (isServiceUnavailable) {
                console.log(`[WhatsApp] ⚠️  Service Unavailable (503) - Servidor WhatsApp temporariamente indisponível`);
                console.log(`[WhatsApp] 🔄 Aguardando 5 segundos antes de reconectar...`);
              } else if (isStreamError) {
                // Erro 515: NÃO limpar sessão, apenas fazer flush e reconectar
                console.log(`[WhatsApp] ⚠️  Stream Errored (515) - Normal em conexões instáveis`);
                console.log(`[WhatsApp] 🔄 Fazendo flush de eventos e reconectando (mantendo sessão)...`);
                if (this.socket) {
                  try {
                    // Apenas fazer flush de eventos, não limpar sessão
                    this.socket.ev.flush();
                    console.log('[WhatsApp] ✅ Eventos do socket limpos (flush)');
                  } catch (e) {
                    console.log('[WhatsApp] ⚠️  Erro ao fazer flush (ignorando):', e);
                  }
                }
                // NÃO resetar socket state nem limpar sessão para erro 515
                this.currentQR = null; // Limpar QR se existir
              } else {
                console.log(`[WhatsApp] 🔧 Forçando reset completo do socket antes de reconectar...`);
              }
              console.log(`═══════════════════════════════════════════════════════════\n`);
              
              // FORÇAR RESET COMPLETO DO SOCKET (exceto para 503 e 515 que podem ser temporários)
              if (!isServiceUnavailable && !isStreamError) {
                this.resetSocketState();
              } else if (isServiceUnavailable) {
                // Para 503, apenas limpar socket mas manter estado de conexão
                if (this.socket) {
                  try {
                    this.socket.ev.removeAllListeners();
                    this.socket.end(undefined);
                  } catch (e) {
                    // Ignore
                  }
                  this.socket = null;
                }
                this.connectionStatus = 'connecting';
                this.connectionError = 'Servidor WhatsApp temporariamente indisponível. Reconectando...';
              } else if (isStreamError) {
                // Para 515, apenas limpar socket mas NÃO resetar estado de sessão
                if (this.socket) {
                  try {
                    this.socket.ev.removeAllListeners();
                    this.socket.end(undefined);
                  } catch (e) {
                    // Ignore
                  }
                  this.socket = null;
                }
                this.connectionStatus = 'connecting';
                this.connectionError = 'Stream errored. Reconectando...';
              }
              
              if (isStreamError) {
                console.log('[WhatsApp] ⚠️  Stream Errored (515) - Reconectando sem limpar sessão');
                // Não resetar hadInvalidSession - credenciais são válidas
                this.hadInvalidSession = false;
              } else if (isServiceUnavailable) {
                console.log('[WhatsApp] ⚠️  Service Unavailable (503) - Reconectando com delay maior...');
                this.hadInvalidSession = false;
              } else {
                console.log('[WhatsApp] ⚠️  Connection Terminated (428) - Reconectando...');
              }
              
              // Delay maior para 503 (servidor pode estar sobrecarregado)
              // Delay menor para 515 (reconexão rápida sem limpar sessão)
              const reconnectDelay = isServiceUnavailable ? 5000 : (isStreamError ? 2000 : 2000);
              
              // Reconectar após delay (credenciais já foram salvas)
              setTimeout(async () => {
                console.log(`[WhatsApp] 🔄 Reconectando após ${reconnectDelay}ms...`);
                try {
                  if (!this.isConnecting) {
                    await this.connect();
                  }
                } catch (error) {
                  console.error('[WhatsApp] ❌ Erro na reconexão:', error);
                  this.connectionStatus = 'error';
                  this.connectionError = `Erro ao reconectar após ${errorType}`;
                  this.logCriticalConnectionChange('error', this.connectionError);
                  emitConnectionStatus({ status: 'error', error: this.connectionError }, this.generateTraceId());
                }
              }, reconnectDelay);
            } else {
              // Outros erros - tentar reconectar, mas manter QR se existir
              console.log(`[WhatsApp] Connection closed (code: ${statusCode}), will attempt reconnect...`);
              this.connectionStatus = 'connecting';
              // NÃO limpar currentQR - pode estar aguardando QR
              this.connectionError = null;
              setTimeout(() => {
                if (!this.socket?.user && !this.isConnecting) {
                  this.isConnecting = false;
                  this.connect();
                }
              }, 5000);
            }
          }
        } else if (connection === 'open') {
          // CONECTADO - Limpar QR apenas quando conectar com sucesso
          const previousStatus = this.connectionStatus;
          this.connectionStatus = 'connected';
          this.currentQR = null; // Limpar QR após conectar
          this.connectionError = null;
          this.isConnecting = false;
          this.isManualDisconnect = false; // Reset flag
          this.connectingStartTime = null; // Limpar timestamp
          
          // Limpar timeout de QR se existir
          if (this.qrWaitingTimeout) {
            clearTimeout(this.qrWaitingTimeout);
            this.qrWaitingTimeout = null;
          }
          
          console.log('\n═══════════════════════════════════════════════════════════');
          console.log('[WhatsApp] ✅✅✅  CONNECTED  ✅✅✅');
          console.log('═══════════════════════════════════════════════════════════');
          console.log('[WhatsApp] WhatsApp conectado com sucesso!');
          if (isNewLogin) {
            console.log('\n🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉');
            console.log('🎉🎉🎉  EMPARELHAMENTO CONCLUÍDO COM SUCESSO!  🎉🎉🎉');
            console.log('🎉🎉🎉  NOVO LOGIN DETECTADO - CELULAR EMPARELHADO!  🎉🎉🎉');
            console.log('🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉');
            console.log('[WhatsApp] ✅ Emparelhamento completo! WhatsApp Web conectado!');
            console.log('🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉\n');
          }
          console.log('═══════════════════════════════════════════════════════════\n');
          
          // Log crítico se mudou de status diferente de 'open'
          if (previousStatus !== 'connected') {
            this.logCriticalConnectionChange('connected', null);
          }
          
          // Notificar watchdog
          if (this.watchdog) {
            this.watchdog.onStatusChange('connected', false);
          }
          
          emitConnectionStatus({ status: 'connected' }, this.generateTraceId());
        } else if (connection === 'connecting') {
          // Ainda conectando - manter QR se existir
          const previousStatus = this.connectionStatus;
          this.connectionStatus = 'connecting';
          this.connectionError = null;
          // NÃO limpar currentQR aqui
          
          // Log crítico se mudou de status diferente de 'open'
          if (previousStatus !== 'connecting' && previousStatus !== 'connected') {
            this.logCriticalConnectionChange('connecting', null);
          }
          
          // Notificar watchdog
          if (this.watchdog) {
            this.watchdog.onStatusChange('connecting', false);
          }
          
          emitConnectionStatus({ status: 'connecting' }, this.generateTraceId());
        }
      });

      // Handle connection errors
      // NOTA: O handler de creds.update já foi registrado acima (linha 226) com saveCreds
      // Não registrar novamente para evitar conflitos
      
      // Detector de erros "Bad MAC" - sessão corrompida
      this.socket.ev.on('error', (error: any) => {
        this.handleSocketError(error);
      });

      // ESCUTAR contacts.upsert OBRIGATORIAMENTE (PRÁTICA CORRETA)
      // Este evento fornece o nome real do contato quando disponível
      this.socket.ev.on('contacts.upsert', (contacts) => {
        console.log(`[WhatsApp] 📇 Contacts upsert: ${contacts.length} contact(s)`);
        for (const contact of contacts) {
          const jid = contact.id;
          const name = contact.name || contact.notify;
          if (jid && name) {
            this.contactsCache.set(jid, { name, jid });
            console.log(`[WhatsApp] ✅ Cached contact: ${name} (${jid})`);
            
            // NORMALIZAR JID OBRIGATORIAMENTE para @s.whatsapp.net
            let normalizedJid: string;
            let phoneNumber: string;
            let conversationId: string;
            try {
              const normalized = this.normalizeWhatsAppJid(jid);
              normalizedJid = normalized.jid;
              phoneNumber = normalized.phoneNumber;
              conversationId = normalized.phoneNumber;
            } catch (error) {
              console.error(`[WhatsApp] ❌ Erro ao normalizar JID do contato: ${jid}`, error);
              continue; // Pular este contato
            }
            
            emitContactUpdated(
              {
                conversationId,
                sender: {
                  phoneNumber,
                  jid: normalizedJid,
                  pushName: name,
                },
              },
              this.generateTraceId()
            );
          }
        }
      });

      this.socket.ev.on('messages.upsert', async (m) => {
        // FILTRO DE MENSAGENS: Separar motivos de descarte para diagnóstico preciso
        const now = Date.now();
        const MAX_MESSAGE_AGE = 2 * 60 * 1000; // 2 minutos em milissegundos
        let filteredFromMe = 0;
        let filteredNoContent = 0;
        let filteredTooOld = 0;
        
        const recentMessages = m.messages.filter((msg) => {
          if (msg.key.fromMe) {
            filteredFromMe++;
            return false;
          }
          if (!msg.message) {
            filteredNoContent++;
            return false;
          }
          
          // Verificar timestamp da mensagem (converter Long do protobuf para Number)
          const rawTimestamp = msg.messageTimestamp;
          const messageTimestamp = rawTimestamp ? Number(rawTimestamp) : 0;
          if (messageTimestamp > 0) {
            const messageAge = now - (messageTimestamp * 1000);
            if (messageAge > MAX_MESSAGE_AGE) {
              filteredTooOld++;
              return false;
            }
          }
          
          return true;
        });
        
        // LOG INTELIGENTE: Só logar quando há mensagens REAIS para processar
        // Mensagens descartadas (fromMe, sem conteúdo, antigas) são normais e não precisam de log individual
        if (recentMessages.length > 0) {
          const totalFiltered = filteredFromMe + filteredNoContent + filteredTooOld;
          console.log(`\n=== MESSAGES UPSERT ===`);
          console.log(`[${new Date().toISOString()}] Processing ${recentMessages.length} message(s)${totalFiltered > 0 ? ` | Descartadas: ${totalFiltered}` : ''}`);
          console.log(`========================`);
        }
        
        const messages = recentMessages;

        for (const msg of messages) {
          const traceId = this.generateTraceId();
          
          // PROCURAR O JID CORRETO (@s.whatsapp.net) NA MENSAGEM
          // O Baileys envia AMBOS: @lid E @s.whatsapp.net em campos diferentes
          // Precisamos ENCONTRAR o que tem @s.whatsapp.net, não converter
          let correctJid: string | null = null;
          let conversationId: string | null = null;
          
          // 1. Verificar msg.key.remoteJid
          if (msg.key?.remoteJid?.endsWith('@s.whatsapp.net')) {
            correctJid = msg.key.remoteJid;
            conversationId = correctJid.replace('@s.whatsapp.net', '');
            console.log(`[WhatsApp] ✅ JID encontrado em msg.key.remoteJid: ${correctJid}`);
          }
          
          // 2. Verificar msg.key.participant (para grupos, mas pode ter @s.whatsapp.net)
          if (!correctJid && msg.key?.participant?.endsWith('@s.whatsapp.net')) {
            correctJid = msg.key.participant;
            conversationId = correctJid.replace('@s.whatsapp.net', '');
            console.log(`[WhatsApp] ✅ JID encontrado em msg.key.participant: ${correctJid}`);
          }
          
          // 3. Procurar recursivamente em TODOS os campos da mensagem
          if (!correctJid) {
            // Função recursiva para procurar JID com @s.whatsapp.net
            const findJidInObject = (obj: any, path = '', depth = 0): string | null => {
              if (depth > 5) return null; // Limitar profundidade
              if (!obj || typeof obj !== 'object') return null;
              
              for (const [key, value] of Object.entries(obj)) {
                if (typeof value === 'string' && value.endsWith('@s.whatsapp.net')) {
                  console.log(`[WhatsApp] ✅ JID encontrado em ${path ? path + '.' : ''}${key}: ${value}`);
                  return value;
                }
                if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
                  const found = findJidInObject(value, path ? `${path}.${key}` : key, depth + 1);
                  if (found) return found;
                }
              }
              return null;
            };
            
            correctJid = findJidInObject(msg);
            if (correctJid) {
              conversationId = correctJid.replace('@s.whatsapp.net', '');
            }
          }
          
          // Se não encontrou, logar estrutura completa para debug
          if (!correctJid) {
            console.error(`[WhatsApp] ❌ JID correto (@s.whatsapp.net) não encontrado na mensagem`);
            console.error(`[WhatsApp] 📋 Estrutura completa da mensagem:`, JSON.stringify({
              key: msg.key,
              pushName: msg.pushName,
              messageTimestamp: msg.messageTimestamp,
              messageStubType: msg.messageStubType,
              allKeys: Object.keys(msg),
            }, null, 2));
            console.error(`[WhatsApp] ⚠️  Pulando mensagem`);
            continue; // Pular esta mensagem
          }
          
          const normalizedJid = correctJid;
          
          // DETECTAR TIPO DE MENSAGEM (text, image, audio, video, etc)
          const messageType = getContentType(msg.message);
          console.log(`[WhatsApp] 📨 Message type detected: ${messageType}`);

          // EXTRAIR CONTEÚDO (texto ou mídia)
          const { text, media } = await this.extractMessageContent(msg, messageType);

          // DEBUG: Log da mensagem processada
          console.log(`[WhatsApp] 📨 Message processed:`, {
            messageId: msg.key?.id,
            rawJid: msg.key?.remoteJid,
            correctJid: normalizedJid,
            conversationId,
            messageType,
            hasText: !!text,
            hasMedia: !!media,
            mediaType: media?.type,
            hasPushName: !!msg.pushName,
            pushName: msg.pushName,
          });

          // Processar mensagem se tiver texto OU mídia
          if (text || media) {
            console.log('[WhatsApp] Extracting sender info (fast, no photo fetch)...');
            // Extrair nome de múltiplas fontes: msg.pushName, store.contacts, cache
            // Usar normalizedJid que SEMPRE é @s.whatsapp.net
            const sender = await this.extractSenderInfoFromMessage(msg, normalizedJid);
            console.log('[WhatsApp] Sender info:', JSON.stringify(sender, null, 2));

            emitMessageReceived(
              {
                messageId: msg.key.id || this.generateTraceId(),
                conversationId,
                text: text || null,
                timestamp: msg.messageTimestamp ? msg.messageTimestamp * 1000 : Date.now(),
                sender,
                media,
                messageType: this.mapMessageType(messageType),
                // Armazenar referência da mensagem original para baixar mídia depois
                baileysKey: {
                  id: msg.key.id || this.generateTraceId(),
                  remoteJid: normalizedJid,
                  fromMe: msg.key.fromMe || false,
                },
                // Armazenar mensagem completa APENAS quando há mídia (para download)
                baileysMessage: media ? JSON.parse(JSON.stringify(msg)) : undefined,
              },
              traceId
            );
            console.log('[WhatsApp] Message event emitted');
          } else {
            console.log('[WhatsApp] ⚠️  Mensagem sem conteúdo (texto ou mídia), pulando...');
          }
        }
        if (messages.length > 0) {
          console.log('========================\n');
        }
      });
    } catch (error) {
      this.isConnecting = false;
      this.connectionStatus = 'error';
      this.connectionError = error instanceof Error ? error.message : 'Unknown error';
      console.error('[WhatsApp] ❌ Error in createSocket:', error);
      emitConnectionStatus(
        { status: 'error', error: this.connectionError },
        this.generateTraceId()
      );
      // Don't throw, allow retry
    }
  }

  async sendMessage(to: string, content: string): Promise<string> {
    console.log(`[WhatsApp] sendMessage called with:`, {
      to,
      contentLength: content.length,
      hasSocket: !!this.socket,
      hasUser: !!this.socket?.user,
    });

    if (!this.socket) {
      console.error(`[WhatsApp] ❌ Socket is null - adapter not connected`);
      throw new Error('WhatsApp adapter is not connected');
    }

    if (!this.socket.user) {
      console.error(`[WhatsApp] ❌ Socket.user is null - adapter not authenticated`);
      throw new Error('WhatsApp adapter is not authenticated');
    }

    // Normalizar JID para garantir formato correto
    const normalizedJid = to.includes('@') ? to : `${to}@s.whatsapp.net`;
    
    console.log(`[WhatsApp] JID normalization:`, {
      original: to,
      normalized: normalizedJid,
    });

    const traceId = this.generateTraceId();
    
    try {
      console.log(`[WhatsApp] 📤 Sending message to ${normalizedJid}`);
      console.log(`[WhatsApp] 📤 Original 'to' parameter: ${to}`);
      console.log(`[WhatsApp] 📤 Normalized JID: ${normalizedJid}`);
      console.log(`[WhatsApp] 📤 Message preview: ${content.substring(0, 50)}...`);
      
      // Interceptador para Card Gigante (Giant Rich Card) em links do Google
      let messagePayload: any = { text: content };

      // Regex para detectar o link do Google
      const googleLinkRegex = /(https:\/\/(?:g\.page|search\.google\.com|g\.co|maps\.app\.goo\.gl)[^\s]+)/;
      const match = content.match(googleLinkRegex);

      if (match) {
        const rawLink = match[0];
        // Arranca pontos e vírgulas do final para não dar Erro 404
        const cleanLink = rawLink.replace(/[.,;!?]+$/, '');

        try {
          // Baixa a imagem diretamente para enviar os bytes brutos (Garante 100% de renderização no WhatsApp)
          const imageUrl = "https://ooancmvihrxzgtegvmwn.supabase.co/storage/v1/object/public/whatsapp/banner.jpg";
          const imageResponse = await fetch(imageUrl);
          const imageBuffer = Buffer.from(await imageResponse.arrayBuffer());

          console.log(`[WhatsApp] 🎨 Google link detectado - criando Giant Rich Card`, {
            originalLink: rawLink,
            cleanedLink: cleanLink,
            imageBufferSize: imageBuffer.length,
          });

          messagePayload = {
            text: content.replace(rawLink, cleanLink), // Garante que o texto fique limpo também
            contextInfo: {
              externalAdReply: {
                title: "⭐ Avalie o Hiper Select!",
                body: "Leva menos de 1 minuto! 😊",
                thumbnail: imageBuffer,
                sourceUrl: cleanLink,
                mediaType: 1,
                renderLargerThumbnail: true,
                showAdAttribution: false
              }
            }
          };

          console.log(`[WhatsApp] ✅ Giant Rich Card configurado`, {
            title: messagePayload.contextInfo.externalAdReply.title,
            thumbnailSize: imageBuffer.length,
            sourceUrl: messagePayload.contextInfo.externalAdReply.sourceUrl,
          });
        } catch (error) {
          console.error(`[WhatsApp] ❌ Falha ao gerar o Card Gigante:`, error);
          // Se falhar o download da imagem, manda o texto puro como fallback
          messagePayload = { text: content.replace(rawLink, cleanLink) };
        }
      }
      
      // Enviar mensagem via Baileys
      const result = await this.socket.sendMessage(normalizedJid, messagePayload);
      
      // Usar o messageId retornado pelo Baileys ou gerar um
      const messageId = result?.key?.id || this.generateTraceId();
      
      console.log(`[WhatsApp] ✅ Message sent successfully: ${messageId}`);
      console.log(`[WhatsApp] ✅ Result object:`, JSON.stringify(result, null, 2));
      console.log(`[WhatsApp] ✅ Message key:`, JSON.stringify(result?.key, null, 2));
      
      // Usar timestamp atual (momento real do envio)
      // O Baileys não retorna timestamp no resultado do sendMessage
      // O timestamp real será atribuído pelo WhatsApp quando a mensagem for processada
      // Por enquanto, usamos o timestamp atual para garantir ordem cronológica correta
      const messageTimestamp = Date.now();
      
      console.log(`[WhatsApp] Message timestamp: ${new Date(messageTimestamp).toISOString()}`);

      emitMessageSent(
        {
          messageId,
          to: normalizedJid,
          content,
          timestamp: messageTimestamp,
          conversationId: this.normalizeJid(normalizedJid), // conversationId é apenas o número
        },
        traceId
      );

      return messageId;
    } catch (error) {
      console.error(`[WhatsApp] ❌ Error sending message:`, error);
      throw new Error(
        `Failed to send WhatsApp message: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  disconnect(): void {
    this.isManualDisconnect = true; // Marcar como desconexão manual
    if (this.socket) {
      this.socket.end(undefined);
      this.socket = null;
    }
    this.connectionStatus = 'disconnected';
    this.isConnecting = false;
    this.currentQR = null;
    this.connectionError = null;
    this.hasReceivedQR = false;
    this.shouldRetryOnExpired = true;
    
    // Notificar watchdog sobre desconexão manual
    if (this.watchdog) {
      this.watchdog.onStatusChange('disconnected', true);
    }
  }

  /**
   * Desconecta e limpa completamente a sessão do WhatsApp
   * Isso remove todas as credenciais salvas, forçando um novo QR code na próxima conexão
   */
  disconnectAndClearSession(): void {
    console.log('[WhatsApp] 🗑️  Desconectando e limpando sessão completamente...');
    
    // Desconectar primeiro
    this.disconnect();
    
    // Limpar sessão completamente
    this.clearInvalidSession();
    
    // Resetar flags
    this.hadInvalidSession = false;
    
    console.log('[WhatsApp] ✅ Sessão completamente limpa. Próxima conexão exigirá novo QR code.');
  }

  async reconnect(): Promise<void> {
    console.log('[WhatsApp] Reconnecting...');
    this.disconnect();
    this.isConnecting = false;
    // NÃO limpar currentQR aqui - pode estar aguardando QR
    this.connectionError = 'Sessão inválida. Por favor, reconecte manualmente.';
    // Limpar sessão ANTES de reconectar para forçar novo QR
    this.clearInvalidSession();
    // Wait a bit before reconnecting to ensure files are removed
    await new Promise((resolve) => setTimeout(resolve, 2000));
    // Reset error flag so connect() knows to clear session
    this.hadInvalidSession = true;
    // Limpar QR apenas quando iniciar nova conexão
    this.currentQR = null;
    await this.connect();
  }

  /**
   * Reseta completamente o estado do socket
   * Usado antes de reconectar em erros críticos (428, 515)
   */
  private resetSocketState(): void {
    console.log('[WhatsApp] 🔧 Resetando estado do socket...');
    
    // Limpar socket atual completamente
    if (this.socket) {
      try {
        // Remover todos os listeners antes de fechar
        this.socket.ev.removeAllListeners();
        this.socket.end(undefined);
      } catch (e) {
        // Ignore erros ao fechar
      }
      this.socket = null;
    }
    
    // Resetar flags de conexão
    this.isConnecting = false;
    this.connectionStatus = 'disconnected';
    
    // Limpar timeout de QR se existir
    if (this.qrWaitingTimeout) {
      clearTimeout(this.qrWaitingTimeout);
      this.qrWaitingTimeout = null;
    }
    
    this.connectingStartTime = null;
    
    console.log('[WhatsApp] ✅ Estado do socket resetado');
  }

  /**
   * Log crítico quando status de conexão muda para algo diferente de 'connected'
   */
  private logCriticalConnectionChange(newStatus: 'connected' | 'disconnected' | 'connecting' | 'error', error: string | null): void {
    console.log('\n═══════════════════════════════════════════════════════════');
    console.log('🚨🚨🚨  ALERTA: MUDANÇA DE STATUS DE CONEXÃO  🚨🚨🚨');
    console.log('═══════════════════════════════════════════════════════════');
    console.log(`[WhatsApp] Status anterior: ${this.connectionStatus}`);
    console.log(`[WhatsApp] Status novo: ${newStatus}`);
    if (error) {
      console.log(`[WhatsApp] Erro: ${error}`);
    }
    console.log(`[WhatsApp] Timestamp: ${new Date().toISOString()}`);
    console.log(`[WhatsApp] Socket existe: ${!!this.socket}`);
    console.log(`[WhatsApp] Socket.user existe: ${!!this.socket?.user}`);
    console.log(`[WhatsApp] QR code em memória: ${!!this.currentQR}`);
    console.log(`[WhatsApp] Is connecting: ${this.isConnecting}`);
    console.log('═══════════════════════════════════════════════════════════\n');
    
    // Emitir evento para notificação interna (se necessário)
    // Pode ser usado para alertas em dashboard, logs centralizados, etc.
  }

  private clearInvalidSession(): void {
    try {
      const fs = require('fs');
      const path = require('path');
      const sessionDir = this.config.sessionPath;
      
      console.log('[WhatsApp] 🧹 Clearing invalid session from:', sessionDir);
      
      if (fs.existsSync(sessionDir)) {
        const files = fs.readdirSync(sessionDir);
        console.log(`[WhatsApp] Found ${files.length} files/directories in session directory`);
        
        let removedCount = 0;
        files.forEach((file: string) => {
          const filePath = path.join(sessionDir, file);
          try {
            const stats = fs.statSync(filePath);
            if (stats.isFile()) {
              // Remove TODOS os arquivos, independente da extensão
              fs.unlinkSync(filePath);
              console.log(`[WhatsApp] ✅ Removed file: ${file}`);
              removedCount++;
            } else if (stats.isDirectory()) {
              // Remove diretórios também (caso haja subdiretórios)
              fs.rmSync(filePath, { recursive: true, force: true });
              console.log(`[WhatsApp] ✅ Removed directory: ${file}`);
              removedCount++;
            }
          } catch (err) {
            console.error(`[WhatsApp] ❌ Failed to remove ${file}:`, err);
          }
        });
        console.log(`[WhatsApp] ✅ Session cleared. Removed ${removedCount} items. Next connection will require new QR code.`);
      } else {
        console.log('[WhatsApp] Session directory does not exist, creating it...');
        fs.mkdirSync(sessionDir, { recursive: true });
      }
      
      // Também limpar o diretório inteiro e recriar para garantir limpeza completa
      if (fs.existsSync(sessionDir)) {
        try {
          fs.rmSync(sessionDir, { recursive: true, force: true });
          fs.mkdirSync(sessionDir, { recursive: true });
          console.log('[WhatsApp] ✅ Session directory completely reset');
        } catch (err) {
          console.error('[WhatsApp] ❌ Failed to reset session directory:', err);
        }
      }
    } catch (error) {
      console.error('[WhatsApp] ❌ Failed to clear session:', error);
    }
  }

  /**
   * Extrai conteúdo da mensagem (texto e/ou mídia)
   * Suporta: texto, imagem, áudio, vídeo, documento
   */
  private async extractMessageContent(
    msg: WAMessage,
    messageType: string | undefined
  ): Promise<{
    text: string | null;
    media?: {
      type: 'image' | 'audio' | 'video' | 'document';
      mimetype?: string;
      caption?: string;
      url?: string;
      mediaId?: string;
    };
  }> {
    let text: string | null = null;
    let media: {
      type: 'image' | 'audio' | 'video' | 'document';
      mimetype?: string;
      caption?: string;
      url?: string;
      mediaId?: string;
    } | undefined;

    const message = msg.message;

    // Extrair texto (pode estar em vários lugares)
    if (message?.conversation) {
      text = message.conversation;
    } else if (message?.extendedTextMessage?.text) {
      text = message.extendedTextMessage.text;
    }

    // Processar mídia baseado no tipo
    if (messageType === 'imageMessage') {
      const imageMsg = message?.imageMessage;
      if (imageMsg) {
        text = imageMsg.caption || text; // Caption pode ser o texto
        // Usar fileSha256 se disponível, senão usar url ou directPath
        const mediaId = imageMsg.fileSha256 
          ? Buffer.from(imageMsg.fileSha256).toString('base64')
          : imageMsg.url || imageMsg.directPath || undefined;
        media = {
          type: 'image',
          mimetype: imageMsg.mimetype,
          caption: imageMsg.caption || undefined,
          mediaId,
        };
        console.log(`[WhatsApp] 📷 Imagem detectada: ${media.mimetype}, mediaId: ${mediaId ? 'sim' : 'não'}`);
      }
    } else if (messageType === 'audioMessage') {
      const audioMsg = message?.audioMessage;
      if (audioMsg) {
        const mediaId = audioMsg.fileSha256 
          ? Buffer.from(audioMsg.fileSha256).toString('base64')
          : audioMsg.url || audioMsg.directPath || undefined;
        media = {
          type: 'audio',
          mimetype: audioMsg.mimetype,
          mediaId,
        };
        console.log(`[WhatsApp] 🎵 Áudio detectado: ${media.mimetype}, mediaId: ${mediaId ? 'sim' : 'não'}`);
      }
    } else if (messageType === 'videoMessage') {
      const videoMsg = message?.videoMessage;
      if (videoMsg) {
        text = videoMsg.caption || text; // Caption pode ser o texto
        const mediaId = videoMsg.fileSha256 
          ? Buffer.from(videoMsg.fileSha256).toString('base64')
          : videoMsg.url || videoMsg.directPath || undefined;
        media = {
          type: 'video',
          mimetype: videoMsg.mimetype,
          caption: videoMsg.caption || undefined,
          mediaId,
        };
        console.log(`[WhatsApp] 🎬 Vídeo detectado: ${media.mimetype}, mediaId: ${mediaId ? 'sim' : 'não'}`);
      }
    } else if (messageType === 'documentMessage') {
      const docMsg = message?.documentMessage;
      if (docMsg) {
        text = docMsg.caption || text; // Caption pode ser o texto
        const mediaId = docMsg.fileSha256 
          ? Buffer.from(docMsg.fileSha256).toString('base64')
          : docMsg.url || docMsg.directPath || undefined;
        media = {
          type: 'document',
          mimetype: docMsg.mimetype,
          caption: docMsg.caption || docMsg.fileName || undefined,
          mediaId,
        };
        console.log(`[WhatsApp] 📄 Documento detectado: ${media.mimetype}, mediaId: ${mediaId ? 'sim' : 'não'}`);
      }
    }

    return { text, media };
  }

  /**
   * Mapeia o tipo de mensagem do Baileys para nosso tipo interno normalizado
   * Normalização completa: todos os tipos do Baileys são mapeados para tipos consistentes
   */
  private mapMessageType(
    messageType: string | undefined
  ): 'text' | 'image' | 'audio' | 'video' | 'document' | 'other' {
    if (!messageType) return 'other';
    
    // Normalizar para lowercase para comparação case-insensitive
    const normalized = messageType.toLowerCase();
    
    switch (normalized) {
      // Tipos de texto
      case 'conversation':
      case 'extendedtextmessage':
      case 'protocolmessage':
        return 'text';
      
      // Tipos de imagem
      case 'imagemessage':
      case 'stickerMessage': // Stickers são tratados como imagens
        return 'image';
      
      // Tipos de áudio
      case 'audiomessage':
      case 'pttmessage': // Push-to-talk (áudio de voz)
        return 'audio';
      
      // Tipos de vídeo
      case 'videomessage':
        return 'video';
      
      // Tipos de documento
      case 'documentmessage':
        return 'document';
      
      // Tipos desconhecidos ou não suportados
      default:
        console.log(`[WhatsApp] ⚠️  Tipo de mensagem não mapeado: ${messageType} → 'other'`);
        return 'other';
    }
  }

  /**
   * Normaliza JID para extrair apenas o número (sem @s.whatsapp.net)
   * Usado para conversationId
   */
  private normalizeJid(jid: string): string {
    const normalized = this.normalizeWhatsAppJid(jid);
    return normalized.phoneNumber;
  }

  /**
   * NORMALIZAÇÃO OBRIGATÓRIA: Garante que TODO JID seja @s.whatsapp.net
   * CONVERTE @lid para @s.whatsapp.net (LID contém o número correto)
   * SEMPRE retorna formato: 554896942834@s.whatsapp.net
   */
  private normalizeWhatsAppJid(jid: string): {
    phoneNumber: string;
    jid: string; // Sempre termina com @s.whatsapp.net
  } {
    if (!jid || jid === 'unknown') {
      throw new Error(`Invalid JID: ${jid}`);
    }

    // Se já termina com @s.whatsapp.net, validar e usar
    if (jid.endsWith('@s.whatsapp.net')) {
      const phoneNumber = jid.replace('@s.whatsapp.net', '');
      // Validar que é apenas números
      if (!/^\d+$/.test(phoneNumber)) {
        throw new Error(`Invalid phone number in JID: ${jid}`);
      }
      return {
        phoneNumber,
        jid, // Já está correto
      };
    }

    // Se termina com @lid, EXTRAIR o número e converter para @s.whatsapp.net
    // O LID contém o número correto, apenas o sufixo é diferente
    if (jid.endsWith('@lid')) {
      const phoneNumber = jid.replace('@lid', '');
      // Validar que é apenas números
      if (!/^\d+$/.test(phoneNumber)) {
        throw new Error(`Invalid phone number in LID: ${jid}`);
      }
      console.log(`[WhatsApp] 🔄 Convertendo LID para JID: ${jid} -> ${phoneNumber}@s.whatsapp.net`);
      return {
        phoneNumber,
        jid: `${phoneNumber}@s.whatsapp.net`,
      };
    }

    // Se termina com outro sufixo (@g.us para grupos, etc), REJEITAR
    // (Grupos não são suportados nesta fase)
    if (jid.includes('@') && !jid.endsWith('@s.whatsapp.net')) {
      const suffix = jid.split('@')[1];
      console.error(`[WhatsApp] ❌ JID rejeitado (formato não suportado): ${jid} (sufixo: ${suffix})`);
      throw new Error(`Invalid JID format: ${jid}. Only @s.whatsapp.net and @lid are allowed for individual numbers.`);
    }

    // Se não tem @, assumir que é apenas o número e adicionar @s.whatsapp.net
    if (!jid.includes('@')) {
      // Validar que é apenas números
      if (!/^\d+$/.test(jid)) {
        throw new Error(`Invalid phone number format: ${jid}`);
      }
      return {
        phoneNumber: jid,
        jid: `${jid}@s.whatsapp.net`,
      };
    }

    // Fallback: não deveria chegar aqui
    throw new Error(`Unable to normalize JID: ${jid}`);
  }

  /**
   * Extrai informações do remetente da mensagem (sem buscar foto)
   * Prioridade: msg.pushName > store.contacts > cache > undefined
   * NUNCA busca foto aqui - isso é feito sob demanda
   * JID já deve estar normalizado (termina com @s.whatsapp.net)
   */
  private async extractSenderInfoFromMessage(
    msg: any,
    jid: string // JID já normalizado (termina com @s.whatsapp.net)
  ): Promise<{
    phoneNumber: string;
    jid: string;
    pushName?: string;
    profilePictureUrl?: string;
  }> {
    // NORMALIZAR JID OBRIGATORIAMENTE (garantir @s.whatsapp.net)
    let normalizedJid: string;
    let phoneNumber: string;
    try {
      const normalized = this.normalizeWhatsAppJid(jid);
      normalizedJid = normalized.jid;
      phoneNumber = normalized.phoneNumber;
    } catch (error) {
      console.error(`[WhatsApp] ❌ Erro ao normalizar JID: ${jid}`, error);
      throw error;
    }

    let pushName: string | undefined;

    // 1. Tentar obter pushName diretamente da mensagem (mais confiável)
    if (msg.pushName) {
      pushName = msg.pushName;
      console.log(`[WhatsApp] ✅ Nome obtido de msg.pushName: ${pushName}`);
    }

    // 2. Se não tiver, tentar obter do store de contatos do Baileys
    if (!pushName && this.socket?.store?.contacts) {
      try {
        const contact = this.socket.store.contacts[normalizedJid];
        if (contact) {
          pushName = contact.name || contact.notify || contact.vname;
          if (pushName) {
            console.log(`[WhatsApp] ✅ Nome obtido de store.contacts: ${pushName}`);
            // Atualizar cache para uso futuro
            this.contactsCache.set(normalizedJid, { name: pushName, jid: normalizedJid });
          }
        }
      } catch (error) {
        console.log(`[WhatsApp] ⚠️  Erro ao acessar store.contacts: ${error}`);
      }
    }

    // 3. Se ainda não tiver, usar cache (preenchido por contacts.upsert)
    if (!pushName) {
      const cachedContact = this.contactsCache.get(normalizedJid);
      pushName = cachedContact?.name;
      if (pushName) {
        console.log(`[WhatsApp] ✅ Nome obtido do cache: ${pushName}`);
      }
    }

    if (!pushName) {
      console.log(`[WhatsApp] ⚠️  Nome não encontrado para ${normalizedJid}`);
    }

    // NÃO buscar foto aqui - isso é feito sob demanda na criação da conversa
    return {
      phoneNumber,
      jid: normalizedJid,
      pushName,
      // profilePictureUrl será buscado sob demanda quando necessário
    };
  }

  /**
   * Busca foto de perfil sob demanda (com try/catch)
   * Usar apenas na criação da conversa ou quando explicitamente necessário
   * MÉTODO PÚBLICO para uso via API
   */
  async getProfilePictureUrl(jid: string): Promise<string | undefined> {
    if (!this.socket) {
      return undefined;
    }

    // NORMALIZAR JID OBRIGATORIAMENTE para @s.whatsapp.net
    let normalizedJid: string;
    try {
      const normalized = this.normalizeWhatsAppJid(jid);
      normalizedJid = normalized.jid;
    } catch (error) {
      console.error(`[WhatsApp] ❌ Erro ao normalizar JID para foto: ${jid}`, error);
      return undefined;
    }
    
    try {
      const profilePic = await this.socket.profilePictureUrl(normalizedJid, 'image');
      return profilePic;
    } catch (error) {
      // Foto não disponível - ignorar silenciosamente (é normal não ter foto)
      // Log removido - não é erro, é operação normal
      return undefined;
    }
  }

  /**
   * Baixa mídia de uma mensagem usando a mensagem completa do Baileys
   * MÉTODO PÚBLICO para uso via API
   */
  async downloadMessageMedia(baileysMessage: any): Promise<Buffer | null> {
    if (!this.socket) {
      console.error('[WhatsApp] Socket not available for media download');
      return null;
    }

    if (!baileysMessage || !baileysMessage.message) {
      console.error('[WhatsApp] Invalid Baileys message for media download');
      return null;
    }

    try {
      console.log(`[WhatsApp] 📥 Baixando mídia para mensagem ${baileysMessage.key?.id}...`);
      
      // Baixar mídia como buffer usando a mensagem completa
      const buffer = await downloadMediaMessage(
        baileysMessage as WAMessage,
        'buffer',
        {},
        {
          logger: pino({ level: 'silent' }),
          reuploadRequest: this.socket.updateMediaMessage,
        }
      );

      console.log(`[WhatsApp] ✅ Mídia baixada com sucesso: ${buffer.length} bytes`);
      return buffer as Buffer;
    } catch (error) {
      console.error(`[WhatsApp] ❌ Erro ao baixar mídia:`, error);
      console.error('Stack:', error instanceof Error ? error.stack : 'No stack');
      return null;
    }
  }

  private generateTraceId(): string {
    return `trace_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  }

  /**
   * Cria um wrapper atômico para saveCreds que garante escrita segura
   * Usa writeFileSync com flags adequadas para evitar escrita incompleta durante queda de conexão
   */
  private createAtomicSaveCreds(originalSaveCreds: () => Promise<void>): () => Promise<void> {
    return async () => {
      try {
        // Executar saveCreds original primeiro
        await originalSaveCreds();
        
        // Verificar se os arquivos foram escritos corretamente
        // useMultiFileAuthState salva em múltiplos arquivos JSON
        const sessionDir = this.config.sessionPath;
        if (fs.existsSync(sessionDir)) {
          const files = fs.readdirSync(sessionDir);
          const credsFiles = files.filter((f: string) => f.endsWith('.json'));
          
          // Verificar integridade dos arquivos de credenciais
          for (const file of credsFiles) {
            const filePath = path.join(sessionDir, file);
            try {
              const content = fs.readFileSync(filePath, 'utf-8');
              // Tentar parsear para verificar se o JSON é válido
              JSON.parse(content);
            } catch (err) {
              console.error(`[WhatsApp] ⚠️  Arquivo de credenciais corrompido detectado: ${file}`);
              // Se o arquivo estiver corrompido, tentar remover e salvar novamente
              try {
                fs.unlinkSync(filePath);
                console.log(`[WhatsApp] ✅ Arquivo corrompido removido: ${file}`);
                // Salvar novamente
                await originalSaveCreds();
              } catch (cleanupErr) {
                console.error(`[WhatsApp] ❌ Erro ao limpar arquivo corrompido: ${cleanupErr}`);
              }
            }
          }
        }
        
        console.log('[WhatsApp] ✅ Credenciais salvas atomicamente');
      } catch (error) {
        console.error('[WhatsApp] ❌ Erro ao salvar credenciais atomicamente:', error);
        // Tentar salvar novamente uma vez
        try {
          await originalSaveCreds();
          console.log('[WhatsApp] ✅ Credenciais salvas após retry');
        } catch (retryError) {
          console.error('[WhatsApp] ❌ Erro crítico ao salvar credenciais após retry:', retryError);
          // Não lançar erro - permitir que o sistema continue
        }
      }
    };
  }

  /**
   * Handler de erros "Bad MAC" / "Failed to decrypt" com rastreamento inteligente.
   * 
   * CONTEXTO (Baileys Issue #1769 - bug CONHECIDO com 30+ duplicatas):
   * - Erros "Bad MAC" ocorrem quando a sessão Signal Protocol fica dessincronizada
   * - A sessão se AUTO-REPARA quando o contato envia um novo PreKeyBundle
   * - Deletar sessão NÃO ajuda e piora a situação (gera novo QR)
   * - Com makeCacheableSignalKeyStore + shouldIgnoreJid, esses erros diminuem drasticamente
   * 
   * Estratégia: Silenciar o ruído, logar resumo periódico, NÃO tomar ação destrutiva.
   */
  private handleSocketError(error: any): void {
    const errorMessage = error?.message || error?.toString() || '';
    const errorStack = error?.stack || '';
    const fullError = errorMessage + ' ' + errorStack;
    
    const isBadMac = fullError.includes('Bad MAC') || 
                     fullError.includes('bad mac') ||
                     fullError.includes('Failed to decrypt') ||
                     fullError.includes('No matching sessions') ||
                     fullError.includes('No sessions');
    
    if (!isBadMac) {
      // Reset global counter if enough time passed without Bad MAC
      if (this.badMacGlobalCount > 0) {
        const now = Date.now();
        if (now - this.lastBadMacErrorTime > this.BAD_MAC_RESET_WINDOW) {
          this.badMacGlobalCount = 0;
          this.badMacPerContact.clear();
          console.log('[WhatsApp] ✅ Contador de Bad MAC resetado (sem erros por 5 min)');
        }
      }
      return;
    }
    
    // IGNORAR erros de histórico - não afetam mensagens em tempo real
    if (fullError.includes('messaging-history') || fullError.includes('history.set')) {
      return;
    }
    
    const now = Date.now();
    
    // Extrair JID do erro. O regex do libsignal coloca o JID no nome da "queue" 
    // formato: "62518164725810.17" ou "554896939561.0" no stack trace
    const queueMatch = fullError.match(/(\d{10,15})[\.:_](\d+)\s/);
    const jidDirectMatch = fullError.match(/(\d+@s\.whatsapp\.net|\d+[:.]?\d*@lid)/);
    const affectedJid = jidDirectMatch ? jidDirectMatch[1] 
                      : queueMatch ? queueMatch[1] 
                      : 'unknown';
    
    // Rastrear por contato
    const contactEntry = this.badMacPerContact.get(affectedJid) || { count: 0, lastTime: 0 };
    
    // Resetar contagem do contato se passou muito tempo (5 min)
    if (now - contactEntry.lastTime > this.BAD_MAC_RESET_WINDOW) {
      contactEntry.count = 0;
    }
    
    contactEntry.count++;
    contactEntry.lastTime = now;
    this.badMacPerContact.set(affectedJid, contactEntry);
    
    // Resetar contador global se passou muito tempo
    if (now - this.lastBadMacErrorTime > this.BAD_MAC_RESET_WINDOW) {
      this.badMacGlobalCount = 0;
    }
    
    this.badMacGlobalCount++;
    this.lastBadMacErrorTime = now;
    
    // LOG INTELIGENTE: apenas a cada 50 erros ou no 1º, 5º e 10º erro
    const shouldLog = contactEntry.count === 1 || 
                      contactEntry.count === 5 || 
                      contactEntry.count === 10 ||
                      contactEntry.count % 50 === 0;
    
    if (shouldLog) {
      const uniqueContacts = this.badMacPerContact.size;
      console.log(
        `[WhatsApp] 🔐 Descriptografia: ${contactEntry.count} falhas para ${affectedJid} | ` +
        `Global: ${this.badMacGlobalCount} | Contatos: ${uniqueContacts} | ` +
        `(Sessão se auto-repara via PreKey - Baileys #1769)`
      );
    }
    
    // NÃO fazer soft reconnect para Bad MAC - a sessão se auto-repara
    // Soft reconnect SÓ piora porque reinicia a negociação de chaves
    // Exceção: se MUITOS contatos distintos falharem, pode ser corrupção geral
    const uniqueContacts = this.badMacPerContact.size;
    if (uniqueContacts >= 5 && this.badMacGlobalCount >= this.BAD_MAC_THRESHOLD_GLOBAL) {
      console.log(
        `[WhatsApp] ⚠️ ${uniqueContacts} contatos distintos com falha de sessão. ` +
        `Isso pode indicar corrupção geral. Fazendo soft reconnect...`
      );
      this.badMacGlobalCount = 0;
      this.badMacPerContact.clear();
      this.softReconnect('Bad MAC em 5+ contatos distintos');
    }
  }

  /**
   * Tenta reparo silencioso limpando cache de chaves em memória
   * Sem deletar arquivos da sessão
   */
  private attemptSilentRepair(): void {
    try {
      console.log('[WhatsApp] 🔧 Tentando reparo silencioso: limpando cache de chaves em memória...');
      
      if (this.currentAuthState && this.currentAuthState.keys) {
        const keysStore = this.currentAuthState.keys;
        
        // Tentar limpar cache de chaves em memória usando métodos disponíveis
        try {
          // O SignalKeyStore do Baileys geralmente tem getAll() que retorna um Map ou objeto
          if (typeof keysStore.getAll === 'function') {
            const allKeys = keysStore.getAll();
            
            // Se for um Map, limpar todas as entradas
            if (allKeys instanceof Map) {
              allKeys.clear();
              console.log('[WhatsApp] ✅ Cache de chaves limpo (Map). Continuando conexão...');
            } else if (typeof allKeys === 'object' && allKeys !== null) {
              // Se for um objeto, tentar limpar chaves individuais
              const keyIds = Object.keys(allKeys);
              for (const keyId of keyIds) {
                try {
                  if (typeof keysStore.delete === 'function') {
                    keysStore.delete(keyId);
                  }
                } catch (e) {
                  // Ignorar erros individuais
                }
              }
              console.log('[WhatsApp] ✅ Cache de chaves limpo (objeto). Continuando conexão...');
            } else {
              console.log('[WhatsApp] ✅ Reparo silencioso concluído. Continuando conexão...');
            }
          } else {
            console.log('[WhatsApp] ✅ Reparo silencioso concluído. Continuando conexão...');
          }
        } catch (repairError) {
          // Se o reparo falhar, não é crítico - apenas logar e continuar
          console.log('[WhatsApp] ⚠️ Reparo silencioso parcialmente aplicado, mas conexão continua');
        }
      } else {
        console.log('[WhatsApp] ✅ Reparo silencioso concluído. Continuando conexão...');
      }
    } catch (error) {
      console.log('[WhatsApp] ⚠️ Reparo silencioso não pôde ser aplicado, mas conexão continua:', error);
    }
  }

  /**
   * SOFT RECONNECT: Reconecta sem deletar a sessão (para Bad MAC, 515, etc)
   * Apenas fecha o socket e tenta reconectar mantendo as credenciais
   */
  private softReconnect(reason: string): void {
    try {
      console.log(`[WhatsApp] 🔄 Soft reconnect iniciado: ${reason}`);
      
      // Resetar contadores
      this.badMacGlobalCount = 0;
      this.badMacPerContact.clear();
      this.lastBadMacErrorTime = 0;
      this.lastRepairAttempt = 0;
      
      // Desconectar socket
      if (this.socket) {
        try {
          this.socket.ev.removeAllListeners();
          this.socket.end(undefined);
        } catch (e) {
          // Ignore
        }
        this.socket = null;
      }
      
      // Limpar estado de conexão (mas NÃO limpar sessão)
      this.connectionStatus = 'disconnected';
      this.connectionError = `Reconectando devido a: ${reason}`;
      this.isConnecting = false;
      // NÃO limpar currentQR - pode estar aguardando escaneamento
      
      emitConnectionStatus({ status: 'disconnected' }, this.generateTraceId());
      
      // Tentar reconectar após 2 segundos (mantendo sessão)
      setTimeout(async () => {
        if (!this.isConnecting && !this.socket) {
          console.log('[WhatsApp] 🔄 Tentando reconectar mantendo sessão...');
          try {
            await this.connect();
          } catch (error) {
            console.error('[WhatsApp] ❌ Erro na reconexão:', error);
          }
        }
      }, 2000);
      
      console.log('[WhatsApp] ✅ Soft reconnect iniciado. Sessão mantida.');
    } catch (error) {
      console.error('[WhatsApp] ❌ Erro no soft reconnect:', error);
    }
  }

  /**
   * HARD RECONNECT: Força logout e limpa completamente a sessão (apenas para 401 Unauthorized)
   * Deleta a sessão e exige novo QR code
   */
  private forceLogoutOnBadMac(): void {
    try {
      console.log('[WhatsApp] 🔧 Limpando sessão completamente (401 Unauthorized)...');
      
      // Resetar contadores
      this.badMacGlobalCount = 0;
      this.badMacPerContact.clear();
      this.lastBadMacErrorTime = 0;
      this.lastRepairAttempt = 0;
      
      // Desconectar socket
      if (this.socket) {
        try {
          this.socket.ev.removeAllListeners();
          this.socket.end(undefined);
        } catch (e) {
          // Ignore
        }
        this.socket = null;
      }
      
      // Limpar referência ao auth state
      this.currentAuthState = null;
      
      // Limpar estado de conexão
      this.connectionStatus = 'disconnected';
      this.connectionError = 'Sessão expirada. Por favor, reconecte e escaneie o QR code novamente.';
      this.isConnecting = false;
      this.currentQR = null;
      this.hadInvalidSession = true;
      
      // Limpar sessão completamente (HARD RECONNECT - apenas para 401)
      this.clearInvalidSession();
      
      // Emitir evento de desconexão
      emitConnectionStatus(
        { 
          status: 'error', 
          error: 'Sessão expirada. Por favor, reconecte e escaneie o QR code novamente.' 
        },
        this.generateTraceId()
      );
      
      console.log('[WhatsApp] ✅ Logout forçado e sessão limpa. Próxima conexão exigirá novo QR code.');
    } catch (error) {
      console.error('[WhatsApp] ❌ Erro ao forçar logout:', error);
    }
  }
}

export const createWhatsAppAdapter = (config: AdapterConfig): WhatsAppAdapter => {
  return new WhatsAppAdapter(config);
};

export type { WhatsAppAdapter };

